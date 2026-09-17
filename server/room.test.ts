import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { Room } from './room';
import { DEFAULT_CONFIG } from '../shared/blinds';
import type { Action, ServerMsg } from '../shared/types';
import { assertChips } from './engine/helpers';
import { standings } from '../shared/standings';

// Exercise the real room boundary while keeping transport deterministic. The
// bootstrap only parses JSON and passes it to handle; no engine calls are mocked.
function socket() {
  const messages: ServerMsg[] = [];
  const ws = { readyState: WebSocket.OPEN, send: (raw: string) => messages.push(JSON.parse(raw)) } as unknown as WebSocket;
  return { ws, messages, state: () => ([...messages].reverse().find(m => m.type === 'state') as Extract<ServerMsg, { type: 'state' }>).snapshot, error: () => [...messages].reverse().find(m => m.type === 'error') as Extract<ServerMsg, { type: 'error' }> | undefined };
}
type Device = ReturnType<typeof socket>;
const tokens = ['board_device_token_0001', 'alice_device_token_0001', 'bob_device_token_000001', 'cara_device_token_00001'];
function connect(room: Room, index: number, board = false) {
  const device = socket(); room.handle(device.ws, { type: 'join', token: tokens[index], board }); return device;
}
function table(file: string | null = null) {
  const room = new Room('http://192.168.1.2:3000', file), board = connect(room, 0, true);
  const phones = [1, 2, 3].map(index => connect(room, index));
  phones.forEach((phone, seat) => room.handle(phone.ws, { type: 'claimSeat', seat, name: ['Alice', 'Bob', 'Cara'][seat] }));
  return { room, board, phones };
}
function start(room: Room, board: Device) { room.handle(board.ws, { type: 'startTournament', config: DEFAULT_CONFIG }); expect(room.game.phase).toBe('betting'); dealer(room, board, 'dealerConfirm'); }
function act(room: Room, phones: Device[], action: Action) {
  if (room.game.awaitingDeal) { const dealing = phones.find(p => p.state().you.dealing)!; room.handle(dealing.ws, { type: 'dealerConfirm', revision: room.game.revision }); }
  const phone = phones.find(p => p.state().you.id === room.game.actorId)!;
  room.handle(phone.ws, { type: 'action', action, revision: room.game.revision });
  return phone;
}
function dealer(room: Room, board: Device, type: 'undo' | 'dealerConfirm' | 'nextHand') { room.handle(board.ws, { type, revision: room.game.revision }); }
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('authoritative multiplayer room', () => {
  it('elects the first device host and sends personalized snapshots without tokens', () => {
    const { room, board, phones } = table(); start(room, board);
    expect(board.state().you).toMatchObject({ host: true, admin: true, legal: null });
    expect(phones.map(p => p.state().you.host)).toEqual([false, false, false]);
    expect(phones.filter(p => p.state().you.legal)).toHaveLength(1);
    expect(new Set(phones.map(p => p.state().you.id)).size).toBe(3);
    for (const token of tokens) expect(JSON.stringify(board.state())).not.toContain(token);
    expect(board.state().joinUrl).toBe('http://192.168.1.2:3000');
    expect(board.state().joinUrls).toEqual(['http://192.168.1.2:3000']);
  });

  it('switches only to candidate URLs for dealers without changing game state or undo history', () => {
    const urls = ['http://192.168.1.2:3000', 'http://10.0.0.2:3000'];
    const room = new Room(urls, null), board = connect(room, 0, true), phone = connect(room, 1);
    expect(phone.state().joinUrls).toEqual([urls[0]]);
    const before = structuredClone(room.game), undo = structuredClone(room.undoStack);
    room.handle(phone.ws, { type: 'setJoinUrl', url: urls[1] });
    expect(phone.error()?.message).toMatch(/board admin/i); expect(room.joinUrl).toBe(urls[0]);
    room.handle(board.ws, { type: 'setJoinUrl', url: 'https://example.com' });
    expect(board.error()?.message).toMatch(/available join URLs/i); expect(room.joinUrl).toBe(urls[0]);
    room.handle(board.ws, { type: 'setJoinUrl', url: urls[1] });
    expect(phone.state().joinUrl).toBe(urls[1]); expect(phone.state().joinUrls).toEqual([urls[1]]);
    expect(board.state().joinUrls).toEqual(urls);
    expect(room.game).toEqual(before); expect(room.undoStack).toEqual(undo);
  });

  it('restores the selected join URL only while it remains a current candidate', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-room-')); directories.push(directory);
    const file = join(directory, 'state.json'), urls = ['http://192.168.1.2:3000', 'http://10.0.0.2:3000'];
    const room = new Room(urls, file), host = connect(room, 0, true);
    room.handle(host.ws, { type: 'setJoinUrl', url: urls[1] });
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved).toMatchObject({ version: 2, joinUrl: urls[1] });
    expect(new Room(urls, file).joinUrl).toBe(urls[1]);
    expect(new Room(urls[0], file).joinUrl).toBe(urls[0]);
    delete saved.joinUrl; writeFileSync(file, JSON.stringify(saved));
    expect(new Room(urls, file).joinUrl).toBe(urls[0]);
  });

  it('reclaims a disconnected seat with its stack and turn, clearing stale identities', () => {
    const { room, board, phones } = table(); start(room, board);
    const old = phones[0], duplicate = connect(room, 1), player = structuredClone(room.game.players[0]);
    room.disconnect(old.ws); room.disconnect(duplicate.ws);
    const replacement = socket(); room.handle(replacement.ws, { type: 'join', token: 'replacement_device_00001' });
    const revision = room.game.revision, undo = structuredClone(room.undoStack), actor = room.game.actorId;
    room.handle(replacement.ws, { type: 'reclaimSeat', playerId: player.id });
    expect(replacement.state().you.id).toBe(player.id);
    expect(replacement.state().you.legal).not.toBeNull();
    expect(room.game.players.find(p => p.id === player.id)).toEqual({ ...player, connected: true });
    expect(room.game.actorId).toBe(actor); expect(room.game.revision).toBe(revision + 1);
    expect(room.game.log.at(-1)?.text).toBe('Alice reconnected on a new device.');
    expect(room.undoStack).toEqual(undo); assertChips(room.game);
    const stale = connect(room, 1);
    expect(room.game.players.some(p => p.id === stale.state().you.id)).toBe(false);
    expect(room.identities.replacement_device_00001.name).toBe('Alice');
    room.handle(replacement.ws, { type: 'action', action: { type: 'call' }, revision: room.game.revision });
    expect(room.game.actorId).not.toBe(actor); assertChips(room.game);
  });

  it('rejects reclaim for unknown players and already seated callers without remapping identities', () => {
    const { room, phones } = table(), fresh = socket();
    room.handle(fresh.ws, { type: 'join', token: 'replacement_device_00001' });
    const game = structuredClone(room.game), identities = structuredClone(room.identities);
    room.handle(fresh.ws, { type: 'reclaimSeat', playerId: phones[0].state().you.id });
    expect(fresh.error()?.message).toMatch(/seat is live/i);
    expect(room.game).toEqual(game); expect(room.identities).toEqual(identities);
    room.handle(fresh.ws, { type: 'reclaimSeat', playerId: 'missing-player' });
    expect(fresh.error()?.message).toMatch(/not seated/i);
    room.handle(phones[0].ws, { type: 'reclaimSeat', playerId: phones[1].state().you.id });
    expect(phones[0].error()?.message).toMatch(/already hold a seat/i);
    expect(room.game).toEqual(game); expect(room.identities).toEqual(identities);
  });

  it('reclaims a ghost seat in the lobby and preserves the remap across recovery', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-room-')); directories.push(directory);
    const file = join(directory, 'state.json'), { room, phones } = table(file), fresh = socket();
    const id = phones[0].state().you.id;
    room.disconnect(phones[0].ws); room.handle(fresh.ws, { type: 'join', token: 'replacement_device_00001' });
    room.handle(fresh.ws, { type: 'reclaimSeat', playerId: id });
    expect(room.game.players).toHaveLength(3); expect(room.game.totalChips).toBe(0);
    const recovered = new Room(room.joinUrl, file), returning = socket();
    room.handle(fresh.ws, { type: 'leaveSeat' }); // Current room changes cannot affect the recovered copy.
    recovered.handle(returning.ws, { type: 'join', token: 'replacement_device_00001' });
    expect(returning.state().you.id).toBe(id); expect(connect(recovered, 1).state().you.id).not.toBe(id);
  });

  it('routes lobby buy-ins through seat claiming with no chips until the tournament starts', () => {
    const { room, board, phones } = table();
    room.handle(phones[0].ws, { type: 'lateBuyIn', name: ' Alice ', seat: 7 });
    expect(room.game.players).toHaveLength(3); expect(room.game.totalChips).toBe(0);
    expect(room.game.players.find(p => p.name === 'Alice')).toMatchObject({ seat: 7, stack: 0 });
    start(room, board); expect(room.game.totalChips).toBe(1500); assertChips(room.game);
  });

  it('allows a late buy-in between hands, validates it, and preserves accounting through next-hand undo', () => {
    const { room, board, phones } = table(); start(room, board);
    const fresh = socket(); room.handle(fresh.ws, { type: 'join', token: 'late_buyin_device_00001' });
    const before = structuredClone(room.game);
    room.handle(fresh.ws, { type: 'lateBuyIn', name: 'Dan', seat: 3 });
    expect(fresh.error()?.message).toMatch(/between hands/i); expect(room.game).toEqual(before);
    act(room, phones, { type: 'fold' }); act(room, phones, { type: 'fold' });
    expect(room.game.phase).toBe('hand-complete');
    const complete = structuredClone(room.game), undoCount = room.undoStack.length;
    for (const [name, seat] of [['', 3], ['x'.repeat(25), 3], ['Dan', -1], ['Dan', 8], ['Dan', 1.5], ['Dan', 0]] as const) {
      room.handle(fresh.ws, { type: 'lateBuyIn', name, seat }); expect(room.game).toEqual(complete);
    }
    room.handle(phones[0].ws, { type: 'lateBuyIn', name: 'Alice', seat: 3 });
    expect(phones[0].error()?.message).toMatch(/already hold a seat/i); expect(room.game).toEqual(complete);
    room.handle(fresh.ws, { type: 'lateBuyIn', name: ' Dan ', seat: 3 });
    expect(room.game.players.find(p => p.id === fresh.state().you.id)).toMatchObject({ name: 'Dan', stack: 500, seat: 3 });
    expect(room.game.totalChips).toBe(2000); expect(room.undoStack).toHaveLength(undoCount + 1); assertChips(room.game);
    dealer(room, board, 'nextHand'); expect(room.game.phase).toBe('betting'); assertChips(room.game);
    dealer(room, board, 'undo'); expect(room.game.phase).toBe('hand-complete');
    expect(room.game.players).toHaveLength(4); expect(room.game.totalChips).toBe(2000); assertChips(room.game);
    dealer(room, board, 'undo');
    expect(room.game.players).toEqual(complete.players); expect(room.game.totalChips).toBe(1500); assertChips(room.game);
    dealer(room, board, 'undo');
    expect(room.game.phase).toBe('betting'); assertChips(room.game);
  });


  it('keeps a pot award undoable after a late buy-in', () => {
    const { room, board, phones } = table(); start(room, board);
    act(room, phones, { type: 'call' }); act(room, phones, { type: 'call' }); act(room, phones, { type: 'check' });
    for (let i = 0; i < 3; i++) {
      dealer(room, board, 'dealerConfirm');
      for (let j = 0; j < 3; j++) act(room, phones, { type: 'check' });
    }
    const showdown = structuredClone(room.game);
    room.handle(board.ws, { type: 'awardPot', potIndex: 0, winnerIds: [phones[0].state().you.id], revision: room.game.revision });
    const fresh = socket(); room.handle(fresh.ws, { type: 'join', token: 'late_buyin_device_00001' });
    room.handle(fresh.ws, { type: 'lateBuyIn', name: 'Dan', seat: 3 });
    dealer(room, board, 'undo'); dealer(room, board, 'undo');
    expect(room.game.phase).toBe('showdown'); expect(room.game.players).toEqual(showdown.players);
    expect(room.game.pots).toEqual(showdown.pots); expect(room.game.totalChips).toBe(1500); assertChips(room.game);
  });

  it('restores a busted player with an undoable rebuy and rejects ineligible requests', () => {
    const { room, board, phones } = table(); start(room, board);
    room.handle(phones[0].ws, { type: 'rebuy' }); expect(phones[0].error()?.message).toMatch(/between hands/i);
    act(room, phones, { type: 'fold' }); act(room, phones, { type: 'fold' });
    room.handle(phones[0].ws, { type: 'rebuy' }); expect(phones[0].error()?.message).toMatch(/busted/i);
    const player = room.game.players[0];
    room.handle(board.ws, { type: 'hostAdjust', playerId: player.id, delta: -player.stack, revision: room.game.revision });
    const before = structuredClone(room.game);
    room.handle(phones[0].ws, { type: 'rebuy' });
    expect(room.game.players[0]).toMatchObject({ stack: 500, handStartStack: 500, status: 'active' });
    expect(room.game.players[0].bustOrder).toBeUndefined(); expect(room.game.totalChips).toBe(before.totalChips + 500); assertChips(room.game);
    const after = structuredClone(room.game);
    room.handle(phones[0].ws, { type: 'rebuy' }); expect(room.game).toEqual(after);
    dealer(room, board, 'undo'); expect(room.game.players).toEqual(before.players); expect(room.game.totalChips).toBe(before.totalChips); assertChips(room.game);
    const fresh = socket(); room.handle(fresh.ws, { type: 'join', token: 'late_buyin_device_00001' });
    room.handle(fresh.ws, { type: 'rebuy' }); expect(fresh.error()?.message).toMatch(/seat/i);
    room.handle(fresh.ws, { type: 'lateBuyIn', name: 'Dan', seat: player.seat });
    expect(room.game.players).toHaveLength(3); expect(room.game.players.some(p => p.id === player.id)).toBe(false);
    expect(room.game.players.find(p => p.name === 'Dan')).toMatchObject({ stack: 500, seat: player.seat });
    expect(room.game.totalChips).toBe(before.totalChips + 500); assertChips(room.game);
    expect(room.game.log.some(entry => /took Alice/.test(entry.text))).toBe(true);
    // Taking over a busted seat archives the outgoing player instead of erasing them —
    // they still surface in the final standings.
    expect(room.game.eliminated).toEqual([before.players.find(p => p.id === player.id)]);
    dealer(room, board, 'undo'); expect(room.game.players).toEqual(before.players); expect(room.game.eliminated).toEqual([]); assertChips(room.game);
  });

  it.each([false, true])('retires a displaced device identity (offline: %s), persists it, and restores it on undo', offline => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-room-')); directories.push(directory);
    const file = join(directory, 'state.json'), { room, board, phones } = table(file); start(room, board);
    act(room, phones, { type: 'fold' }); act(room, phones, { type: 'fold' });
    const player = room.game.players[0], originalId = player.id;
    room.handle(board.ws, { type: 'hostAdjust', playerId: originalId, delta: -player.stack, revision: room.game.revision });
    if (offline) room.disconnect(phones[0].ws);
    const fresh = socket(); room.handle(fresh.ws, { type: 'join', token: 'late_buyin_device_00001' });
    room.handle(fresh.ws, { type: 'lateBuyIn', name: 'Dan', seat: player.seat });
    const displaced = offline ? connect(room, 1) : phones[0];
    const newId = displaced.state().you.id;
    expect(newId).not.toBe(originalId);
    expect(room.game.eliminated.map(p => p.id)).toEqual([originalId]);
    expect(room.game.players.some(p => p.id === newId)).toBe(false);
    const recovered = new Room(room.joinUrl, file);
    expect(connect(recovered, 1).state().you.id).toBe(newId);
    room.handle(displaced.ws, { type: 'lateBuyIn', name: 'Alice again', seat: 3 });
    expect(displaced.error()).toBeUndefined();
    expect(room.game.players.find(p => p.id === newId)?.seat).toBe(3);
    const ids = [...room.game.players, ...room.game.eliminated].map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const rankedIds = standings(room.game).map(({ player }) => player.id);
    expect(new Set(rankedIds).size).toBe(rankedIds.length);
    dealer(room, board, 'undo'); // Undo the displaced player's new buy-in first.
    expect(displaced.state().you.id).toBe(newId);
    dealer(room, board, 'undo'); // Undo the takeover, including its identity rotation.
    expect(displaced.state().you.id).toBe(originalId);
    expect(room.game.players.find(p => p.id === originalId)?.connected).toBe(true);
    expect(room.game.eliminated).toEqual([]); assertChips(room.game);
  });

  it('does not undo a later device reclaim when undoing a takeover', () => {
    const { room, board, phones } = table(); start(room, board);
    act(room, phones, { type: 'fold' }); act(room, phones, { type: 'fold' });
    const player = room.game.players[0], originalId = player.id;
    room.handle(board.ws, { type: 'hostAdjust', playerId: originalId, delta: -player.stack, revision: room.game.revision });
    const fresh = socket(); room.handle(fresh.ws, { type: 'join', token: 'late_buyin_device_00001' });
    room.handle(fresh.ws, { type: 'lateBuyIn', name: 'Dan', seat: player.seat });
    const bobId = phones[1].state().you.id;
    room.disconnect(phones[1].ws);
    room.handle(phones[0].ws, { type: 'reclaimSeat', playerId: bobId });
    expect(phones[0].state().you.id).toBe(bobId);
    dealer(room, board, 'undo');
    expect(phones[0].state().you.id).toBe(bobId);
    expect(room.game.players.find(p => p.id === bobId)?.connected).toBe(true);
    expect(room.game.players.find(p => p.id === originalId)?.connected).toBe(false);
    expect(connect(room, 2).state().you.id).not.toBe(bobId);
    assertChips(room.game);
  });

  it.each(['lateBuyIn', 'rebuy'] as const)('rejects an unmakeable %s after color-up without mutation', type => {
    const { room, board, phones } = table(); start(room, board);
    act(room, phones, { type: 'fold' }); act(room, phones, { type: 'fold' });
    // A valid between-hand table with an original 500 buy-in and a new 30 chip unit.
    room.game.config.denominations = [5, 30, 60].map(value => ({ value, color: '#ffffff' }));
    room.game.players.forEach((p, i) => { p.stack = i === 0 ? 0 : 750; p.status = i === 0 ? 'busted' : 'active'; });
    room.handle(board.ws, { type: 'colorUp', revision: room.game.revision });
    expect(room.game.config.denominations.map(d => d.value)).toEqual([30, 60]); assertChips(room.game);
    const fresh = socket(); room.handle(fresh.ws, { type: 'join', token: 'late_buyin_device_00001' });
    const before = structuredClone(room.game), identities = structuredClone(room.identities), undo = structuredClone(room.undoStack);
    const device = type === 'rebuy' ? phones[0] : fresh;
    room.handle(device.ws, { type, name: 'Dan', seat: 0 });
    expect(device.error()?.message).toMatch(/current chip denominations/i);
    expect(room.game).toEqual(before); expect(room.identities).toEqual(identities); expect(room.undoStack).toEqual(undo);
  });

  it('resolves simultaneous seat claims and allows only one seat per identity', () => {
    const room = new Room('http://localhost:3000', null), a = connect(room, 1), b = connect(room, 2);
    room.handle(a.ws, { type: 'claimSeat', seat: 0, name: 'Alice' });
    room.handle(b.ws, { type: 'claimSeat', seat: 0, name: 'Bob' });
    expect(b.error()?.message).toMatch(/seat.*taken/i);
    expect(room.game.players).toHaveLength(1);
    room.handle(a.ws, { type: 'claimSeat', seat: 7, name: 'Alice' });
    expect(room.game.players).toHaveLength(1); expect(room.game.players[0].seat).toBe(7);
  });

  it('lets the dealer move a lobby seat to an empty spot without touching undo history', () => {
    const { room, board, phones } = table();
    const aliceId = phones[0].state().you.id, undoCount = room.undoStack.length, revision = room.game.revision;
    room.handle(board.ws, { type: 'moveSeat', playerId: aliceId, seat: 5, revision });
    expect(room.game.players.find(p => p.id === aliceId)).toMatchObject({ seat: 5 });
    expect(room.game.log.at(-1)?.text).toMatch(/moved.*seat 6/i);
    expect(room.game.revision).toBe(revision + 1); expect(room.undoStack).toHaveLength(undoCount);
    assertChips(room.game);
  });

  it('swaps two occupied seats when the dealer drops a player onto a taken seat', () => {
    const { room, board, phones } = table();
    const aliceId = phones[0].state().you.id, bobId = phones[1].state().you.id;
    room.handle(board.ws, { type: 'moveSeat', playerId: aliceId, seat: 1, revision: room.game.revision });
    expect(room.game.players.find(p => p.id === aliceId)).toMatchObject({ seat: 1 });
    expect(room.game.players.find(p => p.id === bobId)).toMatchObject({ seat: 0 });
    expect(room.game.log.at(-1)?.text).toMatch(/swapped/i);
    assertChips(room.game);
  });

  it('rejects moveSeat from non-dealers and from stale, out-of-range, or unknown requests', () => {
    const { room, board, phones } = table();
    const aliceId = phones[0].state().you.id, before = structuredClone(room.game);
    room.handle(phones[0].ws, { type: 'moveSeat', playerId: aliceId, seat: 5, revision: room.game.revision });
    expect(phones[0].error()?.message).toMatch(/board admin/i); expect(room.game).toEqual(before);
    room.handle(board.ws, { type: 'moveSeat', playerId: aliceId, seat: 5, revision: room.game.revision + 1 });
    expect(board.error()?.message).toMatch(/table changed/i); expect(room.game).toEqual(before);
    for (const seat of [-1, 8, 1.5]) {
      room.handle(board.ws, { type: 'moveSeat', playerId: aliceId, seat, revision: room.game.revision });
      expect(board.error()?.message).toMatch(/seat/i); expect(room.game).toEqual(before);
    }
    room.handle(board.ws, { type: 'moveSeat', playerId: 'unknown-id', seat: 5, revision: room.game.revision });
    expect(board.error()?.message).toMatch(/not seated/i); expect(room.game).toEqual(before);
    room.handle(board.ws, { type: 'moveSeat', playerId: aliceId, seat: 0, revision: room.game.revision });
    expect(board.error()?.message).toMatch(/already/i); expect(room.game).toEqual(before);
  });

  it('locks seats mid-hand and unlocks once the hand completes, and the moved seat survives recovery', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-room-')); directories.push(directory);
    const file = join(directory, 'state.json'), { room, board, phones } = table(file);
    start(room, board);
    const aliceId = phones[0].state().you.id, before = structuredClone(room.game);
    room.handle(board.ws, { type: 'moveSeat', playerId: aliceId, seat: 2, revision: room.game.revision });
    expect(board.error()?.message).toMatch(/lobby or between hands/i); expect(room.game).toEqual(before);
    act(room, phones, { type: 'fold' }); act(room, phones, { type: 'fold' });
    expect(room.game.phase).toBe('hand-complete');
    room.handle(board.ws, { type: 'moveSeat', playerId: aliceId, seat: 2, revision: room.game.revision });
    expect(room.game.players.find(p => p.id === aliceId)).toMatchObject({ seat: 2 });
    assertChips(room.game);
    const recovered = new Room(room.joinUrl, file);
    expect(recovered.game.players.find(p => p.id === aliceId)).toMatchObject({ seat: 2 });
  });

  it('rejects unjoined devices, invalid tokens, malformed messages, and ordinary-player administration', () => {
    const { room, phones } = table(); const unknown = socket();
    room.handle(unknown.ws, { type: 'claimSeat', seat: 4, name: 'Unknown' });
    expect(unknown.error()?.message).toMatch(/join/i);
    room.handle(unknown.ws, { type: 'join', token: '__proto__' });
    expect(unknown.error()?.message).toMatch(/token/i);
    room.handle(unknown.ws, null); expect(unknown.error()?.message).toMatch(/invalid/i);
    const before = structuredClone(room.game);
    room.handle(phones[0].ws, { type: 'startTournament', config: DEFAULT_CONFIG });
    expect(phones[0].error()?.message).toMatch(/board admin/i); expect(room.game).toEqual(before);
  });

  it('grants dealer controls to a board even when another device became host', () => {
    const room = new Room('http://localhost:3000', null), host = connect(room, 1), phone = connect(room, 2), board = connect(room, 0, true);
    room.handle(host.ws, { type: 'claimSeat', seat: 0, name: 'Alice' });
    room.handle(phone.ws, { type: 'claimSeat', seat: 1, name: 'Bob' });
    expect(board.state().you).toMatchObject({ host: false, admin: true }); start(room, board);
  });

  it('does not retain board permission on a player connection after host failover', () => {
    const { room, board, phones } = table();
    room.disconnect(board.ws); expect(phones[0].state().you.host).toBe(true);
    const setup = connect(room, 0, false);
    expect(setup.state().you).toMatchObject({ host: false, admin: false });
    room.handle(setup.ws, { type: 'startTournament', config: DEFAULT_CONFIG });
    expect(setup.error()?.message).toMatch(/board admin/i);
    const boardSetup = connect(room, 0, true);
    start(room, boardSetup); expect(room.game.totalChips).toBe(1500);
  });

  it('rejects out-of-turn, stale, and duplicate intents without moving chips', () => {
    const { room, board, phones } = table(); start(room, board);
    const inactive = phones.find(p => p.state().you.id !== room.game.actorId)!;
    const before = structuredClone(room.game);
    room.handle(inactive.ws, { type: 'action', action: { type: 'fold' }, revision: room.game.revision });
    expect(inactive.error()?.message).toMatch(/turn/i); expect(room.game).toEqual(before);
    const revision = room.game.revision, actor = act(room, phones, { type: 'call' });
    const after = structuredClone(room.game);
    room.handle(actor.ws, { type: 'action', action: { type: 'call' }, revision });
    expect(actor.error()?.message).toMatch(/table changed/i); expect(room.game).toEqual(after); assertChips(room.game);
  });

  it('requires a current integer revision on every revision-bearing intent', () => {
    const { room, board, phones } = table(); start(room, board);
    const actor = phones.find(p => p.state().you.id === room.game.actorId)!;
    const before = structuredClone(room.game);
    for (const revision of [undefined, null, '3', 1.5, -1]) {
      const extras = revision === undefined ? {} : { revision };
      room.handle(actor.ws, { type: 'action', action: { type: 'call' }, ...extras });
      expect(actor.error()?.message).toMatch(/table changed|revision/i); expect(room.game).toEqual(before);
    }
    for (const type of ['dealerConfirm', 'nextHand', 'undo', 'pauseClock', 'awardPot', 'hostAdjust', 'adjustLevel', 'adjustDuration', 'colorUp', 'newGame', 'removePlayer']) {
      room.handle(board.ws, { type }); expect(board.error()?.message).toMatch(/table changed|revision/i); expect(room.game).toEqual(before);
    }
  });

  it('keeps countdown revisions stable but rejects stale dealer intents after blinds advance', () => {
    const { room, board } = table(); start(room, board);
    const revision = room.game.revision, now = room.game.clockUpdatedAt;
    room.tick(now + 1000);
    expect(room.game.revision).toBe(revision);
    expect(room.game.elapsedMs).toBe(1000);
    room.tick(now + room.game.config.levelMinutes * 60_000);
    expect(room.game.pendingLevel).toBe(2);
    expect(board.state().game.revision).toBe(revision + 1);
    const before = structuredClone(room.game);
    room.handle(board.ws, { type: 'adjustLevel', delta: 1, revision });
    expect(board.error()?.message).toMatch(/table changed/i); expect(room.game).toEqual(before);
  });

  it('bumps revision when time expires between hands and rejects a stale pauseClock', () => {
    const { room, board, phones } = table();
    room.handle(board.ws, { type: 'startTournament', config: { ...DEFAULT_CONFIG, durationMinutes: 5 } });
    act(room, phones, { type: 'fold' }); act(room, phones, { type: 'fold' });
    expect(room.game.phase).toBe('hand-complete');
    const revision = room.game.revision;
    room.tick(room.game.clockUpdatedAt + 300_000);
    expect(room.game).toMatchObject({ phase: 'tournament-over', clockPaused: true, revision: revision + 1 });
    expect(board.state().game.revision).toBe(revision + 1);
    const before = structuredClone(room.game);
    room.handle(board.ws, { type: 'pauseClock', revision });
    expect(board.error()?.message).toMatch(/table changed/i); expect(room.game).toEqual(before);
    room.tick(room.game.clockUpdatedAt + 1000);
    expect(room.game.revision).toBe(revision + 1);
  });

  it('rejects malformed bet amounts without negative chips or state mutation', () => {
    const { room, board, phones } = table(); start(room, board);
    const before = structuredClone(room.game);
    for (const amount of [-10, 0, 11, 1.5, 100_000, Number.MAX_SAFE_INTEGER]) {
      const phone = act(room, phones, { type: 'raise', amount });
      expect(phone.error()).toBeDefined(); expect(room.game).toEqual(before); assertChips(room.game);
    }
    room.handle(board.ws, { type: 'hostAdjust', playerId: room.game.players[0].id, delta: -9999, revision: room.game.revision });
    expect(board.error()?.message).toMatch(/between hands/i); expect(room.game).toEqual(before);
  });

  it('restores an accidental fold and bumps revision on undo', () => {
    const { room, board, phones } = table(); start(room, board);
    const before = structuredClone(room.game), folded = act(room, phones, { type: 'fold' });
    expect(room.game.players.find(p => p.id === folded.state().you.id)?.status).toBe('folded');
    dealer(room, board, 'undo');
    expect(room.game.players).toEqual(before.players); expect(room.game.actorId).toBe(before.actorId);
    expect(room.game.revision).toBe(before.revision + 2); expect(room.game.log.at(-1)?.text).toMatch(/undid/i); assertChips(room.game);
  });

  it('restricts manual blinds to dealers and keeps them out of undo history', () => {
    const { room, board, phones } = table(); start(room, board);
    const before = structuredClone(room.game), undoCount = room.undoStack.length;
    room.handle(phones[0].ws, { type: 'adjustLevel', delta: 1, revision: room.game.revision });
    expect(phones[0].error()?.message).toMatch(/board admin/i); expect(room.game).toEqual(before);
    room.handle(board.ws, { type: 'adjustLevel', delta: 1, revision: room.game.revision });
    expect(room.game.pendingLevel).toBe(2); expect(room.game.level).toBe(1);
    expect(room.game.revision).toBe(before.revision + 1); expect(room.undoStack).toHaveLength(undoCount);
    room.handle(board.ws, { type: 'adjustLevel', delta: 1, revision: before.revision });
    expect(board.error()?.message).toMatch(/table changed/i); expect(room.game.pendingLevel).toBe(2);
  });

  it('preserves a manually decreased blind level and elapsed play time through undo', () => {
    const { room, board, phones } = table(); start(room, board);
    room.handle(board.ws, { type: 'adjustLevel', delta: 1, revision: room.game.revision });
    act(room, phones, { type: 'fold' });
    room.tick(room.game.clockUpdatedAt + 20_000);
    room.handle(board.ws, { type: 'adjustLevel', delta: -1, revision: room.game.revision });
    const remaining = room.game.clockRemainingMs, elapsed = room.game.elapsedMs;
    dealer(room, board, 'undo');
    expect(room.game).toMatchObject({ pendingLevel: 1, elapsedMs: elapsed, clockRemainingMs: remaining });
    expect(elapsed).toBe(20_000); expect(room.game.players.every(p => p.status !== 'folded')).toBe(true); assertChips(room.game);
  });

  it('undoes a time-up final award, then finishes again with tied chip leaders', () => {
    const { room, board, phones } = table();
    room.handle(board.ws, { type: 'startTournament', config: { ...DEFAULT_CONFIG, durationMinutes: 5 } });
    act(room, phones, { type: 'all-in' }); act(room, phones, { type: 'call' }); act(room, phones, { type: 'call' });
    for (let i = 0; i < 3; i++) dealer(room, board, 'dealerConfirm');
    room.tick(room.game.clockUpdatedAt + 300_000);
    expect(room.game.phase).toBe('showdown'); expect(room.game.clockPaused).toBe(false);
    const before = structuredClone(room.game), winnerIds = phones.slice(0, 2).map(phone => phone.state().you.id);
    const award = () => room.handle(board.ws, { type: 'awardPot', potIndex: 0, winnerIds, revision: room.game.revision });
    award();
    expect(room.game.phase).toBe('tournament-over'); expect(room.game.clockPaused).toBe(true);
    expect(standings(room.game).map(({ place }) => place)).toEqual([1, 1, 3]);
    dealer(room, board, 'undo');
    expect(room.game).toMatchObject({ phase: 'showdown', clockPaused: false, elapsedMs: 300_000 });
    expect(room.game.players).toEqual(before.players); expect(room.game.pots).toEqual(before.pots);
    award();
    expect(room.game.phase).toBe('tournament-over'); expect(room.game.clockPaused).toBe(true);
    expect(standings(room.game).map(({ place }) => place)).toEqual([1, 1, 3]); assertChips(room.game);
  });

  it('rejects lobby stack adjustments without changing state or trapping seat changes', () => {
    const { room, board, phones } = table();
    const before = structuredClone(room.game), undoCount = room.undoStack.length;
    room.handle(board.ws, { type: 'hostAdjust', playerId: phones[0].state().you.id, delta: 100, revision: room.game.revision });
    expect(board.error()?.message).toMatch(/between hands/i);
    expect(room.game).toEqual(before); expect(room.undoStack).toHaveLength(undoCount);
    room.handle(phones[0].ws, { type: 'claimSeat', seat: 7, name: 'Alice' });
    expect(room.game.players.find(p => p.id === phones[0].state().you.id)?.seat).toBe(7);
    room.handle(phones[0].ws, { type: 'leaveSeat' });
    expect(room.game.players).toHaveLength(2); assertChips(room.game);
  });

  it.each([false, true])('restores the pre-win clock pause state (%s) when undoing a tournament-winning award', paused => {
    const { room, board, phones } = table(); start(room, board);
    if (paused) room.handle(board.ws, { type: 'pauseClock', revision: room.game.revision });
    act(room, phones, { type: 'all-in' }); act(room, phones, { type: 'call' }); act(room, phones, { type: 'call' });
    for (let i = 0; i < 3; i++) dealer(room, board, 'dealerConfirm');
    expect(room.game.phase).toBe('showdown'); expect(room.game.clockPaused).toBe(paused);
    const before = structuredClone(room.game);
    room.handle(board.ws, { type: 'awardPot', potIndex: 0, winnerIds: [phones[0].state().you.id], revision: room.game.revision });
    expect(room.game.phase).toBe('tournament-over'); expect(room.game.clockPaused).toBe(true);
    dealer(room, board, 'undo');
    expect(room.game.phase).toBe('showdown'); expect(room.game.clockPaused).toBe(paused);
    expect(room.game.players).toEqual(before.players); expect(room.game.pots).toEqual(before.pots);
    const remaining = room.game.clockRemainingMs;
    room.tick(room.game.clockUpdatedAt + 1000);
    expect(room.game.clockRemainingMs).toBe(remaining - (paused ? 0 : 1000));
    assertChips(room.game);
  });

  it('locks phone betting until the dealer confirms a street', () => {
    const { room, board, phones } = table(); start(room, board);
    act(room, phones, { type: 'call' }); act(room, phones, { type: 'call' }); act(room, phones, { type: 'check' });
    expect(room.game.phase).toBe('street-break'); expect(room.game.pendingStreet).toBe('flop');
    expect(phones.every(p => p.state().you.legal === null)).toBe(true);
    const before = structuredClone(room.game);
    room.handle(phones[0].ws, { type: 'action', action: { type: 'check' }, revision: room.game.revision });
    expect(room.game).toEqual(before);
    dealer(room, board, 'dealerConfirm'); expect(room.game.street).toBe('flop'); expect(room.game.phase).toBe('betting');
    expect(room.game.players.every(p => p.committedThisStreet === 0)).toBe(true); assertChips(room.game);
  });

  it('runs two full hands across devices and awards layered all-in pots with conserved totals', () => {
    const { room, board, phones } = table(); start(room, board);
    const stacks = () => [...room.game.players].sort((a, b) => a.seat - b.seat).map(p => p.stack);
    act(room, phones, { type: 'raise', amount: 30 }); act(room, phones, { type: 'call' }); act(room, phones, { type: 'fold' });
    expect(stacks()).toEqual([470, 470, 490]);
    for (const street of ['flop', 'turn', 'river']) {
      expect(room.game.pendingStreet).toBe(street); dealer(room, board, 'dealerConfirm');
      act(room, phones, { type: 'check' }); act(room, phones, { type: 'check' }); assertChips(room.game);
    }
    expect(room.game.phase).toBe('showdown');
    const [alice, bob, cara] = phones.map(p => p.state().you.id);
    room.handle(board.ws, { type: 'awardPot', potIndex: 0, winnerIds: [alice], revision: room.game.revision });
    expect(stacks()).toEqual([540, 470, 490]);
    dealer(room, board, 'nextHand'); expect(room.game.actorId).toBe(bob); expect(stacks()).toEqual([530, 470, 485]);
    act(room, phones, { type: 'all-in' }); act(room, phones, { type: 'all-in' }); act(room, phones, { type: 'call' });
    expect(stacks()).toEqual([50, 0, 0]);
    for (const street of ['flop', 'turn', 'river']) { expect(room.game.pendingStreet).toBe(street); dealer(room, board, 'dealerConfirm'); assertChips(room.game); }
    expect(room.game.pots.map(p => p.amount)).toEqual([1410, 40]);
    room.handle(board.ws, { type: 'awardPot', potIndex: 0, winnerIds: [bob], revision: room.game.revision });
    const before = structuredClone(room.game);
    room.handle(board.ws, { type: 'awardPot', potIndex: 1, winnerIds: [bob], revision: room.game.revision });
    expect(board.error()?.message).toMatch(/eligible/i); expect(room.game).toEqual(before);
    room.handle(board.ws, { type: 'awardPot', potIndex: 1, winnerIds: [cara], revision: room.game.revision });
    expect(stacks()).toEqual([50, 1410, 40]); expect(room.game.phase).toBe('hand-complete'); assertChips(room.game);
  });

  it('reserves a disconnected player seat and reconnects the same identity', () => {
    const { room, board, phones } = table(); start(room, board);
    const id = phones[0].state().you.id, previous = structuredClone(room.game.players[0]);
    room.disconnect(phones[0].ws); expect(room.game.players.find(p => p.id === id)?.connected).toBe(false);
    const replacement = connect(room, 1);
    expect(replacement.state().you.id).toBe(id);
    expect(room.game.players.find(p => p.id === id)).toEqual({ ...previous, connected: true });
    expect(room.game.players).toHaveLength(3);
    room.handle(replacement.ws, { type: 'leaveSeat' }); expect(replacement.error()?.message).toMatch(/reserved/i);
  });

  it('keeps a player connected while another tab with its token remains open', () => {
    const { room, phones } = table(); const duplicate = connect(room, 1), id = phones[0].state().you.id;
    room.disconnect(phones[0].ws); expect(room.game.players.find(p => p.id === id)?.connected).toBe(true);
    room.disconnect(duplicate.ws); expect(room.game.players.find(p => p.id === id)?.connected).toBe(false);
  });

  it('elects an available device if the host leaves', () => {
    const { room, board, phones } = table(); room.disconnect(board.ws);
    expect(phones[0].state().you.host).toBe(true); expect(phones[1].state().you.host).toBe(false);
  });

  it('persists a live hand atomically and restores stacks, turn, identity, and paused clock', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-room-')); directories.push(directory);
    const file = join(directory, 'state.json'), { room, board, phones } = table(file); start(room, board);
    act(room, phones, { type: 'raise', amount: 30 });
    const saved = JSON.parse(readFileSync(file, 'utf8')); expect(saved.version).toBe(2);
    const recovered = new Room('http://192.168.1.2:3000', file);
    expect(recovered.game.players.map(p => ({ ...p, connected: true }))).toEqual(room.game.players);
    expect(recovered.game.actorId).toBe(room.game.actorId); expect(recovered.game.revision).toBe(room.game.revision);
    expect(recovered.game.clockPaused).toBe(true); expect(recovered.game.players.every(p => !p.connected)).toBe(true);
    expect(connect(recovered, 1).state().you.id).toBe(phones[0].state().you.id); assertChips(recovered.game);
  });

  it('rejects version 1 saves instead of loading incomplete standings', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-room-')); directories.push(directory);
    const file = join(directory, 'state.json'), { room } = table(file);
    const legacy = JSON.parse(readFileSync(file, 'utf8'));
    delete legacy.game.eliminated; delete legacy.game.bustSequence; legacy.version = 1;
    writeFileSync(file, JSON.stringify(legacy));
    expect(() => new Room(room.joinUrl, file)).toThrow(/version/i);
  });

  it('persists the duration and elapsed play time, then freezes them on recovery', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-room-')); directories.push(directory);
    const file = join(directory, 'state.json'), { room, board, phones } = table(file);
    room.handle(board.ws, { type: 'startTournament', config: { ...DEFAULT_CONFIG, durationMinutes: 30 } });
    room.tick(room.game.clockUpdatedAt + 20_000);
    act(room, phones, { type: 'fold' });
    const recovered = new Room(room.joinUrl, file);
    expect(recovered.game.elapsedMs).toBe(20_000); expect(recovered.game.config.durationMinutes).toBe(30);
    expect(recovered.game.clockPaused).toBe(true);
    recovered.tick(recovered.game.clockUpdatedAt + 60_000);
    expect(recovered.game.elapsedMs).toBe(20_000); assertChips(recovered.game);
  });

  it('defaults time-limit fields in older version 2 saves', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-room-')); directories.push(directory);
    const file = join(directory, 'state.json'), { room, board } = table(file); start(room, board);
    const legacy = JSON.parse(readFileSync(file, 'utf8'));
    delete legacy.game.elapsedMs; delete legacy.game.config.durationMinutes;
    delete legacy.game.ledger; delete legacy.game.levelStartHand; delete legacy.game.awaitingDeal;
    delete legacy.game.config.blindPace; delete legacy.game.config.levelHands;
    writeFileSync(file, JSON.stringify(legacy));
    const recovered = new Room(room.joinUrl, file);
    expect(recovered.game.elapsedMs).toBe(0); expect(recovered.game.config.durationMinutes).toBe(0);
    expect(recovered.game).toMatchObject({ ledger: [], levelStartHand: 0, awaitingDeal: false, config: { blindPace: 'time', levelHands: 10 } });
    recovered.game.clockPaused = false; recovered.tick(recovered.game.clockUpdatedAt + 1000);
    expect(recovered.game.elapsedMs).toBe(1000); expect(Number.isFinite(recovered.game.clockRemainingMs)).toBe(true); assertChips(recovered.game);
  });

  it('resets to the lobby mid-hand, keeping every seat, name, and identity', () => {
    const { room, board, phones } = table(); start(room, board);
    act(room, phones, { type: 'call' });
    const ids = phones.map(p => p.state().you.id), revision = room.game.revision;
    room.handle(board.ws, { type: 'newGame', revision });
    expect(room.game.phase).toBe('lobby'); expect(room.game.revision).toBe(revision + 1);
    const seated = [...room.game.players].sort((a, b) => a.seat - b.seat);
    expect(seated.map(p => p.id)).toEqual(expect.arrayContaining(ids));
    expect(seated.every(p => p.stack === 0 && p.status === 'active')).toBe(true);
    expect(room.game).toMatchObject({ totalChips: 0, hand: 0, actorId: null, pots: [], eliminated: [], level: 1, pendingLevel: 1, elapsedMs: 0, clockPaused: true });
    expect(phones.map(p => p.state().you.id)).toEqual(ids);
    expect(room.game.log.at(-1)?.text).toMatch(/new game/i);
    const logIds = room.game.log.map(entry => entry.id);
    expect(new Set(logIds).size).toBe(logIds.length);
    assertChips(room.game);
  });

  it('clears busted players and eliminated seats on a new game', () => {
    const { room, board, phones } = table(); start(room, board);
    act(room, phones, { type: 'fold' }); act(room, phones, { type: 'fold' });
    const player = room.game.players[0];
    room.handle(board.ws, { type: 'hostAdjust', playerId: player.id, delta: -player.stack, revision: room.game.revision });
    const fresh = socket(); room.handle(fresh.ws, { type: 'join', token: 'late_buyin_device_00001' });
    room.handle(fresh.ws, { type: 'lateBuyIn', name: 'Dan', seat: player.seat });
    expect(room.game.eliminated).toHaveLength(1);
    room.handle(board.ws, { type: 'newGame', revision: room.game.revision });
    expect(room.game.eliminated).toEqual([]); expect(room.game.bustSequence).toBe(0);
    expect(room.game.players.every(p => p.bustOrder === undefined)).toBe(true);
    assertChips(room.game);
  });

  it('restricts a new game to dealers and rejects stale revisions', () => {
    const { room, board, phones } = table(); start(room, board);
    const before = structuredClone(room.game);
    room.handle(phones[0].ws, { type: 'newGame', revision: room.game.revision });
    expect(phones[0].error()?.message).toMatch(/board admin/i); expect(room.game).toEqual(before);
    room.handle(board.ws, { type: 'newGame', revision: room.game.revision - 1 });
    expect(board.error()?.message).toMatch(/table changed/i); expect(room.game).toEqual(before);
  });

  it('rejects a new game already in the lobby', () => {
    const { room, board } = table();
    const before = structuredClone(room.game), undoCount = room.undoStack.length;
    room.handle(board.ws, { type: 'newGame', revision: room.game.revision });
    expect(board.error()?.message).toMatch(/already in the lobby/i);
    expect(room.game).toEqual(before); expect(room.undoStack).toHaveLength(undoCount);
  });

  it('undoes a new game, restoring play time and a paused clock', () => {
    const { room, board, phones } = table(); start(room, board);
    act(room, phones, { type: 'call' });
    room.tick(room.game.clockUpdatedAt + 20_000);
    room.handle(board.ws, { type: 'adjustLevel', delta: 1, revision: room.game.revision });
    const before = structuredClone(room.game);
    room.handle(board.ws, { type: 'newGame', revision: room.game.revision });
    expect(room.game.elapsedMs).toBe(0); expect(room.game.pendingLevel).toBe(1);
    dealer(room, board, 'undo');
    expect(room.game).toMatchObject({ phase: before.phase, elapsedMs: before.elapsedMs, clockRemainingMs: before.clockRemainingMs, pendingLevel: before.pendingLevel, clockPaused: true });
    expect(room.game.players).toEqual(before.players); expect(room.game.actorId).toBe(before.actorId);
    expect(room.game.totalChips).toBe(before.totalChips);
    const logIds = room.game.log.map(entry => entry.id);
    expect(new Set(logIds).size).toBe(logIds.length);
    room.tick(room.game.clockUpdatedAt + 5000);
    expect(room.game.elapsedMs).toBe(before.elapsedMs);
    assertChips(room.game);
  });

  it('starts a fresh tournament after a new game', () => {
    const { room, board } = table(); start(room, board);
    const identities = structuredClone(room.identities), hostToken = room.hostToken;
    room.handle(board.ws, { type: 'newGame', revision: room.game.revision });
    start(room, board);
    expect(room.game.hand).toBe(1); expect(room.game.totalChips).toBe(1500);
    expect(room.identities).toEqual(identities); expect(room.hostToken).toBe(hostToken);
    assertChips(room.game);
  });

  it('persists a new game and restores its seats on recovery', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-room-')); directories.push(directory);
    const file = join(directory, 'state.json'), { room, board, phones } = table(file); start(room, board);
    const ids = phones.map(p => p.state().you.id);
    room.handle(board.ws, { type: 'newGame', revision: room.game.revision });
    const recovered = new Room(room.joinUrl, file);
    expect(recovered.game.phase).toBe('lobby'); expect(recovered.game.totalChips).toBe(0);
    const seated = [...recovered.game.players].sort((a, b) => a.seat - b.seat).map(p => p.id);
    expect(seated).toEqual(expect.arrayContaining(ids));
    assertChips(recovered.game);
  });

  it('refuses an unsupported or invalid recovery snapshot', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-room-')); directories.push(directory); const file = join(directory, 'state.json');
    writeFileSync(file, JSON.stringify({ version: 99 })); expect(() => new Room('http://localhost:3000', file)).toThrow(/version/i);
    const { room } = table(); room.game.totalChips = -1;
    writeFileSync(file, JSON.stringify({ version: 2, game: room.game, identities: room.identities, hostToken: room.hostToken }));
    expect(() => new Room('http://localhost:3000', file)).toThrow(/accounting/i);
  });
});


