import type { Action, GameState, LegalActions, Player } from '../../shared/types';
import { blindLevel } from '../../shared/blinds';
import { chipUnit, money } from '../../shared/chips';
import { contenders, log, nextSeat, pay } from './helpers';
import { buildPots, refundUncalled } from './pots';
import { finishHand } from './tournament';
export function legalActions(g: GameState, id: string): LegalActions | null {
  const p = g.players.find(p => p.id === id);
  if (g.awaitingDeal || g.phase !== 'betting' || g.actorId !== id || p?.status !== 'active') return null;
  const owed = Math.max(0, g.currentBet - p.committedThisStreet), max = p.committedThisStreet + p.stack;
  const rights = !p.hasActedThisRound || g.currentBet - p.actedAtBet >= g.lastFullRaiseSize;
  const opponent = g.players.some(other => other.id !== id && other.status === 'active');
  const canRaise = rights && opponent && max > g.currentBet;
  const minRaiseTo = g.currentBet === 0 ? blindLevel(g.config, g.level).big : g.currentBet + g.lastFullRaiseSize;
  return { fold: true, check: owed === 0, call: Math.min(owed, p.stack), allIn: max <= g.currentBet || canRaise, canRaise, minRaiseTo, maxRaiseTo: max, currentCommitted: p.committedThisStreet };
}
export function isRoundComplete(g: GameState) {
  const active = g.players.filter(p => p.status === 'active');
  if (!active.length) return true;
  if (active.length === 1 && active[0].committedThisStreet >= Math.max(...contenders(g).filter(p => p.id !== active[0].id).map(p => p.committedThisStreet), 0)) return true;
  return active.every(p => p.hasActedThisRound && p.committedThisStreet === g.currentBet);
}
function needsAction(g: GameState, p: Player) { return p.status === 'active' && (!p.hasActedThisRound || p.committedThisStreet < g.currentBet); }
export function settleRound(g: GameState, afterSeat: number) {
  const live = contenders(g);
  if (live.length === 1) {
    refundUncalled(g); const amount = g.players.reduce((n, p) => n + p.committedThisHand, 0);
    live[0].stack += amount; g.pots = [{ amount, eligibleIds: [live[0].id], awarded: true, winnerIds: [live[0].id] }]; log(g, `${live[0].name} wins ${money(amount)} uncontested.`); finishHand(g); return;
  }
  if (isRoundComplete(g)) {
    refundUncalled(g); g.actorId = null; g.pots = buildPots(g.players);
    if (g.street === 'river') { g.phase = 'showdown'; log(g, 'Showdown. Dealer, select the winners for each pot.'); }
    else { g.phase = 'street-break'; g.pendingStreet = ({ preflop: 'flop', flop: 'turn', turn: 'river' } as const)[g.street]; log(g, `Betting closed. Deal the ${g.pendingStreet}.`); }
  } else g.actorId = nextSeat(g.players.filter(p => needsAction(g, p)), afterSeat)?.id ?? null;
}
export function applyAction(state: GameState, id: string, action: Action) {
  const g = structuredClone(state), legal = legalActions(g, id), p = g.players.find(p => p.id === id);
  if (!legal || !p) throw new Error('It is not your turn.');
  if (action.type === 'fold') { p.status = 'folded'; log(g, `${p.name} folds.`); }
  else if (action.type === 'check') { if (!legal.check) throw new Error('You must call or fold.'); log(g, `${p.name} checks.`); }
  else if (action.type === 'call') { if (!legal.call) throw new Error('Nothing to call.'); const paid = pay(p, legal.call); log(g, `${p.name} calls ${money(paid)}${p.stack === 0 ? ' · all in' : ''}.`); }
  else if (['all-in', 'bet', 'raise'].includes(action.type)) {
    if (action.type === 'all-in' && !legal.allIn) throw new Error('Betting has not reopened; call or fold.');
    if (action.type === 'bet' && g.currentBet !== 0 || action.type === 'raise' && g.currentBet === 0) throw new Error('Betting has changed. Review your action.');
    const target = action.type === 'all-in' ? legal.maxRaiseTo : action.amount;
    if (target === undefined || !Number.isSafeInteger(target) || target % chipUnit(g.config.denominations) || target > legal.maxRaiseTo || target <= p.committedThisStreet) throw new Error('Choose a makeable amount within your stack.');
    if (target > g.currentBet) {
      if (!legal.canRaise || target < legal.minRaiseTo && target !== legal.maxRaiseTo) throw new Error(`Minimum raise is to ${money(legal.minRaiseTo)}; a shorter raise must be all in.`);
      const size = target - g.currentBet;
      if (size >= g.lastFullRaiseSize) { g.lastFullRaiseSize = size; for (const other of g.players) if (other.status === 'active') other.hasActedThisRound = false; }
      g.currentBet = target;
    } else if (action.type !== 'all-in') throw new Error('A raise must exceed the current bet.');
    const paid = pay(p, target - p.committedThisStreet); log(g, `${p.name} ${p.stack === 0 ? 'is all in' : 'bets / raises'} to ${money(target)} (${money(paid)} added).`);
  } else throw new Error('Unknown action.');
  p.hasActedThisRound = true; p.actedAtBet = g.currentBet; settleRound(g, p.seat); return g;
}
