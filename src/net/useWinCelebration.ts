import { useCallback, useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../../shared/types';
import { potWinsFor } from '../../shared/winCelebration';
import { potShares } from '../../shared/potShares';

const images = Object.values(
  import.meta.glob('../assets/wins/*.{png,jpg,jpeg,webp,gif,svg}', { eager: true, query: '?url', import: 'default' }),
) as string[];

export type Celebration = { id: number; src: string | null; amount: number };

export function useWinCelebration(snapshot: Snapshot | null, connected: boolean, hold: boolean) {
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const previous = useRef<Snapshot | null>(null), sequence = useRef(0);
  const pending = useRef(new Set<number>());
  const displayed = useRef(new Set<number>());
  const lastImage = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const dismiss = useCallback(() => { clearTimeout(timer.current); displayed.current.clear(); setCelebration(null); }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!snapshot || !connected) {
      previous.current = null;
      pending.current.clear();
      dismiss();
      return;
    }
    const before = previous.current;
    const sameContext = before?.game.hand === snapshot.game.hand && before.you.id === snapshot.you.id;
    if (!sameContext) { pending.current.clear(); dismiss(); }
    const wins = potWinsFor(sameContext ? before.game : null, snapshot.game, snapshot.you.id);
    previous.current = snapshot;
    // An undo can revoke a visible award without opening a dealer dialog.
    for (const index of displayed.current) {
      const pot = snapshot.game.pots[index];
      if (!pot?.awarded || !pot.winnerIds?.includes(snapshot.you.id)) { dismiss(); break; }
    }
    // Undo must remove a queued award before it can be celebrated.
    for (const index of pending.current) {
      const pot = snapshot.game.pots[index];
      if (!pot?.awarded || !pot.winnerIds?.includes(snapshot.you.id)) pending.current.delete(index);
    }
    for (const win of wins) pending.current.add(win.potIndex);
    if (hold) { dismiss(); return; }
    if (!pending.current.size) return;
    const amount = [...pending.current].reduce((total, index) => {
      const pot = snapshot.game.pots[index];
      return total + (potShares(snapshot.game, pot, pot.winnerIds ?? []).find(({ player }) => player.id === snapshot.you.id)?.amount ?? 0);
    }, 0);
    displayed.current = new Set(pending.current);
    pending.current.clear();
    clearTimeout(timer.current);
    const choices = images.length > 1 ? images.filter(src => src !== lastImage.current) : images;
    const src = choices.length ? choices[Math.floor(Math.random() * choices.length)] : null;
    lastImage.current = src;
    setCelebration({ id: ++sequence.current, src, amount });
    timer.current = setTimeout(dismiss, 10000);
    try { navigator.vibrate?.([80, 50, 80]); } catch { /* Vibration is optional. */ }
  }, [snapshot, connected, hold, dismiss]);
  return { celebration: connected && !hold ? celebration : null, dismiss };
}
