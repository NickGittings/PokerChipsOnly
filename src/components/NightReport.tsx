import type { GameState } from '../../shared/types';
import { money } from '../../shared/chips';
import { report } from '../../shared/report';
import { standings } from '../../shared/standings';

const signed = (amount: number) => `${amount < 0 ? '−' : amount > 0 ? '+' : ''}${money(Math.abs(amount))}`;
const resultText = (result: { amount: number; hand: number } | null) => result ? `${signed(result.amount)} · hand ${result.hand}` : '—';

export function NightReport({ game }: { game: GameState }) {
  const night = report(game), places = new Map(standings(game).map(({ player, place }) => [player.id, place]));
  return <section className="night-report" aria-label="Night report"><div className="report-summary"><span>{night.totalBuyIns} buy-ins & buy-backs</span><span>Hand {night.hands}</span></div>{night.players.length ? <div className="report-players">{night.players.map(player => <article className="report-player" key={player.playerId}><header><strong><span className="report-place">{places.has(player.playerId) ? `#${places.get(player.playerId)}` : 'Left'}</span>{player.name}</strong><span className={player.net > 0 ? 'report-positive' : player.net < 0 ? 'report-negative' : ''}>{signed(player.net)} net</span></header><dl><div><dt>Buy-ins</dt><dd>{player.buyIns}</dd></div><div><dt>Chips in, less out</dt><dd>{signed(player.invested)}</dd></div><div><dt>Stack</dt><dd>{money(player.finalStack)}</dd></div><div><dt>Biggest win</dt><dd>{resultText(player.biggestWin)}</dd></div><div><dt>Worst hand</dt><dd>{resultText(player.biggestLoss)}</dd></div><div><dt>Hands with a result</dt><dd>{player.handsPlayed}</dd></div></dl></article>)}</div> : <p className="hint">The report starts with the first buy-in.</p>}<p className="hint">Buy-ins include buy-backs. Net is stack minus chips added, including adjustments and withdrawals; it settles after each hand. Biggest wins and losses are net hand results. Totals cover retained entries; missing older history is unavailable. Hand counts include recorded nonzero results.</p></section>;
}
