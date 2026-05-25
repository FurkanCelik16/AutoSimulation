# Modeller

Bu klasör eğitilmiş model ağırlıklarını içerir.

## İsimlendirme Kuralı

```
{isim}_{mimari}_{versiyon}
```

**PPO modeli** → klasör olarak ekle (içinde `policy.pth` olmalı):
```
models/
└── ahmet_ppo_v1/
    ├── policy.pth
    └── policy.optimizer.pth   (opsiyonel)
```

**DQN modeli** → tek .pth dosyası olarak ekle:
```
models/
└── mehmet_dqn_v2.pth
```

## Mevcut Modeller

| Model | Tip | Açıklama |
|-------|-----|----------|
| ppo_sweetspot_3 | PPO | 15x15 grid, view_radius=3 |
| ppo_stage_4_hardcore | PPO | Hardcore eğitim |
| best_model_v3 | DQN | DQN v3 |
| best_model_v4 | DQN | DQN v4 |

## Model Eklemek

1. Modelini yukardaki kurala göre adlandır
2. `backend/models/` klasörüne koy
3. Bu tabloya satır ekle
4. `git add backend/models/senin_modelin` → commit → push
