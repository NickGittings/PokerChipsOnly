import { isMakeable } from '../shared/chips';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import type { ClientMsg, GameState, ServerMsg } from '../shared/types';
import { createGame, createPlayer, startHand, startTournament } from './engine/state';
import { applyAction, legalActions } from './engine/betting';
import { advanceStreet } from './engine/streets';
import { awardPots } from './engine/pots';
import { adjustLevel, adjustStack, colorUp, tickClock } from './engine/tournament';
import { assertChips, log } from './engine/helpers';
interface Identity { id: string; name: string; board?: boolean }
interface Peer { token: string; board: boolean }
interface RetiredIdentity { token: string; before: string; after: string }
interface UndoEntry { game: GameState; retired: RetiredIdentity[] }
export class Room {
  game = createGame(undefined, Date.now());
  identities: Record<string, Identity> = {};
  hostToken = '';
  peers = new Map<WebSocket, Peer>();
  undoStack: UndoEntry[] = [];
  joinUrls: string[];
  joinUrl: string;
  constructor(joinUrls: string | string[], public file: string | null = '.state.json') {
    this.joinUrls = Array.isArray(joinUrls) ? joinUrls : [joinUrls];
    this.joinUrl = this.joinUrls[0];
    if (file && existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      if (saved.version !== 2) throw new Error('Unsupported save file version. Preserve the file before resetting.');
      this.game = saved.game; this.identities = saved.identities; this.hostToken = saved.hostToken;
      this.game.elapsedMs ??= 0; this.game.config.durationMinutes ??= 0;
      if (this.joinUrls.includes(saved.joinUrl)) this.joinUrl = saved.joinUrl;
      assertChips(this.game); this.game.players.forEach(p => p.connected = false);
      this.game.clockPaused = true; this.game.clockUpdatedAt = Date.now(); log(this.game, 'Game recovered. Clock paused — resume when the table is ready.');
    }
  }
  retireIdentity(playerId: string, keepToken?: string): RetiredIdentity[] {
    const retired: RetiredIdentity[] = [];
    for (const [token, identity] of Object.entries(this.identities)) {
      if (token !== keepToken && identity.id === playerId) {
        const after = randomUUID();
        retired.push({ token, before: playerId, after }); identity.id = after;
      }
    }
    return retired;
  }
  persist() {
    if (!this.file) return;
    writeFileSync(this.file + '.tmp', JSON.stringify({ version: 2, game: this.game, identities: this.identities, hostToken: this.hostToken, joinUrl: this.joinUrl }), { mode: 0o600 });
    renameSync(this.file + '.tmp', this.file);
  }
  send(ws: WebSocket, msg: ServerMsg) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }
  refreshConnections() { for (const p of this.game.players) p.connected = [...this.peers.values()].some(peer => this.identities[peer.token]?.id === p.id); }
  broadcast() {
    this.refreshConnections();
    for (const [ws, peer] of this.peers) {
      const identity = this.identities[peer.token];
      const dealer = peer.board || peer.token === this.hostToken;
      this.send(ws, { type: 'state', snapshot: { game: this.game, you: { id: identity.id, host: peer.token === this.hostToken, dealer, legal: legalActions(this.game, identity.id) }, joinUrl: this.joinUrl, joinUrls: dealer ? this.joinUrls : [this.joinUrl], canUndo: this.undoStack.length > 0, serverTime: Date.now() } });
    }
  }
  disconnect(ws: WebSocket) {
    this.peers.delete(ws);
    if (![...this.peers.values()].some(p => p.token === this.hostToken) && this.peers.size) this.hostToken = this.peers.values().next().value!.token;
    this.broadcast(); this.safePersist();
  }
  safePersist() { try { this.persist(); } catch (error) { console.error('Snapshot could not be saved:', error); for (const ws of this.peers.keys()) this.send(ws, { type: 'error', message: 'Snapshot could not be saved. Keep the server running and check disk access.' }); } }
  tick(now: number) {
    const next = tickClock(this.game, now);
    if (next.phase !== this.game.phase || next.pendingLevel !== this.game.pendingLevel || next.clockPaused !== this.game.clockPaused) next.revision++;
    this.game = next; this.broadcast();
  }
  buyInStack() {
    const stack = this.game.config.startingStack;
    if (!isMakeable(stack, this.game.config.denominations)) throw new Error('The starting buy-in cannot be made with the current chip denominations.');
    if (stack <= 0 || this.game.totalChips + stack > 1_000_000) throw new Error('Buy-in must keep total chips at most 1,000,000.');
    return stack;
  }
  handle(ws: WebSocket, raw: unknown) {
    try {
      if (!raw || typeof raw !== 'object' || !('type' in raw)) throw new Error('Invalid message.');
      const msg = raw as ClientMsg;
      if (msg.type === 'join') {
        if (this.peers.has(ws)) throw new Error('Already joined.');
        if (typeof msg.token !== 'string' || !/^[a-zA-Z0-9_-]{20,100}$/.test(msg.token)) throw new Error('Invalid reconnect token.');
        if (!Object.hasOwn(this.identities, msg.token)) {
          if (Object.keys(this.identities).length >= 256) throw new Error('Room device limit reached.');
          this.identities[msg.token] = { id: randomUUID(), name: '' };
        }
        if (msg.board === true) this.identities[msg.token].board = true;
        this.peers.set(ws, { token: msg.token, board: this.identities[msg.token].board === true });
        if (!this.hostToken || ![...this.peers.values()].some(p => p.token === this.hostToken)) this.hostToken = msg.token;
        this.broadcast(); this.safePersist(); return;
      }
      const peer = this.peers.get(ws); if (!peer) throw new Error('Join the room first.');
      const id = this.identities[peer.token].id, dealer = peer.board || peer.token === this.hostToken;
      if (!['claimSeat', 'leaveSeat', 'reclaimSeat', 'lateBuyIn', 'rebuy', 'action'].includes(msg.type) && !dealer) throw new Error('Only the host or table board can do that.');
      const needsRevision = ['action', 'dealerConfirm', 'nextHand', 'undo', 'pauseClock', 'awardPot', 'hostAdjust', 'adjustLevel', 'colorUp', 'moveSeat'].includes(msg.type);
      if (needsRevision && (!('revision' in msg) || !Number.isInteger(msg.revision) || msg.revision !== this.game.revision)) throw new Error('The table changed. Review the latest state and try again.');
      if (msg.type === 'setJoinUrl') {
        if (!this.joinUrls.includes(msg.url)) throw new Error('Choose one of the available join URLs.');
        this.joinUrl = msg.url; this.broadcast(); this.safePersist(); return;
      }
      let next: GameState;
      let displacedId: string | undefined;
      if (msg.type === 'claimSeat' || msg.type === 'lateBuyIn' && this.game.phase === 'lobby') {
        if (this.game.phase !== 'lobby') throw new Error('Seats are locked once the tournament starts.');
        if (!Number.isInteger(msg.seat) || msg.seat < 0 || msg.seat > 7 || typeof msg.name !== 'string' || !msg.name.trim() || msg.name.trim().length > 24) throw new Error('Choose a seat and a name of 1–24 characters.');
        if (this.game.players.some(p => p.seat === msg.seat && p.id !== id)) throw new Error('That seat was just taken. Choose another.');
        next = structuredClone(this.game); next.players = next.players.filter(p => p.id !== id); next.players.push(createPlayer(id, msg.name.trim(), msg.seat)); this.identities[peer.token].name = msg.name.trim();
      } else if (msg.type === 'reclaimSeat') {
        if (this.game.players.some(p => p.id === id)) throw new Error('You already hold a seat. Leave your seat before switching.');
        const player = this.game.players.find(p => p.id === msg.playerId);
        if (!player) throw new Error('That player is not seated at this table.');
        if (player.connected) throw new Error('That seat is live on another device. Close that tab first, or ask the host.');
        this.retireIdentity(player.id, peer.token);
        this.identities[peer.token].id = player.id; this.identities[peer.token].name = player.name;
        next = structuredClone(this.game); log(next, `${player.name} reconnected on a new device.`);
      } else if (msg.type === 'lateBuyIn') {
        if (this.game.phase !== 'hand-complete') throw new Error('New players can buy in only in the lobby or between hands.');
        if (this.game.players.some(p => p.id === id)) throw new Error('You already hold a seat.');
        if (!Number.isInteger(msg.seat) || msg.seat < 0 || msg.seat > 7 || typeof msg.name !== 'string' || !msg.name.trim() || msg.name.trim().length > 24) throw new Error('Choose a seat and a name of 1–24 characters.');
        if (this.game.players.some(p => p.seat === msg.seat && p.status !== 'busted')) throw new Error('That seat was just taken. Choose another.');
        next = structuredClone(this.game);
        const stack = this.buyInStack();
        const replaced = next.players.find(p => p.seat === msg.seat);
        next.players = next.players.filter(p => p.seat !== msg.seat);
        if (replaced) { displacedId = replaced.id; next.eliminated.push(replaced); log(next, `${msg.name.trim()} took ${replaced.name}’s busted seat ${msg.seat + 1}.`); }
        next.players.push(createPlayer(id, msg.name.trim(), msg.seat, stack)); next.totalChips += stack;
        this.identities[peer.token].name = msg.name.trim(); log(next, `${msg.name.trim()} bought in for ${stack} chips.`);
      } else if (msg.type === 'rebuy') {
        if (this.game.phase !== 'hand-complete') throw new Error('Buy back in only between hands.');
        const player = this.game.players.find(p => p.id === id);
        if (!player) throw new Error('Take a seat before buying back in.');
        if (player.status !== 'busted') throw new Error('Only busted players can buy back in.');
        const stack = this.buyInStack();
        next = adjustStack(this.game, id, stack);
        next.log.at(-1)!.text = `${player.name} bought back in for ${stack} chips.`;
      } else if (msg.type === 'leaveSeat') {
        if (this.game.phase !== 'lobby') throw new Error('Seats stay reserved during a tournament.');
        next = structuredClone(this.game); next.players = next.players.filter(p => p.id !== id);
      } else if (msg.type === 'startTournament') next = startTournament(this.game, msg.config, Date.now());
      else if (msg.type === 'action') { if (!msg.action || typeof msg.action !== 'object') throw new Error('Invalid action.'); next = applyAction(this.game, id, msg.action); }
      else if (msg.type === 'dealerConfirm') next = advanceStreet(this.game);
      else if (msg.type === 'awardPot') next = awardPots(this.game, msg.potIndex, msg.winnerIds);
      else if (msg.type === 'nextHand') next = startHand(this.game);
      else if (msg.type === 'hostAdjust') next = adjustStack(this.game, msg.playerId, msg.delta);
      else if (msg.type === 'adjustLevel') next = adjustLevel(this.game, msg.delta);
      else if (msg.type === 'colorUp') next = colorUp(this.game);
      else if (msg.type === 'pauseClock') { next = tickClock(this.game, Date.now()); next.clockPaused = !next.clockPaused; log(next, next.clockPaused ? 'Clock paused.' : 'Clock resumed.'); }
      else if (msg.type === 'undo') {
        const previous = this.undoStack.at(-1)?.game; if (!previous) throw new Error('Nothing to undo.');
        next = structuredClone(previous); next.clockRemainingMs = this.game.clockRemainingMs; next.elapsedMs = this.game.elapsedMs; next.clockUpdatedAt = Date.now(); next.pendingLevel = this.game.pendingLevel; next.clockPaused = this.game.phase === 'tournament-over' && next.phase !== 'tournament-over' ? previous.clockPaused : this.game.clockPaused;
        next.logSequence = this.game.logSequence; log(next, 'Host undid the last change.');
      } else if (msg.type === 'moveSeat') {
        if (!['lobby', 'hand-complete'].includes(this.game.phase)) throw new Error('Seats can be moved only in the lobby or between hands.');
        if (!Number.isInteger(msg.seat) || msg.seat < 0 || msg.seat > 7) throw new Error('Choose a seat from 1–8.');
        if (!this.game.players.some(p => p.id === msg.playerId)) throw new Error('That player is not seated at this table.');
        next = structuredClone(this.game);
        const mover = next.players.find(p => p.id === msg.playerId)!;
        if (mover.seat === msg.seat) throw new Error('That player is already in that seat.');
        const occupant = next.players.find(p => p.seat === msg.seat);
        const fromSeat = mover.seat;
        if (occupant) { occupant.seat = fromSeat; mover.seat = msg.seat; log(next, `Host swapped ${mover.name} and ${occupant.name}.`); }
        else { mover.seat = msg.seat; log(next, `Host moved ${mover.name} to seat ${msg.seat + 1}.`); }
      } else throw new Error('Unknown message.');
      assertChips(next);
      const seatChurn = ['claimSeat', 'leaveSeat', 'reclaimSeat', 'moveSeat'].includes(msg.type) || msg.type === 'lateBuyIn' && this.game.phase === 'lobby';
      if (msg.type === 'undo') {
        // Reverse only takeover rotations that have not since been reclaimed elsewhere.
        for (const { token, before, after } of this.undoStack.pop()!.retired) {
          if (this.identities[token]?.id === after && !Object.values(this.identities).some(identity => identity.id === before)) this.identities[token].id = before;
        }
      } else if (msg.type !== 'pauseClock' && msg.type !== 'adjustLevel' && !seatChurn) {
        const retired = displacedId ? this.retireIdentity(displacedId) : [];
        this.undoStack.push({ game: structuredClone(this.game), retired }); this.undoStack = this.undoStack.slice(-100);
      }
      next.revision = this.game.revision + 1; this.game = next; this.refreshConnections(); this.safePersist(); this.broadcast();
    } catch (error) { this.send(ws, { type: 'error', message: error instanceof Error ? error.message : 'The action was rejected.' }); }
  }
}
