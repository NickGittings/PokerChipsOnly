import { useState } from 'react';
import { localOrigin, parseOrigin } from '../net/serverOrigin';
import { nativeDebug } from '../net/platform';
import '../styles/game.css';
export function PairView({ onPair }: { onPair: (origin: string) => void }) {
  const [address, setAddress] = useState(''), [error, setError] = useState(''), [scanning, setScanning] = useState(false), [finding, setFinding] = useState(false);
  const accept = (input: string) => { const origin = parseOrigin(input); if (!origin) setError('That doesn’t look like a table address. Try something like 192.168.1.20:3000.'); else if (!localOrigin(origin)) setError('That address isn’t on your local network. Use the address shown on the table screen.'); else onPair(origin); };
  const scan = async () => {
    setError(''); setScanning(true);
    try {
      const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } = await import('@capacitor/barcode-scanner');
      const { ScanResult } = await CapacitorBarcodeScanner.scanBarcode({ hint: CapacitorBarcodeScannerTypeHint.QR_CODE, scanInstructions: 'Point your camera at the QR code on the table screen.' });
      if (ScanResult) accept(ScanResult);
    } catch { setError('Couldn’t scan. Check that camera access is allowed in Settings, or type the address below.'); }
    finally { setScanning(false); }
  };
  // Debug only: __DEBUG_TABLES__ is null outside `npm run build:debug` (so this compiles out) and nativeDebug is false in release native builds. Probes run in parallel but the earliest candidate that answers as a game server wins, keeping joinUrlCandidates' Wi‑Fi-before-VPN/bridge order; it's chosen as soon as every earlier candidate has failed, without waiting on later ones that may hang until the timeout.
  const tables = __DEBUG_TABLES__ && nativeDebug ? __DEBUG_TABLES__ : null, isTable = async (origin: string) => { const res = await fetch(`${origin}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(4000) }); if (!res.ok || (await res.json()).ok !== true) throw new Error('not a table'); return origin; };
  const findTable = tables && (async () => { setError(''); setFinding(true); try { let found: string | null = null; for (const probe of tables.map(origin => isTable(origin).catch(() => null))) if ((found = await probe)) break; if (found) accept(found); else setError(`No table found at ${tables.join(', ')}. Is the server running on the same Wi‑Fi? If iOS just asked about Local Network access, allow it and try again.`); } finally { setFinding(false); } });
  return <main className="join-page"><div className="join-emblem"><span className="brand-chip">♣</span></div><span className="eyebrow">First things first</span><h1>Find your table<span>.</span></h1><p className="intro-subtitle">Scan the QR code on the table screen.<br/><span className="muted">Both devices need to be on the same Wi‑Fi.</span></p>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button type="button" aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
    <section className="panel join-form"><button type="button" className="game-button primary wide" disabled={scanning} onClick={scan}>{scanning ? 'Opening camera…' : 'Scan QR code'}</button>{tables && findTable && <><button type="button" className="game-button wide" disabled={finding} onClick={findTable}>{finding ? 'Looking for your table…' : 'Debug: connect to my laptop'}</button><p className="hint">{tables.join(' · ')}</p></>}</section>
    <form className="panel join-form" onSubmit={e => { e.preventDefault(); accept(address); }}><label className="field"><span className="label">Or type the address</span><input aria-label="Table address" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="192.168.1.20:3000" value={address} onChange={e => { setAddress(e.target.value); setError(''); }}/></label><button type="submit" className="game-button wide" disabled={!address.trim()}>Connect</button></form>
    <p className="hint">The address is on the table screen, under the QR code.</p>
  </main>;
}
