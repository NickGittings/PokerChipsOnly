import { expect, test, type Browser, type Page, type WebSocketRoute } from '@playwright/test';
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
  await expect.poll(() => snapshot()?.you.admin).toBe(true);
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
    // Host election never grants controls to a player connection.
    await expect.poll(() => alice.snapshot()?.you.admin).toBe(false);
    await expect(alice.page.getByRole('link', { name: /Set up & start/ })).toHaveCount(0);
    await expect(board.getByRole('button', { name: /Start tournament/i })).toBeEnabled();
    await board.getByRole('button', { name: 'By hands', exact: true }).click();
    await expect(board.getByLabel('Raise blinds every N hands')).toHaveValue('10');
    await expect(board.locator('.level-preview')).toContainText('Hand 11');
    await board.getByLabel('Raise blinds every N hands').fill('3');
    await expect(board.locator('.level-preview')).toContainText('Hand 4');
    await expect(board.getByLabel('Level length (min)')).toHaveCount(0);
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
    await expect(alice.page.getByRole('dialog')).toContainText(/Deal the\s*hole cards/i);
    await expect(board.getByRole('dialog')).toContainText(/Waiting for Alice\s*to deal/);
    for (const phone of phones) await expect.poll(() => phone.snapshot()?.you.legal).toBeNull();
    await expect.poll(() => alice.snapshot()?.you.dealing).toBe(true);
    await expect.poll(() => snapshot()?.you.dealing).toBe(false);
    await alice.page.getByRole('button', { name: /Cards dealt/ }).click();
    await expect.poll(() => snapshot()?.game.awaitingDeal).toBe(false);
    await expect.poll(() => alice.snapshot()?.you.legal).not.toBeNull();
    await expect(alice.page.locator('.notice-stack')).toContainText(/Your turn/i);
    await expect(board.locator('.seat-card.seat-sb')).toHaveCount(1);
    await expect(board.locator('.seat-card.seat-bb')).toHaveCount(1);
    await expect(bob.page.locator('.your-stack')).toHaveClass(/seat-sb/);
    await expect(cara.page.locator('.your-stack')).toHaveClass(/seat-bb/);
    await expect(board.getByText('Game ends in', { exact: true })).toBeVisible();
    await expect(bob.page.getByRole('button', { name: 'Blinds ↑', exact: true })).toHaveCount(0);
    await expect(alice.page.locator('.host-panel')).toHaveCount(0);
    await board.getByRole('button', { name: /Pause clock/ }).click();
    await expect.poll(() => snapshot()?.game.clockPaused).toBe(true);
    const elapsed = snapshot().game.elapsedMs;
    await board.getByRole('button', { name: '+15 min', exact: true }).click();
    await expect.poll(() => snapshot()?.game.config.durationMinutes).toBe(105);
    await expect.poll(() => alice.snapshot()?.game.config.durationMinutes).toBe(105);
    await board.getByRole('button', { name: '−15 min', exact: true }).click();
    await expect.poll(() => snapshot()?.game.config.durationMinutes).toBe(90);

    await board.getByRole('button', { name: 'Blinds ↑', exact: true }).click();
    await expect.poll(() => snapshot()?.game.pendingLevel).toBe(2);
    expect(snapshot().game.level).toBe(1);
    expect(snapshot().game.elapsedMs).toBe(elapsed);
    await expect(board.locator('.level-notice')).toContainText('Blinds up next hand · level 2');
    await expect.poll(() => alice.snapshot()?.game.pendingLevel).toBe(2);
    await board.getByRole('button', { name: 'Blinds ↓', exact: true }).click();
    await expect.poll(() => snapshot()?.game.pendingLevel).toBe(1);
    expect(snapshot().game.elapsedMs).toBe(elapsed);
    await expect(board.getByRole('button', { name: 'Blinds ↓', exact: true })).toBeDisabled();
    await board.getByRole('button', { name: /Resume clock/ }).click();
    await expect.poll(() => snapshot()?.game.clockPaused).toBe(false);
    await expect(board.locator('.join-corner .qr-well canvas')).toBeVisible();
    expect((await board.locator('.join-corner').boundingBox())!.x).toBeLessThan(50);
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
    for (const page of [board, alice.page]) for (const button of await page.locator('.notice-toast button').all()) await button.click();
    await board.screenshot({ path: 'test-results/board.png', fullPage: true });
    await alice.page.screenshot({ path: 'test-results/player-mobile.png', fullPage: true });
    await expect.poll(() => alice.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const height of [667, 844]) {
      await alice.page.setViewportSize({ width: 390, height });
      const pot = alice.page.locator('.player-pot-row');
      await expect.poll(() => alice.page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
      await expect(alice.page.getByRole('region', { name: 'Your betting controls' })).toBeInViewport({ ratio: 1 });
      await expect.poll(() => alice.page.locator('.player-flow').evaluate(el => el.scrollHeight <= el.clientHeight)).toBe(true);
      await expect(pot).toBeInViewport({ ratio: 1 });
      await expect(pot.locator('strong').first()).toHaveText('$15');
      await alice.page.locator('.player-flow').evaluate(el => { el.scrollTop = el.scrollHeight; });
      await expect(pot).toBeInViewport({ ratio: 1 });
      if (height === 667) await alice.page.screenshot({ path: 'test-results/player-mobile-short.png', fullPage: true });
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
      const dealer = phones.find(phone => phone.snapshot().you.dealing)!;
      await expect(dealer.page.getByRole('dialog')).toContainText(new RegExp(`Deal the\\s*${street}`, 'i'));
      await expect(board.getByRole('dialog')).toContainText(new RegExp(`Waiting for ${snapshot().game.players.find(p => p.id === dealer.snapshot().you.id)!.name}\\s*to deal`));
      expect(snapshot().game.phase).toBe('street-break');
      for (const phone of phones) await expect.poll(() => phone.snapshot()?.you.legal).toBeNull();
      const revision = snapshot().game.revision;
      await dealer.page.getByRole('button', { name: /Cards dealt/ }).click();
      await expect.poll(() => snapshot().game.revision).toBeGreaterThan(revision);
      expect(snapshot().game.street).toBe(street); verifyAccounting(snapshot());
    }
    async function award(name: string) {
      const revision = snapshot().game.revision;
      const dealer = phones.find(phone => phone.snapshot().you.dealing)!;
      await dealer.page.getByRole('button', { name: `Select winner ${name}`, exact: true }).click();
      await dealer.page.getByRole('button', { name: /Award pot/ }).click();
      await expect.poll(() => snapshot().game.revision).toBeGreaterThan(revision);
      verifyAccounting(snapshot());
    }

    // Hand one: create distinct stack depths without eliminating a player.
    await alice.page.getByRole('button', { name: 'Open Raise sizer', exact: true }).click();
    await alice.page.getByLabel('Raise to', { exact: true }).fill('30');
    await alice.page.getByRole('button', { name: 'Confirm raise', exact: true }).click();
    await expect.poll(() => snapshot().game.currentBet).toBe(30);
    await clickAction('Call'); await clickAction('Fold');
    expect(balances(snapshot())).toEqual([470, 470, 490]);
    expect(snapshot().game.players.reduce((sum, p) => sum + p.committedThisHand, 0)).toBe(70);
    await cardsDealt('flop'); await clickAction('Check'); await clickAction('Check');
    await cardsDealt('turn'); await clickAction('Check'); await clickAction('Check');
    await cardsDealt('river'); await clickAction('Check'); await clickAction('Check');
    await expect.poll(() => snapshot().game.phase).toBe('showdown');
    await expect(alice.page.getByRole('button', { name: 'Select winner Cara', exact: true })).toHaveCount(0);
    await award('Alice');
    expect(balances(snapshot())).toEqual([540, 470, 490]);
    await expect.poll(() => snapshot().game.phase).toBe('hand-complete');
    await board.getByText('Night report', { exact: true }).click();
    await expect(board.locator('.night-report')).toContainText('3 buy-ins & buy-backs');
    await expect(board.locator('.report-player').filter({ hasText: 'Alice' })).toContainText('+$40');
    await expect(board.locator('.report-player').filter({ hasText: 'Alice' })).toContainText('hand 1');

    // Reload a real phone context: localStorage must bind its existing seat.
    const aliceId = alice.snapshot().you.id;
    await alice.page.reload();
    await expect.poll(() => alice.snapshot()?.you.id).toBe(aliceId);
    await expect.poll(() => alice.snapshot()?.game.players.find(p => p.id === aliceId)?.connected).toBe(true);
    expect(snapshot().game.players).toHaveLength(3);

    await expect(alice.page.getByRole('button', { name: 'Deal next hand →', exact: true })).toBeVisible();
    await board.getByRole('button', { name: 'Deal next hand →', exact: true }).click();
    await expect.poll(() => snapshot().game.hand).toBe(2);
    expect(balances(snapshot())).toEqual([530, 470, 485]);
    await expect(bob.page.getByRole('dialog')).toContainText(/Deal the\s*hole cards/i);
    await expect(board.getByRole('dialog')).toContainText(/Waiting for Bob\s*to deal/);
    await expect(alice.page.getByRole('button', { name: /Cards dealt/ })).toHaveCount(0);
    // A disconnected button phone hands the prompt to the board; reconnect restores it.
    await bob.page.goto('about:blank');
    await expect.poll(() => snapshot()?.you.dealing).toBe(true);
    await expect(board.getByRole('button', { name: /Cards dealt/ })).toBeVisible();
    await bob.page.goto('/');
    await expect.poll(() => bob.snapshot()?.you.dealing).toBe(true);
    await expect.poll(() => snapshot()?.you.dealing).toBe(false);
    await bob.page.getByRole('button', { name: /Cards dealt/ }).click();
    await expect.poll(() => snapshot()?.game.awaitingDeal).toBe(false);
    // Bob 470, Cara 490; Alice calls the effective maximum and keeps 50.
    await clickAction('All in'); await clickAction('All in'); await clickAction('Call');
    expect(balances(snapshot())).toEqual([50, 0, 0]);
    await cardsDealt('flop'); await cardsDealt('turn'); await cardsDealt('river');
    await expect.poll(() => snapshot().game.phase).toBe('showdown');
    expect(snapshot().game.pots.map(p => p.amount)).toEqual([1410, 40]);
    expect(snapshot().game.pots.map(p => p.eligibleIds.length)).toEqual([3, 2]);
    await award('Bob');
    await expect(bob.page.getByRole('button', { name: 'Select winner Bob', exact: true })).toHaveCount(0);
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
  const game = startTournament(lobby, lobby.config); game.awaitingDeal = false;
  const snapshot: Snapshot = {
    game, you: { id: game.actorId!, host: false, admin: false, dealing: false, legal: legalActions(game, game.actorId!) },
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
  await expect(page.locator('.player-header')).toContainText('Hand 2');
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
  await expect(page.locator('.connection-banner')).toHaveCSS('position', 'fixed');
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
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
    game, you: { id: 'alice', host: true, admin: true, dealing: true, legal: null },
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
  await expect(page.locator('.game-over .report-player header strong')).toHaveText(['#1Bob', '#1Cara', '#3Alice']);
  await expect(page.locator('.game-over .report-player')).toHaveCount(3);
  await expect(page.locator('.player-shell')).toHaveCount(0);
  await page.locator('.player-page > .hand-log').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(page.locator('.host-panel')).toHaveCount(0);
  await page.goto('/board');
  await expect(page.getByRole('button', { name: 'Blinds ↑', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Blinds ↓', exact: true })).toBeDisabled();
  await expect(page.locator('.game-over .report-player header strong')).toHaveText(['#1Bob', '#1Cara', '#3Alice']);
  await expect(page.locator('.game-over .report-player')).toHaveCount(3);
  await expect(page.getByText("Time's up · final hand", { exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('player screen shows a 2x2 roster with turn, dealer, and blind markers below the pinned stack', async ({ page }) => {
  const game = createGame();
  game.phase = 'betting';
  game.players = [createPlayer('alice', 'Alice', 0, 500), createPlayer('bob', 'Bob', 1, 495), createPlayer('cara', 'Cara', 2, 490), createPlayer('dan', 'Dan', 3, 500)];
  game.button = 0; game.smallBlindSeat = 1; game.bigBlindSeat = 2; game.actorId = 'bob'; game.totalChips = 1985;
  const snapshot: Snapshot = {
    game, you: { id: 'alice', host: false, admin: false, dealing: false, legal: null },
    joinUrl: 'http://127.0.0.1:3301', joinUrls: ['http://127.0.0.1:3301'], canUndo: false, serverTime: Date.now(),
  };
  let publish = () => {};
  await page.routeWebSocket('**/ws', socket => { publish = () => socket.send(JSON.stringify({ type: 'state', snapshot })); socket.onMessage(publish); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const roster = page.locator('.player-roster'), seats = roster.locator('.roster-seat');
  await expect(roster).toBeVisible();
  await expect(seats).toHaveCount(4);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const boxes = await seats.evaluateAll(elements => elements.map(el => {
      const { x, y, width, height } = el.getBoundingClientRect();
      return { x, y, width, height };
    }));
    expect(boxes[0].y).toBe(boxes[1].y);
    expect(boxes[2].y).toBe(boxes[3].y);
    expect(boxes[2].y).toBeGreaterThanOrEqual(boxes[0].y + boxes[0].height);
    expect(boxes[0].x).toBe(boxes[2].x);
    expect(boxes[1].x).toBe(boxes[3].x);
    expect(boxes[1].x).toBeGreaterThanOrEqual(boxes[0].x + boxes[0].width);
    expect(await roster.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await expect(seats.nth(0)).toContainText('Alice'); await expect(seats.nth(0).locator('.seat-markers')).toContainText('D');
  await expect(seats.nth(1)).toContainText('Bob'); await expect(seats.nth(1).locator('.seat-markers')).toContainText('SB'); await expect(seats.nth(1)).toHaveClass(/acting/);
  await expect(seats.nth(1)).toHaveClass(/seat-sb/);
  await expect(seats.nth(2)).toHaveClass(/seat-bb/);
  await expect(seats.nth(2)).toContainText('Cara'); await expect(seats.nth(2).locator('.seat-markers')).toContainText('BB');
  const rosterBox = await roster.boundingBox(), contextBox = await page.locator('.player-context').boundingBox();
  expect(rosterBox!.y).toBeGreaterThanOrEqual(contextBox!.y + contextBox!.height);
  expect(rosterBox!.y + rosterBox!.height).toBeLessThanOrEqual((await page.getByRole('region', { name: 'Your betting controls' }).boundingBox())!.y);
  const actingFill = await seats.nth(1).evaluate(el => getComputedStyle(el).backgroundColor);
  const bigBlindFill = await seats.nth(2).evaluate(el => getComputedStyle(el).backgroundColor);
  expect(actingFill).not.toBe(bigBlindFill);
  game.actorId = 'cara'; publish();
  await expect(seats.nth(2)).toHaveClass(/acting/);
  await expect(seats.nth(2)).toHaveCSS('background-color', actingFill);
  expect(await seats.nth(1).evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(actingFill);
  expect(await seats.nth(1).evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(bigBlindFill);
  game.players.push(createPlayer('eve', 'Eve', 4, 500), createPlayer('fred', 'Fred', 5, 500));
  game.log = [{ id: 1, text: 'Bob calls $10.' }, { id: 2, text: 'Cara checks.' }];
  publish();
  await expect(seats).toHaveCount(6);
  expect(await page.locator('.player-flow').evaluate(el => el.scrollHeight <= el.clientHeight)).toBe(true);
});

for (const height of [400, 667, 844]) test(`following the actor at ${height}px keeps them visible without moving the page`, async ({ page }) => {
  const game = createGame();
  game.phase = 'betting';
  game.players = Array.from({ length: 8 }, (_, seat) => createPlayer(`player-${seat}`, `Player ${seat + 1}`, seat));
  game.actorId = game.players[0].id;
  const snapshot: Snapshot = {
    game, you: { id: game.players[0].id, host: true, admin: true, dealing: true, legal: null },
    joinUrl: 'http://127.0.0.1:3301', joinUrls: ['http://127.0.0.1:3301'], canUndo: false, serverTime: Date.now(),
  };
  let publish = () => {};
  await page.routeWebSocket('**/ws', socket => {
    publish = () => socket.send(JSON.stringify({ type: 'state', snapshot }));
    socket.onMessage(publish);
  });
  await page.setViewportSize({ width: 390, height });
  await page.goto('/');
  const roster = page.locator('.player-roster');
  await expect(roster.locator('.acting')).toContainText('Player 1');
  const scrollY = await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    return window.scrollY;
  });
  expect(scrollY).toBe(0);
  const flow = page.locator('.player-flow');
  const topbarBefore = await page.locator('.player-topbar').boundingBox(), controlsBefore = await page.locator('.player-actions').boundingBox();
  const lastSeatBefore = (await roster.locator('.roster-seat').last().boundingBox())!, flowBefore = (await flow.boundingBox())!;
  const needsScroll = lastSeatBefore.y + lastSeatBefore.height > flowBefore.y + flowBefore.height;
  game.actorId = game.players[7].id;
  publish();
  await expect(roster.locator('.acting')).toContainText('Player 8');
  if (needsScroll) await expect.poll(() => flow.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  else expect(await flow.evaluate(el => el.scrollTop)).toBe(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
  const container = (await flow.boundingBox())!, actor = (await roster.locator('.acting').boundingBox())!;
  expect(actor.y).toBeGreaterThanOrEqual(container.y);
  expect(actor.y + actor.height).toBeLessThanOrEqual(container.y + container.height + 1);
  expect(await page.locator('.player-topbar').boundingBox()).toEqual(topbarBefore);
  expect(await page.locator('.player-actions').boundingBox()).toEqual(controlsBefore);
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
    game, you: { id: 'board', host: true, admin: true, dealing: true, legal: null },
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
    you: { id: 'board', host: true, admin: true, dealing: true, legal: null },
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

test('hands pacing counts down at hand boundaries while the overall time limit remains visible', async ({ page }) => {
  const game = createGame();
  game.config.blindPace = 'hands'; game.config.levelHands = 3; game.config.durationMinutes = 60;
  game.phase = 'betting'; game.hand = 1; game.clockPaused = false;
  game.players = [createPlayer('alice', 'Alice', 0, 500), createPlayer('bob', 'Bob', 1, 500)]; game.totalChips = 1000;
  const snapshot: Snapshot = { game, you: { id: 'alice', host: false, admin: false, dealing: false, legal: null }, joinUrl: 'http://127.0.0.1:3301', joinUrls: [], canUndo: false, serverTime: Date.now() };
  let publish = () => {};
  await page.routeWebSocket('**/ws', socket => { publish = () => socket.send(JSON.stringify({ type: 'state', snapshot })); socket.onMessage(publish); });
  await page.setViewportSize({ width: 390, height: 667 });
  await page.goto('/');
  const timer = page.locator('.player-hand .blind-timer');
  await expect(timer).toContainText('in 3 hands'); await expect(timer).toContainText('Game ends in');
  await expect(page.locator('.player-pot-row')).toBeInViewport({ ratio: 1 });
  game.hand = 3; game.levelStartHand = 3; game.pendingLevel = 2; publish();
  await expect(timer).toContainText('in 1 hand');
  game.hand = 4; game.level = 2; publish();
  await expect(timer).toContainText('Level 2'); await expect(timer).toContainText('in 3 hands');
});

test('in-app notices detect legal actions unlocking for the same actor and do not repeat on snapshots', async ({ page }) => {
  const lobby = createGame(); lobby.players = [createPlayer('alice', 'Alice', 0), createPlayer('bob', 'Bob', 1)];
  const game = startTournament(lobby, lobby.config);
  const snapshot: Snapshot = { game, you: { id: game.actorId!, host: false, admin: false, dealing: true, legal: null }, joinUrl: 'http://127.0.0.1:3301', joinUrls: [], canUndo: false, serverTime: Date.now() };
  let publish = () => {};
  await page.routeWebSocket('**/ws', socket => { publish = () => socket.send(JSON.stringify({ type: 'state', snapshot })); socket.onMessage(publish); });
  await page.goto('/');
  await expect(page.locator('.notice-deal')).toContainText('deal the hole cards');
  await page.getByRole('button', { name: /Dismiss .*deal the hole cards/ }).click();
  game.awaitingDeal = false; snapshot.you.legal = legalActions(game, game.actorId!); publish();
  await expect(page.locator('.notice-turn')).toHaveCount(1);
  await expect(page.locator('.notice-turn')).toContainText('Your turn');
  publish(); await expect(page.locator('.notice-turn')).toHaveCount(1);
  const title = await page.title();
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => page.title()).toBe('Your turn to act');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page).toHaveTitle(title);
  await page.getByRole('button', { name: 'Dismiss Your turn to act', exact: true }).click();
  publish(); await expect(page.locator('.notice-turn')).toHaveCount(0);
  game.players[1].status = 'busted'; game.players[1].stack = 0; game.players[1].bustOrder = 1; publish();
  await expect(page.locator('.notice-bust.notice-urgent')).toContainText('Bob busted · finished #2');
});

for (const verb of ['Raise', 'Bet']) test(`${verb} and activity sheets trap focus, cancel, and close when play advances`, async ({ page }) => {
  const lobby = createGame();
  lobby.players = [createPlayer('alice', 'Alice', 0), createPlayer('bob', 'Bob', 1), createPlayer('cara', 'Cara', 2)];
  const game = startTournament(lobby, lobby.config);
  game.awaitingDeal = false;
  if (verb === 'Bet') {
    game.currentBet = 0;
    game.players.forEach(player => { player.committedThisStreet = 0; });
  }
  game.log = Array.from({ length: 14 }, (_, id) => ({ id, text: `Table event ${id + 1}` }));
  const snapshot: Snapshot = {
    game, you: { id: game.actorId!, host: false, admin: false, dealing: false, legal: legalActions(game, game.actorId!) },
    joinUrl: 'http://127.0.0.1:3301', joinUrls: [], canUndo: false, serverTime: Date.now(),
  };
  const actions: unknown[] = [];
  let publish = () => {};
  await page.routeWebSocket('**/ws', socket => {
    publish = () => socket.send(JSON.stringify({ type: 'state', snapshot }));
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.type === 'action') actions.push(message);
      publish();
    });
  });
  await page.setViewportSize({ width: 390, height: 667 });
  await page.goto('/');
  const opener = page.getByRole('button', { name: `Open ${verb} sizer`, exact: true });
  await expect(page.getByLabel(`${verb} to`, { exact: true })).toHaveCount(0);
  await opener.click();
  const dialog = page.getByRole('dialog'), amount = dialog.getByLabel(`${verb} to`, { exact: true });
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
  const confirm = dialog.getByRole('button', { name: `Confirm ${verb.toLowerCase()}`, exact: true });
  await expect(amount).toBeFocused(); // Decrease is disabled at the minimum.
  await page.keyboard.press('Shift+Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(amount).toBeFocused();
  await dialog.getByRole('button', { name: 'Pot', exact: true }).click();
  await expect(amount).toHaveValue(verb === 'Raise' ? '35' : '15');
  await dialog.getByLabel('Bet size slider').fill('50');
  await expect(amount).toHaveValue('50');
  await expect(dialog.locator('.push-chips')).toContainText('2 × $25');
  if (verb === 'Raise') await page.screenshot({ path: 'test-results/player-raise-sheet.png' });
  await amount.fill('1');
  await expect(confirm).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(actions).toHaveLength(0);
  await opener.click();
  await cancel.click();
  await expect(opener).toBeFocused();
  await opener.click();
  game.revision++;
  publish();
  await expect(dialog).toHaveCount(0);
  await opener.click();
  await expect(amount).toHaveValue(String(snapshot.you.legal!.minRaiseTo));
  await amount.fill('50');
  await confirm.click();
  await expect.poll(() => actions).toEqual([{ type: 'action', action: { type: verb.toLowerCase(), amount: 50 }, revision: game.revision }]);
  await expect(dialog).toHaveCount(0);

  await expect(page.locator('.hand-log-compact li')).toHaveText(['Table event 14', 'Table event 13']);
  const activity = page.getByRole('button', { name: 'Expand table activity' });
  await activity.click();
  await expect(dialog.locator('li')).toHaveCount(12);
  await expect(dialog.locator('li').last()).toHaveText('Table event 3');
  const close = dialog.getByRole('button', { name: 'Close activity' });
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(activity).toBeFocused();
  await activity.click();
  await close.click();
  await expect(dialog).toHaveCount(0);
  await expect(activity).toBeFocused();
  await activity.click();
  game.revision++;
  publish();
  await expect(dialog).toHaveCount(0);
  await expect(activity).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

for (const phase of ['street-break', 'showdown'] as const) for (const sheet of ['activity', 'sizer', 'all-in'] as const) test(`${sheet} yields focus to the ${phase} dealer dialog`, async ({ page }) => {
  const lobby = createGame();
  lobby.players = [createPlayer('alice', 'Alice', 0), createPlayer('bob', 'Bob', 1), createPlayer('cara', 'Cara', 2)];
  const game = startTournament(lobby, lobby.config);
  game.awaitingDeal = false;
  const snapshot: Snapshot = {
    game, you: { id: game.actorId!, host: false, admin: false, dealing: true, legal: legalActions(game, game.actorId!) },
    joinUrl: 'http://127.0.0.1:3301', joinUrls: [], canUndo: false, serverTime: Date.now(),
  };
  let publish = () => {};
  await page.routeWebSocket('**/ws', socket => {
    publish = () => socket.send(JSON.stringify({ type: 'state', snapshot }));
    socket.onMessage(publish);
  });
  await page.setViewportSize({ width: 390, height: 667 });
  await page.goto('/');
  await page.getByRole('button', { name: sheet === 'activity' ? 'Expand table activity' : sheet === 'sizer' ? 'Open Raise sizer' : 'All in', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  game.phase = phase;
  game.pendingStreet = 'flop';
  game.actorId = null;
  game.pots = [{ amount: 15, eligibleIds: game.players.map(player => player.id), awarded: false }];
  game.revision++;
  snapshot.you.legal = null;
  publish();
  const dealer = page.locator('.dealer-overlay');
  await expect(page.locator('.activity-overlay,.sizer-overlay,.confirm-overlay')).toHaveCount(0);
  await expect(dealer.getByRole('heading')).toContainText(phase === 'street-break' ? /Deal the\s*flop/ : 'Main pot');
  const first = dealer.getByRole('button', { name: phase === 'street-break' ? /Cards dealt/ : 'Select winner Alice' });
  await expect(first).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dealer.getByRole('button', { name: phase === 'street-break' ? /Cards dealt/ : 'Select winner Cara' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
});

test('board shows each commitment once and both views preserve all-in status', async ({ page }) => {
  const game = createGame();
  game.phase = 'betting';
  game.players = [createPlayer('alice', 'Alice', 0), createPlayer('bob', 'Bob', 1), createPlayer('cara', 'Cara', 2)];
  game.actorId = 'alice';
  game.players[1].committedThisStreet = 25;
  game.players[2].committedThisStreet = 500;
  game.players[2].status = 'all-in';
  game.players[2].stack = 0;
  const snapshot: Snapshot = {
    game, you: { id: 'alice', host: false, admin: false, dealing: false, legal: null },
    joinUrl: 'http://127.0.0.1:3301', joinUrls: [], canUndo: false, serverTime: Date.now(),
  };
  await page.routeWebSocket('**/ws', socket => socket.onMessage(() => socket.send(JSON.stringify({ type: 'state', snapshot }))));
  await page.goto('/board');
  const bob = page.locator('.seat-card').filter({ has: page.locator('.seat-name', { hasText: 'Bob' }) });
  const cara = page.locator('.seat-card').filter({ has: page.locator('.seat-name', { hasText: 'Cara' }) });
  await expect(bob.locator('.seat-status')).toHaveText('In the hand');
  await expect(bob.locator('.seat-bet')).toHaveText('In front $25');
  await expect(cara.locator('.seat-status')).toHaveText('all in');
  await expect(cara.locator('.seat-bet')).toHaveText('In front $500');
  await page.goto('/');
  await expect(page.locator('.roster-seat').filter({ hasText: 'Bob' }).locator('.roster-state')).toHaveText('In front $25');
  await expect(page.locator('.roster-seat').filter({ hasText: 'Cara' }).locator('.roster-state')).toHaveText('all in');
});

for (const viewport of [{ width: 390, height: 400 }, { width: 844, height: 300 }]) test(`rebuy and controls remain reachable at ${viewport.width}x${viewport.height}, including enlarged text`, async ({ page }) => {
  const game = createGame();
  game.phase = 'hand-complete';
  game.players = [createPlayer('alice', 'Alice', 0, 0), createPlayer('bob', 'Bob', 1), createPlayer('cara', 'Cara', 2)];
  game.players[0].status = 'busted';
  const snapshot: Snapshot = {
    game, you: { id: 'alice', host: false, admin: false, dealing: true, legal: null },
    joinUrl: 'http://127.0.0.1:3301', joinUrls: [], canUndo: false, serverTime: Date.now(),
  };
  const messages: unknown[] = [];
  await page.routeWebSocket('**/ws', socket => socket.onMessage(raw => {
    messages.push(JSON.parse(String(raw)));
    socket.send(JSON.stringify({ type: 'state', snapshot }));
  }));
  await page.setViewportSize(viewport);
  await page.goto('/');
  const actions = page.locator('.player-actions');
  const rebuy = actions.getByRole('button', { name: /Buy back in for/ });
  const shell = page.locator('.player-shell');
  // Scroll the same container a touch user can scroll, without auto-scrolling locators.
  await shell.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(rebuy).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('region', { name: 'Your betting controls' })).toBeInViewport({ ratio: 1 });
  await rebuy.click();
  expect(messages).toContainEqual({ type: 'rebuy' });
  // Double computed text sizes, including the app's explicit px sizes.
  await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>('.player-shell, .player-shell *'));
    const sizes = elements.map(el => parseFloat(getComputedStyle(el).fontSize));
    elements.forEach((el, i) => { el.style.fontSize = `${sizes[i] * 2}px`; });
  });
  const controls = [rebuy, actions.getByRole('button', { name: /Deal next hand/ }), actions.getByRole('button', { name: /Open .* sizer/ })];
  for (const control of controls) {
    await shell.evaluate((el, label) => {
      const button = Array.from(el.querySelectorAll('button')).find(button => (button.getAttribute('aria-label') ?? button.textContent)?.includes(label));
      if (button) el.scrollTop += button.getBoundingClientRect().top - el.getBoundingClientRect().top - 8;
    }, await control.getAttribute('aria-label') ?? await control.innerText());
    await expect(control).toBeInViewport({ ratio: 1 });
  }
  await shell.evaluate(el => { el.scrollTop = 0; });
  await expect(page.locator('.player-header')).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
});

test('winning a pot shows a full-screen celebration only to the winner, ignores rebroadcasts and undo, and is tap-to-dismiss', async ({ page }) => {
  const game = createGame();
  game.phase = 'showdown'; game.hand = 1;
  game.players = [createPlayer('alice', 'Alice', 0, 500), createPlayer('bob', 'Bob', 1, 480)];
  game.pots = [{ amount: 20, eligibleIds: ['alice', 'bob'], awarded: false }];
  const snapshot: Snapshot = {
    game, you: { id: 'alice', host: false, admin: false, dealing: false, legal: null },
    joinUrl: 'http://127.0.0.1:3301', joinUrls: [], canUndo: true, serverTime: Date.now(),
  };
  let publish = () => {};
  await page.routeWebSocket('**/ws', socket => { publish = () => socket.send(JSON.stringify({ type: 'state', snapshot })); socket.onMessage(publish); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const celebration = page.locator('.win-celebration');
  await expect(page.locator('.player-header')).toContainText('Hand 1');
  await expect(celebration).toHaveCount(0);

  // Award the pot to Alice.
  game.pots[0] = { ...game.pots[0], awarded: true, winnerIds: ['alice'] };
  game.players[0].stack = 520;
  publish();
  await expect(celebration).toBeVisible();
  await expect(celebration).toContainText('You won $20');
  const src = await celebration.locator('img').getAttribute('src');
  expect(src).toBeTruthy();

  // The server rebroadcasts the same snapshot every second; it must not retrigger or reshuffle the image.
  publish();
  await expect(celebration).toBeVisible();
  expect(await celebration.locator('img').getAttribute('src')).toBe(src);

  // Tap anywhere to dismiss.
  await celebration.click();
  await expect(celebration).toHaveCount(0);

  // Undo (awarded → unawarded) must not show a celebration; a fresh award fires again.
  game.pots[0] = { ...game.pots[0], awarded: false, winnerIds: undefined };
  game.players[0].stack = 500;
  publish();
  await expect(page.locator('.your-stack-balance strong')).toHaveText('$500'); // Let the undo frame commit before re-awarding, or React may batch the two and skip the edge.
  await expect(celebration).toHaveCount(0);
  game.pots[0] = { ...game.pots[0], awarded: true, winnerIds: ['alice'] };
  game.players[0].stack = 520;
  publish();
  await expect(celebration).toBeVisible();

  // An eligible player who did NOT win never shows a celebration for someone else's win.
  game.hand = 2;
  game.pots = [{ amount: 25, eligibleIds: ['alice', 'bob'], awarded: false }];
  snapshot.you = { id: 'bob', host: false, admin: false, dealing: false, legal: null };
  await page.goto('/'); // Fresh load establishes bob's baseline at the unawarded pot.
  await expect(page.locator('.player-header')).toContainText('Hand 2');
  game.pots[0] = { ...game.pots[0], awarded: true, winnerIds: ['alice'] };
  game.players[1].stack = 475;
  publish();
  await expect(page.locator('.your-stack-balance strong')).toHaveText('$475');
  await expect(celebration).toHaveCount(0);

  // A new award edge for the same viewer proves the socket and detector are active.
  game.pots[0] = { ...game.pots[0], awarded: false, winnerIds: undefined };
  publish();
  await expect(page.locator('.dealer-overlay')).toBeVisible();
  game.pots[0] = { ...game.pots[0], awarded: true, winnerIds: ['bob'] };
  publish();
  await expect(celebration).toContainText('You won $25');
});

test('an uncontested win (pots array replaced wholesale) and a split pot both trigger the celebration correctly', async ({ page }) => {
  const game = createGame();
  game.phase = 'showdown'; game.hand = 1;
  game.players = [createPlayer('alice', 'Alice', 0, 480), createPlayer('bob', 'Bob', 1, 500), createPlayer('cara', 'Cara', 2, 500)];
  game.pots = [{ amount: 20, eligibleIds: ['alice', 'bob'], awarded: false }, { amount: 15, eligibleIds: ['alice'], awarded: false }];
  const snapshot: Snapshot = {
    game, you: { id: 'bob', host: false, admin: false, dealing: false, legal: null },
    joinUrl: 'http://127.0.0.1:3301', joinUrls: [], canUndo: false, serverTime: Date.now(),
  };
  let publish = () => {};
  await page.routeWebSocket('**/ws', socket => { publish = () => socket.send(JSON.stringify({ type: 'state', snapshot })); socket.onMessage(publish); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const celebration = page.locator('.win-celebration');
  await expect(page.locator('.player-header')).toContainText('Hand 1'); // Let the initial join/state exchange settle before mutating.

  // Uncontested win: betting.ts replaces the whole pots array in one update rather than mutating an entry.
  game.pots = [{ amount: 35, eligibleIds: ['bob'], awarded: true, winnerIds: ['bob'] }];
  game.players[1].stack = 535;
  publish();
  await expect(celebration).toContainText('You won $35');
  await celebration.click();

  // A split pot reports the chips this winner actually receives.
  game.hand = 2;
  game.pots = [{ amount: 40, eligibleIds: ['bob', 'cara'], awarded: false }];
  publish();
  await expect(page.locator('.player-header')).toContainText('Hand 2'); // Let this frame commit before the next publish, or React may batch the two and skip the edge.
  await expect(celebration).toHaveCount(0);
  game.pots[0] = { ...game.pots[0], awarded: true, winnerIds: ['bob', 'cara'] };
  publish();
  await expect(celebration).toContainText('You won $20!');
});

test('winning the final pot of the tournament still shows the celebration on the game-over screen', async ({ page }) => {
  const game = createGame();
  game.phase = 'tournament-over'; game.hand = 5;
  game.players = [createPlayer('alice', 'Alice', 0, 1000), createPlayer('bob', 'Bob', 1, 0)];
  game.players[1].status = 'busted'; game.players[1].bustOrder = 1;
  game.pots = [{ amount: 40, eligibleIds: ['alice', 'bob'], awarded: false }];
  const snapshot: Snapshot = {
    game, you: { id: 'alice', host: false, admin: false, dealing: false, legal: null },
    joinUrl: 'http://127.0.0.1:3301', joinUrls: [], canUndo: true, serverTime: Date.now(),
  };
  let publish = () => {};
  await page.routeWebSocket('**/ws', socket => { publish = () => socket.send(JSON.stringify({ type: 'state', snapshot })); socket.onMessage(publish); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.game-over')).toBeVisible();
  game.pots[0] = { ...game.pots[0], awarded: true, winnerIds: ['alice'] };
  game.players[0].stack = 1040;
  publish();
  await expect(page.locator('.win-celebration')).toContainText('You won $40');
});

async function celebrationTable(page: Page, dealing = false, amounts = [100, 40]) {
  const game = createGame();
  game.phase = 'showdown'; game.hand = 1; game.button = 0;
  game.config.denominations = [{ value: 5, color: '#fff' }];
  game.players = [createPlayer('alice', 'Alice', 0, 500), createPlayer('bob', 'Bob', 1, 500)];
  game.pots = amounts.map(amount => ({ amount, eligibleIds: ['alice', 'bob'], awarded: false }));
  const snapshot: Snapshot = {
    game, you: { id: 'alice', host: false, admin: false, dealing, legal: null },
    joinUrl: 'http://127.0.0.1:3301', joinUrls: [], canUndo: true, serverTime: Date.now(),
  };
  let socket: WebSocketRoute;
  const messages: { type: string; potIndex?: number }[] = [];
  await page.routeWebSocket('**/ws', ws => {
    socket = ws;
    ws.onMessage(message => {
      messages.push(JSON.parse(String(message)));
      ws.send(JSON.stringify({ type: 'state', snapshot }));
    });
  });
  await page.goto('/');
  await expect(page.locator('.player-header')).toContainText('Hand 1');
  let update = 0;
  return {
    game, snapshot, messages,
    disconnect: () => socket.close(),
    error: (message: string) => socket.send(JSON.stringify({ type: 'error', message })),
    publish: async () => {
      game.config.name = `Update ${++update}`;
      socket.send(JSON.stringify({ type: 'state', snapshot }));
      // A positive render assertion ensures absence checks observe this update.
      await expect(page.locator('.player-header-name')).toHaveText(game.config.name);
    },
  };
}

test('celebration suppresses reconnect awards and still celebrates the next live win', async ({ page }) => {
  const { game, disconnect, publish } = await celebrationTable(page, false, [100]);
  await disconnect();
  await expect(page.locator('.connection-indicator')).toHaveText('Offline');
  game.pots[0].awarded = true; game.pots[0].winnerIds = ['alice'];
  await expect(page.locator('.connection-indicator')).toHaveText('Live');
  await expect(page.locator('.dealer-overlay')).toHaveCount(0);
  await expect(page.locator('.win-celebration')).toHaveCount(0);
  game.hand++;
  game.pots[0].awarded = false;
  await publish();
  game.pots[0].awarded = true;
  await publish();
  await expect(page.locator('.win-celebration')).toContainText('You won $100!');
});

for (const split of [false, true]) test(`celebration aggregates simultaneous pots with correct ${split ? 'mixed split and odd-chip' : 'sole-winner'} payouts`, async ({ page }) => {
  const { game, publish } = await celebrationTable(page, false, [split ? 105 : 100, 40]);
  game.pots[0].awarded = true; game.pots[0].winnerIds = split ? ['alice', 'bob'] : ['alice'];
  game.pots[1].awarded = true; game.pots[1].winnerIds = ['alice'];
  await publish();
  // Bob is left of the button and receives the odd $5 chip: Alice gets $50 + $40.
  await expect(page.locator('.win-celebration strong')).toHaveText(`You won $${split ? 90 : 140}!`);
});

for (const dealing of [true, false]) test(`celebration waits for all pots on the ${dealing ? 'dealer' : 'waiting player'} screen and traps keyboard focus`, async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01'));
  const { game, messages, publish } = await celebrationTable(page, dealing);
  game.pots[0].awarded = true; game.pots[0].winnerIds = ['alice'];
  await publish();
  const dealer = page.locator('.dealer-overlay');
  await expect(dealer).toContainText('Side pot 1');
  await expect(page.locator('.win-celebration')).toHaveCount(0);
  if (dealing) {
    await dealer.getByRole('button', { name: 'Select winner Alice' }).click();
    await dealer.getByRole('button', { name: /Award pot/ }).click();
    await expect.poll(() => messages.filter(message => message.type === 'awardPot')).toEqual([{ type: 'awardPot', potIndex: 1, winnerIds: ['alice'], revision: 0 }]);
  }
  // Wait longer than the display duration, with the usual socket heartbeats.
  for (let i = 0; i < 4; i++) { await page.clock.runFor(3000); await publish(); }
  game.pots[1].awarded = true; game.pots[1].winnerIds = ['alice'];
  game.phase = 'hand-complete';
  await publish();
  const celebration = page.getByRole('dialog', { name: 'You won $140!' });
  const dismiss = celebration.getByRole('button', { name: 'Dismiss celebration' });
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(dismiss).toBeFocused();
  const controls = celebration.getByRole('button');
  for (let index = 1; index < await controls.count(); index++) {
    await page.keyboard.press('Tab');
    await expect(controls.nth(index)).toBeFocused();
  }
  await page.keyboard.press('Tab');
  await expect(dismiss).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(controls.last()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dismiss).toBeFocused();
  await page.clock.runFor(3400);
  await expect(celebration).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(celebration).toHaveCount(0);
  await publish();
  await expect(celebration).toHaveCount(0);
});

for (const reset of ['undo', 'new hand', 'disconnect'] as const) test(`celebration drops pending wins after ${reset}`, async ({ page }) => {
  const { game, publish, disconnect } = await celebrationTable(page);
  game.pots[0].awarded = true; game.pots[0].winnerIds = ['alice'];
  await publish();
  await expect(page.locator('.win-celebration')).toHaveCount(0);
  if (reset === 'disconnect') {
    await disconnect();
    await expect(page.locator('.connection-indicator')).toHaveText('Offline');
    await expect(page.locator('.connection-indicator')).toHaveText('Live');
  } else {
    if (reset === 'new hand') game.hand++;
    game.pots[0].awarded = false;
    await publish();
    game.pots[0].awarded = true; game.pots[0].winnerIds = ['bob'];
  }
  game.pots[1].awarded = true; game.pots[1].winnerIds = ['bob'];
  await publish();
  await expect(page.locator('.dealer-overlay')).toHaveCount(0);
  await expect(page.locator('.win-celebration')).toHaveCount(0);
});

test('celebration resets a failed image on replacement, restores focus, and expires without replaying', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01'));
  const { game, publish } = await celebrationTable(page, true, [100]);
  game.phase = 'hand-complete';
  await publish();
  const nextHand = page.getByRole('button', { name: 'Deal next hand' });
  await nextHand.focus();
  game.pots[0].awarded = true; game.pots[0].winnerIds = ['alice'];
  await publish();
  const celebration = page.locator('.win-celebration');
  await celebration.locator('img').evaluate(img => img.dispatchEvent(new Event('error')));
  await expect(celebration.locator('img')).toBeHidden();
  game.pots[0].awarded = false;
  await publish();
  game.pots[0].awarded = true;
  await publish();
  await expect(celebration.locator('img')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(celebration).toHaveCount(0);
  await expect(nextHand).toBeFocused();
  game.pots[0].awarded = false;
  await publish();
  game.pots[0].awarded = true;
  await publish();
  for (let i = 0; i < 3; i++) {
    await page.clock.runFor(3000);
    await publish();
    await expect(celebration).toBeVisible();
  }
  await page.clock.runFor(1100);
  await expect(celebration).toHaveCount(0);
  await expect(page.locator('.connection-indicator')).toHaveText('Live');
  await publish();
  await expect(celebration).toHaveCount(0);
});

for (const phase of ['hand-complete', 'tournament-over'] as const) test(`alerts remain above the celebration and accessible in ${phase}`, async ({ page }) => {
  const { game, publish, error } = await celebrationTable(page, false, [100]);
  game.phase = phase;
  game.pots[0].awarded = true; game.pots[0].winnerIds = ['alice'];
  game.players[0].stack = 600;
  game.players[1].stack = 0; game.players[1].status = 'busted'; game.players[1].bustOrder = 1;
  await publish();
  const celebration = page.getByRole('dialog', { name: 'You won $100!' });
  const dismiss = celebration.getByRole('button', { name: 'Dismiss celebration' });
  const toast = celebration.locator('.notice-bust');
  await expect(celebration).toBeVisible();
  await expect(toast).toContainText('Bob busted · finished #2');
  // Visibility alone does not detect a toast hidden behind the backdrop.
  await expect.poll(() => toast.evaluate(el => {
    const box = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  })).toBe(true);
  await page.keyboard.press('Tab');
  await expect(toast.getByRole('button')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(toast).toHaveCount(0);
  await expect(dismiss).toBeFocused();
  await expect(celebration).toBeVisible();

  error('Test table error');
  const banner = celebration.getByRole('alert');
  await expect(banner).toContainText('Test table error');
  await expect.poll(() => banner.evaluate(el => {
    const box = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  })).toBe(true);
  await page.keyboard.press('Tab');
  await expect(banner.getByRole('button')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dismiss).toBeFocused();
  await banner.getByRole('button').click();
  await expect(banner).toHaveCount(0);
  await expect(celebration).toBeVisible();

  // Alerts return to the app when the celebration closes.
  error('Error survives celebration dismissal');
  await expect(banner).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(celebration).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('Error survives celebration dismissal');
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

for (const rollback of ['removed pot', 'unawarded pot', 'different winner'] as const) test(`undo dismisses an active uncontested celebration after ${rollback}`, async ({ page }) => {
  const { game, publish } = await celebrationTable(page, false, []);
  game.phase = 'betting';
  await publish();
  game.phase = 'hand-complete';
  game.pots = [{ amount: 100, eligibleIds: ['alice'], awarded: true, winnerIds: ['alice'] }];
  await publish();
  const celebration = page.locator('.win-celebration');
  await expect(celebration).toContainText('You won $100!');
  game.phase = 'betting';
  if (rollback === 'removed pot') game.pots = [];
  else if (rollback === 'unawarded pot') game.pots[0].awarded = false;
  else game.pots[0].winnerIds = ['bob'];
  await publish();
  await expect(page.locator('.dealer-overlay')).toHaveCount(0);
  await expect(celebration).toHaveCount(0);
  await publish();
  await expect(celebration).toHaveCount(0);
  // A fresh award after the rollback can still celebrate.
  game.pots = [];
  await publish();
  game.phase = 'hand-complete';
  game.pots = [{ amount: 100, eligibleIds: ['alice'], awarded: true, winnerIds: ['alice'] }];
  await publish();
  await expect(celebration).toContainText('You won $100!');
});
