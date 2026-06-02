"""
api/main.py — FastAPI WebSocket AI Servisi

Endpointler:
  GET  /health           → Servis sağlık kontrolü
  POST /train            → Arka planda eğitim başlat
  GET  /train/status     → Eğitim durumunu sorgula
  POST /train/stop       → Eğitimi durdur
  POST /infer            → Tek adım inference
  GET  /model/stats      → Model istatistikleri
  WS   /ws/simulate      → Gerçek zamanlı simülasyon (Spring Boot uyumlu)
  POST /maps/load        → GameMapDTO yükle ve ortamı sıfırla

Simülasyon WebSocket protokolü:
  İstemci → Sunucu (AgentTickDTO formatı):
  {
    "map_name":  "harita1",
    "agent_pos": {"x": -5, "y": 0},
    "goal_pos":  {"x":  5, "y": 0},
    "grid":      [[0,1,...], ...],   // opsiyonel
    "state":     [0.1, 0.2, ...]    // 12 elemanlı, opsiyonel
  }

  Sunucu → İstemci (SimulationResponseDTO formatı):
  {
    "action":       2,
    "action_label": "UP",
    "q_values":     [1.2, 0.3, -0.5, 0.8],
    "reward":       1.0,
    "done":         false,
    "reached_goal": false,
    "epsilon":      0.15,
    "episode":      420,
    "agent_pos":    {"x": -5, "y": 1},
    "steps":        12
  }
"""
import os
import sys
import json
import threading
import numpy as np
from typing import Any, Dict, Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from environment import GridEnvironment, ACTION_LABELS
from agent import DQLAgent, A3CAgent

# Training config
DEFAULT_CONFIG = {
    "max_episodes": 2000,
    "grid_size": 15,
    "obstacle_ratio": 0.15,
    "learning_rate": 0.001,
    "gamma": 0.95,
    "random_maps": True,
    "max_steps": 500,
    "epsilon_start": 1.0,
    "epsilon_min": 0.01,
    "epsilon_decay": 0.995,
    "batch_size": 32,
    "buffer_capacity": 10000,
    "target_update": 10,
    "hidden_size": 256,
}

# ─── FastAPI ──────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Otonom Sürüş AI Servisi",
    description="DQL tabanlı otonom sürüş ajanı — FastAPI + PyTorch",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Global Durum ─────────────────────────────────────────────────────────────

import torch
from agent.ppo_agent import PPOAgent
from collections import deque

# ─── Model Yükleme ve Konfigürasyon ───
MODEL_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "models", "ppo_hardcore_v2"
)
DEFAULT_SIZE = 15

# PPO, DQN, A2C, SAC (SB3) modelini otomatik olarak tespit et ve yükle
IS_SAC = "sac" in MODEL_PATH.lower()
IS_A2C = (MODEL_PATH.endswith(".zip") and not IS_SAC) or "a2c" in MODEL_PATH.lower()
IS_PPO = (os.path.exists(os.path.join(MODEL_PATH, "policy.pth")) or "ppo" in MODEL_PATH.lower()) and not IS_SAC and not IS_A2C

# Dynamic view radius mapping for different PPO models
def get_model_view_radius(model_path: str) -> int:
    lower_path = model_path.lower()
    if any(x in lower_path for x in ["kalkansiz", "hardcore_v2"]):
        return 5
    elif any(x in lower_path for x in ["radius3", "radius_3", "_r3"]):
        return 3
    elif any(x in lower_path for x in ["radius5", "radius_5", "_r5", "sweetspot5", "_s5", "ssr_v5_s5"]):
        return 5
    elif any(x in lower_path for x in ["radius4", "radius_4", "_r4", "sweetspot"]):
        return 4
    elif any(x in lower_path for x in ["radius6", "radius_6", "_r6", "sweetspot6"]):
        return 6
    return 7

PPO_VIEW_RADIUS = get_model_view_radius(MODEL_PATH)

# --- VERSION STAMP ---
print("=" * 60)
print("[INIT] Tüm modeller kalkansız (saf sinir ağı) modunda çalışıyor.")
print("=" * 60)

if IS_A2C:
    print(f"[INIT] A2C Model tespit edildi! Model: {MODEL_PATH}")
    env = GridEnvironment(size=DEFAULT_SIZE, random_maps=True, state_size=77)
    from agent.a2c_agent import A2CAgent
    try:
        agent = A2CAgent(MODEL_PATH)
    except Exception as _load_err:
        print(f"[WARN] A2C model yüklenemedi: {_load_err}")
        agent = None
elif IS_SAC:
    print(f"[INIT] SAC Model tespit edildi! Model: {MODEL_PATH}")
    env = GridEnvironment(size=DEFAULT_SIZE, random_maps=True, state_size=102)
    from agent.sac_agent import SACAgent
    try:
        agent = SACAgent(MODEL_PATH)
    except Exception as _load_err:
        print(f"[WARN] SAC model yüklenemedi: {_load_err}")
        agent = None
elif IS_PPO:
    print(f"[INIT] PPO Hardcore Model tespit edildi! Model: {MODEL_PATH}")
    env = GridEnvironment(size=DEFAULT_SIZE, random_maps=True, state_size=102)
    agent = PPOAgent(state_size=102, action_size=5)
    try:
        agent.load(MODEL_PATH)
    except Exception as _load_err:
        print(f"[WARN] PPO model yüklenemedi: {_load_err}")
else:
    print(f"[INIT] DQN/A3C Model yükleniyor: {MODEL_PATH}")
    state_size = 16
    hidden_size = 256
    action_size = 4

    try:
        checkpoint = torch.load(MODEL_PATH, map_location="cpu", weights_only=False)
        if "config" in checkpoint:
            state_size = checkpoint["config"].get("state_size", state_size)
            hidden_size = checkpoint["config"].get("hidden_size", hidden_size)
            action_size = checkpoint["config"].get("action_size", action_size)
            print(f"[INIT] Checkpoint: state_size={state_size}, hidden={hidden_size}, action={action_size}")
    except Exception as _read_err:
        print(f"[WARN] Checkpoint okunamadı: {_read_err}")

    IS_A3C_INIT = "a3c" in MODEL_PATH.lower() or "a2c" in MODEL_PATH.lower()
    env_state_size = state_size if state_size in (12, 16) else 16
    env = GridEnvironment(size=DEFAULT_SIZE, random_maps=True, state_size=env_state_size)
    if IS_A3C_INIT:
        agent = A3CAgent(state_size=state_size, action_size=action_size, hidden_size=hidden_size)
        try:
            agent.network.load_state_dict(checkpoint["network_state"])
            agent.episode_count = checkpoint.get("episode_count", 0)
            agent.total_steps = checkpoint.get("total_steps", 0)
            print(f"[INIT] A3C yuklendi (state_size={state_size})")
        except Exception as e:
            print(f"[WARN] A3C yuklenemedi: {e}")
    else:
        agent = DQLAgent(state_size=state_size, action_size=action_size, hidden_size=hidden_size)
        try:
            agent.load(MODEL_PATH)
        except Exception as _load_err:
            print(f"[WARN] DQN yuklenemedi: {_load_err}")

training_state: Dict[str, Any] = {
    "running": False,
    "episode": 0,
    "max_ep": 0,
    "last_reward": None,
    "success_rate": 0.0,
    "epsilon": 1.0,
    "error": None,
}


# ─── Pydantic Modeller ────────────────────────────────────────────────────────

class TrainRequest(BaseModel):
    episodes: int = 2000
    grid_size: int = 15
    obstacle_ratio: float = 0.15
    learning_rate: float = 0.001
    gamma: float = 0.95
    random_maps: bool = True


class InferRequest(BaseModel):
    state: list[float]


class SelectModelRequest(BaseModel):
    model_key: str


class DynamicObstacleDTO(BaseModel):
    """Frontend'den gelen dinamik engel — payload format"""
    id: int
    pos: Dict[str, int]              # {x, y}
    velocity: Dict[str, int]         # {vx, vy}
    range: Optional[int] = None
    type: str = "linear-h"           # "linear-h" | "linear-v" | "random"


class ObstaclesDTO(BaseModel):
    """Statik + dinamik engeller"""
    static: list[dict] = []
    dynamic: list[DynamicObstacleDTO] = []


class MapPayload(BaseModel):
    map_name: str
    grid_size: Dict[str, int]
    start_pos: Dict[str, int]
    target_pos: Dict[str, int]
    obstacles: ObstaclesDTO


