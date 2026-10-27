// A tool-approval card owns exactly one pending permission request at a time.
//
// When the user decides, the card clears that slot. But approvals are submitted
// via a fire-and-return POST (/chat/permission, /live/permission); the backend
// then runs the approved tool and, if the *next* tool also needs approval, pushes
// a new `permission_request` down the still-open SSE stream. When the approved
// tool is instant (e.g. Read_file, 0.00s), that next request can arrive WHILE the
// decision POST is still in flight — repopulating the slot with the new request
// before the card's onDone runs. Clearing unconditionally then drops that newer
// request, leaving its tool stuck at "等待批准…" with no card: the consecutive-
// approval stall bug.
//
// Fix: only clear when the slot still holds the exact request this card decided
// (matched by call_id). If a newer request already replaced it, keep the new one
// so its card renders.

export interface PendingLike {
  call_id: string;
  runtime_instance_id?: string;
  request_id?: number;
  generation?: number;
}

/**
 * Wire result of `POST /chat/permission`.
 *
 * `success: false` alone never says *why* delivery failed, and the two failure
 * classes need opposite UI behaviour:
 *   - `expired`             → the approval can never be applied again → retire the card.
 *   - `already_resolved`    → this exact approval already took effect (a retried POST
 *                             after a lost reply, or another WebUI instance) → retire it and
 *                             report which decision actually won.
 *   - neither               → delivery was not confirmed (network / wedged turn) → keep the
 *                             card retryable instead of stranding it.
 */
export interface PermissionDecisionResult {
  success: boolean;
  already_resolved?: boolean;
  /** Wire spelling of the decision that actually took effect. */
  applied?: string;
  expired?: boolean;
  error?: string;
}

export type PermissionRetiredReason = 'expired' | 'already_resolved';

export interface PermissionRetiredInfo {
  reason: PermissionRetiredReason;
  applied?: string;
}

/** Raised by a decision callback when the card can never be applied again. */
export class PermissionRetiredError extends Error {
  readonly info: PermissionRetiredInfo;

  constructor(info: PermissionRetiredInfo) {
    super(`permission request ${info.reason}`);
    this.name = 'PermissionRetiredError';
    this.info = info;
  }
}

/** Wire spelling of the button the user pressed (`PermissionDecision::from_value`). */
export function wireDecision(decision: string): 'allow' | 'allow_always' | 'deny' {
  if (decision === 'always_allow' || decision === 'allow_persist') return 'allow_always';
  return decision === 'deny' ? 'deny' : 'allow';
}

/** Did the decision the user pressed actually take effect? Unknown ⇒ assume yes. */
export function decisionTookEffect(requested: string, applied?: string): boolean {
  if (!applied) return true;
  return wireDecision(requested) === applied;
}

/** A non-null value means the displayed card is a ghost: retire it, never retry it. */
export function permissionRetiredInfo(
  result: PermissionDecisionResult,
): PermissionRetiredInfo | null {
  if (result.expired) return { reason: 'expired' };
  if (result.already_resolved) return { reason: 'already_resolved', applied: result.applied };
  return null;
}

/**
 * Does the server still park on exactly this approval? Backs the resume
 * reconciliation: a card left untouched for hours can outlive its approval
 * (another client answered it, the turn ended), and the SSE that would have
 * cleared it may itself have died silently. Keeping the card in that case leaves
 * a modal whose buttons can never succeed.
 */
export function stillPendingApproval(
  pending: { approval_id?: string | null; call_id?: string | null } | null | undefined,
  identity: { approval_id?: string | null; call_id?: string | null } | null | undefined,
): boolean {
  if (!pending) return false;
  const pendingApproval = pending.approval_id?.trim();
  const pendingCall = pending.call_id?.trim();
  const approvalId = identity?.approval_id?.trim();
  const callId = identity?.call_id?.trim();
  if (approvalId && pendingApproval) return approvalId === pendingApproval;
  if (callId && pendingCall) return callId === pendingCall;
  // Cannot correlate the two shapes: keep the card rather than silently dropping
  // a prompt that may still be live.
  return true;
}

export function resolvePendingAfterDecision<T extends PendingLike>(
  current: T | null,
  decidedCallId: string,
  decidedRuntimeInstanceId?: string,
  decidedRequestId?: number,
  decidedGeneration?: number,
): T | null {
  if (current?.runtime_instance_id !== undefined) {
    if (
      decidedRuntimeInstanceId === undefined
      || decidedRequestId === undefined
      || decidedGeneration === undefined
      || current.request_id === undefined
      || current.generation === undefined
    ) {
      return current;
    }
    return current.runtime_instance_id === decidedRuntimeInstanceId
      && current.generation === decidedGeneration
      && current.request_id === decidedRequestId
      ? null
      : current;
  }
  if (
    current
    && decidedRequestId !== undefined
    && current.request_id !== undefined
  ) {
    if (
      decidedGeneration !== undefined
      && current.generation !== undefined
      && current.generation !== decidedGeneration
    ) {
      return current;
    }
    return current.request_id === decidedRequestId ? null : current;
  }
  return current && current.call_id === decidedCallId ? null : current;
}
