/**
 * Session canvas projection.
 *
 * OpenCode stores each message and part by id, and keeps todos as their own
 * document (`todo.updated`). This daemon's SSE stream has call ids and text
 * deltas, not part ids, so copying that store would invent a second identity
 * the server does not send.
 *
 * Cold start, incognito, another browser, `/chat/watch`, the primary `/chat`
 * stream, and the disk poll all update the canvas through this module:
 * disk is the settled transcript, the server todo list is the checklist,
 * and a live event may only extend what is not already painted.
 */

import { appendReasoningPart, type MsgPart } from './toolRows.ts';
import { isSteerUserMessage } from './turnTimer.ts';
import {
  DISPLAY_TRUNCATION_MARK,
  reconcileRunningTranscript,
  transcriptHasOpenUserTurn,
  unpaintedReplaySuffix,
  userMessageAlreadyOnCanvas,
  userTextsMatch,
  visibleUserText,
  withoutDisplayTruncation,
} from './chatTerminal.ts';
import {
  applyLiveTodoToolCall,
  restoreStickyTodos,
  stickyFromDiskCatchUp,
  todoBaselineForLiveApply,
  todoCallIdsFromMessages,
  type TodoItem,
} from './todos.ts';

export interface ProjectionMessage {
  role: string;
  parts: MsgPart[];
  ts?: number;
  /** 管线身份（kernel message id）。增量事件按此定向落笔，而非盲写“最后一条”。 */
  id?: string;
  /** 客户端关联键（`client_input_id`）：乐观气泡的幂等身份。随缓存/IDB 持久化，
   *  重放/刷新/异地端都能据此判定“这条提问已经在画布上”，无需猜文本。 */
  clientInputId?: string;
  /** 绝对转录下标：跨窗口/分页唯一的身份（右栏锚点、历史合并排序都用它）。 */
  sourceIndex?: number;
}

/**
 * 归属消息定位：`messageId` 命中画布上的 assistant 消息时返回其下标，否则 -1。
 * 1. 优先按 message.id 直接比对；
 * 2. 兼容一轮多 round：若某个部件（part）由该 round 生成（part.id 以 `${messageId}:` 开头），
 *    同样精确归属于包含该部件的 assistant 消息，彻底根治多轮工具后正文重放找不到宿主的隐患！
 */
export function identifiedAssistantIndex(
  messages: Array<{ role: string; id?: string; parts?: MsgPart[] }>,
  messageId?: string,
): number {
  if (!messageId) return -1;
  const prefix = `${messageId}:`;
  const index = messages.findIndex((message) => {
    if (message.role !== 'assistant') return false;
    if (message.id === messageId) return true;
    return message.parts?.some((p) =>
      ('id' in p && typeof p.id === 'string' && (p.id === messageId || p.id.startsWith(prefix)))
    );
  });
  return index >= 0 ? index : -1;
}

/**
 * Bind the STORED identity of the user prompt to its optimistic bubble.
 *
 * A refresh/switch/replay must keep the bubble on the same id the transcript
 * carries; the live `user` echo cannot carry it (the kernel assigns the id when
 * it pushes the message), so the identity arrives as its own boundary event.
 *
 * Targets the newest user row (a turned-in steer takes its id from the steer
 * payload instead). Never reuses an id that already exists, and returns the
 * same array when there is nothing to bind.
 */
export function bindUserMessageIdentity<T extends ProjectionMessage>(
  messages: T[],
  messageId?: string,
): T[] {
  if (!messageId) return messages;
  if (messages.some((message) => message.id === messageId)) return messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== 'user') continue;
    const next = messages.slice();
    next[i] = { ...message, id: messageId };
    return next;
  }
  return messages;
}

export interface SessionSurface<T> {
  messages: T[];
  todos: TodoItem[] | null;
  appliedTodoIds: string[];
}

/** First paint for a browser with no memory: incognito, restart, another machine. */
export function hydrateSession<T>(
  messages: T[],
  serverTodos: TodoItem[] | null | undefined,
  stashedTodos?: TodoItem[] | null,
): SessionSurface<T> {
  return {
    messages,
    todos: restoreStickyTodos({
      messages: messages as Parameters<typeof restoreStickyTodos>[0]['messages'],
      stashed: stashedTodos,
      authoritativeTodos: serverTodos ?? null,
    }),
    appliedTodoIds: todoCallIdsFromMessages(
      messages as Parameters<typeof todoCallIdsFromMessages>[0],
    ),
  };
}

/**
 * Stamp the streaming assistant message + its trailing text/reasoning part with
 * the wire identity (message_id / part_id), so render keys and cache merges are
 * id-based for LIVE output too (not only after a disk reload). Pure; returns the
 * same array when nothing changed.
 */
export function withAssistantIdentity<T extends ProjectionMessage>(
  msgs: T[],
  messageId?: string,
  partId?: string,
): T[] {
  if (!messageId && !partId) return msgs;
  if (msgs.length === 0) return msgs;
  let idx = messageId
    ? msgs.findIndex((m) => m.role === 'assistant' && m.id === messageId)
    : -1;
  if (idx < 0) {
    const lastIdx = msgs.length - 1;
    const last = msgs[lastIdx];
    if (!last || last.role !== 'assistant') return msgs;
    if (messageId && last.id && last.id !== messageId) return msgs;
    idx = lastIdx;
  }
  // 同一 message_id 绝不能在两条消息上共存：重复 key 会让 Preact 复用错 DOM，
  // 表现为“老回合的一部分回复渲染到新消息里”。
  if (messageId && msgs.some((m, i) => i !== idx && m.id === messageId)) return msgs;
  const message = msgs[idx]!;
  let changed = false;
  let id = message.id;
  if (messageId && !id) {
    id = messageId;
    changed = true;
  }
  let parts = message.parts;
  if (partId && parts.length > 0) {
    const pi = parts.length - 1;
    const p = parts[pi];
    if (p && (p.kind === 'text' || p.kind === 'reasoning') && !p.id) {
      parts = parts.slice();
      parts[pi] = { ...p, id: partId };
      changed = true;
    }
  }
  if (!changed) return msgs;
  const next = msgs.slice();
  next[idx] = { ...message, id, parts } as T;
  return next;
}

/**
 * Background-session cache delta (the user is viewing another session).
 *
 * Uses the SAME identity contract as the live canvas path: the row that receives
 * the delta is stamped with the wire `message_id`. Without the stamp a later
 * `/chat/watch` replay of that round cannot be routed back to its own bubble and
 * the projection appends it to the newest assistant message instead — the
 * "old body / reasoning repainted into the latest agent reply" bug after a
 * refocus or a switch-back (a turn with a steer has more than one assistant row,
 * so "the last assistant" is a different round).
 */
export function paintCachedAssistantDelta<T extends ProjectionMessage>(
  messages: T[],
  part: 'text' | 'reasoning',
  content: string,
  identity?: { messageId?: string; partId?: string },
): T[] {
  const painted = part === 'text'
    ? paintAssistantText(messages, content, false, identity?.messageId, identity?.partId)
    : paintAssistantReasoning(messages, content, false, identity?.messageId, identity?.partId);
  return withAssistantIdentity(painted, identity?.messageId, identity?.partId);
}

