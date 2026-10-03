import type { GameState } from './types';
export function dealerId(g: GameState): string | null { return g.players.find(p => p.seat === g.button)?.id ?? null; }
export function dealerName(g: GameState, fallback = 'the board'): string { const p = g.players.find(x => x.id === dealerId(g)); return p?.connected ? p.name : fallback; }
// Who takes the prompts of an away button player: board pages while they hold admin and one is connected, otherwise the host device.
export function boardDealsFallback(boardAdmin: boolean, boardLive: boolean) { return boardAdmin && boardLive; }
export function fallbackDealerName(g: GameState, { hostId, boardAdmin, boardLive }: { hostId: string | null; boardAdmin: boolean; boardLive: boolean }) { return boardDealsFallback(boardAdmin, boardLive) ? 'the board' : g.players.find(p => p.id === hostId)?.name ?? 'the host'; }
