import { useCallback, useEffect, useRef, useState } from 'react';
import type { Player } from '../../shared/types';

interface Drag { playerId: string; fromSeat: number; pointerId: number; startX: number; startY: number; dx: number; dy: number; dragging: boolean }

/** Lets the host drag a seated player onto another seat to move or swap them. Mouse, touch, and a keyboard pick-up/drop fallback all funnel into the same `onMoveSeat`. Omit it to render seats inert. */
export function useSeatDrag(players: Player[], onMoveSeat?: (playerId: string, seat: number) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hoverSeat, setHoverSeat] = useState<number | null>(null);
  const [pickedSeat, setPickedSeat] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const rects = useRef(new Map<number, DOMRect>());

  const seatAt = useCallback((x: number, y: number) => {
    for (const [seat, rect] of rects.current) if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return seat;
    return null;
  }, []);

  useEffect(() => {
    if (!drag?.dragging) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setDrag(null); setHoverSeat(null); setAnnouncement('Move canceled.'); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drag?.dragging]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>, seat: number, player?: Player) => {
    if (!onMoveSeat || !player || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    rects.current = new Map(Array.from(document.querySelectorAll<HTMLElement>('[data-seat]')).map(el => [Number(el.dataset.seat), el.getBoundingClientRect()]));
    setPickedSeat(null); setAnnouncement('');
    setDrag({ playerId: player.id, fromSeat: seat, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, dx: 0, dy: 0, dragging: false });
  }, [onMoveSeat]);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    setDrag(current => {
      if (!current || event.pointerId !== current.pointerId) return current;
      const dx = event.clientX - current.startX, dy = event.clientY - current.startY;
      const dragging = current.dragging || Math.hypot(dx, dy) > 6;
      if (dragging) setHoverSeat(seatAt(event.clientX, event.clientY));
      return { ...current, dx, dy, dragging };
    });
  }, [seatAt]);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    setDrag(current => {
      if (!current || event.pointerId !== current.pointerId) return current;
      const target = seatAt(event.clientX, event.clientY);
      if (current.dragging && target !== null && target !== current.fromSeat) onMoveSeat?.(current.playerId, target);
      return null;
    });
    setHoverSeat(null);
  }, [seatAt, onMoveSeat]);

  const onPointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    setDrag(current => current && event.pointerId === current.pointerId ? null : current);
    setHoverSeat(null);
  }, []);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>, seat: number, player?: Player) => {
    if (!onMoveSeat) return;
    if (event.key === 'Escape' && pickedSeat !== null) { setPickedSeat(null); setAnnouncement('Move canceled.'); return; }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (pickedSeat === null) {
      if (!player) return;
      setPickedSeat(seat); setAnnouncement(`Picked up ${player.name} from seat ${seat + 1}. Choose a seat and press Enter to drop, or Escape to cancel.`);
    } else if (pickedSeat === seat) { setPickedSeat(null); setAnnouncement('Move canceled.'); }
    else {
      const moving = players.find(p => p.seat === pickedSeat);
      setPickedSeat(null);
      if (moving) { onMoveSeat(moving.id, seat); setAnnouncement(player ? `Swapped ${moving.name} and ${player.name}.` : `Moved ${moving.name} to seat ${seat + 1}.`); }
    }
  }, [onMoveSeat, pickedSeat, players]);

  const seatProps = useCallback((seat: number, player?: Player) => {
    const interactive = !!onMoveSeat;
    const dragThis = !!drag && drag.fromSeat === seat && drag.dragging;
    const picked = pickedSeat === seat;
    const dropTarget = interactive && (drag?.dragging ? hoverSeat === seat && seat !== drag.fromSeat : pickedSeat !== null && pickedSeat !== seat);
    const label = !interactive ? undefined : player ? `${player.name}, seat ${seat + 1}${pickedSeat !== null && !picked ? ' — press Enter to drop here' : ', press Enter to pick up'}` : `Empty seat ${seat + 1}${pickedSeat !== null ? ' — press Enter to drop here' : ''}`;
    return {
      'data-seat': seat,
      tabIndex: interactive ? 0 : undefined,
      role: interactive ? ('button' as const) : undefined,
      'aria-label': label,
      'aria-pressed': picked || undefined,
      className: `${player && interactive ? 'seat-draggable' : ''} ${dragThis || picked ? 'seat-dragging' : ''} ${dropTarget ? 'seat-drop-target' : ''}`.trim(),
      style: dragThis && drag ? { transform: `translate(-50%,-50%) translate(${drag.dx}px,${drag.dy}px)` } : undefined,
      onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => onPointerDown(event, seat, player),
      onPointerMove, onPointerUp, onPointerCancel,
      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => onKeyDown(event, seat, player),
    };
  }, [onMoveSeat, drag, hoverSeat, pickedSeat, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyDown]);

  return { seatProps, announcement };
}
