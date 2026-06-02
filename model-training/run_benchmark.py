"""
İki PPO modelini kalkansız karşılaştırır.
Çalıştır: python run_benchmark.py
"""
import os, sys, math, random
from collections import deque
import numpy as np

backend_root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend")
sys.path.insert(0, backend_root)

from agent.ppo_agent import PPOAgent  # noqa


# ── Ortam ─────────────────────────────────────────────────────────────────────

class DynamicObstacle:
    def __init__(self, x, y, vx, vy, grid_size):
        self.x, self.y = float(x), float(y)
        self.vx, self.vy = float(vx), float(vy)
        self.grid_size = grid_size

    def step(self):
        self.x += self.vx; self.y += self.vy
        if self.x < 0:              self.x = -self.x;                    self.vx = abs(self.vx)
        elif self.x >= self.grid_size-1: self.x = 2*(self.grid_size-1)-self.x; self.vx = -abs(self.vx)
        if self.y < 0:              self.y = -self.y;                    self.vy = abs(self.vy)
        elif self.y >= self.grid_size-1: self.y = 2*(self.grid_size-1)-self.y; self.vy = -abs(self.vy)

    @property
    def grid_pos(self): return (int(round(self.x)), int(round(self.y)))
    def normalized_velocity(self, s=1.0): return (self.vx/s, self.vy/s)


class MapGenerator:
    def __init__(self, grid_size, n_static):
        self.grid_size = grid_size
        self.n_static = n_static

    def _has_path(self, s, g, obs):
        q = deque([s]); vis = {s}
        while q:
            cx, cy = q.popleft()
            if (cx, cy) == g: return True
            for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                nx, ny = cx+dx, cy+dy
                if 0<=nx<self.grid_size and 0<=ny<self.grid_size and (nx,ny) not in obs and (nx,ny) not in vis:
                    vis.add((nx,ny)); q.append((nx,ny))
        return False

    def generate(self):
        min_d = self.grid_size * 0.4
        for _ in range(300):
            cells = [(x,y) for x in range(self.grid_size) for y in range(self.grid_size)]
            random.shuffle(cells)
            obs = set(cells[:self.n_static])
            free = [c for c in cells if c not in obs]
            if len(free) < 2: continue
            random.shuffle(free)
            for i in range(min(40, len(free))):
                for j in range(i+1, min(41, len(free))):
                    s, g = free[i], free[j]
                    if math.hypot(s[0]-g[0], s[1]-g[1]) >= min_d and self._has_path(s, g, obs):
                        return obs, s, g
        return set(), (0,0), (self.grid_size-1, self.grid_size-1)


class BenchmarkEnv:
    def __init__(self, grid_size, n_static, n_dynamic, max_steps, view_radius):
        self.grid_size = grid_size; self.n_static = n_static
        self.n_dynamic = n_dynamic; self.max_steps = max_steps
        self.view_radius = view_radius
        self.map_gen = MapGenerator(grid_size, n_static)

    def reset(self):
        self.static_obs, self.agent_pos, self.goal_pos = self.map_gen.generate()
        self.dynamic_obs = []
        for _ in range(self.n_dynamic):
            for _ in range(100):
                dx, dy = random.randint(0,self.grid_size-1), random.randint(0,self.grid_size-1)
                if (dx,dy) not in self.static_obs and (dx,dy) != self.agent_pos and (dx,dy) != self.goal_pos:
                    speed = 0.5
                    if random.choice([True,False]): vx,vy = random.choice([-speed,speed]),0.0
                    else:                           vx,vy = 0.0, random.choice([-speed,speed])
                    self.dynamic_obs.append(DynamicObstacle(dx,dy,vx,vy,self.grid_size)); break
        self.visit_map = np.zeros((self.grid_size, self.grid_size), dtype=np.float32)
        self.visit_map[self.agent_pos[0], self.agent_pos[1]] = 1.0
        self.action_history = deque([[0.0]*5 for _ in range(8)], maxlen=8)
        self.steps = 0
        self.prev_dist = math.hypot(self.agent_pos[0]-self.goal_pos[0], self.agent_pos[1]-self.goal_pos[1])
        return self._obs()

    def step(self, action):
        self.steps += 1
        oh = [0.0]*5; oh[action] = 1.0; self.action_history.append(oh)
        for d in self.dynamic_obs: d.step()

        dx, dy = [(0,-1),(0,1),(-1,0),(1,0),(0,0)][action]
        nx, ny  = self.agent_pos[0]+dx, self.agent_pos[1]+dy
        terminated = truncated = is_success = False

        if action != 4:
            out  = not (0<=nx<self.grid_size and 0<=ny<self.grid_size)
            wall = (not out) and ((nx,ny) in self.static_obs)
            if out or wall:
                terminated = True
            else:
                self.agent_pos = (nx,ny); self.visit_map[nx,ny] += 1

        if not terminated:
            for d in self.dynamic_obs:
                if math.hypot(self.agent_pos[0]-d.x, self.agent_pos[1]-d.y) <= 0.8:
                    terminated = True; break

        if not terminated and self.agent_pos == self.goal_pos:
            terminated = True; is_success = True

        if not terminated and self.steps >= self.max_steps:
            truncated = True

        return self._obs(), terminated, truncated, is_success

    def _obs(self):
        obs = []
        dirs = [(0,-1),(1,-1),(1,0),(1,1),(0,1),(-1,1),(-1,0),(-1,-1)]
        dyn_dict = {d.grid_pos: d for d in self.dynamic_obs}
        for ddx, ddy in dirs:
            hit = [1.0, 0.0, 0.0, 0.0]
            for step in range(1, self.view_radius+1):
                rx = self.agent_pos[0]+ddx*step; ry = self.agent_pos[1]+ddy*step
                if rx<0 or rx>=self.grid_size or ry<0 or ry>=self.grid_size or (rx,ry) in self.static_obs:
                    hit = [step/self.view_radius, 1.0, 0.0, 0.0]; break
                if (rx,ry) in dyn_dict:
                    d = dyn_dict[(rx,ry)]; nvx,nvy = d.normalized_velocity(1.0)
                    hit = [step/self.view_radius, 0.5, nvx, nvy]; break
            obs.extend(hit)
        dx = (self.goal_pos[0]-self.agent_pos[0])/self.grid_size
        dy = (self.goal_pos[1]-self.agent_pos[1])/self.grid_size
        dn = math.hypot(dx,dy)/math.sqrt(2); a = math.atan2(dy,dx)
        obs.extend([dx, dy, dn, math.sin(a), math.cos(a)])
        mv = max(1.0, float(np.max(self.visit_map)))
        for ddy in range(-2,3):
            for ddx in range(-2,3):
                px,py = self.agent_pos[0]+ddx, self.agent_pos[1]+ddy
                obs.append(self.visit_map[px,py]/mv if 0<=px<self.grid_size and 0<=py<self.grid_size else 1.0)
        for a in self.action_history: obs.extend(a)
        return np.array(obs, dtype=np.float32)


