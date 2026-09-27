# 0002 — Capacitor over a React Native rewrite

**Status:** Accepted (2026-09-20)

## Context

Two ways to get the existing React app onto iOS/Android:

1. **Capacitor.** Wrap the current Vite build (`dist/`) in a native WKWebView/Chromium shell. The React components, `shared/*` logic, and hand-written CSS in `src/styles/` are reused as-is; native capability (haptics, keep-awake, camera QR scan, and later the LAN-server plugin) is added via Capacitor plugins.
2. **React Native / Expo rewrite.** Rebuild every view (`SetupView`, `BoardView`, `PlayerView`, etc.) in RN primitives for native rendering and gesture handling.

## Decision

**Capacitor.** The web app is already most of the way to mobile-ready: `index.html` has `viewport-fit=cover`, `src/styles/*.css` already uses 20 `env(safe-area-inset-*)` rules, `100dvh`, and dedicated height breakpoints for the fixed player action bar, and the reconnect logic in `src/net/useGameSocket.ts` already handles a sleeping/backgrounded phone (exponential backoff, a stale-snapshot watchdog, `visibilitychange` wake). A rewrite would throw all of that away to rebuild it in RN equivalents, for a UI that is form-driven and not animation- or gesture-heavy enough to need native rendering.

Capacitor also directly serves the one-codebase goal in `docs/decisions/0001-lan-phone-host.md`: the same `dist/` build targets web, iOS, and Android, so `docs/native-app-plan.md` Stage 4 (Android) is "add the platform and write one native plugin," not a second UI implementation.

## Consequences

- Native capability is added incrementally, behind small wrapper modules (`src/net/haptics.ts`, `src/net/serverOrigin.ts`, a `useRoute()` hook) that fall back to web APIs when running in a browser — see Stage 1 of `docs/native-app-plan.md`. The diff to existing files stays small (a handful of call sites, not new views).
- The app inherits WebView-specific limits: `navigator.vibrate` is a no-op and needs a plugin (`@capacitor/haptics`); routing can't rely on the server's `app.get('*')` rewrite under `capacitor://localhost`, so the existing pushState router needs an in-app-state fallback.
- `shared/*`'s isomorphism (already required for the client/server split) pays off twice — once for the web/server split, again for reusing it inside the future native host in Stage 3.
- If a future screen genuinely needs native-only interaction (e.g. a much richer seat-drag/table gesture than `useSeatDrag.ts` today), Capacitor doesn't preclude adding a native view for just that screen — this decision is about the app as a whole, not a permanent ceiling.

## Rejected alternative

**React Native / Expo rewrite.** Rejected because it discards working, already mobile-tuned CSS and reconnect logic for no clear interaction-quality win on this particular UI, and would make the web and native versions diverge into two codebases to maintain.
