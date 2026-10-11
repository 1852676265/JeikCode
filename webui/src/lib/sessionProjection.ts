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
 * 身份未命中时，是否允许把增量落到“最后一条 assistant”。
 *
 * 核心铁律：
 * 1. 直播推流（replay === false）：绝对放行！LLM 实时吐字必须 0 延迟实时上屏，
 *    一个回合内哪怕多轮工具调用（工具轮 m-1、正文轮 m-2），正文也必须自然并入当前助手气泡，
 *    绝不能等回合结束或刷新/失焦才出来！
 * 2. 重放阶段（replay === true）：若该帧携带的 targetId 在画布上全无踪迹，
 *    且当前画布存在中途插入的 user 消息（例如 Steer 导致轮次被分割成多个 assistant 气泡），
 *    绝不允许将属于 Steer 之前的旧事件盲目外溢涂写到 Steer 之后的最新助手气泡中。
 */
export function mayPaintUnroutedDelta<T extends ProjectionMessage>(
  messages: T[],
  targetId?: string,
  replay?: boolean,
): boolean {
  if (!replay) return true; // 直播推流：绝对不拦截！
  if (!targetId) return true; // 旧 daemon：无身份可依，保持既有尾随语义
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant') return true;
  // 重放期：检查是否存在跨轮隔离（即末尾 assistant 前方存在 user 气泡，且该 user 气泡之前还有更早的 assistant）
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx > 0 && messages.slice(0, lastUserIdx).some((m) => m.role === 'assistant')) {
    // 存在 Steer 等跨轮隔离时，未寻址的老重放帧绝不污染跨轮后的末尾气泡
    return !last.id;
  }
  return true;
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
    ? paintAssistantText(messages, content, false, identity?.messageId)
    : paintAssistantReasoning(messages, content, false, identity?.messageId);
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
): T[] {
  const target = identifiedAssistantIndex(messages, targetId);
  if (target >= 0) {
    const parts = mergeTextIntoParts(messages[target]!.parts, content, replay);
    if (!parts) return messages;
    const next = messages.slice();
    next[target] = { ...messages[target]!, parts };
    return next;
  }
  // 身份未命中：重放期若末尾消息已被跨轮隔离，必须拒绝落笔；直播期 100% 放行流式吐字。
  if (!mayPaintUnroutedDelta(messages, targetId, replay)) return messages;
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
  const parts = mergeTextIntoParts(last.parts, content, replay);
  if (!parts) return messages;
  return [...base.slice(0, -1), { ...last, parts }];
}

/** 合并一段正文增量；返回 null 表示重播去重后无新内容可落笔。 */
function mergeTextIntoParts(parts: MsgPart[], content: string, replay: boolean): MsgPart[] | null {
  let delta = content;
  if (replay) {
    const replaced = replaceTruncatedParts(parts, 'text', content);
    if (replaced) return replaced;
    const painted = parts.map((part) => (part.kind === 'text' ? part.text || '' : '')).join('');
    delta = unpaintedReplaySuffix(painted, content);
    if (!delta) return null;
  }
  const next = parts.slice();
  const tail = next[next.length - 1];
  if (tail && tail.kind === 'text') {
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
    next[next.length - 1] = { kind: 'text', text: merged };
  } else {
    next.push({ kind: 'text', text: delta });
  }
  return next;
}

export function paintAssistantReasoning<T extends ProjectionMessage>(
  messages: T[],
  content: string,
  replay: boolean,
  /** 管线身份：命中则把思考增量落回该消息（迟到尾流必须回到原回合）。 */
  targetId?: string,
): T[] {
  const cleanContent = content.trim();
  if (!cleanContent) return messages;

  const target = identifiedAssistantIndex(messages, targetId);
  if (target >= 0) {
    const parts = mergeReasoningIntoParts(messages[target]!.parts, content, replay);
    if (!parts) return messages;
    const next = messages.slice();
    next[target] = { ...messages[target]!, parts };
    return next;
  }
  // 身份未命中：同 paintAssistantText，重放期若被跨轮隔离拒绝落笔，直播期 100% 实时上屏。
  if (!mayPaintUnroutedDelta(messages, targetId, replay)) return messages;

  let last = messages[messages.length - 1];
  let base = messages;
  if (!last || last.role !== 'assistant') {
    last = { role: 'assistant', parts: [] } as unknown as T;
    base = [...messages, last];
  }
  const parts = mergeReasoningIntoParts(last.parts, content, replay);
  if (!parts) return messages;
  return [...base.slice(0, -1), { ...last, parts }];
}

/** 合并一段思考增量；返回 null 表示重播去重后无新内容可落笔。 */
function mergeReasoningIntoParts(parts: MsgPart[], content: string, replay: boolean): MsgPart[] | null {
  const cleanContent = content.trim();
  if (replay) {
    const replaced = replaceTruncatedParts(parts, 'reasoning', content);
    if (replaced) {
      return replaced === parts ? null : replaced;
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
  return appendReasoningPart(parts, delta);
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
