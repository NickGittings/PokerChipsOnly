import { useCallback, useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../../shared/types';
import { potWinsFor } from '../../shared/winCelebration';

const images = Object.values(
  import.meta.glob('../assets/wins/*.{png,jpg,jpeg,webp,gif,svg}', { eager: true, query: '?url', import: 'default' }),
) as string[];

export type Celebration = { id: number; src: string | null; amount: number; winnerCount: number };

export function useWinCelebration(snapshot: Snapshot | null, connected: boolean) {
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const previous = useRef<Snapshot | null>(null), sequence = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const dismiss = useCallback(() => { clearTimeout(timer.current); setCelebration(null); }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!snapshot) { previous.current = null; return; }
    if (!connected) return;
    const before = previous.current;
    const wins = potWinsFor(before && { hand: before.game.hand, pots: before.game.pots }, { hand: snapshot.game.hand, pots: snapshot.game.pots }, snapshot.you.id);
    previous.current = snapshot;
    if (!wins.length) return;
    const win = wins[wins.length - 1];
    clearTimeout(timer.current);
    setCelebration({ id: ++sequence.current, src: images.length ? images[Math.floor(Math.random() * images.length)] : null, amount: win.amount, winnerCount: win.winnerCount });
    timer.current = setTimeout(() => setCelebration(null), 3500);
    try { navigator.vibrate?.([80, 50, 80]); } catch { /* Vibration is optional. */ }
  }, [snapshot, connected]);
  return { celebration, dismiss };
}
