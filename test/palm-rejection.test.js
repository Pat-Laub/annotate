const test = require('node:test');
const assert = require('node:assert/strict');
const { createGuard } = require('../_extensions/Pat-Laub/annotate/palm-rejection.js');

function event(pointerId, pointerType = 'touch') {
  return { pointerId, pointerType };
}

test('a one-finger pointer stream remains available to reveal', () => {
  const block = createGuard();
  assert.equal(block('pointerdown', event(1)), false);
  assert.equal(block('pointermove', event(1)), false);
  assert.equal(block('pointerup', event(1)), false);
});

test('all contacts are quarantined after a second finger or palm contact', () => {
  const block = createGuard();
  assert.equal(block('pointerdown', event(1)), false);
  assert.equal(block('pointerdown', event(2)), true);
  assert.equal(block('pointermove', event(1)), true);
  assert.equal(block('pointermove', event(2)), true);
  assert.equal(block('pointerup', event(2)), true);
  assert.equal(block('pointerup', event(1)), true);

  // Rejection ends only after every contact has lifted.
  assert.equal(block('pointerdown', event(3)), false);
});

test('pen and mouse pointers do not count as palm contacts', () => {
  const block = createGuard();
  assert.equal(block('pointerdown', event(1, 'pen')), false);
  assert.equal(block('pointerdown', event(2, 'touch')), false);
  assert.equal(block('pointermove', event(2, 'touch')), false);
});

// A palm contact does not always report that it lifted. iPadOS can take a
// contact away without a `pointerup` -- a system gesture claiming it, the app
// suspending mid-touch, or the contact simply being lost -- and the id then
// stays in the guard's active set with nothing left to remove it. Because
// rejection is only lifted when that set empties, every later one-finger swipe
// arrives to find a contact already down, re-arms the quarantine, and is
// blocked. Observed in a lecture on 15 Sep 2026: three swipes in a row reached
// reveal with no movement at all and were cancelled, the fourth got through.
test('a contact that never lifts must not block every later swipe', () => {
  let time = 0;
  const block = createGuard(() => time);

  // A palm lands alongside the finger and the gesture is quarantined: correct.
  assert.equal(block('pointerdown', event(1)), false);
  assert.equal(block('pointerdown', event(2)), true);

  // The finger lifts. The palm never does, and goes quiet.
  assert.equal(block('pointerup', event(2)), true);

  // A clean one-finger swipe afterwards is a genuine gesture and has to reach
  // reveal, or the deck stops changing slides until the page is reloaded.
  time += 5000;
  assert.equal(block('pointerdown', event(3)), false);
  assert.equal(block('pointermove', event(3)), false);
  assert.equal(block('pointerup', event(3)), false);
});

// The other half of the same rule: quiet is what makes a contact stale, not
// merely the passing of time. A finger genuinely held down keeps reporting
// movement, so it must keep its quarantine however long the gesture runs.
test('a contact still sending events is never treated as stale', () => {
  let time = 0;
  const block = createGuard(() => time);

  assert.equal(block('pointerdown', event(1)), false);
  assert.equal(block('pointerdown', event(2)), true);

  for (let i = 0; i < 10; i += 1) {
    time += 1000;
    assert.equal(block('pointermove', event(1)), true);
    assert.equal(block('pointermove', event(2)), true);
  }

  time += 1000;
  assert.equal(block('pointerdown', event(3)), true);
});

test('a cancelled contact is gone, whether or not others are still down', () => {
  const block = createGuard();

  // Two contacts, then one is cancelled rather than lifted. A cancel is the
  // platform saying the contact is finished, so it should not leave the guard
  // holding a contact that can never be cleared.
  assert.equal(block('pointerdown', event(1)), false);
  assert.equal(block('pointerdown', event(2)), true);
  assert.equal(block('pointercancel', event(1)), true);
  assert.equal(block('pointercancel', event(2)), true);

  assert.equal(block('pointerdown', event(3)), false);
  assert.equal(block('pointermove', event(3)), false);
});
