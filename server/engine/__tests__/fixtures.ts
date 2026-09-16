import { DEFAULT_CONFIG } from '../../../shared/blinds';
import type { Config, GameState } from '../../../shared/types';
import { createGame, createPlayer, startHand, startTournament } from '../state';
import { applyAction } from '../betting';

export function config(overrides: Partial<Config> = {}): Config {
  return { ...structuredClone(DEFAULT_CONFIG), anteMode: 'none', ...overrides };
}

export function game(count = 3, overrides: Partial<Config> = {}): GameState {
  const c = config(overrides), g = createGame(c);
  g.players = Array.from({ length: count }, (_, i) => createPlayer(`p${i}`, `Player ${i}`, i));
  return startTournament(g, c);
}

export function stacked(stacks: number[], overrides: Partial<Config> = {}): GameState {
  const g = createGame(config(overrides));
  g.players = stacks.map((stack, i) => createPlayer(`p${i}`, `Player ${i}`, i, stack));
  g.totalChips = stacks.reduce((sum, n) => sum + n, 0);
  g.phase = 'hand-complete';
  return startHand(g);
}

export function act(g: GameState, type: 'fold' | 'check' | 'call' | 'all-in' | 'bet' | 'raise', amount?: number) {
  if (!g.actorId) throw new Error('No acting player');
  return applyAction(g, g.actorId, { type, amount });
}

export function player(g: GameState, id: string) {
  return g.players.find(p => p.id === id)!;
}
