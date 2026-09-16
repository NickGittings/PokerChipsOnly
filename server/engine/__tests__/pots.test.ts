import { describe, expect, it } from 'vitest';
import { createGame, createPlayer } from '../state';
import { awardPots, buildPots } from '../pots';
import { assertChips } from '../helpers';
import { advanceStreet } from '../streets';
import { act, config, player, stacked } from './fixtures';

describe('pot layering and awards', () => {
  it('layers four all-ins at three depths and keeps folded dead money', () => {
    const players = [100, 200, 300, 300, 150].map((amount, i) => {
      const p = createPlayer(`p${i}`, `P${i}`, i);
      p.committedThisHand = amount; p.status = i === 4 ? 'folded' : 'all-in'; return p;
    });
    expect(buildPots(players)).toEqual([
      { amount: 500, eligibleIds: ['p0', 'p1', 'p2', 'p3'], awarded: false },
      { amount: 350, eligibleIds: ['p1', 'p2', 'p3'], awarded: false },
      { amount: 200, eligibleIds: ['p2', 'p3'], awarded: false },
    ]);
  });

  it('merges adjacent layers with identical eligible winners', () => {
    const players = [50, 100, 100].map((n, i) => {
      const p = createPlayer(`p${i}`, `P${i}`, i);
      p.committedThisHand = n; p.status = i === 0 ? 'folded' : 'active'; return p;
    });
    expect(buildPots(players)).toEqual([{ amount: 250, eligibleIds: ['p1', 'p2'], awarded: false }]);
  });

  it('returns unmatched all-in chips before building side pots', () => {
    let g = stacked([100, 200, 300]);
    g = act(g, 'all-in'); g = act(g, 'all-in'); g = act(g, 'call');
    expect(player(g, 'p2').stack).toBe(100);
    expect(g.pots.map(p => p.amount)).toEqual([300, 200]);
    assertChips(g);
  });

  it('walks flop, turn, river during all-in runout and awards each layer in order', () => {
    let g = stacked([100, 200, 300]);
    g = act(g, 'all-in'); g = act(g, 'all-in'); g = act(g, 'call');
    for (const street of ['flop', 'turn', 'river']) {
      expect(g.phase).toBe('street-break');
      expect(g.pendingStreet).toBe(street);
      expect(g.actorId).toBeNull();
      g = advanceStreet(g); assertChips(g);
    }
    expect(g.phase).toBe('showdown');
    expect(g.pots.map(p => p.amount)).toEqual([300, 200]);
    expect(() => awardPots(g, 1, ['p1'])).toThrow(/next unclaimed/);
    expect(() => awardPots(g, 0, [])).toThrow(/eligible/);
    expect(() => awardPots(g, 0, ['p0', 'p0'])).toThrow(/eligible/);
    g = awardPots(g, 0, ['p0']); assertChips(g);
    expect(() => awardPots(g, 0, ['p1'])).toThrow();
    expect(() => awardPots(g, 1, ['p0'])).toThrow(/eligible/);
    g = awardPots(g, 1, ['p1']); assertChips(g);
    expect(g.players.map(p => p.stack)).toEqual([300, 200, 100]);
    expect(g.phase).toBe('hand-complete');
  });

  it('assigns odd chip units clockwise left of the button, including wraparound', () => {
    const g = createGame(config());
    g.players = [0, 6, 7].map(seat => createPlayer(`p${seat}`, `P${seat}`, seat, 100));
    g.phase = 'showdown'; g.button = 6; g.totalChips = 325;
    g.pots = [{ amount: 25, eligibleIds: ['p0', 'p6', 'p7'], awarded: false }];
    const next = awardPots(g, 0, ['p6', 'p0', 'p7']);
    expect(player(next, 'p7').stack).toBe(110);
    expect(player(next, 'p0').stack).toBe(110);
    expect(player(next, 'p6').stack).toBe(105);
    assertChips(next);
    expect(g.pots[0].awarded).toBe(false);
  });

  it('includes the big-blind ante as shared money for short all-in players', () => {
    let g = stacked([100, 100, 200], { anteMode: 'big-blind', ante: 10 });
    g = act(g, 'all-in'); g = act(g, 'all-in'); g = act(g, 'call');
    expect(g.pots).toEqual([{ amount: 310, eligibleIds: ['p0', 'p1', 'p2'], awarded: false }]);
    assertChips(g);
    g = advanceStreet(advanceStreet(advanceStreet(g)));
    g = awardPots(g, 0, ['p0']);
    expect(player(g, 'p0').stack).toBe(310);
    expect(player(g, 'p2').stack).toBe(90);
    assertChips(g);
  });
});
