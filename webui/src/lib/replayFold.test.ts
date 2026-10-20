import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SSEEvent } from '../api.ts';
import {
  acceptReplayFrame,
  createReplayFold,
  replayFrameOnCanvas,
  type ReplayFoldMessage,
} from './replayFold.ts';

function assistant(id: string, toolId?: string): ReplayFoldMessage {
  return {
    role: 'assistant',
    id,
    parts: toolId
      ? [{ kind: 'tool', tool: { id: toolId, name: 'bash', args: '', status: 'done' } }]
      : [{ kind: 'text', text: '已在页内', id: `${id}:1:text` }],
  };
}

function seq<T extends SSEEvent>(event: T, n: number): T & { seq: number } {
  return { ...event, seq: n };
}

test('页内回放照常落笔，不因为带 seq 被按住', () => {
  const canvas = [assistant('m-visible')];
  const fold = createReplayFold();
  const text = seq({ type: 'text', content: '已在页内', message_id: 'm-visible' }, 4);
  const painted = acceptReplayFrame(fold, text, 102, (event) => replayFrameOnCanvas(canvas, event));
  assert.equal(painted.paint.length, 1);
  assert.equal(painted.paint[0], text);
  assert.deepEqual(painted.placeUsers, []);
  assert.equal(fold.held.length, 0);
  assert.equal(fold.overlapped, true);
});

test('折叠线以上的工具先按住，碰到页内帧后丢掉；被切掉的提问要插回这一轮前面', () => {
  const canvas = [assistant('m-visible', 'tool-visible')];
  const fold = createReplayFold();
  const onCanvas = (event: SSEEvent) => replayFrameOnCanvas(canvas, event);
  const user = seq({ type: 'user', content: '为什么按 F5 会响' }, 1);
  const earlyTool = seq(
    { type: 'tool_start', id: 'tool-early', name: 'bash', arguments: {}, message_id: 'm-early' },
    2,
  );
  const visibleTool = seq(
    { type: 'tool_start', id: 'tool-visible', name: 'bash', arguments: {}, message_id: 'm-visible' },
    3,
  );

  assert.deepEqual(acceptReplayFrame(fold, user, 102, onCanvas).paint, []);
  assert.deepEqual(acceptReplayFrame(fold, earlyTool, 102, onCanvas).paint, []);
  const painted = acceptReplayFrame(fold, visibleTool, 102, onCanvas);
  assert.deepEqual(painted.placeUsers, [user]);
  assert.deepEqual(painted.paint, [visibleTool]);
  assert.equal(painted.before?.messageId, 'm-visible');
  assert.equal(painted.before?.toolId, 'tool-visible');
  assert.equal(fold.held.length, 0);
  assert.equal(fold.overlapped, true);
});

test('碰到页内帧之后的新正文仍然落笔', () => {
  const canvas = [assistant('m-visible')];
  const fold = createReplayFold();
  const onCanvas = (event: SSEEvent) => replayFrameOnCanvas(canvas, event);
  acceptReplayFrame(fold, seq({ type: 'text', content: '已在页内', message_id: 'm-visible' }, 1), 12, onCanvas);
  const newer = seq({ type: 'text', content: '还没落盘', message_id: 'm-new' }, 2);
  const painted = acceptReplayFrame(fold, newer, 12, onCanvas);
  assert.deepEqual(painted.paint, [newer]);
  assert.deepEqual(painted.placeUsers, []);
});

test('整段回放都对不上当前页时，直播帧把它作为新回合放出来', () => {
  const canvas = [assistant('m-old')];
  const fold = createReplayFold();
  const onCanvas = (event: SSEEvent) => replayFrameOnCanvas(canvas, event);
  const user = seq({ type: 'user', content: '新的提问' }, 1);
  assert.deepEqual(acceptReplayFrame(fold, user, 40, onCanvas).paint, []);
  const live = { type: 'text', content: '续写', message_id: 'm-live' } as SSEEvent;
  const painted = acceptReplayFrame(fold, live, 40, onCanvas);
  assert.deepEqual(painted.paint, [user, live]);
  assert.deepEqual(painted.placeUsers, []);
});

