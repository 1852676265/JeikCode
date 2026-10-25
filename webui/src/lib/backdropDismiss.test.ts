import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isBackdropDismiss } from './backdropDismiss.ts';

const overlay = {} as EventTarget;
const card = {} as EventTarget;

test('dismisses only when the press and the click both land on the backdrop', () => {
  assert.equal(isBackdropDismiss(true, overlay, overlay), true);
});

test('keeps the modal open when the drag-to-select starts inside the card', () => {
  // mousedown inside the card, mouseup over the backdrop → click target is the
  // overlay, but the press started inside the card. Must NOT dismiss.
  assert.equal(isBackdropDismiss(false, overlay, overlay), false);
});

test('keeps the modal open when the click lands on a child of the overlay', () => {
  assert.equal(isBackdropDismiss(true, card, overlay), false);
});

test('ignores missing targets defensively', () => {
  assert.equal(isBackdropDismiss(true, null, overlay), false);
  assert.equal(isBackdropDismiss(true, overlay, null), false);
});
