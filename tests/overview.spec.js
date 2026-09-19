const { test, expect } = require('@playwright/test');
const { openPad, paths, tool, drag, drawStroke } = require('./support/pad');

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
  // Sampled the way a pencil samples: hundreds of points over a short line.
  const wiggle = [];
  for (let i = 0; i <= 10; i++) wiggle.push([0.30 + i * 0.03, i % 2 ? 0.52 : 0.40]);
  await tool(page, 'pen').click();
  await drag(page, wiggle, 30);

  const live = await page.evaluate(() =>
    document.querySelector('svg.ink-pen path').getAttribute('d').length);

  await page.evaluate(() => Reveal.toggleOverview(true));
  await page.waitForFunction(() => Reveal.isOverview());
  const preview = await page.evaluate(() =>
    document.querySelector('.ink-overview-pen path').getAttribute('d').length);

  expect(preview, 'the preview carries the whole stroke').toBeLessThan(live / 3);
  expect(preview, 'the preview is not a stroke at all').toBeGreaterThan(20);
});

// The previews hang inside the slide sections, which puts them at the mercy of
// whatever the deck's theme does to a section's children. slide-stage shrinks
// those children to fit its overview card (`section:not(.stack) > *`), which
// took the layers out of absolute positioning: in flow they added their full
// height to the slide, and reveal centres a slide on the content it measures,
// so every heading was pushed up out of its card and the ink landed nowhere
// near the page it was drawn on. The geometry is therefore set inline, which no
// stylesheet can override, on the card box the stage publishes.
test('previews sit on the card and leave the slide where it was', async ({ page }) => {
  await openPad(page);
  await drawStroke(page, [[0.30, 0.40], [0.50, 0.52], [0.60, 0.40]]);

  const heading = () => page.evaluate(() => {
    const slide = Reveal.getSlides().find(s => s.querySelector('h1, h2, h3, p'));
    const box = slide.querySelector('h1, h2, h3, p').getBoundingClientRect();
    return { id: slide.id, top: Math.round(box.top), left: Math.round(box.left) };
  });

  await page.evaluate(() => Reveal.toggleOverview(true));
  await page.waitForFunction(() => Reveal.isOverview());
  const withPreviews = await heading();

  // The same overview with the previews taken away: the slide must not move.
  const without = await page.evaluate(() => {
    document.querySelectorAll('.ink-overview-layer').forEach(el => el.remove());
    Reveal.layout();
    const slide = Reveal.getSlides().find(s => s.querySelector('h1, h2, h3, p'));
    const box = slide.querySelector('h1, h2, h3, p').getBoundingClientRect();
    return { top: Math.round(box.top), left: Math.round(box.left) };
  });

  expect(Math.abs(withPreviews.top - without.top),
    `${withPreviews.id} moves when its ink preview is added`).toBeLessThanOrEqual(1);

  // And the preview covers the card, which is where the authored page goes.
  const fit = await page.evaluate(() => {
    Reveal.toggleOverview(false);
    Reveal.toggleOverview(true);
    const layer = document.querySelector('.ink-overview-layer');
    const slide = layer.closest('section');
    const card = getComputedStyle(slide, '::before');
    const style = layer.style;
    return {
      inline: { position: style.position, left: style.left, top: style.top,
                width: style.width, height: style.height },
      card: { left: card.left, top: card.top, width: card.width, height: card.height },
      computed: getComputedStyle(layer).position
    };
  });

  expect(fit.computed, 'the preview is not out of flow').toBe('absolute');
  for (const edge of ['left', 'top', 'width', 'height']) {
    expect(parseFloat(fit.inline[edge]), `the preview's ${edge} is not the card's`)
      .toBeCloseTo(parseFloat(fit.card[edge]), 1);
  }
});

// Overview puts the tools away for the duration -- the previews are a grid of
// slides, not something to write on -- and coming back out has to restore what
// was in hand rather than assume a pen. A lecture deck opens closed, so `o`
// twice used to hand over a pen nobody asked for; and because the relay
// forwards reveal's own overview events, so did every window following along.
async function roundTrip(page) {
  await page.evaluate(() => Reveal.toggleOverview(true));
  await page.waitForFunction(() => Reveal.isOverview());
  await page.evaluate(() => Reveal.toggleOverview(false));
  await page.waitForFunction(() => !Reveal.isOverview());
}

const panel = page => page.locator('.ink-panel');

test('a deck that opens closed comes back from overview closed', async ({ page }) => {
  await page.goto('/docs/no-pages.html');
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
  await expect(panel(page)).not.toHaveClass(/\bactive\b/);

  await roundTrip(page);
  await expect(panel(page)).not.toHaveClass(/\bactive\b/);

  // And a deck that had the tools out keeps them: the trip restores what it
  // took, in either direction.
  await page.keyboard.press('d');
  await expect(panel(page)).toHaveClass(/\bactive\b/);
  await roundTrip(page);
  await expect(panel(page)).toHaveClass(/\bactive\b/);
});

test('the pad comes back from overview with its tools still in hand', async ({ page }) => {
  await openPad(page);
  await expect(panel(page)).toHaveClass(/\bactive\b/);
  await roundTrip(page);
  await expect(panel(page)).toHaveClass(/\bactive\b/);
});
