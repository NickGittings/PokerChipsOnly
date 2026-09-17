import { describe, expect, it } from 'vitest';
import { potWinsFor, type PotRound } from './winCelebration';
import type { Pot } from './types';

function pot(overrides: Partial<Pot> = {}): Pot {
  return { amount: 100, eligibleIds: ['me', 'foe'], awarded: false, ...overrides };
}
function round(pots: Pot[], hand = 1): PotRound {
  return { hand, pots };
}

describe('potWinsFor', () => {
  it('fires nothing with no prior snapshot', () => {
    expect(potWinsFor(null, round([pot({ awarded: true, winnerIds: ['me'] })]), 'me')).toEqual([]);
  });

  it('fires once on the false→true edge for the winner', () => {
    const before = round([pot()]);
    const after = round([pot({ awarded: true, winnerIds: ['me'] })]);
    expect(potWinsFor(before, after, 'me')).toEqual([{ hand: 1, potIndex: 0, amount: 100, winnerCount: 1 }]);
  });

  it('fires nothing for a player who did not win', () => {
    const before = round([pot()]);
    const after = round([pot({ awarded: true, winnerIds: ['foe'] })]);
    expect(potWinsFor(before, after, 'me')).toEqual([]);
  });

  it('does not re-fire on an unchanged, already-awarded snapshot (the 1s rebroadcast)', () => {
    const state = round([pot({ awarded: true, winnerIds: ['me'] })]);
    expect(potWinsFor(state, state, 'me')).toEqual([]);
  });

  it('fires nothing on undo (true→false), then fires again on re-award', () => {
    const awarded = round([pot({ awarded: true, winnerIds: ['me'] })]);
    const undone = round([pot()]);
    expect(potWinsFor(awarded, undone, 'me')).toEqual([]);
    const reawarded = round([pot({ awarded: true, winnerIds: ['me'] })]);
    expect(potWinsFor(undone, reawarded, 'me')).toEqual([{ hand: 1, potIndex: 0, amount: 100, winnerCount: 1 }]);
  });

  it('handles the uncontested-win path where the pots array is replaced wholesale', () => {
    const before = round([pot(), pot({ amount: 40 })]);
    const after = round([pot({ amount: 140, eligibleIds: ['me'], awarded: true, winnerIds: ['me'] })]);
    expect(potWinsFor(before, after, 'me')).toEqual([{ hand: 1, potIndex: 0, amount: 140, winnerCount: 1 }]);
  });

  it('fires nothing across a hand rollover even if indices coincidentally match', () => {
    const before = round([pot({ awarded: true, winnerIds: ['me'] })], 1);
    const after = round([pot({ awarded: true, winnerIds: ['me'] })], 2);
    expect(potWinsFor(before, after, 'me')).toEqual([]);
  });

  it('reports winnerCount for a split pot', () => {
    const before = round([pot()]);
    const after = round([pot({ awarded: true, winnerIds: ['me', 'foe'] })]);
    expect(potWinsFor(before, after, 'me')).toEqual([{ hand: 1, potIndex: 0, amount: 100, winnerCount: 2 }]);
  });

  it('handles a side pot awarding independently of the main pot', () => {
    const before = round([pot({ awarded: true, winnerIds: ['foe'] }), pot({ amount: 40 })]);
    const after = round([pot({ awarded: true, winnerIds: ['foe'] }), pot({ amount: 40, awarded: true, winnerIds: ['me'] })]);
    expect(potWinsFor(before, after, 'me')).toEqual([{ hand: 1, potIndex: 1, amount: 40, winnerCount: 1 }]);
  });
});
