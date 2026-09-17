import { describe, expect, it } from 'vitest';
import { createGame, createPlayer, startHand, startTournament } from '../state';
import { adjustDuration, adjustLevel, adjustStack, colorUp, colorUpSuggested, finishHand, tickClock } from '../tournament';
import { advanceStreet } from '../streets';
import { assertChips } from '../helpers';
import { placeOf, standings } from '../../../shared/standings';
import { act, config, game, player, stacked } from './fixtures';

describe('tournament lifecycle', () => {
  it('requires two through eight players and valid settings', () => {
    expect(() => startTournament(createGame(), config())).toThrow(/2–8/);
    const g = createGame();
    g.players = Array.from({ length: 9 }, (_, i) => createPlayer(`p${i}`, `P${i}`, i));
    expect(() => startTournament(g, config())).toThrow(/2–8/);
    expect(() => startTournament(game(), config())).toThrow();
    expect(() => startTournament(g, config({ smallBlind: 3 }))).toThrow();
  });

  it('heads-up button posts small blind and acts first preflop, last postflop', () => {
    let g = game(2);
    expect(g).toMatchObject({ button: 0, smallBlindSeat: 0, bigBlindSeat: 1, actorId: 'p0' });
    g = act(g, 'call'); g = act(g, 'check'); g = advanceStreet(g);
    expect(g.actorId).toBe('p1');
    g = act(g, 'check'); expect(g.actorId).toBe('p0');
    assertChips(g);
  });

  it('moves the button forward past busted seats', () => {
    const g = createGame(config());
    g.players = [100, 0, 100, 0, 100].map((n, i) => createPlayer(`p${i}`, `P${i}`, i, n));
    g.players.filter(p => !p.stack).forEach(p => { p.status = 'busted'; });
    g.phase = 'hand-complete'; g.button = 0; g.totalChips = 300;
    const next = startHand(g);
    expect(next).toMatchObject({ button: 2, smallBlindSeat: 4, bigBlindSeat: 0, actorId: 'p2' });
    assertChips(next);
  });

  it('posts short blinds without negative stacks while retaining nominal big blind', () => {
    const g = stacked([100, 5, 5]);
    expect(player(g, 'p1')).toMatchObject({ stack: 0, committedThisStreet: 5, status: 'all-in' });
    expect(player(g, 'p2')).toMatchObject({ stack: 0, committedThisStreet: 5, status: 'all-in' });
    expect(g.currentBet).toBe(10);
    assertChips(g);
  });

  it('posts antes outside the street bet and caps a short big blind ante', () => {
    const g = stacked([100, 100, 15], { anteMode: 'big-blind', ante: 10 });
    expect(player(g, 'p2')).toMatchObject({ stack: 0, committedThisStreet: 10, committedThisHand: 15 });
    expect(g.currentBet).toBe(10);
    assertChips(g);
    const perPlayer = game(3, { anteMode: 'per-player', ante: 5 });
    expect(perPlayer.players.map(p => p.committedThisHand)).toEqual([5, 10, 15]);
    expect(perPlayer.players.map(p => p.committedThisStreet)).toEqual([0, 5, 10]);
    assertChips(perPlayer);
  });

  it('flags blind levels pending and applies them only at the next hand', () => {
    let g = game(3, { levelMinutes: 1 });
    g = tickClock(g, 61_000);
    expect(g).toMatchObject({ level: 1, pendingLevel: 2, clockRemainingMs: 59_000, currentBet: 10 });
    g = act(g, 'fold'); g = act(g, 'fold'); g = startHand(g);
    expect(g).toMatchObject({ level: 2, currentBet: 20, hand: 2 });
    assertChips(g);
  });

  it('handles multiple expired levels, paused clocks, and backwards timestamps', () => {
    let g = tickClock(game(3, { levelMinutes: 1 }), 185_000);
    expect(g).toMatchObject({ pendingLevel: 4, clockRemainingMs: 55_000 });
    g.clockPaused = true;
    g = tickClock(g, 999_000);
    expect(g.clockRemainingMs).toBe(55_000);
    g.clockPaused = false;
    g = tickClock(g, 998_000);
    expect(g.clockRemainingMs).toBe(55_000);
  });

  it('plays ten hands at each level and queues the next level at the last hand', () => {
    let g = game(3, { blindPace: 'hands', levelHands: 10 });
    for (let hand = 1; hand <= 21; hand++) {
      expect(g.hand).toBe(hand); expect(g.level).toBe(Math.floor((hand - 1) / 10) + 1);
      expect(g.pendingLevel).toBe(Math.floor(hand / 10) + 1);
      assertChips(g);
      if (hand < 21) { g = act(g, 'fold'); g = act(g, 'fold'); g = startHand(g); }
    }
  });

  it('supports a level every hand and restarts the hand count after manual blind changes', () => {
    let g = game(3, { blindPace: 'hands', levelHands: 1 });
    expect(g).toMatchObject({ level: 1, pendingLevel: 2, levelStartHand: 1 });
    g = act(g, 'fold'); g = act(g, 'fold'); g = startHand(g);
    expect(g).toMatchObject({ level: 2, pendingLevel: 3, levelStartHand: 2 });
    g.config.levelHands = 3; g = adjustLevel(g, 1);
    expect(g).toMatchObject({ level: 2, pendingLevel: 4, levelStartHand: 2 });
    for (let hand = 3; hand <= 6; hand++) {
      g = act(g, 'fold'); g = act(g, 'fold'); g = startHand(g);
      expect(g.level).toBe(hand < 6 ? 4 : 5);
    }
  });

  it('keeps the total time limit running in hands mode without clock-based blind raises', () => {
    let g = game(3, { blindPace: 'hands', levelHands: 10, levelMinutes: 1, durationMinutes: 5 });
    g = tickClock(g, 300_000);
    expect(g).toMatchObject({ level: 1, pendingLevel: 1, clockRemainingMs: 60_000, elapsedMs: 300_000, phase: 'betting' });
    g = act(g, 'fold'); g = act(g, 'fold');
    expect(g).toMatchObject({ phase: 'tournament-over', clockPaused: true }); assertChips(g);
  });

  it('records hand deltas once for participants and caps the ledger by trimming hand rows only', () => {
    let g = game(3);
    g = act(g, 'fold'); g = act(g, 'fold');
    expect(g.ledger.filter(e => e.kind === 'hand').map(e => [e.playerId, e.amount])).toEqual([['p1', -5], ['p2', 5]]);
    g = adjustStack(g, 'p1', -player(g, 'p1').stack);
    g = startHand(g); g = act(g, 'fold');
    expect(g.ledger.filter(e => e.kind === 'hand' && e.playerId === 'p1')).toHaveLength(1);
    expect(g.ledger.filter(e => e.kind === 'hand' && e.hand === 2).reduce((sum, e) => sum + e.amount, 0)).toBe(0);
    const buyIns = g.ledger.filter(e => e.kind === 'buy-in'), adjustsSoFar = g.ledger.filter(e => e.kind === 'adjust').length;
    // The 1000-row cap only ever evicts 'hand' rows (oldest first). Buy-ins and adjustments
    // drive the night report's totals, so they're never trimmed — even past the cap, as here,
    // where flooding in adjustments outlasts the handful of hand rows there are to sacrifice.
    for (let i = 0; i < 1002; i++) g = adjustStack(g, 'p0', i % 2 ? -5 : 5);
    expect(g.ledger.filter(e => e.kind === 'hand')).toHaveLength(0);
    expect(g.ledger.filter(e => e.kind === 'buy-in')).toEqual(buyIns);
    expect(g.ledger.filter(e => e.kind === 'adjust')).toHaveLength(adjustsSoFar + 1002);
    assertChips(g);
  });

  it('ranks simultaneous bust-outs by starting stack and ties equal stacks', () => {
    const g = createGame(config());
    g.players = [500, 200, 100, 100].map((n, i) => createPlayer(`p${i}`, `P${i}`, i, n));
    g.players[0].stack = 900; g.players.slice(1).forEach(p => { p.stack = 0; p.status = 'all-in'; });
    g.totalChips = 900;
    finishHand(g);
    expect(g.players.map(p => placeOf(g, p))).toEqual([1, 2, 3, 3]);
    expect(g.phase).toBe('tournament-over'); expect(g.clockPaused).toBe(true);
    assertChips(g);
  });

  it('counts play time independently of levels, excluding pauses, lobby, and finished games', () => {
    let g = tickClock(game(3, { levelMinutes: 1 }), 65_000);
    expect(g.elapsedMs).toBe(65_000);
    g.clockPaused = true; g = tickClock(g, 100_000); expect(g.elapsedMs).toBe(65_000);
    g.clockPaused = false; g = tickClock(g, 110_000); expect(g.elapsedMs).toBe(75_000);
    g = tickClock(g, 109_000); expect(g.elapsedMs).toBe(75_000);
    for (const phase of ['lobby', 'tournament-over'] as const) {
      g.phase = phase; g = tickClock(g, g.clockUpdatedAt + 1000); expect(g.elapsedMs).toBe(75_000);
    }
  });

  it('finishes the current hand after the limit and ranks survivors by chips', () => {
    let g = tickClock(game(3, { durationMinutes: 5 }), 300_000);
    expect(g.phase).toBe('betting'); expect(g.clockPaused).toBe(false);
    g = act(g, 'fold'); expect(g.phase).toBe('betting'); g = act(g, 'fold');
    expect(g.phase).toBe('tournament-over'); expect(g.clockPaused).toBe(true);
    expect(standings(g).map(({ player, place }) => [player.id, place])).toEqual([['p2', 1], ['p0', 2], ['p1', 3]]);
    expect(g.log.at(-1)?.text).toBe("Time's up — Player 2 wins on chips."); assertChips(g);
  });

  it('ends the tournament once time expires while resting at hand-complete, without dealing another hand', () => {
    let g = tickClock(game(3, { durationMinutes: 5 }), 250_000);
    expect(g.phase).toBe('betting'); expect(g.elapsedMs).toBe(250_000);
    g = act(g, 'fold'); g = act(g, 'fold');
    expect(g.phase).toBe('hand-complete'); expect(g.clockPaused).toBe(false);
    g = tickClock(g, 299_000);
    expect(g.phase).toBe('hand-complete');
    g = tickClock(g, 300_000);
    expect(g.phase).toBe('tournament-over'); expect(g.clockPaused).toBe(true);
    expect(g.log.at(-1)?.text).toMatch(/Time's up/);
    expect(() => startHand(g)).toThrow(/Finish this hand/);
    const logLength = g.log.length;
    g = tickClock(g, 400_000);
    expect(g.phase).toBe('tournament-over'); expect(g.log.length).toBe(logLength);
    assertChips(g);
  });

  it('ties equal survivor stacks while preserving simultaneous and archived bust-out rankings', () => {
    const g = createGame(config({ durationMinutes: 5 }));
    g.players = [200, 300, 300, 100, 50].map((n, i) => createPlayer(`p${i}`, `Player ${i}`, i, n));
    g.players[3].stack = 0; g.players[4].stack = 0;
    const eliminated = createPlayer('old', 'Former player', 7); eliminated.status = 'busted'; eliminated.bustOrder = 1;
    g.eliminated = [eliminated]; g.bustSequence = 1; g.totalChips = 800; g.elapsedMs = 300_000;
    finishHand(g);
    expect(standings(g).map(({ player, place }) => [player.id, place])).toEqual([['p1', 1], ['p2', 1], ['p0', 3], ['p3', 4], ['p4', 5], ['old', 6]]);
    expect(g.log.at(-1)?.text).toMatch(/Player 1 and Player 2 tie on chips/); assertChips(g);
  });

  it('recalculates time-up standings after stack corrections without reviving play', () => {
    let g = tickClock(game(3, { durationMinutes: 5 }), 300_000);
    g = act(g, 'fold'); g = act(g, 'fold'); g = adjustStack(g, 'p1', 100);
    expect(g.phase).toBe('tournament-over'); expect(g.clockPaused).toBe(true);
    expect(standings(g).map(({ player, place }) => [player.id, place])).toEqual([['p1', 1], ['p2', 2], ['p0', 3]]); assertChips(g);
  });

  it('queues manual blind changes for the next hand without changing elapsed play time', () => {
    let g = tickClock(game(3, { levelMinutes: 1 }), 20_000);
    g = adjustLevel(g, 1);
    expect(g).toMatchObject({ level: 1, pendingLevel: 2, clockRemainingMs: 60_000, elapsedMs: 20_000, currentBet: 10 });
    g = act(g, 'fold'); g = act(g, 'fold'); g = startHand(g);
    expect(g).toMatchObject({ level: 2, pendingLevel: 2, currentBet: 20 });
    g = adjustLevel(g, -1);
    expect(g).toMatchObject({ level: 2, pendingLevel: 1, clockRemainingMs: 60_000, elapsedMs: 20_000 });
    g = act(g, 'fold'); g = act(g, 'fold'); g = startHand(g);
    expect(g).toMatchObject({ level: 1, currentBet: 10 }); assertChips(g);
  });

  it('rejects invalid blind adjustments and levels below one without mutating state', () => {
    const g = game(), before = structuredClone(g);
    for (const delta of [-1, 0, 2, -2, 0.5, NaN]) expect(() => adjustLevel(g, delta)).toThrow();
    expect(g).toEqual(before);
    for (const phase of ['lobby', 'tournament-over'] as const) {
      g.phase = phase; expect(() => adjustLevel(g, 1)).toThrow(/live tournament/);
    }
  });

  it('surfaces an eliminated (seat-takeover) player in the standings at their true rank', () => {
    const g = createGame(config());
    const ghost = createPlayer('ghost', 'Ghost', 0, 0);
    ghost.status = 'busted'; ghost.bustOrder = 1;
    g.eliminated = [ghost];
    g.players = [createPlayer('p1', 'Dan', 0, 500), createPlayer('p2', 'Bob', 1, 0)];
    g.players[1].status = 'busted'; g.players[1].bustOrder = 2;
    g.bustSequence = 2; g.phase = 'tournament-over'; g.totalChips = 500;
    expect(standings(g).map(({ player, place }) => [player.id, place])).toEqual([['p1', 1], ['p2', 2], ['ghost', 3]]);
    assertChips(g);
  });

  it('keeps places distinct and gapless when a late buy-in changes the field size between bust-outs', () => {
    const g = createGame(config());
    g.players = [createPlayer('p0', 'Alice', 0, 100), createPlayer('p1', 'Bob', 1, 100), createPlayer('p2', 'Cara', 2, 200)];
    g.totalChips = 400;
    g.players[0].stack = 0; g.players[0].handStartStack = 100; g.players[2].stack += 100; // Cara wins Alice's chips.
    finishHand(g); // Alice busts 3rd of 3.
    expect(placeOf(g, player(g, 'p0'))).toBe(3);
    g.phase = 'hand-complete';
    g.players.push(createPlayer('p3', 'Eve', 3, 100)); g.totalChips += 100; // Late buy-in into an empty seat.
    g.players.forEach(p => { if (p.stack > 0) p.handStartStack = p.stack; });
    g.players[1].stack = 0; g.players[3].stack += 100; // Bob busts next; Eve wins his chips. Cara is still alive too.
    finishHand(g);
    // Bob outlasted Alice, so he now takes the better (lower) place and Alice slides
    // to last — places stay distinct and gapless instead of colliding on #3.
    expect(g.players.map(p => placeOf(g, p))).toEqual([4, 3, undefined, undefined]);
    assertChips(g);
  });

  it('supports between-hand rebuys and rejects live, nonmakeable, or negative adjustments', () => {
    let g = stacked([100, 100]);
    expect(() => adjustStack(g, 'p0', 100)).toThrow(/between hands/);
    g = act(g, 'fold');
    expect(() => adjustStack(g, 'p0', 3)).toThrow();
    expect(() => adjustStack(g, 'p0', -1000)).toThrow();
    const old = g.totalChips;
    g = adjustStack(g, 'p0', 100);
    expect(g.totalChips).toBe(old + 100); assertChips(g);
    g = adjustStack(g, 'p0', -player(g, 'p0').stack);
    expect(g.phase).toBe('tournament-over');
    g = adjustStack(g, 'p0', 100);
    expect(g.phase).toBe('hand-complete');
    expect(player(g, 'p0').status).toBe('active');
    expect(g.players.every(p => p.bustOrder === undefined)).toBe(true);
    assertChips(g);
  });

  it('rejects lobby stack adjustments without mutating the game', () => {
    const g = createGame(config());
    g.players = [createPlayer('p0', 'A', 0), createPlayer('p1', 'B', 1)];
    const before = structuredClone(g);
    expect(() => adjustStack(g, 'p0', 100)).toThrow(/between hands/i);
    expect(g).toEqual(before); assertChips(g);
  });

  it('colors up exactly between hands without changing chips or total value', () => {
    const g = createGame(config());
    g.players = [createPlayer('p0', 'A', 0, 500), createPlayer('p1', 'B', 1, 500)];
    g.totalChips = 1000;
    const next = colorUp(g);
    expect(next.config.denominations.map(d => d.value)).toEqual([25, 100, 500]);
    expect(next.players.map(p => p.stack)).toEqual([500, 500]);
    expect(g.config.denominations).toHaveLength(4);
    assertChips(next);
    g.players[0].stack = 495;
    expect(() => colorUp(g)).toThrow(/exactly/);
    expect(() => colorUp(game())).toThrow(/between hands/);
    const high = game(); high.level = 6;
    expect(colorUpSuggested(high)).toBe(true);
    expect(colorUpSuggested(game())).toBe(false);
  });
});


describe('total time adjustments', () => {
  it('accounts for running time without resetting the blind countdown', () => {
    const g = game(3, { durationMinutes: 60 });
    const next = adjustDuration(g, 15, g.clockUpdatedAt + 2000);
    expect(next.config.durationMinutes).toBe(75);
    expect(next.elapsedMs).toBe(g.elapsedMs + 2000);
    expect(next.clockRemainingMs).toBe(g.clockRemainingMs - 2000);
    expect(g.config.durationMinutes).toBe(60);
  });

  it('lets the current hand finish when the shortened limit has elapsed', () => {
    const g = game(3, { durationMinutes: 30 });
    g.elapsedMs = 20 * 60_000;
    const next = adjustDuration(g, -15, g.clockUpdatedAt);
    expect(next.phase).toBe('betting');
    finishHand(next);
    expect(next.phase).toBe('tournament-over');
  });

  it('ends immediately between hands when the shortened limit has elapsed', () => {
    const g = game(3, { durationMinutes: 30 });
    finishHand(g); g.elapsedMs = 20 * 60_000;
    expect(adjustDuration(g, -15, g.clockUpdatedAt)).toMatchObject({ phase: 'tournament-over', clockPaused: true });
  });

  it('enforces duration bounds, exact steps, and live timed games', () => {
    const g = game(3, { durationMinutes: 20 });
    expect(adjustDuration(g, -15, g.clockUpdatedAt).config.durationMinutes).toBe(5);
    for (const delta of [0, 1, -1, 30, NaN, Infinity]) expect(() => adjustDuration(g, delta, g.clockUpdatedAt)).toThrow(/15 minutes/);
    for (const [durationMinutes, delta] of [[0, 15], [15, -15], [720, 15]]) {
      g.config.durationMinutes = durationMinutes;
      expect(() => adjustDuration(g, delta, g.clockUpdatedAt)).toThrow();
    }
    g.config.durationMinutes = 60;
    for (const phase of ['lobby', 'tournament-over'] as const) {
      g.phase = phase;
      expect(() => adjustDuration(g, 15, g.clockUpdatedAt)).toThrow(/live tournament/);
    }
  });
});
