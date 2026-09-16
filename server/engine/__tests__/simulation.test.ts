import { describe, expect, it } from 'vitest';
import { applyAction, legalActions } from '../betting';
import { awardPots } from '../pots';
import { advanceStreet } from '../streets';
import { startHand } from '../state';
import { assertChips } from '../helpers';
import { game } from './fixtures';

describe('multi-hand chip conservation', () => {
  it('conserves chips across deterministic varied games with all-ins, folds, splits, and antes', () => {
    let transitions = 0, finished = 0;
    for (let seed = 1; seed <= 30; seed++) {
      let randomState = seed;
      const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 2 ** 32; };
      let g = game(2 + seed % 7, { startingStack: 100, anteMode: seed % 3 === 0 ? 'per-player' : seed % 3 === 1 ? 'big-blind' : 'none', ante: 5 });
      for (let step = 0; step < 500 && g.phase !== 'tournament-over'; step++) {
        assertChips(g);
        if (g.phase === 'street-break') g = advanceStreet(g);
        else if (g.phase === 'hand-complete') g = startHand(g);
        else if (g.phase === 'showdown') {
          const index = g.pots.findIndex(p => !p.awarded), eligible = g.pots[index].eligibleIds;
          expect(eligible.length).toBeGreaterThan(0);
          const winners = random() < 0.2 ? eligible : [eligible[Math.floor(random() * eligible.length)]];
          g = awardPots(g, index, winners);
        } else {
          expect(g.phase).toBe('betting'); expect(g.actorId).not.toBeNull();
          const legal = legalActions(g, g.actorId!)!;
          expect(legal).not.toBeNull();
          const roll = random();
          const type = roll < 0.35 && legal.allIn ? 'all-in' : roll < 0.5 ? 'fold' : legal.check ? 'check' : 'call';
          g = applyAction(g, g.actorId!, { type });
        }
        transitions++;
        assertChips(g);
        expect(g.players.every(p => p.stack % 5 === 0)).toBe(true);
      }
      if (g.phase === 'tournament-over') { finished++; expect(g.players.filter(p => p.stack > 0)).toHaveLength(1); }
    }
    expect(transitions).toBeGreaterThan(500);
    expect(finished).toBeGreaterThan(20);
  });
});
