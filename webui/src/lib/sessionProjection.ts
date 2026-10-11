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
 * 回合中途插入的 steer 气泡会把“最后一条”变成用户行；谁属于哪一轮由管线
 * 身份（message_id）决定，绝不能用“最后一条 assistant”猜。
 */
export function identifiedAssistantIndex(
  messages: Array<{ role: string; id?: string }>,
  messageId?: string,
): number {
  if (!messageId) return -1;
  const index = messages.findIndex((message) => message.id === messageId);
  return index >= 0 && messages[index]!.role === 'assistant' ? index : -1;
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
