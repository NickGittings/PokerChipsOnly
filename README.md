# PokerChips Only

A local, shared poker chip tracker for a 2–8 player tournament with a real deck. The laptop displays the table; each player controls their own seat from a phone. The app handles chips, legal betting, action order, blinds, side pots, and finishing places. Humans deal the cards and declare every showdown winner.

## Game night

Requires Node.js 22 or newer, npm, and all devices on the same Wi-Fi network.

```sh
npm install
npm start
```

The terminal prints a LAN address such as `http://192.168.1.20:3000`. Open its `/board` page on the laptop. Players scan the board QR code, enter a name, and pick one of eight seats. Use **Setup** to configure the game, then start once at least two players are seated. Keep the terminal open throughout the tournament.

`npm start` builds the client and serves everything from port 3000. No account, cloud service, or database is needed. This tracks tournament chips; dollar formatting is a display convention, not a payment system.

For development:

```sh
npm run dev
```

Open port 5173 for the Vite client; port 3000 runs the authoritative server. Vite proxies HTTP API and WebSocket traffic. The development command automatically points the QR code at port 5173 so phones also receive live client changes. Both ports listen on the LAN.

If phones cannot connect, verify the laptop and phones share a network, allow Node through the laptop firewall, and disable guest-network client isolation. Use the terminal's LAN address, not `localhost`, on phones. A VPN or multiple network adapters can make the automatically chosen address wrong. Set `LAN_URL=http://YOUR_LAN_IP:3000` to override it. `PORT` overrides the listening port.

## Table and host controls

The first device to connect becomes host. Any `/board` device also receives dealer controls; its saved identity retains those controls when navigating to setup or reconnecting. If the host disconnects, an available connected device becomes host. This is a **trusted LAN tool**: board access grants control, so do not expose the port to the internet or untrusted guests.

Phones retain a random identity token in local storage, reconnect with backoff, and reclaim the same seat after sleeping or reloading. Disconnected seats remain visible and reserved; their turn waits for them. Clearing browser storage or using another browser creates a new identity. Several tabs in the same browser share a player identity.

Betting locks at every street break. Deal the prompted real cards, then tap **Cards dealt** on the board or host device. All-in hands still show flop, turn, and river prompts individually. At showdown, select one or more eligible winners for the current pot and award it; continue through every side pot.

The host can undo the latest game changes, pause the clock, and adjust stacks between hands. Adjustments are logged and alter the tournament's total chips; use positive adjustments for a rebuy or add-on and negative ones for corrections. Setup owns starting stacks; lobby adjustments are disabled. A rebuy after a tournament has ended leaves the clock paused until the host resumes it. Undo history holds up to 100 states and is not saved across server restarts. Clock time is not refunded by undo. Undo cannot physically take back cards that the dealer has already shown.

## House rules

- No cards are generated, read, ranked, or evaluated. Each pot is awarded by the humans at the table.
- The button advances to the next player with chips. This is a forward-moving home-game button, rather than the casino dead-button convention. Heads-up, the button posts the small blind, acts first preflop, and acts last after the flop.
- The big blind retains the option to raise after limps. A short all-in raise does not independently reopen betting for a player who has already acted; cumulative increases can reopen it when they reach a full raise. A player without reopened raising rights cannot use All in to evade that restriction.
- Blinds escalate by the configured multiplier. New levels become pending when the server clock expires and apply at the next hand boundary. Generated amounts round upward to the smallest chip. Pausing stops the tournament clock.
- Ante mode defaults to a single big-blind ante, with amount zero until configured. Per-player and no-ante modes are available. Blinds are posted before antes in both ante modes, so a short blind posts its blind first. The single big-blind ante is shared dead money eligible to every remaining player and is never refunded as an unmatched bet. Per-player antes are included in each player's contribution for side-pot layering.
- Every contribution, including folded players' dead money, enters the layered pot calculation. Uncalled excess is returned. Only eligible players can win a pot. Splits use the smallest chip in play; leftover chips go clockwise starting left of the button among that pot's chosen winners.
- Simultaneous bust-outs are ranked by the stack at the start of the hand; equal starting stacks tie. A winner is declared when only one player has chips.
- Chip graphics are derived from integer balances; there is no physical chip inventory. Values must be positive integers and denominations must be multiples of the smallest chip. Custom noncanonical sets use an exact minimum-chip breakdown. Starting stacks, blinds, bets, and adjustments must be makeable in the configured smallest chip.
- Color-up is available between hands when all balances can be represented exactly by the remaining chips. No chips are silently rounded away, and at least two denominations remain.

## Recovery and a fresh tournament

The server atomically replaces `.state.json` after accepted state changes and saves periodic clock checkpoints. This includes a live hand, player identities, and host identity, extending recovery beyond hand boundaries. On restart, saved chips, action order, and seats return; all devices initially appear disconnected and the clock starts paused. Open the same browser on each device to restore its identity, review the table, then resume the clock.

Recovery is local to this folder and laptop. A sudden power loss can lose time since the last clock checkpoint. Save failures are reported to connected clients; keep the process alive until the disk issue is resolved. Unsupported or inconsistent saves stop startup instead of silently discarding the tournament.

To start a completely fresh tournament, stop the server and move `.state.json` to a backup location before restarting. Keep it if you might need the prior game. Never remove or edit the save while the server is running. `STATE_FILE=/path/to/game.json` selects another save file; `STATE_FILE=:memory:` disables persistence for throwaway testing. Save files include reconnect tokens and are excluded from Git.

## Verification

```sh
npm test
npm run build
npm run test:browser
```

To use an installed Google Chrome instead of Playwright's bundled Chromium:

```sh
PLAYWRIGHT_CHANNEL=chrome npm run test:browser
```

Vitest covers poker accounting and room-level behavior, including personalized actions, host permissions, seat conflicts, stale intents, undo, reconnect, and persistence recovery. The Playwright script uses an isolated in-memory server on port 3301, a board, and three separate phone contexts. It checks raises, calls, folds, every dealing prompt, phone identity recovery, a three-way all-in with main and side pots, winner eligibility, chip conservation, and phone layout. It also saves screenshots in `test-results/`. The scripted flow passed with installed Google Chrome during implementation.

Before relying on the app at a real table, complete this hardware smoke test:

1. Run `npm start`, open the laptop board, and join from at least two phones on Wi-Fi. Confirm each phone controls only its own seat.
2. Check the starting balances, blinds, and any configured ante. Finish preflop and verify every phone is locked while the flop prompt is visible.
3. Tap **Cards dealt** and verify the correct next player can act. Run an all-in hand through flop, turn, and river, then award the eligible pots and confirm the chip total.
4. Undo an accidental fold. Lock a phone, reopen it, and confirm its seat, stack, and turn return.
5. Use a one-minute level in a throwaway game: verify the displayed level becomes pending during a hand and takes effect on the next hand.
6. Restart the server mid-hand; confirm recovery and resume the paused clock. Test stack adjustments between hands and final standings.
7. Check setup colors and spacing, QR readability, and the bottom action bar on your actual phones. Wake Lock, vibration, and sound depend on browser support and permissions; plain LAN HTTP can restrict Wake Lock. Keep the laptop awake with OS settings if needed.

The reference screenshot itself was not included in this workspace; visual implementation follows the supplied green felt/gold token specification. Real Wi-Fi, phone sleep/reconnect behavior, physical dealing, and screenshot matching require hands-on verification.
