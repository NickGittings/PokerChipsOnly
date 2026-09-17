import type { GameState, LedgerKind, Player } from '../../shared/types';
export function log(g: GameState, text: string) { g.log.push({ id: ++g.logSequence, text }); g.log = g.log.slice(-150); }
export function record(g: GameState, p: Player, kind: LedgerKind, amount: number) { g.ledger.push({ hand: g.hand, playerId: p.id, name: p.name, kind, amount }); g.ledger = g.ledger.slice(-1000); }
export function nextSeat(players: Player[], seat: number) { return [...players].sort((a, b) => ((a.seat - seat + 7) % 8) - ((b.seat - seat + 7) % 8))[0]; }
export const contenders = (g: GameState) => g.players.filter(p => p.status === 'active' || p.status === 'all-in');
export function pay(p: Player, amount: number, street = true, deadAnte = false) { const paid = Math.min(p.stack, amount); p.stack -= paid; p.committedThisHand += paid; if (street) p.committedThisStreet += paid; if (deadAnte) p.deadAnte = (p.deadAnte ?? 0) + paid; if (!p.stack) p.status = 'all-in'; return paid; }
export function assertChips(g: GameState) {
  const stacks = g.players.reduce((n, p) => n + p.stack, 0);
  const pot = g.phase === 'showdown' ? g.pots.filter(p => !p.awarded).reduce((n, p) => n + p.amount, 0) : g.players.reduce((n, p) => n + p.committedThisHand, 0);
  if (stacks + pot !== g.totalChips || g.players.some(p => !Number.isSafeInteger(p.stack) || p.stack < 0 || p.committedThisStreet < 0 || p.committedThisHand < 0) || g.eliminated.some(p => p.stack !== 0)) throw new Error('Chip accounting invariant failed.');
}
