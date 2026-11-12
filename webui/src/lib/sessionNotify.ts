// When the WebUI should raise a corner card or an OS toast.
//
// Build, Plan, and Accept edits park on each review, so those prompts are shown.
// Auto (`bypass`) does not: only a finished or stopped turn is notified.
// A structured question still has to be answerable in Auto, or the turn stalls.

declare global {
  interface Window {
    /** Set by the desktop shell. True when the native window is minimized or unfocused. */
    __jeikcodeHostAway?: boolean;
  }
}

export type NotifyApprovalMode = 'build' | 'plan' | 'bypass' | 'accept_edits';

export type TerminalKind = 'completed' | 'stopped' | 'failed';

export interface TerminalEdge {
  sessionId: string;
  seq: number;
  kind: TerminalKind;
}

const FAILED_REASONS = new Set([
  'provider_error',
  'timeout',
  'prompt_rejected',
  'policy_denied',
  'internal_error',
]);

/** Tool-approval cards and their OS pings. Auto never parks on these. */
export function showPermissionNotice(mode: NotifyApprovalMode | null | undefined): boolean {
  return mode !== 'bypass';
}

/** OS toast for a review. The corner card is the focused UI; the OS toast is for when the window is away. */
export function shouldOsNotifyReview(
  mode: NotifyApprovalMode | null | undefined,
  windowAway: boolean,
): boolean {
  return showPermissionNotice(mode) && windowAway;
}

export interface TerminalNoticeContext {
  sessionId: string;
  activeSessionId?: string | null;
  windowAway: boolean;
  kind?: TerminalKind;
  hasStopContent?: boolean;
}

// 记录用户主动操作的防骚扰抑制表：手动点击停止与中途转向都不打扰用户
const USER_MANUAL_STOP_MAP = new Map<string, number>();
const USER_STEER_MAP = new Map<string, number>();

const MANUAL_STOP_SUPPRESS_MS = 15000;
const STEER_SUPPRESS_MS = 25000;

/** 标记用户主动点击了停止按钮，该会话在后续 15 秒内严禁弹出系统通知和完成通知 */
export function recordUserManualStop(sessionId: string): void {
  if (!sessionId) return;
  USER_MANUAL_STOP_MAP.set(sessionId, Date.now());
}

/** 标记用户发送了转向（steer）引导消息，该会话在后续 25 秒内严禁弹出中途停止通知 */
export function recordUserSteer(sessionId: string): void {
  if (!sessionId) return;
  USER_STEER_MAP.set(sessionId, Date.now());
}

/** 检查某会话当前是否处于用户主动停止或中途转向的静默期 */
export function isSessionNoticeSuppressed(sessionId: string): boolean {
  if (!sessionId) return false;
  const now = Date.now();
  const stopTime = USER_MANUAL_STOP_MAP.get(sessionId);
  if (stopTime !== undefined && now - stopTime < MANUAL_STOP_SUPPRESS_MS) {
    return true;
  }
  const steerTime = USER_STEER_MAP.get(sessionId);
  if (steerTime !== undefined && now - steerTime < STEER_SUPPRESS_MS) {
    return true;
  }
  return false;
}

/**
 * Stay quiet only when this session is the one on screen and the window is in
 * the foreground. Minimized, covered, or another session still notifies.
 */
export function shouldToastTerminal(ctx?: TerminalNoticeContext): boolean {
  if (ctx && isSessionNoticeSuppressed(ctx.sessionId)) return false;
  return !quietForegroundSession(ctx);
}

/**
 * OS toast: 严格遵循用户偏好！
 * 1. 严格排除用户手动点击按钮停止的场景；
 * 2. 严格排除中途 steer 转向打断产生的场景；
 * 3. 页面若在前台活跃交互，绝不重复发送系统通知造成双重弹窗骚扰；
 * 4. 必须是任务真正最终结束且非空才通知。
 */
export function shouldOsNotifyTerminal(ctx?: TerminalNoticeContext): boolean {
  if (!ctx) return false;
  // 用户手动停止或中途 steer 严禁弹出系统通知
  if (isSessionNoticeSuppressed(ctx.sessionId)) return false;
  // 前台活跃展示时，WebUI 内部已有交互，不发系统通知
  if (!ctx.windowAway) return false;
  return !quietForegroundSession(ctx);
}

function quietForegroundSession(ctx?: TerminalNoticeContext): boolean {
  if (!ctx) return false;
  return Boolean(ctx.activeSessionId) && ctx.sessionId === ctx.activeSessionId && !ctx.windowAway;
}

/** Page visibility plus the desktop shell's minimized / unfocused bit. */
export function windowAwayFrom(input: {
  pageHidden: boolean;
  pageFocused: boolean;
  hostAway: boolean;
}): boolean {
  return input.pageHidden || !input.pageFocused || input.hostAway;
}

