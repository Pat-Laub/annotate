const { test, expect } = require('@playwright/test');
const { tool } = require('./support/pad');

// What a tool in hand may take, and what it has to leave to whatever is under
// the tip.
//
// The surface covers the whole stage and the input handlers capture on
// `window`, so with a tool out every contact anywhere on the page arrives here
// first. `ours()` decides whether to keep it. It used to decide by matching the
// target against a written-down list of class names -- the deck's own chrome,
// enumerated -- which means anything not on the list is slide content by
// default, and a control that arrives later is drawn over rather than worked.
//
// Two things were: a panel some other extension puts over the deck (slide-stage
// draws its overview grid this way, outside `.reveal` entirely), and a control
// inside a slide. Both are covered here because they fail for one reason and a
// fix that only knows about one of them is a list with an extra name on it.

const penPaths = page => page.locator('svg.ink-pen path');

// A tap at a point, the way a pencil lands on the glass, rather than on an
// element: playwright's own click first waits for the target to be what is
// under the cursor, and the surface lying over everything is the thing being
// tested, so the wait would swallow the failure.
async function tap(page, locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('nothing to tap');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function openDeck(page, deck) {
  await page.goto(`/docs/${deck}.html`);
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
  await page.locator('.ink-surface').waitFor();
}

// `controls.qmd` opens with the tools put away, as a lecture deck does.
async function takeThePen(page) {
  await page.locator('.ink-toggle').click();
  await tool(page, 'pen').click();
  await expect(page.locator('.ink-surface')).toHaveClass(/drawing/);
}

test.describe('a tool in hand leaves live controls alone', () => {
  test('dragging a slide\'s slider moves it instead of drawing on it', async ({ page }) => {
    await openDeck(page, 'controls');
    await takeThePen(page);

    const range = page.locator('.fixture-range');
    const box = await range.boundingBox();
    if (!box) throw new Error('the fixture range is not visible');

    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.15, y);
    await page.mouse.down();
    for (let f = 0.2; f <= 0.85; f += 0.05) {
      await page.mouse.move(box.x + box.width * f, y, { steps: 4 });
    }
    await page.mouse.up();

    // The slider is what the drag was for. Drawing over it instead leaves the
    // value where it was and a stroke across the slide -- which is what the
    // lecture sees: the sweep will not sweep, and the slide gains a line.
    await expect(range, 'the drag never reached the slider').not.toHaveValue('40');
    await expect(penPaths(page), 'the drag was taken as ink').toHaveCount(0);
  });

  test('clicking a slide\'s button presses it instead of drawing on it', async ({ page }) => {
    await openDeck(page, 'controls');
    await takeThePen(page);

    await page.evaluate(() => {
      window.__pressed = 0;
      document.querySelector('.fixture-button')
        .addEventListener('click', () => { window.__pressed++; });
    });
    await tap(page, page.locator('.fixture-button'));

    expect(await page.evaluate(() => window.__pressed),
      'the button never saw the click').toBe(1);
    await expect(penPaths(page), 'the click was taken as ink').toHaveCount(0);
  });
});

// slide-stage's overview grid is a panel appended beside the stage, outside
// `.reveal` and so outside anything the deck calls a slide. Nothing about it is
// annotate's to know, which is the point: a panel put over the deck by someone
// else has to work without annotate having been told its name. Modelled here
// rather than imported, because the grid only builds on a deck rendered with
// baked previews and the fixtures have none.
async function coverTheDeck(page) {
  await page.evaluate(() => {
    const stage = document.querySelector('[data-deck-stage]');
    const panel = document.createElement('div');
    panel.className = 'fixture-panel';
    panel.style.cssText =
      'position:absolute;inset:0;z-index:40;background:#e8e9e9';
    const shut = document.createElement('button');
    shut.className = 'fixture-panel-close';
    shut.textContent = 'Close';
    shut.style.cssText =
      'position:absolute;left:40%;top:45%;width:20%;height:10%';
    shut.addEventListener('click', () => panel.remove());
    panel.appendChild(shut);
    stage.parentElement.appendChild(panel);
  });
  await expect(page.locator('.fixture-panel')).toBeVisible();
}

test('a panel over the deck takes its own clicks, tool or no tool', async ({ page }) => {
  await openDeck(page, 'controls');
  await takeThePen(page);
  await coverTheDeck(page);

  // The way out of a panel is a button on it. With the pen taking the contact
  // the button never sees a click and the panel cannot be dismissed at all --
  // on an iPad, where there is no Esc to fall back on, that is a deck stuck in
  // its overview until a keyboard is found.
  await tap(page, page.locator('.fixture-panel-close'));

  await expect(page.locator('.fixture-panel'),
    'the panel would not close').toHaveCount(0);
  await expect(penPaths(page),
    'the click on the panel was taken as ink').toHaveCount(0);
});
