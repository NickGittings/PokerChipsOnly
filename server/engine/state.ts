import type { Config, GameState, Player } from '../../shared/types';
import { DEFAULT_CONFIG, blindLevel, levelLengthMs, validateConfig } from '../../shared/blinds';
import { log, nextSeat, pay, record } from './helpers';
import { settleRound } from './betting';
export function createGame(config: Config = DEFAULT_CONFIG, now = 0): GameState {
  return { config: structuredClone(config), players: [], eliminated: [], phase: 'lobby', street: 'preflop', hand: 0, awaitingDeal: false, levelStartHand: 0, button: -1, smallBlindSeat: -1, bigBlindSeat: -1, actorId: null, currentBet: 0, lastFullRaiseSize: config.bigBlind, pots: [], log: [], ledger: [], logSequence: 0, level: 1, pendingLevel: 1, clockRemainingMs: levelLengthMs(config), clockUpdatedAt: now, clockPaused: true, elapsedMs: 0, totalChips: 0, bustSequence: 0, revision: 0 };
}
export function createPlayer(id: string, name: string, seat: number, stack = 0): Player { return { id, name, seat, stack, committedThisStreet: 0, committedThisHand: 0, status: 'active', hasActedThisRound: false, actedAtBet: 0, connected: true, handStartStack: stack }; }
export function startTournament(state: GameState, config: Config, now = 0) {
  const errors = validateConfig(config); if (errors.length) throw new Error(errors.join(' '));
  if (state.phase !== 'lobby' || state.players.length < 2 || state.players.length > 8) throw new Error('Seat 2–8 players before starting.');
  const g = createGame(config, now); g.players = state.players.map(p => createPlayer(p.id, p.name, p.seat, config.startingStack)); g.players.forEach(p => { p.connected = state.players.find(x => x.id === p.id)!.connected; });
  g.players.forEach(p => record(g, p, 'buy-in', config.startingStack));
  g.totalChips = g.players.length * config.startingStack; g.phase = 'hand-complete'; g.clockPaused = false; return startHand(g);
}
export function startHand(state: GameState) {
  const g = structuredClone(state);
  if (g.phase !== 'hand-complete') throw new Error('Finish this hand before starting another.');
  const players = g.players.filter(p => p.stack > 0);
  if (players.length < 2) throw new Error('At least two players need chips.');
  g.level = g.pendingLevel; g.hand++;
  if (g.config.blindPace === 'hands' && g.hand - g.levelStartHand >= g.config.levelHands) { g.pendingLevel++; g.levelStartHand = g.hand; }
  g.street = 'preflop'; g.phase = 'betting'; g.pendingStreet = undefined; g.pots = [];
  for (const p of players) { p.status = 'active'; p.hasActedThisRound = false; p.actedAtBet = 0; p.committedThisHand = 0; p.committedThisStreet = 0; p.deadAnte = 0; p.handStartStack = p.stack; delete p.bustOrder; }
  const button = nextSeat(players, g.button); g.button = button.seat;
  const sb = players.length === 2 ? button : nextSeat(players, button.seat), bb = nextSeat(players, sb.seat); g.smallBlindSeat = sb.seat; g.bigBlindSeat = bb.seat;
  const blinds = blindLevel(g.config, g.level); g.currentBet = blinds.big; g.lastFullRaiseSize = blinds.big;
  log(g, `Hand ${g.hand} · level ${g.level} · blinds ${blinds.small}/${blinds.big} · ${button.name} on the button.`);
  pay(sb, blinds.small); pay(bb, blinds.big);
  if (g.config.anteMode === 'big-blind') pay(bb, blinds.ante, false, true);
  else if (g.config.anteMode === 'per-player') players.forEach(p => pay(p, blinds.ante, false));
  settleRound(g, bb.seat); g.awaitingDeal = true; return g;
}
export function resetToLobby(state: GameState, now = 0) {
  if (state.phase === 'lobby') throw new Error('The table is already in the lobby. Set up and start when everyone is seated.');
  const g = createGame(state.config, now);
  g.players = state.players.map(p => { const seat = createPlayer(p.id, p.name, p.seat); seat.connected = p.connected; return seat; });
  g.logSequence = state.logSequence;
  log(g, 'Host started a new game. Seats kept — stacks and hand history cleared.');
  return g;
}
