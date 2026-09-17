import type { ClientMsg, GameState, Snapshot } from '../../shared/types';
import { money } from '../../shared/chips';
import { placeOf } from '../../shared/standings';
import { levelNotice } from '../../shared/blinds';
import { ChipStack } from '../components/Chips';
import { BlindTimer } from '../components/BlindTimer';
import { ActionBar } from '../components/ActionBar';
import { GameOver, ShowdownModal, StreetModal } from '../components/GameModals';
import { WinCelebration } from '../components/WinCelebration';
import { HandLog, TableRoster, SeatMarkers, blindClass } from '../components/PokerTable';
import { useWinCelebration } from '../net/useWinCelebration';
import '../styles/game.css';

type Props = { snapshot: Snapshot; send: (msg: ClientMsg) => void; connected: boolean };
export function PlayerView({ snapshot, send, connected }: Props) {
  const { celebration, dismiss } = useWinCelebration(snapshot, connected);
  const { game, you } = snapshot;
  const player = game.players.find(p => p.id === you.id);
  if (!player) return <main className="player-page"><section className="game-panel"><h1>Find your place at the table.</h1><p>Choose a seat to join this game.</p><a className="game-button primary" href="/">Choose a seat →</a></section></main>;
  const pot = game.phase === 'hand-complete' || game.phase === 'tournament-over' ? 0 : game.phase === 'showdown' ? game.pots.filter(p => !p.awarded).reduce((sum, p) => sum + p.amount, 0) : game.players.reduce((sum, p) => sum + p.committedThisHand, 0);
  const notice = levelNotice(game);
  if (game.phase === 'tournament-over') return <main className="player-page">
    <PlayerHeader game={game} connected={connected} />
    <GameOver snapshot={snapshot} />
    <HandLog game={game} />
    <WinCelebration celebration={celebration} dismiss={dismiss} />
  </main>;
  return <main className="player-page player-shell">
    <div className="player-hand">
      <div className="player-topbar">
        <PlayerHeader game={game} connected={connected} />
        <div className="player-pot-row"><div><span className="eyebrow">{game.street} · total pot</span><strong>{money(pot)}</strong><ChipStack amount={pot} denominations={game.config.denominations} />{game.pots.length > 1 && <div className="side-pot-tags">{game.pots.map((p, i) => <span key={i}>{i === 0 ? 'Main' : `Side ${i}`} {money(p.amount)}{p.awarded ? ' ✓' : ''}</span>)}</div>}</div><BlindTimer game={game} /></div>
        <div className="player-context"><section className={`game-panel your-stack ${blindClass(game, player.seat)} ${game.actorId === player.id ? 'seat-acting' : ''}`}><div className="panel-heading"><span className="eyebrow">{player.name} · Seat {player.seat + 1}</span><SeatMarkers game={game} seat={player.seat} /></div><div className="your-stack-balance"><span className="your-stack-label"><span className="balance-chip" aria-hidden="true">♣</span>Your chips</span><strong>{money(player.stack)}</strong></div><div className="your-stack-footer"><span>In this hand <b>{money(player.committedThisHand)}</b></span><span>{player.status === 'busted' ? `Finished #${placeOf(game, player) ?? '—'}` : player.status.replace('-', ' ')}</span></div></section></div>
      </div>
      <div className="player-flow">
        {notice && <div className="level-notice">{notice}</div>}
        <TableRoster game={game} />
        <HandLog game={game} compact />
      </div>
      <div className="player-actions">
        {player.status === 'busted' && game.phase === 'hand-complete' && <button type="button" className="game-button primary wide" disabled={!connected} onClick={() => send({ type: 'rebuy' })}>Buy back in for {money(game.config.startingStack)}</button>}
        {you.dealing && game.phase === 'hand-complete' && <button type="button" className="game-button primary wide" disabled={!connected} onClick={() => send({ type: 'nextHand', revision: game.revision })}>Deal next hand →</button>}
        <ActionBar snapshot={snapshot} send={send} connected={connected} />
      </div>
    </div>
    <StreetModal snapshot={snapshot} send={send} connected={connected} dealer={you.dealing} />
    <ShowdownModal snapshot={snapshot} send={send} connected={connected} dealer={you.dealing} />
    <WinCelebration celebration={celebration} dismiss={dismiss} />
  </main>;
}

function PlayerHeader({ game, connected }: { game: GameState; connected: boolean }) {
  return <header className="player-header">
    <a href="/" className="brand-link">♠ <span>POKER CHIPS</span></a>
    <span className="player-header-name" title={game.config.name}>{game.config.name}</span>
    <span className="player-header-status"><span>Hand {game.hand}</span><span className={`connection-indicator ${connected ? '' : 'offline'}`}><span />{connected ? 'Live' : 'Offline'}</span></span>
  </header>;
}
export default PlayerView;
