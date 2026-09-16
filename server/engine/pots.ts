import type { GameState, Player, Pot } from '../../shared/types';
import { chipUnit, money } from '../../shared/chips';
import { finishHand } from './tournament';
import { log } from './helpers';
export function buildPots(players: Player[]): Pot[] {
  const ante = players.reduce((n, p) => n + (p.deadAnte ?? 0), 0);
  const anteEligible = players.filter(p => p.status === 'active' || p.status === 'all-in').map(p => p.id).sort();
  players = players.map(p => ({ ...p, committedThisHand: p.committedThisHand - (p.deadAnte ?? 0) }));
  const levels = [...new Set(players.map(p => p.committedThisHand).filter(n => n > 0))].sort((a, b) => a - b), pots: Pot[] = [];
  if (ante) pots.push({ amount: ante, eligibleIds: anteEligible, awarded: false });
  let previous = 0;
  for (const level of levels) {
    const contributing = players.filter(p => p.committedThisHand >= level);
    const eligibleIds = contributing.filter(p => p.status !== 'folded' && p.status !== 'busted' && p.status !== 'sitting-out').map(p => p.id).sort();
    const amount = (level - previous) * contributing.length, last = pots.at(-1);
    if (last && last.eligibleIds.join() === eligibleIds.join()) last.amount += amount;
    else pots.push({ amount, eligibleIds, awarded: false });
    previous = level;
  }
  return pots;
}
export function refundUncalled(g: GameState) {
  const sorted = [...g.players].sort((a, b) => b.committedThisStreet - a.committedThisStreet);
  const highest = sorted[0], second = sorted[1]?.committedThisStreet ?? 0;
  if (highest && highest.status !== 'folded' && highest.committedThisStreet > second) {
    const refund = highest.committedThisStreet - second; highest.stack += refund; highest.committedThisHand -= refund; highest.committedThisStreet -= refund;
    if (highest.status === 'all-in') highest.status = 'active'; log(g, `${money(refund)} uncalled returned to ${highest.name}.`);
  }
}
export function awardPots(state: GameState, potIndex: number, winnerIds: string[]) {
  const g = structuredClone(state), pot = g.pots[potIndex];
  if (g.phase !== 'showdown' || !pot || pot.awarded || potIndex !== g.pots.findIndex(p => !p.awarded)) throw new Error('Award the next unclaimed pot.');
  if (!Array.isArray(winnerIds) || !winnerIds.length || new Set(winnerIds).size !== winnerIds.length || winnerIds.some(id => !pot.eligibleIds.includes(id))) throw new Error('Select one or more eligible winners.');
  const winners = g.players.filter(p => winnerIds.includes(p.id)).sort((a, b) => ((a.seat - g.button + 7) % 8) - ((b.seat - g.button + 7) % 8));
  const unit = chipUnit(g.config.denominations), units = pot.amount / unit, share = Math.floor(units / winners.length), extra = units % winners.length;
  winners.forEach((p, i) => { p.stack += (share + (i < extra ? 1 : 0)) * unit; });
  pot.awarded = true; pot.winnerIds = winnerIds;
  log(g, `${potIndex === 0 ? 'Main pot' : `Side pot ${potIndex}`} ${money(pot.amount)} → ${winners.map(p => p.name).join(' + ')}.`);
  if (g.pots.every(p => p.awarded)) finishHand(g);
  return g;
}
