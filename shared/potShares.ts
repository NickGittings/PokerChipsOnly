import { chipUnit } from './chips';
import type { GameState, Pot } from './types';

/** Allocate whole chip units clockwise from the seat left of the button. */
export function potShares(game: Pick<GameState, 'players' | 'button' | 'config'>, pot: Pot, winnerIds: string[]) {
  const winners = game.players.filter(p => winnerIds.includes(p.id)).sort((a, b) => ((a.seat - game.button + 7) % 8) - ((b.seat - game.button + 7) % 8));
  const unit = chipUnit(game.config.denominations), units = pot.amount / unit;
  const share = Math.floor(units / winners.length), extra = units % winners.length;
  return winners.map((player, i) => ({ player, amount: (share + (i < extra ? 1 : 0)) * unit }));
}
