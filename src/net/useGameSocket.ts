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
    let stopped = false, retries = 0, timeout: ReturnType<typeof setTimeout>;
    const connect = () => {
      if (stopped) return;
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`); socket.current = ws;
      ws.onopen = () => { retries = 0; ws.send(JSON.stringify({ type: 'join', token: deviceToken(), board })); };
      ws.onmessage = event => { const msg = JSON.parse(event.data) as ServerMsg; if (msg.type === 'state') { setSnapshot(msg.snapshot); setConnected(true); } else if (msg.type === 'error') setError(msg.message); };
      ws.onerror = () => ws.close();
      ws.onclose = () => { setConnected(false); if (!stopped) timeout = setTimeout(connect, Math.min(10000, 500 * 2 ** retries++) + Math.random() * 300); };
    };
    connect();
    const wake = () => { if (document.visibilityState === 'visible' && socket.current?.readyState === WebSocket.CLOSED) { clearTimeout(timeout); connect(); } };
    document.addEventListener('visibilitychange', wake);
    return () => { stopped = true; clearTimeout(timeout); document.removeEventListener('visibilitychange', wake); socket.current?.close(); };
  }, [board]);
  const send = useCallback((msg: ClientMsg) => { if (socket.current?.readyState === WebSocket.OPEN) { setError(''); socket.current.send(JSON.stringify(msg)); } else setError('Reconnecting to the table. Your seat is saved.'); }, []);
  return { snapshot, connected, send, error, clearError: () => setError('') };
}
