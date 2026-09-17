# PokerChips Only

A local, shared poker chip tracker for a 2–8 player tournament with a real deck. The laptop displays the table; each player controls their own seat from a phone. The app handles chips, legal betting, action order, blinds by time or hands, side pots, finishing places, and a night report of buy-backs and hand results. Humans deal the cards and declare every showdown winner.

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

Admin controls are available on `/board` and its `/setup` view. The player holding the button can confirm dealt cards, award pots, and start the next hand from their phone. All other admin actions require a board/setup connection, even for an elected host or a phone sharing an identity with a board tab. Leaving the board/setup view removes admin access from that connection. This is a **trusted LAN tool**: board access grants control, so do not expose the port to the internet or untrusted guests.

Phones retain a random identity token in local storage, reconnect with backoff, and reclaim the same seat after sleeping or reloading. Disconnected seats remain visible and reserved; their turn waits for them. Clearing browser storage or using another browser creates a new identity. Several tabs in the same browser share a player identity.

Betting locks before the hole cards and at every street break. The player on the button receives the dealing prompt on their phone: deal the prompted real cards, then tap **Cards dealt**. Blinds and antes are already posted and remain intact when confirming the hole cards. Other screens name the dealer they are waiting for. All-in hands still show flop, turn, and river prompts individually. At showdown, the dealer selects one or more eligible winners for the current pot and awards it; continue through every side pot. The board takes over prompts when the button seat is empty or that player disconnects. A sleeping phone hands off only after the server detects its disconnection. **Deal next hand** is available on both the board and the current dealer’s phone.

The board admin can undo the latest game changes, pause the clock, step the blinds up or down, and adjust stacks between hands. Adjustments are logged and alter the tournament's total chips; use the dedicated **Buy back in** action for buy-backs, and stack adjustments for add-ons or corrections. Initial and late buy-ins, buy-backs, adjustments, withdrawals on removing a player, and nonzero results from each completed hand enter the night ledger. Setup owns starting stacks; lobby adjustments are disabled. A buy-back after a last-player-standing ending leaves the clock paused until the host resumes it. After a time-limit ending, stack corrections update the standings without restarting the tournament. Undo history holds up to 100 states and is not saved across server restarts. Clock time is not refunded by undo. During a timed tournament, **−15 min / +15 min** changes the total time limit within 5–720 minutes without resetting elapsed time or the blind timer. These adjustments survive hand undo; reducing the limit past elapsed time finishes the current hand before ending the tournament. Undo cannot physically take back cards that the dealer has already shown.

The board also has a **New game** button, available any time a tournament is running, even mid-hand. After confirming, it returns the table to the lobby: everyone keeps their seat and name, but stacks, pots, the hand log, and the night ledger are cleared, and the clock stops until the host resumes it. Reconfigure in Setup and start again once at least two players are seated. Undo reverses an accidental New game and restores the tournament with its ledger, play time, and blind level intact, though the clock stays paused until resumed.

Phone notices announce your turn, dealing tasks, and bust-outs with an in-app banner. Turn and deal prompts alert the responsible phone; bust-outs alert the acting dealer and board, with a plain toast on other screens. Sound unlocks after tapping or pressing a key; vibration and hidden-tab title flashing work when supported. These notices require a running page: plain LAN HTTP does not support Web Notifications, push, or service workers. Reconnecting to an unchanged snapshot does not replay notices.

Open **Night report** on the board during play; the same report appears on all screens when the tournament ends. Buy-in counts include buy-backs. Net is the current stack minus signed buy-ins and adjustments; withdrawing chips reduces the amount invested. Live net settles after the hand completes. All amounts describe tournament chips, not cash payments. Biggest win and worst hand are net changes over an entire completed hand, including blinds and antes, rather than gross pot sizes. Rows follow the finish order, with removed players retained after the standings. The ledger retains the latest 1,000 entries independently of the 150-line activity log; older saves cannot reconstruct missing history. Totals use only retained entries, and “Hands with a result” counts recorded nonzero hand results. Undo reverses the corresponding ledger entries.

## House rules