/**
 * Disk poll. A running turn keeps the live tail. A finished turn takes the
 * file, and the checklist comes from the server list rather than a short
 * window fold. Returns the same message array when nothing changed so React
 * does not repaint the transcript.
 */
export function catchUpSession<T extends ProjectionMessage>(input: {
  messages: T[];
  disk: T[];
  running: boolean;
  adoptSettledDisk: boolean;
  serverTodos?: TodoItem[] | null;
  stashedTodos?: TodoItem[] | null;
}): { messages: T[]; todos: TodoItem[] | null | undefined } {
  const messages = input.running
    ? reconcileRunningTranscript(input.messages, input.disk)
    : input.adoptSettledDisk
      ? input.disk
      : input.messages;
  const todos = stickyFromDiskCatchUp({
    running: input.running,
    messages,
    stashed: input.stashedTodos,
    authoritativeTodos: input.serverTodos,
  });
  return { messages, todos };
}

/** Working... renders only on an empty assistant. A running turn whose last
 *  row is still the user prompt needs that placeholder or observers never
 *  show it. Returns the same array when the tail is already an assistant. */
export function ensureWorkingAssistant<T extends ProjectionMessage>(messages: T[]): T[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') return messages;
  return [...messages, { role: 'assistant', parts: [] } as unknown as T];
}

/** `/chat/watch` is the only canvas stream. A new user row needs the empty
 *  assistant behind it, or Working never renders. `repeatAfterSettled` appends
 *  the same words again after the previous turn already has an answer — an
 *  observer's next send, not a replay of the open turn. */
export function lastAssistantHasAnswer<T extends ProjectionMessage>(messages: T[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'assistant') {
      return m.parts.some((p) => p.kind === 'text' && (p.text || '').trim().length > 0);
    }
    if (m?.role === 'user') {
      break;
    }
  }
  return false;
}

export function paintUserMessage<T extends ProjectionMessage>(
  messages: T[],
  rawText: string,
  userTs: number,
  create: (base: T[]) => T,
  opts?: { repeatAfterSettled?: boolean; clientInputId?: string },
): T[] {
  const clientInputId = opts?.clientInputId;
  if (clientInputId) {
    // 1. 身份幂等：同一条关联键已经在画布/缓存的行上（随缓存持久化）。
    if (messages.some((message) => message.clientInputId === clientInputId)) return messages;
    // 2. 键没见过 ≠ 新消息：磁盘投影 / 旧缓存里的同一条提问没有这个键。必须再用
    //    文本 + 时间戳判定是不是**同一次发送的重放** —— 否则回放会把用户气泡重新
    //    追加到末尾，紧随其后的正文/工具帧再落到这个新气泡里，表现为“提问错位 + 回复重复”。
    const sameSend = findSameSendUserIndex(messages, rawText, userTs);
    if (sameSend >= 0) {
      const row = messages[sameSend]!;
      if (row.clientInputId) return messages; // 已被其它发送占用
      const next = messages.slice();
      next[sameSend] = { ...row, clientInputId } as T;
      return next;
    }
    // 3. 确实是新的一次发送（可能是又发了一遍同样的内容）→ 追加，跳过模糊文本启发式。
    const appended = paintUserMessageInner(messages, rawText, userTs, create, {
      repeatAfterSettled: opts?.repeatAfterSettled,
      identityKnown: true,
    });
    return stampUserClientInputId(appended, clientInputId);
  }
  return paintUserMessageInner(messages, rawText, userTs, create, {
    repeatAfterSettled: opts?.repeatAfterSettled,
    identityKnown: false,
  });
}

/**
 * 文本命中的旧提问是不是「同一次发送」的重放（而不是用户又发了一遍相同内容）。
 *
 * - 行上有时间戳且与本次相差 ≤ 3s → 同一次发送；
 * - 行上没有时间戳（旧投影/legacy）→ 保守视为同一次发送，宁可幂等也不克隆；
 * - 时间戳明显不同 → 真的是新的发送，返回 -1 让调用方追加。
 */
function findSameSendUserIndex(
  messages: ProjectionMessage[],
  rawText: string,
  userTs: number,
): number {
  const want = visibleUserText(rawText);
  if (!want) return -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== 'user') continue;
    const text = visibleUserText(
      message.parts?.filter((part) => part.kind === 'text').map((part) => part.text || '').join('') ?? '',
    );
    if (!userTextsMatch(text, want)) continue;
    if (message.ts && userTs > 0 && Math.abs(message.ts - userTs) > 3000) return -1;
    return i;
  }
  return -1;
}

/** 给画布上最新的一条 user 行盖上客户端关联键（幂等；行已被别的发送占用则不动）。 */
export function stampUserClientInputId<T extends ProjectionMessage>(
  messages: T[],
  clientInputId?: string,
): T[] {
  if (!clientInputId) return messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== 'user') continue;
    if (message.clientInputId === clientInputId) return messages;
    if (message.clientInputId) return messages;
    const next = messages.slice();
    next[i] = { ...message, clientInputId } as T;
    return next;
  }
  return messages;
}

/**
 * 用回放的身份帧（`user_identified.absolute_index`）回填提问行的绝对下标，
 * 并按该下标把这一行**重排回正确位置**（渲染按数组序，光盖字段不改可见位置）。
 *
 * 回放里“被折叠线切掉的提问”由客户端重建，天然没有下标；服务端在身份帧里带上
 * 真实下标后就能直接归位。只处理“还没有下标”的行：磁盘投影行已有权威下标，绝不动。
 */
export function stampUserSourceIndex<T extends ProjectionMessage>(
  messages: T[],
  messageId: string | undefined,
  sourceIndex: number | undefined,
): T[] {
  if (
    !messageId ||
    typeof sourceIndex !== 'number' ||
    !Number.isFinite(sourceIndex) ||
    sourceIndex < 0
  ) {
    return messages;
  }
  const index = messages.findIndex((message) => message.role === 'user' && message.id === messageId);
  if (index < 0) return messages;
  const row = messages[index]!;
  if (typeof row.sourceIndex === 'number') return messages;

  const rest = messages.slice(0, index).concat(messages.slice(index + 1));
  const stamped = { ...row, sourceIndex } as T;
  // 插到“第一个绝对下标更大”的行之前；没有则放末尾（在途新行）。
  let insertAt = rest.findIndex(
    (message) => typeof message.sourceIndex === 'number' && message.sourceIndex > sourceIndex,
  );
  if (insertAt < 0) insertAt = rest.length;
  const next = rest.slice();
  next.splice(insertAt, 0, stamped);
  return next;
}

