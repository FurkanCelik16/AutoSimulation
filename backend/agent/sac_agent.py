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
                            
                self.model = SAC.load(temp_zip_path)
                shutil.rmtree(temp_dir)
                print(f"[SAC] Model klasörden başarıyla yüklendi: {model_path}")
            else:
                self.model = SAC.load(model_path)
                print(f"[SAC] Model zip dosyasından başarıyla yüklendi: {model_path}")
        except Exception as e:
            print(f"[ERROR] SAC model yükleme hatası: {e}")
            raise e
            
    def act(self, state):
        q = self.get_q_values(state)
        return int(np.argmax(q))
            
    def select_action(self, state, training=False):
        return self.act(state)
        
    def get_q_values(self, state):
        """
        Return pseudo q-values or probabilities for the UI.
        We map Box(2,) continuous actions [x, y] to 5 discrete actions.
        Usually y > 0 means UP, y < 0 means DOWN.
        x > 0 means RIGHT, x < 0 means LEFT.
        """
        if self.model is None:
            return np.array([0.2, 0.2, 0.2, 0.2, 0.2], dtype=np.float32)
            
        state_arr = np.array(state, dtype=np.float32)
        action_continuous, _ = self.model.predict(state_arr, deterministic=True)
        
        x, y = action_continuous[0], action_continuous[1]
        
        q = np.zeros(5, dtype=np.float32)
        q[0] = max(0, -x)  # LEFT
        q[1] = max(0, x)   # RIGHT
        q[2] = max(0, -y)  # UP (grid'de y ekseni ters, yani y < 0 yukarıdır)
        q[3] = max(0, y)   # DOWN (y > 0 aşağıdır)
        q[4] = max(0, 0.3 - (abs(x) + abs(y)))  # STAY if both are small
        
        return q
        
    def get_stats(self):
        return {
            "model_type": "SAC",
            "state_size": self.state_size,
            "action_size": self.action_size,
            "device": str(self.model.device) if self.model else "unknown"
        }
