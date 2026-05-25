# AutoSimulation — Otonom Sürüş Simülatörü

Grid ortamında DQN/PPO tabanlı otonom sürüş ajanlarını simüle eden web uygulaması.

## Repo Yapısı

```
AutoSimulation/
├── frontend/          React + Vite arayüzü
├── backend/           Python FastAPI + PyTorch AI servisi
│   ├── api/           REST + WebSocket endpoint'leri
│   ├── agent/         DQN ve PPO ajan mimarileri
│   ├── environment/   Grid ortamı
│   ├── training/      Eğitim scriptleri
│   └── models/        Eğitilmiş model dosyaları
└── README.md
```

## Kurulum

### 1. Backend (Python)

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
cd api
uvicorn main:app --port 8000 --reload
```

### 2. Frontend (Node)

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Tarayıcıda `http://localhost:5173` aç.

## Model Eklemek

Kendi modelini `backend/models/` klasörüne `{isim}_{mimari}_{versiyon}` formatında ekle.  
Detaylar için → [backend/models/README.md](backend/models/README.md)

Backend yeniden başlatıldığında model otomatik olarak dropdown'da görünür.
