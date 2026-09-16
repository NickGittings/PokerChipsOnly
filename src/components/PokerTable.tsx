import type { GameState, Player } from '../../shared/types';
import { money } from '../../shared/chips';
import { ChipStack } from './Chips';

export function SeatBadge({ player, game }: { player?: Player; game: GameState }) {
  if (!player) return <div className="seat-empty">Open seat</div>;
  const acting = game.actorId === player.id;
  return <div className={`seat-card ${acting ? 'seat-acting' : ''} ${!player.connected ? 'seat-offline' : ''} ${player.status === 'folded' || player.status === 'busted' ? 'seat-muted' : ''}`}>
    <div className="seat-top"><span className="seat-avatar">{player.name.slice(0, 1).toUpperCase()}</span><span className="seat-name">{player.name}</span><span className="seat-markers">{game.button === player.seat && <i title="Dealer button">D</i>}{game.smallBlindSeat === player.seat && <i title="Small blind">SB</i>}{game.bigBlindSeat === player.seat && <i title="Big blind">BB</i>}</span></div>
    <strong className="seat-stack">{money(player.stack)}</strong><div className="seat-chip-row"><ChipStack amount={player.stack} denominations={game.config.denominations} /></div>
    <span className="seat-status">{!player.connected ? 'Reconnecting…' : acting ? 'Your action' : player.place ? `Finished #${player.place}` : player.status === 'active' ? 'In the hand' : player.status.replace('-', ' ')}</span>
    {player.committedThisStreet > 0 && <div className="seat-bet">In front <b>{money(player.committedThisStreet)}</b></div>}
  </div>;
}

export function PotDisplay({ game }: { game: GameState }) {
  const total = game.phase === 'hand-complete' || game.phase === 'tournament-over' ? 0 : game.phase === 'showdown' ? game.pots.filter(p => !p.awarded).reduce((sum, p) => sum + p.amount, 0) : game.players.reduce((sum, p) => sum + p.committedThisHand, 0);
  return <div className="pot-display"><span className="eyebrow">{game.phase === 'lobby' ? 'The table is open' : `${game.street} · total pot`}</span><strong>{money(total)}</strong><ChipStack amount={total} denominations={game.config.denominations} />{game.pots.length > 1 && <div className="side-pot-tags">{game.pots.map((pot, i) => <span key={i}>{i === 0 ? 'Main' : `Side ${i}`} {money(pot.amount)}{pot.awarded ? ' ✓' : ''}</span>)}</div>}</div>;
}

export function PokerTable({ game, compact = false }: { game: GameState; compact?: boolean }) {
  return <div className={`poker-table-wrap ${compact ? 'table-compact' : ''}`}><div className="table-felt"><div className="table-brand">POKER CHIPS <span>REAL CARDS. GOOD COMPANY.</span></div><PotDisplay game={game} /><div className="table-status">{game.phase === 'betting' ? `${game.players.find(p => p.id === game.actorId)?.name ?? 'Table'} to act` : game.phase === 'street-break' ? `Ready for the ${game.pendingStreet}` : game.phase === 'showdown' ? 'Time to show your cards' : game.phase === 'lobby' ? 'Take a seat. Make a night of it.' : game.phase === 'tournament-over' ? 'A champion at the table' : 'Hand complete'}</div></div><div className="table-seats">{Array.from({ length: 8 }, (_, seat) => <div key={seat} className={`table-seat table-seat-${seat}`}><SeatBadge game={game} player={game.players.find(p => p.seat === seat)} /></div>)}</div></div>;
}

export function HandLog({ game }: { game: GameState }) {
  return <section className="game-panel hand-log"><div className="panel-heading"><span className="eyebrow">Table activity</span><span>Hand {game.hand}</span></div><ol>{game.log.slice(-12).reverse().map(entry => <li key={entry.id}>{entry.text}</li>)}</ol>{!game.log.length && <p className="muted">The story starts with the first hand.</p>}</section>;
}
