import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertHostContext } from './components/AlertHostContext';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { native } from './net/platform';
import { serverOrigin, setServerOrigin } from './net/serverOrigin';
import { useGameSocket } from './net/useGameSocket';
import { useNotifications } from './net/useNotifications';
import { useRoute } from './net/useRoute';
import { Notifications } from './components/Notifications';
import { PairView } from './views/PairView';
import { SetupView } from './views/SetupView';
import { JoinView } from './views/JoinView';
import { LobbyView } from './views/LobbyView';
import { BoardView } from './views/BoardView';
import { PlayerView } from './views/PlayerView';
import { HostSheet } from './components/HostPanel';
export function App() {
  const [alertHost, setAlertHost] = useState<HTMLDivElement | null>(null), [hostOpen, setHostOpen] = useState(false);
  const { route, navigate } = useRoute(), [origin, setOrigin] = useState(serverOrigin);
  const board = route === '/board', setup = route === '/setup';
  // A new table starts at the player view: a remembered /board or /setup would otherwise carry admin over to a table nobody chose it for.
  const pair = (next: string | null) => { navigate('/'); setServerOrigin(next); setOrigin(next); };
  const changeTable = native && <button type="button" className="change-table" onClick={() => { if (window.confirm('Disconnect from this table and pick another?')) pair(null); }}>Change table</button>;
  const backRoute = useRef(route), lastBack = useRef(0);
  backRoute.current = route;
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return;
    const listener = CapacitorApp.addListener('backButton', () => {
      const now = Date.now();
      if (now - lastBack.current < 300) return;
      lastBack.current = now;
      if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) { (document.activeElement as HTMLElement).blur(); return; }
      if (backRoute.current !== '/') { backRoute.current = '/'; navigate('/'); }
      else void CapacitorApp.exitApp();
    });
    return () => { void listener.then(handle => handle.remove()); };
  }, [navigate]);
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a') : null;
      if (!link || link.target || link.hasAttribute('download')) return;
      const url = new URL(link.href);
      if (url.protocol !== location.protocol || url.host !== location.host ||!['/', '/setup', '/board'].includes(url.pathname)) return;
      event.preventDefault(); navigate(url.pathname);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [navigate]);
  const { snapshot, connected, send, error, clearError } = useGameSocket(board || setup, origin);
  const notifications = useNotifications(snapshot, connected);
  useEffect(() => {
    if (!board) return;
    if (native) { void KeepAwake.keepAwake().catch(() => {}); return () => { void KeepAwake.allowSleep().catch(() => {}); }; }
    let lock: WakeLockSentinel | undefined, stopped = false;
    const acquire = async () => { if (document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return; try { const next = await navigator.wakeLock.request('screen'); if (stopped) await next.release(); else lock = next; } catch { /* Available only on supported secure origins. */ } };
    void acquire(); document.addEventListener('visibilitychange', acquire); return () => { stopped = true; void lock?.release(); document.removeEventListener('visibilitychange', acquire); };
  }, [board]);
  if (native && !origin) return <PairView onPair={pair}/>;
  const props = snapshot ? { snapshot, send, connected } : null;
  const seated = snapshot?.game.players.some(p => p.id === snapshot.you.id);
  const showHeader = !board && (!snapshot || snapshot.game.phase === 'lobby' || !seated && !setup);
  const alerts = <>
    {!connected && snapshot && <div className="connection-banner" role="status">Reconnecting… Your seat is saved. Actions are locked until you’re back.{changeTable && <> {changeTable}</>}</div>}
    {error && <div className="error-banner" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={clearError}>×</button></div>}
    <Notifications {...notifications}/>
  </>;
  return <AlertHostContext.Provider value={setAlertHost}>{showHeader && <header className="app-header"><a href="/" className="brand"><span className="brand-chip">♣</span><span>POKERCHIPS <small>ONLY</small></span></a><nav><span className={connected ? 'connection connected' : 'connection'}><i/>{connected ? 'Table connected' : 'Connecting…'}</span><a href={board ? '/' : '/board'}>{board ? 'Join table' : 'Table view'} <span>↗</span></a></nav></header>}
    {alertHost ? createPortal(alerts, alertHost) : alerts}
    {!props ? <main className="loading"><span className="brand-chip">♣</span><h1>Taking our seats…</h1><p>Connecting to your local table.</p></main> : setup && snapshot!.game.phase === 'lobby' ? <SetupView {...props}/> : board || setup && snapshot!.game.phase !== 'lobby' ? <BoardView {...props}/> : seated ? snapshot!.game.phase === 'lobby' ? <LobbyView {...props}/> : <PlayerView {...props}/> : <JoinView {...props}/>}
    {props && !board && !setup && !(seated && snapshot!.game.phase !== 'lobby') && <div className="host-sheet-dock"><HostSheet {...props} open={hostOpen} onToggle={setHostOpen}/></div>}
    <footer className="app-footer"><span>REAL CARDS. DIGITAL CHIPS.</span>{changeTable}<span>Made for your home table <span className="gold-text">♣</span></span></footer></AlertHostContext.Provider>;
}
