import { expect, test, type Browser, type Page } from '@playwright/test';
import type { Snapshot } from '../shared/types';
import { createGame, createPlayer, startTournament } from '../server/engine/state';
import { legalActions } from '../server/engine/betting';
import { finishHand } from '../server/engine/tournament';

// Observe the same full snapshots the UI receives; actions still use real UI.
// Separate contexts are essential: each phone needs independent localStorage.
function watch(page: Page) {
  let latest: Snapshot | undefined;
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) latest = undefined; });
  page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
    const message = JSON.parse(String(payload));
    if (message.type === 'state') latest = message.snapshot;
  }));
  return () => latest!;
}
async function phone(browser: Browser, name: string, seat: number) {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3301', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage(); const snapshot = watch(page);
  await page.goto('/');
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: `Seat ${seat + 1}`, exact: true }).click();
  await page.getByRole('button', { name: /Take.*seat|Join.*table/i }).click();
  await expect.poll(() => snapshot()?.game.players.some(player => player.name === name)).toBe(true);
  return { page, context, snapshot };
}
function balances(snapshot: Snapshot) { return [...snapshot.game.players].sort((a, b) => a.seat - b.seat).map(p => p.stack); }
function verifyAccounting(snapshot: Snapshot) {
  const game = snapshot.game, stacks = game.players.reduce((sum, p) => sum + p.stack, 0);
  const outstanding = game.phase === 'showdown' ? game.pots.filter(p => !p.awarded).reduce((sum, p) => sum + p.amount, 0) : game.players.reduce((sum, p) => sum + p.committedThisHand, 0);
  expect(stacks + outstanding).toBe(game.totalChips);
  expect(game.players.every(p => p.stack >= 0)).toBe(true);
}