# ── Benchmark Koşusu ──────────────────────────────────────────────────────────

def run(model_key, view_radius, grid_cfg, n_episodes, seed_base):
    model_path = os.path.join(backend_root, "models", model_key)
    agent = PPOAgent(state_size=102, action_size=5)
    agent.load(model_path)

    env = BenchmarkEnv(**grid_cfg, view_radius=view_radius)
    success = collision = timeout = 0

    for ep in range(n_episodes):
        random.seed(seed_base + ep); np.random.seed(seed_base + ep)
        obs = env.reset(); done = False
        while not done:
            action = agent.act(obs)
            obs, term, trunc, ok = env.step(action)
            done = term or trunc
        if ok:       success   += 1
        elif trunc:  timeout   += 1
        else:        collision += 1

    return {
        "success":   success,
        "collision": collision,
        "timeout":   timeout,
        "success_pct":   round(success   / n_episodes * 100, 1),
        "collision_pct": round(collision / n_episodes * 100, 1),
        "timeout_pct":   round(timeout   / n_episodes * 100, 1),
    }


# ── Ana Akış ──────────────────────────────────────────────────────────────────

MODELS = [
    ("ppo_stage_4_hardcore", 7, "PPO Stage 4 Hardcore"),
    ("ppo_hardcore_v2",      5, "PPO Hardcore v2     "),
]

GRIDS = [
    {"grid_size": 15, "n_static": 12, "n_dynamic": 4,  "max_steps": 250, "label": "15x15  (Standart)"},
    {"grid_size": 20, "n_static": 25, "n_dynamic": 6,  "label": "20x20  (Orta)   ", "max_steps": 350},
    {"grid_size": 22, "n_static": 35, "n_dynamic": 8,  "label": "22x22  (Ekstrem)", "max_steps": 400},
]

N_EPISODES = 200
SEED = 42

if __name__ == "__main__":
    print(f"\n{'='*62}")
    print(f"  KALKAN SIZ BENCHMARK  —  {N_EPISODES} bölüm / grid  |  seed={SEED}")
    print(f"{'='*62}\n")

    all_results = {}

    for gcfg in GRIDS:
        label = gcfg.pop("label")
        print(f"  Grid: {label}")
        print(f"  {'-'*55}")
        grid_res = {}

        for model_key, vr, model_label in MODELS:
            r = run(model_key, vr, gcfg.copy(), N_EPISODES, SEED)
            grid_res[model_label.strip()] = r
            print(f"  {model_label}  "
                  f"Başarı: %{r['success_pct']:5.1f}  |  "
                  f"Çarpışma: %{r['collision_pct']:5.1f}  |  "
                  f"Timeout: %{r['timeout_pct']:5.1f}")

        gcfg["label"] = label
        all_results[label.strip()] = grid_res
        winner = max(grid_res, key=lambda k: grid_res[k]["success_pct"])
        print(f"\n  Kazanan → {winner}  (%{grid_res[winner]['success_pct']:.1f})\n")

    # Genel özet
    print(f"{'='*62}")
    print("  GENEL ÖZET")
    print(f"{'='*62}")
    totals = {ml.strip(): 0 for _, _, ml in MODELS}
    for gcfg in GRIDS:
        lbl = gcfg["label"].strip()
        for _, _, ml in MODELS:
            key = ml.strip()
            totals[key] += all_results[lbl][key]["success_pct"]

    for key, total in totals.items():
        avg = total / len(GRIDS)
        print(f"  {key:<25}  Ortalama başarı: %{avg:.1f}")

    overall = max(totals, key=totals.get)
    print(f"\n  GENEL KAZANAN → {overall}")
    print(f"{'='*62}\n")