describe('board-only administration and total time', () => {
  it('rejects every admin intent from the first phone and after board disconnects', () => {
    const room = new Room('http://localhost:3000', null), phone = connect(room, 1);
    const board = connect(room, 0, true);
    const check = () => {
      expect(phone.state().you).toMatchObject({ host: true, admin: false });
      expect(phone.state().canUndo).toBe(false);
      const before = structuredClone(room.game);
      for (const type of ['startTournament', 'setJoinUrl', 'undo', 'pauseClock', 'adjustDuration', 'adjustLevel', 'dealerConfirm', 'awardPot', 'hostAdjust', 'colorUp', 'moveSeat', 'nextHand', 'newGame', 'removePlayer']) {
        room.handle(phone.ws, { type, delta: 15, revision: room.game.revision });
        expect(phone.error()?.message).toMatch(/board admin/i);
        expect(room.game).toEqual(before);
      }
    };
    check(); room.disconnect(board.ws); check();
  });

  it('isolates board and player connections sharing a saved device token', () => {
    const { room, board } = table(); start(room, board);
    const playerTab = connect(room, 0);
    expect(playerTab.state().you.admin).toBe(false);
    room.handle(playerTab.ws, { type: 'undo', revision: room.game.revision });
    expect(playerTab.error()?.message).toMatch(/board admin/i);
    expect(board.state().you.admin).toBe(true);
  });

  it('changes total time in 15-minute steps, preserves paused clocks and survives hand undo', () => {
    const { room, board, phones } = table();
    room.handle(board.ws, { type: 'startTournament', config: { ...DEFAULT_CONFIG, durationMinutes: 60 } });
    room.handle(board.ws, { type: 'pauseClock', revision: room.game.revision });
    act(room, phones, { type: 'fold' });
    const before = structuredClone(room.game), history = room.undoStack.length;
    const change = (delta: number) => room.handle(board.ws, { type: 'adjustDuration', delta, revision: room.game.revision });
    change(15); expect(room.game.config.durationMinutes).toBe(75);
    change(-15); expect(room.game.config.durationMinutes).toBe(60);
    change(-15); expect(room.game.config.durationMinutes).toBe(45);
    expect(room.game.elapsedMs).toBe(before.elapsedMs);
    expect(room.game.clockRemainingMs).toBe(before.clockRemainingMs);
    expect(room.undoStack).toHaveLength(history);
    dealer(room, board, 'undo');
    expect(room.game.config.durationMinutes).toBe(45);
    expect(room.game.players.every(p => p.status !== 'folded')).toBe(true);
    const current = structuredClone(room.game);
    room.handle(board.ws, { type: 'adjustDuration', delta: 15, revision: before.revision });
    expect(board.error()?.message).toMatch(/table changed/i); expect(room.game).toEqual(current);
  });
});