test('board and three phones play, reconnect, and award a layered all-in pot', async ({ browser, page: board }) => {
  await board.setViewportSize({ width: 1440, height: 1000 });
  const snapshot = watch(board); await board.goto('/board');
  await expect.poll(() => snapshot()?.you.dealer).toBe(true);
  await expect(board.locator('.join-corner')).toHaveCount(0);
  await expect(board.locator('.board-sidebar .join-panel')).toBeVisible();
  const alice = await phone(browser, 'Alice', 0), bob = await phone(browser, 'Bob', 1), cara = await phone(browser, 'Cara', 2);
  const phones = [alice, bob, cara];
  try {
    await board.getByRole('button', { name: 'Remove Cara from seat 3', exact: true }).click();
    await expect.poll(() => snapshot()?.game.players.length).toBe(2);
    await expect(cara.page.getByLabel('Your name')).toBeVisible();
    await board.getByRole('button', { name: /Undo last action/ }).click();
    await expect.poll(() => cara.snapshot()?.game.players.some(p => p.id === cara.snapshot().you.id)).toBe(true);
    await board.goto('/setup');
    await expect(board.locator('.join-large .qr-well canvas')).toBeVisible();
    await expect(board.locator('.join-large .join-url')).toHaveText('http://127.0.0.1:3301');
    // The elected phone host can visit setup without losing its live connection.
    await expect.poll(() => alice.snapshot()?.you.host).toBe(true);
    await alice.page.getByRole('link', { name: /Set up & start/ }).click();
    await expect(alice.page.getByRole('button', { name: /Start tournament/i })).toBeEnabled();
    await expect.poll(() => alice.snapshot()?.you.host).toBe(true);
    await alice.page.locator('.brand').click();
    await expect(alice.page.getByRole('heading', { name: /You’re in, Alice/ })).toBeVisible();
    await expect(board.getByRole('button', { name: /Start tournament/i })).toBeEnabled();
    const turbo = board.getByRole('button', { name: 'Turbo', exact: true });
    await turbo.click();
    await expect(board.getByLabel('Level length (min)')).toHaveValue('8');
    await expect(board.getByLabel('Custom multiplier')).toHaveValue('2');
    await expect(board.getByLabel('Time limit (min)')).toHaveValue('60');
    await expect(turbo).toHaveClass('selected');
    await board.getByLabel('Time limit (min)').fill('90');
    await expect(turbo).not.toHaveClass('selected');
    await expect.poll(() => snapshot()?.game.phase).toBe('lobby');
    await board.screenshot({ path: 'test-results/setup-desktop.png', fullPage: true });
    await board.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => board.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await board.screenshot({ path: 'test-results/setup-mobile.png', fullPage: true });
    await board.setViewportSize({ width: 1440, height: 1000 });
    await board.getByRole('button', { name: /Start tournament/i }).click();
    await expect.poll(() => snapshot()?.game.phase).toBe('betting');
    await board.goto('/board');
    await expect.poll(() => snapshot()?.game.players.length).toBe(3);
    expect(balances(snapshot())).toEqual([500, 495, 490]); verifyAccounting(snapshot());
    await expect(board.getByText('Game ends in', { exact: true })).toBeVisible();
    await expect(bob.page.getByRole('button', { name: 'Blinds ↑', exact: true })).toHaveCount(0);
    await expect(alice.page.getByRole('button', { name: 'Blinds ↓', exact: true })).toBeDisabled();
    await board.getByRole('button', { name: /Pause clock/ }).click();
    await expect.poll(() => snapshot()?.game.clockPaused).toBe(true);
    const elapsed = snapshot().game.elapsedMs;
    await board.getByRole('button', { name: 'Blinds ↑', exact: true }).click();
    await expect.poll(() => snapshot()?.game.pendingLevel).toBe(2);
    expect(snapshot().game.level).toBe(1);
    expect(snapshot().game.elapsedMs).toBe(elapsed);
    await expect(board.locator('.level-notice')).toContainText('Blinds up next hand · level 2');
    await expect.poll(() => alice.snapshot()?.game.pendingLevel).toBe(2);
    await alice.page.getByRole('button', { name: 'Blinds ↓', exact: true }).click();
    await expect.poll(() => snapshot()?.game.pendingLevel).toBe(1);
    expect(snapshot().game.elapsedMs).toBe(elapsed);
    await expect(board.getByRole('button', { name: 'Blinds ↓', exact: true })).toBeDisabled();
    await board.getByRole('button', { name: /Resume clock/ }).click();
    await expect.poll(() => snapshot()?.game.clockPaused).toBe(false);
    await expect(board.locator('.join-corner .qr-well canvas')).toBeVisible();
    await expect(board.locator('.board-sidebar .join-panel')).toHaveCount(0);
    await board.getByRole('button', { name: 'Enlarge join QR code' }).click();
    await expect(board.getByRole('dialog', { name: 'Join the table', exact: true })).toBeVisible();
    await board.keyboard.press('Escape');
    await expect(board.getByRole('button', { name: 'Enlarge join QR code' })).toBeFocused();
    await board.setViewportSize({ width: 390, height: 844 });
    await expect(board.getByRole('button', { name: 'Enlarge join QR code' })).toBeVisible();
    await board.getByRole('button', { name: 'Enlarge join QR code' }).click();
    await expect(board.locator('.join-qr-overlay .qr-well canvas')).toBeVisible();
    await expect.poll(() => board.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await board.locator('.join-qr-overlay').click({ position: { x: 3, y: 3 } });
    await expect(board.getByRole('dialog')).toHaveCount(0);
    await board.setViewportSize({ width: 1440, height: 1000 });

    // Losing site data mid-hand offers names and preserves the seat, chips, and turn.
    const bobBefore = bob.snapshot().game.players.find(p => p.id === bob.snapshot().you.id)!;
    await bob.page.evaluate(() => localStorage.clear()); await bob.page.reload();
    await expect(bob.page.getByRole('heading', { name: 'Who are you?', exact: true })).toBeVisible();
    await expect(bob.page.locator('.reclaim-player').first()).toContainText('Bob');
    await expect(bob.page.locator('.reclaim-player').first()).toContainText('Offline');
    await expect(bob.page.getByRole('button', { name: 'Join as a new player' })).toHaveCount(0);
    await bob.page.getByRole('button', { name: 'Reclaim Bob, Seat 2', exact: true }).click();
    await expect.poll(() => bob.snapshot()?.you.id).toBe(bobBefore.id);
    expect(bob.snapshot().game.players.find(p => p.id === bobBefore.id)).toEqual(bobBefore);
    await expect(bob.page.locator('.your-stack')).toContainText('495');

    // A live duplicate protects the seat until its last connection closes.
    const aliceBefore = alice.snapshot().game.players.find(p => p.id === alice.snapshot().you.id)!;
    const oldToken = await alice.page.evaluate(() => localStorage.getItem('poker-device')!);
    const oldContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3301' });
    try {
      await oldContext.addInitScript(token => localStorage.setItem('poker-device', token), oldToken);
      const oldPage = await oldContext.newPage(), oldSnapshot = watch(oldPage);
      await oldPage.goto('/'); await expect.poll(() => oldSnapshot()?.you.id).toBe(aliceBefore.id);
      await alice.page.evaluate(() => localStorage.clear()); await alice.page.reload();
      await expect(alice.page.getByRole('heading', { name: 'Who are you?', exact: true })).toBeVisible();
      const reclaimAlice = alice.page.getByRole('button', { name: 'Reclaim Alice, Seat 1', exact: true });
      await expect(reclaimAlice).toBeDisabled();
      await oldContext.close();
      await expect(reclaimAlice).toBeEnabled();
      await reclaimAlice.click();
      await expect.poll(() => alice.snapshot()?.you.id).toBe(aliceBefore.id);
      expect(alice.snapshot().game.players.find(p => p.id === aliceBefore.id)).toEqual(aliceBefore);
      expect(alice.snapshot().you.legal).not.toBeNull();
      expect(await alice.page.evaluate(() => localStorage.getItem('poker-name'))).toBe('Alice');
    } finally { await oldContext.close(); }
    await board.screenshot({ path: 'test-results/board.png', fullPage: true });
    await alice.page.screenshot({ path: 'test-results/player-mobile.png', fullPage: true });
    await expect.poll(() => alice.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const height of [667, 844]) {
      await alice.page.setViewportSize({ width: 390, height });
      const pot = alice.page.locator('.player-pot-row');
      await expect(pot).toBeInViewport({ ratio: 1 });
      await expect(pot.locator('strong').first()).toHaveText('15');
      await alice.page.locator('.player-context').evaluate(el => { el.scrollTop = el.scrollHeight; });
      await expect(pot).toBeInViewport({ ratio: 1 });
    }
    const contextBox = await alice.page.locator('.player-context').boundingBox();
    const controlsBox = await alice.page.getByRole('region', { name: 'Your betting controls' }).boundingBox();
    expect(contextBox!.y + contextBox!.height).toBeLessThanOrEqual(controlsBox!.y);

    async function clickAction(name: 'Call' | 'Check' | 'Fold' | 'All in') {
      const revision = snapshot().game.revision;
      const actor = phones.find(phone => phone.snapshot().you.id === snapshot().game.actorId)!;
      await actor.page.getByRole('button', { name, exact: true }).click();
      if (name === 'All in') await actor.page.getByRole('button', { name: 'Confirm all in', exact: true }).click();
      await expect.poll(() => snapshot().game.revision).toBeGreaterThan(revision);
      verifyAccounting(snapshot());
    }
    async function cardsDealt(street: 'flop' | 'turn' | 'river') {
      await expect.poll(() => snapshot().game.pendingStreet).toBe(street);
      await expect(board.getByRole('dialog')).toContainText(new RegExp(`Deal the\\s*${street}`, 'i'));
      expect(snapshot().game.phase).toBe('street-break');
      for (const phone of phones) await expect.poll(() => phone.snapshot()?.you.legal).toBeNull();
      const revision = snapshot().game.revision;
      await board.getByRole('button', { name: /Cards dealt/ }).click();
      await expect.poll(() => snapshot().game.revision).toBeGreaterThan(revision);
      expect(snapshot().game.street).toBe(street); verifyAccounting(snapshot());
    }
    async function award(name: string) {
      const revision = snapshot().game.revision;
      await board.getByRole('button', { name: `Select winner ${name}`, exact: true }).click();
      await board.getByRole('button', { name: /Award pot/ }).click();
      await expect.poll(() => snapshot().game.revision).toBeGreaterThan(revision);
      verifyAccounting(snapshot());
    }

    // Hand one: create distinct stack depths without eliminating a player.
    await alice.page.getByLabel('Raise to', { exact: true }).fill('30');
    await alice.page.getByRole('button', { name: 'Review raise', exact: true }).click();
    await alice.page.getByRole('button', { name: 'Confirm raise', exact: true }).click();
    await expect.poll(() => snapshot().game.currentBet).toBe(30);
    await clickAction('Call'); await clickAction('Fold');
    expect(balances(snapshot())).toEqual([470, 470, 490]);
    expect(snapshot().game.players.reduce((sum, p) => sum + p.committedThisHand, 0)).toBe(70);
    await cardsDealt('flop'); await clickAction('Check'); await clickAction('Check');
    await cardsDealt('turn'); await clickAction('Check'); await clickAction('Check');
    await cardsDealt('river'); await clickAction('Check'); await clickAction('Check');
    await expect.poll(() => snapshot().game.phase).toBe('showdown');
    await expect(board.getByRole('button', { name: 'Select winner Cara', exact: true })).toHaveCount(0);
    await award('Alice');
    expect(balances(snapshot())).toEqual([540, 470, 490]);
    await expect.poll(() => snapshot().game.phase).toBe('hand-complete');

    // Reload a real phone context: localStorage must bind its existing seat.
    const aliceId = alice.snapshot().you.id;
    await alice.page.reload();
    await expect.poll(() => alice.snapshot()?.you.id).toBe(aliceId);
    await expect.poll(() => alice.snapshot()?.game.players.find(p => p.id === aliceId)?.connected).toBe(true);
    expect(snapshot().game.players).toHaveLength(3);

    await board.getByRole('button', { name: /Next hand/i }).click();
    await expect.poll(() => snapshot().game.hand).toBe(2);
    expect(balances(snapshot())).toEqual([530, 470, 485]);
    // Bob 470, Cara 490; Alice calls the effective maximum and keeps 50.
    await clickAction('All in'); await clickAction('All in'); await clickAction('Call');
    expect(balances(snapshot())).toEqual([50, 0, 0]);
    await cardsDealt('flop'); await cardsDealt('turn'); await cardsDealt('river');
    await expect.poll(() => snapshot().game.phase).toBe('showdown');
    expect(snapshot().game.pots.map(p => p.amount)).toEqual([1410, 40]);
    expect(snapshot().game.pots.map(p => p.eligibleIds.length)).toEqual([3, 2]);
    await award('Bob');
    await expect(board.getByRole('button', { name: 'Select winner Bob', exact: true })).toHaveCount(0);
    await award('Cara');
    expect(balances(snapshot())).toEqual([50, 1410, 40]);
    expect(snapshot().game.phase).toBe('hand-complete'); verifyAccounting(snapshot());

    // Between hands, a busted player can rebuy or a newcomer can take the chair.
    await board.getByText('Adjust a stack', { exact: true }).click();
    await board.getByLabel('Player', { exact: true }).selectOption(aliceId);
    await board.getByLabel('Add or subtract chips').fill('-50');
    await board.getByRole('button', { name: 'Apply', exact: true }).click();
    const rebuy = alice.page.getByRole('button', { name: 'Buy back in for $500', exact: true });
    await expect(rebuy).toBeVisible();
    await rebuy.click();
    await expect.poll(() => snapshot().game.players.find(p => p.id === aliceId)?.stack).toBe(500);
    expect(snapshot().game.totalChips).toBe(1950); verifyAccounting(snapshot());
    await board.getByRole('button', { name: /Undo last action/ }).click();
    await expect(rebuy).toBeVisible();
    const newcomerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3301' });
    try {
      const newcomer = await newcomerContext.newPage(); await newcomer.goto('/');
      await newcomer.getByRole('button', { name: 'Join as a new player' }).click();
      await newcomer.getByLabel('Your name').fill('Dan');
      await newcomer.getByRole('button', { name: 'Seat 1', exact: true }).click();
      await newcomer.getByRole('button', { name: 'Take my seat →', exact: true }).click();
      await expect.poll(() => snapshot().game.players.find(p => p.seat === 0)?.name).toBe('Dan');
      expect(snapshot().game.players).toHaveLength(3); expect(snapshot().game.totalChips).toBe(1950); verifyAccounting(snapshot());
      await expect(alice.page.getByRole('heading', { name: 'Who are you?', exact: true })).toBeVisible();
    } finally { await newcomerContext.close(); }
  } finally { await Promise.all(phones.map(phone => phone.context.close())); }
});


for (const trigger of ['watchdog', 'screen wake']) test(`a silent socket reconnects on ${trigger} and locks actions until a fresh snapshot`, async ({ page }) => {
  const lobby = createGame();
  lobby.players = [createPlayer('alice', 'Alice', 0), createPlayer('bob', 'Bob', 1)];
  const game = startTournament(lobby, lobby.config);
  const snapshot: Snapshot = {
    game, you: { id: game.actorId!, host: false, dealer: false, legal: legalActions(game, game.actorId!) },
    joinUrl: 'http://127.0.0.1:3301', joinUrls: ['http://127.0.0.1:3301'], canUndo: false, serverTime: Date.now(),
  };
  const joins: { token: string }[] = [], publishers: (() => void)[] = [];
  await page.routeWebSocket('**/ws', socket => {
    const publish = () => socket.send(JSON.stringify({ type: 'state', snapshot }));
    publishers.push(publish);
    socket.onMessage(raw => {
      joins.push(JSON.parse(String(raw)));
      if (joins.length === 1) publish();
    });
  });
  // Simulate a transport whose close handshake never completes.
  await page.addInitScript(() => { WebSocket.prototype.close = () => {}; });
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.goto('/');
  const call = page.getByRole('button', { name: 'Call', exact: true });
  await expect(call).toBeEnabled();
  await page.clock.runFor(3000);
  game.hand = 2;
  publishers[0]();
  await expect(page.locator('.player-game-name')).toContainText('Hand 2');
  await page.clock.runFor(3000);
  await expect(call).toBeEnabled();
  expect(joins).toHaveLength(1);
  if (trigger === 'watchdog') await page.clock.runFor(1000);
  else {
    // Wall time advances during sleep while browser timers are suspended.
    await page.clock.setSystemTime(new Date(Date.now() + 60_000));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  }
  await expect(page.locator('.connection-banner')).toBeVisible();
  await expect(call).toBeDisabled();
  await page.clock.runFor(1000);
  await expect.poll(() => joins.length).toBe(2);
  expect(joins[1].token).toBe(joins[0].token);
  publishers[0]();
  await expect(call).toBeDisabled();
  publishers[1]();
  await expect(call).toBeEnabled();
  await expect(page.locator('.connection-banner')).toHaveCount(0);
});

test('time limit shows the final hand and ranks surviving stacks on board and phone', async ({ page }) => {
  const game = createGame();
  game.config.durationMinutes = 5;
  game.elapsedMs = 300_000;
  game.phase = 'betting';
  game.clockPaused = false;
  game.hand = 1;
  game.players = [createPlayer('alice', 'Alice', 0, 300), createPlayer('bob', 'Bob', 1, 600), createPlayer('cara', 'Cara', 2, 600)];
  game.totalChips = 1500;
  const snapshot: Snapshot = {
    game, you: { id: 'alice', host: true, dealer: true, legal: null },
    joinUrl: 'http://127.0.0.1:3301', joinUrls: ['http://127.0.0.1:3301'], canUndo: true, serverTime: Date.now(),
  };
  let publish = () => {};
  await page.routeWebSocket('**/ws', socket => {
    publish = () => socket.send(JSON.stringify({ type: 'state', snapshot }));
    socket.onMessage(publish);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.player-hand .blind-timer')).toContainText('Game ends in');
  await expect(page.locator('.player-hand .blind-timer')).toContainText('00:00');
  await expect(page.getByText("Time's up · final hand", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/time-limit-mobile.png', fullPage: true });
  finishHand(game);
  publish();
  await expect(page.locator('.game-over')).toContainText('Time — final chip counts');
  await expect(page.locator('.game-over')).toContainText('The clock ran out. Standings by chips.');
  await expect(page.getByRole('heading', { name: 'Bob and Cara tie.', exact: true })).toBeVisible();
  await expect(page.locator('.game-over li')).toHaveText(['#1Bob$600', '#1Cara$600', '#3Alice$300']);
  await expect(page.getByRole('button', { name: 'Blinds ↑', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Blinds ↓', exact: true })).toBeDisabled();
  await page.goto('/board');
  await expect(page.locator('.game-over li')).toHaveText(['#1Bob$600', '#1Cara$600', '#3Alice$300']);
  await expect(page.getByText("Time's up · final hand", { exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('player screen pins a roster with turn, dealer, and blind markers above the scrolling panel', async ({ page }) => {
  const game = createGame();
  game.phase = 'betting';
  game.players = [createPlayer('alice', 'Alice', 0, 500), createPlayer('bob', 'Bob', 1, 495), createPlayer('cara', 'Cara', 2, 490)];
  game.button = 0; game.smallBlindSeat = 1; game.bigBlindSeat = 2; game.actorId = 'bob'; game.totalChips = 1485;
  const snapshot: Snapshot = {
    game, you: { id: 'alice', host: false, dealer: false, legal: null },
    joinUrl: 'http://127.0.0.1:3301', joinUrls: ['http://127.0.0.1:3301'], canUndo: false, serverTime: Date.now(),
  };
  await page.routeWebSocket('**/ws', socket => socket.onMessage(() => socket.send(JSON.stringify({ type: 'state', snapshot }))));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const roster = page.locator('.player-roster'), seats = roster.locator('.roster-seat');
  await expect(roster).toBeVisible();
  await expect(seats).toHaveCount(3);
  await expect(seats.nth(0)).toContainText('Alice'); await expect(seats.nth(0).locator('.seat-markers')).toContainText('D');
  await expect(seats.nth(1)).toContainText('Bob'); await expect(seats.nth(1).locator('.seat-markers')).toContainText('SB'); await expect(seats.nth(1)).toHaveClass(/acting/);
  await expect(seats.nth(2)).toContainText('Cara'); await expect(seats.nth(2).locator('.seat-markers')).toContainText('BB');
  const rosterBox = await roster.boundingBox(), contextBox = await page.locator('.player-context').boundingBox();
  expect(rosterBox!.y + rosterBox!.height).toBeLessThanOrEqual(contextBox!.y);
});

test('following the actor scrolls the roster without moving the page', async ({ page }) => {
  const game = createGame();
  game.phase = 'betting';
  game.players = Array.from({ length: 8 }, (_, seat) => createPlayer(`player-${seat}`, `Player ${seat + 1}`, seat));
  game.actorId = game.players[0].id;
  const snapshot: Snapshot = {
    game, you: { id: game.players[0].id, host: true, dealer: true, legal: null },
    joinUrl: 'http://127.0.0.1:3301', joinUrls: ['http://127.0.0.1:3301'], canUndo: false, serverTime: Date.now(),
  };
  let publish = () => {};
  await page.routeWebSocket('**/ws', socket => {
    publish = () => socket.send(JSON.stringify({ type: 'state', snapshot }));
    socket.onMessage(publish);
  });
  await page.setViewportSize({ width: 390, height: 400 });
  await page.goto('/');
  const roster = page.locator('.player-roster');
  await expect(roster.locator('.acting')).toContainText('Player 1');
  const scrollY = await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    return window.scrollY;
  });
  expect(scrollY).toBeGreaterThan(0);
  expect((await roster.boundingBox())!.y).toBeLessThan(0);
  game.actorId = game.players[7].id;
  publish();
  await expect(roster.locator('.acting')).toContainText('Player 8');
  await expect.poll(() => roster.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
  const container = (await roster.boundingBox())!, actor = (await roster.locator('.acting').boundingBox())!;
  expect(actor.x).toBeGreaterThanOrEqual(container.x);
  expect(actor.x + actor.width).toBeLessThanOrEqual(container.x + container.width + 1);
});

async function dragSeat(page: Page, from: number, to: number) {
  const source = (await page.locator(`[data-seat="${from}"]`).boundingBox())!, target = (await page.locator(`[data-seat="${to}"]`).boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();
}

test('board can drag a seated player onto another seat to move or swap them', async ({ page }) => {
  const game = createGame();
  game.players = [createPlayer('alice', 'Alice', 0), createPlayer('bob', 'Bob', 1)];
  const snapshot: Snapshot = {
    game, you: { id: 'board', host: true, dealer: true, legal: null },
    joinUrl: 'http://127.0.0.1:3301', joinUrls: ['http://127.0.0.1:3301'], canUndo: false, serverTime: Date.now(),
  };
  const moves: { playerId: string; seat: number }[] = [];
  await page.routeWebSocket('**/ws', socket => {
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.type === 'moveSeat') {
        const mover = game.players.find(p => p.id === message.playerId)!, occupant = game.players.find(p => p.seat === message.seat), from = mover.seat;
        if (occupant) occupant.seat = from;
        mover.seat = message.seat;
        moves.push({ playerId: message.playerId, seat: message.seat });
      }
      socket.send(JSON.stringify({ type: 'state', snapshot }));
    });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/board');
  await expect(page.locator('[data-seat="0"]')).toContainText('Alice');
  await dragSeat(page, 0, 5);
  await expect.poll(() => moves).toEqual([{ playerId: 'alice', seat: 5 }]);
  await expect(page.locator('[data-seat="5"]')).toContainText('Alice');
  await expect(page.locator('[data-seat="0"]')).toContainText('Open seat');

  // Dropping onto an occupied seat swaps the two players instead of rejecting the move.
  await dragSeat(page, 5, 1);
  await expect.poll(() => moves.length).toBe(2);
  await expect(page.locator('[data-seat="1"]')).toContainText('Alice');
  await expect(page.locator('[data-seat="5"]')).toContainText('Bob');
});

test('expanded corner QR has one address picker and preserves its selection when closed', async ({ page }) => {
  const urls = ['http://192.168.1.2:3000', 'http://10.0.0.2:3000'];
  const snapshot: Snapshot = {
    game: { ...createGame(), phase: 'hand-complete' },
    you: { id: 'board', host: true, dealer: true, legal: null },
    joinUrl: urls[0], joinUrls: urls, canUndo: false, serverTime: Date.now(),
  };
  await page.routeWebSocket('**/ws', socket => {
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.type === 'setJoinUrl') snapshot.joinUrl = message.url;
      socket.send(JSON.stringify({ type: 'state', snapshot }));
    });
  });
  await page.goto('/board');
  const picker = page.getByRole('combobox', { name: 'Join address' });
  await expect(picker).toHaveCount(1);
  await page.getByRole('button', { name: 'Enlarge join QR code' }).click();
  await expect(picker).toHaveCount(1);
  await expect(page.locator('.join-corner select')).toHaveCount(0);
  await picker.selectOption(urls[1]);
  await expect(page.locator('.join-qr-overlay .join-url')).toHaveText(urls[1]);
  await page.getByRole('button', { name: 'Close QR code' }).click();
  await expect(picker).toHaveCount(1);
  await expect(picker).toHaveValue(urls[1]);
  await expect(page.locator('.join-corner .join-url')).toHaveText(urls[1]);
});
