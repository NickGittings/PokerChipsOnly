# Architecture

Contributor-facing detail that `README.md` (an operator manual) doesn't cover. Start with `CLAUDE.md` for the three-line summary.

## Processes

```
┌─────────────┐   HTTP (static dist/, GET /api/health)   ┌──────────────┐
│   Browser    │ ────────────────────────────────────────▶│  server/     │
│  or phone /  │                                           │  index.ts    │
│  native app  │◀──────────── WebSocket /ws ──────────────▶│  (Express +  │
└─────────────┘        ClientMsg ↑ / ServerMsg ↓           │   ws, :3000) │
      (n devices, star topology — no peer-to-peer)         └──────┬───────┘
                                                                    │ owns
                                                             ┌──────▼───────┐
                                                             │ Room (room.ts)│
                                                             │  = one GameState
                                                             │  + identities
                                                             │  + undo stack
                                                             └──────┬───────┘
                                                                    │ persists
                                                             ┌──────▼───────┐
                                                             │ .state.json  │
                                                             └──────────────┘
```

`Room` (`server/room.ts`) is a **singleton bound to one save file** — today's app is single-table. `server/engine/` holds the pure state transitions (`state.ts`, `betting.ts`, `streets.ts`, `pots.ts`, `tournament.ts`, `helpers.ts`); `Room` is the only caller, and the only place permissions, persistence, and the undo stack live.

## The protocol (`shared/types.ts`)

Every message is a discriminated union on `type`:

- **`ClientMsg`** — `join`, seat lifecycle (`claimSeat`, `leaveSeat`, `reclaimSeat`, `lateBuyIn`, `rebuy`), gameplay (`action`, `dealerConfirm`, `nextHand`, `awardPot`), admin (`startTournament`, `hostAdjust`, `adjustLevel`, `adjustDuration`, `colorUp`, `removePlayer`, `moveSeat`, `newGame`, `undo`, `pauseClock`, `setJoinUrl`).
- **`ServerMsg`** — almost always `{ type: 'state', snapshot: Snapshot }`; `error` and `event` exist but `state` carries everything. There are no deltas — a full `Snapshot` is rebuilt and sent to *every* connected peer on every accepted change (`Room.broadcast()`), personalized per recipient.
- **`Snapshot`** = `{ game: GameState, you: { id, host, admin, dealing, legal }, joinUrl, joinUrls, canUndo, serverTime }`. `game` is the same object for everyone; `you` is computed per-connection.

Mutating messages that touch `GameState` (see the `needsRevision` list in `room.ts`) must carry the `revision` they were computed against; a stale one is rejected rather than merged. This is the app's entire concurrency-control story, and it's why the client always re-renders from the latest `Snapshot` rather than doing optimistic local mutation.

## Device roles

There is no user table and no login. Three roles, distinguished purely by **which route a device is on**, computed in `Room.broadcast()`:

| Role | Route | How it's granted today |
|---|---|---|
| Player | `/` | Holds a seat (`GameState.players[i].id` matches the connection's identity) |
| Board | `/board` | Connects with `join.board = true` |
| Setup | `/setup` | Also connects with `board = true` — same admin rights as Board, different view (`SetupView` renders while `phase === 'lobby'`, then falls through to `BoardView`) |

```ts
// server/room.ts — Room.broadcast()
const admin = peer.board,
      dealing = !!onButton && identity.id === onButton
             || peer.board && (!onButton || !this.game.players.find(p => p.id === onButton)?.connected);
```

**Admin is a property of the connection, not a person** — anyone who opens `/board` on the LAN is admin. `hostToken` and `you.host` already exist in the snapshot (`disconnect()` reassigns `hostToken` to a remaining peer, arbitrarily) but nothing currently gates a permission on it. `docs/decisions/0001-lan-phone-host.md` and Stage 2 of `docs/native-app-plan.md` are about turning this into a real, identity-based host role — that work will tighten the security model for the web app too, not just enable native hosting.

## Dealer-prompt rotation and board fallback

The player on the button (`dealerId(game)`, `shared/dealer.ts`) is the one who physically deals — they get "deal the hole cards" / street / award-pot prompts on their own phone (`you.dealing`). If that seat is empty or its device has disconnected, `dealing` falls back to `true` for every `board` connection instead, so the table view picks up the prompt (see the `dealing` expression above). This is why a sleeping dealer's phone reconnecting mid-hand needs to reclaim `dealing`, not just reconnect the socket.

## Identity and seat reclaim

- A device's identity is a random 24-byte hex token in `localStorage` (`poker-device`, generated in `src/net/useGameSocket.ts`), sent on `join` and mapped server-side to a `randomUUID()` player id (`Room.identities`, capped at 256 devices per room).
- `reclaimSeat` lets a second device take over an existing seated player's identity (e.g. switching phones). The old device's identity is **retired**: its UUID is rotated (`retireIdentity`) so it can no longer act as that player, and the rotation is itself undoable (`RetiredIdentity` entries ride along in the undo stack).
- Multiple tabs on the same device/browser share one identity, since they share `localStorage`.
- `refreshConnections()` marks a player `connected` based on whether *any* live socket currently maps to their id — disconnected seats stay reserved and the game waits for them rather than auto-folding.

## Join URLs

`server/joinUrls.ts` enumerates the host machine's non-internal IPv4 interfaces and ranks them (`192.168.*`/`10.*` best, VPN/virtual adapters like `utun`/`docker`/`vmnet` penalized) to guess the right LAN address for the printed QR code. An admin can override the choice at runtime via `setJoinUrl`, or force one with `LAN_URL`. This logic is laptop-specific and is what Stage 3 of the native plan replaces with the LAN-server plugin's own reported addresses.

## Persistence (`.state.json`)

Written atomically (`.tmp` + `renameSync`, mode `0600`) after every accepted change plus a 5s checkpoint interval. Shape (version 2):

```ts
{ version: 2, game: GameState, identities: Record<token, {id, name}>, hostToken: string, joinUrl: string }
```

Reconnect tokens live in this file — it is effectively the credential store, which is why it's git-ignored and why the README warns never to edit it live. On load, all players are marked disconnected and the clock is force-paused (`clockPaused = true`) until a human resumes it; older saves missing newer fields (`elapsedMs`, `blindPace`, etc.) are back-filled with defaults rather than rejected, and only a save with the wrong `version` fails startup outright. `STATE_FILE=:memory:` skips persistence entirely for throwaway testing.

## Client structure

- `src/App.tsx` — the entire router (pushState-based, hand-rolled, no react-router) plus the top-level shell: connects the socket, decides which view to render from `pathname` + `Snapshot`, holds the wake-lock effect (board only), and hosts the alert portal.
- `src/net/useGameSocket.ts` — the WebSocket connection: device-token generation, exponential-backoff reconnect, a 1s watchdog that force-reconnects if no snapshot has arrived in 4s (covers a socket left open after a phone sleeps), and a `visibilitychange` listener to reconnect promptly on wake.
- `src/net/useNotifications.ts` / `useWinCelebration.ts` — derive transient UI (turn/deal/bust toasts, the win overlay) by diffing consecutive snapshots; nothing here is server state, it's reconstructed locally so a reconnect doesn't replay old notices.
- `src/views/*` — one component per role/phase: `JoinView`, `LobbyView`, `PlayerView` (seated), `BoardView`/`SetupView` (admin).
- `shared/*` — also imported directly by the client for display logic (`money`, `potShares`, `placeOf`, etc.) so formatting and pot-splitting math can't drift between server and UI.
