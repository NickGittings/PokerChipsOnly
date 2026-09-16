import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { Room } from './room';
import { DEFAULT_CONFIG } from '../shared/blinds';
import type { Action, ServerMsg } from '../shared/types';
import { assertChips } from './engine/helpers';

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
function start(room: Room, board: Device) { room.handle(board.ws, { type: 'startTournament', config: DEFAULT_CONFIG }); expect(room.game.phase).toBe('betting'); }
function act(room: Room, phones: Device[], action: Action) {
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
    expect(board.state().you).toMatchObject({ host: true, dealer: true, legal: null });
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
    expect(phone.error()?.message).toMatch(/host.*board/i); expect(room.joinUrl).toBe(urls[0]);
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
    const room = new Room(urls, file), host = connect(room, 0);
    room.handle(host.ws, { type: 'setJoinUrl', url: urls[1] });
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved).toMatchObject({ version: 1, joinUrl: urls[1] });
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
    expect(room.game.players[0].place).toBeUndefined(); expect(room.game.totalChips).toBe(before.totalChips + 500); assertChips(room.game);
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
    dealer(room, board, 'undo'); expect(room.game.players).toEqual(before.players); assertChips(room.game);
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

  it('rejects unjoined devices, invalid tokens, malformed messages, and ordinary-player administration', () => {
    const { room, phones } = table(); const unknown = socket();
    room.handle(unknown.ws, { type: 'claimSeat', seat: 4, name: 'Unknown' });
    expect(unknown.error()?.message).toMatch(/join/i);
    room.handle(unknown.ws, { type: 'join', token: '__proto__' });
    expect(unknown.error()?.message).toMatch(/token/i);
    room.handle(unknown.ws, null); expect(unknown.error()?.message).toMatch(/invalid/i);
    const before = structuredClone(room.game);
    room.handle(phones[0].ws, { type: 'startTournament', config: DEFAULT_CONFIG });
    expect(phones[0].error()?.message).toMatch(/host.*board/i); expect(room.game).toEqual(before);
  });

  it('grants dealer controls to a board even when another device became host', () => {
    const room = new Room('http://localhost:3000', null), host = connect(room, 1), phone = connect(room, 2), board = connect(room, 0, true);
    room.handle(host.ws, { type: 'claimSeat', seat: 0, name: 'Alice' });
    room.handle(phone.ws, { type: 'claimSeat', seat: 1, name: 'Bob' });
    expect(board.state().you).toMatchObject({ host: false, dealer: true }); start(room, board);
  });

  it('preserves board dealer permission while navigating to setup after host failover', () => {
    const { room, board, phones } = table();
    room.disconnect(board.ws); expect(phones[0].state().you.host).toBe(true);
    const setup = connect(room, 0, false);
    expect(setup.state().you).toMatchObject({ host: false, dealer: true });
    start(room, setup); expect(room.game.totalChips).toBe(1500);
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
    for (const type of ['dealerConfirm', 'nextHand', 'undo', 'pauseClock', 'awardPot', 'hostAdjust', 'colorUp']) {
      room.handle(board.ws, { type }); expect(board.error()?.message).toMatch(/table changed|revision/i); expect(room.game).toEqual(before);
    }
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
    const saved = JSON.parse(readFileSync(file, 'utf8')); expect(saved.version).toBe(1);
    const recovered = new Room('http://192.168.1.2:3000', file);
    expect(recovered.game.players.map(p => ({ ...p, connected: true }))).toEqual(room.game.players);
    expect(recovered.game.actorId).toBe(room.game.actorId); expect(recovered.game.revision).toBe(room.game.revision);
    expect(recovered.game.clockPaused).toBe(true); expect(recovered.game.players.every(p => !p.connected)).toBe(true);
    expect(connect(recovered, 1).state().you.id).toBe(phones[0].state().you.id); assertChips(recovered.game);
  });

  it('refuses an unsupported or invalid recovery snapshot', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-room-')); directories.push(directory); const file = join(directory, 'state.json');
    writeFileSync(file, JSON.stringify({ version: 99 })); expect(() => new Room('http://localhost:3000', file)).toThrow(/version/i);
    const { room } = table(); room.game.totalChips = -1;
    writeFileSync(file, JSON.stringify({ version: 1, game: room.game, identities: room.identities, hostToken: room.hostToken }));
    expect(() => new Room('http://localhost:3000', file)).toThrow(/accounting/i);
  });
});
