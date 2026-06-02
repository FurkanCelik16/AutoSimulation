import os
import tempfile
import zipfile
import shutil
import torch

from stable_baselines3 import SAC

model_path = "models/sac"

print(f"Klasör yapısı tespit edildi. Zip dosyası oluşturuluyor...")
temp_dir = tempfile.mkdtemp()
temp_zip_path = os.path.join(temp_dir, "temp_model.zip")

with zipfile.ZipFile(temp_zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
    for root, dirs, files in os.walk(model_path):
        for file in files:
            file_path = os.path.join(root, file)
            arcname = os.path.relpath(file_path, model_path)
            zipf.write(file_path, arcname)

model = SAC.load(temp_zip_path)
print("Model loaded successfully.")
print(f"Action space: {model.action_space}")
print(f"Observation space: {model.observation_space}")

shutil.rmtree(temp_dir)
