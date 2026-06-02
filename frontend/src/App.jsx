// src/App.jsx
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';

const MODEL_API = import.meta.env.VITE_MODEL_API_URL ?? 'http://localhost:8000';
import './App.css';
import Grid from './components/Grid';
import Simulation3D from './components/Simulation3D';
import useInterval from './hooks/useInterval';
import { saveMap, buildGameMapDTO } from './services/api';
import { useSimulation } from './hooks/useSimulation';
import { useRaceSimulation } from './hooks/useRaceSimulation';

/* ─── Sabitler ─── */
const GRID_SIZES = [11, 15, 21, 31];
const DEFAULT_SIZE = 15;

const MODES = [
  { id: 'obstacle', label: '⬛ Engel', title: 'Statik engel koy / kaldır' },
  { id: 'dynamic', label: '🔮 Hareketli', title: 'Hareketli engel ekle / kaldır' },
  { id: 'start', label: '🟢 Başlangıç', title: 'Başlangıç noktasını seç' },
  { id: 'goal', label: '🟠 Hedef', title: 'Hedef noktasını seç' },
  { id: 'waypoint', label: '📍 Durak', title: 'Uğranacak durak noktasını seç' },
  { id: 'traffic-light', label: '🚦 Trafik Işığı', title: 'Trafik ışığı yerleştir / kaldır' },
];

const PATTERNS = [
  { id: 'linear-h', label: '↔ Yatay' },
  { id: 'linear-v', label: '↕ Dikey' },
  { id: 'random', label: '⟳ Rastgele' },
];

const SPEEDS = [
  { label: 'Yavaş', ms: 900 },
  { label: 'Orta', ms: 450 },
  { label: 'Hızlı', ms: 180 },
];

let dynCounter = 0;

/* ─── Yardımcılar ─── */
function indexToCoord(row, col, size) {
  const c = Math.floor(size / 2);
  return { x: col - c, y: c - row };
}
function coordToIndex(x, y, size) {
  const c = Math.floor(size / 2);
  return { row: c - y, col: x + c };
}
function createEmptyGrid(size) {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => 'empty'));
}
function countType(grid, type) { return grid.flat().filter(c => c === type).length; }

const getProbabilities = (qValues) => {
  if (!qValues || qValues.length === 0) return [];
  const isAlreadyProb = qValues.every(v => v >= 0) && Math.abs(qValues.reduce((a, b) => a + b, 0) - 1.0) < 0.05;
  if (isAlreadyProb) return qValues;
  const maxQ = Math.max(...qValues);
  const exps = qValues.map(v => Math.exp(v - maxQ));
  const sumExps = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / sumExps);
};

