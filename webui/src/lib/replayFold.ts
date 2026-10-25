/**
 * `/chat/watch` 的回放缓冲只装着当前这一轮，不是 48 条以外的整段历史。
 *
 * 首屏仍只拿最后一页。回放从这一轮的开头按时间到达：
 * - 已经在这一页上的帧交给画布按身份合并，不能再接成一条新的助手消息；
 * - 页还没画到这一轮时，先按住。碰到页内帧后，折叠线以上的工具/正文丢掉
 *   （它们在更早的历史里，补到回答下面就是上次的重放叠加）；
 * - 同一轮被页切掉的用户提问不能跟着丢掉，要插回这一轮助手内容的前面；
 * - 整段都碰不到这一页时，说明这一轮还没落盘，直播帧或终态再整段放出来。
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
  /** 整段回放都属于折叠线以上（已落盘的旧回合）：到 flush 时必须丢弃，绝不能补到末尾。 */
  aboveFold: boolean;
}

/** 页内已经有这一轮时，把被切掉的提问插到这个助手消息前面。 */
export interface ReplayFoldAnchor {
  messageId?: string;
  toolId?: string;
}

export interface AcceptedReplay {
  /** 按顺序落笔。已经在页上的前缀工具/正文不在这里。 */
  paint: Array<SSEEvent & { seq?: number }>;
  /** 这一轮被页切掉的提问。插到 `before` 前面，不能追加到回答下面。 */
  placeUsers: Array<SSEEvent & { seq?: number }>;
  before?: ReplayFoldAnchor;
}

export function createReplayFold(): ReplayFoldState {
  return { held: [], overlapped: false, aboveFold: false };
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

function anchorOf(event: SSEEvent): ReplayFoldAnchor {
  switch (event.type) {
    case 'text':
    case 'reasoning':
      return { messageId: event.message_id };
    case 'tool_start':
      return { messageId: event.message_id, toolId: event.id };
    case 'tool_output':
      return event.id ? { toolId: event.id } : {};
    case 'tool_progress':
    case 'tool_result':
      return { toolId: event.id };
    case 'permission_request':
      return { toolId: event.call_id };
    default:
      return {};
  }
}

function isTurnUser(event: SSEEvent): boolean {
  return event.type === 'user' || event.type === 'user_identified';
}

const EMPTY: AcceptedReplay = { paint: [], placeUsers: [] };

/**
 * 返回这一拍可以落笔的帧，以及要插回回合开头的提问。
 * `paint` 为空表示先按住（折叠线以上的工具/正文，还没碰到当前页）。
 */
export function acceptReplayFrame(
  state: ReplayFoldState,
  event: SSEEvent & { seq?: number; replay_last?: boolean },
  historyOffset: number,
  onCanvas: (candidate: SSEEvent) => boolean,
  canvasHasOpenTurn = false,
  /** 这个提问是否落在折叠线以上（已落盘的更早回合）。有它才能在 flush 时丢弃而不是补到末尾。 */
  isAboveFold?: (event: SSEEvent) => boolean,
): AcceptedReplay {
  const hasSeq = typeof event.seq === 'number';
  const terminal = TERMINAL.has(event.type);
  // 整份记录都在页内、直播帧、终态：不再按住。没碰到当前页的暂存是还没落盘的这一轮，一起放出来。
  const release = historyOffset <= 0 || !hasSeq || terminal;
  if (release) {
    if (historyOffset > 0 && !state.overlapped && state.held.length > 0 && (!hasSeq || terminal)) {
      const flushed = state.held.splice(0, state.held.length);
      // 折叠线以上的旧回合：它们已经在磁盘上（窗口之外），补到末尾就是“提问跑到底部”的孪生 bug。
      if (state.aboveFold) return { paint: [event], placeUsers: [] };
      return { paint: [...flushed, event], placeUsers: [] };
    }
    return { paint: [event], placeUsers: [] };
  }

  if (onCanvas(event)) {
    // 提问已经在页上：若该提问后面尚无任何已落盘的助手内容（canvasHasOpenTurn），说明这一轮
    // 正处于画布末尾（非页顶截断），立即打开闸门放行后续所有工具/思考/正文；
    // 否则它后面、页尾之前的工具仍是前缀，不在此处打开闸门。
    if (isTurnUser(event)) {
      if (canvasHasOpenTurn) {
        state.overlapped = true;
      }
      return { paint: [event], placeUsers: [] };
    }
    state.overlapped = true;
    const placeUsers = state.held.filter((held) => held.type === 'user');
    const identified = state.held.filter((held) => held.type === 'user_identified');
    const interactive = state.held.filter((held) => INTERACTIVE.has(held.type));
    state.held.length = 0;
    return {
      paint: [...identified, ...interactive, event],
      placeUsers,
      before: anchorOf(event),
    };
  }
  if (state.overlapped) return { paint: [event], placeUsers: [] };
  // 记录：这一整段回放是否全在折叠线以上（第一个页外提问即可判定）。
  if (
    !state.aboveFold &&
    (event.type === 'user' || event.type === 'user_identified') &&
    isAboveFold?.(event) === true
  ) {
    state.aboveFold = true;
  }
  if (event.replay_last === true) {
    // 服务端回放缓冲已到最后一帧但仍未与当前页发生重叠，说明整段回放均属于尚未落盘的新内容，
    // 立即全量释放上屏，杜绝异地浏览器进入或刷新时因等待未来直播帧而卡在空白转圈。
    state.overlapped = true;
    const flushed = state.held.splice(0, state.held.length);
    // 但若这段回放全在折叠线以上，它就是已落盘的旧回合：绝不能把它补到时间线末尾。
    if (state.aboveFold) return EMPTY;
    return { paint: [...flushed, event], placeUsers: [] };
  }
  state.held.push(event);
  return EMPTY;
}
