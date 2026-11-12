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

// A deck set to `print` exports reveal's own print view of itself rather than
// a file published beforehand. The dialog is the browser's, so the tests stand
// in for it and note what the print view held when it was asked to print.
const stubPrint = page => page.addInitScript(() => {
  window.print = () => {
    window.top.printed = (window.top.printed || []).concat({
      pages: document.querySelectorAll('.pdf-page').length,
      inked: document.querySelectorAll('.pdf-page .ink-print.ink-pen path').length,
      ruled: document.querySelectorAll('.pdf-page .ink-print-rules').length
    });
  };
});
const usePrint = page => page.evaluate(() => {
  Reveal.configure({ annotate: Object.assign({}, Reveal.getConfig().annotate, { pdf: 'print' }) });
});
const receive = (page, content, local) => page.evaluate(([c, l]) => {
  const e = new CustomEvent('received');
  e.content = c;
  e.local = l;
  document.dispatchEvent(e);
}, [content, local]);
const printed = page => page.evaluate(() => window.printed || []);

test('a print export prints the deck with its ink on it', async ({ page }) => {
  await stubPrint(page);
  await openPad(page);
  await usePrint(page);
  await drawStroke(page);
  await openMore(page);
  await act(page, 'pdf').click();

  await expect.poll(() => printed(page), { message: 'nothing was printed' }).toHaveLength(1);
  const [view] = await printed(page);
  expect(view.pages, 'the print view had no pages').toBeGreaterThan(0);
  expect(view.inked, 'the print view had no ink').toBeGreaterThan(0);
  expect(view.ruled, 'the writing guides were printed').toBe(0);
  await expect(page.locator('iframe.ink-export'), 'the print view was left behind').toHaveCount(0);
});

// A viewer keeps no ink in storage, so the print view has to be handed it.
test('a viewer prints the ink it was sent, when the presenter asks', async ({ page }) => {
  await stubPrint(page);
  await openPad(page);
  await drawStroke(page);
  const saved = () => page.evaluate(() =>
    JSON.parse(localStorage.getItem('reveal-ink-v7:' + location.pathname)));
  await expect.poll(saved, { message: 'the stroke was not saved' }).toBeTruthy();
  const stored = await saved();

  await page.goto('/docs/index.html?project');
  await page.locator('.ink-panel').waitFor({ state: 'attached' });
  await page.evaluate(() => localStorage.clear());
  await usePrint(page);
  await receive(page, { a: 'all', ink: stored }, false);

  // The window beside the presenter's is the same device: it leaves it alone.
  await receive(page, { a: 'export' }, true);
  await expect(page.locator('iframe.ink-export')).toHaveCount(0);

  await receive(page, { a: 'export' }, false);
  await expect.poll(() => printed(page), { message: 'nothing was printed' }).toHaveLength(1);
  expect((await printed(page))[0].inked, 'the print view had no ink').toBeGreaterThan(0);
});

// A presenting iPad prints to A4 whatever the page asks for, so the export is
// made on the screen being watched.
test('a presenter hands a print export to the viewer', async ({ page }) => {
  await stubPrint(page);
  await page.addInitScript(() => { window.__multiplex = { role: 'presenter', token: 'test-token' }; });
  await openPad(page);
  await usePrint(page);
  await page.evaluate(() => {
    window.sent = [];
    document.addEventListener('send', e => window.sent.push(e.content));
  });
  await openMore(page);
  await act(page, 'pdf').click();

  expect(await page.evaluate(() => window.sent.filter(m => m.a === 'export')),
    'the viewer was not asked').toHaveLength(1);
  await expect(page.locator('.multiplex-mode', { hasText: 'projected' })).toBeVisible();
  await expect(page.locator('iframe.ink-export')).toHaveCount(0);
  expect(await printed(page)).toHaveLength(0);
});
