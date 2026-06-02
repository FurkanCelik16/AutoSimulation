import os
import sys
import math
import random
import time
import zipfile
from collections import deque
import numpy as np
import torch
import gymnasium as gym

# Add project and backend root to path
project_root = os.path.dirname(os.path.abspath(__file__))
backend_root = os.path.join(os.path.dirname(project_root), "backend")
sys.path.insert(0, backend_root)

# Import authentic environment and agents
from environment.grid_env import GridEnvironment, DELTA
from agent.ppo_agent import PPOAgent
from agent.dql_agent import DQLAgent
from agent.a3c_agent import A3CAgent
from agent.a2c_agent import A2CAgent

# ==============================================================================
# 1. GELİŞMİŞ VE ÇEŞİTLİ MAP GENERATOR (V4 STANDARDINDA)
# ==============================================================================
class MapGenerator:
    def __init__(self, grid_size, n_static, map_types=None):
        self.grid_size = grid_size
        self.n_static = n_static
        self.map_types = map_types if map_types is not None else ["random"]

    def has_path(self, start, goal, static_obstacles):
        """BFS kullanarak başlangıç ve hedef arasında bir yol olduğunu doğrular."""
        queue = deque([start])
        visited = {start}
        while queue:
            curr = queue.popleft()
            if curr == goal:
                return True
            for dx, dy in [(0,1), (0,-1), (1,0), (-1,0)]:
                nx, ny = curr[0] + dx, curr[1] + dy
                if 0 <= nx < self.grid_size and 0 <= ny < self.grid_size:
                    if (nx, ny) not in static_obstacles and (nx, ny) not in visited:
                        visited.add((nx, ny))
                        queue.append((nx, ny))
        return False

    def generate(self, map_type=None):
        """İstenilen şablona göre engel haritası üretir."""
        if map_type is None:
            map_type = random.choice(self.map_types)

        static_obs = set()
        
        # Grid çok küçükse veya tip "random" ise klasik dağınık engeller
        if map_type == "random" or self.grid_size < 8:
            while len(static_obs) < self.n_static:
                static_obs.add((random.randint(0, self.grid_size-1), random.randint(0, self.grid_size-1)))
            return static_obs, "random"

        elif map_type == "h_wall":
            # Gaps (Boşluklar) barındıran yatay bir duvar
            r = random.randint(3, self.grid_size - 4)
            num_gaps = max(1, min(2, self.grid_size // 6))
            gaps = random.sample(range(self.grid_size), k=num_gaps)
            for c in range(self.grid_size):
                if c not in gaps:
                    static_obs.add((r, c))
            # Kalan bütçe kadar dağınık engel ekle
            while len(static_obs) < self.n_static:
                static_obs.add((random.randint(0, self.grid_size-1), random.randint(0, self.grid_size-1)))
            return static_obs, "h_wall"

        elif map_type == "v_wall":
            # Gaps barındıran dikey bir duvar
            c = random.randint(3, self.grid_size - 4)
            num_gaps = max(1, min(2, self.grid_size // 6))
            gaps = random.sample(range(self.grid_size), k=num_gaps)
            for r in range(self.grid_size):
                if r not in gaps:
                    static_obs.add((r, c))
            while len(static_obs) < self.n_static:
                static_obs.add((random.randint(0, self.grid_size-1), random.randint(0, self.grid_size-1)))
            return static_obs, "v_wall"

        elif map_type == "corridor":
            # İki paralel duvar arası dar koridor
            is_horizontal = random.choice([True, False])
            if is_horizontal:
                r1 = random.randint(2, self.grid_size // 2 - 1)
                r2 = random.randint(self.grid_size // 2 + 1, self.grid_size - 3)
                gap1 = random.randint(1, self.grid_size - 2)
                gap2 = random.randint(1, self.grid_size - 2)
                for c in range(self.grid_size):
                    if c != gap1: static_obs.add((r1, c))
                    if c != gap2: static_obs.add((r2, c))
            else:
                c1 = random.randint(2, self.grid_size // 2 - 1)
                c2 = random.randint(self.grid_size // 2 + 1, self.grid_size - 3)
                gap1 = random.randint(1, self.grid_size - 2)
                gap2 = random.randint(1, self.grid_size - 2)
                for r in range(self.grid_size):
                    if r != gap1: static_obs.add((r, c1))
                    if r != gap2: static_obs.add((r, c2))
            while len(static_obs) < self.n_static:
                static_obs.add((random.randint(0, self.grid_size-1), random.randint(0, self.grid_size-1)))
            return static_obs, "corridor"

        elif map_type == "L_shape":
            # L şeklinde köşeli duvar engeli
            r = random.randint(3, self.grid_size - 4)
            c = random.randint(3, self.grid_size - 4)
            gap_h = random.randint(1, self.grid_size - 2)
            gap_v = random.randint(1, self.grid_size - 2)
            for col in range(self.grid_size):
                if col != gap_h: static_obs.add((r, col))
            for row in range(self.grid_size):
                if row != gap_v: static_obs.add((row, c))
            while len(static_obs) < self.n_static:
                static_obs.add((random.randint(0, self.grid_size-1), random.randint(0, self.grid_size-1)))
            return static_obs, "L_shape"

        elif map_type == "maze":
            # Basit grid labirent yapısı
            for r in range(0, self.grid_size, 2):
                gaps = random.sample(range(self.grid_size), k=max(1, self.grid_size // 4))
                for col in range(self.grid_size):
                    if col not in gaps:
                        static_obs.add((r, col))
            if len(static_obs) > self.n_static * 1.3:
                static_obs = set(random.sample(list(static_obs), k=int(self.n_static * 1.1)))
            return static_obs, "maze"

        elif map_type == "U_shape":
            # U şeklinde engel (çukur engeli)
            orientation = random.choice(["up", "down", "left", "right"])
            r = random.randint(3, self.grid_size - 5)
            c = random.randint(3, self.grid_size - 5)
            length = random.randint(3, 5) # U'nun taban uzunluğu
            depth = random.randint(2, 4)  # U'nun kollarının derinliği
            
            if orientation == "up":
                for col in range(c, min(c + length, self.grid_size)):
                    static_obs.add((r, col))
                for row in range(max(0, r - depth), r):
                    static_obs.add((row, c))
                    static_obs.add((row, min(c + length - 1, self.grid_size - 1)))
            elif orientation == "down":
                for col in range(c, min(c + length, self.grid_size)):
                    static_obs.add((r, col))
                for row in range(r + 1, min(r + 1 + depth, self.grid_size)):
                    static_obs.add((row, c))
                    static_obs.add((row, min(c + length - 1, self.grid_size - 1)))
            elif orientation == "left":
                for row in range(r, min(r + length, self.grid_size)):
                    static_obs.add((row, c))
                for col in range(max(0, c - depth), c):
                    static_obs.add((r, col))
                    static_obs.add((min(r + length - 1, self.grid_size - 1), col))
            elif orientation == "right":
                for row in range(r, min(r + length, self.grid_size)):
                    static_obs.add((row, c))
                for col in range(c + 1, min(c + 1 + depth, self.grid_size)):
                    static_obs.add((r, col))
                    static_obs.add((min(r + length - 1, self.grid_size - 1), col))
            while len(static_obs) < self.n_static:
                static_obs.add((random.randint(0, self.grid_size-1), random.randint(0, self.grid_size-1)))
            return static_obs, "U_shape"

        else:
            while len(static_obs) < self.n_static:
                static_obs.add((random.randint(0, self.grid_size-1), random.randint(0, self.grid_size-1)))
            return static_obs, "random"

    def get_start_and_goal(self, static_obstacles):
        """%100 çözülebilir bir başlangıç ve hedef ikilisi seçer."""
        attempts = 0
        while True:
            attempts += 1
            s = (random.randint(0, self.grid_size-1), random.randint(0, self.grid_size-1))
            g = (random.randint(0, self.grid_size-1), random.randint(0, self.grid_size-1))
            if s not in static_obstacles and g not in static_obstacles and s != g:
                if math.hypot(s[0]-g[0], s[1]-g[1]) > self.grid_size * 0.4:
                    if self.has_path(s, g, static_obstacles):
                        return s, g
            if attempts > 60:
                # Haritada sıkışma olursa engelleri temizle ve rastgele serpiştirerek garantile
                static_obstacles.clear()
                while len(static_obstacles) < self.n_static:
                    static_obstacles.add((random.randint(0, self.grid_size-1), random.randint(0, self.grid_size-1)))
                attempts = 0

# ==============================================================================
# 2. STATE EXTRACTION CONVERTERS (PRODUCTION VE BİLİMSEL OLARAK %100 UYUMLU)
# ==============================================================================
def get_ppo_observation(env, view_radius=4):
    if not hasattr(env, "visit_map"):
        env.visit_map = np.zeros((env.size, env.size), dtype=np.float32)
        env.visit_map[env.agent_pos[0], env.agent_pos[1]] += 1.0
        
    if not hasattr(env, "action_history"):
        env.action_history = deque([[0.0]*5 for _ in range(8)], maxlen=8)

    obs = []
    dirs = [(0,-1), (1,-1), (1,0), (1,1), (0,1), (-1,1), (-1,0), (-1,-1)]
    
    static_obs = set()
    for r in range(env.size):
        for c in range(env.size):
            if env.grid[r, c] == 1:
                static_obs.add((r, c))

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
            vx_scaled = 0.5 if self.vx > 0 else (-0.5 if self.vx < 0 else 0.0)
            vy_scaled = 0.5 if self.vy > 0 else (-0.5 if self.vy < 0 else 0.0)
            return (vx_scaled, vy_scaled)

    ppo_dyn_obs = []
    for o in env.dynamic_obstacles:
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

    delta_x = (env.goal_pos[0] - env.agent_pos[0]) / env.size
    delta_y = (env.goal_pos[1] - env.agent_pos[1]) / env.size
    dist_norm = math.hypot(delta_x, delta_y) / math.sqrt(2)
    angle = math.atan2(delta_y, delta_x)
    obs.extend([delta_x, delta_y, dist_norm, math.sin(angle), math.cos(angle)])

    max_vis = max(1.0, np.max(env.visit_map))
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            px, py = env.agent_pos[0]+dx, env.agent_pos[1]+dy
            if 0 <= px < env.size and 0 <= py < env.size:
                obs.append(env.visit_map[px, py] / max_vis)
            else:
                obs.append(1.0)

    for act_arr in env.action_history:
        obs.extend(act_arr)

    return np.array(obs, dtype=np.float32)

def get_a3c_v3_state(env, view_radius=7):
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
    dist_n = math.hypot(dx_g, dy_g) / math.sqrt(2)
    angle = math.atan2(dy_g, dx_g)
    obs.extend([dx_g, dy_g, dist_n, math.sin(angle), math.cos(angle)])

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
    size = env.size
    agent_x = env.agent_pos[1]
    agent_y = size - 1 - env.agent_pos[0]
    goal_x = env.goal_pos[1]
    goal_y = size - 1 - env.goal_pos[0]
    
    dx = (goal_x - agent_x) / 20.0
    dy = (goal_y - agent_y) / 20.0
    goal_vec = np.array([dx, dy], dtype=np.float32)
    
    ego_grid = np.zeros((5, 5, 3), dtype=np.float32)
    
    dyn_positions_dict = {}
    if hasattr(env, "dynamic_obstacles") and env.dynamic_obstacles:
        for obs in env.dynamic_obstacles:
            obs_x = obs.col
            obs_y = size - 1 - obs.row
            vx = float(obs.dc)
            vy = -float(obs.dr)
            dyn_positions_dict[(obs_x, obs_y)] = (vx, vy)
            
    for r_idx, dy_rel in enumerate(range(2, -3, -1)):
        for c_idx, dx_rel in enumerate(range(-2, 3)):
            if abs(dx_rel) + abs(dy_rel) > 2:
                continue
                
            target_x = agent_x + dx_rel
            target_y = agent_y + dy_rel
            
            target_row = size - 1 - target_y
            target_col = target_x
            
            is_out_of_bounds = (target_row < 0 or target_row >= size or target_col < 0 or target_col >= size)
            if is_out_of_bounds or (not is_out_of_bounds and env.grid[target_row, target_col] == 1):
                ego_grid[r_idx, c_idx, 0] = 1.0
                
            if (target_x, target_y) in dyn_positions_dict:
                ego_grid[r_idx, c_idx, 1] = 1.0
                vx, vy = dyn_positions_dict[(target_x, target_y)]
                ego_grid[r_idx, c_idx, 2] = (vx + vy) / 2.0
                
    flat_ego = ego_grid.flatten()
    observation = np.concatenate([goal_vec, flat_ego]).astype(np.float32)
    return observation

def get_model_view_radius(model_path: str) -> int:
    lower_path = model_path.lower()
    if any(x in lower_path for x in ["kalkansiz", "hardcore_v2"]):
        return 5
    elif any(x in lower_path for x in ["radius3", "radius_3", "_r3", "sweetspot3"]):
        return 3
    elif any(x in lower_path for x in ["radius4", "radius_4", "_r4", "sweetspot"]):
        return 4
    elif any(x in lower_path for x in ["radius5", "radius_5", "_r5", "sweetspot5"]):
        return 5
    elif any(x in lower_path for x in ["radius6", "radius_6", "_r6", "sweetspot6"]):
        return 6
    return 7

# ==============================================================================
# 3. BENCHMARK EXECUTION UNIT
# ==============================================================================
def run_benchmark(model_key, env, map_gen, num_episodes=50):
    model_path = os.path.join(backend_root, "models", model_key)
    
    # Pre-determine model specs
    is_dql = model_key.endswith(".pth")
    is_a2c = "a2c" in model_key.lower()
    
    # Load model and cache it
    print(f"\n📦 Loading agent for model: {model_key}...")
    if is_a2c:
        agent = A2CAgent(model_path)
        view_radius = 7
    elif is_dql:
        checkpoint = torch.load(model_path, map_location='cpu', weights_only=False)
        cfg = checkpoint.get("config", {})
        state_size = cfg.get("state_size", 16)
        action_size = cfg.get("action_size", 4)
        hidden_size = cfg.get("hidden_size", 256)
        
        if "a3c" in model_key.lower():
            agent = A3CAgent(state_size=state_size, action_size=action_size, hidden_size=hidden_size)
            if "network_state" in checkpoint:
                agent.network.load_state_dict(checkpoint["network_state"])
            else:
                agent.network.load_state_dict(checkpoint)
            view_radius = 7
        else:
            agent = DQLAgent(state_size=state_size, action_size=action_size, hidden_size=hidden_size)
            agent.load(model_path)
            view_radius = 7
    else:
        # PPO Agent
        agent = PPOAgent(state_size=102, action_size=5)
        agent.load(model_path)
        view_radius = get_model_view_radius(model_path)
        
    print(f"🚀 Benchmarking {model_key} over {num_episodes} diverse episodes... (View Radius: {view_radius})")

    success_count = 0
    total_steps = 0
    total_reward = 0
    collisions = 0
    timeouts = 0

    map_types = ["random", "h_wall", "v_wall", "corridor", "L_shape", "maze", "U_shape"]

    for ep in range(num_episodes):
        # 100% Identical seeds and map shapes per episode index!
        random.seed(9999 + ep)
        np.random.seed(9999 + ep)
        
        map_type = map_types[ep % len(map_types)]
        static_obs, _ = map_gen.generate(map_type=map_type)
        start, goal = map_gen.get_start_and_goal(static_obs)

        # Build 2D numpy grid
        grid = np.zeros((env.size, env.size), dtype=np.int8)
        for r, c in static_obs:
            grid[r, c] = 1

        # Reset environment cleanly
        env.reset(grid_data=grid, start=start, goal=goal)

        # Clear agent-specific histories
        if hasattr(env, "visit_map"):
            delattr(env, "visit_map")
        if hasattr(env, "action_history"):
            delattr(env, "action_history")
        if hasattr(env, "visit_map_a3c"):
            delattr(env, "visit_map_a3c")
        if hasattr(env, "action_history_a3c"):
            delattr(env, "action_history_a3c")

        done = False
        ep_reward = 0.0
        ep_steps = 0

        # Lazy init visit tracking to match main.py
        if is_a2c:
            pass
        elif is_dql:
            if "a3c" in model_key.lower():
                env.visit_map_a3c = np.zeros((env.size, env.size), dtype=np.float32)
                env.visit_map_a3c[env.agent_pos[0], env.agent_pos[1]] = 1.0
                env.action_history_a3c = deque([[0.0]*4 for _ in range(8)], maxlen=8)
        else:
            env.visit_map = np.zeros((env.size, env.size), dtype=np.float32)
            env.visit_map[env.agent_pos[0], env.agent_pos[1]] += 1.0
            env.action_history = deque([[0.0]*5 for _ in range(8)], maxlen=8)

        pos_history = deque(maxlen=10)

        while not done:
            prev_agent_pos = (env.agent_pos[0], env.agent_pos[1])

            # Get state
            if is_a2c:
                state = get_a2c_observation(env)
            elif is_dql:
                if "a3c" in model_key.lower():
                    state = get_a3c_v3_state(env, view_radius=view_radius)
                else:
                    state = env._get_state()[:agent.state_size]
            else:
                state = get_ppo_observation(env, view_radius=view_radius)

            # Predict action
            if is_a2c:
                q_vals = agent.get_q_values(state)
                action_idx = int(np.argmax(q_vals))
            elif is_dql:
                if "a3c" in model_key.lower():
                    q_vals = agent.get_q_values(state)
                    action_idx = int(np.argmax(q_vals))
                else:
                    # DQN
                    q_vals = agent.get_q_values(state)
                    action_idx = agent.select_action(state, training=False)
            else:
                # PPO
                action_idx = agent.act(state)

            # Move dynamic obstacles before checking agent step (same as simulated environment tick)
            env._move_dynamic_obstacles()

            # Map actions and step in environment
            if is_a2c or is_dql:
                # DQN/A3C/A2C use native GridEnvironment actions directly
                # 0=LEFT, 1=RIGHT, 2=UP, 3=DOWN
                next_state, reward, done, info = env.step(action_idx)
                
                # Update visitation
                if "a3c" in model_key.lower():
                    env.visit_map_a3c[env.agent_pos[0], env.agent_pos[1]] += 1
                    oh = [0.0]*4
                    oh[action_idx] = 1.0
                    env.action_history_a3c.append(oh)
            else:
                # PPO Action mapping (disabled to match production FastAPI directly)
                if action_idx == 4:
                    # STAY
                    reward = -0.05
                    env.steps_taken += 1
                    done = env.steps_taken >= env.max_steps
                    info = {"reached_goal": False, "status": "ok", "steps": env.steps_taken}
                else:
                    # Pass directly matching main.py production unmapped API
                    next_state, reward, done, info = env.step(action_idx)
                
                # Update PPO visitation and history
                env.visit_map[env.agent_pos[0], env.agent_pos[1]] += 1.0
                action_oh = [0.0]*5
                action_oh[action_idx] = 1.0
                env.action_history.append(action_oh)

            # Dynamic swap-collision check (crucial for safety metric)
            swap_hit = False
            new_agent_pos = (env.agent_pos[0], env.agent_pos[1])
            if not done and hasattr(env, "prev_dynamic_obstacles") and env.prev_dynamic_obstacles:
                for idx, obs in enumerate(env.dynamic_obstacles):
                    if idx < len(env.prev_dynamic_obstacles):
                        prev_obs = env.prev_dynamic_obstacles[idx]
                        if prev_agent_pos == (obs.row, obs.col) and new_agent_pos == (prev_obs.row, prev_obs.col):
                            swap_hit = True
                            done = True
                            reward = -50.0
                            info = {"reached_goal": False, "status": "hit_obstacle", "steps": env.steps_taken}
                            break

            # Passive hit check (obstacle stepped onto agent)
            if not done and env._is_dynamic_obstacle(env.agent_pos[0], env.agent_pos[1]):
                done = True
                reward = -50.0
                info = {"reached_goal": False, "status": "hit_obstacle", "steps": env.steps_taken}

            ep_reward += reward
            ep_steps += 1
            pos_history.append(new_agent_pos)

        # Record metrics
        if info.get("reached_goal", False):
            success_count += 1
        elif info.get("status") == "hit_obstacle" or info.get("status") == "out_of_bounds":
            collisions += 1
        else:
            timeouts += 1

        total_steps += ep_steps
        total_reward += ep_reward

    success_rate = (success_count / num_episodes) * 100
    avg_steps = total_steps / num_episodes
    avg_reward = total_reward / num_episodes
    collision_rate = (collisions / num_episodes) * 100
    timeout_rate = (timeouts / num_episodes) * 100

    return {
        "success_rate": success_rate,
        "avg_steps": avg_steps,
        "avg_reward": avg_reward,
        "collision_rate": collision_rate,
        "timeout_rate": timeout_rate,
        "success_count": success_count,
        "collisions": collisions,
        "timeouts": timeouts
    }

# ==============================================================================
# 4. BENCHMARK ORCHESTRATION & RESULTS DISPLAY
# ==============================================================================
if __name__ == "__main__":
    MODELS = [
        ("ppo_sweetspot_v4",  "PPO Sweet Spot v4"),
        ("ppo_hardcore_v2",   "PPO Hardcore v2"),
        ("best_model_v4.pth", "DQN v4"),
        ("a2c_v3.pth",        "A2C v3"),
        ("a2c",               "A2C v2"),
    ]

    GRIDS = [
        {"grid_size": 15, "n_static": 12, "n_dynamic": 4,  "max_steps": 250, "label": "15x15 (Standart)"},
        {"grid_size": 21, "n_static": 28, "n_dynamic": 8,  "max_steps": 350, "label": "21x21 (Orta)"},
    ]

    EPISODES_PER_TEST = 50  # Rigorous evaluation
    all_results = {}

    for g in GRIDS:
        # Create generator
        map_gen = MapGenerator(grid_size=g["grid_size"], n_static=g["n_static"])
        
        # Instantiate actual production GridEnvironment
        env = GridEnvironment(
            size=g["grid_size"],
            obstacle_ratio=0.15, 
            max_steps=g["max_steps"],
            random_maps=False,
            dynamic_obstacle_count=g["n_dynamic"],
            state_size=16 
        )
        
        print(f"\n{'🔥'*20}")
        print(f"  GRID: {g['label']}  |  Statik: {g['n_static']}  |  Dinamik: {g['n_dynamic']}")
        print(f"{'🔥'*20}")

        grid_results = {}
        for model_key, model_label in MODELS:
            try:
                r = run_benchmark(model_key, env, map_gen, num_episodes=EPISODES_PER_TEST)
                grid_results[model_label] = r
            except Exception as e:
                print(f"❌ Error benchmarking model '{model_key}': {e}")
                import traceback
                traceback.print_exc()
        all_results[g["label"]] = grid_results

    # ─── Display Detailed Results Tables ──────────────────────────────────────
    col_w = 22
    header_labels = [ml for _, ml in MODELS if ml in next(iter(all_results.values()))]
    table_w = 25 + 3 + (col_w + 3) * len(header_labels)

    for grid_label, grid_results in all_results.items():
        print(f"\n{'='*table_w}")
        print(f"📊  {grid_label}  —  {EPISODES_PER_TEST} Identical Diverse Maps (Corridors, Walls, L-Shapes, Mazes)")
        print(f"{'='*table_w}")
        hdr = f"{'Metric':<25} | " + " | ".join(f"{h:<{col_w}}" for h in header_labels)
        print(hdr)
        print("-" * table_w)

        rows = [
            ("Success Rate %",  "success_rate"),
            ("Collision Rate %","collision_rate"),
            ("Timeout Rate %",  "timeout_rate"),
            ("Avg Steps",       "avg_steps"),
            ("Avg Reward",      "avg_reward"),
        ]
        for label, key in rows:
            vals = []
            for ml in header_labels:
                v = grid_results[ml][key]
                if "rate" in key.lower():
                    vals.append(f"%{v:<{col_w-1}.1f}")
                else:
                    vals.append(f"{v:<{col_w}.1f}")
            print(f"{label:<25} | " + " | ".join(vals))
        print("=" * table_w)

        winner = max(header_labels, key=lambda k: grid_results[k]["success_rate"])
        print(f"🏆 {grid_label} Şampiyonu: {winner} — %{grid_results[winner]['success_rate']:.1f}")

    # ─── Overall Summary Table ────────────────────────────────────────────────
    print(f"\n\n{'🏁'*30}")
    print("📊  GENEL ÖZET  —  TÜM GRİD BOYUTLARINDA BAŞARI ORANLARI")
    print(f"{'🏁'*30}")
    summary_hdr = f"{'Model':<25} | " + " | ".join(f"{g['label']:<{col_w}}" for g in GRIDS)
    print(summary_hdr)
    print("-" * (25 + 3 + (col_w + 3) * len(GRIDS)))
    for ml in header_labels:
        vals = []
        for g in GRIDS:
            sr = all_results[g["label"]][ml]["success_rate"]
            vals.append(f"%{sr:<{col_w-1}.1f}")
        print(f"{ml:<25} | " + " | ".join(vals))
    print("=" * (25 + 3 + (col_w + 3) * len(GRIDS)))

    # Overall Champion
    avg_scores = {}
    for ml in header_labels:
        total = sum(all_results[g["label"]][ml]["success_rate"] for g in GRIDS)
        avg_scores[ml] = total / len(GRIDS)
    overall_winner = max(avg_scores, key=avg_scores.get)
    print(f"\n🏆🏆🏆 GENEL ŞAMPİYON: {overall_winner} — Ortalama %{avg_scores[overall_winner]:.1f} başarı oranı!")
    print("=" * (25 + 3 + (col_w + 3) * len(GRIDS)))
