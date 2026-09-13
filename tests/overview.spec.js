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