describe('dealer seat removal', () => {
  it('frees a lobby seat and restores device ownership on undo', () => {
    const { room, board, phones } = table();
    const player = structuredClone(room.game.players[0]);
    room.handle(board.ws, { type: 'removePlayer', playerId: player.id, revision: room.game.revision });
    expect(room.game.players.some(p => p.id === player.id)).toBe(false);
    expect(phones[0].state().you.id).not.toBe(player.id);
    expect(board.state().canUndo).toBe(true);
    dealer(room, board, 'undo');
    expect(room.game.players[0]).toEqual(player);
    expect(phones[0].state().you.id).toBe(player.id);
    assertChips(room.game);
  });

  it.each(['claimSeat', 'lateBuyIn', 'leaveSeat', 'moveSeat', 'reclaimSeat'] as const)('invalidates removal undo after lobby %s without reverting seating', type => {
    const { room, board, phones } = table();
    const removedId = phones[0].state().you.id;
    room.handle(board.ws, { type: 'removePlayer', playerId: removedId, revision: room.game.revision });
    expect(board.state().canUndo).toBe(true);
    if (type === 'claimSeat' || type === 'lateBuyIn') {
      room.handle(phones[0].ws, { type, seat: 3, name: 'New player' });
    } else if (type === 'leaveSeat') {
      room.handle(phones[1].ws, { type });
    } else if (type === 'moveSeat') {
      room.handle(board.ws, { type, playerId: phones[1].state().you.id, seat: 3, revision: room.game.revision });
    } else {
      const playerId = phones[1].state().you.id;
      room.disconnect(phones[1].ws);
      room.handle(phones[0].ws, { type, playerId });
    }
    const after = structuredClone(room.game), identities = structuredClone(room.identities);
    expect(room.game.players.some(p => p.id === removedId)).toBe(false);
    expect(board.state().canUndo).toBe(false);
    dealer(room, board, 'undo');
    expect(board.error()?.message).toBe('Nothing to undo.');
    expect(room.game).toEqual(after); expect(room.identities).toEqual(identities);
    assertChips(room.game);
  });

  it('keeps removal undo available after a rejected lobby seat claim', () => {
    const { room, board, phones } = table();
    const removedId = phones[0].state().you.id;
    room.handle(board.ws, { type: 'removePlayer', playerId: removedId, revision: room.game.revision });
    room.handle(phones[0].ws, { type: 'claimSeat', seat: 1, name: 'New player' });
    expect(phones[0].error()?.message).toMatch(/seat was just taken/);
    expect(board.state().canUndo).toBe(true);
    dealer(room, board, 'undo');
    expect(phones[0].state().you.id).toBe(removedId);
    expect(room.game.players).toHaveLength(3);
  });

  it('preserves finished standings until a new game reopens seat management', () => {
    const { room, board, phones } = table(); start(room, board);
    act(room, phones, { type: 'fold' }); act(room, phones, { type: 'fold' });
    for (const player of room.game.players.slice(1)) {
      room.handle(board.ws, { type: 'hostAdjust', playerId: player.id, delta: -player.stack, revision: room.game.revision });
    }
    expect(room.game.phase).toBe('tournament-over');
    const before = structuredClone(room.game), ranks = standings(room.game), identities = structuredClone(room.identities), undo = structuredClone(room.undoStack);
    for (const player of room.game.players) {
      room.handle(board.ws, { type: 'removePlayer', playerId: player.id, revision: room.game.revision });
      expect(board.error()?.message).toMatch(/Start a new game/);
      expect(room.game).toEqual(before); expect(standings(room.game)).toEqual(ranks);
      expect(room.identities).toEqual(identities); expect(room.undoStack).toEqual(undo);
    }
    room.handle(board.ws, { type: 'newGame', revision: room.game.revision });
    room.handle(board.ws, { type: 'removePlayer', playerId: before.players[0].id, revision: room.game.revision });
    expect(room.game.phase).toBe('lobby'); expect(room.game.players).toHaveLength(2);
    assertChips(room.game);
  });

  it('rejects non-dealers, stale requests, unknown players, and removal during a hand', () => {
    const { room, board, phones } = table();
    const playerId = room.game.players[0].id;
    const before = structuredClone(room.game);
    room.handle(phones[1].ws, { type: 'removePlayer', playerId, revision: room.game.revision });
    expect(phones[1].error()?.message).toMatch(/board admin/);
    room.handle(board.ws, { type: 'removePlayer', playerId, revision: -1 });
    expect(board.error()?.message).toMatch(/table changed/);
    room.handle(board.ws, { type: 'removePlayer', playerId: 'unknown', revision: room.game.revision });
    expect(board.error()?.message).toMatch(/not seated/);
    expect(room.game).toEqual(before);
    start(room, board);
    const live = structuredClone(room.game);
    room.handle(board.ws, { type: 'removePlayer', playerId, revision: room.game.revision });
    expect(board.error()?.message).toMatch(/between hands/);
    expect(room.game).toEqual(live);
  });

  it('withdraws chips between hands, ends with one survivor, and undoes both changes', () => {
    const { room, board, phones } = table(); start(room, board);
    act(room, phones, { type: 'fold' }); act(room, phones, { type: 'fold' });
    const before = structuredClone(room.game), removed = before.players[0];
    room.handle(board.ws, { type: 'removePlayer', playerId: removed.id, revision: room.game.revision });
    expect(room.game.phase).toBe('hand-complete');
    expect(room.game.totalChips).toBe(before.totalChips - removed.stack); assertChips(room.game);
    room.handle(board.ws, { type: 'removePlayer', playerId: room.game.players[0].id, revision: room.game.revision });
    expect(room.game.phase).toBe('tournament-over'); expect(room.game.clockPaused).toBe(true); assertChips(room.game);
    dealer(room, board, 'undo'); dealer(room, board, 'undo');
    expect(room.game.players).toEqual(before.players); expect(room.game.totalChips).toBe(before.totalChips);
    expect(phones[0].state().you.id).toBe(removed.id); assertChips(room.game);
  });
});

