# LanServer transport prototype (Stage 3.2)

iOS-only Capacitor 8 plugin, installed from this repository as `@pokerchips/lan-server`. It runs an HTTP and text WebSocket listener in the foreground, serves the app's bundled `public/` files, publishes `_pokerchips._tcp` via Bonjour, and provides a bounded discovery scan. There is no game state, Room adapter, hosting UI, or Android implementation. The normal app does not start this server yet.

The implementation uses [Telegraph 0.40.0](https://github.com/Building42/Telegraph/tree/0.40.0) through Swift Package Manager for the HTTP listener, WebSocket handshake and outgoing frame writer. `TextWebSocketServer` replaces Telegraph's incoming WebSocket connection because its parser decodes text frames individually. `TextWebSocketDecoder` assembles raw payload bytes per connection and validates UTF-8 only after the final continuation frame, including characters split across frames. Version 0.40.0 pins the evaluated API; its transitive packages are recorded in the app's `Package.resolved`. No CocoaPods are needed. Capacitor generates the local SPM dependency and native class registration during `cap sync ios`.

```ts
import { LanServer } from '@pokerchips/lan-server';

const connected = await LanServer.addListener('connection', ({ id }) => {
  // Future Room adapter creates its connection here.
});
const messages = await LanServer.addListener('message', ({ id, data }) => {
  // JSON parsing and permissions belong to the future Room adapter.
});
const closed = await LanServer.addListener('close', ({ id }) => {});
const errors = await LanServer.addListener('error', ({ operation, message }) => {});
const { urls } = await LanServer.start({ port: 3000, serviceName: 'Our poker table' });
const { services } = await LanServer.browse({ timeoutMs: 3000 });
// Each service: { name, urls: ['http://hostname.local.:3000'] }
await LanServer.send({ connectionId: 'id from connection event', data: JSON.stringify({ example: true }) });
await LanServer.stop();
await Promise.all([connected.remove(), messages.remove(), closed.remove(), errors.remove()]);
```

Register listeners before `start()`. Each socket gets a fresh opaque ID; its events arrive in order on the main queue. `stop()` closes active sockets, emits one `close` per ID, cancels any pending browse, and is idempotent. Repeated start while running rejects; start after stop is supported. An unknown/closed connection rejects `send()`. Sending resolves when Telegraph queues the text; it is not a delivery acknowledgement. Binary WebSocket frames close the socket because the protocol is text JSON. Only `/ws` accepts a WebSocket upgrade. Listener failures and Bonjour publishing failures after a successful start emit `error`; publishing failure leaves HTTP/WebSocket running.

Each complete incoming text message emits one `message`, regardless of frame or TCP chunk boundaries. Interleaved ping/pong frames are handled by the connection and never emitted as application messages. An assembled message is limited to 10 MiB; oversized messages, invalid fragment sequences, unmasked frames, and invalid UTF-8 close the connection. Closing a connection or stopping the server discards incomplete text.

`port` must be an integer in 0–65535 (0 asks the OS for an available port), and the trimmed Bonjour name must contain 1–63 UTF-8 bytes. Returned URLs use active Ethernet/Wi-Fi `en*` interface addresses, including non-link-local IPv6. Cellular, loopback, VPN, and link-local addresses are excluded. With no eligible network interface, `urls` can be empty; connect to Wi-Fi before hosting. The listener binds all interfaces. URLs are a snapshot: after changing Wi-Fi, stop/start to refresh the addresses and advertisement.

Static requests support GET/HEAD, use MIME types, and serve `index.html` for `/`, `/board`, and `/setup`. Query strings do not change file lookup. Missing assets and unknown routes return 404. The resolver rejects dot segments, hidden files, backslashes, NULs, and symlinks escaping the bundled `public/` directory; Telegraph decodes URL path escapes once. No filesystem path can be supplied through JavaScript. `/api/health` is intentionally absent until a game host adapter defines it.

`browse()` defaults to three seconds and accepts 1000–15000 ms. It resolves up to 32 services, returns the successfully resolved services when the deadline expires, rejects concurrent scans, and rejects on a Bonjour search error or `stop()` cancellation. Discovery URLs use the resolved `.local` hostname. The plugin has `NSBonjourServices` and local-network usage text in the iOS shell; a physical device may need the user to grant local-network access. QR/manual pairing remains necessary on networks blocking multicast or clients unable to resolve `.local` names.

## Verify

From the repository root:

```sh
npm ci
npm run check:lan-server
npm run build
npx cap sync ios
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /private/tmp/poker-lan-derived CODE_SIGNING_ALLOWED=NO build
swiftc -module-cache-path /private/tmp/poker-swift-module-cache \
  plugins/lan-server/ios/Sources/LanServerPlugin/HTTPAssets.swift \
  plugins/lan-server/tests/HTTPAssetsChecks.swift -o /private/tmp/poker-http-assets-checks
/private/tmp/poker-http-assets-checks
swift test --package-path plugins/lan-server/tests/transport \
  --scratch-path /private/tmp/poker-lan-native-tests
```

The standalone asset checks exercise traversal, escaping symlinks (including `index.html`), missing assets, route fallback, and MIME. The macOS XCTest package references the exact shipping Swift transport via a source symlink and excludes only the Capacitor bridge. It exercises real loopback HTTP (including percent-encoded traversal and HEAD), WebSocket echo and event ordering, fragmented JSON, UTF-8 scalars split across frames, interleaved pings, rejection of upgrades outside `/ws`, closed/unknown sends, duplicate start, stop/restart, and Bonjour scan cancellation/concurrency/deadline. Decoder checks also cover TCP chunk boundaries, isolated per-connection buffers, malformed fragment sequences and the aggregate message size limit. These are transport tests, with no Room or live save data involved.

For an opt-in development screen or Safari Web Inspector evaluation in a native debug build, import `startEchoServer` from `@pokerchips/lan-server/diagnostics`, call `const echo = await startEchoServer(3000)`, and inspect `echo.urls` and `echo.events`. The helper attaches the real Capacitor listeners and echoes text, and `await echo.stop()` removes its listeners. It is not imported by the app. From another device on Wi-Fi, open a returned URL, refresh `/board`, and connect a WebSocket to `/ws`; verify the returned text, the three events, and that shutdown closes the socket. Run `browse()` from a second iOS installation to check discovery and repeat after denying local-network permission.

Verified on this machine: TypeScript interface check; standalone asset checks; the native XCTest suite; the full iOS Simulator app build (arm64 and x86_64). An isolated Simulator diagnostic copy also verified native Capacitor registration, start returning a LAN address, browser WebSocket echo through the bridge, connection/message/close ordering, Bonjour discovery of its own advertisement, stop rejecting further sends, and invalid-port rejection. The production bundle was not edited for that check. Physical LAN delivery, Bonjour discovery between devices, permission denial/recovery, and background/foreground behavior remain on-device checks. iOS suspends foreground hosting when the app backgrounds or the phone locks. This prototype adds no background mode or handoff behavior. Before enabling actual games, Stage 3.1 must provide the platform-free Room adapter and Stage 3.3 must own the hosting UX, persistence, keep-awake and lifecycle decisions. Input limits and transport backpressure also need production evaluation.