function paintUserMessageInner<T extends ProjectionMessage>(
  messages: T[],
  rawText: string,
  userTs: number,
  create: (base: T[]) => T,
  opts?: { repeatAfterSettled?: boolean; identityKnown?: boolean },
): T[] {
  const userText = visibleUserText(rawText);
  // 身份权威（服务端回传了 client_input_id）时，全部文本启发式一律跳过：
  // 「同文不同发」是两条真实消息，文本去重会把它当回声吞掉；而真正的重放已由
  // 顶部的身份幂等 + 行上盖的关联键挡住。只有身份缺失（legacy daemon /
  // 第三方客户端）才启用下面的文本兜底。
  if (!opts?.identityKnown) {
    // 核心硬防线：若画布上最后一条用户提问文本与当前完全一致，且助手尚未产生回答，绝对禁止重复追加！
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUser) {
      const lastText = visibleUserText(
        lastUser.parts?.filter((p) => p.kind === 'text').map((p) => p.text || '').join('') ?? '',
      );
      if (userTextsMatch(lastText, userText) && !lastAssistantHasAnswer(messages)) {
        return ensureWorkingAssistant(messages);
      }
    }
    const echoed = userMessageAlreadyOnCanvas(messages, userText, userTs);
    const hasAnswer = lastAssistantHasAnswer(messages);
    if (echoed && (!opts?.repeatAfterSettled || !hasAnswer)) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i]!;
        if (message.role !== 'user') continue;
        const curText = visibleUserText(
          message.parts.filter((p) => p.kind === 'text').map((p) => p.text || '').join(''),
        );
        if (userTextsMatch(curText, userText)) {
          if (message.ts == null || message.ts === 0) {
            const next = messages.slice();
            next[i] = { ...message, ts: userTs };
            return ensureWorkingAssistant(next);
          }
          return ensureWorkingAssistant(messages);
        }
      }
      return ensureWorkingAssistant(messages);
    }
  }
  let base = messages;
  const last = messages[messages.length - 1];
  if (last && last.role === 'assistant' && (!last.parts || last.parts.length === 0)) {
    base = messages.slice(0, -1);
  }
  return [
    ...base,
    create(base),
    { role: 'assistant', parts: [] } as unknown as T,
  ];
}

export interface TurnUserAnchor {
  messageId?: string;
  toolId?: string;
}

function turnAnchorIndex<T extends ProjectionMessage>(messages: T[], before?: TurnUserAnchor): number {
  if (before?.messageId) {
    const idx = identifiedAssistantIndex(messages, before.messageId);
    if (idx >= 0) return idx;
  }
  if (before?.toolId) {
    const idx = messages.findIndex(
      (message) =>
        message.role === 'assistant' &&
        message.parts.some((part) => part.kind === 'tool' && part.tool.id === before.toolId),
    );
    if (idx >= 0) return idx;
  }
  return -1;
}

/**
 * 把被首屏切掉的这一轮提问插回该轮助手内容前面。
 * 已经在画布上则不动。这一轮还不在页上时，按新回合追加到末尾。
 * 连续多条（开场提问、中途 steer）按到达顺序排在锚点前面，不能叠到回答下面。
 */
export function placeRecoveredTurnUsers<T extends ProjectionMessage>(
  messages: T[],
  events: Array<{
    type: string;
    content?: string;
    created_at?: number;
    message_id?: string;
    client_input_id?: string;
    /** 绝对转录下标（调用方按会话大纲补上）。有了它就能精确归位，不再靠“碰巧命中的锚点”。 */
    source_index?: number;
  }>,
  before?: TurnUserAnchor,
): T[] {
  let next = messages;
  let cursor: number | null = null;
  let insertedAt: number | null = null;
  for (const event of events) {
    if (event.type === 'user_identified' && event.message_id && insertedAt != null) {
      const row = next[insertedAt];
      if (
        row &&
        row.role === 'user' &&
        !row.id &&
        !next.some((message) => message.id === event.message_id)
      ) {
        const copy = next.slice();
        copy[insertedAt] = { ...row, id: event.message_id };
        next = copy;
      }
      continue;
    }
    if (event.type !== 'user' || typeof event.content !== 'string') continue;
    // 客户端关联键已在画布上 → 同一条提问已画过，绝不再补一份。
    if (
      event.client_input_id &&
      next.some((message) => message.clientInputId === event.client_input_id)
    ) {
      continue;
    }
    const userTs = event.created_at && event.created_at > 0 ? event.created_at : Date.now();
    // 绝对下标是唯一身份：画布上（pinned 主机键/磁盘行）已经有这一行就说明这条提问
    // 已画过，绝不能再补一份。
    if (
      typeof event.source_index === 'number' &&
      next.some((message) => message.sourceIndex === event.source_index)
    ) {
      continue;
    }
    // 核心硬防线：若画布上最后一条用户提问文本与当前完全一致，且助手尚未产生回答，直接跳过
    const lastUser = [...next].reverse().find((m) => m.role === 'user');
    if (lastUser) {
      const lastText = visibleUserText(
        lastUser.parts?.filter((p) => p.kind === 'text').map((p) => p.text || '').join('') ?? '',
      );
      if (userTextsMatch(lastText, visibleUserText(event.content)) && !lastAssistantHasAnswer(next)) {
        continue;
      }
    }
    if (userMessageAlreadyOnCanvas(next, event.content, userTs)) continue;
    const isSteer = isSteerUserMessage({ role: 'user', content: event.content });
    const userText = visibleUserText(event.content);
    const eventImages = Array.isArray((event as any).images) && (event as any).images.length > 0 ? (event as any).images : undefined;
    // 关键防呆：若既无可见文本也无图片附件，绝不能生成空用户气泡！
    if (!userText && !eventImages) continue;
    const row = {
      role: 'user',
      parts: [{ kind: 'text', text: userText }],
      ts: userTs,
      ...(eventImages ? { images: eventImages } : {}),
      ...(isSteer ? { isSteer: true } : {}),
      ...(typeof event.source_index === 'number' ? { sourceIndex: event.source_index } : {}),
      ...(event.message_id ? { id: event.message_id } : {}),
      ...(event.client_input_id ? { clientInputId: event.client_input_id } : {}),
    } as T;
    if (typeof event.source_index === 'number') {
      // 有绝对下标就按序插入，而不是看“碰巧命中的锚点”：被折叠线切掉的开场提问
      // 必须回到它在窗口里的真实顺序位置（通常就是窗口最前面），否则它会落在
      // 48 行折叠线附近，随后又被 mergeOlderMessages 排到末尾。
      const target = next.findIndex(
        (message) =>
          typeof message.sourceIndex === 'number' && message.sourceIndex > event.source_index!,
      );
      const pos = target >= 0 ? target : next.length;
      const copy = next.slice();
      copy.splice(pos, 0, row);
      insertedAt = pos;
      cursor = pos + 1;
      next = copy;
      continue;
    }
    if (cursor == null) cursor = turnAnchorIndex(next, before);
    if (cursor < 0) {
      const painted = paintUserMessage(next, event.content, userTs, () => row);
      insertedAt = Math.max(0, painted.length - 2);
      cursor = painted.length - 1;
      next = painted;
      continue;
    }
    const copy = next.slice();
    copy.splice(cursor, 0, row);
    insertedAt = cursor;
    cursor += 1;
    next = copy;
  }
  return next;
}

