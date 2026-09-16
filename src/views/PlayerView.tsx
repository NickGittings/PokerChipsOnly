import type { ClientMsg, Snapshot } from '../../shared/types';
import { money } from '../../shared/chips';
import { placeOf } from '../../shared/standings';
import { levelNotice } from '../../shared/blinds';
import { ChipStack } from '../components/Chips';
import { BlindTimer } from '../components/BlindTimer';
import { ActionBar } from '../components/ActionBar';
import { GameOver, ShowdownModal, StreetModal } from '../components/GameModals';
import { HostPanel } from '../components/HostPanel';
import { HandLog, TableRoster } from '../components/PokerTable';
import '../styles/game.css';

type Props = { snapshot: Snapshot; send: (msg: ClientMsg) => void; connected: boolean };
export function PlayerView({ snapshot, send, connected }: Props) {
  const { game, you } = snapshot;
  const player = game.players.find(p => p.id === you.id);
  if (!player) return <main className="player-page"><section className="game-panel"><h1>Find your place at the table.</h1><p>Choose a seat to join this game.</p><a className="game-button primary" href="/">Choose a seat →</a></section></main>;
  const pot = game.phase === 'hand-complete' || game.phase === 'tournament-over' ? 0 : game.phase === 'showdown' ? game.pots.filter(p => !p.awarded).reduce((sum, p) => sum + p.amount, 0) : game.players.reduce((sum, p) => sum + p.committedThisHand, 0);
  const notice = levelNotice(game);
  return <main className="player-page"><header className="player-header"><a href="/" className="brand-link">♠ <span>POKER CHIPS</span></a><span className={`connection-indicator ${connected ? '' : 'offline'}`}><span />{connected ? 'Live' : 'Offline'}</span></header>{game.phase !== 'tournament-over' && <TableRoster game={game} />}<div className="player-game-name">{game.config.name}<span>Hand {game.hand}</span></div>{game.phase === 'tournament-over' ? <GameOver snapshot={snapshot} /> : <div className="player-hand"><div className="player-pot-row"><div><span className="eyebrow">{game.street} · total pot</span><strong>{money(pot)}</strong><ChipStack amount={pot} denominations={game.config.denominations} />{game.pots.length > 1 && <div className="side-pot-tags">{game.pots.map((p, i) => <span key={i}>{i === 0 ? 'Main' : `Side ${i}`} {money(p.amount)}{p.awarded ? ' ✓' : ''}</span>)}</div>}</div><BlindTimer game={game} /></div><div className="player-context"><section className="game-panel your-stack"><div className="panel-heading"><span className="eyebrow">{player.name} · Seat {player.seat + 1}</span><div className="seat-markers">{game.button === player.seat && <i>D</i>}{game.smallBlindSeat === player.seat && <i>SB</i>}{game.bigBlindSeat === player.seat && <i>BB</i>}</div></div><div className="your-stack-balance"><span className="your-stack-label"><span className="balance-chip" aria-hidden="true">♣</span>Your chips</span><strong>{money(player.stack)}</strong></div><div className="your-stack-footer"><span>In this hand <b>{money(player.committedThisHand)}</b></span><span>{player.status === 'busted' ? `Finished #${placeOf(game, player) ?? '—'}` : player.status.replace('-', ' ')}</span></div>{player.status === 'busted' && game.phase === 'hand-complete' && <button type="button" className="game-button primary wide" disabled={!connected} onClick={() => send({ type: 'rebuy' })}>Buy back in for {money(game.config.startingStack)}</button>}</section>{notice && <div className="level-notice">{notice}</div>}</div><ActionBar snapshot={snapshot} send={send} connected={connected} /></div>}{(you.host || you.dealer) && <HostPanel snapshot={snapshot} send={send} connected={connected} />}<HandLog game={game} /><StreetModal snapshot={snapshot} send={send} connected={connected} dealer={you.host || you.dealer} /><ShowdownModal snapshot={snapshot} send={send} connected={connected} dealer={you.host || you.dealer} /></main>;
}
export default PlayerView;
