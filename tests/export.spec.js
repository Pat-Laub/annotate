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

// An export is now what happened, not what survived: a stroke that was rubbed
// out is in the file, with what took it and whether that was undone. Without
// it the one thing a misfiring gesture leaves behind is the absence of ink.
test('an export carries what was erased, and what took it', async ({ page }) => {
  await openPad(page);
  await drawStroke(page, [[0.44, 0.34], [0.45, 0.48], [0.46, 0.62]]);
  const scribble = [];
  for (let i = 0; i <= 14; i++) scribble.push([i % 2 ? 0.56 : 0.34, 0.38 + i * 0.012]);
  await drawStroke(page, scribble);
  await openMore(page);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    act(page, 'download').click()
  ]);
  const payload = JSON.parse(require('fs').readFileSync(await download.path(), 'utf8'));

  const gone = Object.values(payload.erased || {}).flat();
  expect(gone.length, 'the erased strokes are not in the export').toBeGreaterThan(0);
  expect(gone.every(s => typeof s.b === 'string'), 'erased ink is not packed like the rest').toBe(true);
  expect(gone.some(s => s.x.r === 'target'), 'what the scribble took is missing').toBe(true);
  expect(gone.some(s => s.x.r === 'gesture'), 'the scribble itself is missing').toBe(true);
  // Thresholds move; a log read next month has to say what judged it.
  expect(payload.scribble.crossings, 'the thresholds in force are not recorded').toBeDefined();
});
