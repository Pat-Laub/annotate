const { test, expect } = require('@playwright/test');
const { openPad, paths, tool, drawStroke } = require('./support/pad');

test('the pad opens ready to draw', async ({ page }) => {
  const failures = [];
  page.on('pageerror', e => failures.push(e.message));
  await openPad(page);
  await expect(page.locator('.ink-panel')).toBeVisible();
  await expect(page.locator('svg.ink-pen')).toBeAttached();
  expect(failures, failures.join('\n')).toEqual([]);
});

test('a stroke is drawn and survives a reload', async ({ page }) => {
  await openPad(page);
  await drawStroke(page);
  await expect(paths(page)).toHaveCount(1);

  await page.waitForTimeout(600);   // the debounced save
  await page.reload();
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
  await expect(paths(page)).toHaveCount(1);
});

test('changing the next-stroke width does not broadcast the whole ink state', async ({ page }) => {
  await openPad(page);
  await page.evaluate(() => {
    window.inkMessages = [];
    document.addEventListener('send', event => window.inkMessages.push(event.content));
  });
  await page.keyboard.press(']');
  expect(await page.evaluate(() => window.inkMessages)).toEqual([]);
});

test('undo removes the last stroke', async ({ page }) => {
  const { mod } = require('./support/pad');
  await openPad(page);
  await drawStroke(page, [[0.2, 0.4], [0.4, 0.4]]);
  await drawStroke(page, [[0.2, 0.6], [0.4, 0.6]]);
  await expect(paths(page)).toHaveCount(2);
  await page.keyboard.press(`${mod}+z`);
  await expect(paths(page)).toHaveCount(1);
});

// The panel and the corner buttons are children of the stage, which is
// transformed. `position: fixed` inside a transformed ancestor resolves against
// that ancestor, not the viewport, so authored-unit offsets silently put the
// chrome off the bottom of the screen -- and chromium's auto-scrolling click
// still finds it, so only firefox failed and only because a drag followed.
// Assert the geometry directly instead.
test('the tool panel and corner buttons are on screen', async ({ page }) => {
  await openPad(page);
  const boxes = await page.evaluate(() => {
    const g = s => { const e = document.querySelector(s); if (!e) return null;
      const r = e.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height }; };
    return { panel: g('.ink-panel'), launchers: g('.deck-launchers'),
             viewport: { w: window.innerWidth, h: window.innerHeight } };
  });

  for (const [name, box] of [['panel', boxes.panel], ['launchers', boxes.launchers]]) {
    expect(box, `${name} is missing`).not.toBeNull();
    expect(box.w, `${name} has no width`).toBeGreaterThan(0);
    expect(box.h, `${name} has no height`).toBeGreaterThan(0);
    expect(box.left, `${name} is off the left edge`).toBeGreaterThanOrEqual(-1);
    expect(box.top, `${name} is off the top edge`).toBeGreaterThanOrEqual(-1);
    expect(box.right, `${name} is off the right edge`).toBeLessThanOrEqual(boxes.viewport.w + 1);
    expect(box.bottom, `${name} is off the bottom edge`).toBeLessThanOrEqual(boxes.viewport.h + 1);
  }
});

// The ink surface hangs off the stage, which is reveal's parent, so a gesture
// that lands on it never reaches reveal's swipe listeners on `.reveal`. Once a
// pencil has been used a finger is a page turn, not ink, and turning the page
// that way has to keep working with a tool in hand.
test('a finger swipe turns the page with a tool in hand', async ({ page }) => {
  await page.goto('/docs/no-pages.html');
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
  await page.locator('.ink-surface').waitFor();
  await tool(page, 'pen').click();

  const forwarded = await page.evaluate(() => {
    const surface = document.querySelector('.ink-surface');
    const box = surface.getBoundingClientRect();
    const y = box.top + box.height / 2;
    const send = (type, at, pointerType, pointerId) => surface.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId, pointerType, isPrimary: true,
        clientX: box.left + box.width * at, clientY: y
      }));
    // The copy handed to reveal is dispatched inside the window capture that
    // made it, so an untagged forward forwards itself: count what arrives.
    let seen = 0;
    const reveal = document.querySelector('.reveal');
    ['pointerdown', 'pointermove', 'pointerup'].forEach(
      type => reveal.addEventListener(type, () => { seen++; }, false));

    // A pencil contact first: until one arrives a finger is a drawing tip.
    send('pointerdown', 0.5, 'pen', 1);
    send('pointerup', 0.5, 'pen', 1);
    send('pointerdown', 0.8, 'touch', 2);
    for (let i = 1; i <= 10; i++) send('pointermove', 0.8 - i * 0.05, 'touch', 2);
    send('pointerup', 0.3, 'touch', 2);
    return seen;
  });

  // One copy per contact: down, ten moves, up.
  expect(forwarded, 'the forwarded gesture was re-forwarded').toBe(12);

  await expect.poll(() => page.evaluate(() => Reveal.getIndices().h),
    { message: 'the swipe did not turn the page' }).toBe(1);
});

// iPadOS decides for itself what a contact dragging down the page means --
// scroll it, or leave element fullscreen -- and the only thing that stops it is
// the touch events being refused. That refusal is what this pins: a pencil
// drawing a downstroke must have every event of the stream prevented, in a
// headless browser as on the deck's own hardware.
//
// It does not reproduce the iPad gesture itself, which no desktop browser has.
test('a pencil downstroke refuses the browser its own gesture', async ({ page }) => {
  await page.goto('/docs/no-pages.html');
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
  await page.locator('.ink-surface').waitFor();
  await tool(page, 'pen').click();

  const stream = await page.evaluate(() => {
    const surface = document.querySelector('.ink-surface');
    const box = surface.getBoundingClientRect();
    const x = box.left + box.width / 2;
    // A touch stream built by hand. Desktop WebKit and firefox have no Touch
    // or TouchEvent constructor -- the engines the iPad runs and the deck is
    // tested on -- so the fields the plugin actually reads are hung off a
    // plain Event, which still reports defaultPrevented for real.
    const send = (type, y, last) => {
      const touch = { identifier: 7, target: surface, clientX: x, clientY: y,
                      touchType: 'stylus', force: 0.5 };
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'changedTouches', { value: [touch] });
      Object.defineProperty(event, 'touches', { value: last ? [] : [touch] });
      Object.defineProperty(event, 'targetTouches', { value: last ? [] : [touch] });
      surface.dispatchEvent(event);
      return { type, prevented: event.defaultPrevented };
    };
    // The letter l: straight down the middle of the slide.
    const top = box.top + box.height * 0.25;
    const events = [send('touchstart', top, false)];
    for (let i = 1; i <= 6; i++) events.push(send('touchmove', top + i * box.height * 0.07, false));
    events.push(send('touchend', top + box.height * 0.42, true));
    return events;
  });

  expect(stream.length).toBe(8);
  const escaped = stream.filter(e => !e.prevented);
  expect(escaped, `${escaped.map(e => e.type)} reached the browser unrefused`).toEqual([]);
});
