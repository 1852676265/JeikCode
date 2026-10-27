import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PermissionRetiredError,
  decisionTookEffect,
  permissionRetiredInfo,
  resolvePendingAfterDecision,
  stillPendingApproval,
  wireDecision,
} from './pendingPermission.ts';

test('old live decision cannot clear a replacement runtime permission card', () => {
  const current = {
    call_id: 'call-reused',
    runtime_instance_id: 'runtime-new',
    generation: 0,
    request_id: 1,
  };

  assert.equal(
    resolvePendingAfterDecision(current, 'call-reused', 'runtime-old', 1, 0),
    current,
  );
});

test('strong live permission requires the complete runtime identity to clear', () => {
  const current = {
    call_id: 'call-reused',
    runtime_instance_id: 'runtime-new',
    generation: 0,
    request_id: 1,
  };

  assert.equal(resolvePendingAfterDecision(current, 'call-reused', undefined, 1, 0), current);
  assert.equal(resolvePendingAfterDecision(current, 'call-reused', 'runtime-new', 1, undefined), current);
  assert.equal(resolvePendingAfterDecision(current, 'call-reused', 'runtime-new', undefined, 0), current);
  assert.equal(resolvePendingAfterDecision(current, 'call-reused', 'runtime-new', 1, 0), null);
});

test('decision buttons map onto the daemon wire spelling', () => {
  assert.equal(wireDecision('allow'), 'allow');
  assert.equal(wireDecision('deny'), 'deny');
  assert.equal(wireDecision('always_allow'), 'allow_always');
  assert.equal(wireDecision('allow_persist'), 'allow_always');
  assert.equal(decisionTookEffect('always_allow', 'allow_always'), true);
  assert.equal(decisionTookEffect('allow', 'deny'), false);
  assert.equal(decisionTookEffect('allow', undefined), true, 'an unreported decision is assumed applied');
});

test('an already applied approval retires the card instead of failing forever', () => {
  assert.deepEqual(
    permissionRetiredInfo({ success: true, already_resolved: true, applied: 'allow' }),
    { reason: 'already_resolved', applied: 'allow' },
  );
});

test('an expired approval retires the card', () => {
  assert.deepEqual(
    permissionRetiredInfo({ success: false, expired: true, error: 'permission request expired' }),
    { reason: 'expired' },
  );
});

test('an unconfirmed delivery keeps the card retryable', () => {
  assert.equal(permissionRetiredInfo({ success: false }), null);
  assert.equal(
    permissionRetiredInfo({
      success: false,
      error: 'permission decision was not acknowledged in time; retry',
    }),
    null,
  );
});

test('a still-pending approval keeps the card alive on resume', () => {
  assert.equal(
    stillPendingApproval(
      { approval_id: 'appr-1', call_id: 'call-1' },
      { approval_id: 'appr-1', call_id: 'call-1' },
    ),
    true,
  );
  assert.equal(
    stillPendingApproval({ approval_id: 'appr-1', call_id: 'call-1' }, { approval_id: 'appr-1' }),
    true,
  );
});

test('a consumed or replaced approval retires the card on resume', () => {
  // Another client answered it (or the turn ended): the daemon no longer parks here.
  assert.equal(stillPendingApproval(null, { approval_id: 'appr-1', call_id: 'call-1' }), false);
  // The turn moved on to a *different* approval (same provider call id, new sidecar).
  assert.equal(
    stillPendingApproval(
      { approval_id: 'appr-2', call_id: 'call-1' },
      { approval_id: 'appr-1', call_id: 'call-1' },
    ),
    false,
  );
  // Older replay-derived prompts may only carry the provider call id.
  assert.equal(stillPendingApproval({ call_id: 'call-1' }, { call_id: 'call-1' }), true);
  assert.equal(stillPendingApproval({ call_id: 'call-2' }, { call_id: 'call-1' }), false);
  // Uncorrelatable shapes must never silently drop a possibly-live prompt.
  assert.equal(stillPendingApproval({}, { approval_id: 'appr-1' }), true);
});

test('the retired error carries the actionable reason', () => {
  const error = new PermissionRetiredError({ reason: 'already_resolved', applied: 'deny' });
  assert.ok(error instanceof Error);
  assert.equal(error.info.reason, 'already_resolved');
  assert.equal(error.info.applied, 'deny');
});