test('页内工具的审批卡本身就算命中，折叠线以上的提问插回这一轮前面而不是丢掉', () => {
  const canvas = [assistant('m-visible', 'tool-visible')];
  const fold = createReplayFold();
  const onCanvas = (event: SSEEvent) => replayFrameOnCanvas(canvas, event);
  const user = seq({ type: 'user', content: '折叠线以上' }, 1);
  const permission = seq(
    {
      type: 'permission_request',
      session_id: 's',
      approval_id: 'a',
      tool_name: 'bash',
      reason: 'run',
      call_id: 'tool-visible',
      arguments: {},
    },
    2,
  );
  assert.deepEqual(acceptReplayFrame(fold, user, 8, onCanvas).paint, []);
  const painted = acceptReplayFrame(fold, permission, 8, onCanvas);
  assert.deepEqual(painted.placeUsers, [user]);
  assert.deepEqual(painted.paint, [permission]);
  assert.equal(painted.before?.toolId, 'tool-visible');
  assert.equal(fold.held.length, 0);
  assert.equal(fold.overlapped, true);
});

test('还没画到页内工具时，审批卡先按住，命中当前页后再放出来', () => {
  const canvas = [assistant('m-visible')];
  const fold = createReplayFold();
  const onCanvas = (event: SSEEvent) => replayFrameOnCanvas(canvas, event);
  const permission = seq(
    {
      type: 'permission_request',
      session_id: 's',
      approval_id: 'a',
      tool_name: 'bash',
      reason: 'run',
      call_id: 'tool-early',
      arguments: {},
    },
    1,
  );
  const visible = seq({ type: 'text', content: '已在页内', message_id: 'm-visible' }, 2);
  assert.deepEqual(acceptReplayFrame(fold, permission, 8, onCanvas).paint, []);
  const painted = acceptReplayFrame(fold, visible, 8, onCanvas);
  assert.deepEqual(painted.paint, [permission, visible]);
  assert.deepEqual(painted.placeUsers, []);
});

test('提问已经在页上时不打开折叠线，页外工具仍然丢掉', () => {
  const canvas = [
    { role: 'user', parts: [{ kind: 'text', text: '这一问' }] },
    assistant('m-visible', 'tool-visible'),
  ];
  const fold = createReplayFold();
  const onCanvas = (event: SSEEvent) => replayFrameOnCanvas(canvas, event);
  const user = seq({ type: 'user', content: '这一问' }, 1);
  const earlyTool = seq(
    { type: 'tool_start', id: 'tool-early', name: 'bash', arguments: {}, message_id: 'm-early' },
    2,
  );
  const visibleTool = seq(
    { type: 'tool_start', id: 'tool-visible', name: 'bash', arguments: {}, message_id: 'm-visible' },
    3,
  );
  const seenUser = acceptReplayFrame(fold, user, 20, onCanvas);
  assert.deepEqual(seenUser.paint, [user]);
  assert.equal(fold.overlapped, false);
  assert.deepEqual(acceptReplayFrame(fold, earlyTool, 20, onCanvas).paint, []);
  const painted = acceptReplayFrame(fold, visibleTool, 20, onCanvas);
  assert.deepEqual(painted.placeUsers, []);
  assert.deepEqual(painted.paint, [visibleTool]);
  assert.equal(fold.held.length, 0);
});

test('没有更早历史时不按住，短会话的回放仍整段落笔', () => {
  const fold = createReplayFold();
  const user = seq({ type: 'user', content: '只有一轮' }, 1);
  const painted = acceptReplayFrame(fold, user, 0, () => false);
  assert.deepEqual(painted.paint, [user]);
  assert.deepEqual(painted.placeUsers, []);
  assert.equal(fold.held.length, 0);
});
