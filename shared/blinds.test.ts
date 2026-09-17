import { describe, expect, it } from 'vitest';
import { blindLevel, DEFAULT_CONFIG, handsToNextLevel, levelNotice, validateConfig } from './blinds';
import { isMakeable } from './chips';
import { createGame } from '../server/engine/state';

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
    { durationMinutes: 4 }, { durationMinutes: 721 }, { durationMinutes: 1.5 },
    { durationMinutes: -1 }, { durationMinutes: Infinity }, { durationMinutes: NaN },
  ])('rejects invalid setup field %o', overrides => {
    expect(validateConfig({ ...DEFAULT_CONFIG, ...overrides } as typeof DEFAULT_CONFIG).length).toBeGreaterThan(0);
  });
  it.each([0, 5, 720])('accepts time limit %i', durationMinutes => {
    expect(validateConfig({ ...DEFAULT_CONFIG, durationMinutes })).toEqual([]);
  });
  it('validates both blind paces and ignores unused time bounds for hands mode', () => {
    for (const blindPace of ['time', 'hands'] as const) for (const levelHands of [1, 10, 100]) expect(validateConfig({ ...DEFAULT_CONFIG, blindPace, levelHands })).toEqual([]);
    expect(validateConfig({ ...DEFAULT_CONFIG, blindPace: 'hands', levelMinutes: 0 })).toEqual([]);
    for (const levelHands of [0, 101, 1.5, NaN, Infinity]) expect(validateConfig({ ...DEFAULT_CONFIG, levelHands })).toContain('Hands per level must be a whole number from 1–100.');
    expect(validateConfig({ ...DEFAULT_CONFIG, blindPace: 'rounds' as never })).toContain('Choose blinds by time or hands.');
  });
  it('counts the distance to the next hand-based level, including queued changes', () => {
    const g = createGame({ ...DEFAULT_CONFIG, blindPace: 'hands' });
    g.hand = 1; expect(handsToNextLevel(g)).toBe(10); expect(levelNotice(g)).toBe('Next level · in 10 hands');
    g.hand = 9; expect(handsToNextLevel(g)).toBe(2);
    g.hand = 10; g.levelStartHand = 10; g.pendingLevel = 2;
    expect(handsToNextLevel(g)).toBe(1); expect(levelNotice(g)).toBe('Blinds up next hand · level 2');
    g.hand = 11; g.level = 2; expect(handsToNextLevel(g)).toBe(10);
  });
  it('describes a pending blind change only while one is queued', () => {
    const g = createGame(DEFAULT_CONFIG);
    g.level = 2; g.pendingLevel = 2;
    expect(levelNotice(g)).toBeNull();
    g.pendingLevel = 3;
    expect(levelNotice(g)).toBe('Blinds up next hand · level 3');
    g.pendingLevel = 1;
    expect(levelNotice(g)).toBe('Blinds down next hand · level 1');
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
