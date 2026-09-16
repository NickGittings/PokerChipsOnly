import type { GameState } from '../../shared/types';
import { blindLevel } from '../../shared/blinds';
import { log } from './helpers';
import { settleRound } from './betting';
export function advanceStreet(state: GameState) {
  const g = structuredClone(state);
  if (g.phase !== 'street-break' || !g.pendingStreet) throw new Error('There are no cards waiting to be dealt.');
  g.street = g.pendingStreet; g.pendingStreet = undefined; g.currentBet = 0; g.lastFullRaiseSize = blindLevel(g.config, g.level).big; g.phase = 'betting';
  for (const p of g.players) { p.committedThisStreet = 0; p.hasActedThisRound = false; p.actedAtBet = 0; }
  log(g, `${g.street[0].toUpperCase() + g.street.slice(1)} dealt.`); settleRound(g, g.button); return g;
}