# ─── Endpointler ──────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model_loaded": os.path.exists(MODEL_PATH),
        "model_type": "SAC" if IS_SAC else ("A2C" if IS_A2C else ("PPO" if IS_PPO else "DQN")),
        "device": str(getattr(agent, "device", "cpu")),
        "episode": int(getattr(agent, "episode_count", 0)),
        "state_size": int(env.state_size),
    }


@app.get("/models")
async def get_models():
    """Mevcut tüm otonom sürüş modellerini ve aktif olanı listele."""
    # Models klasöründeki tüm pth, zip ve model klasörlerini listele
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    models_dir = os.path.join(project_root, "models")
    
    available_models = []
    
    if os.path.exists(models_dir):
        for f in os.listdir(models_dir):
            full_path = os.path.join(models_dir, f)
            if os.path.isdir(full_path):
                # policy.pth içeren klasörleri kontrol et
                if os.path.exists(os.path.join(full_path, "policy.pth")):
                    # Eğer içinde 'data' dosyası varsa ve klasör ismi 'a2c' içeriyorsa A2C modelidir
                    if os.path.exists(os.path.join(full_path, "data")) and "a2c" in f.lower():
                        available_models.append({"key": f, "name": f"A2C ({f})", "type": "A2C"})
                    elif "sac" in f.lower():
                        available_models.append({"key": f, "name": f"SAC ({f})", "type": "SAC"})
                    else:
                        available_models.append({"key": f, "name": f"PPO ({f})", "type": "PPO"})
            elif f.endswith(".pth"):
                key = f.replace(".pth", "")
                # Determine model type from filename
                if "a2c" in key.lower() or "a3c" in key.lower():
                    model_type = "A3C"
                    name = f"A3C ({key})"
                else:
                    model_type = "DQN"
                    name = f"DQN ({key})"
                available_models.append({"key": key, "name": name, "type": model_type})
            elif f.endswith(".zip"):
                key = f.replace(".zip", "")
                if "sac" in key.lower():
                    model_type = "SAC"
                    name = f"SAC ({key})"
                else:
                    model_type = "A2C"
                    name = f"A2C ({key})"
                available_models.append({"key": key, "name": name, "type": model_type})
                
    # Eger hic PPO model tespit edilemediyse varsayilan olarak listele
    if not any(m["type"] == "PPO" for m in available_models):
        available_models.insert(0, {"key": "ppo_stage_4_hardcore", "name": "PPO (ppo_stage_4_hardcore)", "type": "PPO"})
        
    # React'in "Encountered two children with the same key" uyarısını engellemek için modelleri key bazında tekilleştir
    seen_keys = set()
    unique_models = []
    for m in available_models:
        if m["key"] not in seen_keys:
            seen_keys.add(m["key"])
            unique_models.append(m)
    available_models = unique_models

    # Aktif model ismini bul
    active_key = os.path.basename(MODEL_PATH).replace(".pth", "").replace(".zip", "")
    
    return {
        "models": available_models,
        "active_model": active_key
    }
 
 
@app.post("/model/select")
async def select_model(req: SelectModelRequest):
    """Canlı olarak otonom sürüş modelini değiştir."""
    global MODEL_PATH, IS_PPO, IS_A2C, IS_SAC, env, agent, PPO_VIEW_RADIUS
    try:
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        
        folder_path = os.path.join(project_root, "models", req.model_key)
        zip_path = os.path.join(project_root, "models", f"{req.model_key}.zip")
        pth_path = os.path.join(project_root, "models", f"{req.model_key}.pth")
        
        if os.path.isdir(folder_path):
            new_path = folder_path
        elif os.path.exists(zip_path):
            new_path = zip_path
        else:
            new_path = pth_path
            
        if not os.path.exists(new_path):
            raise HTTPException(status_code=404, detail=f"Model dosyası bulunamadı: {new_path}")
            
        MODEL_PATH = new_path
        IS_SAC = "sac" in req.model_key.lower()
        IS_A2C = (MODEL_PATH.endswith(".zip") and not IS_SAC) or (os.path.isdir(MODEL_PATH) and os.path.exists(os.path.join(MODEL_PATH, "data")) and "a2c" in req.model_key.lower())
        IS_PPO = (os.path.exists(os.path.join(MODEL_PATH, "policy.pth")) or "ppo" in MODEL_PATH.lower()) and not IS_SAC and not IS_A2C
        IS_A3C = ("a3c" in MODEL_PATH.lower() or "a2c" in MODEL_PATH.lower()) and not IS_A2C
        
        if IS_SAC:
            PPO_VIEW_RADIUS = get_model_view_radius(MODEL_PATH)
            print(f"[DYNAMIC CHANGE] SAC modeline geçiliyor: {MODEL_PATH}")
            env = GridEnvironment(size=DEFAULT_SIZE, random_maps=True, state_size=102)
            from agent.sac_agent import SACAgent
            agent = SACAgent(MODEL_PATH)
        elif IS_A2C:
            print(f"[DYNAMIC CHANGE] A2C modeline geçiliyor: {MODEL_PATH}")
            env = GridEnvironment(size=DEFAULT_SIZE, random_maps=True, state_size=77)
            from agent.a2c_agent import A2CAgent
            agent = A2CAgent(MODEL_PATH)
        elif IS_A3C:
            print(f"[DYNAMIC CHANGE] A2C/A3C modeline geçiliyor: {MODEL_PATH}")
            checkpoint = torch.load(MODEL_PATH, map_location="cpu", weights_only=False)
            config = checkpoint.get("config", {})
            state_size = config.get("state_size", 16)
            action_size = config.get("action_size", 4)
            hidden_size = config.get("hidden_size", 256)

            # state_size=94 zengin state'i kendi ureteci ile besler, env yine 16 uretir
            env_state_size = state_size if state_size in (12, 16) else 16
            env = GridEnvironment(size=DEFAULT_SIZE, random_maps=True, state_size=env_state_size)
            agent = A3CAgent(state_size=state_size, action_size=action_size, hidden_size=hidden_size)
            agent.network.load_state_dict(checkpoint["network_state"])
            agent.episode_count = checkpoint.get("episode_count", 0)
            agent.total_steps = checkpoint.get("total_steps", 0)
            print(f"[DYNAMIC CHANGE] A2C/A3C model yüklendi! (state_size={state_size}, hidden={hidden_size}, Episodes: {agent.episode_count})")
        elif IS_PPO:
            PPO_VIEW_RADIUS = get_model_view_radius(MODEL_PATH)
            print(f"[DYNAMIC CHANGE] PPO modeline geçiliyor: {MODEL_PATH} (View Radius: {PPO_VIEW_RADIUS})")
            env = GridEnvironment(size=DEFAULT_SIZE, random_maps=True, state_size=102)
            agent = PPOAgent(state_size=102, action_size=5)
            agent.load(MODEL_PATH)
        else:
            print(f"[DYNAMIC CHANGE] DQN modeline geçiliyor: {MODEL_PATH}")
            state_size = 16
            hidden_size = 256
            action_size = 4
            
            checkpoint = torch.load(MODEL_PATH, map_location="cpu", weights_only=False)
            if "config" in checkpoint:
                state_size = checkpoint["config"].get("state_size", state_size)
                hidden_size = checkpoint["config"].get("hidden_size", hidden_size)
                action_size = checkpoint["config"].get("action_size", action_size)
                
            env = GridEnvironment(size=DEFAULT_SIZE, random_maps=True, state_size=state_size)
            agent = DQLAgent(
                state_size=state_size,
                action_size=action_size,
                hidden_size=hidden_size
            )
            agent.load(MODEL_PATH)
            
        print(f"[DYNAMIC CHANGE] Model değişimi başarılı! Aktif model: {req.model_key}")
        model_type_str = "SAC" if IS_SAC else ("A2C" if IS_A2C else ("PPO" if IS_PPO else "DQN"))
        return {
            "status": "success",
            "active_model": req.model_key,
            "type": model_type_str,
            "state_size": env.state_size
        }
    except Exception as err:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Model yüklenemedi: {str(err)}")


