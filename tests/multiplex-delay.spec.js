const { test, expect } = require('@playwright/test');
const { openPad, act, openMore } = require('./support/pad');

const readout = page => page.locator('.ink-delay text');

test('the presenter steps the replay delay and tells viewers', async ({ page }) => {
  await openPad(page);
  await page.evaluate(() => {
    window.inkMessages = [];
    document.addEventListener('send', event => window.inkMessages.push(event.content));
  });
  await openMore(page);
  await expect(readout(page)).toHaveText('20 ms');

  await act(page, 'delay-less').click();
  await expect(readout(page)).toHaveText('10 ms');
  await act(page, 'delay-less').click();
  await expect(readout(page)).toHaveText('0 ms');
  await expect(act(page, 'delay-less')).toBeDisabled();

  const sent = await page.evaluate(() => window.inkMessages.filter(m => m.a === 'delay'));
  expect(sent.map(m => m.d), 'the setting did not go out').toEqual([10, 0]);
});

test('a viewer takes the delay it is told', async ({ page }) => {
  await openPad(page);
  await openMore(page);
  await page.evaluate(() => {
    const e = new CustomEvent('received');
    e.content = { a: 'delay', d: 80 };
    document.dispatchEvent(e);
  });
  await expect(readout(page)).toHaveText('80 ms');
});

test('a joining viewer is told the delay with the ink', async ({ page }) => {
  await openPad(page);
  await page.evaluate(() => {
    window.inkMessages = [];
    document.addEventListener('send', event => window.inkMessages.push(event.content));
  });
  await openMore(page);
  await act(page, 'delay-more').click();

  const all = await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('welcome'));
    return window.inkMessages.filter(m => m.a === 'all').pop();
  });
  expect(all && all.d, 'the ink went out without the delay').toBe(40);
});