export function paintAssistantText<T extends ProjectionMessage>(
  messages: T[],
  content: string,
  replay: boolean,
  /** 管线身份：命中则把增量落回该消息（迟到尾流必须回到原回合）。 */
  targetId?: string,
  /** 部件身份：回放帧的累积文本按 part 定向合并，不能拿整条消息的正文拼接做基线。 */
  partId?: string,
): T[] {
  const target = identifiedAssistantIndex(messages, targetId);
  if (target >= 0) {
    const parts = mergeTextIntoParts(messages[target]!.parts, content, replay, partId);
    if (!parts) return messages;
    const next = messages.slice();
    next[target] = { ...messages[target]!, parts };
    return next;
  }
  // 身份未命中：这帧属于画布上还没有的轮（新一轮 / 迟到尾流）→ 直接落到当前气泡。
  // 不再用「跨轮隔离」猜测拦截：帧身份由线协议（轮编号 + 游标）给出，未命中就是新的。
  if (messages.length === 0) {
    if (!content) return messages;
    return [{ role: 'assistant', parts: [{ kind: 'text', text: content }] } as unknown as T];
  }
  let last = messages[messages.length - 1]!;
  let base = messages;
  if (!last || last.role !== 'assistant') {
    last = { role: 'assistant', parts: [] } as unknown as T;
    base = [...messages, last];
  }
  const parts = mergeTextIntoParts(last.parts, content, replay, partId);
  if (!parts) return messages;
  return [...base.slice(0, -1), { ...last, parts }];
}

/** 合并一段正文增量；返回 null 表示重播去重后无新内容可落笔。
 *
 * 回放帧（replay=true）必须按 part 身份定向合并：
 * - 已画过的 part 再次回放（重连/刷新）：命中同一 part 后增量是既有文本的后缀 → 去重为空；
 * - 在途 part 的迟到尾段：只补上与已有部分不重叠的后缀；
 * - 帧声明了段身份但画布上没有这一段 → 它就是新的一段，直接追加；
 * - 未命中轮编号且末尾气泡属于另一轮（startNewPart）→ 另起部件，绝不跨轮粘连。
 */
function mergeTextIntoParts(parts: MsgPart[], content: string, replay: boolean, partId?: string): MsgPart[] | null {
  if (!content) return null;

  // 1. 直播流式输出（replay === false）：
  // 每一帧都是真实 LLM 实时增量 token，由后端 SSE 游标（AtomicU64 seq）保证单调性与不重发。
  // 绝对严禁执行任何子串包含去重（includes），直接就地追加！
  if (!replay) {
    if (partId) {
      const index = parts.findIndex((part) => part.kind === 'text' && part.id === partId);
      if (index >= 0) {
        const next = parts.slice();
        const p = next[index] as { kind: 'text'; text: string; id?: string };
        const existing = (p.text || '').trim();
        const incoming = content.trim();
        // 关键防线：即使 replay 为 false（网络重连/未打序号），若整段长内容已完全存在，绝不重复翻倍追加
        if (incoming.length > 20 && (existing === incoming || existing.endsWith(incoming))) {
          return parts;
        }
        next[index] = { ...p, text: (p.text || '') + content };
        return next;
      }
    }
    const tail = parts[parts.length - 1];
    const isDifferentPart = !!tail && tail.kind === 'text' && !!tail.id && !!partId && tail.id !== partId;
    if (tail && tail.kind === 'text' && !isDifferentPart) {
      const existing = (tail.text || '').trim();
      const incoming = content.trim();
      if (incoming.length > 20 && (existing === incoming || existing.endsWith(incoming))) {
        return parts;
      }
      const next = parts.slice();
      next[next.length - 1] = { kind: 'text', text: (tail.text || '') + content, id: tail.id ?? partId };
      return next;
    }
    return [...parts, { kind: 'text', text: content, ...(partId ? { id: partId } : {}) }];
  }

  // 2. 重放帧（replay === true）：
  const replaced = replaceTruncatedParts(parts, 'text', content);
  if (replaced) return replaced;

  // 若 partId 精确命中已有正文部件，执行权威身份幂等对账
  if (partId) {
    const index = parts.findIndex((part) => part.kind === 'text' && part.id === partId);
    if (index >= 0) {
      const existing = (parts[index] as { text: string }).text || '';
      const body = withoutDisplayTruncation(existing);
      if (body.includes(content)) return null;
      if (content.startsWith(body)) {
        const next = parts.slice();
        next[index] = { kind: 'text', text: content, id: partId };
        return next;
      }
      const suffix = unpaintedReplaySuffix(existing, content);
      if (!suffix) return null;
      const next = parts.slice();
      next[index] = { kind: 'text', text: body + suffix, id: partId };
      return next;
    }
  }

  // 未携带 partId 或未命中时，对已有全部正文计算未画过的重放后缀
  const painted = parts.map((part) => (part.kind === 'text' ? part.text || '' : '')).join('');
  const delta = unpaintedReplaySuffix(painted, content);
  if (!delta) return null;

  const tail = parts[parts.length - 1];
  const isDifferentPart = !!tail && tail.kind === 'text' && !!tail.id && !!partId && tail.id !== partId;
  if (tail && tail.kind === 'text' && !isDifferentPart) {
    let merged = tail.text + delta;
    const next = parts.slice();
    next[next.length - 1] = { kind: 'text', text: merged, id: tail.id ?? partId };
    return next;
  }

  return [...parts, { kind: 'text', text: delta, ...(partId ? { id: partId } : {}) }];
}

export function paintAssistantReasoning<T extends ProjectionMessage>(
  messages: T[],
  content: string,
  replay: boolean,
  /** 管线身份：命中则把思考增量落回该消息（迟到尾流必须回到原回合）。 */
  targetId?: string,
  /** 部件身份：回放帧按 part 定向合并，避免整段思考被重打。 */
  partId?: string,
): T[] {
  const cleanContent = content.trim();
  if (!cleanContent) return messages;

  const target = identifiedAssistantIndex(messages, targetId);
  if (target >= 0) {
    const parts = mergeReasoningIntoParts(messages[target]!.parts, content, replay, partId);
    if (!parts) return messages;
    const next = messages.slice();
    next[target] = { ...messages[target]!, parts };
    return next;
  }
  // 身份未命中：同 paintAssistantText —— 未命中的帧就是画布上还没有的轮，直接落笔。

  let last = messages[messages.length - 1];
  let base = messages;
  if (!last || last.role !== 'assistant') {
    last = { role: 'assistant', parts: [] } as unknown as T;
    base = [...messages, last];
  }
  const parts = mergeReasoningIntoParts(last.parts, content, replay, partId);
  if (!parts) return messages;
  return [...base.slice(0, -1), { ...last, parts }];
}

