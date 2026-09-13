const test = require('node:test');
const assert = require('node:assert/strict');
const {
  VERSION, packPoints, unpackPoints, packInk, unpackInk
} = require('../_extensions/Pat-Laub/annotate/annotate-codec.js');

// The codec exists to make saved ink small enough that none of it has to be
// thrown away. It is a storage format only: what goes over the multiplex wire
// and what sits in memory are untouched, so a viewer can never be handed
// different numbers from the ones the pen produced.
//
// Everything here turns on exactness. A stroke is stored as the numbers the
// pen gave, to the precision the capture path already rounds them to -- one
// decimal on x and y (pointFromRect), two on pressure (pressureSample) -- so
// the codec works in tenths and hundredths and loses nothing at all.

function stroke(p) { return { t: 'pen', c: '#252525', w: 12.3, s: false, p: p }; }

test('the format announces itself so a reader can refuse what it does not know', () => {
  assert.equal(VERSION, 7);
});

test('a stroke survives packing exactly, to the last tenth', () => {
  const p = [[1392.4, 276, 0.41], [1393.7, 277.3, 0.42], [1396, 280.9, 0.5]];
  assert.deepEqual(unpackPoints(packPoints(p)), p.map(q => [q[0], q[1], q[2]]));
});

test('coordinates further out than a delta can reach still come back', () => {
  // The page is 3744 units wide, so an absolute coordinate does not fit the
  // int16 the deltas use. The first point is written as a full-width origin.
  const p = [[3743.9, 2105.8, 0.5], [3740.1, 2100.2, 0.5]];
  assert.deepEqual(unpackPoints(packPoints(p)), p);
});

test('negative travel and the ends of the pressure range are exact', () => {
  const p = [[500, 500, 0], [400.5, 380.2, 1], [399.9, 379.8, 0.07]];
  assert.deepEqual(unpackPoints(packPoints(p)), p);
});

test('a stroke of one point, and one of none, survive the trip', () => {
  assert.deepEqual(unpackPoints(packPoints([[12.3, 45.6, 0.5]])), [[12.3, 45.6, 0.5]]);
  assert.deepEqual(unpackPoints(packPoints([])), []);
});

test('a point carrying no pressure is restored at the neutral value', () => {
  // boxPoints() builds two-element corners; anything else that reaches the
  // codec without a pressure is treated the way the pen treats a mouse.
  assert.deepEqual(unpackPoints(packPoints([[10, 20]])), [[10, 20, 0.5]]);
});

test('coordinates finer than the capture path produces are rounded, not refused', () => {
  // scalePoints() multiplies a selection's points and can leave more decimals
  // than the pen ever produces. Storage settles them at the capture precision.
  const packed = packPoints([[10.06, 20.04, 0.456]]);
  assert.deepEqual(unpackPoints(packed), [[10.1, 20, 0.46]]);
});

test('the packed form is a fraction of the JSON it replaces', () => {
  const p = [];
  for (let i = 0; i < 500; i++) p.push([+(100 + i * 1.3).toFixed(1), +(200 + Math.sin(i / 9) * 40).toFixed(1), 0.5]);
  const packed = packPoints(p).length;
  const plain = JSON.stringify(p).length;
  assert.ok(packed / plain < 0.45, `packed was ${(packed / plain * 100).toFixed(0)}% of JSON`);
});

test('a whole deck of ink round-trips with every stroke property intact', () => {
  const ink = {
    'sample-space': [stroke([[10, 20, 0.5], [11.5, 22.5, 0.55]]),
                     { t: 'highlighter', c: '#facc15', w: 86, s: true, p: [[0, 0, 0.5], [50, 0, 0.5]] }],
    '3.1': [stroke([[300.5, 400.5, 0.33]])]
  };
  assert.deepEqual(unpackInk(packInk(ink)), ink);
});

test('text boxes are carried through untouched rather than packed', () => {
  // A text annotation is four corners and a string; packing it saves nothing
  // and its corners carry no pressure, so it is left exactly as it is.
  const ink = { '0.0': [{ t: 'text', c: '#252525', f: 60, v: 'hello', p: [[0, 0], [10, 0], [10, 5], [0, 5]] }] };
  const packed = packInk(ink);
  assert.deepEqual(packed['0.0'][0].p, ink['0.0'][0].p, 'a text box should not be packed');
  assert.deepEqual(unpackInk(packed), ink);
});

test('packing leaves the ink it was given alone', () => {
  const ink = { '0.0': [stroke([[1, 2, 0.5], [3, 4, 0.5]])] };
  const before = JSON.stringify(ink);
  packInk(ink);
  assert.equal(JSON.stringify(ink), before, 'packInk mutated its argument');
});

test('a stroke too spread out for the packed form stays plain, and still reads back', () => {
  // A single step wider than an int16 of tenths cannot be encoded. It cannot
  // arise from a pen on a 3744-unit page, but the format says what happens if
  // it ever does: that stroke is stored unpacked and the rest are not affected.
  const wild = stroke([[0, 0, 0.5], [30000, 0, 0.5]]);
  const ink = { '0.0': [wild, stroke([[1, 1, 0.5], [2, 2, 0.5]])] };
  const packed = packInk(ink);
  assert.ok(Array.isArray(packed['0.0'][0].p), 'the unencodable stroke should stay plain');
  assert.equal(typeof packed['0.0'][1].b, 'string', 'its neighbour should still be packed');
  assert.deepEqual(unpackInk(packed), ink);
});

test('unpacking tolerates ink that holds nothing', () => {
  assert.deepEqual(unpackInk({}), {});
  assert.deepEqual(unpackInk({ '0.0': [] }), { '0.0': [] });
});
