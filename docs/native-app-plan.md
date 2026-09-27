# Native app plan: PokerChips Only on iOS, then Android

> Copied from the planning session on 2026-09-20 so it lives with the code. Update this file as stages complete; add new decisions to `docs/decisions/` rather than rewriting history here.

## Context

Today the app is a LAN web app: an authoritative Node/Express + `ws` server on a laptop (`npm start`), with phones as browser clients on `http://192.168.x.x:3000`. Every game night starts with opening a terminal.

The goal is a real iOS app (Android later) that eventually removes the laptop entirely. The business constraint decides the architecture: a **one-time purchase** can't carry an ongoing server bill, so the endgame is **the host's phone runs the game over LAN** — no cloud, no subscription, no accounts. Sequencing is groundwork-first: Stage 1 ships a sideloadable iOS app against the existing laptop server, because every piece of it is required by the endgame anyway.

### On the Android/iOS compatibility worry

The wire protocol is plain JSON over one WebSocket (`shared/types.ts`). An Android phone joining an iPhone-hosted table is an ordinary WebSocket client — there is nothing platform-specific about it. Only two things get written twice (Swift + Kotlin) behind one shared TypeScript interface: the LAN listener and mDNS discovery. And because the embedded host server also serves the built `dist/`, **any device with a browser can join an iPhone-hosted table** — so Android players work before an Android app exists.

### What the audit found (this is why the endgame is affordable)

- `shared/*` and `server/engine/*` contain **zero** `node:` imports — they already run unchanged in a WebView.
- All Node coupling in the game layer is confined to `server/room.ts`: `node:crypto` randomUUID (2 sites), `node:fs` persistence (4 sites across 2 methods), and the `ws` `WebSocket` type (5 sites, using only `.readyState` and `.send`). Roughly 30 lines to abstract.
- The client's entire server coupling is **one line**: `src/net/useGameSocket.ts:24` builds the socket URL from `location.host`.
- Already mobile-ready: `viewport-fit=cover`, 20 `env(safe-area-inset-*)` uses, `100dvh`, height breakpoints, `touch-action:manipulation`, and a solid reconnect story (backoff + 4s stale watchdog + `visibilitychange` wake) in `useGameSocket.ts`.
- Not ready: pushState routing depends on the server's `app.get('*')` rewrite; `navigator.vibrate` is a no-op in WKWebView; no icons, splash, or manifest exist at all.

### Environment

Xcode 27 + iOS 26.5 simulators are installed. ~~**CocoaPods is missing**~~ — **not needed**: Capacitor 8 scaffolds iOS with Swift Package Manager and every plugin we use ships a `Package.swift` (see `docs/decisions/0003-spm-and-official-barcode-scanner.md`). For Android, the SDK and Android Studio are installed. Android Studio bundles JDK 25, which fails with the generated Gradle 8.14.3 wrapper; use JDK 21 (verified with Temurin 21.0.12.1) for CLI builds.

---

## Stage 0 — Project notes scaffolding ✅

`CLAUDE.md` and this `docs/` folder. Done as the first step so the rest of the plan has somewhere durable to live.

---

## Stage 1 — Capacitor iOS shell, still using the laptop server ✅ (code complete; on-device checks pending)

Outcome: a sideloaded iOS app that plays a full game night. The laptop still runs `npm start`.

**Status (2026-09-25).** Implemented on branch `ios-stage-1`; web path unchanged (`npm test` 206 pass, `npm run test:browser` 40 pass). Built with `xcodebuild` and run on the iPhone 17 Simulator against a throwaway `STATE_FILE=:memory:` server: pairing screen renders, a stored server address connects over the LAN IP (ATS ok), snapshots arrive every second, and killing/restarting the server recovers to "connected" within ~3s. **Deviations from the plan below:**
- **SPM, not CocoaPods; scanner swapped** to `@capacitor/barcode-scanner` (`@capacitor-mlkit/barcode-scanning` has no `Package.swift`). `ios/.gitignore` from Capacitor already covers `App/App/public` and the generated config, so the root `.gitignore` is unchanged.
- **Storage is a sync cache** (`src/net/storage.ts`): Preferences is async but every read (`deviceToken()`, `JoinView`, `SetupView`) was synchronous, so `main.tsx` awaits `hydrate()` before first render. Web is plain `localStorage`. New code must use `storage`, not `localStorage`.
- **Pure URL helpers live in `shared/origin.ts`** (`wsUrl`, `parseOrigin`, unit-tested); `src/net/serverOrigin.ts` re-exports them and holds the stateful getter/setter. A bare `host` with no port defaults to `:3000`.
- **Safe-area fix (not in the plan):** with `contentInset: 'never'` the page runs under the status bar and the app header collided with it. `main.tsx` tags `<html class="native">` and `felt.css` pads the body top by `env(safe-area-inset-top)`, except for the player views that already handle it.
- **`appStateChange`** is wired in `useGameSocket.ts` only (`src/net/appState.ts`); in `useNotifications.ts` the sole `visibilitychange` consumer is the title flash, which is now web-only.
- Icon + splash sources are `assets/*.svg`; regenerate with `npx capacitor-assets generate --ios`.
- `/play` dropped from the router whitelist; "Change table" lives in the footer (native only, confirms first).

