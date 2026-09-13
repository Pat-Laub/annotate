const { test, expect } = require('@playwright/test');
const { openPad, paths, drawStroke } = require('./support/pad');

// Overview shows a grid of slides, each with its own small ink copy. The live
// layers draw one slide's strokes over the whole deck, so they have to go --
// and they are children of the stage, which is an *ancestor* of `.reveal`.
test('the live ink layer is hidden in overview', async ({ page }) => {
  await openPad(page);
  await drawStroke(page);
  await expect(paths(page)).toHaveCount(1);

  await page.evaluate(() => Reveal.toggleOverview(true));
  await page.waitForFunction(() => Reveal.isOverview());

  await expect(page.locator('svg.ink-pen')).toBeHidden();
  await expect(page.locator('.ink-guide')).toBeHidden();
  await expect(page.locator('.ink-surface')).toBeHidden();
  await expect(page.locator('.ink-overview-layer.ink-overview-pen path')).toHaveCount(1);
});

// Every preview cell in the grid carries a copy of that slide's ink, and a
// cell is a few hundred pixels wide. Drawing those copies from every sample of
// every stroke is what an iPad runs out of memory over: a page of handwriting
// is megabytes of path data, and the detail is far below what the cell can
// show.
test('overview copies are drawn from simplified ink', async ({ page }) => {
  await openPad(page);
  await drawStroke(page, [[0.30, 0.40], [0.40, 0.52], [0.50, 0.40], [0.60, 0.52]]);

  const live = await page.evaluate(() =>
    document.querySelector('svg.ink-pen path').getAttribute('d').length);

  await page.evaluate(() => Reveal.toggleOverview(true));
  await page.waitForFunction(() => Reveal.isOverview());
  const preview = await page.evaluate(() =>
    document.querySelector('.ink-overview-pen path').getAttribute('d').length);

  expect(preview, 'the preview carries the whole stroke').toBeLessThan(live / 3);
  expect(preview, 'the preview is not a stroke at all').toBeGreaterThan(20);
});
