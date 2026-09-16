import type { GameState } from '../../shared/types';
import { chipUnit } from '../../shared/chips';
import { blindLevel } from '../../shared/blinds';
import { placeOf } from '../../shared/standings';
import { log } from './helpers';
export function tickClock(state: GameState, now: number): GameState {
  const g = structuredClone(state);
  if (!g.clockPaused && !['lobby', 'tournament-over'].includes(g.phase)) {
    g.clockRemainingMs -= Math.max(0, now - g.clockUpdatedAt);
    const length = g.config.levelMinutes * 60_000;
    if (g.clockRemainingMs <= 0) { const levels = Math.floor(-g.clockRemainingMs / length) + 1; g.pendingLevel += levels; g.clockRemainingMs += levels * length; }
  }
  g.clockUpdatedAt = now; return g;
}
export function finishHand(g: GameState) {
  const alive = g.players.filter(p => p.stack > 0);
  const busted = g.players.filter(p => p.stack === 0 && p.status !== 'busted').sort((a, b) => b.handStartStack - a.handStartStack || a.seat - b.seat);
  // Assign worst-to-best so ties (equal handStartStack) share one sequence value,
  // then rank is derived fresh from bustOrder by shared/standings — see its header.
  let lastStack = -1, order = g.bustSequence;
  for (const p of [...busted].reverse()) { if (p.handStartStack !== lastStack) order = ++g.bustSequence; p.status = 'busted'; p.bustOrder = order; lastStack = p.handStartStack; }
  for (const p of busted) log(g, `${p.name} finishes #${placeOf(g, p)}.`);
  for (const p of g.players) { p.committedThisHand = 0; p.committedThisStreet = 0; p.deadAnte = 0; }
  g.actorId = null; g.currentBet = 0;
  g.phase = alive.length === 1 ? 'tournament-over' : 'hand-complete';
  if (alive.length === 1) { g.clockPaused = true; log(g, `${alive[0].name} wins the tournament!`); }
}
export function adjustStack(state: GameState, id: string, delta: number) {
  const g = structuredClone(state), p = g.players.find(p => p.id === id), unit = chipUnit(g.config.denominations);
  if (!['hand-complete', 'tournament-over'].includes(g.phase)) throw new Error('Adjust stacks between hands. Starting stacks are configured in setup; undo an action to fix a live hand.');
  if (!p || !Number.isSafeInteger(delta) || delta === 0 || delta % unit || p.stack + delta < 0 || g.totalChips + delta > 1_000_000 || g.totalChips + delta <= 0) throw new Error('Enter a makeable adjustment that keeps stacks nonnegative and total chips at most 1,000,000.');
  p.stack += delta; g.totalChips += delta;
  if (p.stack > 0) { p.status = 'active'; delete p.bustOrder; }
  else { p.status = 'busted'; p.bustOrder = ++g.bustSequence; }
  if (g.phase !== 'lobby') g.phase = g.players.filter(p => p.stack > 0).length > 1 ? 'hand-complete' : 'tournament-over';
  log(g, `Host adjusted ${p.name}: ${delta > 0 ? '+' : ''}${delta} chips.`); return g;
}
export function colorUpSuggested(g: GameState) { return g.config.denominations.length > 2 && chipUnit(g.config.denominations) < blindLevel(g.config, g.level).small / 10; }
export function colorUp(state: GameState) {
  const g = structuredClone(state);
  if (!['lobby', 'hand-complete'].includes(g.phase)) throw new Error('Color up between hands.');
  if (g.config.denominations.length <= 2) throw new Error('Keep at least two chip denominations.');
  const smallest = chipUnit(g.config.denominations), remaining = g.config.denominations.filter(d => d.value !== smallest), unit = chipUnit(remaining);
  if (g.players.some(p => p.stack % unit) || remaining.some(d => d.value % unit)) throw new Error('Cannot color up exactly: stacks and remaining chips must be multiples of the next chip. Make change first.');
  g.config.denominations = remaining; log(g, `Colored up ${smallest} chips without changing any stack.`); return g;
}