**Not yet verified (needs a real iPhone):** camera QR scan (the Simulator has no camera), the local-network permission prompt, lock/unlock seat reclaim, and force-quit reclaim. Verification steps 3-5 below remain open. One unexplained observation: a single Simulator launch showed the disconnected indicator with a live snapshot for ~60s; it did not reproduce in 17 later relaunches on identical code, and the socket trace showed no disconnects. Watch for it on device.

**1.1 Tooling.** `npm i @capacitor/core @capacitor/ios` + `npm i -D @capacitor/cli`. `capacitor.config.ts` with `webDir: 'dist'`, `appId: 'com.nickgittings.pokerchipsonly'`, `ios: { contentInset: 'never', backgroundColor: '#0B2517' }`. Commit `ios/`, gitignore `ios/App/Pods`. No Vite `base` change is needed — Capacitor serves `webDir` at the root of `capacitor://localhost`, so the existing absolute `/assets/...` paths resolve; verify on first run.

**1.2 Decouple the server address** — the one real client change. New `src/net/serverOrigin.ts` resolving the base origin: `location.origin` on web (behavior unchanged), a stored value on native (`@capacitor/preferences`, key `poker-server`, null until paired). Change `src/net/useGameSocket.ts:24` from `location.host` to a helper mapping `http://host:port` → `ws://host:port/ws` (and `https`→`wss`). **Leave the backoff, watchdog, and visibility logic exactly as-is** — it is already the right behavior for a sleeping phone.

**1.3 Routing without a server rewrite.** `capacitor://localhost/board` has no `app.get('*')` behind it, so a reload would 404. Add a `useRoute()` hook returning `{ route, navigate }` — history-backed on web, in-app state on native (persisted in Preferences). The click-delegation handler in `src/App.tsx:18-25` calls `navigate()` instead of `history.pushState`. Drop the dead `/play` entry from the whitelist at `App.tsx:23`.

