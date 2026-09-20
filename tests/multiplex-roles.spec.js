const { test, expect } = require('@playwright/test');

// multiplex.js has two roles -- a presenter drives, an audience follows -- and
// two transports: the relay, and the BroadcastChannel that reaches this
// browser's other windows. The rule is meant to be the same on both, so a
// window being watched never moves the ones beside it.
//
// A second BroadcastChannel object in the same document hears everything the
// deck's own object sends, which is enough to see what a window puts out
// without opening a second window to receive it.

const listen = page => page.evaluate(() => {
  window.channelMessages = [];
  const channel = new BroadcastChannel('reveal-multiplex');
  channel.onmessage = event => {
    if (event.data && !event.data.sync) window.channelMessages.push(event.data);
  };
});

async function open(page, handed) {
  if (handed) await page.addInitScript(given => { window.__multiplex = given; }, handed);
  await page.goto('/docs/no-pages.html');
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
  await listen(page);
}

// Anything the deck posted has arrived by the time a message posted after it
// has, so the negative assertions below need no sleep.
async function settle(page) {
  await page.evaluate(() =>
    new BroadcastChannel('reveal-multiplex').postMessage({ marker: true }));
  await page.waitForFunction(() => window.channelMessages.some(m => m.marker));
  return page.evaluate(() => window.channelMessages.filter(m => !m.marker));
}

async function nextSlide(page) {
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => Reveal.getIndices().h),
    { message: 'the deck did not move' }).toBe(1);
}

test('a plain deck drives the windows beside it', async ({ page }) => {
  await open(page);
  await nextSlide(page);

  const sent = await settle(page);
  expect(sent.length, 'the slide change went nowhere').toBeGreaterThan(0);
  expect(sent[sent.length - 1].state.indexh).toBe(1);
});

// The projector Mac signs in as the audience and follows the relay, but it was
// still driving on the channel: a drag of its own slider, or a stray click,
// went out to every other window of that browser.
test('a relay audience does not drive the windows beside it', async ({ page }) => {
  await open(page, { role: 'audience', token: 'test-token' });
  await nextSlide(page);

  expect(await settle(page), 'the audience view drove the channel').toEqual([]);
});

test('a presenter drives the windows beside it', async ({ page }) => {
  await open(page, { role: 'presenter', token: 'test-token' });
  await nextSlide(page);

  const sent = await settle(page);
  expect(sent.length, 'the slide change went nowhere').toBeGreaterThan(0);
});

// `?project` typed on a deck this device has no credentials for is that same
// follower with nothing to sign in to: a second window of this browser put on a
// projector, where the channel carries everything already.
test('a projected window with no credentials follows the channel without answering it', async ({ page }) => {
  await page.goto('/docs/no-pages.html?project');
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());

  await page.evaluate(() => new BroadcastChannel('reveal-multiplex').postMessage({
    state: { indexh: 1, indexv: 0 }, path: location.pathname
  }));
  await expect.poll(() => page.evaluate(() => Reveal.getIndices().h),
    { message: 'the projected window did not follow' }).toBe(1);

  await listen(page);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => page.evaluate(() => Reveal.getIndices().h)).toBe(0);
  expect(await settle(page), 'the projected window answered back').toEqual([]);
});

/* ------------------------ which mode this window is in ------------------ */
// Annotate and Display are the same deck with the same chrome, and the only
// way to tell them apart is to draw on one. On the iPad that makes a Display
// window indistinguishable from a Pencil that has stopped working, which is
// how a lecture gets spent debugging the wrong thing. Each window says what it
// is as it opens, and then gets out of the way.

async function openProjected(page) {
  await page.goto('/docs/no-pages.html?project');
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
}

const mode = page => page.locator('.multiplex-mode');

test('a projected window says it is only displaying', async ({ page }) => {
  await openProjected(page);

  await expect(mode(page)).toContainText(/display/i);
  await expect(mode(page), 'the caption stayed on the projector').toBeHidden({ timeout: 15_000 });
});

test('a presenting window says it is the one being written on', async ({ page }) => {
  await open(page, { role: 'presenter', token: 'test-token' });

  await expect(mode(page)).toContainText(/annotate/i);
});

test('an ordinary deck says nothing about modes', async ({ page }) => {
  await open(page);

  await expect(mode(page)).toHaveCount(0);
});