@app.post("/maps/load")
async def load_map(payload: MapPayload):
    """Frontend'den gelen harita + dinamik engelleri yükle."""
    global env
    try:
        print(f"[LOAD] Gelen payload: map_name={payload.map_name}, grid_size={payload.grid_size}, obstacles_count={len(payload.obstacles.static) if payload.obstacles else 0}")
        # Use model_dump() to ensure dict format (avoids Pydantic object issues)
        payload_dict = payload.model_dump()

        # Fresh GridEnvironment instance
        size = payload_dict["grid_size"]["x"]
        env = GridEnvironment(size=size, random_maps=False, state_size=agent.state_size)

        # Harita yükle — inline implementation
        half = size // 2

        def cart_to_idx(x, y):
            return (half - y, x + half)

        # Static obstacles
        grid = np.zeros((size, size), dtype=np.int8)
        for obs in payload_dict["obstacles"]["static"]:
            r, c = cart_to_idx(obs["x"], obs["y"])
            if 0 <= r < size and 0 <= c < size:
                grid[r, c] = 1

        # Set grid and positions
        sp = payload_dict["start_pos"]
        tp = payload_dict["target_pos"]
        start = cart_to_idx(sp["x"], sp["y"])
        goal = cart_to_idx(tp["x"], tp["y"])

        env._generate_from_data(grid, start, goal)

        # Debug: Harita görüntüsü
        print(f"[MAP] Harita yüklendi: {size}x{size}")
        print(f"[MAP] Baslangi (grid): {start} -> Cartesian: ({start[1]-half}, {half-start[0]})")
        print(f"[MAP] Hedef (grid): {goal} -> Cartesian: ({goal[1]-half}, {half-goal[0]})")
        print(f"[MAP] Grid (1=engel, 0=bos):")
        for r in range(size):
            row_str = "".join("#" if grid[r, c] == 1 else "." for c in range(size))
            marker = ""
            if tuple([r, start[1]]) == tuple(start): marker += " START"
            if tuple([r, goal[1]]) == tuple(goal): marker += " GOAL"
            print(f"  {row_str}{marker}")

        # Dinamik engelleri yükle
        if payload_dict["obstacles"] and payload_dict["obstacles"]["dynamic"]:
            try:
                # Ensure all dynamic obstacles are pure dicts, not Pydantic objects
                dynamic_list = payload_dict["obstacles"]["dynamic"]
                dynamic_dicts = []
                for obs in dynamic_list:
                    if isinstance(obs, dict):
                        dynamic_dicts.append(obs)
                    elif hasattr(obs, 'model_dump'):
                        dynamic_dicts.append(obs.model_dump())
                    elif hasattr(obs, '__dict__'):
                        dynamic_dicts.append(obs.__dict__)
                env.load_dynamic_obstacles_from_api(dynamic_dicts)
            except Exception as dyn_err:
                # Fallback: dynamic obstacles optional (log but continue)
                print(f"[WARN] Dinamik engel yüklenemedi: {dyn_err}")
                import traceback
                traceback.print_exc()
                pass

        # Episode'i başlat
        env.reset()

        return {
            "status": "ok",
            "map_name": payload.map_name,
            "grid_size": payload.grid_size,
            "start": {"row": int(env.start_pos[0]), "col": int(env.start_pos[1])},
            "goal": {"row": int(env.goal_pos[0]), "col": int(env.goal_pos[1])},
            "dynamic_obstacles": len(env.dynamic_obstacles),
        }
    except Exception as exc:
        print(f"[ERROR] /maps/load exception: {type(exc).__name__}: {exc}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/infer")
async def infer(req: InferRequest):
    """Tek adım inference — durum vektörü → aksiyon + Q değerleri."""
    if len(req.state) != env.state_size:
        raise HTTPException(
            status_code=422,
            detail=f"Durum vektörü boyutu {env.state_size} olmalı, {len(req.state)} geldi.",
        )
    state = np.array(req.state, dtype=np.float32)
    action = agent.select_action(state, training=False)
    q_values = agent.get_q_values(state)
    return {
        "action": action,
        "action_label": ACTION_LABELS[action],
        "q_values": q_values.tolist(),
    }


@app.get("/model/stats")
async def model_stats():
    return agent.get_stats()


# ─── Eğitim ───────────────────────────────────────────────────────────────────

def _run_training(config: dict) -> None:
    global training_state, env, agent

    training_state.update(
        running=True, error=None, episode=0, max_ep=config["max_episodes"]
    )

    try:
        from collections import deque

        env = GridEnvironment(
            size=config["grid_size"],
            obstacle_ratio=config["obstacle_ratio"],
            max_steps=config["max_steps"],
            random_maps=config["random_maps"],
        )
        agent = DQLAgent(
            state_size=env.state_size,
            action_size=env.action_size,
            hidden_size=config.get("hidden_size", 128),
            learning_rate=config["learning_rate"],
            gamma=config["gamma"],
            epsilon_start=config["epsilon_start"],
            epsilon_min=config["epsilon_min"],
            epsilon_decay=config["epsilon_decay"],
            batch_size=config["batch_size"],
            buffer_capacity=config["buffer_capacity"],
            target_update=config["target_update"],
        )

        window = deque(maxlen=100)
        success_win = deque(maxlen=100)
        best_avg = float("-inf")

        for ep in range(1, config["max_episodes"] + 1):
            if not training_state["running"]:
                break

            state = env.reset()
            total_reward = 0.0
            done = False

            while not done:
                action = agent.select_action(state, training=True)
                next_state, reward, done, info = env.step(action)
                agent.remember(state, action, reward, next_state, done)
                if agent.total_steps % 4 == 0:
                    agent.train_step()
                state = next_state
                total_reward += reward

            agent.decay_epsilon()
            if ep % config["target_update"] == 0:
                agent.update_target_network()

            window.append(total_reward)
            success_win.append(int(info["reached_goal"]))
            avg = float(np.mean(window))
            if avg > best_avg and len(window) == 100:
                best_avg = avg
                agent.save(config["model_path"])

            training_state.update(
                episode=ep,
                last_reward=round(total_reward, 2),
                success_rate=round(float(np.mean(success_win)), 3),
                epsilon=round(agent.epsilon, 4),
            )

    except Exception as exc:
        training_state["error"] = str(exc)
    finally:
        training_state["running"] = False


@app.post("/train")
async def start_training(req: TrainRequest, _bg: BackgroundTasks):
    if training_state["running"]:
        raise HTTPException(status_code=409, detail="Eğitim zaten çalışıyor.")

    config = DEFAULT_CONFIG.copy()
    config.update(
        max_episodes=req.episodes,
        grid_size=req.grid_size,
        obstacle_ratio=req.obstacle_ratio,
        learning_rate=req.learning_rate,
        gamma=req.gamma,
        random_maps=req.random_maps,
        model_path=MODEL_PATH,
    )
    threading.Thread(target=_run_training, args=(config,), daemon=True).start()
    return {"status": "started", "config": config}


@app.get("/train/status")
async def training_status():
    return {
        "running": training_state["running"],
        "episode": training_state["episode"],
        "max_episodes": training_state["max_ep"],
        "last_reward": training_state["last_reward"],
        "success_rate": training_state["success_rate"],
        "epsilon": training_state["epsilon"],
        "error": training_state["error"],
        "progress": round(
            training_state["episode"] / max(training_state["max_ep"], 1), 3
        ),
    }


@app.post("/train/stop")
async def stop_training():
    training_state["running"] = False
    return {"status": "stopped", "episode": training_state["episode"]}



# ─── WebSocket Simülasyon ─────────────────────────────────────────────────────

import math

