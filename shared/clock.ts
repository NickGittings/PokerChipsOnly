import type { Config, GameState } from './types';

export function timer(ms: number): string {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(seconds / 60), remainder = String(seconds % 60).padStart(2, '0');
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${remainder}` : `${String(minutes).padStart(2, '0')}:${remainder}`;
}

export function timeLimitMs(config: Config): number { return config.durationMinutes > 0 ? config.durationMinutes * 60_000 : 0; }
export function timeUp(game: GameState): boolean { return game.config.durationMinutes > 0 && game.elapsedMs >= timeLimitMs(game.config); }
