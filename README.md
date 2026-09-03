# annotate

Freehand annotation for Quarto reveal.js decks, as an extension: pen,
highlighter, text boxes, lasso selection, eraser, and per-slide persistence in
the browser's localStorage.

```yaml
format:
  slide-stage-revealjs:
    revealjs-plugins: [annotate]
    theme: [..., _extensions/Pat-Laub/annotate/annotate.scss]
```

`annotate.scss` is a theme layer rather than a plugin stylesheet because it
needs the deck's own `$mainColor` and `$link-color`. Every size in it is in
authored page units: the stage is scaled to the window as one rectangle, so a
length meant for a browser-sized page comes out at a fraction of everything
beside it.

## Options

```yaml
    annotate:
      pages: false      # grow a blank page by navigating past the last slide
```

Page growth is what a blank writing pad is for and exactly wrong in a lecture
deck, so it is off unless a deck asks for it.

## Layout

```
_extensions/Pat-Laub/annotate/
    _extension.yml            the revealjs plugin and its defaults
    annotate.js               the tools, the layers and persistence
    annotate-geometry.js      portable, DOM-free geometry
    annotate-model.js         portable pressure, thinning and stroke helpers
    annotate-pdf.js           dependency-free vector PDF encoder
    annotate-pages.js         grows and deletes blank pages (opt-in)
    palm-rejection.js         keeps multi-contact palm touches out of reveal swipes
    perfect-freehand.min.js   vendored MIT stroke-shaping library
    annotate.scss             the ink layers, tool panel and corner buttons
index.qmd / no-pages.qmd      fixture decks, with page growth on and off
test/                         DOM-free unit tests (node:test)
tests/                        Playwright, across chromium, firefox and webkit
```

## Testing

```sh
npm install
npx playwright install chromium firefox webkit
npm run render
npm test
```

One thing to know when writing more: drive input through `.ink-surface` rather
than the ink layers — that is the element that actually takes it, and
`tests/support/pad.js` does this.

## Releasing

```sh
./scripts/release-extension.sh annotate-dist-v0.1.0
```

Consumers vendor the payload branch:

```sh
git subtree add --prefix=_extensions/Pat-Laub/annotate <repo> <tag> --squash
```
