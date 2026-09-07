const { test, expect } = require('@playwright/test');
const { openPad, openMore } = require('./support/pad');

// The pad's chrome is drawn in authored page units on a stage that is scaled to
// the window, so anything sized in `rem`, or in px meant for a browser-sized
// page, comes out a fraction of everything beside it. Quarto's own hamburger is
// the usual casualty: it is a separate fixed element it sizes for a browser.

const spread = xs => Math.max(...xs) - Math.min(...xs);

test('the bottom-left buttons are the same size as each other', async ({ page }) => {
  await openPad(page);
  const drawn = await page.evaluate(() => {
    const marks = ['.slide-menu-button i', '.ink-launchers .ink-toggle svg'];
    return marks.map(sel => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { sel, w: r.width, h: r.height, left: r.left, bottom: r.bottom };
    });
  });
  expect(drawn.every(Boolean), `missing: ${JSON.stringify(drawn)}`).toBe(true);

  // The icons themselves, not the tap targets: a row where one glyph is a
  // fraction of the other reads as broken however big the boxes are. Width
  // only, as ACTL2131's equivalent does -- the hamburger's icon is an inline
  // <i> whose line box is taller than the bars it draws, so its height is not
  // comparable with an svg's and never was.
  expect(spread(drawn.map(d => d.w)), 'the corner icons differ in width').toBeLessThan(12);
  for (const d of drawn) {
    expect(d.w, `${d.sel} has no width`).toBeGreaterThan(20);
  }
});

test('the tool icons are large enough to read', async ({ page }) => {
  await openPad(page);
  const icons = await page.evaluate(() =>
    [...document.querySelectorAll('.ink-panel [data-tool] svg')].map(el => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height };
    }));
  expect(icons.length).toBeGreaterThan(3);
  for (const icon of icons) {
    // At a 1280-wide window the stage scales by about a third; an icon drawn
    // for the unscaled page comes out at about 7px, which is what this catches.
    expect(icon.w, 'a tool icon is too small to read').toBeGreaterThan(14);
    expect(icon.h, 'a tool icon is too small to read').toBeGreaterThan(14);
  }
});

// The options panel is read, not just aimed at: its headings and the width it
// reports have to survive the same scaling the tool icons do.
test('the options panel is large enough to read', async ({ page }) => {
  await openPad(page);
  await openMore(page);
  const text = await page.evaluate(() => {
    const scale = el => {
      const svg = el.ownerSVGElement;
      if (!svg) return 1;
      return svg.getBoundingClientRect().height / svg.viewBox.baseVal.height;
    };
    return [...document.querySelectorAll('.ink-more-title, .ink-nib text')].map(el => ({
      what: el.className.baseVal === undefined ? el.className : 'width readout',
      size: parseFloat(getComputedStyle(el).fontSize) * scale(el)
    }));
  });
  expect(text.length).toBeGreaterThan(2);
  for (const item of text) {
    // Same third-of-the-page scale as the icons above: a heading authored at
    // 36px, or a readout drawn inside a 22px-tall SVG, lands near 12px and 4px.
    expect(item.size, `${item.what} is too small to read`).toBeGreaterThan(14);
  }
});

// C takes the corner buttons away when they are in the way, and puts them back.
// ACTL2131's copy of the engine has this; the shared one needs it before that
// deck can drop its fork, and a multiplexed viewer relies on it to show nothing
// on a projected screen.
test('C hides and shows the corner buttons', async ({ page }) => {
  await openPad(page);
  const row = page.locator('.ink-launchers');
  await expect(row).toBeVisible();

  await page.keyboard.press('c');
  await expect(row).toBeHidden();
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.classList.contains('ink-chrome-off'))).toBe(true);

  await page.keyboard.press('c');
  await expect(row).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.classList.contains('ink-chrome-on'))).toBe(true);
});
