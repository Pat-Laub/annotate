const { test, expect } = require('@playwright/test');
const { openPad, paths, tool, act, openMore, drag, drawStroke, mod } = require('./support/pad');

// These cover the tools that exist only in this fork. ACTL2131's copy of
// annotate.js has pen, highlighter and eraser and nothing else, so every
// assertion here is a feature the unification has to carry across rather than
// quietly drop.

const texts = page => page.locator('svg.ink-pen .ink-text, .ink-layer .ink-text');

test('a text box can be typed and kept', async ({ page }) => {
  await openPad(page);
  await tool(page, 'text').click();

  const box = await page.locator('.ink-surface').boundingBox();
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.35);

  const editor = page.locator('.ink-text-editor');
  await expect(editor).toBeVisible();
  await editor.type('Hello pad');
  await page.keyboard.press(`${mod}+Enter`);
  await expect(editor).toBeHidden();

  await expect(page.locator('svg.ink-layer.ink-text')).toContainText('Hello pad');

  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
  await expect(page.locator('svg.ink-layer.ink-text')).toContainText('Hello pad');
});

test('the lasso selects a stroke and the selection can be moved', async ({ page }) => {
  await openPad(page);
  await drawStroke(page, [[0.35, 0.45], [0.45, 0.5], [0.55, 0.45]]);
  await expect(paths(page)).toHaveCount(1);

  const before = await page.evaluate(() =>
    document.querySelector('svg.ink-pen path').getBBox().x);

  await tool(page, 'select').click();
  // Circle the stroke.
  await drag(page, [[0.28, 0.36], [0.62, 0.36], [0.62, 0.60], [0.28, 0.60], [0.28, 0.36]]);
  await expect(page.locator('.ink-selection-box')).toBeVisible();

  // Drag from inside the selection to move it right.
  await drag(page, [[0.45, 0.47], [0.60, 0.47]]);
  const after = await page.evaluate(() =>
    document.querySelector('svg.ink-pen path').getBBox().x);
  expect(after, 'the selection did not move').toBeGreaterThan(before + 10);
});

test('a selection can be copied and pasted', async ({ page }) => {
  await openPad(page);
  await drawStroke(page, [[0.35, 0.45], [0.45, 0.5], [0.55, 0.45]]);
  await expect(paths(page)).toHaveCount(1);

  await tool(page, 'select').click();
  await drag(page, [[0.28, 0.36], [0.62, 0.36], [0.62, 0.60], [0.28, 0.60], [0.28, 0.36]]);
  await expect(page.locator('.ink-selection-box')).toBeVisible();

  await page.keyboard.press(`${mod}+c`);
  await page.keyboard.press(`${mod}+v`);
  await expect(paths(page)).toHaveCount(2);
});

test('a selection can be deleted', async ({ page }) => {
  await openPad(page);
  await drawStroke(page, [[0.35, 0.45], [0.45, 0.5], [0.55, 0.45]]);
  await tool(page, 'select').click();
  await drag(page, [[0.28, 0.36], [0.62, 0.36], [0.62, 0.60], [0.28, 0.60], [0.28, 0.36]]);
  await expect(page.locator('.ink-selection-box')).toBeVisible();
  await page.keyboard.press('Delete');
  await expect(paths(page)).toHaveCount(0);
});

test('ruled writing guides can be toggled', async ({ page }) => {
  await openPad(page);
  await openMore(page);

  // annotate.js marks the button `active` and hides the guide layer with
  // `ink-rules-hidden`, so assert on both rather than on either alone.
  const state = () => page.evaluate(() => ({
    active: document.querySelector('.ink-panel [data-act="rules"]').classList.contains('active'),
    hidden: !!document.querySelector('.ink-rules-hidden')
  }));

  const before = await state();
  await act(page, 'rules').click();
  const after = await state();

  expect(after.active, 'the guides button did not change state').not.toBe(before.active);
  expect(after.hidden, 'the guide layer did not follow the button').toBe(!after.active);
});

