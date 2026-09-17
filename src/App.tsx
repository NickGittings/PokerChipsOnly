import { useEffect, useState } from 'react';
import { useGameSocket } from './net/useGameSocket';
import { useNotifications } from './net/useNotifications';
import { Notifications } from './components/Notifications';
import { SetupView } from './views/SetupView';
import { JoinView } from './views/JoinView';
import { LobbyView } from './views/LobbyView';
import { BoardView } from './views/BoardView';
import { PlayerView } from './views/PlayerView';
export function App() {
  const [pathname, setPathname] = useState(location.pathname);
  const board = pathname === '/board', setup = pathname === '/setup';
  useEffect(() => {
    const pop = () => setPathname(location.pathname);
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a') : null;
      if (!link || link.target || link.hasAttribute('download')) return;
      const url = new URL(link.href);
      if (url.origin !== location.origin || !['/', '/setup', '/play', '/board'].includes(url.pathname)) return;
      event.preventDefault(); history.pushState(null, '', url.pathname); setPathname(url.pathname); window.scrollTo(0, 0);
    };
    window.addEventListener('popstate', pop); document.addEventListener('click', navigate);
    return () => { window.removeEventListener('popstate', pop); document.removeEventListener('click', navigate); };
  }, []);
  const { snapshot, connected, send, error, clearError } = useGameSocket(board || setup);
  const notifications = useNotifications(snapshot, connected);
  useEffect(() => {
    if (!board) return;
    let lock: WakeLockSentinel | undefined, stopped = false;
    const acquire = async () => { if (document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return; try { const next = await navigator.wakeLock.request('screen'); if (stopped) await next.release(); else lock = next; } catch { /* Available only on supported secure origins. */ } };
    void acquire(); document.addEventListener('visibilitychange', acquire); return () => { stopped = true; void lock?.release(); document.removeEventListener('visibilitychange', acquire); };
  }, [board]);
  const props = snapshot ? { snapshot, send, connected } : null;
  const seated = snapshot?.game.players.some(p => p.id === snapshot.you.id);
  const showHeader = !board && (!snapshot || snapshot.game.phase === 'lobby' || !seated && !setup);
  return <>{showHeader && <header className="app-header"><a href="/" className="brand"><span className="brand-chip">♣</span><span>POKERCHIPS <small>ONLY</small></span></a><nav><span className={connected ? 'connection connected' : 'connection'}><i/>{connected ? 'Table connected' : 'Connecting…'}</span><a href={board ? '/' : '/board'}>{board ? 'Join table' : 'Table view'} <span>↗</span></a></nav></header>}
    {!connected && snapshot && <div className="connection-banner" role="status">Reconnecting… Your seat is saved. Actions are locked until you’re back.</div>}
    {error && <div className="error-banner" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={clearError}>×</button></div>}
    <Notifications {...notifications}/>
    {!props ? <main className="loading"><span className="brand-chip">♣</span><h1>Taking our seats…</h1><p>Connecting to your local table.</p></main> : setup && snapshot!.game.phase === 'lobby' ? <SetupView {...props}/> : board || setup && snapshot!.game.phase !== 'lobby' ? <BoardView {...props}/> : seated ? snapshot!.game.phase === 'lobby' ? <LobbyView {...props}/> : <PlayerView {...props}/> : <JoinView {...props}/>}
    <footer className="app-footer"><span>REAL CARDS. DIGITAL CHIPS.</span><span>Made for your home table <span className="gold-text">♣</span></span></footer></>;
}