/** 合并一段思考增量；返回 null 表示重播去重后无新内容可落笔。 */
function mergeReasoningIntoParts(parts: MsgPart[], content: string, replay: boolean, partId?: string): MsgPart[] | null {
  const cleanContent = content.trim();
  if (!cleanContent) return null;

  // 1. 直播流式输出（replay === false）：
  // 思考增量直接并入当前思考部件，绝不能对思考文本做子串去重！
  if (!replay) {
    if (partId) {
      const index = parts.findIndex((part) => part.kind === 'reasoning' && part.id === partId);
      if (index >= 0) {
        const next = parts.slice();
        const p = next[index] as { kind: 'reasoning'; text: string; id?: string };
        next[index] = { ...p, text: (p.text || '') + content };
        return next;
      }
    }
    const tail = parts[parts.length - 1];
    const isDifferentPart = !!tail && tail.kind === 'reasoning' && !!tail.id && !!partId && tail.id !== partId;
    if (tail && tail.kind === 'reasoning' && !isDifferentPart) {
      const next = parts.slice();
      next[next.length - 1] = { kind: 'reasoning', text: (tail.text || '') + content, id: tail.id ?? partId };
      return next;
    }
    return appendReasoningPart(parts, content, partId);
  }

  // 2. 重放帧（replay === true）：
  const replaced = replaceTruncatedParts(parts, 'reasoning', content);
  if (replaced) {
    return replaced === parts ? null : replaced;
  }

  const existingIdx = partId
    ? parts.findIndex((p) => p.kind === 'reasoning' && p.id === partId)
    : (parts[parts.length - 1]?.kind === 'reasoning' ? parts.length - 1 : -1);

  if (existingIdx >= 0) {
    const p = parts[existingIdx] as { kind: 'reasoning'; text: string; id?: string };
    const existing = (p.text || '').trim();
    // 已有思考已包含该重放内容 → 幂等丢弃
    if (existing === cleanContent || existing.includes(cleanContent)) {
      return null;
    }
    // 新内容是已有思考的延伸（累积帧）→ 原地更新！
    if (cleanContent.startsWith(existing)) {
      const nextParts = parts.slice();
      nextParts[existingIdx] = { ...p, text: content, id: p.id ?? partId };
      return nextParts;
    }
    // 未画过的增量后缀 → 原地追加到该思考部件尾部！
    const suffix = unpaintedReplaySuffix(p.text || '', content);
    if (!suffix) return null;
    const nextParts = parts.slice();
    nextParts[existingIdx] = { ...p, text: (p.text || '') + suffix, id: p.id ?? partId };
    return nextParts;
  }

  // 如果画布上尚无思考部件，才在末尾开启新的思考部件
  return appendReasoningPart(parts, content, partId);
}

/** Disk stored a capped field. The replay is the same text plus what was cut
 *  off. Replace that part in place so the cut-off tail is not painted again
 *  as a second Thinking block, and later prose still follows the original part. */
function replaceTruncatedParts(
  parts: MsgPart[],
  kind: 'text' | 'reasoning',
  incoming: string,
): MsgPart[] | null {
  if (!incoming) return null;
  const index = parts.findIndex((part) =>
    (part.kind === kind) && (part.text || '').endsWith(DISPLAY_TRUNCATION_MARK),
  );
  if (index < 0) return null;
  const part = parts[index]!;
  if (part.kind !== kind) return null;
  const body = withoutDisplayTruncation(part.text || '');
  if (!body || !incoming.startsWith(body)) return null;
  if (incoming === body) {
    const next = parts.slice();
    next[index] = { kind, text: body };
    return next;
  }
  const next = parts.slice();
  next[index] = { kind, text: incoming };
  return next;
}

/** Chunk still worth appending. Empty means the replay is already on the row. */
export function visibleToolChunk(
  parts: MsgPart[],
  callId: string | undefined,
  chunk: string,
  replay: boolean,
): string {
  if (!replay) return chunk;
  const row = callId
    ? parts.find((part) => part.kind === 'tool' && part.tool.id === callId)
    : [...parts].reverse().find((part) => part.kind === 'tool');
  const painted = row && row.kind === 'tool' ? row.tool.output ?? '' : '';
  return unpaintedReplaySuffix(painted, chunk);
}

export function foldLiveTodo(input: {
  state: TodoItem[] | null | undefined;
  remembered: TodoItem[] | null | undefined;
  name: string;
  args: string;
  callId?: string;
  appliedIds: Set<string>;
}): TodoItem[] | null {
  return applyLiveTodoToolCall({
    current: todoBaselineForLiveApply(input.state, input.remembered),
    name: input.name,
    args: input.args,
    callId: input.callId,
    appliedIds: input.appliedIds,
  });
}

/**
 * 将非致命黄色通知（如上下文压缩、系统提示、重连告警）作为独立的 notice 部件
 * 严格按顺序追加到当前助手的部件流中（即使末尾尚未生成 assistant，也会安全开启一个容器）。
 */
export function paintAssistantNotice<T extends ProjectionMessage>(
  messages: T[],
  text: string,
  targetId?: string,
): T[] {
  if (!text) return messages;
  if (messages.length === 0) {
    return [{ role: 'assistant', parts: [{ kind: 'notice', text }] } as unknown as T];
  }
  // 重放幂等：同一条提示已经在目标行 / 末尾行出现过 → 断线重连重发的回放帧不得再叠一份。
  // （文本/工具帧有后缀去重、用户气泡有身份去重，只有 notice 一直缺这一层，
  //   表现为同一段黄色提示被重连重发的回放帧叠成多份并落到尾部。）
  const hasNotice = (message: ProjectionMessage | undefined): boolean =>
    !!message && message.parts.some((part) => part.kind === 'notice' && part.text === text);
  if (targetId) {
    const target = messages.findIndex((m) => m.role === 'assistant' && m.id === targetId);
    if (target >= 0) {
      const existing = messages[target]!;
      if (hasNotice(existing)) return messages;
      const next = messages.slice();
      next[target] = {
        ...existing,
        parts: [...existing.parts, { kind: 'notice', text }],
      };
      return next;
    }
    // 失败回合还没有 assistant 行：提示属于它自己的提问，必须留在该提问下面，
    // 而不是挂到上一轮回答的底部或下一条 loop 下面。复用/插入一个“只装提示”的
    // assistant 行（空 Working 占位也可复用）。
    const user = messages.findIndex((m) => m.role === 'user' && m.id === targetId);
    if (user >= 0) {
      const nextRow = messages[user + 1];
      const reusable =
        !!nextRow && nextRow.role === 'assistant' && nextRow.parts.every((part) => part.kind === 'notice');
      if (reusable) {
        if (hasNotice(nextRow)) return messages;
        const next = messages.slice();
        next[user + 1] = { ...nextRow, parts: [...nextRow.parts, { kind: 'notice', text }] };
        return next;
      }
      const next = messages.slice();
      next.splice(user + 1, 0, {
        role: 'assistant',
        parts: [{ kind: 'notice', text }],
      } as unknown as T);
      return next;
    }
  }
  const last = messages[messages.length - 1]!;
  if (last.role === 'assistant') {
    if (hasNotice(last)) return messages;
    const next = messages.slice();
    next[next.length - 1] = {
      ...last,
      parts: [...last.parts, { kind: 'notice', text }],
    };
    return next;
  }
  return [
    ...messages,
    { role: 'assistant', parts: [{ kind: 'notice', text }] } as unknown as T,
  ];
}

/** 权威切片里已出现过的身份（行 id / part id / 工具 call id）。 */
interface TailIdentity {
  ids: Set<string>;
  partIds: Set<string>;
  toolIds: Set<string>;
}

function collectTailIdentity<T extends { sourceIndex?: number; id?: string }>(rows: T[]): TailIdentity {
  const identity: TailIdentity = {
    ids: new Set<string>(),
    partIds: new Set<string>(),
    toolIds: new Set<string>(),
  };
  for (const row of rows) {
    if (row.id) identity.ids.add(row.id);
    const parts = (row as { parts?: MsgPart[] }).parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (part.kind === 'tool') {
        if (part.tool?.id) identity.toolIds.add(part.tool.id);
        continue;
      }
      if ((part.kind === 'text' || part.kind === 'reasoning') && part.id) {
        identity.partIds.add(part.id);
      }
    }
  }
  return identity;
}

