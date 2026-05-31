import os
import numpy as np

class A2CSB3Agent:
    def __init__(self, model_path):
        self.model_path = model_path
        self.model = None
        self.state_size = 77  # GridWorldEnv'den gelen 77 boyutlu durum vektörü
        self.action_size = 4
        self.episode_count = 0
        self.epsilon = 0.0  # On-policy algoritmada epsilon olmaz
        self.load(model_path)
        
    def load(self, model_path):
        import tempfile
        import zipfile
        import shutil
        
        try:
            from stable_baselines3 import A2C
            
            # Eğer verilen yol bir klasör ise, içindekileri geçici bir zip dosyasına sıkıştırıp yüklüyoruz
            if os.path.isdir(model_path):
                print(f"[A2C SB3] Klasör yapısı tespit edildi. Zip dosyası oluşturuluyor...")
                temp_dir = tempfile.mkdtemp()
                temp_zip_path = os.path.join(temp_dir, "temp_model.zip")
                
                with zipfile.ZipFile(temp_zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                    for root, dirs, files in os.walk(model_path):
                        for file in files:
                            file_path = os.path.join(root, file)
                            arcname = os.path.relpath(file_path, model_path)
                            zipf.write(file_path, arcname)
                            
                self.model = A2C.load(temp_zip_path)
                # Geçici klasörü temizle
                shutil.rmtree(temp_dir)
                print(f"[A2C SB3] Model klasörden başarıyla yüklendi: {model_path}")
            else:
                self.model = A2C.load(model_path)
                print(f"[A2C SB3] Model zip dosyasından başarıyla yüklendi: {model_path}")
        except ImportError:
            print("[WARN] 'stable_baselines3' kütüphanesi kurulu değil!")
            print("[WARN] Lütfen backend venv'inizde kurun: .\\venv\\Scripts\\pip install stable-baselines3 gymnasium")
            raise ImportError("stable-baselines3 is required to load this model.")
        except Exception as e:
            print(f"[ERROR] A2C SB3 model yükleme hatası: {e}")
            raise e
            
    def act(self, state):
        if self.model is None:
            raise RuntimeError("A2C model yüklenmemiş.")
        
        state_arr = np.array(state, dtype=np.float32)
        action, _states = self.model.predict(state_arr, deterministic=True)
        return int(action)
        
    def select_action(self, state, training=False):
        return self.act(state)
        
    def get_action_probs(self, state):
        """
        A2C modelinden her bir eylemin (UP, RIGHT, DOWN, LEFT) olasılıklarını alır.
        """
        if self.model is None or self.model.policy is None:
            return np.array([0.25, 0.25, 0.25, 0.25], dtype=np.float32)
        try:
            import torch
            state_arr = np.array(state, dtype=np.float32)
            obs_tensor, _ = self.model.policy.obs_to_tensor(state_arr)
            with torch.no_grad():
                latent_pi, _ = self.model.policy.mlp_extractor(obs_tensor)
                logits = self.model.policy.action_net(latent_pi)
                probs = torch.softmax(logits, dim=-1).squeeze(0).cpu().numpy()
            return probs
        except Exception as e:
            print(f"[WARN] Failed to get A2C action probabilities: {e}")
            return np.array([0.25, 0.25, 0.25, 0.25], dtype=np.float32)
        
    def get_q_values(self, state):
        """
        Arayüzde gösterilmek üzere olasılıkları AutoSimulation formatına çevirip döndürür.
        Format: [LEFT, RIGHT, UP, DOWN]
        """
        probs = self.get_action_probs(state)
        return np.array([
            probs[3],  # LEFT
            probs[1],  # RIGHT
            probs[0],  # UP
            probs[2],  # DOWN
        ], dtype=np.float32)
        
    def get_stats(self):
        return {
            "model_type": "A2C (Stable-Baselines3)",
            "state_size": self.state_size,
            "action_size": self.action_size,
            "device": str(self.model.device) if self.model else "unknown"
        }
