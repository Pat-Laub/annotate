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

// The laser has its own width, not the pen's, and it travels with the trail
// so a viewer draws it the presenter's width rather than its own.
test('the laser is its own width, and the pen does not change it', async ({ page }) => {
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

  const before = await sweepWidth();
  expect(before.w).toBe(15);
  expect(before.height).toBeLessThanOrEqual(before.w * 1.2);

  await page.keyboard.press(']');
  const after = await sweepWidth();
  expect(after.w).toBe(15);
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

const deliver = (page, packets) => page.evaluate(packets => {
  for (const p of packets) {
    const e = new CustomEvent('received');
    e.content = { a: 'laser', w: 15, p: [p] };
    document.dispatchEvent(e);
  }
}, packets);

// A relay stall held a trail back for seconds and then delivered it at once;
// the viewer replayed it at the pen's pace, seconds behind the hand.
test('a trail held up on the wire is dropped, not replayed late', async ({ page }) => {
  await open(page);
  await deliver(page, [[400, 300, 0]]);
  await page.waitForTimeout(1000);
  const burst = [];
  for (let d = 50; d <= 1050; d += 16) burst.push([400 + d / 2, 300, d]);
  await deliver(page, burst);

  await page.waitForTimeout(700);
  expect(await lit(page).count(), 'the late trail was still being replayed').toBe(0);
});

// The first packet of a sweep can be the late one; later ones show it up, and
// the viewer catches up to them rather than staying as far behind as it was.
test('a sweep whose first packet was late catches up', async ({ page }) => {
  await open(page);
  await deliver(page, [[400, 300, 0], [1000, 300, 300]]);
  await page.waitForTimeout(100);

  const right = await page.locator('.ink-laser path').evaluate(el => {
    const b = el.getBBox(); return b.x + b.width;
  });
  expect(right, 'the head was held back').toBeGreaterThan(950);
});

// iPadOS delivers each Apple Pencil move twice, the same event with the same
// timeStamp; drawn twice, the trail doubled back on itself into blotches.
test('a pen move delivered twice is swept once', async ({ page }) => {
  await open(page, '/docs/closed.html');
  await listen(page);
  await page.keyboard.press('t');
  await page.evaluate(() => {
    const move = new PointerEvent('pointermove', {
      bubbles: true, pointerType: 'pen', pointerId: 2, clientX: 400, clientY: 300, pressure: 0.3
    });
    window.dispatchEvent(move);
    window.dispatchEvent(move);
  });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.channelMessages.filter(m => m.a === 'laser').length)).toBe(1);
});

// The laser is also a tool on the rail: what the pen draws with it in hand is
// a trail that fades, not ink, so the Pencil can point without the T key.
test('the laser tool turns a drawn stroke into a trail', async ({ page }) => {
  await open(page);
  await listen(page);
  await page.click('[data-tool=laser]');
  const box = await page.locator('.reveal .slides').boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 12 });
  await page.mouse.up();

  await expect(lit(page).first(), 'no trail was drawn').toBeAttached();
  const sent = await page.evaluate(() => window.channelMessages.map(m => m.a));
  expect(sent).toContain('laser');
  expect(sent).not.toContain('start');
  await expect(page.locator('.ink-layer path')).toHaveCount(0);
  await expect(lit(page), 'the trail did not fade').toHaveCount(0, { timeout: 3000 });
});

// The laser draws in the swatch chosen on the rail, and the colour travels
// with the trail so a viewer shows it the same; picking one keeps the laser.
test('the laser draws in the chosen colour', async ({ page }) => {
  await open(page);
  await listen(page);
  await page.click('[data-tool=laser]');
  await page.click('[data-colour="#2668c7"]');
  await expect(page.locator('[data-tool=laser]')).toHaveClass(/active/);

  const box = await page.locator('.reveal .slides').boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 12 });

  const fill = await page.locator('.ink-laser path').evaluate(el => getComputedStyle(el).fill);
  expect(fill).toBe('rgb(38, 104, 199)');
  const sent = await page.evaluate(() => window.channelMessages.find(m => m.a === 'laser'));
  expect(sent.c).toBe('#2668c7');
  await page.mouse.up();
});

test('a viewer draws the laser in the colour it is sent', async ({ page }) => {
  await open(page, '/docs/no-pages.html?project');
  await deliver(page, [[400, 300, 0], [500, 320, 16]]);
  await page.evaluate(() => {
    const e = new CustomEvent('received');
    e.content = { a: 'laser', w: 15, c: '#0f9d58', p: [[600, 300, 0], [700, 320, 16]] };
    document.dispatchEvent(e);
  });
  await expect.poll(() => page.locator('.ink-laser path')
    .evaluateAll(els => els.map(el => getComputedStyle(el).fill))).toContain('rgb(15, 157, 88)');
});