def get_ppo_observation(env, view_radius=7):
    # PPO visit_map ve action_history'yi GridEnvironment nesnesine bağla
    if not hasattr(env, "visit_map"):
        env.visit_map = np.zeros((env.size, env.size), dtype=np.float32)
        env.visit_map[env.agent_pos[0], env.agent_pos[1]] += 1.0
        
    if not hasattr(env, "action_history"):
        env.action_history = deque([[0.0]*5 for _ in range(8)], maxlen=8)

    obs = []
    
    # 1. Işınlar (Raycasts)
    dirs = [(0,-1), (1,-1), (1,0), (1,1), (0,1), (-1,1), (-1,0), (-1,-1)]
    
    # Statik engelleri row, col formatında set yapalım (PPO notebook ile %100 uyumlu)
    static_obs = set()
    for r in range(env.size):
        for c in range(env.size):
            if env.grid[r, c] == 1:
                static_obs.add((r, c))

    # Dinamik engelleri PPO modelinin beklentisine uygun biçimde tanımla
    class PPODynObs:
        def __init__(self, row, col, dr, dc):
            self.x = float(row)
            self.y = float(col)
            self.vx = float(dr)
            self.vy = float(dc)
        @property
        def grid_pos(self):
            return (int(round(self.x)), int(round(self.y)))
        def normalized_velocity(self, max_speed):
            # Ölçeği PPO eğitimindeki sabit 0.5 hızına göre normalize et (en kritik çarpışma önleme hassasiyeti)
            vx_scaled = 0.5 if self.vx > 0 else (-0.5 if self.vx < 0 else 0.0)
            vy_scaled = 0.5 if self.vy > 0 else (-0.5 if self.vy < 0 else 0.0)
            return (vx_scaled, vy_scaled)

    ppo_dyn_obs = []
    for o in env.dynamic_obstacles:
        # DummyObs sınıfından dr (row farkı) ve dc (col farkı) yönlerini doğrudan alıyoruz
        ppo_dyn_obs.append(PPODynObs(o.row, o.col, o.dr, o.dc))

    dyn_positions_dict = {dyn.grid_pos: dyn for dyn in ppo_dyn_obs}

    for dx, dy in dirs:
        hit_data = [1.0, 0.0, 0.0, 0.0]
        for step in range(1, view_radius + 1):
            rx, ry = env.agent_pos[0] + dx*step, env.agent_pos[1] + dy*step
            if rx < 0 or rx >= env.size or ry < 0 or ry >= env.size or (rx, ry) in static_obs:
                hit_data = [step/view_radius, 1.0, 0.0, 0.0]
                break
            if (rx, ry) in dyn_positions_dict:
                dyn = dyn_positions_dict[(rx, ry)]
                nvx, nvy = dyn.normalized_velocity(1.0)
                hit_data = [step/view_radius, 0.5, nvx, nvy]
                break
        obs.extend(hit_data)

    # 2. Hedefe Kalan Mesafe ve Açı (PPO modelinde x=row, y=col koordinat farkıdır)
    delta_x = (env.goal_pos[0] - env.agent_pos[0]) / env.size
    delta_y = (env.goal_pos[1] - env.agent_pos[1]) / env.size
    dist_norm = math.hypot(delta_x, delta_y) / math.sqrt(2)
    angle = math.atan2(delta_y, delta_x)
    obs.extend([delta_x, delta_y, dist_norm, math.sin(angle), math.cos(angle)])

    # 3. Ziyaret Haritası (Agent merkezli 5x5 bölge, doğrudan row/col şeklinde)
    max_vis = max(1.0, np.max(env.visit_map))
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            px, py = env.agent_pos[0]+dx, env.agent_pos[1]+dy
            if 0 <= px < env.size and 0 <= py < env.size:
                obs.append(env.visit_map[px, py] / max_vis)
            else:
                obs.append(1.0)

    # 4. Aksiyon Geçmişi
    for act_arr in env.action_history:
        obs.extend(act_arr)

    return np.array(obs, dtype=np.float32)


def get_a2c_v3_state(env, view_radius: int = 7) -> np.ndarray:
    """A2C v3 (state_size=94) için zengin state.
    8 yön ışın (32) + hedef (5) + visit_map 5x5 (25) + action_history 8x4 (32).
    env.visit_map_a3c ve env.action_history_a3c attribute'ları lazy initialize."""
    import math as _math
    if not hasattr(env, "visit_map_a3c") or env.visit_map_a3c.shape[0] != env.size:
        env.visit_map_a3c = np.zeros((env.size, env.size), dtype=np.float32)
        env.visit_map_a3c[env.agent_pos[0], env.agent_pos[1]] = 1.0
    if not hasattr(env, "action_history_a3c"):
        env.action_history_a3c = deque([[0.0]*4 for _ in range(8)], maxlen=8)

    obs = []
    dirs = [(0,-1),(1,-1),(1,0),(1,1),(0,1),(-1,1),(-1,0),(-1,-1)]
    dyn_dict = {}
    for o in env.dynamic_obstacles:
        dyn_dict[(o.row, o.col)] = o

    for dx, dy in dirs:
        hit = [1.0, 0.0, 0.0, 0.0]
        for step in range(1, view_radius + 1):
            rx, ry = env.agent_pos[0] + dx*step, env.agent_pos[1] + dy*step
            if rx < 0 or rx >= env.size or ry < 0 or ry >= env.size:
                hit = [step/view_radius, 1.0, 0.0, 0.0]; break
            if env.grid[rx, ry] == 1:
                hit = [step/view_radius, 1.0, 0.0, 0.0]; break
            if (rx, ry) in dyn_dict:
                d = dyn_dict[(rx, ry)]
                dr = getattr(d, "dr", 0.0)
                dc = getattr(d, "dc", 0.0)
                vx = 0.5 if dr > 0 else (-0.5 if dr < 0 else 0.0)
                vy = 0.5 if dc > 0 else (-0.5 if dc < 0 else 0.0)
                hit = [step/view_radius, 0.5, vx, vy]; break
        obs.extend(hit)

    dx_g = (env.goal_pos[0] - env.agent_pos[0]) / env.size
    dy_g = (env.goal_pos[1] - env.agent_pos[1]) / env.size
    dist_n = _math.hypot(dx_g, dy_g) / _math.sqrt(2)
    angle = _math.atan2(dy_g, dx_g)
    obs.extend([dx_g, dy_g, dist_n, _math.sin(angle), _math.cos(angle)])

    max_vis = max(1.0, float(np.max(env.visit_map_a3c)))
    for dy_ in range(-2, 3):
        for dx_ in range(-2, 3):
            px, py = env.agent_pos[0] + dx_, env.agent_pos[1] + dy_
            if 0 <= px < env.size and 0 <= py < env.size:
                obs.append(env.visit_map_a3c[px, py] / max_vis)
            else:
                obs.append(1.0)

    for act_arr in env.action_history_a3c:
        obs.extend(act_arr)

    return np.array(obs, dtype=np.float32)


def get_a2c_observation(env):
    """
    AutoSimulation GridEnvironment nesnesini OtonomSurus projesindeki
    77 boyutlu (2 relative hedef + 75 ego grid crop) durum vektörüne dönüştürür.
    """
    size = env.size
    
    # GridWorldEnv koordinat sistemine dönüştür (x = col, y = size - 1 - row)
    agent_x = env.agent_pos[1]
    agent_y = size - 1 - env.agent_pos[0]
    
    goal_x = env.goal_pos[1]
    goal_y = size - 1 - env.goal_pos[0]
    
    # 1. Hedefe kalan bağıl konum vektörü (dx, dy)
    dx = (goal_x - agent_x) / 20.0
    dy = (goal_y - agent_y) / 20.0
    goal_vec = np.array([dx, dy], dtype=np.float32)
    
    # 2. 5x5x3 boyutunda ego-centric grid
    ego_grid = np.zeros((5, 5, 3), dtype=np.float32)
    
    # Dinamik engelleri (x, y) ve hızlarıyla (vx, vy) haritala
    dyn_positions_dict = {}
    if hasattr(env, "dynamic_obstacles") and env.dynamic_obstacles:
        for obs in env.dynamic_obstacles:
            obs_x = obs.col
            obs_y = size - 1 - obs.row
            # y ekseni ters olduğu için dr yönünü tersliyoruz
            vx = float(obs.dc)
            vy = -float(obs.dr)
            dyn_positions_dict[(obs_x, obs_y)] = (vx, vy)
            
    for r_idx, dy_rel in enumerate(range(2, -3, -1)):
        for c_idx, dx_rel in enumerate(range(-2, 3)):
            # Manhattan mesafesi kontrolü (Circular radius r=2)
            if abs(dx_rel) + abs(dy_rel) > 2:
                continue
                
            target_x = agent_x + dx_rel
            target_y = agent_y + dy_rel
            
            target_row = size - 1 - target_y
            target_col = target_x
            
            # Sınır dışı ve statik engel kontrolü (Kanal 0)
            is_out_of_bounds = (target_row < 0 or target_row >= size or target_col < 0 or target_col >= size)
            if is_out_of_bounds or (not is_out_of_bounds and env.grid[target_row, target_col] == 1):
                ego_grid[r_idx, c_idx, 0] = 1.0
                
            # Dinamik engel kontrolü (Kanal 1 ve 2)
            if (target_x, target_y) in dyn_positions_dict:
                ego_grid[r_idx, c_idx, 1] = 1.0
                vx, vy = dyn_positions_dict[(target_x, target_y)]
                ego_grid[r_idx, c_idx, 2] = (vx + vy) / 2.0
                
    flat_ego = ego_grid.flatten()
    observation = np.concatenate([goal_vec, flat_ego]).astype(np.float32)
    return observation





