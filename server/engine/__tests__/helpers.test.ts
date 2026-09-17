import { describe, expect, it } from 'vitest';
import { createGame, createPlayer } from '../state';
import { record } from '../helpers';

describe('record', () => {
  it('caps the ledger at 1000 entries by evicting the oldest hand rows, never buy-ins', () => {
    const g = createGame(), p = createPlayer('a', 'Alice', 0, 500);
    record(g, p, 'buy-in', 500);
    for (let hand = 1; hand <= 1200; hand++) { g.hand = hand; record(g, p, 'hand', 1); }
    expect(g.ledger.length).toBe(1000);
    expect(g.ledger[0]).toMatchObject({ kind: 'buy-in', amount: 500 });
    expect(g.ledger.every(e => e.kind === 'buy-in' || e.hand > 200)).toBe(true);
  });
});
