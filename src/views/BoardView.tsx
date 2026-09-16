import { QRCodeSVG } from 'qrcode.react';
import type { ClientMsg, Snapshot } from '../../shared/types';
import { blindLevel } from '../../shared/blinds';
import { money } from '../../shared/chips';
import { BlindTimer } from '../components/BlindTimer';
import { PokerTable, HandLog } from '../components/PokerTable';
import { GameOver, ShowdownModal, StreetModal } from '../components/GameModals';
import { HostPanel } from '../components/HostPanel';
import '../styles/game.css';

type Props = { snapshot: Snapshot; send: (msg: ClientMsg) => void; connected: boolean };
export function BoardView({ snapshot, send, connected }: Props) {
  const { game } = snapshot;
  const blinds = blindLevel(game.config, game.level);
  return <main className="board-page"><header className="game-header"><a className="brand-link" href="/">♠ <span>POKER CHIPS<small>THE HOME GAME, REIMAGINED</small></span></a><div className="board-title"><h1>{game.config.name}</h1><span>{game.phase === 'lobby' ? 'Waiting for the table' : `Hand ${game.hand} · ${game.players.filter(p => p.status !== 'busted').length} players remaining`}</span></div><div className={`connection-indicator ${connected ? '' : 'offline'}`}><span />{connected ? 'Table live' : 'Reconnecting'}</div></header><div className="board-layout"><section className="board-main"><div className="board-stats"><div><span className="eyebrow">Current blinds</span><strong>{money(blinds.small)} <span>/</span> {money(blinds.big)}</strong></div><div><span className="eyebrow">Blind level</span><strong>{String(game.level).padStart(2, '0')}</strong></div><BlindTimer game={game} /></div>{game.pendingLevel > game.level && <div className="level-notice">Blinds up next hand · level {game.pendingLevel}</div>}{game.phase === 'tournament-over' ? <GameOver snapshot={snapshot} /> : <PokerTable game={game} />}{game.phase === 'lobby' && <div className="board-lobby-note"><span className="eyebrow">A seat for everyone</span><h2>Good cards. Better company.</h2><p>Scan the code, choose a seat, and settle in.</p><a className="game-button primary" href="/setup">Set up the game →</a></div>}<HandLog game={game} /></section><aside className="board-sidebar"><section className="game-panel join-panel"><span className="eyebrow">Pull up a chair</span><h2>Join the table</h2><div className="qr-well"><QRCodeSVG value={snapshot.joinUrl} size={160} bgColor="#F2EDE3" fgColor="#10321F" marginSize={2} /></div><p>Scan with your phone camera.<br />Stay on the same Wi-Fi.</p><a href={snapshot.joinUrl}>{snapshot.joinUrl}</a><div className="seat-count">{game.players.length} / 8 seats filled</div></section><HostPanel snapshot={snapshot} send={send} connected={connected} /><div className="real-cards-note">♣<p>Real cards on the table.<br />Every chip accounted for.</p></div></aside></div><StreetModal snapshot={snapshot} send={send} connected={connected} dealer /><ShowdownModal snapshot={snapshot} send={send} connected={connected} dealer /></main>;
}
export default BoardView;
