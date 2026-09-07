const { test, expect } = require('@playwright/test');
const { openPad, openMore, act, drawStroke } = require('./support/pad');

// The export is the file a lecturer keeps and mails around, so it must hold the
// ink and little else: an hour of pointer events must not ride along with it.
test('an export carries the ink, not a trace of every pointer event', async ({ page }) => {
  await openPad(page);
  for (let i = 0; i < 4; i++) {
    await drawStroke(page, [[0.2, 0.3 + i * 0.1], [0.5, 0.35 + i * 0.1], [0.8, 0.3 + i * 0.1]], 60);
  }
  await openMore(page);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    act(page, 'download').click()
  ]);
  const body = require('fs').readFileSync(await download.path(), 'utf8');
  const payload = JSON.parse(body);

  expect(Object.keys(payload)).not.toContain('diagnostics');
  const ink = JSON.stringify(payload.ink).length;
  expect(body.length, `export is ${body.length} bytes for ${ink} bytes of ink`)
    .toBeLessThan(ink * 2 + 2000);
});
