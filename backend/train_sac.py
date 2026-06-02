import os
import sys
import numpy as np
import gymnasium as gym
from gymnasium import spaces

from environment import GridEnvironment
import math
from collections import deque

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
    
    # Statik engelleri row, col formatında set yapalım
    static_obs = set()
    for r in range(env.size):
        for c in range(env.size):
            if env.grid[r, c] == 1:
                static_obs.add((r, c))

    # Dinamik engelleri tanımla
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
    for o in getattr(env, 'dynamic_obstacles', []):
        ppo_dyn_obs.append(PPODynObs(getattr(o, 'row', 0), getattr(o, 'col', 0), getattr(o, 'dr', 0.0), getattr(o, 'dc', 0.0)))

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

    # 2. Hedefe Kalan Mesafe ve Açı
    delta_x = (env.goal_pos[0] - env.agent_pos[0]) / env.size
    delta_y = (env.goal_pos[1] - env.agent_pos[1]) / env.size
    dist_norm = math.hypot(delta_x, delta_y) / math.sqrt(2)
    angle = math.atan2(delta_y, delta_x)
    obs.extend([delta_x, delta_y, dist_norm, math.sin(angle), math.cos(angle)])

    # 3. Ziyaret Haritası
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

class SACEnvWrapper(gym.Env):
    """
    Wraps the AutoSimulation GridEnvironment to make it compatible with stable_baselines3 SAC.
    """
    def __init__(self, size=15, obstacle_ratio=0.15, max_steps=500):
        super(SACEnvWrapper, self).__init__()
        
        # SAC requires continuous action spaces
        self.action_space = spaces.Box(low=-1.0, high=1.0, shape=(2,), dtype=np.float32)
        
        # We use the 102-element observation space defined for PPO
        self.observation_space = spaces.Box(low=-float('inf'), high=float('inf'), shape=(102,), dtype=np.float32)
        
        self.env = GridEnvironment(
            size=size,
            obstacle_ratio=obstacle_ratio,
            max_steps=max_steps,
            random_maps=True,
            state_size=102
        )
        
        self.PPO_VIEW_RADIUS = 7
        
    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        self.env.reset()
        
        # Reset internal variables required by get_ppo_observation
        if hasattr(self.env, "visit_map"):
            delattr(self.env, "visit_map")
        if hasattr(self.env, "action_history"):
            delattr(self.env, "action_history")
            
        obs = get_ppo_observation(self.env, view_radius=self.PPO_VIEW_RADIUS)
        return obs, {}
        
    def step(self, action_continuous):
        x, y = action_continuous[0], action_continuous[1]
        
        # Convert continuous action to discrete [0, 1, 2, 3, 4]
        q = np.zeros(5, dtype=np.float32)
        q[0] = max(0, -x)  # LEFT
        q[1] = max(0, x)   # RIGHT
        q[2] = max(0, -y)  # UP
        q[3] = max(0, y)   # DOWN
        q[4] = max(0, 0.3 - (abs(x) + abs(y)))  # STAY
        
        discrete_action = int(np.argmax(q))
        
        # Update action history before getting observation
        action_oh = [0.0]*5
        action_oh[discrete_action] = 1.0
        if not hasattr(self.env, "action_history"):
            from collections import deque
            self.env.action_history = deque([[0.0]*5 for _ in range(8)], maxlen=8)
        self.env.action_history.append(action_oh)
        
        # Step environment
        if discrete_action == 4:
            # STAY action logic (same as main.py)
            reward = -0.05
            self.env.steps_taken += 1
            done = self.env.steps_taken >= self.env.max_steps
            info = {"reached_goal": False, "steps": self.env.steps_taken}
        else:
            _, reward, done, info = self.env.step(discrete_action)
            
        # Get next observation
        obs = get_ppo_observation(self.env, view_radius=self.PPO_VIEW_RADIUS)
        
        # Stable Baselines 3 API expects truncated as well
        truncated = False
        if info.get("status") == "max_steps_reached":
            truncated = True
            done = False
            
        return obs, reward, done, truncated, info

def make_env(rank, seed=0):
    """
    Utility function for multiprocessed env.
    """
    def _init():
        env = SACEnvWrapper()
        env.reset(seed=seed + rank)
        return env
    return _init

def main():
    try:
        from stable_baselines3 import SAC
        from stable_baselines3.common.callbacks import CheckpointCallback
        from stable_baselines3.common.vec_env import SubprocVecEnv
    except ImportError:
        print("stable-baselines3 kütüphanesi eksik! Lütfen 'pip install stable-baselines3' komutunu çalıştırın.")
        sys.exit(1)

    print("Initializing vectorized environments (16 Parallel Games)...")
    num_cpu = 16  # İşlemcinizin çekirdeklerini kullanarak 16 oyunu paralel başlatır
    env = SubprocVecEnv([make_env(i) for i in range(num_cpu)])
    
    # Create models directory if it doesn't exist
    models_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
    os.makedirs(models_dir, exist_ok=True)
    
    checkpoint_callback = CheckpointCallback(
        save_freq=50000,
        save_path=os.path.join(models_dir, 'sac_checkpoints'),
        name_prefix='sac_model'
    )
    
    print("Initializing SAC model on GPU...")
    model = SAC(
        "MlpPolicy",
        env,
        verbose=1,
        learning_rate=3e-4,
        buffer_size=100000,
        batch_size=256,
        ent_coef='auto',
        gamma=0.99,
        tau=0.005,
        tensorboard_log="./sac_tensorboard/",
        device="cuda"
    )
    
    print("Starting training for 500,000 timesteps...")
    model.learn(total_timesteps=500000, callback=checkpoint_callback, progress_bar=True)
    
    save_path = os.path.join(models_dir, "sac_local")
    model.save(save_path)
    print(f"Training complete. Model saved to {save_path}.zip")

if __name__ == "__main__":
    main()
