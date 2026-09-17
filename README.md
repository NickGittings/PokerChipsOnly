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

Admin controls are available only on `/board` and its `/setup` view. Player connections cannot perform admin actions, even if elected host or sharing a device identity with a board tab. Leaving the board/setup view removes admin access from that connection. This is a **trusted LAN tool**: board access grants control, so do not expose the port to the internet or untrusted guests.

Phones retain a random identity token in local storage, reconnect with backoff, and reclaim the same seat after sleeping or reloading. Disconnected seats remain visible and reserved; their turn waits for them. Clearing browser storage or using another browser creates a new identity. Several tabs in the same browser share a player identity.

Betting locks at every street break. Deal the prompted real cards, then tap **Cards dealt** on the board. All-in hands still show flop, turn, and river prompts individually. At showdown, select one or more eligible winners for the current pot and award it; continue through every side pot.

The board admin can undo the latest game changes, pause the clock, step the blinds up or down, and adjust stacks between hands. Adjustments are logged and alter the tournament's total chips; use positive adjustments for a rebuy or add-on and negative ones for corrections. Setup owns starting stacks; lobby adjustments are disabled. A rebuy after a last-player-standing ending leaves the clock paused until the host resumes it. After a time-limit ending, stack corrections update the standings without restarting the tournament. Undo history holds up to 100 states and is not saved across server restarts. Clock time is not refunded by undo. During a timed tournament, **−15 min / +15 min** changes the total time limit within 5–720 minutes without resetting elapsed time or the blind timer. These adjustments survive hand undo; reducing the limit past elapsed time finishes the current hand before ending the tournament. Undo cannot physically take back cards that the dealer has already shown.

The board (not the host's phone) also has a **New game** button, available any time a tournament is running, even mid-hand. After confirming, it returns the table to the lobby: everyone keeps their seat and name, but stacks, pots, and the hand log are cleared, and the clock stops until the host resumes it. Reconfigure in Setup and start again once at least two players are seated. Undo reverses an accidental New game and restores the tournament with its play time and blind level intact, though the clock stays paused until resumed.

## House rules

- No cards are generated, read, ranked, or evaluated. Each pot is awarded by the humans at the table.
- The button advances to the next player with chips. This is a forward-moving home-game button, rather than the casino dead-button convention. Heads-up, the button posts the small blind, acts first preflop, and acts last after the flop.
- The big blind retains the option to raise after limps. A short all-in raise does not independently reopen betting for a player who has already acted; cumulative increases can reopen it when they reach a full raise. A player without reopened raising rights cannot use All in to evade that restriction.
- Blinds escalate by the configured multiplier. New levels become pending when the server clock expires; the host can also step the pending level up or down with **Blinds ↑ / ↓**. Every change applies at the next hand boundary. A manual change resets the level timer without changing time already played. Generated amounts round upward to the smallest chip.
- The optional time limit counts play time; pausing and server downtime do not use it. Leave it blank or set 0 for no limit, or choose 5–720 minutes. When time expires, the current hand finishes and surviving players rank by chip count, with equal stacks sharing a place. Setup pace presets set level length, multiplier, and time limit together; each number remains editable.
- Ante mode defaults to a single big-blind ante, with amount zero until configured. Per-player and no-ante modes are available. Blinds are posted before antes in both ante modes, so a short blind posts its blind first. The single big-blind ante is shared dead money eligible to every remaining player and is never refunded as an unmatched bet. Per-player antes are included in each player's contribution for side-pot layering.
- Every contribution, including folded players' dead money, enters the layered pot calculation. Uncalled excess is returned. Only eligible players can win a pot. Splits use the smallest chip in play; leftover chips go clockwise starting left of the button among that pot's chosen winners.
- Simultaneous bust-outs are ranked by the stack at the start of the hand; equal starting stacks tie. A winner is declared when only one player has chips.
- Chip graphics are derived from integer balances; there is no physical chip inventory. Values must be positive integers and denominations must be multiples of the smallest chip. Custom noncanonical sets use an exact minimum-chip breakdown. Starting stacks, blinds, bets, and adjustments must be makeable in the configured smallest chip.
- Color-up is available between hands when all balances can be represented exactly by the remaining chips. No chips are silently rounded away, and at least two denominations remain.

## Recovery and a fresh tournament

The server atomically replaces `.state.json` after accepted state changes and saves periodic clock checkpoints. This includes a live hand, player identities, and host identity, extending recovery beyond hand boundaries. On restart, saved chips, action order, and seats return; all devices initially appear disconnected and the clock starts paused. Open the same browser on each device to restore its identity, review the table, then resume the clock.

Recovery is local to this folder and laptop. A sudden power loss can lose time since the last clock checkpoint. Save failures are reported to connected clients; keep the process alive until the disk issue is resolved. Unsupported or inconsistent saves stop startup instead of silently discarding the tournament.

To start a new tournament with the same players still seated, use the board's **New game** button — no server restart needed. To also clear every player identity and rejoin from scratch, stop the server and move `.state.json` to a backup location before restarting. Keep it if you might need the prior game. Never remove or edit the save while the server is running. `STATE_FILE=/path/to/game.json` selects another save file; `STATE_FILE=:memory:` disables persistence for throwaway testing. Save files include reconnect tokens and are excluded from Git.

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
5. In a throwaway game, choose **Turbo** and confirm level length, multiplier, and time limit move together; edit the time limit and confirm Turbo deselects. Start with a one-minute level and a five-minute limit (the minimum). Pause and resume to check both countdowns freeze. Mid-hand, use **Blinds ↑ / ↓**: verify changes queue until the next hand and do not change **Game ends in**. Let time expire during a hand, confirm **Time's up · final hand**, then finish and check standings by chips, including tied places. Undo the final award and finish again.
6. Restart the server mid-hand; confirm the elapsed play time and time limit survive recovery, then resume the paused clock. Test stack adjustments between hands and after a time-limit ending; final standings should update without restarting play.
7. Mid-hand, tap **New game** on the board and confirm: seats, names, and identities are kept, stacks and the hand log clear, and the board returns to the lobby. Undo it and confirm the tournament returns with its stacks, blind level, and play time intact, clock paused; resume the clock and continue the hand. Confirm the button is absent from the host's phone.
8. Check setup colors and spacing, QR readability, and the bottom action bar on your actual phones. Wake Lock, vibration, and sound depend on browser support and permissions; plain LAN HTTP can restrict Wake Lock. Keep the laptop awake with OS settings if needed.

The reference screenshot itself was not included in this workspace; visual implementation follows the supplied green felt/gold token specification. Real Wi-Fi, phone sleep/reconnect behavior, physical dealing, and screenshot matching require hands-on verification.
