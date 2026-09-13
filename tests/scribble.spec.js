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
