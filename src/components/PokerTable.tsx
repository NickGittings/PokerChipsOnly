import { useEffect, useRef, useState } from 'react';
import type { GameState, Player } from '../../shared/types';
import { money } from '../../shared/chips';
import { placeOf } from '../../shared/standings';
import { ChipStack } from './Chips';
import { useDialogFocus } from './useDialogFocus';
import { useSeatDrag } from './useSeatDrag';

export function blindClass(game: GameState, seat: number): string {
  return game.bigBlindSeat === seat ? 'seat-bb' : game.smallBlindSeat === seat ? 'seat-sb' : '';
}
export function SeatMarkers({ game, seat }: { game: GameState; seat: number }) {
  return <span className="seat-markers">{game.button === seat && <i className="m-d" title="Dealer button">D</i>}{game.smallBlindSeat === seat && <i className="m-sb" title="Small blind">SB</i>}{game.bigBlindSeat === seat && <i className="m-bb" title="Big blind">BB</i>}</span>;
}

export function seatStatus(game: GameState, player: Player, showBet = false): string {
  const place = placeOf(game, player);
  return !player.connected ? 'Reconnecting…' : game.actorId === player.id ? 'Your action' : place ? `Finished #${place}` : player.status === 'folded' ? 'folded' : player.status === 'all-in' ? 'all in' : showBet && player.committedThisStreet > 0 ? `In front ${money(player.committedThisStreet)}` : player.status === 'active' ? 'In the hand' : player.status.replace('-', ' ');
}

export function SeatBadge({ player, game }: { player?: Player; game: GameState }) {
  if (!player) return <div className="seat-empty">Open seat</div>;
  const acting = game.actorId === player.id;
  return <div className={`seat-card ${blindClass(game, player.seat)} ${acting ? 'seat-acting' : ''} ${!player.connected ? 'seat-offline' : ''} ${player.status === 'folded' || player.status === 'busted' ? 'seat-muted' : ''}`}>
    <div className="seat-top"><span className="seat-avatar">{player.name.slice(0, 1).toUpperCase()}</span><span className="seat-name">{player.name}</span><SeatMarkers game={game} seat={player.seat} /></div>
    <strong className="seat-stack">{money(player.stack)}</strong><div className="seat-chip-row"><ChipStack amount={player.stack} denominations={game.config.denominations} /></div>
    <span className="seat-status">{seatStatus(game, player)}</span>
    {player.committedThisStreet > 0 && <div className="seat-bet">In front <b>{money(player.committedThisStreet)}</b></div>}
  </div>;
}

export function TableRoster({ game }: { game: GameState }) {
  const actorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    actorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [game.actorId]);
  return <div className="player-roster" aria-label="Players at the table">{[...game.players].sort((a, b) => a.seat - b.seat).map(p => {
    const acting = game.actorId === p.id;
    return <div ref={acting ? actorRef : undefined} key={p.id} className={`roster-seat ${blindClass(game, p.seat)} ${acting ? 'acting' : ''} ${p.status === 'folded' || p.status === 'busted' ? 'muted' : ''} ${!p.connected ? 'offline' : ''}`}>
      <span className="roster-avatar">{p.name.slice(0, 1).toUpperCase()}</span>
      <div className="roster-info"><small>{p.name}</small><span className="roster-state">{seatStatus(game, p, true)}</span></div>
      <SeatMarkers game={game} seat={p.seat} />
      <b className="roster-stack">{money(p.stack)}</b>
    </div>;
  })}</div>;
}

export function PotDisplay({ game }: { game: GameState }) {
  const total = game.phase === 'hand-complete' || game.phase === 'tournament-over' ? 0 : game.phase === 'showdown' ? game.pots.filter(p => !p.awarded).reduce((sum, p) => sum + p.amount, 0) : game.players.reduce((sum, p) => sum + p.committedThisHand, 0);
  return <div className="pot-display"><span className="eyebrow">{game.phase === 'lobby' ? 'The table is open' : `${game.street} · total pot`}</span><strong>{money(total)}</strong><ChipStack amount={total} denominations={game.config.denominations} />{game.pots.length > 1 && <div className="side-pot-tags">{game.pots.map((pot, i) => <span key={i}>{i === 0 ? 'Main' : `Side ${i}`} {money(pot.amount)}{pot.awarded ? ' ✓' : ''}</span>)}</div>}</div>;
}

export function PokerTable({ game, compact = false, onMoveSeat }: { game: GameState; compact?: boolean; onMoveSeat?: (playerId: string, seat: number) => void }) {
  const { seatProps, announcement } = useSeatDrag(game.players, onMoveSeat);
  return <div className={`poker-table-wrap ${compact ? 'table-compact' : ''}`}><div className="table-felt"><div className="table-brand">POKER CHIPS <span>REAL CARDS. GOOD COMPANY.</span></div><PotDisplay game={game} /><div className="table-status">{game.awaitingDeal ? 'Ready for the hole cards' : game.phase === 'betting' ? `${game.players.find(p => p.id === game.actorId)?.name ?? 'Table'} to act` : game.phase === 'street-break' ? `Ready for the ${game.pendingStreet}` : game.phase === 'showdown' ? 'Time to show your cards' : game.phase === 'lobby' ? 'Take a seat. Make a night of it.' : game.phase === 'tournament-over' ? 'A champion at the table' : 'Hand complete'}</div></div><div className="table-seats">{Array.from({ length: 8 }, (_, seat) => {
    const player = game.players.find(p => p.seat === seat);
    const { className, ...seatHandlers } = seatProps(seat, player);
    return <div key={seat} className={`table-seat table-seat-${seat} ${className}`} {...seatHandlers}><SeatBadge game={game} player={player} /></div>;
  })}</div>{onMoveSeat && <div role="status" className="visually-hidden">{announcement}</div>}</div>;
}

export function HandLog({ game, compact = false }: { game: GameState; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const blocking = game.awaitingDeal || game.phase === 'street-break' || (game.phase === 'showdown' && game.pots.some(pot => !pot.awarded));
  const open = expanded && !blocking;
  const dialogRef = useDialogFocus(open);
  useEffect(() => { setExpanded(false); }, [game.revision, blocking]);
  const entries = (count: number) => <ol>{game.log.slice(-count).reverse().map(entry => <li key={entry.id}>{entry.text}</li>)}</ol>;
  const empty = !game.log.length && <p className="muted">The story starts with the first hand.</p>;
  return <>
    <section className={`game-panel hand-log${compact ? ' hand-log-compact' : ''}`}>
      <div className="panel-heading"><span className="eyebrow">Table activity</span><span>Hand {game.hand}</span>{compact && <button type="button" className="activity-expand" aria-label="Expand table activity" aria-haspopup="dialog" onClick={() => setExpanded(true)}>▸</button>}</div>
      {entries(compact ? 2 : 12)}{empty}
    </section>
    {compact && open && <div className="game-overlay activity-overlay" ref={dialogRef} tabIndex={-1} onKeyDown={e => { if (e.key === 'Escape') setExpanded(false); }} role="dialog" aria-modal="true" aria-labelledby="activity-title">
      <section className="street-modal activity-sheet">
        <div className="panel-heading"><h2 id="activity-title">Table activity</h2><span>Hand {game.hand}</span></div>
        <div className="hand-log">{entries(12)}{empty}</div>
        <button type="button" className="game-button wide" onClick={() => setExpanded(false)}>Close activity</button>
      </section>
    </div>}
  </>;
}
