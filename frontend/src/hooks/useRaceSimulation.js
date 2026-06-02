// src/hooks/useRaceSimulation.js
import { useRef, useCallback, useState, useEffect } from 'react';

const MODEL_API = import.meta.env.VITE_MODEL_API_URL ?? 'http://localhost:8000';
// Convert http:// to ws:// for WebSocket url
const WS_RACE_URL = MODEL_API.replace(/^http/, 'ws') + '/ws/race';

/**
 * Backend çoklu yarış simülasyon WebSocket'ini yöneten hook.
 *
 * Kullanım:
 *   const { connect, disconnect, sendTick, connected } = useRaceSimulation({
 *     onResponse: (res) => console.log(res.racer1, res.racer2),
 *     onError:    (msg) => console.error(msg),
 *   });
 */
export function useRaceSimulation({ onResponse, onError }) {
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);

  const onResponseRef = useRef(onResponse);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onResponseRef.current = onResponse;
  }, [onResponse]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_RACE_URL);

    ws.onopen = () => {
      setConnected(true);
      console.log('[WS RACE] Bağlantı kuruldu:', WS_RACE_URL);
    };

    ws.onclose = (e) => {
      setConnected(false);
      wsRef.current = null;
      console.log('[WS RACE] Bağlantı kapandı:', e.code, e.reason);
    };

    ws.onerror = (e) => {
      console.error('[WS RACE] Hata:', e);
      onErrorRef.current?.('WebSocket yarış bağlantı hatası');
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.error) { onErrorRef.current?.(data.error); return; }
        onResponseRef.current(data);
      } catch {
        onErrorRef.current?.('Geçersiz yarış sunucusu yanıtı');
      }
    };

    wsRef.current = ws;
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  const sendTick = useCallback((tick) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(tick));
    } else {
      console.warn('[WS RACE] Bağlı değil, tick gönderilemedi');
    }
  }, []);

  return { connect, disconnect, sendTick, connected };
}
