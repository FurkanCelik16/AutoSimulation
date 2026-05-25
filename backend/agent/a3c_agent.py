"""
A3C Agent - Asynchronous Advantage Actor-Critic
Multi-threaded training ile çok hızlı ve stabil öğrenme
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
import torch.optim as optim
import numpy as np
from collections import deque
import threading
import os


class A3CNetwork(nn.Module):
    """Shared Actor-Critic Network"""
    def __init__(self, state_size=16, action_size=4, hidden_size=256):
        super().__init__()
        self.state_size = state_size
        self.action_size = action_size

        # Shared feature extraction
        self.fc1 = nn.Linear(state_size, hidden_size)
        self.fc2 = nn.Linear(hidden_size, hidden_size)

        # Actor head (policy)
        self.actor = nn.Linear(hidden_size, action_size)

        # Critic head (value)
        self.critic = nn.Linear(hidden_size, 1)

        # Initialize weights
        for layer in [self.fc1, self.fc2, self.actor, self.critic]:
            nn.init.orthogonal_(layer.weight, gain=np.sqrt(2))
            nn.init.constant_(layer.bias, 0)

    def forward(self, state):
        x = F.relu(self.fc1(state))
        x = F.relu(self.fc2(x))

        logits = self.actor(x)
        value = self.critic(x)

        return logits, value


class A3CAgent:
    """A3C Agent - Global network shared between workers"""
    def __init__(
        self,
        state_size: int = 16,
        action_size: int = 4,
        hidden_size: int = 256,
        learning_rate: float = 0.0001,
        gamma: float = 0.99,
        entropy_coeff: float = 0.01,
        max_grad_norm: float = 40.0,
        device: str = None,
    ):
        self.state_size = state_size
        self.action_size = action_size
        self.gamma = gamma
        self.entropy_coeff = entropy_coeff
        self.max_grad_norm = max_grad_norm

        if device is None:
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        else:
            self.device = torch.device(device)

        # Global network
        self.network = A3CNetwork(state_size, action_size, hidden_size).to(self.device)
        self.optimizer = optim.Adam(self.network.parameters(), lr=learning_rate)

        # Statistics
        self.episode_count = 0
        self.total_steps = 0
        self.lock = threading.Lock()

    def select_action(self, state: np.ndarray):
        """Select action using current policy"""
        state_t = torch.FloatTensor(state).unsqueeze(0).to(self.device)
        with torch.no_grad():
            logits, _ = self.network(state_t)
            probs = F.softmax(logits, dim=1)
            action = torch.multinomial(probs, 1).item()
        return action

    def compute_returns(self, rewards: list, next_value: float, done: bool):
        """Compute discounted returns (GAE)"""
        returns = []
        R = next_value if not done else 0.0

        for reward in reversed(rewards):
            R = reward + self.gamma * R
            returns.insert(0, R)

        return returns

    def update(self, states: list, actions: list, rewards: list, next_value: float, done: bool):
        """Update global network from worker experience (thread-safe)"""
        with self.lock:  # Lock entire update to prevent gradient computation race conditions
            states = torch.FloatTensor(states).to(self.device)
            actions = torch.LongTensor(actions).to(self.device)

            returns = self.compute_returns(rewards, next_value, done)
            returns = torch.FloatTensor(returns).to(self.device)

            logits, values = self.network(states)
            values = values.squeeze(-1)

            # Advantage (detach values to prevent backprop through them)
            with torch.no_grad():
                advantages = returns - values

            # Actor loss (policy gradient)
            log_probs = F.log_softmax(logits, dim=1)
            action_log_probs = log_probs.gather(1, actions.unsqueeze(1)).squeeze(1)
            actor_loss = -(action_log_probs * advantages).mean()

            # Entropy bonus (encourages exploration)
            entropy = -(log_probs * F.softmax(logits, dim=1)).sum(dim=1).mean()

            # Critic loss (value function)
            critic_loss = F.mse_loss(values, returns.detach())

            # Total loss
            total_loss = actor_loss + 0.5 * critic_loss - self.entropy_coeff * entropy

            # Backward pass
            self.optimizer.zero_grad()
            total_loss.backward()
            nn.utils.clip_grad_norm_(self.network.parameters(), self.max_grad_norm)
            self.optimizer.step()

            self.total_steps += len(states)

        return {
            "actor_loss": actor_loss.item(),
            "critic_loss": critic_loss.item(),
            "entropy": entropy.item(),
            "total_loss": total_loss.item(),
        }

    def get_value(self, state: np.ndarray):
        """Get value estimate for state"""
        state_t = torch.FloatTensor(state).unsqueeze(0).to(self.device)
        with torch.no_grad():
            _, value = self.network(state_t)
        return value.item()

    def get_q_values(self, state: np.ndarray):
        """Get Q-values (logits) for visualization (A3C compatible)"""
        state_t = torch.FloatTensor(state).unsqueeze(0).to(self.device)
        with torch.no_grad():
            logits, _ = self.network(state_t)
            # Return logits as Q-values for visualization
            q_vals = logits.squeeze(0).cpu().numpy()
        return q_vals

    def save(self, path: str):
        """Save model checkpoint"""
        os.makedirs(os.path.dirname(path), exist_ok=True)
        torch.save({
            "network_state": self.network.state_dict(),
            "optimizer_state": self.optimizer.state_dict(),
            "episode_count": self.episode_count,
            "total_steps": self.total_steps,
            "config": {
                "state_size": self.state_size,
                "action_size": self.action_size,
                "gamma": self.gamma,
                "entropy_coeff": self.entropy_coeff,
            }
        }, path)
        print(f"[SAVE] Model kaydedildi: {path}")

    def load(self, path: str):
        """Load model checkpoint"""
        checkpoint = torch.load(path, map_location=self.device, weights_only=False)
        self.network.load_state_dict(checkpoint["network_state"])
        self.optimizer.load_state_dict(checkpoint["optimizer_state"])
        self.episode_count = checkpoint.get("episode_count", 0)
        self.total_steps = checkpoint.get("total_steps", 0)
        print(f"[LOAD] Model yüklendi: {path} (Episode: {self.episode_count})")
