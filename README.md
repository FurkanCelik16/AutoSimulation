# AutoSimulation — Reinforcement Learning & Neural Network Autonomous Grid Navigation

[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://www.python.org/)
[![PyTorch](https://img.shields.io/badge/Deep%20Learning-PyTorch%20%7C%20TensorFlow-orange.svg)]()
[![Reinforcement Learning](https://img.shields.io/badge/Algorithm-DQN%20%7C%20Q--Learning-green.svg)]()
[![Simulation](https://img.shields.io/badge/Domain-Autonomous%20Navigation-red.svg)]()

AutoSimulation; ızgara tabanlı (grid-world) dinamik bir simülasyon ortamında, otonom bir etmenin (aracın) engel tespiti, hedef optimizasyonu ve yol planlamasını **Pekiştirmeli Öğrenme (Reinforcement Learning)** ve **Yapay Sinir Ağları (YSA)** teknikleriyle gerçekleştiren bir simülasyon projesidir.

---

## 📌 Proje Özeti ve Temel Amaç

Projenin temel hedefi; etmenin çevreye dair önceden tam bilgiye sahip olmadığı stokastik bir ızgara ortamında, ceza-ödül mekanizması üzerinden en kısa ve güvenli rotayı kendi kendine öğrenmesini sağlamaktır.

* **Durum Uzayı (State Space):** Etmenin konumu, engellerin uzaklık matrisleri ve hedef koordinatları.
* **Eylem Uzayı (Action Space):** Yönsel hareketler (İleri, Geri, Sağa Dönüş, Sola Dönüş, Durma).
* **Ödül Fonksiyonu (Reward Engineering):** Hedefe yaklaşma adımlarında pozitif ödül, çarpışma (engeller/sınırlar) ve gereksiz manevralarda negatif ceza puanı.

---

## 🔬 Kullanılan Algoritmik Yaklaşımlar

* **Q-Learning / Deep Q-Network (DQN):** Sürekli veya yüksek boyutlu durum uzaylarında eylem-değer (Q-value) fonksiyonunun derin sinir ağları ile yaklaştırılması (approximation).
* **Experience Replay & Target Network:** Öğrenme kararlılığını artırmak ve temporal-difference (TD) salınımlarını minimize etmek için geçmiş deneyim havuzu kullanımı.
* **Epsilon-Greedy Stratejisi:** Keşif (exploration) ve faydalanma (exploitation) arasındaki dengenin aşamalı olarak optimize edilmesi.

---

## 🏗 Dizin Yapısı

* **docs/**: Proje teknik raporu (`GRUP7-YSA-RAPOR.docx`) ve sunum dosyaları (`GRUP7-YSA-SUNUM.pdf`)
* **simulation/**: Simülasyon ortamı, ızgara motoru ve görselleştirme katmanları
* **models/**: Eğitilmiş sinir ağı ağırlıkları ve model mimarisi
* **training/**: Ajan eğitim döngüleri, hiperparametre yapılandırmaları ve metrik logları

---

## 🛠 Kullanılan Teknolojiler

* **Programlama Dili:** Python 3.10+
* **Yapay Zeka & Matematik:** NumPy, PyTorch / TensorFlow
* **Veri Görselleştirme:** Matplotlib, Seaborn
* **Simülasyon Arayüzü:** Pygame / Tkinter (ortam motoruna bağlı olarak)

---

## 🚀 Kurulum ve Çalıştırma

1. Depoyu klonlayın:  
`git clone https://github.com/FurkanCelik16/AutoSimulation.git`  
`cd AutoSimulation`

2. Sanal ortamı oluşturup bağımlılıkları yükleyin:  
`python3 -m venv venv`  
`source venv/bin/activate`  
`pip install -r requirements.txt`

3. Simülasyonu başlatın:  
`python main.py`

*(Not: Modeli baştan eğitmek için `python train.py`, önceden eğitilmiş ağırlıkları test etmek için `python evaluate.py` komutlarını kullanabilirsiniz.)*

---

## 📄 Dokümantasyon

Projenin teorik temelleri, hiperparametre analizleri ve test sonuçları için `docs/` klasöründe yer alan teknik raporu inceleyebilirsiniz.
