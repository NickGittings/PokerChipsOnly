import type { GameState } from '../../shared/types';
import { blindLevel } from '../../shared/blinds';
import { money } from '../../shared/chips';
import { timer, timeLimitMs, timeUp } from '../../shared/clock';
export function BlindTimer({ game }: { game: GameState }) {
  const blinds = blindLevel(game.config, game.level);
  const limit = timeLimitMs(game.config);
  const finalHand = timeUp(game) && ['betting', 'street-break', 'showdown'].includes(game.phase);
  return <div className={`blind-timer${limit ? ' has-time-limit' : ''}`}>
    <div><span className="label">Level {game.level} · blinds</span><strong>{money(blinds.small)} <span className="muted">/</span> {money(blinds.big)}</strong></div>
    <div><span className="label">{game.clockPaused ? 'Clock paused' : 'Next level'}</span><strong>{timer(game.clockRemainingMs)}</strong></div>
    {limit > 0 && <div className="game-countdown"><span className="label">Game ends in</span><strong>{timer(Math.max(0, limit - game.elapsedMs))}</strong></div>}
    {game.pendingLevel !== game.level && <span className="notice">Blinds {game.pendingLevel > game.level ? 'up' : 'down'} next hand · level {game.pendingLevel}</span>}
    {finalHand && <span className="notice">Time's up · final hand</span>}
  </div>;
}
