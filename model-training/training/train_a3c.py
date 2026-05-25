"""
train_a3c.py - A3C Training Loop
Asynchronous multi-worker training with curriculum learning
"""
import os
import sys
import time
import json
import threading
import numpy as np
from collections import deque
from datetime import datetime

# Add backend to path
backend_path = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "backend"
)
sys.path.insert(0, backend_path)

from environment import GridEnvironment
from agent.a3c_agent import A3CAgent


# --- Configuration ---
CONFIG = {
    # Environment
    "grid_size": 15,
    "random_maps": True,

    # Training
    "max_episodes": 20000,      # Uzun eğitim
    "max_steps": 300,
    "num_workers": 4,           # Kaç tane worker thread

    # Agent
    "state_size": 16,
    "action_size": 4,
    "hidden_size": 256,
    "learning_rate": 0.0001,
    "gamma": 0.99,
    "entropy_coeff": 0.01,

    # Curriculum (zorluk seviyeleri)
    "curriculum": [
        {"obstacle_ratio": 0.05, "min_path": 3, "episodes": 2000, "name": "Easy"},
        {"obstacle_ratio": 0.15, "min_path": 8, "episodes": 4000, "name": "Medium"},
        {"obstacle_ratio": 0.22, "min_path": 12, "episodes": 6000, "name": "Hard"},
        {"obstacle_ratio": 0.30, "min_path": 15, "episodes": 8000, "name": "VeryHard"},
    ],

    # Saving (backend/models klasöründe kaydet)
    "save_every": 500,
    "model_path": os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "backend", "models", "a3c_model_v1.pth"
    ),
    "stats_path": os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "backend", "models", "training_stats_a3c_v1.json"
    ),
}


class A3CWorker(threading.Thread):
    """Worker thread - runs episodes and updates global network"""
    def __init__(self, worker_id, agent, config):
        super().__init__(daemon=True)
        self.worker_id = worker_id
        self.agent = agent
        self.config = config
        self.env = GridEnvironment(
            size=config["grid_size"],
            random_maps=True,
            state_size=config["state_size"],
        )
        self.stats = {
            "episodes": 0,
            "rewards": deque(maxlen=100),
            "success_rate": deque(maxlen=100),
            "steps": deque(maxlen=100),
        }

    def run_episode(self, obstacle_ratio, min_path):
        """Run single episode"""
        self.env.obstacle_ratio = obstacle_ratio
        self.env.min_path_length = min_path
        self.env.random_maps = True

        state = self.env.reset()
        episode_reward = 0
        episode_steps = 0
        done = False
        trajectory = {"states": [], "actions": [], "rewards": []}

        while not done and episode_steps < self.config["max_steps"]:
            action = self.agent.select_action(state)
            next_state, reward, done, info = self.env.step(action)

            trajectory["states"].append(state)
            trajectory["actions"].append(action)
            trajectory["rewards"].append(reward)

            episode_reward += reward
            episode_steps += 1
            state = next_state

        # Get next value for bootstrap
        next_value = self.agent.get_value(state)

        # Update global network
        loss_info = self.agent.update(
            trajectory["states"],
            trajectory["actions"],
            trajectory["rewards"],
            next_value,
            done=done,
        )

        # Track stats
        self.stats["episodes"] += 1
        self.stats["rewards"].append(episode_reward)
        self.stats["success_rate"].append(1.0 if info.get("reached_goal") else 0.0)
        self.stats["steps"].append(episode_steps)

        return {
            "reward": episode_reward,
            "steps": episode_steps,
            "success": info.get("reached_goal", False),
            "loss": loss_info["total_loss"],
        }

    def run(self):
        """Worker main loop"""
        curriculum_idx = 0
        curriculum = self.config["curriculum"]
        episodes_in_phase = 0

        while True:
            # Get current phase
            if curriculum_idx >= len(curriculum):
                curriculum_idx = len(curriculum) - 1
            phase = curriculum[curriculum_idx]

            # Run episode in current phase
            result = self.run_episode(phase["obstacle_ratio"], phase["min_path"])

            episodes_in_phase += 1

            # Check if we should advance to next phase
            if (
                episodes_in_phase >= phase["episodes"]
                and np.mean(list(self.stats["success_rate"])) > 0.5
                and curriculum_idx < len(curriculum) - 1
            ):
                curriculum_idx += 1
                episodes_in_phase = 0
                print(f"\n[WORKER-{self.worker_id}] Seviye atlandı: {phase['name']} → {curriculum[curriculum_idx]['name']}")


