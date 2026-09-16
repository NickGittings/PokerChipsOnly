import { expect, test, type Browser, type Page } from '@playwright/test';
import type { Snapshot } from '../shared/types';
import { createGame } from '../server/engine/state';

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
