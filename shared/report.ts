import type { GameState } from './types';
import { standings } from './standings';

export interface PlayerReport { playerId: string; name: string; buyIns: number; invested: number; finalStack: number; net: number; biggestWin: { amount: number; hand: number } | null; biggestLoss: { amount: number; hand: number } | null; handsPlayed: number }

export function report(g: GameState): { players: PlayerReport[]; totalBuyIns: number; hands: number } {
  const accounts = new Map<string, PlayerReport>(), hands = new Map<string, Set<number>>();
  const ensure = (playerId: string, name: string) => { let player = accounts.get(playerId); if (!player) { player = { playerId, name, buyIns: 0, invested: 0, finalStack: 0, net: 0, biggestWin: null, biggestLoss: null, handsPlayed: 0 }; accounts.set(playerId, player); hands.set(playerId, new Set()); } return player; };
  for (const entry of g.ledger) {
    const player = ensure(entry.playerId, entry.name); player.name = entry.name;
    if (entry.kind === 'hand') {
      hands.get(entry.playerId)!.add(entry.hand);
      if (entry.amount > 0 && (!player.biggestWin || entry.amount > player.biggestWin.amount)) player.biggestWin = { amount: entry.amount, hand: entry.hand };
      if (entry.amount < 0 && (!player.biggestLoss || entry.amount < player.biggestLoss.amount)) player.biggestLoss = { amount: entry.amount, hand: entry.hand };
    } else { player.invested += entry.amount; if (entry.kind === 'buy-in' || entry.kind === 'buy-back') player.buyIns++; }
  }
  for (const p of [...g.players, ...g.eliminated]) { const player = ensure(p.id, p.name); player.finalStack = p.stack; }
  for (const player of accounts.values()) { player.net = player.finalStack - player.invested; player.handsPlayed = hands.get(player.playerId)!.size; }
  const ranked = standings(g).map(({ player }) => player.id), order = [...ranked, ...accounts.keys()].filter((id, i, ids) => ids.indexOf(id) === i);
  const players = order.map(id => accounts.get(id)!);
  return { players, totalBuyIns: players.reduce((sum, p) => sum + p.buyIns, 0), hands: g.hand };
}
