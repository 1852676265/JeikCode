/**
 * 「停止当前运行中回合」的共享判定：WebUI 的「停止」按钮、排队卡片的「立即发送」，
 * 以及程序化停止后的终态收尾都依赖这里的规则。
 *
 * 历史教训：本端回合被 `/chat` admit（202 Accepted）之后 `requestIdRef` 即被清空，
 * 会话 id 才是长期有效的停止别名。若停止只认 request id 别名，停止会被整体跳过，
 * 紧接着的投递必然撞上后端 409 `session_busy`，消息被退回收件箱式的排队卡片。
 */

/** 「立即发送」发起的程序化停止标记：旧回合的 `stopped` 终态到达时按此一次性识别。 */
export interface ProgrammaticStopMark {
  sessionId: string;
  expiresAt: number;
}

/**
 * 解析停止运行中回合应投递的别名集合（按序去重，忽略空白）。
 *
 * 后端对未知别名是幂等空操作（返回 `was not running`），因此可以安全地全量投递：
 * 全新会话首轮尚未绑定 id 之前用 request id 别名，绑定之后会话 id 别名长期有效。
 */
export function runningTurnStopAliases(input: {
  requestAlias?: string | null;
  sessionId?: string | null;
}): string[] {
  const aliases: string[] = [];
  for (const candidate of [input.requestAlias, input.sessionId]) {
    const alias = candidate?.trim();
    if (alias && !aliases.includes(alias)) aliases.push(alias);
  }
  return aliases;
}

/**
 * 该 `stopped` 终态是否属于「立即发送」发起的程序化停止（一次性抑制标记）。
 *
 * 命中时必须跳过 `restoreQueuedToComposer()`：用户只要求立刻发出这一条，
 * 其余排队卡片与已投递的转向必须原地保留，绝不能整段回吐到输入框或被顺带撤回。
 * 会话 id 不匹配或标记已过期时一律回退到用户主动停止的既有语义。
 */
export function consumesProgrammaticStopMark(
  mark: ProgrammaticStopMark | null | undefined,
  sessionId: string | null | undefined,
  now: number,
): boolean {
  if (!mark) return false;
  const sid = sessionId?.trim();
  if (!sid || sid !== mark.sessionId) return false;
  return now <= mark.expiresAt;
}

/** Minimal terminal-frame shape needed to classify a displaced turn. */
export interface StopTerminalFrame {
  type: string;
  stop_reason?: string;
}

/**
 * Is this terminal frame still reporting the turn that 「立即发送」 displaced?
 *
 * A cancelled turn emits `done(stop_reason=cancelled)` **and** a legacy
 * `stopped`. Both belong to the old turn: settling the connection or clearing
 * busy on them flips the send button back to the arrow while the replacement
 * turn is already streaming. A normal completion (`done` without a cancel/stop
 * reason) must still be honoured.
 */
export function isStaleProgrammaticStopFrame(
  mark: ProgrammaticStopMark | null | undefined,
  frame: StopTerminalFrame,
  sessionId: string | null | undefined,
  now: number,
): boolean {
  if (!consumesProgrammaticStopMark(mark, sessionId, now)) return false;
  if (frame.type === 'stopped') return true;
  return (
    frame.type === 'done' &&
    (frame.stop_reason === 'cancelled' || frame.stop_reason === 'stopped')
  );
}

/**
 * Is a terminal frame arriving **after a new turn was delivered, but before that
 * turn produced any frame**, actually the previous turn's cached terminal?
 *
 * `/chat/watch` re-sends `session_terminal` to a reattaching watcher when the
 * session looks idle. A freshly-drained steer starts its POST a moment later, so
 * the cached `done` can land in between and would otherwise clear `busy` / close
 * the new connection: the send button flips back to the arrow while the agent is
 * running ("fake stop"). A turn that already produced a frame owns the next
 * terminal, and the window expires so a genuinely silent failure cannot wedge it.
 */
export function isStaleTerminalForArmedTurn(input: {
  armedAt?: number;
  frameSeen: boolean;
  now: number;
  ttlMs?: number;
}): boolean {
  if (input.armedAt == null) return false;
  if (input.frameSeen) return false;
  return input.now - input.armedAt <= (input.ttlMs ?? 15_000);
}

/**
 * 这一条停止别名是否允许紧接着投递下一回合。
 *
 * `released: true` 是权威结论。`was not running` 是幂等空操作（别名本来就没占槽），
 * 不能拿它否决同一次停止里真正停掉的那条别名——否则「立即发送」会整段跳过投递，
 * 消息只留在磁盘上，刷新才出现。
 * 仍在运行（`released: false` 且文案不是 was not running）必须继续等待。
 */
export function stopAliasAllowsNextTurn(result: {
  released?: boolean;
  message?: string | null;
}): boolean {
  if (result.released !== false) return true;
  return /was not running/i.test(result.message ?? '');
}