/**
 * 剔除头部行里已经由权威切片渲染的段；整行都被切片覆盖时返回 null。
 *
 * 行级 id 命中 → 整行丢弃；否则只丢掉「同一 part id / 同一工具 call id」的段。
 * 共存只能说明这行是在途聚合行（例如模型连续 20 多轮只吐思考与工具时，全部段都落在
 * 发送时那条占位行上），保留它就会让整轮回答在权威尾部之后再渲染一遍。
 */
function pruneDuplicatedTailContent<T extends { sourceIndex?: number; id?: string }>(
  row: T,
  identity: TailIdentity,
): T | null {
  if (row.id && identity.ids.has(row.id)) return null;
  const parts = (row as { parts?: MsgPart[] }).parts;
  if (!Array.isArray(parts) || parts.length === 0) return row;
  const kept = parts.filter((part) => {
    if (part.kind === 'tool') return !(part.tool?.id && identity.toolIds.has(part.tool.id));
    if (part.kind === 'text' || part.kind === 'reasoning') {
      return !(part.id && identity.partIds.has(part.id));
    }
    return true;
  });
  if (kept.length === parts.length) return row;
  if (kept.length === 0) return null;
  return { ...row, parts: kept } as T;
}

/**
 * 用磁盘返回的权威尾部切片（diskTail）安全替换画布/缓存的尾部，同时严格保留
 * 画布中早于该切片起始偏移（sourceIndex < diskOffset）的更早历史头部（olderHead）。
 * 既不丢失用户向上翻看过的更早历史，又彻底杜绝内存旧尾部与磁盘新尾部杂交双重渲染！
 *
 * 核心架构铁律：
 * diskTail 包含两部分：
 * 1. pinned 行：sourceIndex < diskOffset（daemon 为首屏展示钉住的开场提问）；
 * 2. actualTail：sourceIndex >= diskOffset（真正的尾部权威数据）。
 * 若画布本身已具有早先历史（olderHead.length > 0），早先提问已处于其天然时序位置（在回答
 * 之前），绝不能从 olderHead 中剔除挪到 diskTail 头部（否则造成提问倒插到回答下方！）。
 * 只有画布无早先历史时，才采用 pinnedInTail。拼接后严格按 sourceIndex 升序对齐与去重。
 *
 * 第三个铁律：头部行不能夹带权威切片里已有的内容。推流期一条助手行可能聚了整轮多个
 * round（模型连续只吐思考与工具时不会结算），这种行一旦因为早期猜出来的下标被当成
 * 「更早历史」保留，整轮回答就会在权威尾部之后重放一遍。因此先按行 id / part id /
 * 工具 call id 把切片已渲染的部分从头部剔除，再拼接。
 */
export function spliceAuthoritativeDiskTail<T extends { sourceIndex?: number; id?: string }>(
  canvas: T[],
  diskTail: T[],
  diskOffset: number,
): T[] {
  if (!canvas || canvas.length === 0) return diskTail;
  if (!diskTail || diskTail.length === 0) return canvas;
  if (diskOffset <= 0) return diskTail;

  const actualTail: T[] = [];
  const pinnedInTail: T[] = [];
  for (const message of diskTail) {
    if (typeof message.sourceIndex === 'number' && message.sourceIndex < diskOffset) {
      pinnedInTail.push(message);
    } else {
      actualTail.push(message);
    }
  }

  // 权威切片已经渲染过的身份。头部行只是「切片之前的更早历史」，一旦它身上带着
  // 切片里的同一份内容，就说明这行是推流期拼出来的在途行（一轮多 round 时思考/工具
  // 全堆在同一条助手消息里），绝不能连同权威副本再渲染一遍。
  //
  // 只按 actualTail 建身份集：pinned 行（sourceIndex < diskOffset）在头部存在时会被
  // 丢弃，不能因为它把画布上同一条提问的本地行（可能带附件）也一起排除。
  const tailIdentity = collectTailIdentity(actualTail);
  const olderHead: T[] = [];
  for (const message of canvas) {
    if (typeof message.sourceIndex !== 'number' || message.sourceIndex >= diskOffset) continue;
    let pruned = pruneDuplicatedTailContent(message, tailIdentity);
    if (pruned) {
      // 若画布行缺失图片（如推流期从无图广播事件生成），而权威磁盘 pinned 提问带图，自动补全图片
      const pinnedMatch = pinnedInTail.find(
        (p) =>
          typeof p.sourceIndex === 'number' &&
          p.sourceIndex === (pruned as any).sourceIndex &&
          Array.isArray((p as any).images) &&
          (p as any).images.length > 0,
      );
      if (pinnedMatch && (!(pruned as any).images || (pruned as any).images.length === 0)) {
        pruned = { ...pruned, images: (pinnedMatch as any).images };
      }
      olderHead.push(pruned);
    }
  }

  const baseHead = olderHead.length > 0 ? olderHead : pinnedInTail;
  const combined = [...baseHead, ...actualTail];

  combined.sort((a, b) => {
    const aSrc = typeof a.sourceIndex === 'number' ? a.sourceIndex : Infinity;
    const bSrc = typeof b.sourceIndex === 'number' ? b.sourceIndex : Infinity;
    return aSrc - bSrc;
  });

  const seenIds = new Set<string>();
  const seenSrc = new Set<number>();
  const result: T[] = [];
  for (const m of combined) {
    if (m.id && seenIds.has(m.id)) continue;
    if (typeof m.sourceIndex === 'number' && seenSrc.has(m.sourceIndex)) continue;
    if (m.id) seenIds.add(m.id);
    if (typeof m.sourceIndex === 'number') seenSrc.add(m.sourceIndex);
    result.push(m);
  }
  return result;
}

/**
 * 清理画布与缓存中的重复与脏节点：
 * 1. 过滤掉连续相邻、完全相同的 User 提问气泡；
 * 2. 如果存在连续的 User 消息（中间只有空 assistant 或无 assistant），且内容重复，折叠为单一提问；
 * 3. 清理掉夹在连续重复提问之间的无用空 assistant 占位符；
 * 4. 确保从 IndexedDB 或历史缓存加载出来的画布是纯净无污染的。
 */
export function sanitizeCanvasMessages<
  T extends { role: string; parts?: MsgPart[]; sourceIndex?: number },
