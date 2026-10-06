const { test, expect } = require('@playwright/test');

// The laser is a trail that follows the mouse with no button down and fades
// behind it. It travels like a stroke in progress, so viewers and the recorder
// see it, but it is never ink: nothing of it is saved or exported.

const listen = page => page.evaluate(() => {
  window.channelMessages = [];
  const channel = new BroadcastChannel('reveal-multiplex');
  channel.onmessage = event => {
    if (event.data && event.data.content) window.channelMessages.push(event.data.content);
  };
});

async function open(page, url = '/docs/no-pages.html') {
  await page.goto(url);
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
  await page.locator('.ink-surface').waitFor({ state: 'attached' });
}

async function sweep(page) {
  const box = await page.locator('.reveal .slides').boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 12 });
}

const lit = page => page.locator('.ink-laser path, .ink-laser circle');

test('the laser follows the mouse, goes out on the wire, and fades', async ({ page }) => {
  await open(page);
  await listen(page);
  await page.keyboard.press('t');
  await sweep(page);

  await expect(lit(page).first(), 'no trail was drawn').toBeAttached();
  await expect.poll(() => page.evaluate(() =>
    window.channelMessages.filter(m => m.a === 'laser').length),
    { message: 'the laser was not sent' }).toBeGreaterThan(0);
  await expect(lit(page), 'the trail did not fade').toHaveCount(0, { timeout: 3000 });
});

test('the laser is off until asked for, and goes off again', async ({ page }) => {
  await open(page);
  await listen(page);
  await sweep(page);
  await page.keyboard.press('t');
  await page.keyboard.press('t');
  await sweep(page);

  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.channelMessages.filter(m => m.a === 'laser').length)).toBe(0);
  await expect(lit(page)).toHaveCount(0);
});

test('a window following the channel draws the laser it is sent', async ({ page }) => {
  await open(page, '/docs/no-pages.html?project');
  await page.evaluate(() => {
    new BroadcastChannel('reveal-multiplex').postMessage({
      state: Reveal.getState(), path: location.pathname,
      content: { a: 'laser', p: [[400, 300, 0], [500, 320, 16], [600, 340, 32]] }
    });
  });
  await expect(lit(page).first(), 'the follower drew nothing').toBeAttached();
  await expect(lit(page)).toHaveCount(0, { timeout: 3000 });
});

test('the laser leaves no ink behind', async ({ page }) => {
  await open(page);
  await page.keyboard.press('t');
  await sweep(page);
  await expect(lit(page)).toHaveCount(0, { timeout: 3000 });

  const stored = await page.evaluate(() => Object.keys(localStorage)
    .filter(k => k.startsWith('reveal-ink')).map(k => localStorage.getItem(k)).join(''));
  expect(stored).not.toMatch(/laser/);
  await expect(page.locator('.ink-layer path')).toHaveCount(0);
});

// Separate translucent segments overlap at every joint, and each overlap paints
// twice: the trail came out as a string of beads, one per mouse sample.
test('the trail is drawn as one shape', async ({ page }) => {
  await open(page);
  await page.keyboard.press('t');
  await sweep(page);

  await expect(lit(page).first()).toBeAttached();
  expect(await page.locator('.ink-laser > *').count()).toBe(1);
});

// The pen's stroke width is the laser's, and it travels with the trail so a
// viewer draws it the presenter's width rather than its own.
test('the laser is as wide as the pen, and widens with it', async ({ page }) => {
  await open(page);
  await listen(page);
  await page.keyboard.press('t');

  const sweepWidth = async () => {
    await page.evaluate(() => { window.channelMessages = []; });
    await sweep(page);
    await expect(lit(page).first()).toBeAttached();
    const height = await page.locator('.ink-laser path').evaluate(el => el.getBBox().height);
    const sent = await page.evaluate(() => window.channelMessages.find(m => m.a === 'laser'));
    await expect(lit(page)).toHaveCount(0, { timeout: 3000 });
    return { height, w: sent.w };
  };

  const thin = await sweepWidth();
  expect(thin.w).toBeGreaterThan(0);
  expect(thin.height).toBeLessThanOrEqual(thin.w * 1.2);

  await page.keyboard.press(']');
  const thick = await sweepWidth();
  expect(thick.w).toBeGreaterThan(thin.w);
  expect(thick.height).toBeGreaterThan(thin.height);
});

// L is reveal's vim-style right in the overview, so it must stay navigation.
test('L does not turn the laser on', async ({ page }) => {
  await open(page);
  await listen(page);
  await page.keyboard.press('l');
  await sweep(page);

  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.channelMessages.filter(m => m.a === 'laser').length)).toBe(0);
});
