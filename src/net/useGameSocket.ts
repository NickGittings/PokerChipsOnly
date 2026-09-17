import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMsg, ServerMsg, Snapshot } from '../../shared/types';
function deviceToken() {
  let token = localStorage.getItem('poker-device');
  if (!token) { const bytes = new Uint8Array(24); crypto.getRandomValues(bytes); token = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem('poker-device', token); }
  return token;
}
export function useGameSocket(board: boolean) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [connected, setConnected] = useState(false), [error, setError] = useState('');
  const socket = useRef<WebSocket | null>(null);
  useEffect(() => {
    setSnapshot(null); setConnected(false);
    let stopped = false, retries = 0, lastSnapshot = Date.now(), timeout: ReturnType<typeof setTimeout>;
    const disconnect = () => {
      const ws = socket.current; if (!ws) return;
      socket.current = null; setConnected(false);
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      ws.close();
      if (!stopped) timeout = setTimeout(connect, Math.min(10000, 500 * 2 ** retries++) + Math.random() * 300);
    };
    const connect = () => {
      if (stopped) return;
      lastSnapshot = Date.now();
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`); socket.current = ws;
      ws.onopen = () => { retries = 0; ws.send(JSON.stringify({ type: 'join', token: deviceToken(), board })); };
      ws.onmessage = event => { const msg = JSON.parse(event.data) as ServerMsg; if (msg.type === 'state') { lastSnapshot = Date.now(); setSnapshot(msg.snapshot); setConnected(true); } else if (msg.type === 'error') setError(msg.message); };
      ws.onerror = ws.onclose = disconnect;
    };
    connect();
    // A silent socket can stay OPEN indefinitely, including after a phone sleeps.
    const checkStale = () => { if (Date.now() - lastSnapshot >= 4000) disconnect(); };
    const watchdog = setInterval(checkStale, 1000);
    const wake = () => { if (document.visibilityState === 'visible') { checkStale(); if (!socket.current) { clearTimeout(timeout); connect(); } } };
    document.addEventListener('visibilitychange', wake);
    return () => { stopped = true; clearTimeout(timeout); clearInterval(watchdog); document.removeEventListener('visibilitychange', wake); disconnect(); };
  }, [board]);
  const send = useCallback((msg: ClientMsg) => { if (socket.current?.readyState === WebSocket.OPEN) { setError(''); socket.current.send(JSON.stringify(msg)); } else setError('Reconnecting to the table. Your seat is saved.'); }, []);
  return { snapshot, connected, send, error, clearError: () => setError('') };
}
