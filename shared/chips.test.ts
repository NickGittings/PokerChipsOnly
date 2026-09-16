import { describe, expect, it } from 'vitest';
import { breakdown, CHIP_COLORS, chipUnit, isMakeable } from './chips';
import type { Denomination } from './types';

const chips = (...values: number[]): Denomination[] => values.map((value, i) => ({ value, color: CHIP_COLORS[i] }));
describe('chip representation', () => {
  it('breaks canonical poker amounts into the fewest descending chips', () => {
    const ds = chips(1, 5, 25, 100, 500);
    expect(breakdown(1286, ds).map(d => [d.value, d.count])).toEqual([[500, 2], [100, 2], [25, 3], [5, 2], [1, 1]]);
    expect(ds.map(d => d.value)).toEqual([1, 5, 25, 100, 500]);
  });
  it('uses exact minimum-chip fill where greedy fails', () => {
    expect(breakdown(6, chips(1, 3, 4)).map(d => [d.value, d.count])).toEqual([[3, 2]]);
    expect(breakdown(60, chips(5, 15, 20)).map(d => [d.value, d.count])).toEqual([[20, 3]]);
  });
  it('reuses fills at differing targets without mixing color or denomination sets', () => {
    const ds = chips(1, 3, 4);
    for (const amount of [13, 6, 101, 4, 0]) {
      expect(breakdown(amount, ds).reduce((sum, d) => sum + d.count * d.value, 0)).toBe(amount);
    }
    const recolored = ds.map(d => ({ ...d, color: CHIP_COLORS[7] }));
    expect(breakdown(6, recolored).every(d => d.color === CHIP_COLORS[7])).toBe(true);
  });
  it.each([-5, 1.5, NaN, Infinity, 1_000_001])('rejects invalid or oversized amount %s', amount => {
    expect(breakdown(amount, chips(1, 5))).toEqual([]);
  });
  it('detects amounts that cannot be represented by the smallest chip', () => {
    const ds = chips(5, 25, 100);
    expect(chipUnit(ds)).toBe(5);
    expect(isMakeable(10, ds)).toBe(true);
    expect(isMakeable(0, ds)).toBe(true);
    expect(isMakeable(12, ds)).toBe(false);
    expect(isMakeable(-5, ds)).toBe(false);
    expect(breakdown(12, ds)).toEqual([]);
    expect(breakdown(10, [])).toEqual([]);
    expect(breakdown(10, chips(0, 5))).toEqual([]);
  });
  it('conserves amount for a broad sample of noncanonical chip combinations', () => {
    for (const values of [[1, 3, 4], [5, 20, 25], [2, 8, 10], [1, 5, 25, 100, 500]]) {
      const ds = chips(...values);
      for (let amount = 0; amount <= 1200; amount += Math.min(...values)) {
        const fill = breakdown(amount, ds);
        expect(fill.reduce((sum, d) => sum + d.value * d.count, 0)).toBe(amount);
        expect(fill.every(d => d.count > 0 && Number.isInteger(d.count))).toBe(true);
      }
    }
  });
});
