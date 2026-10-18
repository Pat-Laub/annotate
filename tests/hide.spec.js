const { test, expect } = require('@playwright/test');
const { openPad, paths, tool, drag } = require('./support/pad');

// A tap on the grip folds the rail down to the grip and the tool in hand, and
// the tool stays in hand; another tap opens it again. A drag still moves it.

const rail = page => page.locator('.ink-panel');
const grip = page => page.locator('.ink-panel .ink-grip');

async function dragGrip(page, dx, dy) {
  const from = await grip(page).boundingBox();
  const x = from.x + from.width / 2, y = from.y + from.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
}

test('a tap on the grip folds the rail and keeps the tool in hand', async ({ page }) => {
  await openPad(page);
  await tool(page, 'pen').click();
  const open = await rail(page).boundingBox();

  await grip(page).click();
  await expect(rail(page)).toHaveClass(/\bink-collapsed\b/);
  const folded = await rail(page).boundingBox();
  expect(folded.height).toBeLessThan(open.height / 3);
  await expect(tool(page, 'highlighter')).toBeHidden();
  await expect(tool(page, 'pen')).toBeVisible();

  await drag(page, [[0.3, 0.45], [0.45, 0.5], [0.6, 0.45]]);
  await expect(paths(page)).toHaveCount(1);

  await grip(page).click();
  await expect(rail(page)).not.toHaveClass(/\bink-collapsed\b/);
  await expect(tool(page, 'highlighter')).toBeVisible();
  await expect(tool(page, 'pen')).toHaveClass(/\bactive\b/);
});

test('a drag on the grip moves the rail, folded or not, without folding it', async ({ page }) => {
  await openPad(page);
  const start = await rail(page).boundingBox();
  await dragGrip(page, -200, 0);
  const moved = await rail(page).boundingBox();
  expect(moved.x).toBeLessThan(start.x - 100);
  await expect(rail(page)).not.toHaveClass(/\bink-collapsed\b/);

  await grip(page).click();
  const folded = await rail(page).boundingBox();
  await dragGrip(page, -200, 0);
  const after = await rail(page).boundingBox();
  expect(after.x).toBeLessThan(folded.x - 100);
  await expect(rail(page)).toHaveClass(/\bink-collapsed\b/);
});

test('a folded rail stays folded after a reload', async ({ page }) => {
  await openPad(page);
  await grip(page).click();
  await expect(rail(page)).toHaveClass(/\bink-collapsed\b/);
  await page.reload();
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
  await expect(rail(page)).toHaveClass(/\bink-collapsed\b/);
});
