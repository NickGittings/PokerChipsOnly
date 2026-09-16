import type { GameState, Player } from './types';

// Ranks are derived, never stored: an absolute "place = fieldSize - i" number goes
// stale the moment a late buy-in or a seat takeover changes the field size after
// it was assigned. Instead every busted player carries a `bustOrder` (the value of
// GameState.bustSequence at the moment they busted, ties sharing one value), and
// rank is computed fresh from whoever is still around — seated or archived to
// `eliminated` after their seat was taken.
const key = (p: Player) => p.stack > 0 ? Infinity : p.bustOrder ?? -Infinity;

export function standings(g: GameState): { player: Player; place: number }[] {
  // At the finish, surviving players are ranked by chips; eliminated players
  // retain their elimination order, including players whose seats were taken.
  const compare = (a: Player, b: Player) => g.phase === 'tournament-over' && a.stack > 0 && b.stack > 0 ? b.stack - a.stack : (key(b) > key(a) ? 1 : key(b) < key(a) ? -1 : 0);
  const ordered = [...g.players, ...g.eliminated]
    .filter(p => p.stack > 0 || p.bustOrder !== undefined)
    .sort((a, b) => compare(a, b) || a.seat - b.seat);
  return ordered.map(player => ({ player, place: 1 + ordered.filter(other => compare(other, player) < 0).length }));
}

// The rank a busted or tournament-ending player should display, or undefined
// while they're still live and the tournament continues.
export function placeOf(g: GameState, player: Player): number | undefined {
  if (player.status !== 'busted' && g.phase !== 'tournament-over') return undefined;
  return standings(g).find(({ player: p }) => p.id === player.id)?.place;
}