@app.websocket("/ws/simulate")
async def ws_simulate(ws: WebSocket):
    """
    Spring Boot uyumlu WebSocket simülasyon endpointi.
    Her tick'te ajanın bir adımını hesaplar ve sonucu iletir.
    """
    global env
    await ws.accept()
    print(f"[WS] İstemci bağlandı: {ws.client}")

    # Global env'i kullan — /maps/load ile initialize edilmiş durumda

    from collections import deque as _deque
    pos_history = _deque(maxlen=10)  # Stuck detection için pozisyon geçmişi
    visit_counts = {}  # A2C döngü engelleme için ziyaret sayıları

    try:
        while True:
            try:
                raw = await ws.receive_text()
            except Exception as recv_err:
                print(f"[WS] Receive hata: {recv_err}")
                break

            try:
                tick = json.loads(raw)
            except json.JSONDecodeError as json_err:
                print(f"[WS] JSON decode hatası: {json_err}")
                await ws.send_json({"error": "Geçersiz JSON"})
                continue

            try:
                # Harita güncelleme (opsiyonel)
                if tick.get("grid") is not None:
                    grid_arr = np.array(tick["grid"], dtype=np.int8)
                    size = grid_arr.shape[0]
                    half = size // 2
 
                    def api_to_idx(x: int, y: int) -> tuple:
                        return (half - y, x + half)
 
                    sp = tick.get("agent_pos", {"x": -half, "y": half})
                    gp = tick.get("goal_pos", {"x": half, "y": -half})
                    start = api_to_idx(sp["x"], sp["y"])
                    goal = api_to_idx(gp["x"], gp["y"])
 
                    # Simülasyonun ilk adımı mı yoksa devam eden adım mı olduğunu belirle
                    # Eğer adımlar sıfırsa veya frontend is_first_tick göndermişse tam reset yap
                    is_first_tick = tick.get("is_first_tick", False) or (env.steps_taken == 0)
 
                    if is_first_tick:
                        # İlk adımda harita bütünlüğünü ve çözülebilirliği kontrol et
                        env._generate_from_data(grid_arr, start, goal)
                        env.agent_pos = start
                        env.steps_taken = 0
                        env._prev_dist = float(abs(start[0] - goal[0]) + abs(start[1] - goal[1]))
                        env._visited = {start: 1}
                        visit_counts.clear()
                        visit_counts[start] = 1
                        if IS_PPO:
                            if hasattr(env, "visit_map"): delattr(env, "visit_map")
                            if hasattr(env, "action_history"): delattr(env, "action_history")
                        # A3C v3 visit_map ve action_history sifirla
                        if hasattr(env, "visit_map_a3c"): delattr(env, "visit_map_a3c")
                        if hasattr(env, "action_history_a3c"): delattr(env, "action_history_a3c")
                    else:
                        # Devam eden adımlarda (örneğin trafik ışığı değiştiğinde) 
                        # beynin geçmişini ve adımlarını koru, sadece ızgarayı ve ajanın anlık konumunu güncelle
                        env.grid = grid_arr.copy()
                        env.goal_pos = goal
                        env.agent_pos = start
                        # Hata ayıklama için statik engellerin (binaların) koordinatlarını loglayalım
                        obstacles = np.argwhere(env.grid == 1)
                        # Sadece çok uzun olmaması için engellerin toplam sayısını yazdıralım
                        print(f"[DEBUG] Adım: {env.steps_taken} | Ajan: {env.agent_pos} | Haritadaki Statik Engel (Bina) Sayısı: {len(obstacles)}")

                # Hareketli engellerin senkronizasyonu
                if tick.get("dynamic_obstacles") is not None:
                    class DummyObs:
                        def __init__(self, pos, dr=0.0, dc=0.0):
                            self.pos = pos
                            self.row = pos[0]
                            self.col = pos[1]
                            self.dr = dr
                            self.dc = dc
                    
                    # Önceki adımdaki engellerin konum kopyasını al (Geçiş çarpışması denetimi ve yön hesabı için)
                    old_dyn_obs = list(env.dynamic_obstacles) if hasattr(env, "dynamic_obstacles") else []

                    dyn_obs = []
                    half = env.size // 2
                    def api_to_idx(x: int, y: int) -> tuple:
                        return (half - y, x + half)
                        
                    for idx, d_cart in enumerate(tick["dynamic_obstacles"]):
                        d_idx = api_to_idx(d_cart["x"], d_cart["y"])
                        # Önceki adıma göre hareket yönünü (dr, dc) hesapla
                        dr, dc = 0.0, 0.0
                        if idx < len(old_dyn_obs):
                            prev_obs = old_dyn_obs[idx]
                            dr = float(d_idx[0] - prev_obs.row)
                            dc = float(d_idx[1] - prev_obs.col)
                        dyn_obs.append(DummyObs(d_idx, dr, dc))
                    
                    env.prev_dynamic_obstacles = old_dyn_obs  # Gerçek önceki konumlar
                    env.dynamic_obstacles = dyn_obs           # Gerçek yeni konumlar

                # Geçiş çarpışması denetimi için ajanın mevcut konumunu yedekle
                prev_agent_pos = (env.agent_pos[0], env.agent_pos[1])

                # Durum vektörü ve Inference (Model tipine göre)
                action = None
                if IS_A2C:
                    state = get_a2c_observation(env)
                    q_values = agent.get_q_values(state).tolist()
                    action = int(np.argmax(q_values))
                    _, reward, done, info = env.step(action)
                    epsilon = 0.0
                    episode = 1
                elif IS_PPO:
                    state = get_ppo_observation(env, view_radius=PPO_VIEW_RADIUS)
                    state_t = torch.FloatTensor(state).unsqueeze(0)
                    with torch.no_grad():
                        logits = agent.policy(state_t).squeeze(0).numpy()
                    action = int(np.argmax(logits))

                    # Aksiyon geçmişini güncelle
                    action_oh = [0.0]*5
                    action_oh[action] = 1.0
                    env.action_history.append(action_oh)

                    q_values = [float(logits[0]), float(logits[1]),
                                float(logits[2]), float(logits[3])]

                    if action == 4:  # STAY
                        reward = -0.05
                        env.steps_taken += 1
                        done = env.steps_taken >= env.max_steps
                        info = {"reached_goal": False, "steps": env.steps_taken}
                    else:
                        _, reward, done, info = env.step(action)

                    epsilon = 0.0
                    episode = 1
                elif IS_SAC:
                    state = get_ppo_observation(env, view_radius=PPO_VIEW_RADIUS)
                    q_values = agent.get_q_values(state).tolist()
                    action = int(np.argmax(q_values))
                    
                    # Aksiyon geçmişini güncelle
                    action_oh = [0.0]*5
                    action_oh[action] = 1.0
                    if hasattr(env, "action_history"):
                        env.action_history.append(action_oh)

                    if action == 4:  # STAY
                        reward = -0.05
                        env.steps_taken += 1
                        done = env.steps_taken >= env.max_steps
                        info = {"reached_goal": False, "steps": env.steps_taken}
                    else:
                        _, reward, done, info = env.step(action)

                    epsilon = 0.0
                    episode = 1
                else:
                    # Model'in A3C mi DQN mi oldugunu tipinden anla
                    is_a3c_agent = isinstance(agent, A3CAgent)
                    DELTA_MAP = {0: (0, -1), 1: (0, 1), 2: (-1, 0), 3: (1, 0)}

                    if is_a3c_agent and agent.state_size == 94:
                        state = get_a2c_v3_state(env, view_radius=7)
                        q_values = agent.get_q_values(state)
                        action = int(np.argmax(q_values))
                        _, reward, done, info = env.step(action)

                        # visit_map ve action_history guncelle
                        ar2, ac2 = env.agent_pos
                        if hasattr(env, "visit_map_a3c"):
                            if 0 <= ar2 < env.size and 0 <= ac2 < env.size:
                                env.visit_map_a3c[ar2, ac2] += 1
                        if hasattr(env, "action_history_a3c"):
                            oh = [0.0] * 4
                            if 0 <= action < 4:
                                oh[action] = 1.0
                            env.action_history_a3c.append(oh)
                    else:
                        # DQN (veya eski A3C): orijinal davranis — oscillation escape
                        if tick.get("state") is not None:
                            state = np.array(tick["state"], dtype=np.float32)[:agent.state_size]
                        else:
                            state = env._get_state()[:agent.state_size]

                        q_values = agent.get_q_values(state)

                        # Salınım tespiti: son 6 adımda <=2 unique pozisyon
                        oscillating = (
                            len(pos_history) >= 6
                            and len(set(list(pos_history)[-6:])) <= 2
                        )

                        if oscillating:
                            recent = set(list(pos_history)[-4:])
                            escape = [a for a in range(4)
                                      if tuple(np.array(env.agent_pos) + np.array(DELTA_MAP[a])) not in recent]
                            candidates = escape if escape else list(range(4))
                            action = int(max(candidates, key=lambda a: q_values[a]))
                        else:
                            action = int(np.argmax(q_values))

                        _, reward, done, info = env.step(action)

                    epsilon = round(float(agent.epsilon), 4)
                    episode = int(agent.episode_count)

                # ─── GEÇİŞ ÇARPIŞMASI (SWAP COLLISION) KONTROLÜ ───
                # Eğer ajan ve herhangi bir hareketli engel hücre değiştirdiyse (birbirinin içinden geçtiyse)
                # bu durum da çarpışmadır ve simülasyon sonlandırılmalıdır!
                swap_hit = False
                new_agent_pos = (env.agent_pos[0], env.agent_pos[1])
                if not done:
                    for idx, obs in enumerate(env.dynamic_obstacles):
                        if idx < len(env.prev_dynamic_obstacles):
                            prev_obs = env.prev_dynamic_obstacles[idx]
                            prev_obs_pos = (prev_obs.row, prev_obs.col)
                            new_obs_pos = (obs.row, obs.col)
                            
                            # Eğer ajan engelin eski yerine, engel de ajanın eski yerine geldiyse
                            if prev_agent_pos == new_obs_pos and new_agent_pos == prev_obs_pos:
                                swap_hit = True
                                print(f"[COLLISION] Geçiş (Swap) Çarpışması! Ajan: {prev_agent_pos}->{new_agent_pos} | Engel: {prev_obs_pos}->{new_obs_pos}")
                                done = True
                                reward = -50.0
                                info = {"reached_goal": False, "status": "hit_obstacle", "steps": env.steps_taken}
                                break

                # Hareketli engel ajanın üzerine mi geldi? (Pasif veya Geçiş Çarpışması)
                if swap_hit or (env._is_blocked(env.agent_pos[0], env.agent_pos[1]) and env.grid[env.agent_pos[0], env.agent_pos[1]] != 1):
                    # Hareketli engel ajanı ezdi!
                    r, c = env.agent_pos
                    half = env.size // 2
                    await ws.send_json({
                        "action": 0, "action_label": "HIT", "q_values": [0,0,0,0],
                        "reward": -50.0, "done": True, "reached_goal": False, "stuck": False,
                        "agent_pos": {"x": int(c - half), "y": int(half - r)}
                    })
                    pos_history.clear()
                    visit_counts.clear()
                    env.reset()
                    if IS_PPO:
                        if hasattr(env, "visit_map"): delattr(env, "visit_map")
                        if hasattr(env, "action_history"): delattr(env, "action_history")
                    continue

                # Ziyaret haritasını güncelle (A2C & PPO)
                visit_counts[env.agent_pos] = visit_counts.get(env.agent_pos, 0) + 1
                if IS_PPO:
                    if not hasattr(env, "visit_map"):
                        env.visit_map = np.zeros((env.size, env.size), dtype=np.float32)
                    env.visit_map[env.agent_pos[0], env.agent_pos[1]] += 1.0

                # Kartezyen koordinata dönüştür (frontend için)
                r, c = env.agent_pos
                half = env.size // 2
                agent_x = int(c - half)
                agent_y = int(half - r)
                pos_history.append((r, c))

                action_labels = {0: "LEFT", 1: "RIGHT", 2: "UP", 3: "DOWN", 4: "STAY"}
                print(f"[SIM] Step {env.steps_taken}: Cart({agent_x},{agent_y}) | {action_labels.get(action, 'UNKNOWN')} | Q={[round(x, 2) for x in q_values[:4]]}")
                
                response = {
                    "action": int(action),
                    "action_label": action_labels.get(action, "UNKNOWN"),
                    "q_values": [round(float(v), 4) for v in q_values],
                    "reward": round(float(reward), 2),
                    "done": bool(done),
                    "reached_goal": bool(info["reached_goal"]),
                    "stuck": bool(info.get("stuck", False)),
                    "epsilon": epsilon,
                    "episode": episode,
                    "agent_pos": {"x": agent_x, "y": agent_y},
                    "steps": int(info.get("steps", env.steps_taken))
                }
                await ws.send_json(response)

                if done:
                    pos_history.clear()
                    visit_counts.clear()
                    env.reset()
                    if IS_PPO:
                        if hasattr(env, "visit_map"): delattr(env, "visit_map")
                        if hasattr(env, "action_history"): delattr(env, "action_history")
            except Exception as proc_err:
                print(f"[WS] İşlem hatası: {proc_err}")
                import traceback
                traceback.print_exc()
                # Try to send error response
                try:
                    await ws.send_json({"error": f"İşlem hatası: {str(proc_err)}"})
                except:
                    break

    except WebSocketDisconnect:
        print(f"[WS] İstemci ayrıldı: {ws.client}")


