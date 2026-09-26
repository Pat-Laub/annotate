const { test, expect } = require('@playwright/test');
const { openPad, paths, act } = require('./support/pad');

// The tool rail starts where the deck's `dock` option says, and its grip moves
// it anywhere on the stage: it lies down along the top or bottom, stands up
// beside a side, and what opens beside it opens into the stage.

const rail = page => page.locator('.ink-panel');
const grip = page => page.locator('.ink-panel .ink-grip');

async function boxes(page) {
  return page.evaluate(() => {
    const g = s => {
      const e = document.querySelector(s);
      if (!e || e.hidden) return null;
      const r = e.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
    };
    return { rail: g('.ink-panel'), stage: g('[data-deck-stage]'), more: g('.ink-more') };
  });
}

// Drag the grip, by its middle, to a point given as fractions of the stage.
async function dragGrip(page, [fx, fy]) {
  const from = await grip(page).boundingBox();
  const { stage } = await boxes(page);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(stage.left + stage.w * fx, stage.top + stage.h * fy, { steps: 12 });
  await page.mouse.up();
}

const near = (a, b, slack) => Math.abs(a - b) <= slack;

test('the rail starts standing up on the right, most of the stage tall', async ({ page }) => {
  await openPad(page);
  const { rail: r, stage } = await boxes(page);
  expect(r.h, 'the rail is lying down').toBeGreaterThan(r.w);
  expect(r.h, 'the rail is shorter than three quarters of the stage').toBeGreaterThan(stage.h * 0.74);
  expect(stage.right - r.right, 'the rail is not beside the right edge').toBeLessThan(stage.w * 0.02);
  expect(near((r.top + r.bottom) / 2, (stage.top + stage.bottom) / 2, 2), 'the rail is off centre').toBe(true);
  await expect(rail(page)).toHaveAttribute('data-open', 'left');
});

test('a deck can start the rail along the bottom', async ({ page }) => {
  await page.goto('/docs/docked.html');
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
  await expect(rail(page)).toBeVisible();
  await expect(rail(page)).toHaveClass(/\bink-across\b/);
  const { rail: r, stage } = await boxes(page);
  expect(r.w, 'the rail is standing up').toBeGreaterThan(r.h);
  expect(stage.bottom - r.bottom, 'the rail is not along the bottom').toBeLessThan(stage.h * 0.03);
  await expect(rail(page)).toHaveAttribute('data-open', 'up');
});

test('dragged to the bottom, the rail lies down there and draws nothing', async ({ page }) => {
  await openPad(page);
  await dragGrip(page, [0.4, 0.99]);
  await expect(rail(page)).toHaveClass(/\bink-across\b/);
  const { rail: r, stage } = await boxes(page);
  expect(r.w, 'the rail is still standing up').toBeGreaterThan(r.h);
  expect(r.bottom, 'the rail went off the bottom of the stage').toBeLessThanOrEqual(stage.bottom + 1);
  expect(stage.bottom - r.bottom, 'the rail was not parked on the bottom edge').toBeLessThan(stage.h * 0.03);
  await expect(paths(page), 'dragging the rail drew on the slide').toHaveCount(0);
  await expect(rail(page)).toHaveAttribute('data-open', 'up');

  // What it opens goes above it, on the stage, clear of the rail.
  await act(page, 'more').click();
  await expect(page.locator('.ink-more')).toBeVisible();
  const after = await boxes(page);
  expect(after.more.bottom, 'the tray covers the rail').toBeLessThanOrEqual(after.rail.top);
  expect(after.more.top, 'the tray went off the top').toBeGreaterThanOrEqual(stage.top - 1);
});

test('dragged to the left, the rail stands up there and opens to its right', async ({ page }) => {
  await openPad(page);
  await dragGrip(page, [0.01, 0.2]);
  await expect(rail(page)).not.toHaveClass(/\bink-across\b/);
  await expect(rail(page)).toHaveAttribute('data-open', 'right');
  const { rail: r, stage } = await boxes(page);
  expect(r.left - stage.left, 'the rail was not parked on the left edge').toBeLessThan(stage.w * 0.02);
  expect(r.top, 'the rail went off the top').toBeGreaterThanOrEqual(stage.top - 1);

  await act(page, 'more').click();
  const after = await boxes(page);
  expect(after.more.left, 'the tray covers the rail').toBeGreaterThanOrEqual(after.rail.right);
});