def print_progress(agent, all_rewards, start_time):
    """Print training progress"""
    elapsed = time.time() - start_time
    hours = elapsed / 3600
    avg_reward = np.mean(all_rewards[-100:]) if all_rewards else 0

    print(
        f"\r[{datetime.now().strftime('%H:%M:%S')}] "
        f"Episodes: {agent.episode_count:6d} | "
        f"Steps: {agent.total_steps:8d} | "
        f"Avg Reward: {avg_reward:+7.1f} | "
        f"Time: {hours:.1f}h",
        end="",
        flush=True,
    )


def main():
    print("="*70)
    print("A3C (Asynchronous Advantage Actor-Critic) Eğitimi")
    print("="*70)
    print(f"Workers: {CONFIG['num_workers']}")
    print(f"Episodes: {CONFIG['max_episodes']}")
    print(f"Max Steps: {CONFIG['max_steps']}")
    print("="*70 + "\n")

    # Create agent
    agent = A3CAgent(
        state_size=CONFIG["state_size"],
        action_size=CONFIG["action_size"],
        hidden_size=CONFIG["hidden_size"],
        learning_rate=CONFIG["learning_rate"],
        gamma=CONFIG["gamma"],
        entropy_coeff=CONFIG["entropy_coeff"],
    )

    # Create and start workers
    workers = [A3CWorker(i, agent, CONFIG) for i in range(CONFIG["num_workers"])]
    for worker in workers:
        worker.start()

    # Main thread - monitoring
    start_time = time.time()
    all_rewards = deque(maxlen=1000)
    save_counter = 0

    try:
        while agent.episode_count < CONFIG["max_episodes"]:
            # Collect rewards from all workers
            total_reward = sum(
                np.mean(list(w.stats["rewards"])) if w.stats["rewards"] else 0
                for w in workers
            )

            if total_reward != 0:
                all_rewards.append(total_reward / CONFIG["num_workers"])
                agent.episode_count += 1

            # Print progress every 100 episodes
            if agent.episode_count % 100 == 0:
                print_progress(agent, list(all_rewards), start_time)

            # Save model
            if agent.episode_count % CONFIG["save_every"] == 0 and agent.episode_count > 0:
                agent.save(CONFIG["model_path"])
                save_counter += 1

            time.sleep(0.1)

    except KeyboardInterrupt:
        print("\n\n[INFO] Eğitim durduruldu!")

    # Final save
    agent.save(CONFIG["model_path"])

    # Save statistics
    final_stats = {
        "episodes": agent.episode_count,
        "total_steps": agent.total_steps,
        "avg_reward": float(np.mean(list(all_rewards))),
        "max_reward": float(np.max(list(all_rewards))) if all_rewards else 0,
        "config": CONFIG,
        "training_time_hours": (time.time() - start_time) / 3600,
    }

    os.makedirs(os.path.dirname(CONFIG["stats_path"]), exist_ok=True)
    with open(CONFIG["stats_path"], "w") as f:
        json.dump(final_stats, f, indent=2)

    print(f"\n{'='*70}")
    print(f"Eğitim Tamamlandı!")
    print(f"  Episodes: {agent.episode_count}")
    print(f"  Total Steps: {agent.total_steps}")
    print(f"  Avg Reward: {final_stats['avg_reward']:.2f}")
    print(f"  Training Time: {final_stats['training_time_hours']:.1f} saat")
    print(f"{'='*70}")


if __name__ == "__main__":
    main()
