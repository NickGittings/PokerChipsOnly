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

- **`ClientMsg`** — `join`, seat lifecycle (`claimSeat`, `leaveSeat`, `reclaimSeat`, `lateBuyIn`, `rebuy`), gameplay (`action`, `dealerConfirm`, `nextHand`, `awardPot`), admin (`startTournament`, `hostAdjust`, `adjustLevel`, `adjustDuration`, `colorUp`, `removePlayer`, `moveSeat`, `newGame`, `undo`, `pauseClock`, `setJoinUrl`), host role (`claimHost`, `transferHost`, `setBoardAdmin`).
- **`ServerMsg`** — almost always `{ type: 'state', snapshot: Snapshot }`; `error` and `event` exist but `state` carries everything. There are no deltas — a full `Snapshot` is rebuilt and sent to *every* connected peer on every accepted change (`Room.broadcast()`), personalized per recipient.
- **`Snapshot`** = `{ game: GameState, you: { id, host, admin, dealing, legal }, hostId, boardAdmin, boardLive, hostLive, joinUrl, joinUrls, canUndo, serverTime }`. `game` is the same object for everyone; `you` is computed per-connection. `hostId` is the host device's identity id (never its token); `boardLive`/`hostLive` say whether any board page / the host device is connected.

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
const admin = this.isAdmin(peer),   // host token, or a board page while boardAdmin is on
      dealing = !!onButton && identity.id === onButton
             || buttonAway && (boardDealsFallback(this.boardAdmin, boardLive) ? peer.board : peer.token === this.hostToken);
// buttonAway: no button seat, or its player is disconnected. boardLive: any board/setup page is connected.
```

**Admin is the host device, plus board pages by default.** `Room.isAdmin` grants admin to the connection whose token is `hostToken`, and to any `/board`/`/setup` connection while the room-level `boardAdmin` flag is on (the default). Only the first *board* connection is elected host automatically. After that the role moves only deliberately: `transferHost` (the host hands it to a connected, seated player) or, only while the host is offline, `claimHost`/`transferHost` from another admin. Each change, and each `setBoardAdmin`, is written to the hand log. `reclaimSeat` deliberately does *not* move it, so a guest can't take admin by reclaiming an offline host's seat. `disconnect()` no longer reassigns the host role. The token stays reserved, so the host gets admin back on reconnect. Only the host can toggle `setBoardAdmin`, so board admin can only be switched off from a live host device. `boardAdmin` is persisted; starting the server with `BOARD_ADMIN=on` (`Room`'s `forceBoardAdmin` option) turns it back on, which is the recovery path when the host device is lost. `hostToken` and `boardAdmin` are room-level, like `joinUrl`: they're excluded from undo and don't bump `revision`. When the button player is away, dealer prompts fall back to board pages while board admin is on and a board is connected, otherwise to the host device. `boardDealsFallback`/`fallbackDealerName` in `shared/dealer.ts` hold that rule for both server and client. If the host is itself the away button player with board admin off, nobody can deal until it reconnects or the server restarts. That's the single-host trade-off accepted in `docs/decisions/0001-lan-phone-host.md`.

A player tab in the same browser as the host board shares its token, so it is the host device too and has admin. A phone host sees `HostPanel` in a collapsed **Host controls** sheet on every player route (lobby, join, and in-game).

## Dealer-prompt rotation and board fallback

The player on the button (`dealerId(game)`, `shared/dealer.ts`) is the one who physically deals — they get "deal the hole cards" / street / award-pot prompts on their own phone (`you.dealing`). If that seat is empty or its device has disconnected, `dealing` falls back to every `board` connection while board admin is on and a board is connected, otherwise to the host device (see the `dealing` expression above). This is why a sleeping dealer's phone reconnecting mid-hand needs to reclaim `dealing`, not just reconnect the socket.

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
{ version: 2, hostRole: 1, game: GameState, identities: Record<token, {id, name}>, hostToken: string, boardAdmin: boolean, joinUrl: string }   // a save without hostRole loads with hostToken cleared, so the first board is re-elected
```

Reconnect tokens live in this file — it is effectively the credential store, which is why it's git-ignored and why the README warns never to edit it live. On load, all players are marked disconnected and the clock is force-paused (`clockPaused = true`) until a human resumes it; older saves missing newer fields (`elapsedMs`, `blindPace`, etc.) are back-filled with defaults rather than rejected, and only a save with the wrong `version` fails startup outright. `STATE_FILE=:memory:` skips persistence entirely for throwaway testing.

## Client structure

- `src/App.tsx` — the entire router (pushState-based, hand-rolled, no react-router) plus the top-level shell: connects the socket, decides which view to render from `pathname` + `Snapshot`, holds the wake-lock effect (board only), and hosts the alert portal.
- `src/net/useGameSocket.ts` — the WebSocket connection: device-token generation, exponential-backoff reconnect, a 1s watchdog that force-reconnects if no snapshot has arrived in 4s (covers a socket left open after a phone sleeps), and a `visibilitychange` listener to reconnect promptly on wake.
- `src/net/useNotifications.ts` / `useWinCelebration.ts` — derive transient UI (turn/deal/bust toasts, the win overlay) by diffing consecutive snapshots; nothing here is server state, it's reconstructed locally so a reconnect doesn't replay old notices.
- `src/views/*` — one component per role/phase: `JoinView`, `LobbyView`, `PlayerView` (seated), `BoardView`/`SetupView` (admin).
- `shared/*` — also imported directly by the client for display logic (`money`, `potShares`, `placeOf`, etc.) so formatting and pot-splitting math can't drift between server and UI.
