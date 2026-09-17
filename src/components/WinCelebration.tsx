import { useContext, useEffect } from 'react';
import { AlertHostContext } from './AlertHostContext';
import { money } from '../../shared/chips';
import type { Celebration } from '../net/useWinCelebration';
import { useDialogFocus } from './useDialogFocus';

export function WinCelebration({ celebration, dismiss }: { celebration: Celebration | null; dismiss: () => void }) {
  const alertHost = useContext(AlertHostContext);
  const dialogRef = useDialogFocus(!!celebration);
  useEffect(() => {
    if (!celebration) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [celebration, dismiss]);
  if (!celebration) return null;
  return <div className="win-celebration" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="win-title" onClick={dismiss}>
    <div className="win-celebration-card">
      {celebration.src && <img key={celebration.id} src={celebration.src} alt="" onError={event => { event.currentTarget.style.display = 'none'; }} />}
      <strong id="win-title">You won {money(celebration.amount)}!</strong>
      <button type="button" className="game-button" onClick={event => { event.stopPropagation(); dismiss(); }}>Dismiss celebration</button>
    </div>
    <div className="celebration-alerts" ref={alertHost} />
  </div>;
}
