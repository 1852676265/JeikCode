/**
 * 首屏只有最后一页。回放按时间从旧到新到达：碰到「这一页里已经有」的帧之前，
 * 那些帧在折叠线以上，不能补到回答下面。碰到之后的未知身份是还没落盘的新内容，
 * 照常画。直播帧没有 seq，照常画。整段回放都碰不到这一页时，说明这是页外的新回合，
 * 等到直播帧或终态再整段放出来。
 *
 * 页大小本身不动。把窗口退回到回合开头会把整轮工具调用一次拉进画布。
 */

import type { SSEEvent } from '../api.ts';
import { userMessageAlreadyOnCanvas } from './chatTerminal.ts';
import { identifiedAssistantIndex } from './sessionProjection.ts';
import type { MsgPart } from './toolRows.ts';

export interface ReplayFoldMessage {
  role: string;
  id?: string;
  ts?: number;
  parts: MsgPart[];
}

const TERMINAL = new Set(['done', 'stopped', 'error']);
/** 折叠线以上的正文可以丢，待审批 / 待输入不能丢，否则回合会卡死。 */
const INTERACTIVE = new Set(['permission_request', 'user_input_request']);

export interface ReplayFoldState {
  held: SSEEvent[];
  overlapped: boolean;
}

export function createReplayFold(): ReplayFoldState {
  return { held: [], overlapped: false };
}

function canvasHasTool(messages: ReplayFoldMessage[], id?: string): boolean {
  if (!id) return false;
  return messages.some(
    (message) =>
      message.role === 'assistant' &&
      message.parts.some((part) => part.kind === 'tool' && part.tool.id === id),
  );
}

/** 这一帧是不是已经落在当前页上。对不上的回放帧先暂存，不能直接补到末尾。 */
export function replayFrameOnCanvas(messages: ReplayFoldMessage[], event: SSEEvent): boolean {
  switch (event.type) {
    case 'user':
      return userMessageAlreadyOnCanvas(messages, event.content, event.created_at);
    case 'user_identified':
      return messages.some((message) => message.id === event.message_id);
    case 'text':
    case 'reasoning': {
      if (event.message_id && identifiedAssistantIndex(messages, event.message_id) >= 0) return true;
      if (event.part_id) {
        const owner = event.part_id.split(':')[0];
        if (owner && identifiedAssistantIndex(messages, owner) >= 0) return true;
      }
      return false;
    }
    case 'tool_start':
      if (event.message_id && identifiedAssistantIndex(messages, event.message_id) >= 0) return true;
      return canvasHasTool(messages, event.id);
    case 'tool_output':
    case 'tool_progress':
    case 'tool_result':
      return canvasHasTool(messages, event.id);
    case 'permission_request':
      return canvasHasTool(messages, event.call_id);
    default:
      return false;
  }
}

/**
 * 返回这一拍可以落笔的帧。空数组表示先按住（折叠线以上，还没碰到当前页）。
 */
export function acceptReplayFrame(
  state: ReplayFoldState,
  event: SSEEvent & { seq?: number },
  historyOffset: number,
  onCanvas: (candidate: SSEEvent) => boolean,
): Array<SSEEvent & { seq?: number }> {
  const hasSeq = typeof event.seq === 'number';
  const terminal = TERMINAL.has(event.type);
  // 整份记录都在页内、直播帧、终态：不再按住。没碰到当前页的暂存是页外新回合，一起放出来。
  const release = historyOffset <= 0 || !hasSeq || terminal;
  if (release) {
    if (historyOffset > 0 && !state.overlapped && state.held.length > 0 && (!hasSeq || terminal)) {
      const flushed = state.held.splice(0, state.held.length);
      return [...flushed, event];
    }
    return [event];
  }

  if (onCanvas(event)) {
    state.overlapped = true;
    const interactive = state.held.filter((held) => INTERACTIVE.has(held.type));
    state.held.length = 0;
    return [...interactive, event];
  }
  if (state.overlapped) return [event];
  state.held.push(event);
  return [];
}
