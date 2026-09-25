# 0001 — LAN phone-hosting over a cloud server

**Status:** Accepted (2026-09-20)

## Context

Porting to iOS (then Android) requires deciding where the authoritative game server runs once we no longer want to require a laptop. Two live options:

1. **Cloud-hosted server.** A small always-on Node process (e.g. Fly.io/Render) holds the room, reachable over the internet; a host phone holds a "host token" for admin actions. Survives the host backgrounding their phone, works over cellular, and the admin/host role would need building either way (see `docs/architecture.md`'s note on `you.host`).
2. **LAN phone-host.** The current `Room`/`server/engine` logic runs inside the host's own app, listening on the LAN the way the laptop does today. No server to operate, no internet dependency, but iOS suspends backgrounded apps — if the host locks their phone, the table stalls until they return.

## Decision

**LAN phone-host.** The product is meant to sell as a one-time purchase. A cloud server is not free to run indefinitely, and any non-trivial usage pushes toward a subscription or a much higher one-time price to cover hosting — which changes the product. LAN hosting has $0 ongoing cost and matches the app's existing no-account, no-cloud design (see `README.md`: "No account, cloud service, or database is needed").

## Consequences

- **Accepted cost:** a backgrounded host device stalls the table. Mitigated (not eliminated) by keep-awake on the host device and a transferable host role (`docs/native-app-plan.md`, Stage 2/3). This is the one thing today's laptop-based model does better.
- Requires new native code per platform: a LAN HTTP+WebSocket listener and mDNS/Bonjour discovery (Stage 3's `LanServer` plugin), because there's no off-the-shelf server to point at.
- Because the host device also serves the built web client over plain HTTP, any device with a browser — including Android, before a dedicated Android app exists — can join a table hosted from an iPhone. This meaningfully de-risks the Android side of the compatibility question.
- If usage or business requirements change later, a cloud relay could be added as a fallback transport without discarding this work — `shared/*` and `server/engine/*` are already platform-free, so the same room logic would run in either place. That would be a new decision, not a reversal of this one.

## Rejected alternative

**Cloud + phone host role**, i.e. always-on hosting with the LAN-host UX layered on top as a fallback. Rejected for now purely on cost grounds, not technical merit — it is arguably the better product. Revisit if the pricing model changes (e.g. an optional paid tier for remote/cellular play).
