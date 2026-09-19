import type { Pot } from './types';

export interface PotRound { hand: number; pots: Pot[] }
export interface PotWin { hand: number; potIndex: number; amount: number; winnerCount: number }

/**
 * Pots that flipped from unawarded to awarded for `youId` between two snapshots.
 * Returns [] when `before` is null (first load, or a reconnect landing mid-hand) or when
 * the hand rolled over (pot indices from a prior hand carry no meaning).
 */
export function potWinsFor(before: PotRound | null, after: PotRound, youId: string): PotWin[] {
  if (!before || before.hand !== after.hand) return [];
  const wins: PotWin[] = [];
  after.pots.forEach((pot, potIndex) => {
    const was = before.pots[potIndex];
    const wasAwarded = !!was && was.awarded;
    if (!pot.awarded || wasAwarded || !pot.winnerIds?.includes(youId)) return;
    wins.push({ hand: after.hand, potIndex, amount: pot.amount, winnerCount: pot.winnerIds.length });
  });
  return wins;
}
