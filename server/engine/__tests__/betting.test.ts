import { describe, expect, it } from 'vitest';
import { applyAction, isRoundComplete, legalActions } from '../betting';
import { assertChips } from '../helpers';
import { advanceStreet } from '../streets';
import { act, game, player, stacked } from './fixtures';

describe('authoritative betting', () => {
  it('preserves the big blind option after every other player limps', () => {
    let g = game();
    expect(g.actorId).toBe('p0');
    g = act(g, 'call'); g = act(g, 'call');
    expect(g.actorId).toBe('p2');
    expect(isRoundComplete(g)).toBe(false);
    expect(legalActions(g, 'p2')).toMatchObject({ check: true, call: 0, canRaise: true, minRaiseTo: 20 });
    g = act(g, 'check');
    expect(g.phase).toBe('street-break');
    expect(g.pendingStreet).toBe('flop');
    expect(g.pots.reduce((n, p) => n + p.amount, 0)).toBe(30);
    assertChips(g);
  });

  it('a full raise reopens betting and updates the next minimum', () => {
    let g = act(game(), 'raise', 40);
    expect(g.lastFullRaiseSize).toBe(30);
    expect(legalActions(g, 'p1')?.minRaiseTo).toBe(70);
    g = act(g, 'call'); g = act(g, 'raise', 100);
    expect(g.actorId).toBe('p0');
    expect(legalActions(g, 'p0')).toMatchObject({ canRaise: true, minRaiseTo: 160, call: 60 });
    assertChips(g);
  });

  it('an incomplete all-in does not reopen a player who already acted', () => {
    let g = stacked([500, 500, 50]);
    g = act(g, 'raise', 40); g = act(g, 'call'); g = act(g, 'all-in');
    expect(g.currentBet).toBe(50);
    expect(g.lastFullRaiseSize).toBe(30);
    expect(legalActions(g, 'p0')).toMatchObject({ canRaise: false, allIn: false, call: 10 });
    expect(() => applyAction(g, 'p0', { type: 'raise', amount: 100 })).toThrow();
    expect(() => applyAction(g, 'p0', { type: 'all-in' })).toThrow(/reopened/);
    g = act(g, 'call'); g = act(g, 'call');
    expect(g.phase).toBe('street-break');
    assertChips(g);
  });

  it('cumulative short all-ins reopen betting after a full raise increment', () => {
    let g = stacked([500, 50, 70, 500]);
    expect(g.actorId).toBe('p3');
    g = act(g, 'raise', 40); g = act(g, 'call');
    g = act(g, 'all-in'); g = act(g, 'all-in');
    expect(g.actorId).toBe('p3');
    expect(g.currentBet).toBe(70);
    expect(g.lastFullRaiseSize).toBe(30);
    expect(legalActions(g, 'p3')).toMatchObject({ canRaise: true, allIn: true, minRaiseTo: 100 });
    assertChips(g);
  });

  it('short calls spend the entire stack and never make it negative', () => {
    let g = stacked([500, 20, 500]);
    g = act(g, 'raise', 100); g = act(g, 'call');
    expect(player(g, 'p1')).toMatchObject({ stack: 0, status: 'all-in', committedThisHand: 20 });
    assertChips(g);
  });

  it.each([15, 21, -5, NaN, Infinity, 501])('rejects illegal raise target %s without mutating state', amount => {
    const g = game(), before = structuredClone(g);
    expect(() => applyAction(g, 'p0', { type: 'raise', amount })).toThrow();
    expect(g).toEqual(before);
  });

  it('rejects out-of-turn actions, checking facing a bet, and betting into a raise', () => {
    const g = game();
    expect(legalActions(g, 'p1')).toBeNull();
    expect(() => applyAction(g, 'p1', { type: 'call' })).toThrow(/turn/);
    expect(() => applyAction(g, 'p0', { type: 'check' })).toThrow(/call or fold/);
    expect(() => applyAction(g, 'p0', { type: 'bet', amount: 20 })).toThrow();
  });

  it('refunds the uncalled portion and awards dead money when everyone folds', () => {
    let g = act(game(), 'raise', 100);
    g = act(g, 'fold'); g = act(g, 'fold');
    expect(g.phase).toBe('hand-complete');
    expect(player(g, 'p0').stack).toBe(515);
    expect(player(g, 'p1').stack).toBe(495);
    expect(player(g, 'p2').stack).toBe(490);
    expect(g.players.every(p => p.committedThisHand === 0)).toBe(true);
    assertChips(g);
  });

  it('does not allow raising against only all-in opponents', () => {
    let g = stacked([500, 20]);
    g = act(g, 'call'); g = act(g, 'all-in');
    expect(legalActions(g, 'p0')).toMatchObject({ call: 10, canRaise: false, allIn: false });
    g = act(g, 'call');
    expect(g.phase).toBe('street-break');
    assertChips(g);
  });

  it('locks every action during dealing and restores postflop turn order', () => {
    let g = game(); g = act(g, 'call'); g = act(g, 'call'); g = act(g, 'check');
    for (const p of g.players) expect(legalActions(g, p.id)).toBeNull();
    expect(() => applyAction(g, 'p1', { type: 'check' })).toThrow();
    g = advanceStreet(g);
    expect(g.actorId).toBe('p1');
    expect(g.currentBet).toBe(0);
    expect(g.players.every(p => p.committedThisStreet === 0)).toBe(true);
    expect(legalActions(g, 'p1')).toMatchObject({ check: true, minRaiseTo: 10 });
    assertChips(g);
  });
});