// The selection layer's own box has to match the ink layers', or everything
// drawn in slide coordinates -- the lasso, the selection box, the handles --
// renders scaled and offset from the pointer that drew it.
test('the lasso is drawn under the pointer that draws it', async ({ page }) => {
  await openPad(page);
  await drawStroke(page, [[0.35, 0.45], [0.45, 0.5], [0.55, 0.45]]);

  await tool(page, 'select').click();
  await drag(page, [[0.28, 0.36], [0.62, 0.36], [0.62, 0.60], [0.28, 0.60], [0.28, 0.36]]);
  await expect(page.locator('.ink-selection-box')).toBeVisible();

  const { box, stroke } = await page.evaluate(() => ({
    box: document.querySelector('.ink-selection-box').getBoundingClientRect().toJSON(),
    stroke: document.querySelector('svg.ink-pen path').getBoundingClientRect().toJSON()
  }));
  // The box hugs the stroke it encircles, so the two rectangles sit on top of
  // one another on screen.
  expect(Math.abs(box.x - stroke.x), 'the selection box is not over the stroke').toBeLessThan(40);
  expect(Math.abs(box.y - stroke.y), 'the selection box is not over the stroke').toBeLessThan(40);
  expect(box.width / stroke.width).toBeGreaterThan(0.7);
  expect(box.width / stroke.width).toBeLessThan(1.4);
});

// A lecture deck is driven with an Apple Pencil and no keyboard, so the
// deck-wide clear needs a menu entry of its own rather than ⇧-clicking the
// slide one. The page delete goes the other way: it only works where the pages
// plugin is on, so a deck without it should not show the entry at all.
async function openFixedDeck(page) {
  await page.goto('/docs/no-pages.html');
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
  await page.locator('.ink-surface').waitFor();
}

test('clear this deck takes the ink off every slide', async ({ page }) => {
  await openFixedDeck(page);
  await drawStroke(page, [[0.3, 0.45], [0.5, 0.5]]);
  await expect(paths(page)).toHaveCount(1);

  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => Reveal.getIndices().h)).toBe(1);
  await drawStroke(page, [[0.3, 0.45], [0.5, 0.5]]);
  await expect(paths(page)).toHaveCount(1);

  page.on('dialog', dialog => dialog.accept());
  await openMore(page);
  await act(page, 'clear-deck').click();
  await expect(paths(page)).toHaveCount(0);

  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => page.evaluate(() => Reveal.getIndices().h)).toBe(0);
  await expect(paths(page), 'the first slide kept its ink').toHaveCount(0);
});

test('a deck without page growth hides the page delete', async ({ page }) => {
  await openFixedDeck(page);
  await openMore(page);
  await expect(act(page, 'delete-page')).toBeHidden();
  await expect(act(page, 'clear-deck')).toBeVisible();
});

// option() has no icon fallback the way button() does, so a name missing from
// ICONS interpolates `undefined` into the markup and the label reads
// "undefinedDownload annotated PDF".
test('every menu option draws an icon', async ({ page }) => {
  await openPad(page);
  await openMore(page);
  const bad = await page.$$eval('.ink-more .ink-option', options => options
    .filter(o => !o.querySelector('svg path') || o.textContent.includes('undefined'))
    .map(o => o.dataset.act));
  expect(bad, 'these options have no icon').toEqual([]);
});

// A lecture deck sets its own nib and replay delay in _quarto.yml; the fixture
// carries the same two options ACTL2131 does. Both are only defaults: a width
// or delay already stored from a previous session still wins.
test('a deck can set the starting nib width and replay delay', async ({ page }) => {
  await openFixedDeck(page);
  await tool(page, 'pen').click();
  await expect(page.locator('.ink-nib text')).toHaveText('5.0');
  await openMore(page);
  await expect(page.locator('.ink-delay text')).toHaveText('0 ms');
});
