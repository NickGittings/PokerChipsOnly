import { useEffect } from 'react';
import { money } from '../../shared/chips';
import type { Celebration } from '../net/useWinCelebration';

export function WinCelebration({ celebration, dismiss }: { celebration: Celebration | null; dismiss: () => void }) {
  useEffect(() => {
    if (!celebration) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [celebration, dismiss]);
  if (!celebration) return null;
  return <div className="win-celebration" role="status" aria-live="polite" onClick={dismiss}>
    <div className="win-celebration-card">
      {celebration.src && <img src={celebration.src} alt="" onError={event => { event.currentTarget.style.display = 'none'; }} />}
      <strong>You won {money(celebration.amount)}{celebration.winnerCount > 1 ? ` · split ${celebration.winnerCount} ways` : ''}!</strong>
      <span>Tap to dismiss</span>
    </div>
  </div>;
}
