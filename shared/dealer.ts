import type { GameState } from './types';
export function dealerId(g: GameState): string | null { return g.players.find(p => p.seat === g.button)?.id ?? null; }
