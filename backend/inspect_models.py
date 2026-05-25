import torch
import os

models = [
    ("models/best_model_v2.pth", "DQN v2"),
    ("models/best_model_v3.pth", "DQN v3"),
    ("models/best_model_v4.pth", "DQN v4"),
]

print("="*70)
print("MEVCUT DQN MODELLERI")
print("="*70)

for path, name in models:
    if os.path.exists(path):
        try:
            checkpoint = torch.load(path, map_location="cpu", weights_only=False)
            config = checkpoint.get("config", {})
            print(f"\n{name}:")
            print(f"  State Size:     {config.get('state_size', 'N/A')}")
            print(f"  Action Size:    {config.get('action_size', 'N/A')}")
            print(f"  Hidden Size:    {config.get('hidden_size', 'N/A')}")
            print(f"  Gamma:          {config.get('gamma', 'N/A')}")
            print(f"  Episode Count:  {checkpoint.get('episode_count', 'N/A')}")
            print(f"  Total Steps:    {checkpoint.get('total_steps', 'N/A')}")
            print(f"  Epsilon:        {checkpoint.get('epsilon', 'N/A'):.4f}")
        except Exception as e:
            print(f"{name}: ERROR - {e}")

print("\n" + "="*70)
print("PPO MODELLERI")
print("="*70)

ppo_models = [
    "models/ppo_stage_4_hardcore",
    "models/ppo_sweetspot_3",
]

for model_dir in ppo_models:
    if os.path.isdir(model_dir):
        print(f"\n{os.path.basename(model_dir)}:")
        policy_file = os.path.join(model_dir, "policy.pth")
        if os.path.exists(policy_file):
            print(f"  ✓ Policy dosyası bulundu")
            try:
                state_dict = torch.load(policy_file, map_location="cpu", weights_only=True)
                # İlk layer'dan input size'ı bul
                for key in state_dict:
                    if "mlp_extractor.policy_net.0.weight" in key:
                        shape = state_dict[key].shape
                        print(f"  State Size (tahmini): {shape[1]}")
                        print(f"  Hidden Size (tahmini): {shape[0]}")
                        break
            except Exception as e:
                print(f"  Hata: {e}")
