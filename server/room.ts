import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import type { ClientMsg, GameState, ServerMsg } from '../shared/types';
import { createGame, createPlayer, startHand, startTournament } from './engine/state';
import { applyAction, legalActions } from './engine/betting';
import { advanceStreet } from './engine/streets';
import { awardPots } from './engine/pots';
import { adjustStack, colorUp, tickClock } from './engine/tournament';
import { assertChips, log } from './engine/helpers';
interface Identity { id: string; name: string; board?: boolean }
interface Peer { token: string; board: boolean }
export class Room {
  game = createGame(undefined, Date.now());
  identities: Record<string, Identity> = {};
  hostToken = '';
  peers = new Map<WebSocket, Peer>();
  undoStack: GameState[] = [];
  constructor(public joinUrl: string, public file: string | null = '.state.json') {
    if (file && existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      if (saved.version !== 1) throw new Error('Unsupported save file version. Preserve the file before resetting.');
      this.game = saved.game; this.identities = saved.identities; this.hostToken = saved.hostToken;
      assertChips(this.game); this.game.players.forEach(p => p.connected = false);
      this.game.clockPaused = true; this.game.clockUpdatedAt = Date.now(); log(this.game, 'Game recovered. Clock paused — resume when the table is ready.');
    }
  }
  persist() {
    if (!this.file) return;
    writeFileSync(this.file + '.tmp', JSON.stringify({ version: 1, game: this.game, identities: this.identities, hostToken: this.hostToken }), { mode: 0o600 });
    renameSync(this.file + '.tmp', this.file);
  }
  send(ws: WebSocket, msg: ServerMsg) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }
  refreshConnections() { for (const p of this.game.players) p.connected = [...this.peers.values()].some(peer => this.identities[peer.token]?.id === p.id); }
  broadcast() {
    this.refreshConnections();
    for (const [ws, peer] of this.peers) {
      const identity = this.identities[peer.token];
      this.send(ws, { type: 'state', snapshot: { game: this.game, you: { id: identity.id, host: peer.token === this.hostToken, dealer: peer.board || peer.token === this.hostToken, legal: legalActions(this.game, identity.id) }, joinUrl: this.joinUrl, canUndo: this.undoStack.length > 0, serverTime: Date.now() } });
    }
  }
  disconnect(ws: WebSocket) {
    this.peers.delete(ws);
    if (![...this.peers.values()].some(p => p.token === this.hostToken) && this.peers.size) this.hostToken = this.peers.values().next().value!.token;
    this.broadcast(); this.safePersist();
  }
  safePersist() { try { this.persist(); } catch (error) { console.error('Snapshot could not be saved:', error); for (const ws of this.peers.keys()) this.send(ws, { type: 'error', message: 'Snapshot could not be saved. Keep the server running and check disk access.' }); } }
  tick(now: number) { this.game = tickClock(this.game, now); this.broadcast(); }
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
      if (!['claimSeat', 'leaveSeat', 'action'].includes(msg.type) && !dealer) throw new Error('Only the host or table board can do that.');
      const needsRevision = ['action', 'dealerConfirm', 'nextHand', 'undo', 'pauseClock', 'awardPot', 'hostAdjust', 'colorUp'].includes(msg.type);
      if (needsRevision && (!('revision' in msg) || !Number.isInteger(msg.revision) || msg.revision !== this.game.revision)) throw new Error('The table changed. Review the latest state and try again.');
      let next: GameState;
      if (msg.type === 'claimSeat') {
        if (this.game.phase !== 'lobby') throw new Error('Seats are locked once the tournament starts.');
        if (!Number.isInteger(msg.seat) || msg.seat < 0 || msg.seat > 7 || typeof msg.name !== 'string' || !msg.name.trim() || msg.name.trim().length > 24) throw new Error('Choose a seat and a name of 1–24 characters.');
        if (this.game.players.some(p => p.seat === msg.seat && p.id !== id)) throw new Error('That seat was just taken. Choose another.');
        next = structuredClone(this.game); next.players = next.players.filter(p => p.id !== id); next.players.push(createPlayer(id, msg.name.trim(), msg.seat)); this.identities[peer.token].name = msg.name.trim();
      } else if (msg.type === 'leaveSeat') {
        if (this.game.phase !== 'lobby') throw new Error('Seats stay reserved during a tournament.');
        next = structuredClone(this.game); next.players = next.players.filter(p => p.id !== id);
      } else if (msg.type === 'startTournament') next = startTournament(this.game, msg.config, Date.now());
      else if (msg.type === 'action') { if (!msg.action || typeof msg.action !== 'object') throw new Error('Invalid action.'); next = applyAction(this.game, id, msg.action); }
      else if (msg.type === 'dealerConfirm') next = advanceStreet(this.game);
      else if (msg.type === 'awardPot') next = awardPots(this.game, msg.potIndex, msg.winnerIds);
      else if (msg.type === 'nextHand') next = startHand(this.game);
      else if (msg.type === 'hostAdjust') next = adjustStack(this.game, msg.playerId, msg.delta);
      else if (msg.type === 'colorUp') next = colorUp(this.game);
      else if (msg.type === 'pauseClock') { next = tickClock(this.game, Date.now()); next.clockPaused = !next.clockPaused; log(next, next.clockPaused ? 'Clock paused.' : 'Clock resumed.'); }
      else if (msg.type === 'undo') {
        const previous = this.undoStack.at(-1); if (!previous) throw new Error('Nothing to undo.');
        next = structuredClone(previous); next.clockRemainingMs = this.game.clockRemainingMs; next.clockUpdatedAt = Date.now(); next.pendingLevel = Math.max(next.pendingLevel, this.game.pendingLevel); next.clockPaused = this.game.phase === 'tournament-over' && next.phase !== 'tournament-over' ? previous.clockPaused : this.game.clockPaused;
        next.logSequence = this.game.logSequence; log(next, 'Host undid the last change.');
      } else throw new Error('Unknown message.');
      assertChips(next);
      if (msg.type === 'undo') this.undoStack.pop();
      else if (msg.type !== 'pauseClock' && msg.type !== 'claimSeat' && msg.type !== 'leaveSeat') { this.undoStack.push(structuredClone(this.game)); this.undoStack = this.undoStack.slice(-100); }
      next.revision = this.game.revision + 1; this.game = next; this.refreshConnections(); this.safePersist(); this.broadcast();
    } catch (error) { this.send(ws, { type: 'error', message: error instanceof Error ? error.message : 'The action was rejected.' }); }
  }
}
