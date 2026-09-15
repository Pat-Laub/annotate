const { test, expect } = require('@playwright/test');
const { openPad, paths, tool, act, drag, drawStroke, mod } = require('./support/pad');

// Strokes travel to viewers as they are drawn, but everything the lasso does to
// them afterwards -- move, resize, delete, paste -- and the text tool's boxes
// only reached a viewer that reloaded. Each of these edits ends by restating
// the whole slide, the way an erase or an undo does.

const watch = page => page.evaluate(() => {
  window.inkMessages = [];
  document.addEventListener('send', event => window.inkMessages.push(event.content));
});

const lastAll = page => page.evaluate(() =>
  window.inkMessages.filter(m => m.a === 'all').pop());

async function lassoTheStroke(page) {
  await tool(page, 'select').click();
  await drag(page, [[0.28, 0.36], [0.62, 0.36], [0.62, 0.60], [0.28, 0.60], [0.28, 0.36]]);
  await expect(page.locator('.ink-selection-box')).toBeVisible();
}

test('moving a selection goes out to viewers', async ({ page }) => {
  await openPad(page);
  await drawStroke(page, [[0.35, 0.45], [0.45, 0.5], [0.55, 0.45]]);
  await lassoTheStroke(page);
  await watch(page);

  const before = await page.evaluate(() =>
    document.querySelector('svg.ink-pen path').getBBox().x);
  await drag(page, [[0.45, 0.47], [0.60, 0.47]]);
  const after = await page.evaluate(() =>
    document.querySelector('svg.ink-pen path').getBBox().x);
  expect(after, 'the selection did not move').toBeGreaterThan(before + 10);

  const all = await lastAll(page);
  expect(all, 'the move was not sent').toBeTruthy();
  const sent = Object.keys(all.ink).reduce((n, k) => n + all.ink[k].length, 0);
  expect(sent, 'the moved stroke is missing from what went out').toBe(1);
});

test('resizing a selection goes out to viewers', async ({ page }) => {
  await openPad(page);
  await drawStroke(page, [[0.35, 0.45], [0.45, 0.5], [0.55, 0.45]]);
  await lassoTheStroke(page);
  await watch(page);

  // Drag the selection box's bottom-right handle outwards.
  const box = await page.locator('.ink-selection-box').boundingBox();
  const surface = await page.locator('.ink-surface').boundingBox();
  const fx = (box.x + box.width - surface.x) / surface.width;
  const fy = (box.y + box.height - surface.y) / surface.height;
  await drag(page, [[fx, fy], [fx + 0.12, fy + 0.12]]);

  expect(await lastAll(page), 'the resize was not sent').toBeTruthy();
});

test('deleting a selection goes out to viewers', async ({ page }) => {
  await openPad(page);
  await drawStroke(page, [[0.35, 0.45], [0.45, 0.5], [0.55, 0.45]]);
  await lassoTheStroke(page);
  await watch(page);

  await page.keyboard.press('Delete');
  await expect(paths(page)).toHaveCount(0);

  const all = await lastAll(page);
  expect(all, 'the deletion was not sent').toBeTruthy();
  expect(Object.keys(all.ink), 'the ink went out still holding the deleted stroke').toEqual([]);
});

test('pasting a selection goes out to viewers', async ({ page }) => {
  await openPad(page);
  await drawStroke(page, [[0.35, 0.45], [0.45, 0.5], [0.55, 0.45]]);
  await lassoTheStroke(page);
  await watch(page);

  await page.keyboard.press(`${mod}+c`);
  await page.keyboard.press(`${mod}+v`);
  await expect(paths(page)).toHaveCount(2);

  const all = await lastAll(page);
  expect(all, 'the paste was not sent').toBeTruthy();
  const sent = Object.keys(all.ink).reduce((n, k) => n + all.ink[k].length, 0);
  expect(sent, 'the pasted copy is missing from what went out').toBe(2);
});

test('a committed text box goes out to viewers', async ({ page }) => {
  await openPad(page);
  await watch(page);

  await tool(page, 'text').click();
  const surface = await page.locator('.ink-surface').boundingBox();
  await page.mouse.click(surface.x + surface.width * 0.3, surface.y + surface.height * 0.35);
  const editor = page.locator('.ink-text-editor');
  await expect(editor).toBeVisible();
  await editor.type('Hello viewers');
  await page.keyboard.press(`${mod}+Enter`);
  await expect(editor).toBeHidden();
  await expect(page.locator('svg.ink-layer.ink-text')).toContainText('Hello viewers');

  const all = await lastAll(page);
  expect(all, 'the text box was not sent').toBeTruthy();
  const values = Object.keys(all.ink).reduce(
    (out, k) => out.concat(all.ink[k].map(item => item.v)), []);
  expect(values, 'the text did not go out').toContain('Hello viewers');
});

// Opening the tools is not an edit. It used to restate the whole deck anyway,
// which on a lecture's worth of ink is a megabyte or two down the wire every
// time the pen came out.
test('opening and closing the tools puts nothing on the wire', async ({ page }) => {
  await openPad(page);
  await drawStroke(page, [[0.35, 0.45], [0.45, 0.5], [0.55, 0.45]]);
  await watch(page);

  await page.keyboard.press('d');
  await expect(page.locator('.ink-panel.active')).toHaveCount(0);
  await page.keyboard.press('d');
  await expect(page.locator('.ink-panel.active')).toHaveCount(1);

  expect(await page.evaluate(() => window.inkMessages),
    'toggling the tools sent the deck').toEqual([]);
});
