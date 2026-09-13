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
    annotate-codec.js         the packed storage format for saved ink
    annotate-pdf.js           dependency-free vector PDF encoder
    annotate-pages.js         grows and deletes blank pages (opt-in)
    palm-rejection.js         keeps multi-contact palm touches out of reveal swipes
    perfect-freehand.min.js   vendored MIT stroke-shaping library
    annotate.scss             the ink layers, tool panel and corner buttons
index.qmd / no-pages.qmd      fixture decks, with page growth on and off
test/                         DOM-free unit tests (node:test)
tests/                        Playwright, across chromium, firefox and webkit
```

## Saved ink

Ink is kept in `localStorage` under `reveal-ink-v7:<deck path>`, and the panel
writes the same structure to a file. A stroke is stored packed by
`annotate-codec.js`: an int32 pair for where it starts, then five bytes a point
— int16 dx, int16 dy in tenths of a page unit, and a byte of pressure in
hundredths — base64'd. That is about 8 bytes a point against the 20 the plain
JSON spent, and it is **exact**: the capture path already rounds x and y to one
decimal and pressure to two, so nothing is lost.

It has to stay exact. Only storage is packed — the multiplex relay and the
in-memory strokes carry the same numbers they always did — so any rounding
introduced here would put an audience's copy of a stroke somewhere other than
the presenter's.

Packing is what paid for switching `flat` off. It existed only to keep saved
ink small, and it did real damage doing it: it takes back a point the stroke
already holds, over and over through the gentle curves handwriting is mostly
made of, so the kept points stop following the pen and the stroke crosses the
curve in straight chords bounded only by `span` — about 13 screen pixels on an
iPad. `pressure` hid it, because each rule declines to drop a point whose
pressure is doing something; with stylus pressure off every point carries a flat
0.5, the guard never fires, and the rule discarded 47% of a real page of
handwriting. It is now `0`, and `test/annotate-model.test.js` keeps a `todo`
test describing the defect, so it is on the record without a permanently
failing suite.

`step` is off too, for a different reason. It is not destructive the way `flat`
is — it only skips an incoming sample, never takes back a kept one — but it is
an economy, and the economy has been paid for twice: packing spends about 8
bytes on a point where the JSON spent 20, and saved ink only has to outlive one
lecture. A deck is written on, exported, and done with; localStorage is the
buffer between those two moments rather than an archive. A heavily annotated
lecture is about 1.8 MB packed with nothing dropped at all, which leaves room
inside the few megabytes an origin gets.

Note that a failed save is currently silent — `annotate.js` swallows the quota
exception — so if that headroom is ever exhausted the ink stops being written
without saying so. Export is the durable path; the relay keeps nothing, and the
recorder in a consuming project is a separate opt-in service.

Version 6 ink is not read. The version is part of the storage key, so an older
deck's ink is not found rather than mis-read, and an exported v6 file is
refused on import.

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
