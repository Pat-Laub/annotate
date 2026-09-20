const { test, expect } = require('@playwright/test');
const { openPad, tool, drag, drawStroke } = require('./support/pad');

// Sweeping back and forth over the same ink, barely advancing -- a scribble.
// Long enough that the trail freezes several chunks while the gesture is armed.
const SCRIBBLE = [];
for (let i = 0; i <= 14; i++) SCRIBBLE.push([i % 2 ? 0.56 : 0.34, 0.38 + i * 0.012]);

// The stroke it goes over: upright, so every sweep crosses it.
const TARGET = [[0.44, 0.34], [0.45, 0.48], [0.46, 0.62]];

async function scribbleOverAStroke(page) {
  await drawStroke(page, TARGET);
  await tool(page, 'pen').click();
  await drag(page, SCRIBBLE, 30);
}

test('every part of an armed scribble stays faded', async ({ page }) => {
  await openPad(page);
  await drawStroke(page, TARGET);

  // Draw the scribble without letting go, so the fading can be looked at while
  // the gesture is still live.
  const box = await page.locator('.ink-surface').boundingBox();
  const at = ([x, y]) => ({ x: box.x + box.width * x, y: box.y + box.height * y });
  const first = at(SCRIBBLE[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of SCRIBBLE.slice(1)) {
    const next = at(p);
    await page.mouse.move(next.x, next.y, { steps: 30 });
  }

  const state = await page.evaluate(() => {
    const paths = [...document.querySelectorAll('svg.ink-pen path')];
    return {
      pieces: paths.length,
      faded: paths.filter(el => el.classList.contains('ink-fading')).length
    };
  });
  await page.mouse.up();

  expect(state.pieces, 'the trail never froze a chunk').toBeGreaterThan(2);
  expect(state.faded, 'a frozen chunk of the armed scribble is not faded')
    .toBe(state.pieces);
});

// The presenter fades what a scribble is about to take before it takes it. A
// viewer that is only told about the deletion sees the ink vanish with no
// warning; it should fade there too.
test('a viewer is told what a scribble has marked', async ({ page }) => {
  await openPad(page);
  await page.evaluate(() => {
    window.inkMessages = [];
    document.addEventListener('send', event => window.inkMessages.push(event.content));
  });
  await scribbleOverAStroke(page);

  const marks = await page.evaluate(() =>
    window.inkMessages.filter(m => m.a === 'mark'));
  expect(marks.length, 'no mark was broadcast').toBeGreaterThan(0);
  expect(marks[0].m.length, 'the mark names no strokes').toBeGreaterThan(0);
});

test('a viewer fades the ink a scribble has marked', async ({ page }) => {
  await openPad(page);
  await page.evaluate(() => {
    window.inkMessages = [];
    document.addEventListener('send', event => window.inkMessages.push(event.content));
  });
  await scribbleOverAStroke(page);

  // Replay the presenter's traffic into a fresh pad, stopping at the mark: the
  // erase itself rides on the `all` that follows.
  const faded = await page.evaluate(async () => {
    const messages = window.inkMessages.slice();
    const upto = messages.findIndex(m => m.a === 'mark');
    localStorage.clear();
    const play = msg => {
      const e = new CustomEvent('received');
      e.content = msg;
      e.local = true;
      document.dispatchEvent(e);
    };
    play({ a: 'all', ink: {} });
    for (const msg of messages.slice(0, upto + 1)) play(msg);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return document.querySelectorAll('svg.ink-pen path.ink-fading').length;
  });
  expect(faded, 'the viewer shows no ink fading').toBeGreaterThan(0);
});

// A capital B, captured from an Apple Pencil on an iPad (module-1-2, iPadOS 27)
// with tests/support/probe-scribble.js in ACTL2131. Written the way it is
// written by hand: the spine first, then both bowls in one stroke, simplified
// with the same RDP tolerance the detector applies.
//
// The bowls meet the spine at the top, the waist and the foot, and each bowl
// doubles back along the letter's long axis -- reversals 4, bounding-box
// overlap 1.00, 3 crossings against a single stroke. All three thresholds are
// cleared, so the gesture arms and takes the spine. Six of six were erased on
// the iPad.
//
// Scaled 3x about its centre. `travel` is 10 slide units, and this deck's
// canvas is reveal's default 960x700 against the lecture deck's 3744x2106:
// at the size it was actually written the letter is 32x53 units here and its
// doubling back falls under `travel`, which is not the bug. At 3x it is
// 80x151, close to the 93x144 it occupied on the iPad.
const B_SPINE = [
  [0.4299, 0.0727], [0.4332, 0.0688], [0.4332, 0.2191]
];
const B_BOWLS = [
  [0.4113, 0.1234], [0.4014, 0.1507], [0.4047, 0.1312], [0.4344, 0.0745],
  [0.4488, 0.0532], [0.4629, 0.0394], [0.4719, 0.0355], [0.4761, 0.0394],
  [0.4752, 0.061], [0.4596, 0.1039], [0.4344, 0.1468], [0.4146, 0.1645],
  [0.4233, 0.1663], [0.4497, 0.1507], [0.4662, 0.1489], [0.4719, 0.1528],
  [0.4761, 0.1624], [0.4728, 0.1897], [0.4674, 0.2053], [0.4521, 0.2308],
  [0.4365, 0.2404], [0.4311, 0.2404], [0.4257, 0.2326]
];

test('a handwritten B does not scribble out its own spine', async ({ page }) => {
  await openPad(page);
  await page.evaluate(() => {
    window.inkMessages = [];
    document.addEventListener('send', event => window.inkMessages.push(event.content));
  });

  await drawStroke(page, B_SPINE);
  await tool(page, 'pen').click();
  await drag(page, B_BOWLS, 4);

  const marks = await page.evaluate(() =>
    window.inkMessages.filter(m => m.a === 'mark'));
  expect(marks.length, 'writing a B armed the scribble gesture').toBe(0);
});