export function isWindowAway(): boolean {
  if (typeof document === 'undefined') return false;
  const hostAway =
    typeof window !== 'undefined' && window.__jeikcodeHostAway === true;
  return windowAwayFrom({
    pageHidden: document.hidden || document.visibilityState === 'hidden',
    pageFocused: document.hasFocus(),
    hostAway,
  });
}

export function terminalKindFromDone(stopReason: string | undefined): TerminalKind {
  if (stopReason === undefined || stopReason === '' || stopReason === 'stopped') {
    return 'completed';
  }
  if (stopReason === 'cancelled') return 'stopped';
  if (FAILED_REASONS.has(stopReason)) return 'failed';
  return 'stopped';
}

export function isTerminalKind(value: string | null | undefined): value is TerminalKind {
  return value === 'completed' || value === 'stopped' || value === 'failed';
}

/**
 * The first poll is a baseline: record seqs and stay quiet so opening the page
 * does not replay turns that already finished.
 * After that, a higher seq emits one edge. A session that appears already
 * finished (the whole turn landed between polls) emits too.
 * A jump of several seqs is still one notice, so a done+stopped pair in the
 * same gap does not double-fire.
 */
export function takeTerminalEdges(
  seen: Map<string, number>,
  rows: Array<{ sessionId: string; seq: number; kind: string | null | undefined }>,
  options?: { baseline?: boolean },
): TerminalEdge[] {
  const baseline = options?.baseline === true;
  const edges: TerminalEdge[] = [];
  const live = new Set<string>();
  for (const row of rows) {
    if (!row.sessionId) continue;
    live.add(row.sessionId);
    const seq = Number.isFinite(row.seq) ? row.seq : 0;
    const prev = seen.get(row.sessionId);
    if (prev === undefined) {
      seen.set(row.sessionId, seq);
      if (!baseline && seq > 0 && isTerminalKind(row.kind)) {
        edges.push({ sessionId: row.sessionId, seq, kind: row.kind });
      }
      continue;
    }
    if (seq > prev && isTerminalKind(row.kind)) {
      edges.push({ sessionId: row.sessionId, seq, kind: row.kind });
    }
    if (seq !== prev) seen.set(row.sessionId, seq);
  }
  for (const id of [...seen.keys()]) {
    if (!live.has(id)) seen.delete(id);
  }
  return edges;
}

/** Same session and kind inside the window is one toast (poll racing a second seq). */
export function shouldEmitNotice(
  recent: Map<string, number>,
  key: string,
  now: number,
  windowMs: number,
): boolean {
  const prev = recent.get(key);
  if (prev !== undefined && now - prev < windowMs) return false;
  recent.set(key, now);
  return true;
}

export function sessionNoticeLabel(input: {
  id: string;
  name?: string | null;
  workingDir?: string | null;
}): string {
  const name = input.name?.trim();
  if (name && !name.startsWith('session-') && !name.startsWith('optimistic-')) return name;
  const folder = (input.workingDir ?? '')
    .split(/[\\/]/)
    .filter((part) => part.length > 0)
    .pop();
  const short = input.id.slice(0, 8);
  return folder ? `${folder} · ${short}` : short || input.id;
}

export interface SystemNotificationOptions {
  title: string;
  body: string;
  sessionId?: string | null;
  tag?: string;
  postSystemNotifyFn?: (input: {
    title: string;
    body: string;
    tag?: string;
    sessionId?: string;
    approvalId?: string;
  }) => Promise<unknown>;
  approvalId?: string;
}

export interface PermissionNoticeIdentity {
  call_id: string;
  approval_id?: string | null;
  runtime_instance_id?: string | null;
  request_id?: number | null;
  generation?: number | null;
}

export function permissionInstanceKey(
  sessionId: string,
  permission: PermissionNoticeIdentity,
): string {
  const approvalId = permission.approval_id?.trim();
  if (approvalId) return `${sessionId}:approval:${approvalId}`;
  const runtimeInstanceId = permission.runtime_instance_id?.trim();
  if (runtimeInstanceId) {
    const generation = permission.generation;
    const requestId = permission.request_id;
    if (generation === undefined || generation === null || requestId === undefined || requestId === null) {
      return `${sessionId}:runtime:${runtimeInstanceId}:incomplete:${permission.call_id}`;
    }
    return `${sessionId}:runtime:${runtimeInstanceId}:generation:${generation}:request:${requestId}`;
  }
  if (permission.request_id !== undefined && permission.request_id !== null) {
    const generation = permission.generation;
    return generation !== undefined && generation !== null
      ? `${sessionId}:generation:${generation}:request:${permission.request_id}`
      : `${sessionId}:request:${permission.request_id}`;
  }
  return `${sessionId}:call:${permission.call_id}`;
}

