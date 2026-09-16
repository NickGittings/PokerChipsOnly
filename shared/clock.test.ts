import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './blinds';
import { timer, timeLimitMs, timeUp } from './clock';
import { createGame } from '../server/engine/state';

describe('play-time helpers', () => {
  it.each([
    [-1000, '00:00'], [0, '00:00'], [1, '00:01'], [59_000, '00:59'],
    [60_000, '01:00'], [3_599_000, '59:59'], [3_600_000, '1:00:00'],
    [3_661_000, '1:01:01'], [43_200_000, '12:00:00'],
  ])('formats %i milliseconds as %s', (ms, expected) => expect(timer(ms)).toBe(expected));

  it('leaves the limit off by default regardless of elapsed play time', () => {
    const g = createGame(); g.elapsedMs = 10_000_000;
    expect(timeLimitMs(DEFAULT_CONFIG)).toBe(0); expect(timeUp(g)).toBe(false);
  });

  it('expires at the limit and stays expired afterward', () => {
    const g = createGame({ ...DEFAULT_CONFIG, durationMinutes: 5 });
    expect(timeLimitMs(g.config)).toBe(300_000);
    for (const elapsedMs of [0, 299_999, 300_000, 300_001]) {
      g.elapsedMs = elapsedMs; expect(timeUp(g)).toBe(elapsedMs >= 300_000);
    }
  });
});