>(messages: T[]): T[] {
  if (!messages || messages.length <= 1) return messages;
  const result: T[] = [];
  for (let i = 0; i < messages.length; i++) {
    const cur = messages[i]!;
    // 1. 如果当前是空助手气泡，且前一个已经是助手气泡，丢弃多余的空助手
    if (cur.role === 'assistant' && (!cur.parts || cur.parts.length === 0)) {
      const prev = result[result.length - 1];
      if (prev && prev.role === 'assistant') {
        continue;
      }
    }
    // 2. 如果当前是用户提问，检查前一个提问是否完全一样且中间无实质回复
    if (cur.role === 'user') {
      const curText = visibleUserText(
        cur.parts?.filter((p) => p.kind === 'text').map((p) => p.text || '').join('') ?? '',
      );
      const curImages = (cur as any).images;
      const hasCurImages = Array.isArray(curImages) && curImages.length > 0;
      // 防呆：既无可见文本也无图片附件的空用户气泡直接剔除
      if (!curText && !hasCurImages) {
        continue;
      }
      let prevUser: T | null = null;
      let hasMeaningfulAssistant = false;
      for (let j = result.length - 1; j >= 0; j--) {
        const prev = result[j]!;
        if (prev.role === 'user') {
          prevUser = prev;
          break;
        }
        if (prev.role === 'assistant') {
          if (
            prev.parts &&
            prev.parts.some(
              (p) =>
                (p.kind === 'text' && (p.text || '').trim()) ||
                p.kind === 'tool' ||
                p.kind === 'reasoning',
            )
          ) {
            hasMeaningfulAssistant = true;
          }
        }
      }
      if (prevUser && !hasMeaningfulAssistant) {
        const prevText = visibleUserText(
          prevUser.parts?.filter((p) => p.kind === 'text').map((p) => p.text || '').join('') ?? '',
        );
        // 两条都是落盘历史且绝对下标不同 → 用户确实连发了同一句话，必须保留。
        // 只有同一行（同下标）或身份未知的旧缓存/乐观回显才折叠。
        const sameAbsoluteRow =
          typeof prevUser.sourceIndex === 'number' &&
          typeof cur.sourceIndex === 'number' &&
          prevUser.sourceIndex === cur.sourceIndex;
        const identityUnknown =
          typeof prevUser.sourceIndex !== 'number' || typeof cur.sourceIndex !== 'number';
        if ((sameAbsoluteRow || identityUnknown) && userTextsMatch(prevText, curText)) {
          // 清除上一个重复提问留下的空助手（如果有的话）
          while (result.length > 0) {
            const tail = result[result.length - 1];
            if (tail && tail.role === 'assistant' && (!tail.parts || tail.parts.length === 0)) {
              result.pop();
            } else {
              break;
            }
          }
          continue;
        }
      }
    }
    result.push(cur);
  }
  return result;
}

function sameImages(
  a?: unknown[],
  b?: unknown[],
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  return left.every((img: any, i) => img?.media_type === (right[i] as any)?.media_type && img?.data === (right[i] as any)?.data);
}

/**
 * 旧缓存 / 回放恢复出来的提问行既没有 id 也没有 sourceIndex：
 * 用「文本 + 时间戳（≤ 3s，缺失时间戳则保守视为同一行）」或「图片指纹 + 时间戳」判断是不是同一条提问。
 */
export function sameUserRow(
  a: { role?: string; parts?: MsgPart[]; ts?: number; images?: unknown[] },
  b: { role?: string; parts?: MsgPart[]; ts?: number; images?: unknown[] },
): boolean {
  if (a.role !== 'user' || b.role !== 'user') return false;
  const textOf = (message: { parts?: MsgPart[] }): string =>
    visibleUserText(
      (message.parts ?? [])
        .filter((part) => part.kind === 'text')
        .map((part) => part.text || '')
        .join(''),
    );
  const left = textOf(a);
  const right = textOf(b);
  const hasText = !!left && !!right;
  const hasImages =
    Array.isArray((a as any).images) &&
    (a as any).images.length > 0 &&
    Array.isArray((b as any).images) &&
    (b as any).images.length > 0;

  if (hasText) {
    if (!userTextsMatch(left, right)) return false;
  } else if (hasImages) {
    if (!sameImages((a as any).images, (b as any).images)) return false;
  } else {
    return false;
  }

  if (a.ts && b.ts) return Math.abs(a.ts - b.ts) <= 3000;
  return true;
}

/**
 * 往前补页时，首屏钉住的那条提问可能已经在画布上。
 * 合并更早历史与现有画布时：
 * 1. 按 id 和 sourceIndex 严格去重，避免重复渲染；
 * 2. 保证所有具备 sourceIndex 的历史消息严格按照服务端绝对索引升序排列；
 *    彻底防止因首屏 pinned 置顶提问在向前翻页拼接时被挤到后续工具调用下方的倒插 BUG！
 * 3. 无 sourceIndex 的在途实时消息保持在末尾原有相对顺序。
 */
export function mergeOlderMessages<
  T extends { id?: string; sourceIndex?: number; role?: string; parts?: MsgPart[]; ts?: number },
>(prev: T[], older: T[]): T[] {
  if (!older || older.length === 0) return prev;
  if (!prev || prev.length === 0) return older;

  const indexedPrev = prev.filter(
    (m): m is T & { sourceIndex: number } => typeof m.sourceIndex === 'number',
  );
  const prevIsSorted = indexedPrev.every(
    (m, i) => i === 0 || m.sourceIndex >= indexedPrev[i - 1]!.sourceIndex,
  );
  if (!prevIsSorted) {
    // Dirty/legacy canvas: keep the deterministic full sort. Index-less rows go
    // last here on purpose; the ordered path below is the normal case.
    return mergeOlderMessagesSorted(prev, older);
  }

  // Ordered path: INSERT older rows into prev instead of re-sorting everything.
  // Re-sorting used to move index-less rows (older L1/L2 caches written before
  // absolute indices existed) to the very end, so the first question appeared
  // below later answers. Insertion preserves every existing row's position;
  // only the newly loaded rows move into their chronological slot.
  const result = prev.slice();
  const seenIds = new Set<string>();
  const seenIndices = new Set<number>();
  for (const m of result) {
    if (m.id) seenIds.add(m.id);
    if (typeof m.sourceIndex === 'number') seenIndices.add(m.sourceIndex);
  }

  for (const m of older) {
    if (m.id && seenIds.has(m.id)) continue;
    if (typeof m.sourceIndex === 'number' && seenIndices.has(m.sourceIndex)) continue;
    // 兼容旧缓存 / 回放恢复出来的行：既无 id 又无绝对下标时，用「文本 + 时间戳」
    // 与更早历史对账。否则同一条提问会被当成新消息重复插入。
    if (m.role === 'user') {
      if (
        !m.id &&
        typeof m.sourceIndex !== 'number' &&
        result.some((candidate) => sameUserRow(candidate, m))
      ) {
        continue;
      }
      // 反向对账：画布上已有的无下标旧行若与这条权威提问是同一句，删掉旧行，
      // 让带绝对下标的版本入座（否则旧行会留在原位形成重复气泡）。
      if (m.id || typeof m.sourceIndex === 'number') {
        for (let i = result.length - 1; i >= 0; i--) {
          const candidate = result[i]!;
          if (
            candidate.role === 'user' &&
            !candidate.id &&
            typeof candidate.sourceIndex !== 'number' &&
            sameUserRow(candidate, m)
          ) {
            result.splice(i, 1);
          }
        }
      }
    }

    let insertAt: number;
    if (typeof m.sourceIndex === 'number') {
      insertAt = result.findIndex(
        (candidate) =>
          typeof candidate.sourceIndex === 'number' && candidate.sourceIndex > m.sourceIndex!,
      );
      if (insertAt < 0) {
        // No greater indexed row: insert after the last indexed row but BEFORE
        // the trailing index-less live rows (streaming assistant, optimistic user).
        insertAt = result.length;
        while (insertAt > 0 && typeof result[insertAt - 1]!.sourceIndex !== 'number') {
          insertAt -= 1;
        }
      }
    } else {
      // 无下标行的两种来源：尚未落盘的直播行（流式助手气泡 / 乐观提问），或整页
      // 都没有绝对下标的旧缓存历史。同一条直播行会同时出现在 L1 全量画布和可视
      // 窗口里（落缓存时取并集），且两份进度可能不同 —— 先按「角色 + 工具调用序列」
      // 对账，文本互为前缀即同一行，保留更新（更长）的那份，绝不能在时间线顶部
      // 多出一条空气泡。提问行走上面的 sameUserRow（文本 + 时间戳），不能被这里
      // 按纯文本吞掉——同文不同发是两条真消息。
      const liveMatch = m.role === 'user' ? null : findIndexLessRow(result, m);
      if (liveMatch) {
        if (liveMatch.disposition === 'skip') continue;
        result[liveMatch.index] = m;
        if (m.id) seenIds.add(m.id);
        continue;
      }
      // 位置：画布尾部本身是无下标行时，它属于正在进行的回合 → 接在末尾；
      // 否则按旧缓存语义插到带下标历史之前。
      const tailIsIndexLess =
        result.length > 0 && typeof result[result.length - 1]!.sourceIndex !== 'number';
      if (tailIsIndexLess) {
        insertAt = result.length;
      } else {
        insertAt = result.findIndex((candidate) => typeof candidate.sourceIndex === 'number');
        if (insertAt < 0) insertAt = result.length;
      }
    }

    result.splice(insertAt, 0, m);
    if (m.id) seenIds.add(m.id);
    if (typeof m.sourceIndex === 'number') seenIndices.add(m.sourceIndex);
  }

  return result;
}

