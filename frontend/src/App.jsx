// src/App.jsx
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';

const MODEL_API = import.meta.env.VITE_MODEL_API_URL ?? 'http://localhost:8000';
import './App.css';
import Grid from './components/Grid';
import Simulation3D from './components/Simulation3D';
import useInterval from './hooks/useInterval';
import { saveMap, buildGameMapDTO } from './services/api';
import { useSimulation } from './hooks/useSimulation';

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

  // Mevcut modelleri backend'den çek
  useEffect(() => {
    fetch(`${MODEL_API}/models`)
      .then(res => res.json())
      .then(data => {
        setAvailableModels(data.models);
        setActiveModel(data.active_model);
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

  /* ── WebSocket simülasyon hook ── */
  const { connect, disconnect, sendTick, connected } = useSimulation({
    onResponse: useCallback((res) => {
      isWaitingForResponseRef.current = false;
      setLastAction(res);
      console.log('[SIM] Aksiyon:', res.action_label, '| Q:', res.q_values);

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

  // WebSocket bağlandığında ilk adımı göndererek simülasyonu başlat
  useEffect(() => {
    if (connected && isTraining && startPos && goalPos) {
      setAgentPos(startPos);
      console.log('[SIM] Simülasyon başlatılıyor, ilk adım gönderiliyor...');
      const activeTarget = (waypoints.length > 0 && currentWaypointIndexRef.current < waypoints.length) ? waypoints[currentWaypointIndexRef.current] : goalPos;
      isWaitingForResponseRef.current = true;
      sendTick({
        map_name: mapNameRef.current,
        is_first_tick: true,
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
    } else if (!connected) {
      setAgentPos(null);
    }
  }, [connected, isTraining, startPos, goalPos, waypoints, size, baseGrid, sendTick]);

  // Hareketi duraklatıp tekrar başlattığımızda simülasyonu devam ettir
  useEffect(() => {
    if (connected && isTraining && isMoving && agentPos && !isWaitingForResponseRef.current) {
      console.log('[SIM] Harekete devam ediliyor, adım gönderiliyor...');
      const activeTarget = (waypoints.length > 0 && currentWaypointIndexRef.current < waypoints.length)
        ? waypoints[currentWaypointIndexRef.current]
        : goalPos;

      const calculatedNextDyn = getNextDynamicObstacles(dynamicObstaclesRef.current);
      updateDynamicObstacles(calculatedNextDyn);

      isWaitingForResponseRef.current = true;
      sendTick({
        map_name: mapNameRef.current,
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

    if (agentPos) {
      dg[agentPos.row][agentPos.col] = 'agent';
    }
    return dg;
  }, [baseGrid, dynamicObstacles, agentPos, waypoints, currentWaypointIndex, trafficLights, lightsGreen]);

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

    // Eğitim zaten çalışıyorsa durdur
    if (isTraining) {
      disconnect();
      setIsTraining(false);
      setLastAction(null);
      return;
    }

    setIsSaving(true);
    setSaveStatus(null);

    try {
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
    } catch (err) {
      console.error('Başlatma hatası:', err);
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  }, [isTraining, startPos, goalPos, size, baseGrid, dynamicObstacles, connect, disconnect]);

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
          <select id="grid-size-select" className="select-grid-size" value={size} onChange={handleSizeChange}>
            {GRID_SIZES.map(s => <option key={s} value={s}>{s}×{s}</option>)}
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
              background: '#21262d',
              color: '#c9d1d9',
              border: '1px solid #30363d',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: '500'
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
              background: 'linear-gradient(135deg, #2e1065 0%, #0f172a 100%)',
              color: '#c084fc',
              border: '1px solid #7c3aed',
              boxShadow: '0 0 10px rgba(124, 58, 237, 0.2)',
              borderRadius: '6px',
              padding: '6px 10px',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontFamily: 'monospace',
              outline: 'none',
              transition: 'all 0.3s'
            }}
          >
            <option value="city" style={{ background: '#0f172a', color: '#fff' }}>🚗 Şehir</option>
            <option value="warehouse" style={{ background: '#0f172a', color: '#fff' }}>📦 Depo</option>
            <option value="mars" style={{ background: '#0f172a', color: '#fff' }}>🚀 Mars</option>
            <option value="hospital" style={{ background: '#0f172a', color: '#fff' }}>🏥 Hastane</option>
          </select>
        </div>
        <div className="control-divider" />

        {/* Harita adı input */}
        <div className="control-group">
          <input
            id="map-name-input"
            className="map-name-input"
            type="text"
            defaultValue={mapNameRef.current}
            onChange={e => { mapNameRef.current = e.target.value.trim() || 'harita1'; }}
            placeholder="Harita adı"
            maxLength={32}
          />
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
              background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
              color: '#38bdf8',
              border: '1px solid #0284c7',
              boxShadow: '0 0 10px rgba(2, 132, 199, 0.2)',
              borderRadius: '6px',
              padding: '6px 10px',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontFamily: 'monospace',
              outline: 'none',
              transition: 'all 0.3s'
            }}
          >
            {availableModels.map(m => (
              <option key={m.key} value={m.key} style={{ background: '#0f172a', color: '#fff' }}>
                {m.type === 'PPO' ? '🤖 PPO' : (m.type === 'A3C' ? '🧠 A3C' : '⚙️ DQN')} - {m.key.toUpperCase()}
              </option>
            ))}
          </select>
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

      {/* Ajan Karar Analitiği Dashboard */}
      {lastAction && (
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
        />
      ) : (
        <Grid grid={displayGrid} onCellClick={handleCellClick}
          size={size} center={center} indexToCoord={indexToCoord} activeMode={mode} />
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
            width: '380px',
            textAlign: 'center',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)',
            animation: 'scaleUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
            position: 'relative',
            overflow: 'hidden'
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
                {modalState.type === 'success' ? 'HEDEFE ULAŞILDI!' : 'GAME OVER!'}
              </h2>
              <p style={{
                color: '#8b949e',
                fontSize: '15px',
                margin: '0 0 20px 0',
                lineHeight: '1.6'
              }}>
                {modalState.type === 'success'
                  ? 'Ajan engelleri başarıyla aşarak hedefe güvenli bir şekilde ulaştı!'
                  : 'Ajan bir engele çarptı veya sınırların dışına çıktı!'}
              </p>

              {/* Stats Box */}
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
                  <div style={{ fontSize: '20px', fontWeight: 'bold', color: modalState.reward >= 0 ? '#3fb950' : '#f85149', marginTop: '4px' }}>
                    {modalState.reward ? modalState.reward.toFixed(1) : '0.0'}
                  </div>
                </div>
              </div>

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