# ─── Canlı Model Yükleme Yardımcısı (Yarış Modu için) ─────────────────────────

def load_model_by_key(model_key: str):
    """Herhangi bir modeli key adına göre çalışma zamanında yükler ve yapılandırır."""
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    folder_path = os.path.join(project_root, "models", model_key)
    zip_path = os.path.join(project_root, "models", f"{model_key}.zip")
    pth_path = os.path.join(project_root, "models", f"{model_key}.pth")

    # Zip tabanlı modeller (SAC ve A2C) için öncelikle .zip uzantılı dosya yolunu tercih et (IsADirectoryError önlemek için)
    is_zip_model = "sac" in model_key.lower() or "a2c" in model_key.lower()
    if is_zip_model and os.path.exists(zip_path):
        model_path = zip_path
    elif os.path.isdir(folder_path):
        model_path = folder_path
    elif os.path.exists(zip_path):
        model_path = zip_path
    else:
        model_path = pth_path

    if not os.path.exists(model_path):
        if os.path.exists(model_path + ".zip"):
            model_path += ".zip"
        else:
            raise FileNotFoundError(f"Model dosyası bulunamadı: {model_path}")

    # Model türünü isminden ve uzantısından anla
    model_type = "DQN"
    if "ppo" in model_key.lower():
        model_type = "PPO"
    elif "sac" in model_key.lower() or (model_path.endswith(".zip") and "sac" in model_key.lower()):
        model_type = "SAC"
    elif "a2c" in model_key.lower() or "a3c" in model_key.lower():
        if model_path.endswith(".pth") or "a3c" in model_key.lower():
            model_type = "A3C"
        else:
            model_type = "A2C"

    print(f"[RACE] Yükleniyor: {model_key} (Tür: {model_type}) -> Path: {model_path}")

    if model_type == "PPO":
        from agent.ppo_agent import PPOAgent
        agent_obj = PPOAgent(state_size=102, action_size=5)
        agent_obj.load(model_path)
        view_radius = get_model_view_radius(model_path)
        return {"agent": agent_obj, "type": "PPO", "state_size": 102, "view_radius": view_radius}
    elif model_type == "SAC":
        from agent.sac_agent import SACAgent
        agent_obj = SACAgent(model_path)
        return {"agent": agent_obj, "type": "SAC", "state_size": 102, "view_radius": 4}
    elif model_type == "A2C":
        from agent.a2c_agent import A2CAgent
        agent_obj = A2CAgent(model_path)
        return {"agent": agent_obj, "type": "A2C", "state_size": 77}
    elif model_type == "A3C":
        from agent.a3c_agent import A3CAgent
        checkpoint = torch.load(model_path, map_location="cpu", weights_only=False)
        config = checkpoint.get("config", {})
        state_size = config.get("state_size", 94)
        action_size = config.get("action_size", 4)
        hidden_size = config.get("hidden_size", 256)
        agent_obj = A3CAgent(state_size=state_size, action_size=action_size, hidden_size=hidden_size)
        agent_obj.network.load_state_dict(checkpoint["network_state"])
        agent_obj.episode_count = checkpoint.get("episode_count", 0)
        return {"agent": agent_obj, "type": "A3C", "state_size": state_size}
    else: # DQN
        from agent.dql_agent import DQLAgent
        checkpoint = torch.load(model_path, map_location="cpu", weights_only=False)
        config = checkpoint.get("config", {})
        state_size = config.get("state_size", 16)
        action_size = config.get("action_size", 4)
        hidden_size = config.get("hidden_size", 256)
        agent_obj = DQLAgent(state_size=state_size, action_size=action_size, hidden_size=hidden_size)
        agent_obj.load(model_path)
        return {"agent": agent_obj, "type": "DQN", "state_size": state_size}


# ─── WebSocket Yarış Modu Endpointi (Yöntem 2) ────────────────────────────────

