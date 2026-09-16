import { useEffect, useState } from 'react';
import type { ClientMsg, Snapshot } from '../../shared/types';
import { money } from '../../shared/chips';
import { ChipStack } from './Chips';
import { useDialogFocus } from './useDialogFocus';

type Props = { snapshot: Snapshot; send: (msg: ClientMsg) => void; connected: boolean; dealer?: boolean };

export function StreetModal({ snapshot, send, connected, dealer = false }: Props) {
  const { game } = snapshot;
  const dialogRef = useDialogFocus(game.phase === 'street-break');
  if (game.phase !== 'street-break') return null;
  const total = game.players.reduce((sum, p) => sum + p.committedThisHand, 0);
  return <div className="game-overlay" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="street-title"><section className="street-modal"><span className="eyebrow">A moment for the dealer</span><div className="street-symbol" aria-hidden="true">♠</div><h1 id="street-title">{dealer ? 'Deal the' : 'Waiting for the'}<br /><em>{game.pendingStreet}</em></h1><p>{dealer ? game.pendingStreet === 'flop' ? 'Burn one card. Deal three cards face up.' : 'Burn one card. Deal one card face up.' : 'The dealer is putting the next cards on the table.'}</p><div className="street-pot"><ChipStack amount={total} denominations={game.config.denominations} /><strong>{money(total)} in the pot</strong><span>{game.players.filter(p => p.status === 'active' || p.status === 'all-in').length} players still in</span></div>{dealer ? <button className="game-button primary wide" disabled={!connected} onClick={() => send({ type: 'dealerConfirm', revision: game.revision })}>Cards dealt <span>→</span></button> : <div className="waiting-note"><span className="pulse-dot" /> Betting resumes when the dealer is ready</div>}</section></div>;
}

export function ShowdownModal({ snapshot, send, connected, dealer = false }: Props) {
  const { game } = snapshot;
  const potIndex = game.pots.findIndex(pot => !pot.awarded);
  const dialogRef = useDialogFocus(game.phase === 'showdown' && potIndex >= 0);
  const [winnerIds, setWinnerIds] = useState<string[]>([]);
  useEffect(() => setWinnerIds([]), [potIndex, game.hand, game.revision]);
  if (game.phase !== 'showdown' || potIndex < 0) return null;
  const pot = game.pots[potIndex];
  return <div className="game-overlay" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="showdown-title"><section className="street-modal showdown-modal"><span className="eyebrow">Showdown · pot {potIndex + 1} of {game.pots.length}</span><h1 id="showdown-title">{potIndex === 0 ? 'Main pot' : `Side pot ${potIndex}`}</h1><strong className="showdown-amount">{money(pot.amount)}</strong><ChipStack amount={pot.amount} denominations={game.config.denominations} /><p>{dealer ? 'Read the real cards, then choose the winner. Select more than one player to split.' : 'The dealer is confirming the winner of this pot.'}</p><div className="winner-options">{pot.eligibleIds.map(id => { const player = game.players.find(p => p.id === id); return <button className={`winner-option ${winnerIds.includes(id) ? 'selected' : ''}`} disabled={!dealer || !connected} key={id} aria-label={`Select winner ${player?.name ?? "Player"}`} onClick={() => setWinnerIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id])}><span className="seat-avatar">{player?.name.slice(0, 1)}</span><span>{player?.name ?? 'Player'}</span><span className="winner-check">{winnerIds.includes(id) ? '✓' : '○'}</span></button>; })}</div>{dealer && <button className="game-button primary wide" disabled={!connected || !winnerIds.length} onClick={() => send({ type: 'awardPot', potIndex, winnerIds, revision: game.revision })}>{winnerIds.length > 1 ? `Split pot ${winnerIds.length} ways` : 'Award pot'} <span>→</span></button>}<small>Only players eligible for this pot are shown.</small></section></div>;
}

export function GameOver({ snapshot }: { snapshot: Snapshot }) {
  const { game } = snapshot;
  if (game.phase !== 'tournament-over') return null;
  const ordered = [...game.players].sort((a, b) => (a.place ?? 1) - (b.place ?? 1));
  return <section className="game-panel game-over"><span className="eyebrow">Last player standing</span><div className="champion-symbol">♠</div><h1>{ordered[0]?.name} wins.</h1><p>A good night at the table.</p><ol>{ordered.map(p => <li key={p.id}><span>#{p.place ?? 1}</span><strong>{p.name}</strong><span>{money(p.stack)}</span></li>)}</ol></section>;
}
