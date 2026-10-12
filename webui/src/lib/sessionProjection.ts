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
function lastAssistantHasAnswer<T extends ProjectionMessage>(messages: T[]): boolean {
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
  opts?: { repeatAfterSettled?: boolean },
): T[] {
  const userText = visibleUserText(rawText);
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
  if (last.role !== 'assistant') {
    last = { role: 'assistant', parts: [] } as unknown as T;
    base = [...messages, last];
  }
  // 未命中轮编号：若这是**回放帧**、且末尾气泡属于另一轮（id 不同），它属于新的一轮 ——
  // 必须另起部件，绝不能并进上一轮的正文里（否则两轮正文粘成一段 = 视觉分叉）。
  // 直播帧不加这道判断：它本来就是按序新内容，直接并入当前段（行为不变）。
  const startNewPart = replay && !partId && !!targetId && !!last.id && last.id !== targetId;
  const parts = mergeTextIntoParts(last.parts, content, replay, partId, startNewPart);
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
function mergeTextIntoParts(parts: MsgPart[], content: string, replay: boolean, partId?: string, startNewPart = false): MsgPart[] | null {
  let delta = content;
  if (replay) {
    const replaced = replaceTruncatedParts(parts, 'text', content);
    if (replaced) return replaced;
    if (partId) {
      const index = parts.findIndex((part) => part.kind === 'text' && part.id === partId);
      if (index >= 0) {
        const existing = (parts[index] as { text: string }).text || '';
        const body = withoutDisplayTruncation(existing);
        // 回放帧命中同一 part = 「这段可能已经画过」：
        // 1) 帧内容已在该 part 内（包括从开头重发、中段重发）→ 幂等丢弃；
        // 2) 帧以该 part 为前缀（累积帧更长）→ 只补未画过的后缀；
        // 3) 其余才是真正的新内容 → 追加。
        // 旧实现拿「整条消息所有正文的拼接」做基线：画布已领先时，重发的中段
        // 既非前缀也非后缀，于是被当成新内容再追加一遍（整轮重打的根因）。
        if (!content || body.includes(content)) return null;
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
      // 帧声明了段身份、但画布上没有这一段 → 它是一段新内容，直接追加。
      // 不再拿「整条消息正文拼接」去猜（那套既会漏画也会重画）。
      delta = content;
    } else {
      const painted = parts.map((part) => (part.kind === 'text' ? part.text || '' : '')).join('');
      delta = unpaintedReplaySuffix(painted, content);
      if (!delta) return null;
    }
  }
  const next = parts.slice();
  const tail = next[next.length - 1];
  // 同一 part（或旧数据无身份）才并入尾部文本；part 身份不同、或这帧属于新的一轮，
  // 都必须另起部件保住分段边界（否则重放无法按 part 定向收敛）。
  if (tail && tail.kind === 'text' && !startNewPart && (!partId || !tail.id || tail.id === partId)) {
    let merged = tail.text + delta;
    if (
      tail.text &&
      content &&
      !tail.text.endsWith('\n') &&
      /(?:\.\.\.|…|。)\s*$/.test(tail.text) &&
      /^(正在|Currently |Now )/.test(delta)
    ) {
      merged = `${tail.text}\n${delta}`;
    }
    next[next.length - 1] = { kind: 'text', text: merged, ...(tail.id || !partId ? {} : { id: partId }) };
  } else {
    next.push({ kind: 'text', text: delta, ...(partId ? { id: partId } : {}) });
  }
  return next;
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
  // 同 paintAssistantText：回放帧且末尾属于另一轮 → 思考也必须另起部件。
  const startNewPart = replay && !partId && !!targetId && !!last.id && last.id !== targetId;
  const parts = mergeReasoningIntoParts(last.parts, content, replay, partId, startNewPart);
  if (!parts) return messages;
  return [...base.slice(0, -1), { ...last, parts }];
}

/** 合并一段思考增量；返回 null 表示重播去重后无新内容可落笔。 */
function mergeReasoningIntoParts(parts: MsgPart[], content: string, replay: boolean, partId?: string, startNewPart = false): MsgPart[] | null {
  const cleanContent = content.trim();
  if (replay) {
    const replaced = replaceTruncatedParts(parts, 'reasoning', content);
    if (replaced) {
      return replaced === parts ? null : replaced;
    }
    if (partId) {
      const index = parts.findIndex((part) => part.kind === 'reasoning' && part.id === partId);
      if (index >= 0) {
        const existing = (parts[index] as { text: string }).text || '';
        const body = withoutDisplayTruncation(existing);
        // 同 mergeTextIntoParts：命中同一 part 的回放帧先判「是否已画过」（含中段重发），
        // 否则画布已领先时重发的思考中段会被再追加一遍。
        if (!cleanContent || body.includes(cleanContent)) return null;
        if (content.startsWith(body)) {
          const next = parts.slice();
          next[index] = { kind: 'reasoning', text: content, id: partId };
          return next;
        }
        const suffix = unpaintedReplaySuffix(existing, content);
        if (!suffix) return null;
        const next = parts.slice();
        next[index] = { kind: 'reasoning', text: body + suffix, id: partId };
        return next;
      }
      // 帧声明了段身份但画布上没有这一段 → 新一段思考，直接追加。
      return appendReasoningPart(parts, content, partId);
    }
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]!;
      if (p.kind === 'reasoning' && p.text) {
        const cleanExisting = p.text.trim();
        if (cleanExisting === cleanContent || cleanExisting.includes(cleanContent)) {
          return null;
        }
        if (cleanContent.startsWith(cleanExisting)) {
          const nextParts = parts.slice();
          nextParts[i] = { ...p, text: content };
          return nextParts;
        }
      }
    }
  }
  const painted = parts.map((part) => (part.kind === 'reasoning' ? part.text || '' : '')).join('');
  const delta = replay ? unpaintedReplaySuffix(painted, content) : content;
  if (!delta) return null;
  return startNewPart && parts.length > 0 && parts[parts.length - 1]!.kind === 'reasoning'
    ? [...parts, { kind: 'reasoning', text: delta, ...(partId ? { id: partId } : {}) }]
    : appendReasoningPart(parts, delta, partId);
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
