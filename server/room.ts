import { dealerId } from '../shared/dealer';
import { isMakeable } from '../shared/chips';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import type { ClientMsg, GameState, ServerMsg } from '../shared/types';
import { createGame, createPlayer, resetToLobby, startHand, startTournament } from './engine/state';
import { applyAction, legalActions } from './engine/betting';
import { advanceStreet } from './engine/streets';
import { awardPots } from './engine/pots';
import { adjustDuration, adjustLevel, adjustStack, colorUp, tickClock } from './engine/tournament';
import { assertChips, log, record } from './engine/helpers';
interface Identity { id: string; name: string }
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
      this.game.ledger ??= []; this.game.levelStartHand ??= 0; this.game.awaitingDeal ??= false;
      this.game.config.blindPace ??= 'time'; this.game.config.levelHands ??= 10;
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
    const onButton = dealerId(this.game);
    for (const [ws, peer] of this.peers) {
      const identity = this.identities[peer.token];
      const admin = peer.board, dealing = !!onButton && identity.id === onButton || peer.board && (!onButton || !this.game.players.find(p => p.id === onButton)?.connected);
      this.send(ws, { type: 'state', snapshot: { game: this.game, you: { id: identity.id, host: peer.token === this.hostToken, admin, dealing, legal: legalActions(this.game, identity.id) }, joinUrl: this.joinUrl, joinUrls: admin ? this.joinUrls : [this.joinUrl], canUndo: admin && this.undoStack.length > 0, serverTime: Date.now() } });
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
        this.peers.set(ws, { token: msg.token, board: msg.board === true });
        if (!this.hostToken || ![...this.peers.values()].some(p => p.token === this.hostToken)) this.hostToken = msg.token;
        this.broadcast(); this.safePersist(); return;
      }
      const peer = this.peers.get(ws); if (!peer) throw new Error('Join the room first.');
      const id = this.identities[peer.token].id, admin = peer.board, dealing = dealerId(this.game) === id;
      if (!['claimSeat', 'leaveSeat', 'reclaimSeat', 'lateBuyIn', 'rebuy', 'action'].includes(msg.type) && !admin && !(dealing && ['dealerConfirm', 'awardPot', 'nextHand'].includes(msg.type))) throw new Error('Only the table board admin can do that.');
      const needsRevision = ['action', 'dealerConfirm', 'nextHand', 'undo', 'pauseClock', 'awardPot', 'hostAdjust', 'adjustLevel', 'adjustDuration', 'colorUp', 'moveSeat', 'removePlayer', 'newGame'].includes(msg.type);
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
        const player = createPlayer(id, msg.name.trim(), msg.seat, stack); next.players.push(player); next.totalChips += stack; record(next, player, 'buy-in', stack);
        this.identities[peer.token].name = msg.name.trim(); log(next, `${msg.name.trim()} bought in for ${stack} chips.`);
      } else if (msg.type === 'rebuy') {
        if (this.game.phase !== 'hand-complete') throw new Error('Buy back in only between hands.');
        const player = this.game.players.find(p => p.id === id);
        if (!player) throw new Error('Take a seat before buying back in.');
        if (player.status !== 'busted') throw new Error('Only busted players can buy back in.');
        const stack = this.buyInStack();
        next = adjustStack(this.game, id, stack, 'buy-back');
      } else if (msg.type === 'leaveSeat') {
        if (this.game.phase !== 'lobby') throw new Error('Seats stay reserved during a tournament.');
        next = structuredClone(this.game); next.players = next.players.filter(p => p.id !== id);
      } else if (msg.type === 'startTournament') next = startTournament(this.game, msg.config, Date.now());
      else if (msg.type === 'action') { if (!msg.action || typeof msg.action !== 'object') throw new Error('Invalid action.'); next = applyAction(this.game, id, msg.action); }
      else if (msg.type === 'dealerConfirm') { if (this.game.awaitingDeal) { next = structuredClone(this.game); next.awaitingDeal = false; } else next = advanceStreet(this.game); }
      else if (msg.type === 'awardPot') next = awardPots(this.game, msg.potIndex, msg.winnerIds);
      else if (msg.type === 'nextHand') next = startHand(this.game);
      else if (msg.type === 'hostAdjust') next = adjustStack(this.game, msg.playerId, msg.delta);
      else if (msg.type === 'adjustDuration') next = adjustDuration(this.game, msg.delta, Date.now());
      else if (msg.type === 'adjustLevel') next = adjustLevel(this.game, msg.delta);
      else if (msg.type === 'colorUp') next = colorUp(this.game);
      else if (msg.type === 'newGame') next = resetToLobby(this.game, Date.now());
      else if (msg.type === 'pauseClock') { next = tickClock(this.game, Date.now()); next.clockPaused = !next.clockPaused; log(next, next.clockPaused ? 'Clock paused.' : 'Clock resumed.'); }
      else if (msg.type === 'undo') {
        const previous = this.undoStack.at(-1)?.game; if (!previous) throw new Error('Nothing to undo.');
        // Only newGame returns a live table to the lobby; restore its own clock rather than the reset one.
        const backFromLobby = this.game.phase === 'lobby' && previous.phase !== 'lobby';
        next = structuredClone(previous); next.clockUpdatedAt = Date.now();
        if (backFromLobby) next.clockPaused = true;
        else { next.config.durationMinutes = this.game.config.durationMinutes; next.clockRemainingMs = this.game.clockRemainingMs; next.elapsedMs = this.game.elapsedMs; if (this.game.config.blindPace === 'time') next.pendingLevel = this.game.pendingLevel; next.clockPaused = this.game.phase === 'tournament-over' && next.phase !== 'tournament-over' ? previous.clockPaused : this.game.clockPaused; }
        next.logSequence = this.game.logSequence; log(next, backFromLobby ? 'Host undid the new game. Clock paused — resume when the table is ready.' : 'Host undid the last change.');
      } else if (msg.type === 'removePlayer') {
        if (this.game.phase === 'tournament-over') throw new Error('Start a new game before removing players from a finished tournament.');
        if (!['lobby', 'hand-complete'].includes(this.game.phase)) throw new Error('Remove players only in the lobby or between hands.');
        const player = this.game.players.find(p => p.id === msg.playerId);
        if (!player) throw new Error('That player is not seated at this table.');
        next = structuredClone(this.game);
        next.players = next.players.filter(p => p.id !== player.id);
        next.totalChips -= player.stack;
        if (player.stack) record(next, player, 'adjust', -player.stack);
        if (player.status === 'busted') next.eliminated.push(structuredClone(player));
        displacedId = player.id;
        log(next, `Host removed ${player.name} from seat ${player.seat + 1}${player.stack ? `, taking ${player.stack} chips out of play` : ''}.`);
        if (next.phase === 'hand-complete' && next.players.filter(p => p.stack > 0).length <= 1) {
          next.phase = 'tournament-over'; next.clockPaused = true;
        }
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
      if (msg.type === 'adjustLevel' && next.config.blindPace === 'hands') {
        // Manual changes survive undo; automatic hand-boundary increments remain undoable.
        for (const entry of [...this.undoStack].reverse()) { if (entry.game.phase === 'lobby') break; entry.game.pendingLevel = Math.max(1, entry.game.pendingLevel + msg.delta); entry.game.levelStartHand = entry.game.hand; }
      }
      const seatChurn = ['claimSeat', 'leaveSeat', 'reclaimSeat', 'moveSeat'].includes(msg.type) || msg.type === 'lateBuyIn' && this.game.phase === 'lobby';
      // Lobby seating changes are not undoable. Older whole-game snapshots would
      // silently discard those changes, so they can no longer be restored.
      if (seatChurn && this.game.phase === 'lobby') this.undoStack = [];
      if (msg.type === 'undo') {
        // Reverse only takeover rotations that have not since been reclaimed elsewhere.
        for (const { token, before, after } of this.undoStack.pop()!.retired) {
          if (this.identities[token]?.id === after && !Object.values(this.identities).some(identity => identity.id === before)) this.identities[token].id = before;
        }
      } else if (msg.type !== 'pauseClock' && msg.type !== 'adjustLevel' && msg.type !== 'adjustDuration' && !seatChurn) {
        const retired = displacedId ? this.retireIdentity(displacedId) : [];
        this.undoStack.push({ game: structuredClone(this.game), retired }); this.undoStack = this.undoStack.slice(-100);
      }
      next.revision = this.game.revision + 1; this.game = next; this.refreshConnections(); this.safePersist(); this.broadcast();
    } catch (error) { this.send(ws, { type: 'error', message: error instanceof Error ? error.message : 'The action was rejected.' }); }
  }
}
