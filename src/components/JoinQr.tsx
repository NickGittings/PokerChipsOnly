import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { ClientMsg, Snapshot } from '../../shared/types';
import { useDialogFocus } from './useDialogFocus';
import '../styles/game.css';

type Props = { snapshot: Snapshot; send: (msg: ClientMsg) => void; variant: 'panel' | 'large' | 'corner' };
export function JoinQr({ snapshot, send, variant }: Props) {
  const [expanded, setExpanded] = useState(false);
  const dealerModal = snapshot.game.phase === 'street-break' || snapshot.game.phase === 'showdown';
  const open = expanded && !dealerModal;
  const dialogRef = useDialogFocus(open);
  useEffect(() => { if (dealerModal) setExpanded(false); }, [dealerModal]);
  const qr = (size: number) => <div className="qr-well"><QRCodeSVG value={snapshot.joinUrl} size={size} bgColor="#F2EDE3" fgColor="#10321F" marginSize={2} title="Scan to join the table" /></div>;
  const url = <span className="join-url">{snapshot.joinUrl}</span>;
  const picker = snapshot.you.dealer && snapshot.joinUrls.length > 1 ? <label className="join-url-picker"><span>Join address</span><select aria-label="Join address" value={snapshot.joinUrl} onChange={event => send({ type: 'setJoinUrl', url: event.target.value })}>{snapshot.joinUrls.map(candidate => <option key={candidate} value={candidate}>{candidate}</option>)}</select></label> : null;
  if (variant !== 'corner') return <section className={`${variant === 'large' ? 'panel join-large' : 'game-panel'} join-panel`} aria-label="Join the table QR code"><span className="eyebrow">Pull up a chair</span><h2>Join the table</h2>{qr(variant === 'large' ? 260 : 160)}<p>Scan with your phone camera.<br />Stay on the same Wi-Fi.</p>{url}{picker}<div className="seat-count">{snapshot.game.players.length} / 8 seats filled</div></section>;
  return <><aside className="join-corner" aria-label="Join the table QR code"><button type="button" className="join-corner-trigger" aria-label="Enlarge join QR code" aria-haspopup="dialog" onClick={() => setExpanded(true)}>{qr(112)}<span>Join table · QR ↗</span></button>{url}{picker}</aside>{open && <div className="game-overlay join-qr-overlay" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Join the table" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setExpanded(false); } }} onClick={event => { if (event.target === event.currentTarget) setExpanded(false); }}><section className="game-panel join-panel join-large"><button type="button" className="game-button" onClick={() => setExpanded(false)}>Close QR code</button><h2>Join the table</h2>{qr(260)}<p>Scan with your phone camera.<br />Stay on the same Wi-Fi.</p>{url}{picker}</section></div>}</>;
}
