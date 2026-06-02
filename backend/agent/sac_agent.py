import os
import numpy as np

class SACAgent:
    def __init__(self, model_path):
        self.model_path = model_path
        self.model = None
        self.state_size = 102
        self.action_size = 5
        self.episode_count = 0
        self.epsilon = 0.0
        self.load(model_path)
        
    def load(self, model_path):
        import tempfile
        import zipfile
        import shutil
        try:
            from stable_baselines3 import SAC
            if os.path.isdir(model_path):
                print(f"[SAC] Klasör yapısı tespit edildi. Zip dosyası oluşturuluyor...")
                temp_dir = tempfile.mkdtemp()
                temp_zip_path = os.path.join(temp_dir, "temp_model.zip")
                with zipfile.ZipFile(temp_zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                    for root, dirs, files in os.walk(model_path):
                        for file in files:
                            file_path = os.path.join(root, file)
                            arcname = os.path.relpath(file_path, model_path)
                            zipf.write(file_path, arcname)
                # custom_objects kullanarak use_sde hatalarini onluyoruz
                self.model = SAC.load(temp_zip_path, custom_objects={'use_sde': False})
                shutil.rmtree(temp_dir)
                print(f"[SAC] Model klasörden başarıyla yüklendi: {model_path}")
            else:
                self.model = SAC.load(model_path, custom_objects={'use_sde': False})
                print(f"[SAC] Model zip dosyasından başarıyla yüklendi: {model_path}")
        except ImportError:
            print("[WARN] 'stable_baselines3' kurulu değil!")
            raise ImportError("stable-baselines3 is required to load this model.")
        except Exception as e:
            print(f"[ERROR] SAC model yükleme hatası: {e}")
            raise e
            
    def get_continuous_action(self, state):
        if self.model is None:
            raise RuntimeError("SAC model yüklenmemiş.")
        state_arr = np.array(state, dtype=np.float32)
        action, _ = self.model.predict(state_arr, deterministic=True)
        return action
        
    def get_q_values(self, state):
        action = self.get_continuous_action(state)
        # action is typically shape (2,) e.g. [x, y]
        # Map to discrete Q-values format: [LEFT, RIGHT, UP, DOWN]
        x, y = 0.0, 0.0
        if action.shape and len(action) >= 2:
            x, y = float(action[0]), float(action[1])
            
        q = np.zeros(4, dtype=np.float32)
        q[1] = x if x > 0 else 0  # RIGHT
        q[0] = -x if x < 0 else 0 # LEFT
        q[3] = y if y > 0 else 0  # DOWN (gridde y/row artışı aşağı yönlüdür)
        q[2] = -y if y < 0 else 0 # UP
        return q

    def select_action(self, state, training=False):
        action = self.get_continuous_action(state)
        x, y = 0.0, 0.0
        if action.shape and len(action) >= 2:
            x, y = float(action[0]), float(action[1])
            
        if abs(x) < 0.2 and abs(y) < 0.2:
            return 4 # STAY
            
        if abs(x) > abs(y):
            return 1 if x > 0 else 0
        else:
            return 3 if y > 0 else 2
            
    def get_stats(self):
        return {
            "model_type": "SAC",
            "state_size": self.state_size,
            "action_size": self.action_size,
            "device": str(self.model.device) if self.model else "unknown"
        }
