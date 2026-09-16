import type { Config, GameState } from './types';
import { chipUnit, CHIP_COLORS } from './chips';
export const DEFAULT_CONFIG: Config = { name: 'Friday Night Poker', denominations: [{ value: 5, color: CHIP_COLORS[0] }, { value: 25, color: CHIP_COLORS[1] }, { value: 100, color: CHIP_COLORS[2] }, { value: 500, color: CHIP_COLORS[4] }], startingStack: 500, smallBlind: 5, bigBlind: 10, multiplier: 2, levelMinutes: 15, durationMinutes: 0, anteMode: 'big-blind', ante: 0 };
export function blindLevel(c: Config, level: number) {
  const unit = chipUnit(c.denominations), factor = c.multiplier ** (level - 1);
  const round = (n: number) => Math.max(unit, Math.min(Math.floor(1_000_000 / unit) * unit, Math.ceil(n / unit) * unit));
  return { small: round(Math.round(c.smallBlind * factor)), big: round(Math.round(c.bigBlind * factor)), ante: c.ante === 0 ? 0 : round(Math.round(c.ante * factor)) };
}
export function levelNotice(g: GameState): string | null {
  return g.pendingLevel === g.level ? null : `Blinds ${g.pendingLevel > g.level ? 'up' : 'down'} next hand · level ${g.pendingLevel}`;
}
export function validateConfig(c: Config): string[] {
  const errors: string[] = [];
  if (!c || typeof c !== 'object' || !Array.isArray(c.denominations)) return ['Invalid game configuration.'];
  if (typeof c.name !== 'string' || !c.name.trim() || c.name.length > 60) errors.push('Give your game a name (up to 60 characters).');
  if (c.denominations.length < 2 || c.denominations.length > 8) errors.push('Choose 2–8 chip denominations.');
  if (c.denominations.some(d => !d || !Number.isSafeInteger(d.value) || d.value <= 0 || d.value > 1_000_000 || !CHIP_COLORS.includes(d.color))) return [...errors, 'Use positive whole chip values and a palette color.'];
  const unit = chipUnit(c.denominations);
  if (new Set(c.denominations.map(d => d.value)).size !== c.denominations.length) errors.push('Chip values must be unique.');
  if (c.denominations.some(d => d.value % unit)) errors.push('Every chip value must be a multiple of the smallest chip.');
  for (const [name, n] of [['Starting stack', c.startingStack], ['Small blind', c.smallBlind], ['Big blind', c.bigBlind]] as const) if (!Number.isSafeInteger(n) || n <= 0 || n > 125000 || n % unit) errors.push(`${name} must be a positive multiple of ${unit}, up to 125,000.`);
  if (c.bigBlind < c.smallBlind) errors.push('The big blind must be at least the small blind.');
  if (!Number.isFinite(c.multiplier) || c.multiplier < 1.1 || c.multiplier > 5) errors.push('Choose a multiplier from 1.1 to 5.');
  if (!Number.isFinite(c.levelMinutes) || c.levelMinutes < 1 || c.levelMinutes > 180) errors.push('Level length must be 1–180 minutes.');
  if (c.durationMinutes !== 0 && (!Number.isInteger(c.durationMinutes) || c.durationMinutes < 5 || c.durationMinutes > 720)) errors.push('Time limit must be 0 (no limit) or a whole number from 5–720 minutes.');
  if (!['none', 'big-blind', 'per-player'].includes(c.anteMode) || !Number.isSafeInteger(c.ante) || c.ante < 0 || c.ante > 125000 || c.ante % unit) errors.push('Ante must be zero or a whole, makeable chip amount.');
  return errors;
}
