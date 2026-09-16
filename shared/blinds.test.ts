import { describe, expect, it } from 'vitest';
import { blindLevel, DEFAULT_CONFIG, validateConfig } from './blinds';
import { isMakeable } from './chips';

describe('blind generation and setup validation', () => {
  it('accepts defaults and follows the multiplier with chip rounding', () => {
    expect(validateConfig(DEFAULT_CONFIG)).toEqual([]);
    const c = { ...DEFAULT_CONFIG, multiplier: 1.5, ante: 5 };
    expect([1, 2, 3, 4].map(n => blindLevel(c, n))).toEqual([
      { small: 5, big: 10, ante: 5 },
      { small: 10, big: 15, ante: 10 },
      { small: 15, big: 25, ante: 15 },
      { small: 20, big: 35, ante: 20 },
    ]);
  });
  it('reports unmakeable starting stacks, blinds, and antes before starting', () => {
    for (const key of ['startingStack', 'smallBlind', 'bigBlind', 'ante']) {
      expect(validateConfig({ ...DEFAULT_CONFIG, [key]: 7 }).length).toBeGreaterThan(0);
    }
  });
  it('rejects malformed configuration and invalid chip rows', () => {
    expect(validateConfig(null as never)).toEqual(['Invalid game configuration.']);
    expect(validateConfig({ ...DEFAULT_CONFIG, denominations: [] }).length).toBeGreaterThan(0);
    expect(validateConfig({ ...DEFAULT_CONFIG, denominations: [{ value: -1, color: '#bad' }] }).length).toBeGreaterThan(0);
    expect(validateConfig({ ...DEFAULT_CONFIG, denominations: [DEFAULT_CONFIG.denominations[0], DEFAULT_CONFIG.denominations[0]] }).length).toBeGreaterThan(0);
    expect(validateConfig({ ...DEFAULT_CONFIG, denominations: [{ value: 3, color: '#C0392B' }, { value: 5, color: '#F2EDE3' }] }).length).toBeGreaterThan(0);
  });
  it.each([
    { name: '' }, { name: 'x'.repeat(61) }, { multiplier: 1 }, { multiplier: Infinity },
    { levelMinutes: 0 }, { levelMinutes: 181 }, { smallBlind: 100, bigBlind: 10 },
    { startingStack: 125005 }, { ante: -5 }, { anteMode: 'bad' },
  ])('rejects invalid setup field %o', overrides => {
    expect(validateConfig({ ...DEFAULT_CONFIG, ...overrides } as typeof DEFAULT_CONFIG).length).toBeGreaterThan(0);
  });
  it('keeps late blind levels capped and makeable for nondecimal chip units', () => {
    const c = { ...DEFAULT_CONFIG, denominations: [{ value: 3, color: '#C0392B' }, { value: 15, color: '#F2EDE3' }], smallBlind: 3, bigBlind: 6 };
    for (const level of [1, 5, 30, 1000]) {
      const blinds = blindLevel(c, level);
      expect(blinds.small).toBeLessThanOrEqual(1_000_000);
      expect(blinds.big).toBeLessThanOrEqual(1_000_000);
      expect(isMakeable(blinds.small, c.denominations)).toBe(true);
      expect(isMakeable(blinds.big, c.denominations)).toBe(true);
    }
  });
});
