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
npm run build && npx cap sync ios && npx cap open ios   # iOS shell: rebuild the web bundle, copy it into ios/, open Xcode (SPM only — no CocoaPods)
# Android joiner: use JDK 21 (Android Studio JBR 25 is too new for this Gradle wrapper)
npm run build && npx cap sync android && JAVA_HOME=/path/to/jdk-21 ./android/gradlew -p android assembleDebug
```

## Conventions

- The codebase is deliberately dense: long single-line functions, minimal whitespace, few comments. Match the existing style rather than reformatting files you touch.
- `shared/` and `server/engine/` must stay platform-free (no `node:*`, no DOM). That's what lets them run unchanged in a browser, a WebView, or a future native host — don't reintroduce a Node dependency there.
- Client code must not touch `localStorage` or `navigator.vibrate` directly. Use `src/net/storage.ts` (sync cache over Capacitor Preferences on native, hydrated in `main.tsx` before first render), `src/net/haptics.ts`, and branch on `native` from `src/net/platform.ts`. The web path must behave exactly as before; `npm run test:browser` is the regression gate.
- Native plugins must ship a `Package.swift` (`npx cap sync ios` warns otherwise) — see `docs/decisions/0003-spm-and-official-barcode-scanner.md`.

## Invariants

- `GameState.revision` gives optimistic concurrency: every mutating `ClientMsg` carries the `revision` it was computed against, and `Room.handle` rejects stale ones ("The table changed").
- `assertChips` runs after every accepted transition and enforces chip conservation — total chips in play must reconcile exactly.
- The undo stack (`server/room.ts`) holds up to 100 full `structuredClone`d `GameState` snapshots, in memory only — it does not survive a server restart.
- Admin is `Room.isAdmin`: the device holding `hostToken`, plus any `/board`/`/setup` connection while the room's `boardAdmin` flag is on (default). Only a board is auto-elected host; the role then moves only via `claimHost`/`transferHost` by an admin, never on disconnect or seat reclaim, and never away from a connected host except by the host itself. `boardAdmin` is persisted; `BOARD_ADMIN=on npm start` restores it.

## Gotchas

- `.state.json` is **live save data**, git-ignored, containing reconnect tokens. Never edit or delete it while the server is running.
- `src/assets/wins/*` (win-celebration images) is git-ignored and bundled into the client build via `import.meta.glob`. Its current contents are not store-safe — see the Distribution note in `docs/native-app-plan.md`.

## Where to look next

- `docs/architecture.md` — protocol, device roles, dealer-prompt rotation, `.state.json` shape.
- `docs/native-app-plan.md` — the staged plan for iOS (then Android) native apps.
- `docs/decisions/` — why LAN-phone-hosting over a cloud server, why Capacitor over React Native.