test('the rail can be left anywhere, and is still there after a reload', async ({ page }) => {
  await openPad(page);
  // Nearer a side than the top or bottom, so it stays standing up; a rail that
  // tall has nowhere to go but the middle of the stage's height.
  await dragGrip(page, [0.35, 0.45]);
  await expect(rail(page)).not.toHaveClass(/\bink-across\b/);
  const before = (await boxes(page)).rail;
  const { stage } = await boxes(page);
  expect(before.left - stage.left, 'the rail was parked at an edge').toBeGreaterThan(stage.w * 0.1);
  expect(stage.right - before.right, 'the rail was parked at an edge').toBeGreaterThan(stage.w * 0.1);

  await page.reload();
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
  await expect(rail(page)).toBeVisible();
  const after = (await boxes(page)).rail;
  for (const k of ['left', 'top', 'w', 'h']) {
    expect(near(after[k], before[k], 2), `the rail's ${k} moved on reload`).toBe(true);
  }
});

test('a tap on the grip chooses no tool and moves nothing', async ({ page }) => {
  await openPad(page);
  const before = (await boxes(page)).rail;
  const active = () => page.evaluate(() =>
    document.querySelector('.ink-panel [data-tool].active').dataset.tool);
  const tool = await active();
  await grip(page).click();
  const after = (await boxes(page)).rail;
  expect(near(after.left, before.left, 1) && near(after.top, before.top, 1)).toBe(true);
  expect(await active()).toBe(tool);
  await expect(paths(page)).toHaveCount(0);
});

// A quick finger drag -- by the grip, or a thumb sliding off a button -- is one
// the browser would carry on as a fling, and the next tap then only stops the
// fling: no click, and the tool it was for is never chosen. Touch input needs
// the DevTools protocol, so this is chromium's alone.
test.describe('a tap straight after a flick still chooses the tool', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'drives touch through CDP');
  test.use({ hasTouch: true });

  async function flick(page, from, to) {
    const cdp = await page.context().newCDPSession(page);
    const at = (x, y) => [{ x, y, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(from.x, from.y) });
    for (let i = 1; i <= 15; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: at(from.x + (to.x - from.x) * i / 15, from.y + (to.y - from.y) * i / 15)
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  const inHand = page => page.evaluate(() =>
    document.querySelector('.ink-panel [data-tool].active').dataset.tool);

  test('after dragging the rail by its grip', async ({ page }) => {
    await openPad(page);
    const g = await grip(page).boundingBox();
    const { stage } = await boxes(page);
    await flick(page, { x: g.x + g.width / 2, y: g.y + g.height / 2 },
      { x: stage.left + stage.w * 0.4, y: stage.bottom - 5 });
    await page.locator('.ink-panel [data-tool="highlighter"]').tap();
    expect(await inHand(page)).toBe('highlighter');
  });

  test('after a thumb slides off a button', async ({ page }) => {
    await openPad(page);
    const b = await page.locator('.ink-panel [data-tool="eraser"]').boundingBox();
    await flick(page, { x: b.x + b.width / 2, y: b.y + 10 }, { x: b.x - 300, y: b.y + 250 });
    await page.locator('.ink-panel [data-tool="highlighter"]').tap();
    expect(await inHand(page)).toBe('highlighter');
  });

});

// An Apple Pencil tap is never still: it reports a few moves of a pixel or so
// between touching down and lifting off, where a finger's tap usually reports
// none. WebKit drops the click of a tap whose moves were refused, so the pencil
// could not choose a tool. Chromium clicks regardless, and Playwright cannot
// drive touch in WebKit, so what is checked is whether the moves are refused.
test('the rail leaves a pencil tap\'s jitter alone but refuses a drag', async ({ page }) => {
  await openPad(page);
  const refused = await page.evaluate(() => {
    const b = document.querySelector('.ink-panel [data-tool="highlighter"]');
    const r = b.getBoundingClientRect();
    const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
    const send = (type, dx, dy) => {
      const touch = { identifier: 3, target: b, clientX: x0 + dx, clientY: y0 + dy,
                      touchType: 'stylus', force: 0.3 };
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'changedTouches', { value: [touch] });
      Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [touch] });
      Object.defineProperty(event, 'targetTouches', { value: type === 'touchend' ? [] : [touch] });
      b.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const tap = [];
    send('touchstart', 0, 0);
    tap.push(send('touchmove', 0.5, 0.3), send('touchmove', 1, 1.5), send('touchmove', 2, 1));
    send('touchend', 2, 1);
    send('touchstart', 0, 0);
    const drag = send('touchmove', 40, 30);
    send('touchend', 40, 30);
    return { tap, drag };
  });
  expect(refused.tap).toEqual([false, false, false]);
  expect(refused.drag).toBe(true);
});
