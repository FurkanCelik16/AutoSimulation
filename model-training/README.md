# Model Training

PPO / DQN ajan eğitimi için kod ve notebook'lar.

## Klasör Yapısı

```
model-training/
├── environment/     AutonomousDriverEnv (eğitim ortamı)
├── training/        DQN eğitim scripti
├── notebooks/       Colab notebook'ları
├── maps/            Eğitimde kullanılan harita JSON'ları
├── tools/           Yardımcı araçlar (export, plot, watch)
└── requirements.txt
```

## Kurulum

```bash
pip install -r requirements.txt
```

## Model Eğitme

Eğittiğin modeli `backend/models/` altına koy:

```
backend/models/{isim}_{mimari}_{versiyon}/   ← PPO (klasör)
backend/models/{isim}_{mimari}_{versiyon}.pth ← DQN (dosya)
```

Backend yeniden başlatınca model dropdown'da görünür.