- No cards are generated, read, ranked, or evaluated. Each pot is awarded by the humans at the table.
- The button advances to the next player with chips. This is a forward-moving home-game button, rather than the casino dead-button convention. Heads-up, the button posts the small blind, acts first preflop, and acts last after the flop.
- The big blind retains the option to raise after limps. A short all-in raise does not independently reopen betting for a player who has already acted; cumulative increases can reopen it when they reach a full raise. A player without reopened raising rights cannot use All in to evade that restriction.
- Blinds escalate by the configured multiplier. Setup offers levels by time or **By rounds**, with a raise every 1–100 hands (default 10). With 10 hands per level, hands 1–10 use level 1 and hand 11 begins level 2. Time presets select time mode. New levels queue for the next hand boundary; the host can also step the pending level up or down with **Blinds ↑ / ↓**. A manual change restarts the level timer or hand counter without changing time already played. Generated amounts round upward to the smallest chip. Small- and big-blind seats have distinct fills and labeled markers; the gold acting-player highlight takes priority.
- The optional time limit counts play time in either blind pace; pausing and server downtime do not use it. Leave it blank or set 0 for no limit, or choose 5–720 minutes. When time expires, the current hand finishes and surviving players rank by chip count, with equal stacks sharing a place. Setup pace presets set level length, multiplier, and time limit together; each number remains editable.
- Ante mode defaults to a single big-blind ante, with amount zero until configured. Per-player and no-ante modes are available. Blinds are posted before antes in both ante modes, so a short blind posts its blind first. The single big-blind ante is shared dead money eligible to every remaining player and is never refunded as an unmatched bet. Per-player antes are included in each player's contribution for side-pot layering.
- Every contribution, including folded players' dead money, enters the layered pot calculation. Uncalled excess is returned. Only eligible players can win a pot. Splits use the smallest chip in play; leftover chips go clockwise starting left of the button among that pot's chosen winners.
- Simultaneous bust-outs are ranked by the stack at the start of the hand; equal starting stacks tie. A winner is declared when only one player has chips.
- Chip graphics are derived from integer balances; there is no physical chip inventory. Values must be positive integers and denominations must be multiples of the smallest chip. Custom noncanonical sets use an exact minimum-chip breakdown. Starting stacks, blinds, bets, and adjustments must be makeable in the configured smallest chip.
- Color-up is available between hands when all balances can be represented exactly by the remaining chips. No chips are silently rounded away, and at least two denominations remain.

## Recovery and a fresh tournament

The server atomically replaces `.state.json` after accepted state changes and saves periodic clock checkpoints. This includes a live hand, player identities, and host identity, extending recovery beyond hand boundaries. On restart, saved chips, action order, seats, ledger, blind pace, level hand counter, and pending deal confirmation return; all devices initially appear disconnected and the clock starts paused. Open the same browser on each device to restore its identity, review the table, then resume the clock. Older saves load with time-based blinds and an empty ledger when those fields were absent.

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

Vitest covers poker accounting and room-level behavior, including time and hand blind pacing, configuration validation, night-report accounting, personalized actions, dealer and admin permissions, deal-confirmation locks, seat conflicts, stale intents, ledger undo, reconnect, and older-save recovery. The Playwright script uses an isolated in-memory server on port 3301, a board, and three separate phone contexts. It checks raises, calls, folds, hole-card and street prompts on the button phone, prompt rotation and board fallback, phone identity recovery, a three-way all-in with main and side pots, winner eligibility, chip conservation, blind seat fills, notifications, and phone layout. It also saves screenshots in `test-results/`. Use the command results from your current checkout to confirm which automated checks pass.

Before relying on the app at a real table, complete this hardware smoke test:

1. Run `npm start`, open `/board` on the laptop, and join from three phones on Wi-Fi. Confirm each phone controls only its own seat. Check balances, blinds, and any ante.
2. Setup → **By rounds**, raise every 3 hands. Confirm the button phone shows **Deal the hole cards**, other screens name that dealer, and betting remains locked until **Cards dealt**. Play three hands: level 2 starts at hand 4 and **Next level** shows the remaining hand count. Use **Blinds ↑** mid-hand and verify it queues for the next hand and restarts the hand count.
3. Verify each new hand’s dealing prompt moves to the next button phone. Put that phone to sleep and wait for its connection to drop; the board should take over. Wake it and verify its seat and dealing controls return. Run an all-in hand through flop, turn, river, and eligible side-pot awards, checking chip conservation.
4. Bust a player. Check that the dealer phone and board show their name and finishing place with an alert, while other phones show a plain toast. Buy back in and verify the board’s **Night report** increments the buy-in count. Check a won hand and a lost hand, then finish the tournament and compare the report on every screen. Sound needs an earlier tap; vibration depends on browser support.
5. Undo an accidental fold or buy-back and confirm chips and report entries revert. Restart the server mid-hand; check that the ledger, blind level, hand count, pending dealing prompt, and elapsed time survive recovery, then resume the paused clock.
6. In a throwaway game, choose **Turbo** and confirm it selects time mode and sets level length, multiplier, and time limit together. Use a one-minute level and five-minute limit, pause and resume, and verify both countdowns freeze. Change blinds mid-hand without changing **Game ends in**. Let time expire, confirm **Time’s up · final hand**, and check standings by chips, including ties. Repeat with blinds by hands to verify the overall time limit still runs.
7. Mid-hand, tap **New game** on the board. Confirm seats, names, and identities remain while stacks, hand log, and night report clear. Undo it: the tournament and ledger return, with the clock paused. Test stack corrections after a time-limit ending without restarting play.
8. Check QR readability and your actual phone layout, including notches and bottom safe areas. The compact header should leave more room for the table, and the pot/blinds/next-level strip should remain visible above the sticky action bar. Confirm distinct small- and big-blind fills, including heads-up, while the acting seat keeps its gold highlight. Plain LAN HTTP can restrict Wake Lock; keep the laptop awake with OS settings if needed.

The reference screenshot itself was not included in this workspace; visual implementation follows the supplied green felt/gold token specification. Real Wi-Fi, phone sleep/reconnect behavior, physical dealing, and screenshot matching require hands-on verification.
