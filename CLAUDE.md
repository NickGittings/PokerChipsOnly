# PokerChips Only

A local, shared poker chip tracker for a 2–8 player home tournament played with a **real deck**. The laptop (soon: a host phone) displays the table; each player controls their own seat from a phone. **No card is ever generated, read, ranked, or evaluated by this app** — humans deal every card and declare every showdown winner. This constraint is load-bearing: do not add card logic, hand evaluation, or anything that infers what's in a hand.

`README.md` is the operator manual — how to run a game night, house rules, recovery. This file is for working on the code itself.

## Architecture, in three lines

- One authoritative Node process (`server/`) holds the only copy of game state; every device is a thin client. Devices never talk to each other directly — it's a star topology through the server.
- A single WebSocket (`/ws`) carries all traffic as JSON, typed end-to-end by `shared/types.ts`. The server pushes a **full, per-recipient personalized `Snapshot`** on every change — there are no deltas, and no other client-server API (the only HTTP route is `GET /api/health`).
- `shared/` is pure, isomorphic TypeScript (zero `node:` imports) — the poker/blinds/chip/report logic is identical on client and server. `server/engine/` (also dependency-free) is the state machine; `server/room.ts` is the only place that touches Node (`fs`, `crypto`, the `ws` socket type) or enforces permissions.

See `docs/architecture.md` for the protocol and device-role details.

## Commands

```sh
npm run dev          # server on :3000 (tsx watch) + vite client on :5173, proxied
npm start             # build + serve everything from :3000 (what game night actually runs)
npm test              # vitest — server/**/*.test.ts + shared/**/*.test.ts
npm run test:browser  # Playwright multi-device E2E (isolated server on :3301)
npm run check          # test + build
```

## Conventions

- The codebase is deliberately dense: long single-line functions, minimal whitespace, few comments. Match the existing style rather than reformatting files you touch.
- `shared/` and `server/engine/` must stay platform-free (no `node:*`, no DOM). That's what lets them run unchanged in a browser, a WebView, or a future native host — don't reintroduce a Node dependency there.

## Invariants

- `GameState.revision` gives optimistic concurrency: every mutating `ClientMsg` carries the `revision` it was computed against, and `Room.handle` rejects stale ones ("The table changed").
- `assertChips` runs after every accepted transition and enforces chip conservation — total chips in play must reconcile exactly.
- The undo stack (`server/room.ts`) holds up to 100 full `structuredClone`d `GameState` snapshots, in memory only — it does not survive a server restart.
- Admin today is granted by connection type (`peer.board`, i.e. being on `/board` or `/setup`), not by identity. See `docs/decisions/` for where this is heading.

## Gotchas

- `.state.json` is **live save data**, git-ignored, containing reconnect tokens. Never edit or delete it while the server is running.
- `src/assets/wins/*` (win-celebration images) is git-ignored and bundled into the client build via `import.meta.glob`. Its current contents are not store-safe — see the Distribution note in `docs/native-app-plan.md`.

## Where to look next

- `docs/architecture.md` — protocol, device roles, dealer-prompt rotation, `.state.json` shape.
- `docs/native-app-plan.md` — the staged plan for iOS (then Android) native apps.
- `docs/decisions/` — why LAN-phone-hosting over a cloud server, why Capacitor over React Native.