/**
 * 无下标行的流式身份：角色 + 工具调用序列 + 文本/思考拼接。
 *
 * 没有 `id`、也没有绝对下标的行只可能是「尚未落盘」或「旧缓存」。同一条直播行在
 * L1 全量画布与可视窗口里各有一份，且两份的流式进度可能不同，所以文本用前缀关系
 * 判定同一行：短的是长的前缀 → 同一行，保留更长的那份。
 */
function indexLessRowShape(row: { parts?: MsgPart[] }): { tools: string; text: string } {
  const tools: string[] = [];
  let text = '';
  for (const part of row.parts ?? []) {
    if (part.kind === 'tool') tools.push(part.tool?.id ?? '');
    else if (part.kind === 'text' || part.kind === 'reasoning') text += part.text || '';
  }
  return { tools: tools.join('\u0000'), text };
}

function findIndexLessRow<T extends { role?: string; parts?: MsgPart[] }>(
  rows: T[],
  incoming: T,
): { index: number; disposition: 'skip' | 'replace' } | null {
  const want = indexLessRowShape(incoming);
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!;
    if (row.role !== incoming.role) continue;
    const have = indexLessRowShape(row);
    if (have.tools !== want.tools) continue;
    if (have.text === want.text) return { index: i, disposition: 'skip' };
    if (want.text.startsWith(have.text)) return { index: i, disposition: 'replace' };
    if (have.text.startsWith(want.text)) return { index: i, disposition: 'skip' };
  }
  return null;
}

/**
 * Does the cached canvas actually reach the authoritative tail?
 *
 * Splicing a cached head that ends hundreds of rows before `diskOffset` leaves
 * a hole between the two windows: the page is rendered, but everything between
 * the cache head and the disk tail is missing. Such a cache must be discarded
 * in favour of the tail (a contiguous cache ends at `diskOffset - 1` or overlaps
 * the tail with newer rows).
 */
export function cachedHeadIsContiguous(
  cachedMessages: Array<{ sourceIndex?: number }> | undefined,
  diskOffset: number,
): boolean {
  if (!cachedMessages || cachedMessages.length === 0) return false;
  const indices = Array.from(
    new Set(
      cachedMessages
        .map((message) => message.sourceIndex)
        .filter((index): index is number => typeof index === 'number'),
    ),
  ).sort((a, b) => a - b);
  if (indices.length === 0) return false;

  // A cached HEAD + the authoritative TAIL with a missing middle used to pass
  // the max-only check. "Load older" walks BACKWARD from the cached head, so
  // that hole would never be filled. Display lists can legitimately skip a few
  // filtered internal rows, but a missing page is tens of raw rows; reject a
  // gap larger than half a display page.
  const MAX_INTERNAL_GAP = 24;
  for (let i = 1; i < indices.length; i++) {
    if (indices[i]! - indices[i - 1]! - 1 > MAX_INTERNAL_GAP) return false;
  }
  return indices[indices.length - 1]! >= diskOffset - 1;
}

/**
 * Resolve the paging cursor for a cold start that already has an L1/L2 canvas.
 *
 * The API always answers with a 48-row tail offset. If the cache holds earlier
 * pages, that offset is AHEAD of the canvas head: the next "load earlier"
 * fetches rows already rendered, adds nothing, and only walks the cursor back
 * after several dead clicks. Use the earliest index actually present on the
 * canvas, but never a stale index beyond the authoritative tail offset (old
 * array indices after compaction).
 */
export function resolveHistoryOffset(input: {
  cachedMessages?: Array<{ sourceIndex?: number }>;
  cachedOffset?: number;
  diskOffset: number;
}): number {
  const candidates: number[] = [];
  for (const message of input.cachedMessages ?? []) {
    if (typeof message.sourceIndex === 'number') {
      if (Number.isFinite(message.sourceIndex) && message.sourceIndex >= 0) {
        candidates.push(message.sourceIndex);
      }
    }
  }
  if (
    typeof input.cachedOffset === 'number' &&
    Number.isFinite(input.cachedOffset) &&
    input.cachedOffset >= 0
  ) {
    candidates.push(input.cachedOffset);
  }
  const valid = candidates.filter((index) => index <= input.diskOffset);
  return valid.length > 0 ? Math.min(...valid) : input.diskOffset;
}

/** Legacy fallback for a dirty (non-ascending) canvas: stable full sort. */
function mergeOlderMessagesSorted<
  T extends { id?: string; sourceIndex?: number; role?: string; parts?: MsgPart[]; ts?: number },
>(prev: T[], older: T[]): T[] {
  const seenIds = new Set<string>();
  const seenIndices = new Set<number>();
  const merged: T[] = [];
  for (const m of older) {
    if (m.id) seenIds.add(m.id);
    if (typeof m.sourceIndex === 'number') seenIndices.add(m.sourceIndex);
    merged.push(m);
  }
  for (const m of prev) {
    if (m.id && seenIds.has(m.id)) continue;
    if (typeof m.sourceIndex === 'number' && seenIndices.has(m.sourceIndex)) continue;
    if (
      m.role === 'user' &&
      !m.id &&
      typeof m.sourceIndex !== 'number' &&
      merged.some((candidate) => sameUserRow(candidate, m))
    ) {
      continue;
    }
    if (m.id) seenIds.add(m.id);
    if (typeof m.sourceIndex === 'number') seenIndices.add(m.sourceIndex);
    merged.push(m);
  }
  const indexed = merged.map((item, originalIdx) => ({ item, originalIdx }));
  indexed.sort((a, b) => {
    const aIdx = typeof a.item.sourceIndex === 'number' ? a.item.sourceIndex : null;
    const bIdx = typeof b.item.sourceIndex === 'number' ? b.item.sourceIndex : null;
    if (aIdx !== null && bIdx !== null) {
      if (aIdx !== bIdx) return aIdx - bIdx;
      return a.originalIdx - b.originalIdx;
    }
    if (aIdx !== null && bIdx === null) return -1;
    if (aIdx === null && bIdx !== null) return 1;
    return a.originalIdx - b.originalIdx;
  });
  return indexed.map((x) => x.item);
}