**1.4 Pairing.** Add `@capacitor-mlkit/barcode-scanning`. On native, when no server is stored, show a "Connect to a table" screen: **Scan QR** (reads the board's existing `snapshot.joinUrl` QR — zero server changes) plus a manual-address fallback and a "Change table" action. Needs `NSCameraUsageDescription`.

**1.5 iOS networking permissions** — the most common "works in Simulator, fails on device" trap:
- `NSAppTransportSecurity` → `NSAllowsLocalNetworking: true`, required for cleartext `http://192.168.*` and `ws://`.
- `NSLocalNetworkUsageDescription` — iOS 14+ prompts before *any* LAN traffic; without it the socket fails silently.

**1.6 Native shims.**
- `@capacitor/haptics` behind a new `src/net/haptics.ts`; swap the 2 `navigator.vibrate` sites (`useNotifications.ts:47`, `useWinCelebration.ts:58`). Map the existing intent: turn/deal → `impact(Light)`, bust → `notification(Warning)`, win → `notification(Success)`.
- `@capacitor-community/keep-awake` replacing the Wake Lock block at `src/App.tsx:31-36`; keep Wake Lock on web.
- `@capacitor/app` — wire `appStateChange` alongside the existing `visibilitychange` listeners in `useGameSocket.ts` and `useNotifications.ts`.
- `@capacitor/preferences` for the three storage keys (`poker-device`, `poker-name`, `poker-setup`). `poker-device` is the de-facto auth credential and WKWebView `localStorage` can be evicted under storage pressure.
- Gate the `document.title` flashing (`useNotifications.ts:50-56`) to web — meaningless on native.
- `@capacitor/status-bar` for the dark bar; portrait-lock the phone app.

**1.7 Identity.** Generate icon + splash with `@capacitor/assets` (felt `#0B2517` + gold chip). Nothing exists today.

---

## Android Stage 1 — sideloadable joiner (code complete; physical checks pending)

**Status (2026-09-27).** Implemented on branch `android-stage-1` in a separate worktree from commit `ffdc6b7`, now merged with the shared fixes on `ios-stage-1`. The existing iOS checkout and its uncommitted files were not edited. This is the laptop-server joiner; Android hosting remains Stage 4.

- The Capacitor 8 Android shell uses `com.nickgittings.pokerchipsonly`, API 26 minimum (required by the scanner), portrait orientation, camera permission, and icons/splashes generated from `assets/*.svg`. `assets/icon-foreground.svg` and `icon-background.svg` are derivatives of the committed icon source for adaptive icons.
- The bundled WebView page uses `http://localhost`, so its LAN `ws://` connection does not require WebView-wide mixed-content permission. Android's SystemBars handles edge-to-edge insets using the existing `viewport-fit=cover` and CSS safe-area rules. Android Back returns from `/board` or `/setup` to the join route, then exits at the root; Back while editing a text field blurs it.
- **Network policy pending explicit approval:** `android/app/src/main/res/xml/network_security_config.xml` currently permits cleartext only to emulator host `10.0.2.2` and `localhost`. An arbitrary laptop LAN IP such as `192.168.0.239` remains blocked. Android's network-security XML supports exact domains, not a runtime LAN subnet rule; an app-wide `base-config cleartextTrafficPermitted="true"` is the proposed change for pairing with any table. Automatic approval review rejected that broader setting twice. Do not treat this APK as ready for physical LAN pairing until that decision is resolved.

**Verified on this machine:** `npm test` (219 passed), `npm run test:browser` (40 passed), `npm run build`, `npx cap sync android`, and `assembleDebug` with JDK 21. On the Pixel 10 Pro XL API 37.1 emulator (WebView 149), manual pairing to `10.0.2.2:3000` reached the live join screen. Stopping the throwaway server showed the reconnect banner; restarting it restored the connected state. The saved pairing and seat both survived app force-stop/relaunch. Back returned from the table view without exiting after the listener fix. The join controls remained clear of the bars in gesture and three-button navigation. Camera denial showed the scanner's Settings prompt and the app's manual-address fallback.

**Build and sideload:**

```sh
npm ci
npm run build
npx cap sync android
JAVA_HOME=/path/to/jdk-21 ./android/gradlew -p android assembleDebug
~/Library/Android/sdk/platform-tools/adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

For emulator testing, run a disposable laptop server on port 3000 and enter `10.0.2.2:3000` in the pairing form. No physical Android phone was connected for this milestone. Still to verify on a phone after the LAN policy is resolved: QR pairing, a full hand, seat recovery after sleep and relaunch, camera denial, Wi-Fi recovery, Back, and both system navigation modes.

---

## Stage 2 — Explicit host role

`server/room.ts:62` and `:99` compute `admin = peer.board` — admin is a *URL*, not a person. The endgame needs a host device. `Room` already persists `hostToken` and already ships `you.host` in the snapshot; it just isn't wired to permissions.

- `admin = peer.token === this.hostToken || peer.board`, with the `peer.board` half behind a room setting so a phone host can be sole admin.
- Add `claimHost` / `transferHost` to `ClientMsg` in `shared/types.ts`; `HostPanel` reads the existing `you.host`.
- `disconnect()` at `room.ts:68` currently hands `hostToken` to an arbitrary remaining peer. Make that deliberate: reserve the host's token for reconnect instead.
- Extend the permission cases in `server/room.test.ts`.

This is a server-side change that improves the web app too.

---

## Stage 3 — Host the game on the phone

**3.1 Make `Room` platform-free** (verified small):
- `randomUUID` (`room.ts:44,92`) → `crypto.randomUUID()`. Verify it resolves under `capacitor://localhost` (a secure context in WKWebView); `structuredClone` is used heavily throughout `room.ts` and should be spot-checked at the same time.
- `node:fs` (`room.ts:28-29,52-53`) → a `Storage` interface `{ read(): string | null; write(s: string): void }`. The Node adapter keeps the atomic `.tmp` + `renameSync`; the native adapter uses `@capacitor/filesystem`.
- `ws` `WebSocket` (`room.ts:21,55,66,83`) → a `Conn` interface `{ id: string; open: boolean; send(data: string): void }`, with `peers` keyed on `Conn`. Mechanical — only `.readyState` and `.send` are used.

`server/index.ts` keeps the Node adapter so `npm start` and the Playwright suite keep working unchanged.

**3.2 `LanServer` Capacitor plugin** — the only genuinely new native code. One TS interface, two native implementations:

```ts
start(opts: { port: number; serviceName: string }): Promise<{ urls: string[] }>
stop(): Promise<void>
send(opts: { connectionId: string; data: string }): Promise<void>
// events: 'connection' {id} | 'message' {id, data} | 'close' {id}
```

It must serve **both** static HTTP (the built `dist/`) and WebSocket on `/ws` — that's what lets browsers and non-app devices join. iOS: evaluate **Telegraph** (Swift, HTTP + WS in one server) first; `Network.framework` `NWListener` with `NWProtocolWebSocket` is the dependency-free fallback but needs static HTTP hand-written. Advertise Bonjour `_pokerchips._tcp` and expose `browse()` so joiners skip typing an IP, with the Stage 1 QR as fallback. Add `NSBonjourServices` to Info.plist.

**3.3 Host UX.** A "Host a table" / "Join a table" first-run choice. On the host device: keep-awake on and a persistent "You're hosting — keep this app open" banner. The existing LAN-address logic in `server/joinUrls.ts` is replaced by the plugin's reported interface addresses, so the admin URL picker in `JoinQr.tsx` keeps working.

> **Accepted constraint:** iOS suspends backgrounded apps. If the host locks their phone or takes a call, the table stalls until they return. Keep-awake and host handoff mitigate it; it does not go away. This is the price of having no server, and it is the one thing the laptop model does better.

---

## Stage 4 — Android

- `npm i @capacitor/android && npx cap add android`. Same web bundle — **no UI work**.
- Kotlin `LanServer` against the identical TS interface: Ktor or NanoHTTPD (both do HTTP + WS), `NsdManager` for mDNS.
- `network_security_config.xml` permitting cleartext on local subnets.
- Android 14+ needs a foreground service to keep the listener alive while hosting — the one place Android beats iOS here.

---

## Files that change

| File | Stage | Change |
|---|---|---|
| `CLAUDE.md`, `docs/` *(new)* | 0 | contributor notes, architecture, decision records |
| `src/net/useGameSocket.ts` | 1 | line 24: `location.host` → resolved server origin |
| `src/net/serverOrigin.ts` *(new)* | 1 | web/native origin resolution + `ws://` mapping |
| `src/App.tsx` | 1 | `useRoute()` instead of pathname; keep-awake swap at 31-36 |
| `src/net/haptics.ts` *(new)* | 1 | `navigator.vibrate` → Haptics |
| `src/net/useNotifications.ts`, `useWinCelebration.ts` | 1 | haptics call sites; gate title-flash to web |
| `capacitor.config.ts`, `ios/App/App/Info.plist` *(new)* | 1 | config, ATS, local-network, camera, Bonjour |
| `server/room.ts` | 2, 3 | host-based `admin`; extract crypto/fs/ws behind interfaces |
| `shared/types.ts` | 2 | `claimHost` / `transferHost` messages |
| `server/index.ts` | 3 | becomes the Node adapter for the new interfaces |
| `plugins/lan-server/` *(new)* | 3, 4 | TS interface + Swift, later Kotlin |

---

## Distribution note

`src/assets/wins/*` is eagerly bundled into every build by `import.meta.glob` at `src/net/useWinCelebration.ts:7`. The current contents will not pass App Store or Play review. The folder is already gitignored, so this is a build-time include decision — point the glob at a shippable default set for store builds and keep a separate path if you want the current behavior at your own table. Worth settling before paying for a developer account.

---

## Verification

**After Stage 1**
1. `npm test && npm run build && npm run test:browser` — the web path must be **unchanged**; this is the regression gate for every stage.
2. `npx cap sync ios && npx cap open ios`; run on Simulator against the Mac's LAN IP.
3. On a real iPhone over Wi-Fi: accept the local-network prompt, scan the board QR, claim a seat, play a hand.
4. Lock the phone mid-hand, wait for the server to mark it disconnected, unlock — confirm the seat is reclaimed and the dealer prompt returns (this exercises the backoff + watchdog path).
5. Force-quit and relaunch — confirm the stored `poker-device` token still reclaims the same seat.

**After Stage 2**
6. `npm test` with the extended `server/room.test.ts` permission cases. On the web app, confirm a non-host `/board` tab can no longer undo when the host-only setting is on.

**After Stage 3**
7. One iPhone hosts; a second iPhone app, an Android browser, and a laptop browser all join and play a full hand including a side pot — verify chip conservation on every screen.
8. Force-quit the host app mid-hand and relaunch — the tournament, ledger, blind level, and pending deal prompt must survive via Filesystem persistence, matching the existing `.state.json` recovery behavior.
9. Confirm Bonjour discovery finds the host with no IP typed, and that the QR fallback still works.

**After Stage 4**
10. Repeat 7 and 8 with an Android device hosting and an iPhone joining.

Then walk the 8-step hardware smoke test already written in `README.md` (lines 81-91) on the native app — it is a better acceptance script than anything I'd write fresh.
