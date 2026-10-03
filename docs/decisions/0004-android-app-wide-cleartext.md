# 0004 — Android allows cleartext app-wide; pairing enforces the LAN

**Status:** Accepted (2026-10-03)

## Context

The laptop server (and the future phone host) speaks plain `http://` and `ws://` on whatever LAN IP the host has tonight. Android blocks cleartext unless `network_security_config.xml` allows it, and that XML only takes exact domains — there is no subnet or "local network" rule. The Stage 1 APK allowed only `10.0.2.2` and `localhost`, so a real phone could not pair with a laptop at e.g. `192.168.0.239`. iOS solves the same problem with `NSAllowsLocalNetworking`, which is scoped to local addresses; Android has no equivalent.

Options considered: (1) `base-config cleartextTrafficPermitted="true"`; (2) TLS on the table server with a self-signed cert every phone must trust; (3) keep the emulator-only config and send Android players to the browser.

## Decision

**Option 1, paired with an app-side check.** `base-config` permits cleartext app-wide, and `localOrigin()` in `shared/origin.ts` is enforced in `src/views/PairView.tsx` for both the QR scan and the typed address: plain `http` is accepted only for private (`10/8`, `172.16/12`, `192.168/16`), CGNAT (`100.64/10`, e.g. Tailscale), link-local, and loopback IPs, IPv6 ULA/link-local/loopback, `localhost`, `.local`, and dot-less hostnames. `https` is accepted anywhere.

## Consequences

- Android players can pair with any table on the LAN; Stage 4 Android hosting reuses this policy unchanged.
- The OS no longer enforces https for the app. The pairing check is the only thing keeping cleartext on the LAN, so any new network call (analytics, update check, remote image) must use https or go through the same check.
- Release builds get the same policy as debug builds; there is no debug-only split because the release app needs the LAN too.
- A malicious QR pointing at a public `http` host is rejected at pairing ("isn't on your local network"), so the reconnect token is not sent in the clear to the internet.

## Rejected alternatives

- **Self-signed TLS** — every phone must install and trust a cert, every game night, and Stage 3/4 phone hosting would face the same problem again.
- **Emulator-only config** — leaves the Android app unable to do its one job on a real phone.
