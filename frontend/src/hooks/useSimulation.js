// src/hooks/useSimulation.js
// WebSocket bağlantısı — wss://pointsense.onrender.com/ws/simulate

import { useRef, useCallback, useState, useEffect } from 'react';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'wss://pointsense.onrender.com/ws/simulate';

/**
 * Backend simülasyon WebSocket'ini yöneten hook.
 *
 * Kullanım:
 *   const { connect, disconnect, sendTick, connected } = useSimulation({
 *     onResponse: (res) => console.log(res.action, res.q_values),
 *     onError:    (msg) => console.error(msg),
 *   });
 *
 * @param {{ onResponse: Function, onError?: Function }} options
 */
export function useSimulation({ onResponse, onError }) {
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);

  // Stale closure'ları önlemek için callback'leri ref'lerde tutuyoruz.
  // Bu sayede WebSocket bağlantısı açıkken React state'leri güncellense bile 
  // ws.onmessage her zaman en güncel callback'i ve state'i çağırır.
  const onResponseRef = useRef(onResponse);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onResponseRef.current = onResponse;
  }, [onResponse]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const connect = useCallback(() => {
    // Zaten bağlıysa tekrar bağlanma
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      setConnected(true);
      console.log('[WS] Bağlantı kuruldu:', WS_URL);
    };

    ws.onclose = (e) => {
      setConnected(false);
      wsRef.current = null;
      console.log('[WS] Bağlantı kapandı:', e.code, e.reason);
    };

    ws.onerror = (e) => {
      console.error('[WS] Hata:', e);
      onErrorRef.current?.('WebSocket bağlantı hatası');
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        // Backend hata döndürdüyse
        if (data.error) { onErrorRef.current?.(data.error); return; }
        onResponseRef.current(data);
      } catch {
        onErrorRef.current?.('Geçersiz sunucu yanıtı');
      }
    };

    wsRef.current = ws;
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  /**
   * Backend'e bir tick gönderir.
   * @param {Object} tick  — AgentTickDTO formatında
   */
  const sendTick = useCallback((tick) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(tick));
    } else {
      console.warn('[WS] Bağlı değil, tick gönderilemedi');
    }
  }, []);

  return { connect, disconnect, sendTick, connected };
}