describe('button dealer and hand accounting', () => {
  it('locks the hole-card deal, preserves posted blinds on confirmation, and passes dealing to the next button', () => {
    const { room, board, phones } = table();
    room.handle(board.ws, { type: 'startTournament', config: DEFAULT_CONFIG });
    expect(room.game.awaitingDeal).toBe(true);
    expect(board.state().you).toMatchObject({ admin: true, dealing: false, legal: null });
    expect(phones.map(p => p.state().you.dealing)).toEqual([true, false, false]);
    expect(phones.every(p => p.state().you.legal === null)).toBe(true);
    const before = structuredClone(room.game);
    room.handle(phones[0].ws, { type: 'action', action: { type: 'call' }, revision: room.game.revision });
    expect(phones[0].error()?.message).toMatch(/not your turn/); expect(room.game).toEqual(before);
    for (const type of ['dealerConfirm', 'awardPot', 'nextHand']) {
      room.handle(phones[1].ws, { type, potIndex: 0, winnerIds: [phones[1].state().you.id], revision: room.game.revision });
      expect(phones[1].error()?.message).toMatch(/board admin/); expect(room.game).toEqual(before);
    }
    room.handle(phones[0].ws, { type: 'dealerConfirm', revision: room.game.revision - 1 });
    expect(phones[0].error()?.message).toMatch(/table changed/); expect(room.game).toEqual(before);
    dealer(room, phones[0], 'dealerConfirm');
    expect(room.game.awaitingDeal).toBe(false); expect(room.game.players).toEqual(before.players);
    expect(phones[0].state().you.legal).not.toBeNull(); assertChips(room.game);
    dealer(room, board, 'undo'); expect(room.game.awaitingDeal).toBe(true);
    dealer(room, phones[0], 'dealerConfirm'); act(room, phones, { type: 'fold' }); act(room, phones, { type: 'fold' });
    dealer(room, phones[0], 'nextHand');
    expect(room.game).toMatchObject({ hand: 2, awaitingDeal: true });
    expect(phones.map(p => p.state().you.dealing)).toEqual([false, true, false]);
    dealer(room, phones[0], 'dealerConfirm'); expect(room.game.awaitingDeal).toBe(true);
    dealer(room, phones[1], 'dealerConfirm'); expect(room.game.awaitingDeal).toBe(false); assertChips(room.game);
  });

  it('lets the acting dealer confirm streets and award pots without gaining admin permissions', () => {
    const { room, board, phones } = table(); start(room, board);
    act(room, phones, { type: 'call' }); act(room, phones, { type: 'call' }); act(room, phones, { type: 'check' });
    for (let street = 0; street < 3; street++) { dealer(room, phones[0], 'dealerConfirm'); for (let p = 0; p < 3; p++) act(room, phones, { type: 'check' }); }
    expect(room.game.phase).toBe('showdown');
    const before = structuredClone(room.game);
    room.handle(phones[0].ws, { type: 'hostAdjust', playerId: phones[0].state().you.id, delta: 5, revision: room.game.revision });
    expect(phones[0].error()?.message).toMatch(/board admin/); expect(room.game).toEqual(before);
    room.handle(phones[0].ws, { type: 'awardPot', potIndex: 0, winnerIds: [phones[1].state().you.id], revision: room.game.revision });
    expect(room.game.phase).toBe('hand-complete');
    expect(room.game.ledger.filter(e => e.kind === 'hand').map(e => e.amount)).toEqual([-10, 20, -10]); assertChips(room.game);
  });

  it('hands the deal back to the board when the button phone disconnects and returns it on reconnect', () => {
    const { room, board, phones } = table();
    expect(board.state().you.dealing).toBe(true);
    room.handle(board.ws, { type: 'startTournament', config: DEFAULT_CONFIG });
    expect(board.state().you.dealing).toBe(false);
    room.disconnect(phones[0].ws); expect(board.state().you.dealing).toBe(true);
    dealer(room, board, 'dealerConfirm'); expect(room.game.awaitingDeal).toBe(false);
    const returned = connect(room, 1);
    expect(returned.state().you.dealing).toBe(true); expect(board.state().you.dealing).toBe(false);
    dealer(room, board, 'undo');
    dealer(room, board, 'dealerConfirm'); expect(room.game.awaitingDeal).toBe(false); assertChips(room.game);
  });

  it('requires a separate hole-card confirmation when the blinds put everyone all-in', () => {
    const { room, board, phones } = table();
    room.handle(board.ws, { type: 'startTournament', config: { ...DEFAULT_CONFIG, startingStack: 5, anteMode: 'per-player', ante: 5 } });
    expect(room.game).toMatchObject({ phase: 'street-break', pendingStreet: 'flop', awaitingDeal: true });
    const players = structuredClone(room.game.players);
    dealer(room, phones[0], 'dealerConfirm');
    expect(room.game).toMatchObject({ phase: 'street-break', street: 'preflop', pendingStreet: 'flop', awaitingDeal: false });
    expect(room.game.players).toEqual(players);
    dealer(room, phones[0], 'dealerConfirm'); expect(room.game.street).toBe('flop'); assertChips(room.game);
  });

  it('records investments, adjustments, and withdrawals and reverts ledger entries with undo and reset', () => {
    const { room, board, phones } = table(); start(room, board);
    expect(room.game.ledger.map(e => [e.name, e.kind, e.amount, e.hand])).toEqual(['Alice', 'Bob', 'Cara'].map(name => [name, 'buy-in', 500, 0]));
    act(room, phones, { type: 'fold' }); act(room, phones, { type: 'fold' });
    const alice = room.game.players[0];
    room.handle(board.ws, { type: 'hostAdjust', playerId: alice.id, delta: -alice.stack, revision: room.game.revision });
    expect(room.game.ledger.at(-1)).toMatchObject({ playerId: alice.id, kind: 'adjust', amount: -500 });
    const before = structuredClone(room.game.ledger);
    room.handle(phones[0].ws, { type: 'rebuy' });
    expect(room.game.ledger.at(-1)).toMatchObject({ playerId: alice.id, kind: 'buy-back', amount: 500 });
    dealer(room, board, 'undo'); expect(room.game.ledger).toEqual(before);
    const fresh = socket(); room.handle(fresh.ws, { type: 'join', token: 'late_ledger_device_00001' });
    room.handle(fresh.ws, { type: 'lateBuyIn', name: 'Dan', seat: 0 });
    expect(room.game.ledger.at(-1)).toMatchObject({ name: 'Dan', kind: 'buy-in', amount: 500 });
    expect(room.game.ledger[0].name).toBe('Alice');
    const dan = room.game.players.find(p => p.name === 'Dan')!;
    room.handle(board.ws, { type: 'removePlayer', playerId: dan.id, revision: room.game.revision });
    expect(room.game.ledger.at(-1)).toMatchObject({ playerId: dan.id, name: 'Dan', kind: 'adjust', amount: -500 });
    room.handle(board.ws, { type: 'newGame', revision: room.game.revision });
    expect(room.game).toMatchObject({ ledger: [], awaitingDeal: false, levelStartHand: 0 }); assertChips(room.game);
  });

  it('undoes automatic hand-based level queues at the boundary while retaining manual blind changes', () => {
    const { room, board, phones } = table();
    room.handle(board.ws, { type: 'startTournament', config: { ...DEFAULT_CONFIG, blindPace: 'hands', levelHands: 10 } });
    while (room.game.hand < 9) { act(room, phones, { type: 'fold' }); act(room, phones, { type: 'fold' }); dealer(room, board, 'nextHand'); }
    act(room, phones, { type: 'fold' }); act(room, phones, { type: 'fold' });
    dealer(room, board, 'nextHand'); expect(room.game).toMatchObject({ hand: 10, level: 1, pendingLevel: 2, levelStartHand: 10 });
    dealer(room, board, 'undo'); expect(room.game).toMatchObject({ hand: 9, pendingLevel: 1, levelStartHand: 0 });
    dealer(room, board, 'nextHand'); act(room, phones, { type: 'fold' }); act(room, phones, { type: 'fold' });
    dealer(room, board, 'nextHand'); expect(room.game).toMatchObject({ hand: 11, level: 2, pendingLevel: 2 });
    dealer(room, board, 'undo'); expect(room.game).toMatchObject({ hand: 10, level: 1, pendingLevel: 2, levelStartHand: 10 });
    dealer(room, board, 'nextHand'); dealer(room, board, 'dealerConfirm'); act(room, phones, { type: 'fold' });
    room.handle(board.ws, { type: 'adjustLevel', delta: 1, revision: room.game.revision });
    dealer(room, board, 'undo'); expect(room.game).toMatchObject({ hand: 11, level: 2, pendingLevel: 3, levelStartHand: 11 }); assertChips(room.game);
  });

  it('recovers the ledger, hand counter, queued level, and undealt hand from a current save', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-room-')); directories.push(directory);
    const file = join(directory, 'state.json'), { room, board, phones } = table(file);
    room.handle(board.ws, { type: 'startTournament', config: { ...DEFAULT_CONFIG, blindPace: 'hands', levelHands: 3 } });
    for (let hand = 1; hand < 3; hand++) { act(room, phones, { type: 'fold' }); act(room, phones, { type: 'fold' }); dealer(room, board, 'nextHand'); }
    const recovered = new Room(room.joinUrl, file);
    expect(recovered.game).toMatchObject({ hand: 3, level: 1, pendingLevel: 2, levelStartHand: 3, awaitingDeal: true, config: { blindPace: 'hands', levelHands: 3 } });
    expect(recovered.game.ledger).toEqual(room.game.ledger);
    const recoveredBoard = connect(recovered, 0, true);
    expect(recoveredBoard.state().you.dealing).toBe(true);
    dealer(recovered, recoveredBoard, 'dealerConfirm'); expect(recovered.game.awaitingDeal).toBe(false); assertChips(recovered.game);
  });
});
