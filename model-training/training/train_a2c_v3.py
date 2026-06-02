"""
train_a2c_v3.py - Senkron A2C, PPO-uyumlu state_size=94.

Onceki versiyonun (state_size=16) eksigi: agent etrafini yeterince zengin
gormuyor, salinim ve bias kaciniloz. PPO'nun 102-elemanlı state'iyle
neredeyse aynı yapı:
  - 8 yön ışın (4 değer/yön): mesafe, type(static/dyn), dyn vx, dyn vy
  - Hedef bilgisi (5): delta_x, delta_y, dist_norm, sin(angle), cos(angle)
  - Ziyaret haritası 5x5 (25)
  - Aksiyon geçmişi 8 step × 4 action (32)
Toplam: 32 + 5 + 25 + 32 = 94 eleman.

Cikti: backend/models/a2c_v3.pth
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from collections import deque
from typing import List

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import torch.optim as optim

_backend = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "backend",
)
sys.path.insert(0, _backend)

from environment import GridEnvironment       # noqa: E402
from agent.a3c_agent import A3CAgent          # noqa: E402


DEFAULT_CONFIG = {
    "grid_size": 15,
    "max_steps": 250,
    "state_size": 94,
    "action_size": 4,
    "view_radius": 7,             # PPO'da default 7, sweetspot4'te 4

    "n_envs": 8,
    "n_steps": 20,
    "max_updates": 150_000,

    "hidden_size": 256,
    "learning_rate": 3e-4,
    "gamma": 0.99,
    "gae_lambda": 0.95,
    "entropy_start": 0.03,
    "entropy_end": 0.01,
    "entropy_decay_updates": 80_000,
    "value_coeff": 0.5,
    "max_grad_norm": 0.5,

    "save_every_updates": 5_000,
    "log_every_updates": 50,
    "model_path": "backend/models/a2c_v3.pth",
    "stats_path": "backend/models/training_stats_a2c_v3.json",
}

# Curriculum: dengeli (bos -> engel -> dinamik -> kose/yakin)
# (obstacle_ratio, min_path, dynamic_count, threshold, min_episodes)
CURRICULUM = [
    (0.00,  0, 0, 0.80,  1000),     # bos
    (0.05,  2, 0, 0.75,  1500),     # cok hafif engel + yakin hedef
    (0.10,  5, 0, 0.65,  2000),     # hafif engel
    (0.15,  8, 0, 0.55,  3000),     # orta engel
    (0.18, 10, 1, 0.45,  4000),     # dinamik engel girer
    (0.22, 10, 2, 0.00, 100_000),   # tam senaryo
]


def get_a3c_state(env, view_radius: int, visit_map: np.ndarray,
                  action_history: deque) -> np.ndarray:
    """PPO-uyumlu 94-elemanli state vektoru."""
    obs = []
    dirs = [(0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1)]

    # Dinamik engel pozisyon dict
    dyn_dict = {}
    for o in env.dynamic_obstacles:
        dyn_dict[(o.row, o.col)] = o

    # 1. 8 yön ışın (32)
    for dx, dy in dirs:
        hit = [1.0, 0.0, 0.0, 0.0]
        for step in range(1, view_radius + 1):
            rx, ry = env.agent_pos[0] + dx * step, env.agent_pos[1] + dy * step
            if rx < 0 or rx >= env.size or ry < 0 or ry >= env.size:
                hit = [step / view_radius, 1.0, 0.0, 0.0]
                break
            if env.grid[rx, ry] == 1:
                hit = [step / view_radius, 1.0, 0.0, 0.0]
                break
            if (rx, ry) in dyn_dict:
                d = dyn_dict[(rx, ry)]
                vx = 0.5 if d.dr > 0 else (-0.5 if d.dr < 0 else 0.0)
                vy = 0.5 if d.dc > 0 else (-0.5 if d.dc < 0 else 0.0)
                hit = [step / view_radius, 0.5, vx, vy]
                break
        obs.extend(hit)

    # 2. Hedef info (5)
    dx_g = (env.goal_pos[0] - env.agent_pos[0]) / env.size
    dy_g = (env.goal_pos[1] - env.agent_pos[1]) / env.size
    dist_norm = math.hypot(dx_g, dy_g) / math.sqrt(2)
    angle = math.atan2(dy_g, dx_g)
    obs.extend([dx_g, dy_g, dist_norm, math.sin(angle), math.cos(angle)])

    # 3. Ziyaret haritası 5x5 (25)
    max_vis = max(1.0, float(np.max(visit_map)))
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            px, py = env.agent_pos[0] + dx, env.agent_pos[1] + dy
            if 0 <= px < env.size and 0 <= py < env.size:
                obs.append(visit_map[px, py] / max_vis)
            else:
                obs.append(1.0)

    # 4. Aksiyon geçmişi (8 step × 4 = 32)
    for act_arr in action_history:
        obs.extend(act_arr)

    return np.array(obs, dtype=np.float32)


def _make_env(cfg: dict, phase) -> GridEnvironment:
    obs, mpl, dyn, _, _ = phase
    return GridEnvironment(
        size=cfg["grid_size"],
        obstacle_ratio=obs,
        min_path_length=mpl,
        max_steps=cfg["max_steps"],
        random_maps=True,
        state_size=cfg["state_size"],
        dynamic_obstacle_count=dyn,
    )


def _set_phase(envs, phase) -> None:
    obs, mpl, dyn, _, _ = phase
    for env in envs:
        env.obstacle_ratio = obs
        env.min_path_length = mpl
        env.dynamic_obstacle_count = dyn


def _entropy_schedule(cfg: dict, update_idx: int) -> float:
    t = min(1.0, update_idx / max(1, cfg["entropy_decay_updates"]))
    return cfg["entropy_start"] + (cfg["entropy_end"] - cfg["entropy_start"]) * t


def _compute_gae(rewards, values, dones, last_value, gamma, lam):
    T = len(rewards)
    adv = np.zeros(T, dtype=np.float32)
    gae = 0.0
    nv = last_value
    for t in reversed(range(T)):
        nonterm = 1.0 - dones[t]
        delta = rewards[t] + gamma * nv * nonterm - values[t]
        gae = delta + gamma * lam * nonterm * gae
        adv[t] = gae
        nv = values[t]
    return adv, adv + values


def _init_visit_action(env, cfg):
    """Yeni episode için visit_map ve action_history başlat."""
    visit_map = np.zeros((env.size, env.size), dtype=np.float32)
    visit_map[env.agent_pos[0], env.agent_pos[1]] += 1
    action_history = deque([[0.0] * cfg["action_size"] for _ in range(8)], maxlen=8)
    return visit_map, action_history


def train(cfg: dict, resume: bool = False) -> None:
    project_root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )
    model_path = (cfg["model_path"] if os.path.isabs(cfg["model_path"])
                  else os.path.join(project_root, cfg["model_path"]))
    stats_path = (cfg["stats_path"] if os.path.isabs(cfg["stats_path"])
                  else os.path.join(project_root, cfg["stats_path"]))
    os.makedirs(os.path.dirname(model_path), exist_ok=True)

    phase_idx = 0
    phase_episodes = 0
    phase = CURRICULUM[phase_idx]

    agent = A3CAgent(
        state_size=cfg["state_size"],
        action_size=cfg["action_size"],
        hidden_size=cfg["hidden_size"],
        learning_rate=cfg["learning_rate"],
        gamma=cfg["gamma"],
        entropy_coeff=cfg["entropy_start"],
    )
    if resume:
        agent.load(model_path)

    agent.optimizer = optim.Adam(
        agent.network.parameters(),
        lr=cfg["learning_rate"],
        eps=1e-5,
    )

    device = agent.device
    N = cfg["n_envs"]
    T = cfg["n_steps"]
    view_radius = cfg["view_radius"]

    envs = [_make_env(cfg, phase) for _ in range(N)]
    visit_maps = []
    action_histories = []
    states = np.zeros((N, cfg["state_size"]), dtype=np.float32)
    for i, env in enumerate(envs):
        env.reset()
        vm, ah = _init_visit_action(env, cfg)
        visit_maps.append(vm)
        action_histories.append(ah)
        states[i] = get_a3c_state(env, view_radius, vm, ah)

    ep_rewards = [0.0] * N
    reward_window = deque(maxlen=100)
    success_window = deque(maxlen=100)
    all_ep_rewards: list = []
    all_ep_successes: list = []
    total_episodes = 0
    best_success = 0.0
    start_time = time.time()

    print("=" * 72)
    print(" A2C v3 — state_size=94 (PPO-uyumlu), gercek RL")
    print("=" * 72)
    print(f" Grid: {cfg['grid_size']}x{cfg['grid_size']}  envs: {N}  n_steps: {T}")
    print(f" view_radius: {view_radius}  state: 8-ray+goal+visit+actHist = {cfg['state_size']}")
    print(f" Max updates: {cfg['max_updates']:,}  (~ {cfg['max_updates']*N*T:,} env steps)")
    print(f" lr={cfg['learning_rate']}  ent {cfg['entropy_start']}->{cfg['entropy_end']}")
    print(f" Device: {device}")
    for i, (obs, mpl, dyn, thr, min_ep) in enumerate(CURRICULUM):
        label = "son faz" if thr == 0 else f"gecis >= %{int(thr*100)}"
        print(f"   Faz {i+1}: engel %{int(obs*100):2d}  min yol {mpl:2d}  dyn {dyn}  min {min_ep} ep  | {label}")
    print("=" * 72)

    entropy_coeff = cfg["entropy_start"]
    value_coeff = cfg["value_coeff"]
    max_grad_norm = cfg["max_grad_norm"]

    for update in range(1, cfg["max_updates"] + 1):
        entropy_coeff = _entropy_schedule(cfg, update)

        buf_states = np.zeros((T, N, cfg["state_size"]), dtype=np.float32)
        buf_actions = np.zeros((T, N), dtype=np.int64)
        buf_rewards = np.zeros((T, N), dtype=np.float32)
        buf_dones = np.zeros((T, N), dtype=np.float32)

        for t in range(T):
            buf_states[t] = states
            st_t = torch.as_tensor(states, device=device, dtype=torch.float32)
            with torch.no_grad():
                logits, _ = agent.network(st_t)
                probs = F.softmax(logits, dim=-1)
                actions = torch.multinomial(probs, 1).squeeze(-1).cpu().numpy()
            buf_actions[t] = actions

            for i in range(N):
                a = int(actions[i])
                ns, r, d, info = envs[i].step(a)
                buf_rewards[t, i] = r
                buf_dones[t, i] = 1.0 if d else 0.0
                ep_rewards[i] += r

                # visit_map + action_history güncelle
                ar, ac = envs[i].agent_pos
                visit_maps[i][ar, ac] += 1
                oh = [0.0] * cfg["action_size"]
                oh[a] = 1.0
                action_histories[i].append(oh)

                if d:
                    reward_window.append(ep_rewards[i])
                    success_window.append(1.0 if info.get("reached_goal") else 0.0)
                    all_ep_rewards.append(ep_rewards[i])
                    all_ep_successes.append(int(info.get("reached_goal", False)))
                    ep_rewards[i] = 0.0
                    total_episodes += 1
                    phase_episodes += 1
                    envs[i].reset()
                    vm, ah = _init_visit_action(envs[i], cfg)
                    visit_maps[i] = vm
                    action_histories[i] = ah

                states[i] = get_a3c_state(envs[i], view_radius, visit_maps[i], action_histories[i])

        # Value tahmini
        all_states_np = np.concatenate([buf_states[:, i, :] for i in range(N)], axis=0)
        last_states_np = states
        all_for_value = np.concatenate([all_states_np, last_states_np], axis=0)
        all_v_t = torch.as_tensor(all_for_value, device=device, dtype=torch.float32)
        with torch.no_grad():
            _, all_values = agent.network(all_v_t)
        all_values_np = all_values.squeeze(-1).cpu().numpy()
        values_TN = all_values_np[: T * N].reshape(N, T).T
        last_values = all_values_np[T * N:]

        # GAE
        adv = np.zeros((T, N), dtype=np.float32)
        ret = np.zeros((T, N), dtype=np.float32)
        for i in range(N):
            a_, r_ = _compute_gae(buf_rewards[:, i], values_TN[:, i],
                                  buf_dones[:, i], float(last_values[i]),
                                  cfg["gamma"], cfg["gae_lambda"])
            adv[:, i] = a_
            ret[:, i] = r_

        # Flat batch
        flat_states = torch.as_tensor(
            np.concatenate([buf_states[:, i, :] for i in range(N)], axis=0),
            device=device, dtype=torch.float32,
        )
        flat_actions = torch.as_tensor(
            np.concatenate([buf_actions[:, i] for i in range(N)], axis=0),
            device=device, dtype=torch.long,
        )
        flat_adv = torch.as_tensor(
            np.concatenate([adv[:, i] for i in range(N)], axis=0),
            device=device, dtype=torch.float32,
        )
        flat_ret = torch.as_tensor(
            np.concatenate([ret[:, i] for i in range(N)], axis=0),
            device=device, dtype=torch.float32,
        )
        flat_adv = (flat_adv - flat_adv.mean()) / (flat_adv.std() + 1e-8)

        logits, values = agent.network(flat_states)
        values = values.squeeze(-1)
        log_probs = F.log_softmax(logits, dim=-1)
        probs = F.softmax(logits, dim=-1)
        action_log_probs = log_probs.gather(1, flat_actions.unsqueeze(1)).squeeze(1)

        actor_loss = -(action_log_probs * flat_adv.detach()).mean()
        critic_loss = F.mse_loss(values, flat_ret)
        entropy = -(log_probs * probs).sum(dim=-1).mean()
        total_loss = actor_loss + value_coeff * critic_loss - entropy_coeff * entropy

        agent.optimizer.zero_grad()
        total_loss.backward()
        nn.utils.clip_grad_norm_(agent.network.parameters(), max_grad_norm)
        agent.optimizer.step()
        agent.total_steps += T * N
        agent.episode_count = total_episodes

        # Curriculum
        cur_obs, cur_mpl, cur_dyn, cur_thr, cur_min = CURRICULUM[phase_idx]
        if (phase_idx < len(CURRICULUM) - 1
                and cur_thr > 0
                and phase_episodes >= cur_min
                and len(success_window) == success_window.maxlen
                and float(np.mean(success_window)) >= cur_thr):
            phase_idx += 1
            phase_episodes = 0
            new_phase = CURRICULUM[phase_idx]
            _set_phase(envs, new_phase)
            print(f"\n  [FAZ {phase_idx+1}] engel %{int(new_phase[0]*100)}  "
                  f"min yol {new_phase[1]}  dyn {new_phase[2]}  "
                  f"(basari: {float(np.mean(success_window)):.1%})")

        if update % cfg["log_every_updates"] == 0:
            avg_r = float(np.mean(reward_window)) if reward_window else 0.0
            sr = float(np.mean(success_window)) if success_window else 0.0
            elapsed = time.time() - start_time
            print(
                f"\r upd {update:6d}/{cfg['max_updates']} | "
                f"ep {total_episodes:6d} | "
                f"AvgR {avg_r:+7.1f} | "
                f"Succ {sr:.1%} | "
                f"faz {phase_idx+1} | "
                f"actor {actor_loss.item():+.3f} | critic {critic_loss.item():.2f} | "
                f"H {entropy.item():.3f} | "
                f"{elapsed:.0f}s",
                end="",
                flush=True,
            )

        if (len(success_window) == success_window.maxlen
                and phase_idx == len(CURRICULUM) - 1):
            sr = float(np.mean(success_window))
            if sr > best_success:
                best_success = sr
                agent.save(model_path)
                print(f"\n  [BEST] Success {sr:.1%}  (faz {phase_idx+1}, ep {total_episodes})")

        if update % cfg["save_every_updates"] == 0:
            ckpt = model_path.replace(".pth", f"_upd{update}.pth")
            agent.save(ckpt)

    final_path = model_path.replace(".pth", "_final.pth")
    agent.save(final_path)
    print(f"\n{'='*72}")
    print(f" [BITTI] Toplam ep: {total_episodes}  Toplam step: {agent.total_steps:,}")
    if success_window:
        print(f" Son 100 ep success: {float(np.mean(success_window)):.1%}")
        print(f" Son 100 ep avg reward: {float(np.mean(reward_window)):.1f}")
    print(f" Sure: {(time.time()-start_time)/60:.1f} dk")
    print("=" * 72)

    stats = {
        "config": cfg,
        "curriculum": [list(p) for p in CURRICULUM],
        "total_episodes": total_episodes,
        "total_steps": agent.total_steps,
        "best_success": best_success,
        "all_episode_rewards": all_ep_rewards,
        "all_episode_successes": all_ep_successes,
        "final_success_100": float(np.mean(success_window)) if success_window else 0.0,
        "final_avg_reward_100": float(np.mean(reward_window)) if reward_window else 0.0,
    }
    with open(stats_path, "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2)
    print(f"[STATS] {stats_path}")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    p.add_argument("--updates", type=int, default=DEFAULT_CONFIG["max_updates"])
    p.add_argument("--n-envs", type=int, default=DEFAULT_CONFIG["n_envs"])
    p.add_argument("--n-steps", type=int, default=DEFAULT_CONFIG["n_steps"])
    p.add_argument("--view-radius", type=int, default=DEFAULT_CONFIG["view_radius"])
    p.add_argument("--lr", type=float, default=DEFAULT_CONFIG["learning_rate"])
    p.add_argument("--ent-start", type=float, default=DEFAULT_CONFIG["entropy_start"])
    p.add_argument("--ent-end", type=float, default=DEFAULT_CONFIG["entropy_end"])
    p.add_argument("--hidden", type=int, default=DEFAULT_CONFIG["hidden_size"])
    p.add_argument("--model-path", type=str, default=DEFAULT_CONFIG["model_path"])
    p.add_argument("--stats-path", type=str, default=DEFAULT_CONFIG["stats_path"])
    p.add_argument("--resume", action="store_true")
    return p.parse_args()


def main():
    args = parse_args()
    cfg = DEFAULT_CONFIG.copy()
    cfg["max_updates"] = args.updates
    cfg["n_envs"] = args.n_envs
    cfg["n_steps"] = args.n_steps
    cfg["view_radius"] = args.view_radius
    cfg["learning_rate"] = args.lr
    cfg["entropy_start"] = args.ent_start
    cfg["entropy_end"] = args.ent_end
    cfg["hidden_size"] = args.hidden
    cfg["model_path"] = args.model_path
    cfg["stats_path"] = args.stats_path
    train(cfg, resume=args.resume)


if __name__ == "__main__":
    main()
