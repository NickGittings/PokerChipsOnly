import type { GameState } from '../../shared/types';
import { blindLevel } from '../../shared/blinds';
import { money } from '../../shared/chips';
export function BlindTimer({ game }: { game: GameState }) {
  const blinds = blindLevel(game.config, game.level), seconds = Math.max(0, Math.ceil(game.clockRemainingMs / 1000));
  return <div className="blind-timer"><div><span className="label">Level {game.level} · blinds</span><strong>{money(blinds.small)} <span className="muted">/</span> {money(blinds.big)}</strong></div><div><span className="label">{game.clockPaused ? 'Clock paused' : 'Next level'}</span><strong>{Math.floor(seconds / 60).toString().padStart(2, '0')}<span className="muted">:</span>{(seconds % 60).toString().padStart(2, '0')}</strong></div>{game.pendingLevel > game.level && <span className="notice">Blinds up next hand · level {game.pendingLevel}</span>}</div>;
}
