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

// The reload above proves the ink comes back; this proves it was written down
// in the packed form rather than as plain JSON. Nothing else fails if the
// packing silently stops happening -- the ink still round-trips, just several
// times larger -- and staying small is the whole reason every sample is kept.
test('ink is stored packed, not as plain JSON points', async ({ page }) => {
  await openPad(page);
  await drawStroke(page);
  await page.waitForTimeout(600);   // the debounced save

  const stored = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('reveal-ink-v7:'));
    return key ? JSON.parse(localStorage.getItem(key)) : null;
  });
  expect(stored, 'nothing was saved under a v7 key').not.toBeNull();

  const strokes = Object.values(stored).flat();
  expect(strokes.length).toBeGreaterThan(0);
  for (const stroke of strokes) {
    expect(typeof stroke.b, 'a stroke was not packed').toBe('string');
    expect(stroke.p, 'a packed stroke still carries plain points').toBeUndefined();
  }
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

// Pointer events for a contact are dispatched before its touch events, so the
// first `pointerdown` of a session used to switch the touch path off for good.
// That assumed every later contact would get a `pointerdown` too. A pencil
// contact that arrives as `touchstart [stylus]` and nothing else -- iPadOS
// while it is cancelling a palm beside it, for one -- then went nowhere: no
// stroke, no diagnostics entry with `handled`, nothing on the wire. The touch
// path has to stay open for a stylus contact no pointer event has claimed.
async function stylusTouches(page, identifier, from, to) {
  return page.evaluate(({ identifier, from, to }) => {
    const surface = document.querySelector('.ink-surface');
    const box = surface.getBoundingClientRect();
    const at = f => [box.left + box.width * f[0], box.top + box.height * f[1]];
    const send = (type, [x, y], last) => {
      const touch = { identifier, target: surface, clientX: x, clientY: y,
                      touchType: 'stylus', force: 0.5 };
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'changedTouches', { value: [touch] });
      Object.defineProperty(event, 'touches', { value: last ? [] : [touch] });
      Object.defineProperty(event, 'targetTouches', { value: last ? [] : [touch] });
      surface.dispatchEvent(event);
    };
    send('touchstart', at(from), false);
    for (let i = 1; i <= 6; i++) {
      send('touchmove', at([from[0] + (to[0] - from[0]) * i / 6,
                            from[1] + (to[1] - from[1]) * i / 6]), false);
    }
    send('touchend', at(to), true);
  }, { identifier, from, to });
}

async function penPointer(page, pointerId, from, to) {
  return page.evaluate(({ pointerId, from, to }) => {
    const surface = document.querySelector('.ink-surface');
    const box = surface.getBoundingClientRect();
    const send = (type, f) => surface.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId, pointerType: 'pen', isPrimary: true,
      pressure: type === 'pointerup' ? 0 : 0.4,
      clientX: box.left + box.width * f[0], clientY: box.top + box.height * f[1]
    }));
    send('pointerdown', from);
    for (let i = 1; i <= 6; i++) {
      send('pointermove', [from[0] + (to[0] - from[0]) * i / 6,
                           from[1] + (to[1] - from[1]) * i / 6]);
    }
    send('pointerup', to);
  }, { pointerId, from, to });
}

test('a stylus contact that arrives only as touch events still draws', async ({ page }) => {
  await page.goto('/docs/no-pages.html');
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
  await page.locator('.ink-surface').waitFor();
  await tool(page, 'pen').click();

  await penPointer(page, 41, [0.2, 0.4], [0.4, 0.4]);
  await expect(paths(page)).toHaveCount(1);

  await stylusTouches(page, 42, [0.2, 0.6], [0.4, 0.6]);
  await expect(paths(page)).toHaveCount(2);
});

// The same contact reported both ways -- pointer events, then its touch events
// with the same id, which is what WebKit does for every pencil stroke -- is
// one stroke, not two.
test('a stylus contact reported as pointer and touch events draws once', async ({ page }) => {
  await page.goto('/docs/no-pages.html');
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
  await page.locator('.ink-surface').waitFor();
  await tool(page, 'pen').click();

  await penPointer(page, 43, [0.2, 0.4], [0.4, 0.4]);
  await stylusTouches(page, 43, [0.2, 0.4], [0.4, 0.4]);
  await expect(paths(page)).toHaveCount(1);
});
