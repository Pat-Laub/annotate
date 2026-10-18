const { test, expect } = require('@playwright/test');
const { openPad, paths, tool, act, openMore, drag } = require('./support/pad');

// The rail can be put out of the way without putting the tool down: the pen
// keeps drawing, and a corner button brings the rail back.
test('hiding the rail keeps the tool in hand', async ({ page }) => {
  await openPad(page);
  await tool(page, 'pen').click();
  await openMore(page);
  await act(page, 'hide').click();
  await expect(page.locator('.ink-panel')).toBeHidden();

  await drag(page, [[0.3, 0.45], [0.45, 0.5], [0.6, 0.45]]);
  await expect(paths(page)).toHaveCount(1);

  await page.locator('.ink-show').click();
  await expect(page.locator('.ink-panel')).toBeVisible();
  await expect(tool(page, 'pen')).toHaveClass(/\bactive\b/);
  await expect(page.locator('.ink-show')).toBeHidden();
});