export function samePermissionInstance(
  a: PermissionNoticeIdentity | null | undefined,
  b: PermissionNoticeIdentity | null | undefined,
): boolean {
  if (!a || !b) return false;
  const aApproval = a.approval_id?.trim();
  const bApproval = b.approval_id?.trim();
  if (aApproval || bApproval) {
    return Boolean(aApproval && bApproval && aApproval === bApproval);
  }
  const aRuntime = a.runtime_instance_id?.trim();
  const bRuntime = b.runtime_instance_id?.trim();
  if (aRuntime || bRuntime) {
    return Boolean(
      aRuntime
      && bRuntime
      && aRuntime === bRuntime
      && a.generation !== undefined
      && a.generation !== null
      && b.generation !== undefined
      && b.generation !== null
      && a.generation === b.generation
      && a.request_id !== undefined
      && a.request_id !== null
      && b.request_id !== undefined
      && b.request_id !== null
      && a.request_id === b.request_id
    );
  }
  const aRequest = a.request_id;
  const bRequest = b.request_id;
  if (aRequest !== undefined && aRequest !== null || bRequest !== undefined && bRequest !== null) {
    if (!(aRequest !== undefined
      && aRequest !== null
      && bRequest !== undefined
      && bRequest !== null)) {
      return false;
    }
    const aGeneration = a.generation;
    const bGeneration = b.generation;
    if (
      aGeneration !== undefined && aGeneration !== null
      || bGeneration !== undefined && bGeneration !== null
    ) {
      return aGeneration !== undefined
        && aGeneration !== null
        && bGeneration !== undefined
        && bGeneration !== null
        && aGeneration === bGeneration
        && aRequest === bRequest;
    }
    return aRequest === bRequest;
  }
  return a.call_id === b.call_id;
}

let lastCompletionAudioTime = 0;

/**
 * 播放柔和优雅的高保真双音阶完成提示音（A5-880Hz -> E6-1320Hz），
 * 纯 Web Audio 原生合成，零外部媒体文件依赖，1 秒内自动防抖。
 */
export function playCompletionAudio(): void {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  if (now - lastCompletionAudioTime < 1000) return;
  lastCompletionAudioTime = now;
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const startTime = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, startTime);
    gain1.gain.setValueAtTime(0.08, startTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(startTime);
    osc1.stop(startTime + 0.35);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1320, startTime + 0.1);
    gain2.gain.setValueAtTime(0.08, startTime + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.001, startTime + 0.6);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(startTime + 0.1);
    osc2.stop(startTime + 0.6);
  } catch {}
}

let originalDocumentTitle: string | null = null;
let titleResetAttached = false;

/**
 * 任务在后台完成时，动态闪烁网页标题与任务栏提示，切回页面时自动恢复
 */
export function flashDocumentTitle(alertText: string): void {
  if (typeof document === 'undefined') return;
  if (!originalDocumentTitle) {
    originalDocumentTitle = document.title;
  }
  document.title = `🔔 【已完成】${alertText}`;
  if (!titleResetAttached && typeof window !== 'undefined') {
    titleResetAttached = true;
    const reset = () => {
      if (originalDocumentTitle) {
        document.title = originalDocumentTitle;
        originalDocumentTitle = null;
      }
      titleResetAttached = false;
    };
    window.addEventListener('focus', reset, { once: true });
    document.addEventListener(
      'visibilitychange',
      () => {
        if (!document.hidden) reset();
      },
      { once: true },
    );
  }
}

/**
 * 调起浏览器操作系统级桌面通知（Web Notification），点击时激活并聚焦窗口
 */
export function triggerBrowserNotification(title: string, body: string, tag?: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (window.Notification.permission === 'granted') {
    try {
      const n = new window.Notification(title, {
        body,
        icon: '/favicon.png',
        tag: tag || 'zap-notice',
      });
      n.onclick = () => {
        try {
          window.focus();
        } catch {}
        n.close();
      };
    } catch {}
  } else if (window.Notification.permission === 'default') {
    try {
      void window.Notification.requestPermission();
    } catch {}
  }
}

/**
 * 全方位分发系统级外层提示（浏览器桌面通知 + 任务栏动态标题 + 高保真提示音 + 后端 OS 原生 Toast）
 */
export function dispatchSystemNotification(opts: SystemNotificationOptions): void {
  const { title, body, sessionId, tag, approvalId, postSystemNotifyFn } = opts;

  // 1. 触发浏览器系统桌面通知（系统外部弹窗，即使在纯网页端也支持）
  triggerBrowserNotification(title, body, tag);

  // 2. 触发 Web Audio 高保真柔和提示音
  playCompletionAudio();

  // 3. 触发标签页/任务栏标题高亮提示
  flashDocumentTitle(title);

  // 4. 统一通过后端分发操作系统级原生弹窗通知（Windows WinRT Toast / macOS / Linux）
  if (postSystemNotifyFn) {
    void postSystemNotifyFn({
      title,
      body,
      tag,
      sessionId: sessionId || undefined,
      ...(approvalId ? { approvalId } : {}),
    }).catch(() => {});
  }
}
