const { test, expect } = require('@playwright/test');
const { openPad, drawStroke } = require('./support/pad');

// localStorage is the buffer between writing a lecture and exporting it, and a
// full one keeps the ink on screen while saving nothing. Silence there is
// indistinguishable from success, so the panel has to say it.
async function refuseInkSaves(page, error) {
  await page.addInitScript(([name, message]) => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (String(key).indexOf('reveal-ink-v7:') === 0) {
        const e = new Error(message);
        e.name = name;
        throw e;
      }
      return setItem.call(this, key, value);
    };
  }, [error, error]);
}

test('a full store says so instead of dropping the ink in silence', async ({ page }) => {
  await refuseInkSaves(page, 'QuotaExceededError');
  await openPad(page);
  await drawStroke(page);
  await expect(page.locator('.ink-warning')).toBeVisible();
});

// A private window, or site data turned off, is not a failure to act on: the
// ink was never going to be kept there and a warning on every save is noise.
test('storage turned off is not warned about', async ({ page }) => {
  await refuseInkSaves(page, 'SecurityError');
  await openPad(page);
  await drawStroke(page);
  await page.waitForTimeout(800);
  await expect(page.locator('.ink-warning')).toBeHidden();
});
