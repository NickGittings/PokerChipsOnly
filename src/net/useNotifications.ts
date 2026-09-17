import { useCallback, useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../../shared/types';
import { placeOf } from '../../shared/standings';

export type Notice = { id: number; text: string; tone: 'turn' | 'deal' | 'bust' | 'info'; urgent?: boolean };

function dealPrompt(snapshot: Snapshot) {
  const { game, you } = snapshot;
  if (!you.dealing) return null;
  if (game.awaitingDeal) return `Hand ${game.hand} · deal the hole cards`;
  if (game.phase === 'street-break') return `Hand ${game.hand} · deal the ${game.pendingStreet}`;
  if (game.phase === 'showdown') { const pot = game.pots.findIndex(p => !p.awarded); return pot < 0 ? null : `Hand ${game.hand} · confirm the winner of pot ${pot + 1}`; }
  if (game.phase === 'hand-complete') return `Hand ${game.hand} complete · ready for the next hand`;
  return null;
}

export function useNotifications(snapshot: Snapshot | null, connected: boolean) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const previous = useRef<Snapshot | null>(null), audio = useRef<AudioContext | null>(null), sequence = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((id: number) => { clearTimeout(timers.current.get(id)); timers.current.delete(id); setNotices(items => items.filter(item => item.id !== id)); }, []);
  useEffect(() => {
    const pendingTimers = timers.current;
    const unlock = () => { try { audio.current ??= new AudioContext(); void audio.current.resume().catch(() => {}); } catch { /* Audio is optional on each browser. */ } };
    document.addEventListener('pointerdown', unlock); document.addEventListener('keydown', unlock);
    return () => { document.removeEventListener('pointerdown', unlock); document.removeEventListener('keydown', unlock); pendingTimers.forEach(clearTimeout); pendingTimers.clear(); void audio.current?.close().catch(() => {}); audio.current = null; };
  }, []);
  useEffect(() => {
    if (!snapshot) { previous.current = null; return; }
    if (!connected) return;
    const before = previous.current, { game, you } = snapshot, pending: Omit<Notice, 'id'>[] = [];
    const isTurn = !!you.legal;
    if (isTurn && (!before?.you.legal || before.game.actorId !== game.actorId || before.game.hand !== game.hand || before.game.street !== game.street)) pending.push({ text: 'Your turn to act', tone: 'turn', urgent: true });
    const prompt = dealPrompt(snapshot);
    if (prompt && (!before || dealPrompt(before) !== prompt)) pending.push({ text: prompt, tone: 'deal', urgent: true });
    if (before) for (const player of [...game.players, ...game.eliminated]) {
      const old = [...before.game.players, ...before.game.eliminated].find(p => p.id === player.id);
      if (old && old.status !== 'busted' && player.status === 'busted') { const place = placeOf(game, player); pending.push({ text: `${player.name} busted${place ? ` · finished #${place}` : ''}`, tone: 'bust', urgent: you.dealing || you.admin }); }
    }
    previous.current = snapshot;
    if (!pending.length) return;
    const added = pending.map(notice => ({ ...notice, id: ++sequence.current }));
    setNotices(items => [...items, ...added].slice(-4));
    for (const notice of added) timers.current.set(notice.id, setTimeout(() => dismiss(notice.id), notice.urgent ? 8000 : 5000));
    const audible = pending.find(notice => notice.urgent);
    if (!audible) return;
    try { navigator.vibrate?.(audible.tone === 'bust' ? [150, 70, 150] : [80, 50, 80]); } catch { /* Vibration is optional. */ }
    try { const ctx = audio.current; if (ctx?.state === 'running') { const oscillator = ctx.createOscillator(), gain = ctx.createGain(); oscillator.connect(gain); gain.connect(ctx.destination); oscillator.frequency.value = audible.tone === 'bust' ? 440 : audible.tone === 'deal' ? 880 : 660; gain.gain.setValueAtTime(.05, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .22); oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); }; oscillator.start(); oscillator.stop(ctx.currentTime + .22); } } catch { /* Sound is optional. */ }
  }, [snapshot, connected, dismiss]);
  useEffect(() => {
    const title = document.title, notice = connected ? [...notices].reverse().find(item => item.urgent) : undefined;
    let interval: ReturnType<typeof setInterval> | undefined, flash = false;
    const update = () => { clearInterval(interval); document.title = title; flash = false; if (document.hidden && notice) { document.title = notice.text; interval = setInterval(() => { flash = !flash; document.title = flash ? title : notice.text; }, 1000); } };
    update(); document.addEventListener('visibilitychange', update);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', update); document.title = title; };
  }, [notices, connected]);
  return { notices, dismiss };
}
