import { describe, expect, it } from 'vitest';
import { createGame, createPlayer, startHand, startTournament } from '../state';
import { adjustStack, colorUp, colorUpSuggested, finishHand, tickClock } from '../tournament';
import { advanceStreet } from '../streets';
import { assertChips } from '../helpers';
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

  it('ranks simultaneous bust-outs by starting stack and ties equal stacks', () => {
    const g = createGame(config());
    g.players = [500, 200, 100, 100].map((n, i) => createPlayer(`p${i}`, `P${i}`, i, n));
    g.players[0].stack = 900; g.players.slice(1).forEach(p => { p.stack = 0; p.status = 'all-in'; });
    g.totalChips = 900;
    finishHand(g);
    expect(g.players.map(p => p.place)).toEqual([1, 2, 3, 3]);
    expect(g.phase).toBe('tournament-over'); expect(g.clockPaused).toBe(true);
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
    expect(g.players.every(p => p.place === undefined)).toBe(true);
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