@app.websocket("/ws/race")
async def ws_race(ws: WebSocket):
    """
    Çoklu aracın aynı anda yarıştığı, birbirlerini dinamik engel olarak gördüğü
    ve çarpışmadan kaçındığı yarış modu simülasyonu (Yöntem 2).
    """
    await ws.accept()
    print(f"[RACE WS] İstemci bağlandı: {ws.client}")

    # Yarış durum değişkenleri
    racer_envs = []
    racer_models = []
    pos_histories = []
    keys = []
    racer_dones = []
    prev_placed_dyn_obs = []

    try:
        while True:
            try:
                raw = await ws.receive_text()
            except Exception:
                break

            try:
                tick = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_json({"error": "Geçersiz JSON"})
                continue

            try:
                # ─── Sıfırlama ve Başlatma (First Tick) ───
                if tick.get("is_first_tick") or not racer_envs:
                    grid_arr = np.array(tick["grid"], dtype=np.int8)
                    size = grid_arr.shape[0]
                    half = size // 2

                    def api_to_idx(x: int, y: int) -> tuple:
                        return (half - y, x + half)

                    sp = tick.get("start_pos", {"x": -half, "y": half})
                    gp = tick.get("goal_pos", {"x": half, "y": -half})
                    start = api_to_idx(sp["x"], sp["y"])
                    goal = api_to_idx(gp["x"], gp["y"])

                    # racer_models listesini al, yoksa racer1_model ve racer2_model fallbacks
                    keys = tick.get("racer_models")
                    if keys is None:
                        keys = [tick.get("racer1_model", "ppo_hardcore_v2"), tick.get("racer2_model", "sac_driver_stage_2")]
                    
                    # Boş veya geçersiz anahtarları ele
                    keys = [k for k in keys if k]
                    if not keys:
                        keys = ["ppo_hardcore_v2"]

                    print(f"[RACE INIT] Racer Models: {keys} | Harita: {size}x{size}")

                    prev_placed_dyn_obs = []

                    # Modelleri yükle
                    racer_models = [load_model_by_key(k) for k in keys]

                    # ─── BFS ile Araçlara Ayrık Başlangıç Konumları Bul (Startup Grid Collision Engelleme) ───
                    # Manhattan mesafesi en az 3, yeterli olmazsa en az 2 olacak şekilde dağıtarak ilk adımdaki çarpışmaları engelliyoruz
                    start_cells = []
                    for min_dist in [3, 2]:
                        start_cells = []
                        visited = {start}
                        queue = [start]
                        while queue and len(start_cells) < len(keys):
                            curr = queue.pop(0)
                            r, c = curr
                            if grid_arr[r, c] == 0:
                                if all(abs(r - sc[0]) + abs(c - sc[1]) >= min_dist for sc in start_cells):
                                    start_cells.append(curr)
                            for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]:
                                nr, nc = r + dr, c + dc
                                if 0 <= nr < size and 0 <= nc < size and (nr, nc) not in visited and grid_arr[nr, nc] == 0:
                                    visited.add((nr, nc))
                                    queue.append((nr, nc))
                        if len(start_cells) >= len(keys):
                            break
                    
                    # Eğer yeterince boş hücre bulunamadıysa designated start hücresini fallback olarak kullan
                    while len(start_cells) < len(keys):
                        start_cells.append(start)

                    # Ajanlara özel izole ortamlar oluştur
                    racer_envs = []
                    pos_histories = []
                    racer_dones = [False] * len(keys)
                    for i, model_obj in enumerate(racer_models):
                        env = GridEnvironment(size=size, random_maps=False, state_size=model_obj["state_size"])
                        env._generate_from_data(grid_arr, start_cells[i], goal)
                        env.reset()

                        # Ziyaret ve aksiyon geçmişlerini sıfırla
                        if hasattr(env, "visit_map"): delattr(env, "visit_map")
                        if hasattr(env, "action_history"): delattr(env, "action_history")
                        if hasattr(env, "visit_map_a3c"): delattr(env, "visit_map_a3c")
                        if hasattr(env, "action_history_a3c"): delattr(env, "action_history_a3c")

                        racer_envs.append(env)
                        pos_histories.append([env.agent_pos])

                    # Başlangıç paketini geri gönder
                    response = {
                        "racers": [],
                        "collision": False
                    }
                    for i, env in enumerate(racer_envs):
                        r, c = env.agent_pos
                        response["racers"].append({
                            "id": i,
                            "model_key": keys[i],
                            "action": 4,
                            "action_label": "STAY",
                            "q_values": [0.0, 0.0, 0.0, 0.0],
                            "reward": 0.0,
                            "done": False,
                            "reached_goal": False,
                            "agent_pos": {"x": int(c - half), "y": int(half - r)}
                        })
                    
                    # Geriye dönük uyumluluk (Racer 1 & Racer 2 fallbacks)
                    if len(racer_envs) >= 1:
                        response["racer1"] = response["racers"][0]
                    if len(racer_envs) >= 2:
                        response["racer2"] = response["racers"][1]

                    await ws.send_json(response)
                    continue

                # ─── Normal Adım (Simülasyon Tick) ───
                if tick.get("grid") is not None:
                    grid_arr = np.array(tick["grid"], dtype=np.int8)
                    for env in racer_envs:
                        env.grid = grid_arr.copy()

                # Önceki konumları yedekle
                prev_positions = [env.agent_pos for env in racer_envs]

                # Yönleri hesapla (birbirinin raycast algılaması için)
                directions = []
                for i, env in enumerate(racer_envs):
                    history = pos_histories[i]
                    prev_p = prev_positions[i]
                    dr = float(prev_p[0] - (history[-2][0] if len(history) >= 2 else prev_p[0]))
                    dc = float(prev_p[1] - (history[-2][1] if len(history) >= 2 else prev_p[1]))
                    directions.append((dr, dc))

                class DummyObs:
                    def __init__(self, row, col, dr, dc):
                        self.row = row
                        self.col = col
                        self.dr = dr
                        self.dc = dc
                    @property
                    def pos(self):
                        return (self.row, self.col)

                placed_dyn_obs = []
                if tick.get("dynamic_obstacles") is not None:
                    half = size // 2
                    def api_to_idx(x: int, y: int) -> tuple:
                        return (half - y, x + half)

                    for idx, d_cart in enumerate(tick["dynamic_obstacles"]):
                        d_idx = api_to_idx(d_cart["x"], d_cart["y"])
                        dr, dc = 0.0, 0.0
                        if idx < len(prev_placed_dyn_obs):
                            prev_obs = prev_placed_dyn_obs[idx]
                            dr = float(d_idx[0] - prev_obs.row)
                            dc = float(d_idx[1] - prev_obs.col)
                        placed_dyn_obs.append(DummyObs(d_idx[0], d_idx[1], dr, dc))
                    
                    prev_placed_dyn_obs = list(placed_dyn_obs)

                # ─── Tüm Ajanlar Karar ve Adım Adımları ───
                step_results = []
                for i, env in enumerate(racer_envs):
                    # ─── YÖNTEM 2 KURALI: Her aracın diğerlerini ve hareketli engelleri dinamik engel görmesini sağla ───
                    # Diğer ajanların en güncel/kararlaştırılmış konumlarını dinamik engel olarak ekliyoruz.
                    dyn_obs = list(placed_dyn_obs)
                    for j in range(len(racer_envs)):
                        if i == j:
                            continue
                        
                        # Hedefe ulaşmış (başarıyla bitirmiş) ajanları bitiş çizgisindeyken engel olarak gösterme
                        curr_pos_j = racer_envs[j].agent_pos if j < i else prev_positions[j]
                        if racer_dones[j] and curr_pos_j == env.goal_pos:
                            continue
                        
                        # j < i ise yeni/güncel konumunu kullan, j > i ise eski konumunu kullan
                        if j < i:
                            pos_other = racer_envs[j].agent_pos
                            dr_other = float(pos_other[0] - prev_positions[j][0])
                            dc_other = float(pos_other[1] - prev_positions[j][1])
                        else:
                            pos_other = prev_positions[j]
                            dr_other, dc_other = directions[j]
                            
                        dyn_obs.append(DummyObs(pos_other[0], pos_other[1], dr_other, dc_other))
                    env.dynamic_obstacles = dyn_obs
                    model_obj = racer_models[i]
                    action = 4
                    q_vals = [0.0] * 4
                    done = racer_dones[i]
                    reached_goal = False
                    reward = 0.0
                    raw_action = None

                    if not done and not env.steps_taken >= env.max_steps:
                        m_type = model_obj["type"]
                        m_agent = model_obj["agent"]

                        if m_type == "PPO":
                            state = get_ppo_observation(env, view_radius=model_obj["view_radius"])
                            state_t = torch.FloatTensor(state).unsqueeze(0)
                            with torch.no_grad():
                                logits = m_agent.policy(state_t).squeeze(0).numpy()
                            action = int(np.argmax(logits))
                            q_vals = [float(x) for x in logits[:4]]

                            action_oh = [0.0]*5
                            action_oh[action] = 1.0
                            env.action_history.append(action_oh)

                            if action == 4:
                                env.steps_taken += 1
                                done = env.steps_taken >= env.max_steps
                                reward = -0.05
                                info = {"reached_goal": False}
                            else:
                                _, reward, done, info = env.step(action)
                            reached_goal = bool(info.get("reached_goal", False))
                            env.visit_map[env.agent_pos[0], env.agent_pos[1]] += 1.0

                        elif m_type == "SAC":
                            state = get_ppo_observation(env, view_radius=4)
                            q_values_arr = m_agent.get_q_values(state)
                            action = int(np.argmax(q_values_arr))
                            q_vals = [float(x) for x in q_values_arr[:4]]

                            action_oh = [0.0]*5
                            action_oh[action] = 1.0
                            env.action_history.append(action_oh)

                            if action == 4:
                                env.steps_taken += 1
                                done = env.steps_taken >= env.max_steps
                                reward = -0.05
                                info = {"reached_goal": False}
                            else:
                                _, reward, done, info = env.step(action)
                            reached_goal = bool(info.get("reached_goal", False))
                            env.visit_map[env.agent_pos[0], env.agent_pos[1]] += 1.0

                        elif m_type == "A3C":
                            if model_obj["state_size"] == 94:
                                state = get_a2c_v3_state(env, view_radius=7)
                                q = m_agent.get_q_values(state)
                                action = int(np.argmax(q))
                                q_vals = [float(x) for x in q]

                                _, reward, done, info = env.step(action)
                                reached_goal = bool(info.get("reached_goal", False))

                                if hasattr(env, "visit_map_a3c"):
                                    env.visit_map_a3c[env.agent_pos[0], env.agent_pos[1]] += 1
                                if hasattr(env, "action_history_a3c"):
                                    oh = [0.0]*4
                                    if 0 <= action < 4: oh[action] = 1.0
                                    env.action_history_a3c.append(oh)
                            else:
                                state = env._get_state()[:model_obj["state_size"]]
                                q = m_agent.get_q_values(state)
                                action = int(np.argmax(q))
                                q_vals = [float(x) for x in q]
                                _, reward, done, info = env.step(action)
                                reached_goal = bool(info.get("reached_goal", False))

                        elif m_type == "A2C":
                            state = get_a2c_observation(env)
                            q = m_agent.get_q_values(state)
                            action = int(np.argmax(q))
                            q_vals = [float(x) for x in q]
                            _, reward, done, info = env.step(action)
                            reached_goal = bool(info.get("reached_goal", False))

                        else: # DQN
                            state = env._get_state()[:model_obj["state_size"]]
                            q = m_agent.get_q_values(state)
                            action = int(np.argmax(q))
                            q_vals = [float(x) for x in q]
                            _, reward, done, info = env.step(action)
                            reached_goal = bool(info.get("reached_goal", False))

                        if done or reached_goal:
                            racer_dones[i] = True
                    else:
                        # Zaten pasif/elenmiş/bitirmiş
                        done = True

                    step_results.append({
                        "action": action,
                        "q_values": q_vals,
                        "reward": reward,
                        "done": done,
                        "reached_goal": reached_goal,
                        "pos": env.agent_pos
                    })

                # ─── Çoklu Araç Kaza / Çarpışma Denetimi (Çarpan Elensin Kuralı) ───
                collision = False
                hitter_indices = set()

                for a_idx in range(len(racer_envs)):
                    for b_idx in range(a_idx + 1, len(racer_envs)):
                        # Zaten kaza yapmış araçların tekrar çarpışmasını kontrol etmeye gerek yok
                        if racer_dones[a_idx] and racer_dones[b_idx]:
                            continue

                        pos_a = step_results[a_idx]["pos"]
                        pos_b = step_results[b_idx]["pos"]
                        
                        # Goal hücresinde çarpışma kontrolünü devre dışı bırakıyoruz (Finish çizgisi güvenli bölgedir)
                        goal_pos = racer_envs[a_idx].goal_pos
                        if pos_a == goal_pos or pos_b == goal_pos:
                            continue

                        prev_pos_a = prev_positions[a_idx]
                        prev_pos_b = prev_positions[b_idx]

                        # 1. Aynı hücreye girme (Grid Collision)
                        if pos_a == pos_b:
                            collision = True
                            
                            # Hangi araçlar hareket etti (çarpan kim?)
                            moved_a = prev_pos_a != pos_a
                            moved_b = prev_pos_b != pos_b

                            if moved_a and not moved_b:
                                hitter_indices.add(a_idx)
                            elif moved_b and not moved_a:
                                hitter_indices.add(b_idx)
                            else:
                                # İkisi birden hareket ettiyse (veya ikisi birden hareketsiz çakıştıysa) ikisi birden elenir
                                hitter_indices.add(a_idx)
                                hitter_indices.add(b_idx)

                        # 2. Yer değiştirme (Swap Collision)
                        elif prev_pos_a == pos_b and prev_pos_b == pos_a:
                            collision = True
                            hitter_indices.add(a_idx)
                            hitter_indices.add(b_idx)

                if collision:
                    print(f"[RACE COLLISION] Ajanlar çarpıştı! Elenen Çarpan Ajanlar: {hitter_indices}")
                    for idx in hitter_indices:
                        racer_dones[idx] = True
                        step_results[idx]["done"] = True
                        step_results[idx]["reward"] = -50.0

                # 3. Hareketli Engellere Çarpma Kontrolü (Swap ve Üzerine Gelme / Ezilme)
                for idx in range(len(racer_envs)):
                    if racer_dones[idx] or step_results[idx]["done"]:
                        continue

                    pos_racer = step_results[idx]["pos"]
                    
                    # Goal hücresinde hareketli engelle çarpışma kontrolünü devre dışı bırakıyoruz
                    goal_pos = racer_envs[idx].goal_pos
                    if pos_racer == goal_pos:
                        continue

                    prev_pos_racer = prev_positions[idx]

                    swap_hit = False
                    passive_hit = False

                    for o_idx, obs in enumerate(placed_dyn_obs):
                        # Swap Collision check
                        if o_idx < len(prev_placed_dyn_obs):
                            p_obs = prev_placed_dyn_obs[o_idx]
                            prev_obs_pos = (p_obs.row, p_obs.col)
                            new_obs_pos = (obs.row, obs.col)
                            if prev_pos_racer == new_obs_pos and pos_racer == prev_obs_pos:
                                swap_hit = True
                                break
                        
                        # Passive/Active overlap check
                        if pos_racer == (obs.row, obs.col):
                            passive_hit = True
                            break

                    if swap_hit or passive_hit:
                        print(f"[RACE DYN OBS COLLISION] Ajan {idx} hareketli engele çarptı! Swap: {swap_hit}, Passive: {passive_hit}")
                        collision = True
                        racer_dones[idx] = True
                        step_results[idx]["done"] = True
                        step_results[idx]["reward"] = -50.0

                # Konum geçmişini güncelle
                for i, env in enumerate(racer_envs):
                    pos_histories[i].append(env.agent_pos)

                # Frontend koordinatlarına dönüştür
                half = racer_envs[0].size // 2
                action_labels = {0: "LEFT", 1: "RIGHT", 2: "UP", 3: "DOWN", 4: "STAY"}

                response = {
                    "racers": [],
                    "collision": collision
                }

                for i, env in enumerate(racer_envs):
                    r_res = step_results[i]
                    r, c = r_res["pos"]
                    response["racers"].append({
                        "id": i,
                        "model_key": keys[i],
                        "action": int(r_res["action"]),
                        "action_label": action_labels.get(r_res["action"], "STAY"),
                        "q_values": r_res["q_values"],
                        "reward": round(float(r_res["reward"]), 2),
                        "done": bool(r_res["done"]),
                        "reached_goal": bool(r_res["reached_goal"]),
                        "agent_pos": {"x": int(c - half), "y": int(half - r)}
                    })

                # Compatibility fallbacks
                if len(racer_envs) >= 1:
                    response["racer1"] = response["racers"][0]
                if len(racer_envs) >= 2:
                    response["racer2"] = response["racers"][1]

                await ws.send_json(response)
            except Exception as proc_err:
                print(f"[RACE WS] İşlem hatası: {proc_err}")
                import traceback
                traceback.print_exc()
                try:
                    await ws.send_json({"error": f"İşlem hatası: {str(proc_err)}"})
                except:
                    break

    except WebSocketDisconnect:
        print(f"[RACE WS] İstemci ayrıldı: {ws.client}")


# ─── Başlatma ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,  # Production-ready: reload causes state management issues
        log_level="info",
    )
