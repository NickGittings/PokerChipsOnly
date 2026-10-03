import type { GameState } from './types';
export function dealerId(g: GameState): string | null { return g.players.find(p => p.seat === g.button)?.id ?? null; }
export function dealerName(g: GameState, fallback = 'the board'): string { const p = g.players.find(x => x.id === dealerId(g)); return p?.connected ? p.name : fallback; }