/* ─── App ─── */
export default function App() {
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [baseGrid, setBaseGrid] = useState(() => createEmptyGrid(DEFAULT_SIZE));
  const [theme, setTheme] = useState('city'); // 'city' | 'warehouse' | 'mars' | 'hospital'

  const themeLabels = {
    city: {
      agent: '🚗 Yapay Zeka Ajanı (Araba)',
      obstacle: '⬛ Sabit Engel (Bina)',
      dynamic: '🔮 Hareketli Engel (Spor Araba)',
      waypoint: '📍 Duraklar (Otobüs Durağı)',
      goal: '🎯 Hedef (Altın Kupa)',
      traffic: '🚦 Trafik Işıkları'
    },
    warehouse: {
      agent: '🤖 AMR Taşıyıcı Robot',
      obstacle: '📦 Sabit Engel (Depo Rafı)',
      dynamic: '🚜 Hareketli Engel (Forklift)',
      waypoint: '📍 Duraklar (Teslimat Bölgesi)',
      goal: '🎯 Hedef (Yükleme Rampası)',
      traffic: '🚦 Güvenlik Bariyerleri'
    },
    mars: {
      agent: '🛰️ Mars Rover Keşif Aracı',
      obstacle: '🪨 Sabit Engel (Uzay Krateri / Kaya)',
      dynamic: '🌪️ Hareketli Engel (Kum Fırtınası)',
      waypoint: '📍 Duraklar (Sondaj Noktası)',
      goal: '🎯 Hedef (Ana Araştırma Üssü)',
      traffic: '🚦 Telemetri Beacon İstasyonu'
    },
    hospital: {
      agent: '💊 Medikal Dağıtım Kapsülü',
      obstacle: '🏥 Sabit Engel (İlaç Dolabı / Cihaz)',
      dynamic: '👤 Hareketli Engel (Hastane Görevlisi)',
      waypoint: '📍 Duraklar (Hasta Yatağı)',
      goal: '🎯 Hedef (Merkezi Eczane)',
      traffic: '🚦 Steril Bölge Kapıları'
    }
  };
  const [dynamicObstacles, setDynamicObstacles] = useState([]);
  const dynamicObstaclesRef = useRef([]);

  const updateDynamicObstacles = useCallback((val) => {
    if (typeof val === 'function') {
      setDynamicObstacles(prev => {
        const next = val(prev);
        dynamicObstaclesRef.current = next;
        return next;
      });
    } else {
      dynamicObstaclesRef.current = val;
      setDynamicObstacles(val);
    }
  }, []);

  useEffect(() => {
    dynamicObstaclesRef.current = dynamicObstacles;
  }, [dynamicObstacles]);

  // Trafik ışıklarının Kırmızı/Yeşil durumu 4 saniyede bir değişir
  useEffect(() => {
    const interval = setInterval(() => {
      setLightsGreen(prev => !prev);
    }, 4000);
    return () => clearInterval(interval);
  }, []);
  const [mode, setMode] = useState('obstacle');
  const [pattern, setPattern] = useState('linear-h');
  const [startPos, setStartPos] = useState(null);
  const [goalPos, setGoalPos] = useState(null);
  const [waypoints, setWaypoints] = useState([]);
  const [currentWaypointIndex, setCurrentWaypointIndex] = useState(0);
  const [trafficLights, setTrafficLights] = useState([]);
  const [lightsGreen, setLightsGreen] = useState(true);
  const [agentPos, setAgentPos] = useState(null);
  const [isMoving, setIsMoving] = useState(false);
  const [simSpeed, setSimSpeed] = useState(450);

  /* ── Backend eğitim durumu ── */
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // 'ok' | 'error' | null
  const [isTraining, setIsTraining] = useState(false);
  const [lastAction, setLastAction] = useState(null); // SimulationResponseDTO
  const [modalState, setModalState] = useState({ show: false, type: 'success', steps: 0, reward: 0 }); // 'success' | 'fail'
  const [view3D, setView3D] = useState(false);
  const mapNameRef = useRef('harita1');

  // 🤖 Yapay Zeka Model Seçici Durumları
  const [availableModels, setAvailableModels] = useState([]);
  const [activeModel, setActiveModel] = useState('');

  // 🏁 Yarış Modu Durumları
  const [raceMode, setRaceMode] = useState(false);
  const [racer1Model, setRacer1Model] = useState('');
  const [racer2Model, setRacer2Model] = useState('');
  const [racer3Model, setRacer3Model] = useState('');
  const [racer4Model, setRacer4Model] = useState('');
  const [racer5Model, setRacer5Model] = useState('');
  const [racer1Pos, setRacer1Pos] = useState(null);
  const [racer2Pos, setRacer2Pos] = useState(null);
  const [racer3Pos, setRacer3Pos] = useState(null);
  const [racer4Pos, setRacer4Pos] = useState(null);
  const [racer5Pos, setRacer5Pos] = useState(null);
  const [racer1LastAction, setRacer1LastAction] = useState(null);
  const [racer2LastAction, setRacer2LastAction] = useState(null);
  const [racer3LastAction, setRacer3LastAction] = useState(null);
  const [racer4LastAction, setRacer4LastAction] = useState(null);
  const [racer5LastAction, setRacer5LastAction] = useState(null);
  const [collisionOccurred, setCollisionOccurred] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [raceRankings, setRaceRankings] = useState([]);
  const [shieldEnabled, setShieldEnabled] = useState(true);
  const [selectedTrack, setSelectedTrack] = useState('monaco');
  const crashedRacersRef = useRef(new Set());
  const finishedRacersRef = useRef(new Set());
  const racerStatsRef = useRef({});

  const racer1ModelRef = useRef('');
  racer1ModelRef.current = racer1Model;
  const racer2ModelRef = useRef('');
  racer2ModelRef.current = racer2Model;
  const racer3ModelRef = useRef('');
  racer3ModelRef.current = racer3Model;
  const racer4ModelRef = useRef('');
  racer4ModelRef.current = racer4Model;
  const racer5ModelRef = useRef('');
  racer5ModelRef.current = racer5Model;


  // Mevcut modelleri backend'den çek
  useEffect(() => {
    fetch(`${MODEL_API}/models`)
      .then(res => res.json())
      .then(data => {
        // Frontend tarafında her ihtimale karşı key bazında tekilleştirme yapalım (React key çakışmasını engellemek için)
        const uniqueModels = [];
        const seenKeys = new Set();
        (data.models || []).forEach(m => {
          if (!seenKeys.has(m.key)) {
            seenKeys.add(m.key);
            uniqueModels.push(m);
          }
        });

        setAvailableModels(uniqueModels);
        setActiveModel(data.active_model);
        if (uniqueModels.length >= 2) {
          setRacer1Model(uniqueModels[0].key);
          setRacer2Model(uniqueModels[1].key);
        } else if (uniqueModels.length === 1) {
          setRacer1Model(uniqueModels[0].key);
          setRacer2Model(uniqueModels[0].key);
        }
      })
      .catch(err => console.error('[MODEL] Modeller yüklenemedi:', err));
  }, []);

  // Canlı model değişim tetikleyicisi
  const handleModelChange = async (e) => {
    const key = e.target.value;
    if (!key) return;

    try {
      const res = await fetch(`${MODEL_API}/model/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_key: key })
      });
      const data = await res.json();
      if (data.status === 'success') {
        setActiveModel(data.active_model);
        // Simülasyonu temiz bir şekilde durdur ve sıfırla
        setIsTraining(false);
        setLastAction(null);
        disconnect();
        console.log(`[MODEL] Başarıyla '${data.active_model}' modeline geçildi.`);
      }
    } catch (err) {
      console.error('[MODEL] Model değiştirilemedi:', err);
    }
  };

  // Stale closures ve güvenli durdurma için refs
  const isTrainingRef = useRef(false);
  isTrainingRef.current = isTraining;

  const currentWaypointIndexRef = useRef(0);
  currentWaypointIndexRef.current = currentWaypointIndex;

  const lightsGreenRef = useRef(true);
  lightsGreenRef.current = lightsGreen;

  const trafficLightsRef = useRef([]);
  trafficLightsRef.current = trafficLights;

  const activeModelRef = useRef('');
  activeModelRef.current = activeModel;

  const shieldEnabledRef = useRef(true);
  shieldEnabledRef.current = shieldEnabled;

  const totalRewardRef = useRef(0);
  const totalStepsRef = useRef(0);

  const isMovingRef = useRef(false);
  isMovingRef.current = isMoving;

  const isWaitingForResponseRef = useRef(false);

  /* ─── Dinamik engellerin bir sonraki adımını hesaplayan senkronize yardımcı fonksiyon ─── */
  const getNextDynamicObstacles = useCallback((prev) => {
    const isStaticBlocked = (r, c) =>
      r < 0 || r >= size || c < 0 || c >= size ||
      baseGrid[r]?.[c] === 'obstacle' ||
      (startPos && r === startPos.row && c === startPos.col) ||
      (goalPos && r === goalPos.row && c === goalPos.col);

    const moves = prev.map(obs => {
      const { row, col, direction, pattern: p } = obs;
      if (p === 'linear-h' || p === 'linear-v') {
        const dr = p === 'linear-v' ? direction : 0;
        const dc = p === 'linear-h' ? direction : 0;
        if (!isStaticBlocked(row + dr, col + dc))
          return { row: row + dr, col: col + dc, dir: direction, moved: true };
        if (!isStaticBlocked(row - dr, col - dc))
          return { row: row - dr, col: col - dc, dir: -direction, moved: true };
        return { row, col, dir: direction, moved: false };
      } else {
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const valid = dirs.filter(([dr, dc]) => !isStaticBlocked(row + dr, col + dc));
        if (!valid.length) return { row, col, dir: direction, moved: false };
        const [dr, dc] = valid[Math.floor(Math.random() * valid.length)];
        return { row: row + dr, col: col + dc, dir: direction, moved: true };
      }
    });

    const resolved = moves.map((m, i) => {
      if (!m.moved) return m;
      const obs = prev[i];
      const revert = (flipDir) => ({ row: obs.row, col: obs.col, dir: flipDir ? -m.dir : m.dir, moved: false });
      const contested = moves.some((o, j) => j !== i && o.moved && o.row === m.row && o.col === m.col);
      if (contested) return revert(obs.pattern !== 'random');
      const occupierIdx = prev.findIndex((o, j) => j !== i && o.row === m.row && o.col === m.col);
      if (occupierIdx !== -1) {
        const oMove = moves[occupierIdx];
        if (oMove.row === m.row && oMove.col === m.col) return revert(obs.pattern !== 'random');
      }
      const swapIdx = prev.findIndex((o, j) =>
        j !== i && o.row === m.row && o.col === m.col &&
        moves[j].row === obs.row && moves[j].col === obs.col
      );
      if (swapIdx !== -1) return revert(obs.pattern !== 'random');
      return m;
    });

    return prev.map((obs, i) => ({
      ...obs,
      row: resolved[i].row,
      col: resolved[i].col,
      direction: resolved[i].dir,
    }));
  }, [size, baseGrid, startPos, goalPos]);

  const { connect, disconnect, sendTick, connected } = useSimulation({
    onResponse: useCallback((res) => {
      isWaitingForResponseRef.current = false;
      setLastAction(res);
      console.log('[SIM] Aksiyon:', res.action_label, '| Q:', res.q_values);

      if (res.shield_triggered) {
        const msg = `🛡️ [Kalkan] Güvenlik kalkanı aktif! Çarpışma veya döngü engellendi.`;
        const newId = Date.now() + '-shield-single';
        setNotifications(prev => {
          if (prev.some(n => n.message === msg)) return prev;
          return [...prev, { id: newId, message: msg, type: 'shield' }];
        });
        setTimeout(() => {
          setNotifications(prev => prev.filter(n => n.id !== newId));
        }, 3500);
      }

      if (res.reward !== undefined) {
        totalRewardRef.current += res.reward;
      }
      if (res.steps !== undefined) {
        totalStepsRef.current = res.steps;
      }

      if (res.agent_pos) {
        // Kartezyen (x,y) -> (row, col)
        const nextPos = coordToIndex(res.agent_pos.x, res.agent_pos.y, size);
        setAgentPos(nextPos);

        // Bir sonraki adım döngüsü (sadece eğitim/simülasyon hala aktifse)
        if (isTrainingRef.current) {
          setTimeout(() => {
            if (!isTrainingRef.current) return;
            if (!isMovingRef.current) return; // Hareketi durdurduysak bir sonraki adımı tetikleme!

            // Anlık aktif hedefi bul (sıradaki durak veya nihai hedef)
            const activeTarget = (waypoints.length > 0 && currentWaypointIndexRef.current < waypoints.length)
              ? waypoints[currentWaypointIndexRef.current]
              : goalPos;

            const reachedTarget = nextPos.row === activeTarget.row && nextPos.col === activeTarget.col;

            if (res.done || reachedTarget) {
              // Eğer bir durağa (waypoint) ulaştıysak:
              if (waypoints.length > 0 && currentWaypointIndexRef.current < waypoints.length && reachedTarget) {
                console.log(`[WAYPOINT] Durak ${currentWaypointIndexRef.current + 1}'e ulaşıldı! Bir sonraki hedefe yönleniliyor...`);

                const nextIndex = currentWaypointIndexRef.current + 1;
                setCurrentWaypointIndex(nextIndex);
                currentWaypointIndexRef.current = nextIndex;

                const nextActiveTarget = (nextIndex < waypoints.length) ? waypoints[nextIndex] : goalPos;

                // Ajan adımıyla tam senkronize şekilde hareketli engelleri 1 adım ilerlet
                const calculatedNextDyn = getNextDynamicObstacles(dynamicObstaclesRef.current);
                updateDynamicObstacles(calculatedNextDyn);

                // Ortamı yeni start/goal ve güncel trafik ışıklarıyla sıfırlamak için grid payload ile yeni Phase başlat
                isWaitingForResponseRef.current = true;
                sendTick({
                  map_name: mapNameRef.current,
                  is_first_tick: true,
                  shield_enabled: shieldEnabledRef.current,
                  agent_pos: indexToCoord(nextPos.row, nextPos.col, size),
                  goal_pos: indexToCoord(nextActiveTarget.row, nextActiveTarget.col, size),
                  dynamic_obstacles: calculatedNextDyn.map(o => indexToCoord(o.row, o.col, size)),
                  grid: baseGrid.map((r, rIdx) => r.map((c, cIdx) => {
                    if (c === 'obstacle') return 1;
                    const isRedLight = trafficLightsRef.current.some(t => t.row === rIdx && t.col === cIdx) && !lightsGreenRef.current;
                    if (isRedLight) return 1;
                    return 0;
                  }))
                });
              } else {
                // Ana hedefe ulaşıldı veya çarpışma oldu -> Simülasyonu bitir
                setIsTraining(false);
                disconnect();
                setSaveStatus('done');
                setModalState({
                  show: true,
                  type: res.reached_goal ? 'success' : 'fail',
                  steps: totalStepsRef.current,
                  reward: totalRewardRef.current
                });
              }
            } else {
              // Ajan adımıyla tam senkronize şekilde hareketli engelleri 1 adım ilerlet
              const calculatedNextDyn = getNextDynamicObstacles(dynamicObstaclesRef.current);
              updateDynamicObstacles(calculatedNextDyn);

              // Simülasyonu devam ettir. Her adımda trafik ışığı durumunu ve engelleri göndermek için grid'i de gönderiyoruz!
              isWaitingForResponseRef.current = true;
              sendTick({
                map_name: mapNameRef.current,
                shield_enabled: shieldEnabledRef.current,
                agent_pos: indexToCoord(nextPos.row, nextPos.col, size),
                goal_pos: indexToCoord(activeTarget.row, activeTarget.col, size),
                dynamic_obstacles: calculatedNextDyn.map(o => indexToCoord(o.row, o.col, size)),
                grid: baseGrid.map((r, rIdx) => r.map((c, cIdx) => {
                  if (c === 'obstacle') return 1;
                  const isRedLight = trafficLightsRef.current.some(t => t.row === rIdx && t.col === cIdx) && !lightsGreenRef.current;
                  if (isRedLight) return 1;
                  return 0;
                }))
              });
            }
          }, simSpeed);
        }
      }
    }, [size, startPos, goalPos, waypoints, simSpeed, baseGrid, getNextDynamicObstacles, updateDynamicObstacles]),
    onError: useCallback((msg) => {
      console.error('[SIM] Hata:', msg);
      setSaveStatus('error');
    }, []),
  });

  const raceWsRef = useRef({ disconnect: null, sendTick: null });

  // ── WebSocket yarış simülasyon hook ──
  const raceSim = useRaceSimulation({
    onResponse: useCallback((res) => {
      isWaitingForResponseRef.current = false;

      if (res.collision) {
        setCollisionOccurred(true);
      }

      const racers = res.racers || [];
      // Geriye dönük uyumluluk fallbacks
      if (racers.length === 0) {
        if (res.racer1) racers.push({ ...res.racer1, id: 0, model_key: racer1ModelRef.current });
        if (res.racer2) racers.push({ ...res.racer2, id: 1, model_key: racer2ModelRef.current });
      }

      racers.forEach(r => {
        if (r.shield_triggered) {
          const colors = ["🔵 Racer 1", "🟠 Racer 2", "💗 Racer 3", "🟢 Racer 4", "🟣 Racer 5"];
          const racerColorName = colors[r.id % colors.length];
          const modelLabel = r.model_key ? r.model_key.toUpperCase() : `RACER ${r.id + 1}`;
          const msg = `🛡️ [Kalkan] ${racerColorName} (${modelLabel}) çarpışma/döngü engelledi!`;
          const newId = Date.now() + '-shield-' + r.id;
          
          setNotifications(prev => {
            if (prev.some(n => n.message === msg)) return prev;
            return [...prev, { id: newId, message: msg, type: 'shield' }];
          });
          
          setTimeout(() => {
            setNotifications(prev => prev.filter(n => n.id !== newId));
          }, 3500);
        }

        if (r.agent_pos) {
          // Hedefe ulaşan ajanı haritadan sil (null), diğerleri normal konuma gider
          if (r.reached_goal) {
            if (r.id === 0) setRacer1Pos(null);
            else if (r.id === 1) setRacer2Pos(null);
            else if (r.id === 2) setRacer3Pos(null);
            else if (r.id === 3) setRacer4Pos(null);
            else if (r.id === 4) setRacer5Pos(null);
          } else {
            const nextPos = coordToIndex(r.agent_pos.x, r.agent_pos.y, size);
            if (r.id === 0) setRacer1Pos(nextPos);
            else if (r.id === 1) setRacer2Pos(nextPos);
            else if (r.id === 2) setRacer3Pos(nextPos);
            else if (r.id === 3) setRacer4Pos(nextPos);
            else if (r.id === 4) setRacer5Pos(nextPos);
          }
        }

        if (r.id === 0) setRacer1LastAction(r);
        else if (r.id === 1) setRacer2LastAction(r);
        else if (r.id === 2) setRacer3LastAction(r);
        else if (r.id === 3) setRacer4LastAction(r);
        else if (r.id === 4) setRacer5LastAction(r);

        // Hedefe ulaşan ajan için başarı bildirimi (sadece bir kez)
        if (r.reached_goal && !finishedRacersRef.current.has(r.id)) {
          finishedRacersRef.current.add(r.id);
          const colors = ["🔵 Racer 1", "🟠 Racer 2", "💗 Racer 3", "🟢 Racer 4", "🟣 Racer 5"];
          const racerColorName = colors[r.id % colors.length];
          const modelLabel = r.model_key ? r.model_key.toUpperCase() : `RACER ${r.id + 1}`;
          const msg = `🎉 ${racerColorName} (${modelLabel}) yarışı tamamladı!`;
          const newId = Date.now() + '-finish-' + r.id;
          setNotifications(prev => [...prev, { id: newId, message: msg, type: 'finish' }]);
          setTimeout(() => {
            setNotifications(prev => prev.filter(n => n.id !== newId));
          }, 6000);
          console.log(`[RACE FINISH] ${msg}`);
        }

        // Canlı kaza ve istatistik takibi
        if (r.done && racerStatsRef.current[r.id] === undefined) {
          racerStatsRef.current[r.id] = {
            id: r.id,
            name: ["🔵 Racer 1", "🟠 Racer 2", "💗 Racer 3", "🟢 Racer 4", "🟣 Racer 5"][r.id % 5],
            model: r.model_key ? r.model_key.toUpperCase() : `RACER ${r.id + 1}`,
            status: r.reached_goal ? 'finished' : 'crashed',
            steps: totalStepsRef.current,
            reward: r.reward
          };

          if (r.reward <= -40.0) {
            if (!crashedRacersRef.current.has(r.id)) {
              crashedRacersRef.current.add(r.id);
              const colors = ["🔵 Racer 1", "🟠 Racer 2", "💗 Racer 3", "🟢 Racer 4", "🟣 Racer 5"];
              const racerColorName = colors[r.id % colors.length];
              const modelLabel = r.model_key ? r.model_key.toUpperCase() : `RACER ${r.id + 1}`;
              const msg = `💥 ${racerColorName} (${modelLabel}) çarpışarak elendi!`;
              const newId = Date.now() + '-' + r.id;
              setNotifications(prev => [...prev, { id: newId, message: msg, type: 'crash' }]);
              setTimeout(() => {
                setNotifications(prev => prev.filter(n => n.id !== newId));
              }, 5000);
              console.log(`[RACE NOTIFICATION] ${msg}`);
            }
          }
        }
      });

      const allDone = racers.length > 0 && racers.every(r => r.done);

      if (allDone) {
        setIsTraining(false);
        raceWsRef.current.disconnect?.();
        
        const finalRankings = Object.values(racerStatsRef.current);
        setRaceRankings(finalRankings);

        const finishedRankings = finalRankings.filter(item => item.status === 'finished');
        let winner = 'Hiçbiri';
        if (finishedRankings.length > 0) {
          finishedRankings.sort((a, b) => a.steps - b.steps);
          winner = finishedRankings[0].name.toUpperCase() + ' (' + finishedRankings[0].model + ')';
        } else {
          winner = 'Tüm araçlar elendi!';
        }

        console.log(`[RACE DONE] Yarış bitti! Sıralama:`, finalRankings);

        setModalState({
          show: true,
          type: finishedRankings.length > 0 ? 'success' : 'fail',
          steps: totalStepsRef.current,
          reward: winner
        });
        return;
      }

      if (isTrainingRef.current) {
        setTimeout(() => {
          if (!isTrainingRef.current) return;
          if (!isMovingRef.current) return;

          const calculatedNextDyn = getNextDynamicObstacles(dynamicObstaclesRef.current);
          updateDynamicObstacles(calculatedNextDyn);

          totalStepsRef.current += 1;

          isWaitingForResponseRef.current = true;

          const activeModels = [
            racer1ModelRef.current,
            racer2ModelRef.current,
            racer3ModelRef.current,
            racer4ModelRef.current,
            racer5ModelRef.current
          ].filter(Boolean);

          raceWsRef.current.sendTick?.({
            racer_models: activeModels,
            racer1_model: racer1ModelRef.current || 'ppo_hardcore_v2',
            racer2_model: racer2ModelRef.current || 'sac_driver_stage_2',
            shield_enabled: shieldEnabledRef.current,
            dynamic_obstacles: calculatedNextDyn.map(o => indexToCoord(o.row, o.col, size)),
            grid: baseGrid.map((r, rIdx) => r.map((c, cIdx) => {
              if (c === 'obstacle') return 1;
              return 0;
            }))
          });
        }, simSpeed);
      }
    }, [size, baseGrid, simSpeed, getNextDynamicObstacles, updateDynamicObstacles]),
    onError: useCallback((msg) => {
      console.error('[WS RACE ERROR] Hata:', msg);
      setIsTraining(false);
    }, [])
  });

  // Assign the ref immediately after initialization
  useEffect(() => {
    raceWsRef.current.disconnect = raceSim.disconnect;
    raceWsRef.current.sendTick = raceSim.sendTick;
  }, [raceSim.disconnect, raceSim.sendTick]);

  const { connect: connectRace, disconnect: disconnectRace, sendTick: sendRaceTick, connected: connectedRace } = raceSim;

  // Özel Yarış Pistlerini Oluşturma Şablonu
  const generateRaceTrack = (trackName) => {
    setSelectedTrack(trackName);
    setSize(15);
    const newGrid = createEmptyGrid(15);
    const startCell = { row: 13, col: 2 };
    const goalCell = { row: 13, col: 12 };

    if (trackName === 'monaco') {
      // Monaco Grand Prix: Kıvrımlı yol, orta kısımda büyük engel adası ve şikanlar
      for (let r = 3; r <= 11; r++) {
        newGrid[r][7] = 'obstacle';
      }
      for (let c = 3; c <= 11; c++) {
        newGrid[3][c] = 'obstacle';
        newGrid[11][c] = 'obstacle';
      }
      newGrid[7][3] = 'obstacle';
      newGrid[7][11] = 'obstacle';
    } else if (trackName === 'suzuka') {
      // Suzuka S-Curves: Zikzaklı, sol-sağ kaçış alanları olan dar yol
      for (let i = 2; i <= 12; i++) {
        if (i !== 7) {
          newGrid[i][4] = 'obstacle';
          newGrid[i][10] = 'obstacle';
        }
      }
      for (let c = 4; c <= 10; c++) {
        if (c !== 7) {
          newGrid[4][c] = 'obstacle';
          newGrid[10][c] = 'obstacle';
        }
      }
    } else if (trackName === 'redbull') {
      // Red Bull Ring: Hızlı düzlükler ve ortada keskin zikzak bariyeri
      for (let r = 5; r <= 9; r++) {
        for (let c = 4; c <= 10; c++) {
          newGrid[r][c] = 'obstacle';
        }
      }
      newGrid[2][7] = 'obstacle';
      newGrid[12][7] = 'obstacle';
    }

    newGrid[startCell.row][startCell.col] = 'start';
    newGrid[goalCell.row][goalCell.col] = 'goal';

    setBaseGrid(newGrid);
    setDynamicObstacles([]);
    setStartPos(startCell);
    setGoalPos(goalCell);
    setAgentPos(null);
    setRacer1Pos(null);
    setRacer2Pos(null);
    setRacer3Pos(null);
    setRacer4Pos(null);
    setRacer5Pos(null);
    setIsMoving(false);
    setIsTraining(false);
    setLastAction(null);
    setRacer1LastAction(null);
    setRacer2LastAction(null);
    setRacer3LastAction(null);
    setRacer4LastAction(null);
    setRacer5LastAction(null);
    setCollisionOccurred(false);
    disconnect();
    disconnectRace();
  };

  // WebSocket bağlandığında ilk adımı göndererek simülasyonu başlat
  useEffect(() => {
    if (connected && isTraining && startPos && goalPos && !raceMode) {
      setAgentPos(startPos);
      console.log('[SIM] Simülasyon başlatılıyor, ilk adım gönderiliyor...');
      const activeTarget = (waypoints.length > 0 && currentWaypointIndexRef.current < waypoints.length) ? waypoints[currentWaypointIndexRef.current] : goalPos;
      isWaitingForResponseRef.current = true;
      sendTick({
        map_name: mapNameRef.current,
        is_first_tick: true,
        shield_enabled: shieldEnabledRef.current,
        agent_pos: indexToCoord(startPos.row, startPos.col, size),
        goal_pos: indexToCoord(activeTarget.row, activeTarget.col, size),
        dynamic_obstacles: dynamicObstaclesRef.current.map(o => indexToCoord(o.row, o.col, size)),
        grid: baseGrid.map((r, rIdx) => r.map((c, cIdx) => {
          if (c === 'obstacle') return 1;
          const isRedLight = trafficLightsRef.current.some(t => t.row === rIdx && t.col === cIdx) && !lightsGreenRef.current;
          if (isRedLight) return 1;
          return 0;
        }))
      });
    } else if (!connected && !raceMode) {
      setAgentPos(null);
    }
  }, [connected, isTraining, startPos, goalPos, waypoints, size, baseGrid, sendTick, raceMode]);

  // WebSocket yarış bağlandığında ilk adımı göndererek yarış simülasyonunu başlat
  useEffect(() => {
    if (connectedRace && isTraining && startPos && goalPos && raceMode) {
      setRacer1Pos(startPos);
      setRacer2Pos(startPos);
      setRacer3Pos(startPos);
      setRacer4Pos(startPos);
      setRacer5Pos(startPos);
      console.log('[RACE SIM] Yarış başlatılıyor, ilk adım gönderiliyor...');
      isWaitingForResponseRef.current = true;

      const activeModels = [
        racer1ModelRef.current,
        racer2ModelRef.current,
        racer3ModelRef.current,
        racer4ModelRef.current,
        racer5ModelRef.current
      ].filter(Boolean);

      sendRaceTick({
        is_first_tick: true,
        racer_models: activeModels,
        racer1_model: racer1ModelRef.current || 'ppo_hardcore_v2',
        racer2_model: racer2ModelRef.current || 'sac_driver_stage_2',
        shield_enabled: shieldEnabledRef.current,
        start_pos: indexToCoord(startPos.row, startPos.col, size),
        goal_pos: indexToCoord(goalPos.row, goalPos.col, size),
        dynamic_obstacles: dynamicObstaclesRef.current.map(o => indexToCoord(o.row, o.col, size)),
        grid: baseGrid.map((r, rIdx) => r.map((c, cIdx) => {
          if (c === 'obstacle') return 1;
          return 0;
        }))
      });
    } else if (!connectedRace && raceMode) {
      setRacer1Pos(null);
      setRacer2Pos(null);
      setRacer3Pos(null);
      setRacer4Pos(null);
      setRacer5Pos(null);
    }
  }, [connectedRace, isTraining, startPos, goalPos, raceMode, size, baseGrid, sendRaceTick]);

  // Hareketi duraklatıp tekrar başlattığımızda simülasyonu devam ettir
  useEffect(() => {
    if (connected && isTraining && isMoving && agentPos && !isWaitingForResponseRef.current && !raceMode) {
      console.log('[SIM] Harekete devam ediliyor, adım gönderiliyor...');
      const activeTarget = (waypoints.length > 0 && currentWaypointIndexRef.current < waypoints.length)
        ? waypoints[currentWaypointIndexRef.current]
        : goalPos;

      const calculatedNextDyn = getNextDynamicObstacles(dynamicObstaclesRef.current);
      updateDynamicObstacles(calculatedNextDyn);

      isWaitingForResponseRef.current = true;
      sendTick({
        map_name: mapNameRef.current,
        shield_enabled: shieldEnabledRef.current,
        agent_pos: indexToCoord(agentPos.row, agentPos.col, size),
        goal_pos: indexToCoord(activeTarget.row, activeTarget.col, size),
        dynamic_obstacles: calculatedNextDyn.map(o => indexToCoord(o.row, o.col, size)),
        grid: baseGrid.map((r, rIdx) => r.map((c, cIdx) => {
          if (c === 'obstacle') return 1;
          const isRedLight = trafficLightsRef.current.some(t => t.row === rIdx && t.col === cIdx) && !lightsGreenRef.current;
          if (isRedLight) return 1;
          return 0;
        }))
      });
    }
  }, [isMoving]);

  /* Görüntüleme gridi */
  const displayGrid = useMemo(() => {
    const dg = baseGrid.map(r => [...r]);

    // Trafik ışıklarını ekle
    trafficLights.forEach(t => {
      dg[t.row][t.col] = lightsGreen ? 'traffic-light-green' : 'traffic-light-red';
    });

    // Henüz ulaşılmamış tüm durakları çiz
    waypoints.slice(currentWaypointIndex).forEach(w => {
      dg[w.row][w.col] = 'waypoint';
    });

    dynamicObstacles.forEach(o => { dg[o.row][o.col] = 'dynamic'; });

    if (raceMode) {
      if (racer1Pos) {
        dg[racer1Pos.row][racer1Pos.col] = 'racer1';
      }
      if (racer2Pos) {
        dg[racer2Pos.row][racer2Pos.col] = 'racer2';
      }
      if (racer3Pos) {
        dg[racer3Pos.row][racer3Pos.col] = 'racer3';
      }
      if (racer4Pos) {
        dg[racer4Pos.row][racer4Pos.col] = 'racer4';
      }
      if (racer5Pos) {
        dg[racer5Pos.row][racer5Pos.col] = 'racer5';
      }
    } else {
      if (agentPos) {
        dg[agentPos.row][agentPos.col] = 'agent';
      }
    }
    return dg;
  }, [baseGrid, dynamicObstacles, agentPos, waypoints, currentWaypointIndex, trafficLights, lightsGreen, raceMode, racer1Pos, racer2Pos, racer3Pos, racer4Pos, racer5Pos]);

  /* ─── Yerel hareket tiki (dinamik engeller için) ─── */
  const tick = useCallback(() => {
    updateDynamicObstacles(getNextDynamicObstacles(dynamicObstaclesRef.current));
  }, [getNextDynamicObstacles, updateDynamicObstacles]);

  useInterval(tick, isMoving && !isTraining ? simSpeed : null);

  /* ─── Hücre tıklaması ─── */
  const handleCellClick = useCallback((row, col) => {
    const cell = displayGrid[row][col];
    if (mode === 'obstacle') {
      if (cell === 'start' || cell === 'goal' || cell === 'dynamic') return;
      setBaseGrid(prev => {
        const ng = prev.map(r => [...r]);
        ng[row][col] = cell === 'obstacle' ? 'empty' : 'obstacle';
        return ng;
      });
    } else if (mode === 'dynamic') {
      const existing = dynamicObstacles.find(o => o.row === row && o.col === col);
      if (existing) { setDynamicObstacles(prev => prev.filter(o => o.id !== existing.id)); return; }
      if (cell === 'obstacle' || cell === 'start' || cell === 'goal') return;
      setDynamicObstacles(prev => [...prev, { id: `dyn-${++dynCounter}`, row, col, pattern, direction: 1 }]);
    } else if (mode === 'start') {
      if (cell === 'goal' || cell === 'dynamic') return;
      setBaseGrid(prev => {
        const ng = prev.map(r => [...r]);
        if (startPos) ng[startPos.row][startPos.col] = 'empty';
        ng[row][col] = 'start';
        return ng;
      });
      setStartPos({ row, col });
      setAgentPos({ row, col });
    } else if (mode === 'goal') {
      if (cell === 'start' || cell === 'dynamic' || cell === 'waypoint') return;
      setBaseGrid(prev => {
        const ng = prev.map(r => [...r]);
        if (goalPos) ng[goalPos.row][goalPos.col] = 'empty';
        ng[row][col] = 'goal';
        return ng;
      });
      setGoalPos({ row, col });
    } else if (mode === 'waypoint') {
      if (cell === 'start' || cell === 'goal' || cell === 'dynamic' || cell === 'traffic-light') return;
      const exists = waypoints.some(w => w.row === row && w.col === col);
      if (exists) {
        setWaypoints(prev => prev.filter(w => !(w.row === row && w.col === col)));
      } else {
        setWaypoints(prev => [...prev, { row, col }]);
      }
      setCurrentWaypointIndex(0);
    } else if (mode === 'traffic-light') {
      if (cell === 'start' || cell === 'goal' || cell === 'dynamic' || cell === 'waypoint') return;
      const exists = trafficLights.some(t => t.row === row && t.col === col);
      if (exists) {
        setTrafficLights(prev => prev.filter(t => !(t.row === row && t.col === col)));
      } else {
        setTrafficLights(prev => [...prev, { row, col }]);
      }
    }
  }, [mode, pattern, displayGrid, dynamicObstacles, startPos, goalPos, waypoints, trafficLights]);

  /* ─── Kontroller ─── */
  const handleSizeChange = (e) => {
    const s = Number(e.target.value);
    setSize(s); setBaseGrid(createEmptyGrid(s));
    setDynamicObstacles([]); setStartPos(null); setGoalPos(null);
    setWaypoints([]); setCurrentWaypointIndex(0); setTrafficLights([]);
    setAgentPos(null);
    setIsMoving(false); setIsTraining(false); setLastAction(null);
    disconnect();
  };

  const clearStatic = () => setBaseGrid(p => p.map(r => r.map(c => c === 'obstacle' ? 'empty' : c)));
  const clearDynamic = () => { setDynamicObstacles([]); setIsMoving(false); };
  const reset = () => {
    setBaseGrid(createEmptyGrid(size)); setDynamicObstacles([]);
    setStartPos(null); setGoalPos(null);
    setWaypoints([]); setCurrentWaypointIndex(0); setTrafficLights([]);
    setAgentPos(null); setIsMoving(false);
    setIsTraining(false); setLastAction(null); setSaveStatus(null);
    disconnect();
  };

  const isSolvableBFS = (grid, start, goal) => {
    const size = grid.length;
    const queue = [[start.row, start.col]];
    const visited = Array.from({ length: size }, () => Array(size).fill(false));
    visited[start.row][start.col] = true;
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    while (queue.length > 0) {
      const [r, c] = queue.shift();
      if (r === goal.row && c === goal.col) return true;
      for (const [dr, dc] of dirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < size && nc >= 0 && nc < size) {
          if (grid[nr][nc] !== 'obstacle' && !visited[nr][nc]) {
            visited[nr][nc] = true;
            queue.push([nr, nc]);
          }
        }
      }
    }
    return false;
  };

  const generateRandomMap = (difficulty = 'easy') => {
    let attempts = 0;
    while (attempts < 200) {
      attempts++;
      const newGrid = createEmptyGrid(size);
      const numObstacles = Math.floor(size * size * 0.15); // %15 engel
      for (let i = 0; i < numObstacles; i++) {
        const r = Math.floor(Math.random() * size);
        const c = Math.floor(Math.random() * size);
        newGrid[r][c] = 'obstacle';
      }

      const emptyCells = [];
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (newGrid[r][c] === 'empty') emptyCells.push({ row: r, col: c });
        }
      }

      if (emptyCells.length >= 2) {
        const startIdx = Math.floor(Math.random() * emptyCells.length);
        const startCell = emptyCells.splice(startIdx, 1)[0];
        const goalIdx = Math.floor(Math.random() * emptyCells.length);
        const goalCell = emptyCells[goalIdx];

        if (isSolvableBFS(newGrid, startCell, goalCell)) {
          newGrid[startCell.row][startCell.col] = 'start';
          newGrid[goalCell.row][goalCell.col] = 'goal';

          let numDyn = 0;
          if (difficulty === 'medium') numDyn = 1;
          else if (difficulty === 'hard') numDyn = 3;
          else if (difficulty === 'very-hard') numDyn = 5;
          else if (difficulty === 'hell') numDyn = 8;

          const dynObs = [];
          const remainingEmpty = [];
          for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
              if (newGrid[r][c] === 'empty' && !(r === startCell.row && c === startCell.col) && !(r === goalCell.row && c === goalCell.col)) {
                remainingEmpty.push({ row: r, col: c });
              }
            }
          }

          for (let i = 0; i < numDyn && remainingEmpty.length > 0; i++) {
            const idx = Math.floor(Math.random() * remainingEmpty.length);
            const cell = remainingEmpty.splice(idx, 1)[0];
            const patterns = ['linear-h', 'linear-v', 'random'];
            const randPat = patterns[Math.floor(Math.random() * patterns.length)];
            dynObs.push({
              id: `dyn-${++dynCounter}`,
              row: cell.row,
              col: cell.col,
              pattern: randPat,
              direction: 1
            });
          }

          setBaseGrid(newGrid);
          setDynamicObstacles(dynObs);
          setStartPos(startCell);
          setGoalPos(goalCell);
          setAgentPos(null);
          setIsMoving(false);
          setIsTraining(false);
          setLastAction(null);
          disconnect();
          return;
        }
      }
    }
  };

  /* ─── Eğitimi Başlat: haritayı kaydet + WS bağlan ─── */
  const handleTrainClick = useCallback(async () => {
    if (!startPos || !goalPos) return;

    // Eğitim/yarış zaten çalışıyorsa durdur
    if (isTraining) {
      if (raceMode) {
        disconnectRace();
      } else {
        disconnect();
      }
      setIsTraining(false);
      setLastAction(null);
      setRacer1LastAction(null);
      setRacer2LastAction(null);
      return;
    }

    setIsSaving(true);
    setSaveStatus(null);

    try {
      if (raceMode) {
        // Durak ve yarış durumlarını sıfırla
        totalStepsRef.current = 0;
        setCollisionOccurred(false);
        setNotifications([]);
        setRaceRankings([]);
        crashedRacersRef.current.clear();
        finishedRacersRef.current.clear();
        racerStatsRef.current = {};
        setRacer1Pos(startPos);
        setRacer2Pos(startPos);

        connectRace();
        setIsTraining(true);
        setIsMoving(true);
      } else {
        const payload = buildGameMapDTO({
          mapName: mapNameRef.current,
          size,
          baseGrid,
          dynamicObstacles,
          startPos,
          goalPos,
        });

        // Haritayı arka planda kaydet — başarısız olsa bile simülasyon başlar
        saveMap(payload)
          .then(() => setSaveStatus('ok'))
          .catch((err) => {
            console.warn('[MAP] Harita kaydedilemedi, simülasyon devam ediyor:', err);
            setSaveStatus('ok'); // UI'da engelleme yapma
          });

        // Durak durumlarını sıfırla
        setCurrentWaypointIndex(0);
        currentWaypointIndexRef.current = 0;

        // İstatistik referanslarını sıfırla
        totalRewardRef.current = 0;
        totalStepsRef.current = 0;

        // WebSocket bağlantısını hemen kur
        connect();
        setIsTraining(true);
        setIsMoving(true); // Hareketi otomatik olarak başlat
      }
    } catch (err) {
      console.error('Başlatma hatası:', err);
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  }, [isTraining, raceMode, startPos, goalPos, size, baseGrid, dynamicObstacles, connect, disconnect, connectRace, disconnectRace]);

  const center = Math.floor(size / 2);
  const staticCount = countType(baseGrid, 'obstacle');
  const dynCount = dynamicObstacles.length;
  const startCoord = startPos ? indexToCoord(startPos.row, startPos.col, size) : null;
  const goalCoord = goalPos ? indexToCoord(goalPos.row, goalPos.col, size) : null;

  return (
    <div className="app">
      <header className="app-header">
        <h1>Grid World Simülatörü</h1>
        <p>Ortam tasarla, engelleri yerleştir ve ajanını eğit &nbsp;·&nbsp; Merkez (0, 0)</p>
      </header>

      {/* 🏁 Yarış Modu Paneli */}
      <div style={{
        background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
        border: '1px solid #334155',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)',
        borderRadius: '12px',
        padding: '16px 20px',
        maxWidth: '1200px',
        margin: '10px auto 20px auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        transition: 'all 0.3s ease-in-out',
        fontFamily: "'Outfit', sans-serif"
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '24px' }}>🏁</span>
            <div>
              <h2 style={{ margin: 0, fontSize: '18px', color: '#f1f5f9', fontWeight: 'bold' }}>
                YAPAY ZEKA YARIŞ MODU (Yöntem 2)
              </h2>
              <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>
                5 farklı otonom sürüş modelini aynı pistte yarıştırın! Ajanlar birbirini dinamik engel olarak görüp kaçınacaktır.
              </p>
            </div>
          </div>
          
          <button
            className={`btn ${raceMode ? 'btn-stop' : 'btn-primary'}`}
            onClick={() => {
              setRaceMode(prev => {
                const next = !prev;
                if (next) {
                  // Yarış modu açıldığında varsayılan Monaco pistini yükle
                  setTimeout(() => generateRaceTrack('monaco'), 100);
                } else {
                  reset();
                }
                return next;
              });
            }}
            style={{
              padding: '8px 16px',
              fontSize: '14px',
              fontWeight: 'bold',
              borderRadius: '8px',
              boxShadow: raceMode ? '0 0 10px rgba(239, 68, 68, 0.25)' : 'none',
              transition: 'all 0.3s'
            }}
          >
            {raceMode ? '🚫 Yarış Modunu Kapat' : '🏎️ Yarış Modunu Aç!'}
          </button>
        </div>

        {raceMode && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '16px',
            background: 'rgba(15, 23, 42, 0.6)',
            padding: '14px',
            borderRadius: '10px',
            border: '1px solid #334155'
          }}>
            {/* Racer 1 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ color: '#cbd5e1', fontWeight: 'bold', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                🔵 Racer 1
              </label>
              <select
                className="select-model btn btn-secondary"
                value={racer1Model}
                onChange={(e) => setRacer1Model(e.target.value)}
                disabled={isTraining}
                style={{
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  MozAppearance: 'none',
                  width: '100%',
                  background: '#1e293b',
                  color: '#cbd5e1',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  padding: '6px 28px 6px 10px',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23cbd5e1' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 10px center',
                  fontWeight: 'bold',
                  height: '34px',
                  cursor: 'pointer'
                }}
              >
                <option value="" style={{ background: '#0f172a', color: '#888' }}>— DEVRE DIŞI —</option>
                {availableModels.map(m => (
                  <option key={m.key} value={m.key} style={{ background: '#0f172a', color: '#fff' }}>
                    {m.type} - {m.key.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            {/* Racer 2 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ color: '#cbd5e1', fontWeight: 'bold', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                🟠 Racer 2
              </label>
              <select
                className="select-model btn btn-secondary"
                value={racer2Model}
                onChange={(e) => setRacer2Model(e.target.value)}
                disabled={isTraining}
                style={{
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  MozAppearance: 'none',
                  width: '100%',
                  background: '#1e293b',
                  color: '#cbd5e1',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  padding: '6px 28px 6px 10px',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23cbd5e1' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 10px center',
                  fontWeight: 'bold',
                  height: '34px',
                  cursor: 'pointer'
                }}
              >
                <option value="" style={{ background: '#0f172a', color: '#888' }}>— DEVRE DIŞI —</option>
                {availableModels.map(m => (
                  <option key={m.key} value={m.key} style={{ background: '#0f172a', color: '#fff' }}>
                    {m.type} - {m.key.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            {/* Racer 3 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ color: '#cbd5e1', fontWeight: 'bold', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                💗 Racer 3
              </label>
              <select
                className="select-model btn btn-secondary"
                value={racer3Model}
                onChange={(e) => setRacer3Model(e.target.value)}
                disabled={isTraining}
                style={{
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  MozAppearance: 'none',
                  width: '100%',
                  background: '#1e293b',
                  color: '#cbd5e1',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  padding: '6px 28px 6px 10px',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23cbd5e1' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 10px center',
                  fontWeight: 'bold',
                  height: '34px',
                  cursor: 'pointer'
                }}
              >
                <option value="" style={{ background: '#0f172a', color: '#888' }}>— DEVRE DIŞI —</option>
                {availableModels.map(m => (
                  <option key={m.key} value={m.key} style={{ background: '#0f172a', color: '#fff' }}>
                    {m.type} - {m.key.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            {/* Racer 4 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ color: '#cbd5e1', fontWeight: 'bold', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                🟢 Racer 4
              </label>
              <select
                className="select-model btn btn-secondary"
                value={racer4Model}
                onChange={(e) => setRacer4Model(e.target.value)}
                disabled={isTraining}
                style={{
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  MozAppearance: 'none',
                  width: '100%',
                  background: '#1e293b',
                  color: '#cbd5e1',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  padding: '6px 28px 6px 10px',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23cbd5e1' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 10px center',
                  fontWeight: 'bold',
                  height: '34px',
                  cursor: 'pointer'
                }}
              >
                <option value="" style={{ background: '#0f172a', color: '#888' }}>— DEVRE DIŞI —</option>
                {availableModels.map(m => (
                  <option key={m.key} value={m.key} style={{ background: '#0f172a', color: '#fff' }}>
                    {m.type} - {m.key.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            {/* Racer 5 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ color: '#cbd5e1', fontWeight: 'bold', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                🟣 Racer 5
              </label>
              <select
                className="select-model btn btn-secondary"
                value={racer5Model}
                onChange={(e) => setRacer5Model(e.target.value)}
                disabled={isTraining}
                style={{
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  MozAppearance: 'none',
                  width: '100%',
                  background: '#1e293b',
                  color: '#cbd5e1',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  padding: '6px 28px 6px 10px',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23cbd5e1' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 10px center',
                  fontWeight: 'bold',
                  height: '34px',
                  cursor: 'pointer'
                }}
              >
                <option value="" style={{ background: '#0f172a', color: '#888' }}>— DEVRE DIŞI —</option>
                {availableModels.map(m => (
                  <option key={m.key} value={m.key} style={{ background: '#0f172a', color: '#fff' }}>
                    {m.type} - {m.key.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            {/* Race Tracks */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ color: '#cbd5e1', fontWeight: 'bold', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                🏁 Yarış Pisti Seç:
              </label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => generateRaceTrack('monaco')}
                  disabled={isTraining}
                  style={{
                    flex: 1,
                    fontSize: '12px',
                    padding: '6px',
                    whiteSpace: 'nowrap',
                    border: selectedTrack === 'monaco' ? '1px solid #38bdf8' : '1px solid #334155',
                    background: selectedTrack === 'monaco' ? 'rgba(56, 189, 248, 0.1)' : '#1e293b',
                    color: selectedTrack === 'monaco' ? '#38bdf8' : '#cbd5e1',
                    fontWeight: selectedTrack === 'monaco' ? 'bold' : 'normal',
                    transition: 'all 0.2s'
                  }}
                >
                  Pist 1
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => generateRaceTrack('suzuka')}
                  disabled={isTraining}
                  style={{
                    flex: 1,
                    fontSize: '12px',
                    padding: '6px',
                    whiteSpace: 'nowrap',
                    border: selectedTrack === 'suzuka' ? '1px solid #38bdf8' : '1px solid #334155',
                    background: selectedTrack === 'suzuka' ? 'rgba(56, 189, 248, 0.1)' : '#1e293b',
                    color: selectedTrack === 'suzuka' ? '#38bdf8' : '#cbd5e1',
                    fontWeight: selectedTrack === 'suzuka' ? 'bold' : 'normal',
                    transition: 'all 0.2s'
                  }}
                >
                  Pist 2
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => generateRaceTrack('redbull')}
                  disabled={isTraining}
                  style={{
                    flex: 1,
                    fontSize: '12px',
                    padding: '6px',
                    whiteSpace: 'nowrap',
                    border: selectedTrack === 'redbull' ? '1px solid #38bdf8' : '1px solid #334155',
                    background: selectedTrack === 'redbull' ? 'rgba(56, 189, 248, 0.1)' : '#1e293b',
                    color: selectedTrack === 'redbull' ? '#38bdf8' : '#cbd5e1',
                    fontWeight: selectedTrack === 'redbull' ? 'bold' : 'normal',
                    transition: 'all 0.2s'
                  }}
                >
                  Pist 3
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Mod seçici */}
      <div className="mode-bar">
        <span className="mode-bar__label">Mod:</span>
        {MODES.map(m => (
          <button key={m.id} id={`mode-btn-${m.id}`}
            className={`mode-btn${mode === m.id ? ' mode-btn--active' : ''}`}
            onClick={() => setMode(m.id)} title={m.title}>
            {m.label}
          </button>
        ))}
        {mode === 'dynamic' && (
          <>
            <div className="mode-bar__sep" />
            <span className="mode-bar__label">Hareket:</span>
            {PATTERNS.map(p => (
              <button key={p.id}
                className={`pattern-btn${pattern === p.id ? ' pattern-btn--active' : ''}`}
                onClick={() => setPattern(p.id)}>
                {p.label}
              </button>
            ))}
          </>
        )}
      </div>

      {/* Kontrol paneli */}
      <div className="control-panel">
        <div className="control-group">
          <label htmlFor="grid-size-select">Grid:</label>
          <select
            id="grid-size-select"
            className="select-grid-size btn btn-secondary"
            value={size}
            onChange={handleSizeChange}
            style={{
              appearance: 'none',
              WebkitAppearance: 'none',
              MozAppearance: 'none',
              background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
              color: '#c9d1d9',
              border: '1px solid #30363d',
              boxShadow: '0 0 10px rgba(255, 255, 255, 0.05)',
              borderRadius: '6px',
              padding: '6px 28px 6px 12px',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23c9d1d9' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 10px center',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontFamily: 'monospace',
              outline: 'none',
              transition: 'all 0.3s',
              height: '34px',
              lineHeight: '20px'
            }}
          >
            {GRID_SIZES.map(s => <option key={s} value={s} style={{ background: '#0f172a', color: '#fff' }}>{s}×{s}</option>)}
          </select>
        </div>
        <div className="control-divider" />

        <div className="control-group">
          <span className="control-label">Hız:</span>
          {SPEEDS.map(sp => (
            <button key={sp.ms}
              className={`speed-btn${simSpeed === sp.ms ? ' speed-btn--active' : ''}`}
              onClick={() => setSimSpeed(sp.ms)}
              disabled={mode !== 'dynamic'}>
              {sp.label}
            </button>
          ))}
        </div>
        <div className="control-divider" />

        <div className="control-group">
          <button id="btn-toggle-move"
            className={`btn ${isMoving ? 'btn-stop' : 'btn-move'}`}
            onClick={() => setIsMoving(v => !v)}
            disabled={dynCount === 0 && !isTraining}>
            {isMoving ? '⏹ Durdur' : '▶ Hareketi Başlat'}
          </button>
        </div>
        <div className="control-divider" />

        <div className="control-group">
          <button className="btn btn-secondary" onClick={clearStatic} disabled={staticCount === 0}>🧹 Sabit ({staticCount})</button>
          <button className="btn btn-secondary" onClick={clearDynamic} disabled={dynCount === 0}>🗑 Hareketli ({dynCount})</button>
          <button className="btn btn-secondary" onClick={reset}>↺ Sıfırla</button>
          <select
            id="difficulty-select"
            className="select-difficulty btn btn-secondary"
            style={{
              appearance: 'none',
              WebkitAppearance: 'none',
              MozAppearance: 'none',
              background: '#21262d',
              color: '#c9d1d9',
              border: '1px solid #30363d',
              borderRadius: '6px',
              padding: '6px 28px 6px 12px',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23c9d1d9' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 10px center',
              cursor: 'pointer',
              fontWeight: '500',
              height: '34px',
              lineHeight: '20px'
            }}
            onChange={(e) => {
              const diff = e.target.value;
              if (diff) {
                generateRandomMap(diff);
                e.target.value = ""; // Seçimi sıfırla ki tekrar basılabilsin
              }
            }}
          >
            <option value="">🎲 Rastgele...</option>
            <option value="easy">🟢 Kolay (Statik)</option>
            <option value="medium">🟡 Orta (1 Dinamik)</option>
            <option value="hard">🟠 Zor (3 Dinamik)</option>
            <option value="very-hard">🔴 Çok Zor (5 Dinamik)</option>
            <option value="hell">🔥 Cehennem knk (8 Dinamik)</option>
          </select>
        </div>
        <div className="control-divider" />

        {/* 2D / 3D Görünüm Seçici */}
        <div className="control-group" style={{ display: 'flex', gap: '2px' }}>
          <button
            className={`btn ${!view3D ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setView3D(false)}
            style={{
              minWidth: '60px',
              borderTopRightRadius: 0,
              borderBottomRightRadius: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px'
            }}
          >
            📺 2D
          </button>
          <button
            className={`btn ${view3D ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setView3D(true)}
            style={{
              minWidth: '60px',
              borderTopLeftRadius: 0,
              borderBottomLeftRadius: 0,
              marginLeft: '-1px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px'
            }}
          >
            🎥 3D
          </button>
        </div>
        <div className="control-divider" />

        {/* 🗺️ Simülasyon Teması Seçici */}
        <div className="control-group">
          <label htmlFor="theme-select" style={{ color: '#a855f7', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
            🗺️ Tema:
          </label>
          <select
            id="theme-select"
            className="select-theme btn btn-secondary"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            style={{
              appearance: 'none',
              WebkitAppearance: 'none',
              MozAppearance: 'none',
              background: 'linear-gradient(135deg, #2e1065 0%, #0f172a 100%)',
              color: '#c084fc',
              border: '1px solid #7c3aed',
              boxShadow: '0 0 10px rgba(124, 58, 237, 0.2)',
              borderRadius: '6px',
              padding: '6px 28px 6px 12px',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23c084fc' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 10px center',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontFamily: 'monospace',
              outline: 'none',
              transition: 'all 0.3s',
              height: '34px',
              lineHeight: '20px'
            }}
          >
            <option value="city" style={{ background: '#0f172a', color: '#fff' }}>🚗 Şehir</option>
            <option value="warehouse" style={{ background: '#0f172a', color: '#fff' }}>📦 Depo</option>
            <option value="mars" style={{ background: '#0f172a', color: '#fff' }}>🚀 Mars</option>
            <option value="hospital" style={{ background: '#0f172a', color: '#fff' }}>🏥 Hastane</option>
          </select>
        </div>
        <div className="control-divider" />


        {/* 🤖 Yapay Zeka Model Seçici (Dropdown) */}
        <div className="control-group">
          <label htmlFor="model-select" style={{ color: '#38bdf8', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
            🤖 Beyin:
          </label>
          <select
            id="model-select"
            className="select-model btn btn-secondary"
            value={activeModel}
            onChange={handleModelChange}
            style={{
              appearance: 'none',
              WebkitAppearance: 'none',
              MozAppearance: 'none',
              background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
              color: '#38bdf8',
              border: '1px solid #0284c7',
              boxShadow: '0 0 10px rgba(2, 132, 199, 0.2)',
              borderRadius: '6px',
              padding: '6px 28px 6px 12px',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2338bdf8' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 10px center',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontFamily: 'monospace',
              outline: 'none',
              transition: 'all 0.3s',
              height: '34px',
              lineHeight: '20px'
            }}
          >
            {availableModels.map(m => (
              <option key={m.key} value={m.key} style={{ background: '#0f172a', color: '#fff' }}>
                {m.type === 'PPO' ? '🤖 PPO' : (m.type === 'A3C' ? '🧠 A3C' : (m.type === 'A2C' ? '🚀 A2C' : '⚙️ DQN'))} - {m.key.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
        <div className="control-divider" />

        {/* 🛡️ Sürüş Desteği (Kalkan Modu) */}
        <div className="control-group" style={{ display: 'flex', alignItems: 'center', gap: '1px' }}>
          <span className="control-label" style={{ color: '#10b981', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px', marginRight: '6px' }}>
            🛡️ Kalkan:
          </span>
          <button
            className={`btn ${shieldEnabled ? 'btn-success' : 'btn-secondary'}`}
            onClick={() => setShieldEnabled(true)}
            style={{
              background: shieldEnabled ? 'linear-gradient(135deg, #059669 0%, #10b981 100%)' : '#21262d',
              color: shieldEnabled ? '#fff' : '#8b949e',
              border: shieldEnabled ? '1px solid #10b981' : '1px solid #30363d',
              boxShadow: shieldEnabled ? '0 0 10px rgba(16, 185, 129, 0.3)' : 'none',
              borderTopRightRadius: 0,
              borderBottomRightRadius: 0,
              padding: '6px 12px',
              fontWeight: 'bold',
              cursor: 'pointer',
              transition: 'all 0.3s'
            }}
          >
            Yardımlı
          </button>
          <button
            className={`btn ${!shieldEnabled ? 'btn-danger' : 'btn-secondary'}`}
            onClick={() => setShieldEnabled(false)}
            style={{
              background: !shieldEnabled ? 'linear-gradient(135deg, #dc2626 0%, #ef4444 100%)' : '#21262d',
              color: !shieldEnabled ? '#fff' : '#8b949e',
              border: !shieldEnabled ? '1px solid #ef4444' : '1px solid #30363d',
              boxShadow: !shieldEnabled ? '0 0 10px rgba(239, 68, 68, 0.3)' : 'none',
              borderTopLeftRadius: 0,
              borderBottomLeftRadius: 0,
              padding: '6px 12px',
              fontWeight: 'bold',
              cursor: 'pointer',
              transition: 'all 0.3s'
            }}
          >
            Yardımsız
          </button>
        </div>
        <div className="control-divider" />

        {/* Testi Başlat / Testi Sonlandır */}
        <div className="control-group">
          <button id="btn-train"
            className={`btn ${isTraining ? 'btn-stop' : 'btn-primary'}`}
            onClick={handleTrainClick}
            disabled={(!startPos || !goalPos) || isSaving}
            title={!startPos || !goalPos ? 'Önce başlangıç ve hedef noktalarını seç' : ''}>
            {isSaving
              ? '⏳ Kaydediliyor…'
              : isTraining
                ? '⏹ Testi Sonlandır'
                : 'Testi Başlat →'}
          </button>
        </div>
      </div>

      {/* Backend durum bildirimi */}
      {saveStatus && saveStatus === 'error' && (
        <div className="save-toast save-toast--error" role="status">
          ✗ Backend bağlantı hatası — konsolu kontrol et
        </div>
      )}

      {/* Backend Hata Toast Bildirimi */}
      {lastAction && lastAction.error && (
        <div className="save-toast save-toast--error" role="status" style={{ margin: '10px auto', maxWidth: '480px' }}>
          ✗ Simülasyon Hatası: {lastAction.error}
        </div>
      )}

      {/* Ajan Karar Analitiği Dashboard */}
      {lastAction && !lastAction.error && lastAction.reward !== undefined && lastAction.q_values !== undefined && (
        <div style={{
          background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
          border: '1px solid #38bdf8',
          boxShadow: '0 8px 32px rgba(56, 189, 248, 0.15)',
          borderRadius: '10px',
          padding: '10px 14px',
          color: '#f8fafc',
          maxWidth: '480px',
          margin: '10px auto 15px auto',
          fontFamily: "'Outfit', 'Inter', sans-serif"
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
            <h3 style={{ margin: 0, fontSize: '13px', color: '#38bdf8', letterSpacing: '1px' }}>
              🧠 Ajan Karar Analitiği
            </h3>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {lastAction.shield_triggered && (
                <span style={{
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: '#38bdf8',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  border: '1px solid #0284c7',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  boxShadow: '0 0 8px rgba(56, 189, 248, 0.3)',
                  animation: 'pulse 1.5s infinite'
                }}>
                  🛡️ KALKAN MÜDAHALESİ!
                </span>
              )}
              <span style={{
                background: '#1e293b',
                padding: '2px 6px',
                borderRadius: '4px',
                fontSize: '11px',
                border: '1px solid #334155'
              }}>
                Son Yön: <strong style={{ color: '#38bdf8' }}>{
                  (() => {
                    const val = lastAction.action_label?.toUpperCase();
                    if (val === 'LEFT') return 'SOL (←)';
                    if (val === 'RIGHT') return 'SAĞ (→)';
                    if (val === 'UP') return 'YUKARI (↑)';
                    if (val === 'DOWN') return 'AŞAĞI (↓)';
                    if (val === 'STAY') return 'BEKLE (⏸)';
                    return lastAction.action_label;
                  })()
                }</strong>
              </span>
              <span style={{
                background: lastAction.reward >= 0 ? 'rgba(63, 185, 80, 0.15)' : 'rgba(248, 81, 73, 0.15)',
                color: lastAction.reward >= 0 ? '#3fb950' : '#f85149',
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                border: lastAction.reward >= 0 ? '1px solid #3fb950' : '1px solid #f85149',
                fontWeight: 'bold'
              }}>
                Adım Ödülü: {lastAction.reward >= 0 ? `+${lastAction.reward.toFixed(2)}` : lastAction.reward.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Probability Bars */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {(() => {
              const labels = lastAction.q_values?.length === 5
                ? ['SOL (←)', 'SAĞ (→)', 'YUKARI (↑)', 'AŞAĞI (↓)', 'BEKLE (⏸)']
                : ['SOL (←)', 'SAĞ (→)', 'YUKARI (↑)', 'AŞAĞI (↓)'];
              const probs = getProbabilities(lastAction.q_values);
              return probs.map((prob, idx) => {
                const qVal = lastAction.q_values[idx];
                const isChosen = lastAction.action === idx || (idx === 4 && lastAction.action_label === 'STAY');
                return (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', fontSize: '12px' }}>
                    <div style={{ width: '80px', fontWeight: isChosen ? 'bold' : 'normal', color: isChosen ? '#38bdf8' : '#94a3b8' }}>
                      {labels[idx]}
                    </div>
                    <div style={{ flex: 1, height: '6px', background: '#334155', borderRadius: '3px', margin: '0 8px', overflow: 'hidden', position: 'relative' }}>
                      <div style={{
                        width: `${(prob * 100).toFixed(1)}%`,
                        height: '100%',
                        background: isChosen ? 'linear-gradient(90deg, #38bdf8, #0ea5e9)' : '#475569',
                        borderRadius: '3px',
                        transition: 'width 0.3s ease-out'
                      }} />
                    </div>
                    <div style={{ width: '35px', textAlign: 'right', fontWeight: 'bold', color: isChosen ? '#38bdf8' : '#64748b' }}>
                      {(prob * 100).toFixed(0)}%
                    </div>
                    <div style={{ width: '55px', textAlign: 'right', fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }}>
                      ({qVal !== undefined ? qVal.toFixed(2) : '0.00'})
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}

      {view3D ? (
        <Simulation3D
          size={size}
          baseGrid={baseGrid}
          agentPos={agentPos}
          goalPos={goalPos}
          waypoints={waypoints}
          currentWaypointIndex={currentWaypointIndex}
          trafficLights={trafficLights}
          lightsGreen={lightsGreen}
          dynamicObstacles={dynamicObstacles}
          lastAction={lastAction}
          simSpeed={simSpeed}
          theme={theme}
          raceMode={raceMode}
          racer1Pos={racer1Pos}
          racer2Pos={racer2Pos}
          racer1LastAction={racer1LastAction}
          racer2LastAction={racer2LastAction}
          racer1Model={racer1Model}
          racer2Model={racer2Model}
          racerPositions={[racer1Pos, racer2Pos, racer3Pos, racer4Pos, racer5Pos]}
          racerLastActions={[racer1LastAction, racer2LastAction, racer3LastAction, racer4LastAction, racer5LastAction]}
          racerModels={[racer1Model, racer2Model, racer3Model, racer4Model, racer5Model]}
        />
      ) : (
        <Grid grid={displayGrid} onCellClick={handleCellClick}
          size={size} center={center} indexToCoord={indexToCoord} activeMode={mode}
          racerModels={[racer1Model, racer2Model, racer3Model, racer4Model, racer5Model]}
          agentShieldTriggered={lastAction?.shield_triggered}
          racerShields={[
            racer1LastAction?.shield_triggered,
            racer2LastAction?.shield_triggered,
            racer3LastAction?.shield_triggered,
            racer4LastAction?.shield_triggered,
            racer5LastAction?.shield_triggered
          ]}
        />
      )}

      <div className="legend" role="list">
        <div className="legend-item"><span className="legend-dot legend-dot--start" />Başlangıç {startCoord ? `(${startCoord.x},${startCoord.y})` : '— seçilmedi'}</div>
        <div className="legend-item"><span className="legend-dot legend-dot--agent" />{themeLabels[theme]?.agent ?? 'Ajan'}</div>
        <div className="legend-item"><span className="legend-dot" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', width: '12px', height: '12px' }}>📍</span>{themeLabels[theme]?.waypoint ?? 'Duraklar'} {waypoints.length > 0 ? waypoints.map(w => { const c = indexToCoord(w.row, w.col, size); return `(${c.x},${c.y})`; }).join(', ') : '— seçilmedi'}</div>
        <div className="legend-item"><span className="legend-dot" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', width: '12px', height: '12px' }}>🚦</span>{themeLabels[theme]?.traffic ?? 'Sinyalizasyon'} ({lightsGreen ? '🟩 YEŞİL / AKTİF' : '🟥 KIRMIZI / DUR'})</div>
        <div className="legend-item"><span className="legend-dot legend-dot--goal" />{themeLabels[theme]?.goal ?? 'Hedef'} {goalCoord ? `(${goalCoord.x},${goalCoord.y})` : '— seçilmedi'}</div>
        <div className="legend-item"><span className="legend-dot legend-dot--obstacle" />{themeLabels[theme]?.obstacle ?? 'Sabit Engel'}</div>
        <div className="legend-item"><span className="legend-dot legend-dot--dynamic" />{themeLabels[theme]?.dynamic ?? 'Hareketli Engel'}</div>
        <div className="legend-item legend-item--axis"><span className="legend-axis-icon">＋</span>Orijin (0,0)</div>
      </div>

      {/* Notifications Panel */}
      {notifications.length > 0 && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          maxWidth: '360px',
          pointerEvents: 'none'
        }}>
          {notifications.map(n => {
            const isFinish = n.type === 'finish';
            const isShield = n.type === 'shield';
            return (
              <div key={n.id} style={{
                background: isFinish ? 'rgba(6, 25, 18, 0.97)' : isShield ? 'rgba(13, 25, 38, 0.97)' : 'rgba(13, 17, 23, 0.95)',
                border: `1px solid ${isFinish ? '#10b981' : isShield ? '#38bdf8' : '#ef4444'}`,
                boxShadow: isFinish
                  ? '0 0 18px rgba(16, 185, 129, 0.5), 0 0 6px rgba(16, 185, 129, 0.2)'
                  : isShield
                  ? '0 0 18px rgba(56, 189, 248, 0.5), 0 0 6px rgba(56, 189, 248, 0.2)'
                  : '0 0 15px rgba(239, 68, 68, 0.4)',
                color: '#ffffff',
                padding: '12px 18px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 'bold',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                animation: 'slideIn 0.3s ease-out forwards',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                pointerEvents: 'auto'
              }}>
                <span style={{ color: isFinish ? '#6ee7b7' : isShield ? '#7dd3fc' : '#ffffff' }}>{n.message}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* GAME OVER / SUCCESS POPUP MODAL */}
      {modalState.show && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(13, 17, 23, 0.85)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 9999,
          animation: 'fadeIn 0.3s ease-out'
        }}>
          <div style={{
            background: modalState.type === 'success' ? 'linear-gradient(135deg, #1e291b 0%, #0d1117 100%)' : 'linear-gradient(135deg, #2d1e1e 0%, #0d1117 100%)',
            border: modalState.type === 'success' ? '2px solid #3fb950' : '2px solid #f85149',
            borderRadius: '16px',
            padding: '40px',
            width: raceMode ? '560px' : '380px',
            textAlign: 'center',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)',
            animation: 'scaleUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
            position: 'relative',
            overflow: 'hidden',
            transition: 'width 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)'
          }}>
            {/* Background Glow */}
            <div style={{
              position: 'absolute',
              top: '-50%', left: '-50%', right: '-50%', bottom: '-50%',
              background: modalState.type === 'success' ? 'radial-gradient(circle, rgba(63, 185, 80, 0.15) 0%, transparent 70%)' : 'radial-gradient(circle, rgba(248, 81, 73, 0.15) 0%, transparent 70%)',
              zIndex: 0,
              pointerEvents: 'none'
            }} />

            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{
                fontSize: '60px',
                marginBottom: '20px',
                animation: 'bounce 1s infinite alternate'
              }}>
                {modalState.type === 'success' ? '🏆' : '💀'}
              </div>
              <h2 style={{
                fontSize: '32px',
                margin: '0 0 10px 0',
                color: modalState.type === 'success' ? '#3fb950' : '#f85149',
                fontFamily: "'Outfit', 'Inter', sans-serif",
                textTransform: 'uppercase',
                letterSpacing: '2px',
                textShadow: modalState.type === 'success' ? '0 0 10px rgba(63,185,80,0.3)' : '0 0 10px rgba(248,81,73,0.3)'
              }}>
                {raceMode ? 'YARIŞ TAMAMLANDI!' : (modalState.type === 'success' ? 'HEDEFE ULAŞILDI!' : 'GAME OVER!')}
              </h2>
              <p style={{
                color: '#8b949e',
                fontSize: '15px',
                margin: '0 0 20px 0',
                lineHeight: '1.6'
              }}>
                {raceMode
                  ? 'Tüm yarışmacılar bitiş çizgisine ulaştı veya elendi!'
                  : (modalState.type === 'success'
                      ? 'Ajan engelleri başarıyla aşarak hedefe güvenli bir şekilde ulaştı!'
                      : 'Ajan bir engele çarptı veya sınırların dışına çıktı!')}
              </p>

              {raceMode ? (
                /* Premium Race Rankings Table */
                <div style={{
                  background: 'rgba(22, 27, 34, 0.8)',
                  backdropFilter: 'blur(12px)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '12px',
                  padding: '16px',
                  marginBottom: '25px',
                  textAlign: 'left'
                }}>
                  <h3 style={{
                    color: '#c9d1d9',
                    fontSize: '14px',
                    textTransform: 'uppercase',
                    letterSpacing: '1.5px',
                    margin: '0 0 12px 0',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                    paddingBottom: '8px',
                    fontFamily: "'Outfit', sans-serif"
                  }}>
                    🏁 Yarış Sonuçları & Sıralama
                  </h3>
                  
                  <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', fontFamily: 'monospace' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', color: '#8b949e' }}>
                          <th style={{ padding: '6px 4px', textAlign: 'center', width: '30px' }}>#</th>
                          <th style={{ padding: '6px 8px', textAlign: 'left' }}>Yarışçı</th>
                          <th style={{ padding: '6px 8px', textAlign: 'left' }}>Model</th>
                          <th style={{ padding: '6px 8px', textAlign: 'center', width: '90px' }}>Durum</th>
                          <th style={{ padding: '6px 8px', textAlign: 'right', width: '50px' }}>Adım</th>
                          <th style={{ padding: '6px 8px', textAlign: 'right', width: '50px' }}>Skor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...raceRankings]
                          .sort((a, b) => {
                            if (a.status === 'finished' && b.status !== 'finished') return -1;
                            if (a.status !== 'finished' && b.status === 'finished') return 1;
                            if (a.status === 'finished' && b.status === 'finished') {
                              return a.steps - b.steps; // Fewer steps is better
                            }
                            return b.steps - a.steps; // Survived longer is better
                          })
                          .map((r, index) => {
                            const isWin = r.status === 'finished';
                            const badgeBg = isWin ? 'rgba(35, 134, 54, 0.2)' : 'rgba(218, 54, 51, 0.2)';
                            const badgeColor = isWin ? '#58a6ff' : '#f85149';
                            const rowBg = index === 0 && isWin ? 'rgba(217, 180, 0, 0.08)' : 'transparent';
                            const medal = index === 0 && isWin ? '🥇 ' : (index === 1 && isWin ? '🥈 ' : (index === 2 && isWin ? '🥉 ' : ''));
                            
                            return (
                              <tr key={r.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)', background: rowBg }}>
                                <td style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 'bold', color: index === 0 && isWin ? '#fbbf24' : '#c9d1d9' }}>
                                  {index + 1}
                                </td>
                                <td style={{ padding: '8px 8px', color: '#ffffff', fontWeight: 'bold' }}>
                                  {medal}{r.name}
                                </td>
                                <td style={{ padding: '8px 8px', color: '#c9d1d9', fontSize: '11.5px' }}>
                                  {r.model}
                                </td>
                                <td style={{ padding: '8px 8px', textAlign: 'center' }}>
                                  <span style={{
                                    background: badgeBg,
                                    color: badgeColor,
                                    border: `1px solid ${badgeColor}44`,
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    fontSize: '10px',
                                    fontWeight: 'bold',
                                    textTransform: 'uppercase'
                                  }}>
                                    {isWin ? '🏁 BİTİRDİ' : '💥 ELENDİ'}
                                  </span>
                                </td>
                                <td style={{ padding: '8px 8px', textAlign: 'right', color: '#58a6ff' }}>
                                  {r.steps}
                                </td>
                                <td style={{ padding: '8px 8px', textAlign: 'right', color: r.reward >= 0 ? '#56d364' : '#f85149', fontWeight: 'bold' }}>
                                  {r.reward >= 0 ? `+${r.reward.toFixed(0)}` : r.reward.toFixed(0)}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                /* Stats Box */
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-around',
                  background: 'rgba(255, 255, 255, 0.05)',
                  borderRadius: '8px',
                  padding: '15px',
                  marginBottom: '25px',
                  border: '1px solid rgba(255, 255, 255, 0.1)'
                }}>
                  <div>
                    <div style={{ fontSize: '11px', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '1px' }}>Toplam Adım</div>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#38bdf8', marginTop: '4px' }}>
                      {modalState.steps}
                    </div>
                  </div>
                  <div style={{ width: '1px', background: 'rgba(255, 255, 255, 0.1)' }} />
                  <div>
                    <div style={{ fontSize: '11px', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '1px' }}>Toplam Ödül</div>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', color: (typeof modalState.reward === 'number' ? modalState.reward >= 0 : modalState.type === 'success') ? '#3fb950' : '#f85149', marginTop: '4px' }}>
                      {typeof modalState.reward === 'number' ? modalState.reward.toFixed(1) : (modalState.reward || '—')}
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={() => setModalState({ show: false, type: 'success' })}
                style={{
                  background: modalState.type === 'success' ? '#238636' : '#da3633',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '12px 30px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                  outline: 'none'
                }}
                onMouseOver={(e) => e.target.style.transform = 'translateY(-2px)'}
                onMouseOut={(e) => e.target.style.transform = 'translateY(0)'}
              >
                Kapat
              </button>
            </div>
          </div>

          <style>{`
            @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            @keyframes scaleUp {
              from { transform: scale(0.85); opacity: 0; }
              to { transform: scale(1); opacity: 1; }
            }
            @keyframes bounce {
              from { transform: translateY(0); }
              to { transform: translateY(-10px); }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}
