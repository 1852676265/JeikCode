/**
 * 断线重连 / 回合终态收尾的纯决策函数。
 *
 * 这些判断过去散落在 `Chat.tsx` 的内联条件里，且与 UI 状态机纠缠；一旦写错就是
 * 「僵尸工具行 + 停止按钮永不回落」这类只能在真机（手机长断网）复现的问题：
 *
 *   - 收尾被 `/chat/watch` 观察流条目误判成「本端回合仍在跑」而永久拦截：
 *     观察流断网后永远收不到终态，本地笔记却一直说 `running`，于是磁盘对账永不发生；
 *   - 磁盘对账只在画布为空时才采用，非空画布丢一帧 `tool_result` 就再也不会被修正。
 *
 * 抽成纯函数后：Chat.tsx 只有一条判定来源，单元测试与 Node 复现脚本可直接覆盖。
 */

/** `localActiveStreamsBySessionRef` 条目里判定需要的字段。 */
export interface LocalStreamEntryLike {
  /** `/chat/watch` 观察流注册的条目：只说明“看见它在跑”，不代表本端拥有回合。 */
  watchOnly?: boolean;
  abortController: { signal: { aborted: boolean } };
}

/** 本端是否仍持有一条真正在跑的**发送**流（观察流不算）。 */
export function ownsRunningLocalSend(
  entry: LocalStreamEntryLike | null | undefined,
): boolean {
  return !!entry && entry.watchOnly !== true && !entry.abortController.signal.aborted;
}

export interface AuthoritativeTailInput {
  /** 服务端权威状态：该会话仍有回合在跑。 */
  running: boolean;
  /** 磁盘尾部是否覆盖画布当前轮次的提问（否则磁盘还停在上一轮）。 */
  diskHasUser: boolean;
  /** 磁盘尾部已结算（最后一条助手没有 pending 工具 / 空占位）。 */
  diskSettled: boolean;
  /** 画布尾部仍挂着 pending / waiting 工具或空助手占位。 */
  canvasInFlight: boolean;
  /** 画布尾部还有「状态未知」的工具行（pending / waiting / incomplete）。 */
  canvasUnresolvedTools?: boolean;
  /** 磁盘最后一条助手正文（含思考）长度。 */
  diskLastTextLen: number;
  /** 画布最后一条助手正文（含思考）长度。 */
  canvasLastTextLen: number;
}

/**
 * 是否需要拿磁盘权威尾部校正画布。
 *
 * 只要服务端已结算，并且
 *   • 画布尾部还挂着「运行中」的工具行（断流丢掉了 tool_result / 终态帧），或
 *   • 磁盘末段正文比画布更完整（断流丢掉了最后一段回答），
 * 就必须采用磁盘切片。
 *
 * 注意：**不能要求画布为空** —— 断线重连时画布永远非空，那正是丢帧要修的场景。
 * 反向门槛（`diskLastTextLen > canvasLastTextLen`）保证磁盘尚未回落盘时不会
 * 拿更短的旧尾部把刚流出来的正文覆盖掉。
 */
export function shouldAdoptAuthoritativeTail(input: AuthoritativeTailInput): boolean {
  if (input.running) return false;
  if (!input.diskHasUser || !input.diskSettled) return false;
  return (
    input.canvasInFlight ||
    input.canvasUnresolvedTools === true ||
    input.diskLastTextLen > input.canvasLastTextLen
  );
}

/** 尾部最后一条助手行是否还有「状态未知」的工具（pending / waiting / incomplete）。
 *
 * 终态收尾会把无结果的 pending 落成 incomplete（不能假完成）；一旦磁盘落盘了
 * 真实结果，就必须允许权威尾部把它整行换掉。只扫最后一条助手行，避免历史里
 * 旧的中断行让每次收尾都多读一次磁盘。 */
export function tailAssistantHasUnresolvedTools(
  messages: Array<{ role: string; parts: Array<{ kind: string; tool?: { status?: string } }> }>,
): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.role !== 'assistant') continue;
    return message.parts.some((part) => {
      if (part.kind !== 'tool') return false;
      const status = part.tool?.status;
      return status === 'pending' || status === 'waiting_approval' || status === 'incomplete';
    });
  }
  return false;
}

/** 尾部最后一条助手消息的正文长度（只统计 text/reasoning，工具行不计）。 */
export function lastAssistantTextLen(
  messages: Array<{ role: string; parts: Array<{ kind: string; text?: string }> }>,
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.role !== 'assistant') continue;
    let total = 0;
    for (const part of message.parts) {
      if ((part.kind === 'text' || part.kind === 'reasoning') && part.text) {
        total += part.text.length;
      }
    }
    return total;
  }
  return 0;
}
