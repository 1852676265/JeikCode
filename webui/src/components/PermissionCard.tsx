// Task 14 — Tool approval modal card

import { useState } from 'preact/hooks';
import { respondPermission } from '../api';
import { useT } from '../settings';
import { formatToolPayload } from '../lib/toolDisplay';
import {
  PermissionRetiredError,
  permissionRetiredInfo,
} from '../lib/pendingPermission';
import type { PermissionRetiredInfo } from '../lib/pendingPermission';

interface PermissionRequest {
  session_id: string;
  approval_id?: string;
  tool_name: string;
  reason: string;
  call_id: string;
  arguments: unknown;
}

interface PermissionCardProps {
  req: PermissionRequest;
  onDone: () => void;
  /** Optional override for the decision action. When provided, replaces the
   *  default respondPermission call. Used by live-session approval (POST /live/permission)
   *  so the non-sync /chat path is unchanged. A callback that throws
   *  [`PermissionRetiredError`] retires the card instead of keeping it retryable. */
  onDecide?: (decision: 'allow' | 'deny' | 'always_allow' | 'allow_persist', toolName?: string) => Promise<void>;
  /** The approval can never be applied again (expired, or already handled by
   *  another client). Fired right before `onDone` so the dock can explain why the
   *  card vanished instead of leaving the user guessing. */
  onRetired?: (info: PermissionRetiredInfo) => void;
  /** Corner stack instead of a blocking overlay. */
  dock?: boolean;
  /** Non-blocking centered stage (foreground active session) instead of a blocking overlay. */
  center?: boolean;
}

function formatArgs(args: unknown): string {
  if (typeof args === 'string') {
    return formatToolPayload(args);
  }
  try {
    return formatToolPayload(JSON.stringify(args));
  } catch {
    return String(args);
  }
}

export function PermissionCard({ req, onDone, onDecide, onRetired, dock, center }: PermissionCardProps) {
  const t = useT();
  const [loading, setLoading] = useState(false);
  /** Delivery failure that is still worth retrying (transport / timeout / wedged turn). */
  const [error, setError] = useState('');

  async function decide(decision: 'allow' | 'deny' | 'always_allow' | 'allow_persist') {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      if (onDecide) {
        await onDecide(decision, req.tool_name);
      } else {
        if (!req.approval_id) throw new Error('missing approval identity');
        const result = await respondPermission(req.session_id, req.approval_id, decision, req.tool_name);
        const retired = permissionRetiredInfo(result);
        if (retired) {
          // The approval is gone for good (expired, or applied elsewhere): retrying
          // can never succeed, so retire the card instead of stranding a dead modal.
          onRetired?.(retired);
          onDone();
          return;
        }
        if (!result.success) throw new Error(result.error ?? 'permission request is no longer pending');
      }
      onDone();
    } catch (err) {
      const info = err instanceof PermissionRetiredError ? err.info : null;
      if (info) {
        onRetired?.(info);
        onDone();
        return;
      }
      // Keep the exact approval visible and actionable when delivery was not
      // confirmed — but say so: a silent failure reads as "the buttons are dead".
      // Poll/SSE reconciliation can still retire a genuinely stale request.
      setError(t('userInput.error'));
    } finally {
      setLoading(false);
    }
  }

  const argsDisplay = formatArgs(req.arguments);

  const card = (
      <div class="modal-card permission-card">
        <div class="modal-header permission-header">
          <span class="permission-logo" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <rect
                x="6.4"
                y="6.4"
                width="11.2"
                height="11.2"
                rx="2.6"
                transform="rotate(45 12 12)"
                stroke="currentColor"
                stroke-width="1.8"
              />
            </svg>
          </span>
          <h3 class="permission-title">{t('perm.title')}</h3>
          <span class="modal-tag permission-tag notranslate" translate={false}>{req.tool_name}</span>
        </div>

        <div class="modal-body">
          {req.reason && <p class="permission-lead">{req.reason}</p>}
          <div class="field-group">
            <span class="modal-label">{t('perm.args')}</span>
            <pre class="tool-body-row-content">{argsDisplay}</pre>
          </div>
          {error && (
            <p class="permission-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <div class="modal-footer permission-footer">
          <button class="btn" disabled={loading} onClick={() => decide('deny')}>
            {t('perm.deny')}
          </button>
          <button class="btn btn-primary" disabled={loading} onClick={() => decide('allow')}>
            {t('perm.approve')}
          </button>
          <button class="btn" disabled={loading} onClick={() => decide('always_allow')}>
            {t('perm.alwaysAllow')}
          </button>
          {req.tool_name.startsWith('mcp__') && (
            <button class="btn" disabled={loading} onClick={() => decide('allow_persist')}>
              {t('perm.allowPersist')}
            </button>
          )}
        </div>
      </div>
  );
  if (dock) return <div class="notify-card">{card}</div>;
  if (center) return <div class="center-stage">{card}</div>;
  return <div class="modal-overlay">{card}</div>;
}
