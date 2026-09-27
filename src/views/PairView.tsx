import { useState } from 'react';
import { parseOrigin } from '../net/serverOrigin';
import '../styles/game.css';
export function PairView({ onPair }: { onPair: (origin: string) => void }) {
  const [address, setAddress] = useState(''), [error, setError] = useState(''), [scanning, setScanning] = useState(false);
  const accept = (input: string) => { const origin = parseOrigin(input); if (origin) onPair(origin); else setError('That doesn’t look like a table address. Try something like 192.168.1.20:3000.'); };
  const scan = async () => {
    setError(''); setScanning(true);
    try {
      const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } = await import('@capacitor/barcode-scanner');
      const { ScanResult } = await CapacitorBarcodeScanner.scanBarcode({ hint: CapacitorBarcodeScannerTypeHint.QR_CODE, scanInstructions: 'Point your camera at the QR code on the table screen.' });
      if (ScanResult) accept(ScanResult);
    } catch { setError('Couldn’t scan. Check that camera access is allowed in Settings, or type the address below.'); }
    finally { setScanning(false); }
  };
  return <main className="join-page"><div className="join-emblem"><span className="brand-chip">♣</span></div><span className="eyebrow">First things first</span><h1>Find your table<span>.</span></h1><p className="intro-subtitle">Scan the QR code on the table screen.<br/><span className="muted">Both devices need to be on the same Wi‑Fi.</span></p>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button type="button" aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
    <section className="panel join-form"><button type="button" className="game-button primary wide" disabled={scanning} onClick={scan}>{scanning ? 'Opening camera…' : 'Scan QR code'}</button></section>
    <form className="panel join-form" onSubmit={e => { e.preventDefault(); accept(address); }}><label className="field"><span className="label">Or type the address</span><input aria-label="Table address" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="192.168.1.20:3000" value={address} onChange={e => { setAddress(e.target.value); setError(''); }}/></label><button type="submit" className="game-button wide" disabled={!address.trim()}>Connect</button></form>
    <p className="hint">The address is on the table screen, under the QR code.</p>
  </main>;
}
