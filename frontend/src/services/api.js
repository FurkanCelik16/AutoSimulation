// src/services/api.js
// REST API — https://pointsense.onrender.com

const BASE = import.meta.env.VITE_API_URL ?? 'https://pointsense.onrender.com';

/**
 * Haritayı backend'e kaydeder.
 * @param {Object} mapPayload  — GameMapDTO formatında obje
 * @returns {{ status: string, map_name: string }}
 */
export async function saveMap(mapPayload) {
  const res = await fetch(`${BASE}/maps/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mapPayload),
  });
  if (!res.ok) throw new Error(`Harita kaydedilemedi: ${res.status}`);
  return res.json();
}

/**
 * Kayıtlı tüm harita isimlerini döner.
 * @returns {string[]}
 */
export async function listMaps() {
  const res = await fetch(`${BASE}/maps`);
  if (!res.ok) throw new Error(`Liste alınamadı: ${res.status}`);
  return res.json();
}

/**
 * Belirtilen isimli haritayı döner.
 * @param {string} name
 * @returns {Object|null}  — GameMapDTO veya null (404)
 */
export async function getMap(name) {
  const res = await fetch(`${BASE}/maps/${encodeURIComponent(name)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Harita alınamadı: ${res.status}`);
  return res.json();
}

/**
 * Belirtilen haritayı siler.
 * @param {string} name
 * @returns {boolean}
 */
export async function deleteMap(name) {
  const res = await fetch(`${BASE}/maps/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
  return res.ok;
}

/**
 * Frontend grid state'ini backend GameMapDTO formatına çevirir.
 *
 * @param {{ mapName: string, size: number, baseGrid: string[][], dynamicObstacles: Object[], startPos: Object|null, goalPos: Object|null }} params
 * @returns {Object}  — POST /maps/save'e gönderilecek payload
 */
export function buildGameMapDTO({ mapName, size, baseGrid, dynamicObstacles, startPos, goalPos }) {
  const half = Math.floor(size / 2);

  // Grid (row,col) → koordinat (x,y)
  const toCoord = (row, col) => ({ x: col - half, y: half - row });

  // StaticObstacleDTO: x, y, w, h — grid hücreleri için w=1, h=1
  const staticObstacles = [];
  baseGrid.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (cell === 'obstacle') {
        const { x, y } = toCoord(r, c);
        staticObstacles.push({ x, y, w: 1, h: 1 });
      }
    })
  );

  // DynamicObstacleDTO: id, pos:{x,y}, velocity:{vx,vy}, range, type
  const dynamicObs = dynamicObstacles.map((o, idx) => {
    const { x, y } = toCoord(o.row, o.col);
    return {
      id:       idx + 1,
      pos:      { x, y },
      velocity: { vx: o.direction ?? 1, vy: 0 },
      range:    null,
      type:     o.pattern ?? 'linear-h',
    };
  });

  return {
    map_name:   mapName,
    grid_size:  { x: size, y: size },
    start_pos:  startPos ? toCoord(startPos.row, startPos.col) : { x: 0, y: 0 },
    target_pos: goalPos  ? toCoord(goalPos.row,  goalPos.col)  : { x: 1, y: 1 },
    obstacles: {
      static:  staticObstacles,
      dynamic: dynamicObs,
    },
  };
}
