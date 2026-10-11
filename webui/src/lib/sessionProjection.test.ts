import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bindUserMessageIdentity,
  catchUpSession,
  ensureWorkingAssistant,
  foldLiveTodo,
  hydrateSession,
  identifiedAssistantIndex,
  paintAssistantReasoning,
  paintAssistantText,
  paintUserMessage,
} from './sessionProjection.ts';

const plan = [
  { content: '写测试', status: 'completed' as const },
  { content: '修前端', status: 'in_progress' as const },
  { content: '发版', status: 'pending' as const },
  { content: '回归', status: 'pending' as const },
];

test('watch paints a new user with a Working placeholder, and repeats only after a settled answer', () => {
  const fresh = paintUserMessage([], '你好', 1, () => ({
    role: 'user',
    parts: [{ kind: 'text' as const, text: '你好' }],
  }));
  assert.equal(fresh.length, 2);
  assert.equal(fresh[1]?.role, 'assistant');
  assert.equal(fresh[1]?.parts.length, 0);

  const settled = [
    { role: 'user', parts: [{ kind: 'text' as const, text: 'OK啊 挺好的' }], ts: 1 },
    { role: 'assistant', parts: [{ kind: 'text' as const, text: '收到' }] },
  ];
  const replay = paintUserMessage(settled, 'OK啊 挺好的', 2, () => {
    throw new Error('replay of the open turn must not append');
  });
  assert.equal(replay, settled);

  const again = paintUserMessage(settled, 'OK啊 挺好的', 3, () => ({
    role: 'user',
    parts: [{ kind: 'text' as const, text: 'OK啊 挺好的' }],
    ts: 3,
  }), { repeatAfterSettled: true });
  assert.equal(again.filter((message) => message.role === 'user').length, 2);
  assert.equal(again[again.length - 1]?.role, 'assistant');
  assert.equal(again[again.length - 1]?.parts.length, 0);

  const open = [
    { role: 'user', parts: [{ kind: 'text' as const, text: 'OK啊 挺好的' }] },
    { role: 'assistant', parts: [] },
  ];
  const echo = paintUserMessage(open, 'OK啊 挺好的', 4, () => {
    throw new Error('echo of the open turn must not append');
  }, { repeatAfterSettled: true });
  assert.equal(echo.filter((message) => message.role === 'user').length, 1);
});

test('an open user turn gets one Working placeholder and keeps it', () => {
  const open = [
    { role: 'user', parts: [{ kind: 'text' as const, text: 'OK啊 挺好的' }] },
  ];
  const withPlaceholder = ensureWorkingAssistant(open);
  assert.equal(withPlaceholder.length, 2);
  assert.equal(withPlaceholder[1]?.role, 'assistant');
  assert.equal(withPlaceholder[1]?.parts.length, 0);
  assert.equal(ensureWorkingAssistant(withPlaceholder), withPlaceholder);
});

test('cold start paints the server checklist and ignores a replayed user and text', () => {
  const disk = [
    { role: 'user', parts: [{ kind: 'text' as const, text: '改用 sqlite' }] },
    {
      role: 'assistant',
      parts: [
        { kind: 'text' as const, text: '上一轮正文' },
        { kind: 'tool' as const, tool: { id: 't1', name: 'todowrite', args: '{}', status: 'done' as const } },
      ],
    },
  ];
  const surface = hydrateSession(disk, plan);
  assert.equal(surface.todos?.length, 4);
  assert.deepEqual(surface.appliedTodoIds, ['t1']);

  const afterUser = paintUserMessage(surface.messages, '改用 sqlite', 1, () => {
    throw new Error('user echo must not append');
  });
  assert.equal(afterUser.filter((message) => message.role === 'user').length, 1);
  assert.equal(afterUser[afterUser.length - 1]?.role, 'assistant');

  const afterText = paintAssistantText(afterUser, '上一轮正文', true);
  assert.equal(afterText, afterUser);
});

test('running disk catch-up keeps the steer tail and does not repaint an unchanged canvas', () => {
  const previous = { role: 'user', parts: [{ kind: 'text' as const, text: '上一问' }] };
  const done = {
    role: 'assistant',
    parts: [{ kind: 'text' as const, text: '上一轮正文' }],
  };
  const steer = { role: 'user', parts: [{ kind: 'text' as const, text: '继续' }] };
  const live = { role: 'assistant', parts: [{ kind: 'text' as const, text: '正在改' }] };
  const canvas = [previous, done, steer, live];
  const same = catchUpSession({
    messages: canvas,
    disk: [previous, done],
    running: true,
    adoptSettledDisk: false,
    serverTodos: plan,
  });
  assert.equal(same.messages, canvas);
  assert.equal(same.todos, undefined);

  const partial = { role: 'assistant', parts: [{ kind: 'tool' as const, tool: { id: 'b', name: 'bash', args: '', status: 'done' as const } }] };
  const behind = catchUpSession({
    messages: [previous, partial, steer, live],
    disk: [previous, done],
    running: true,
    adoptSettledDisk: false,
    serverTodos: plan,
  });
  assert.equal(behind.messages[1]?.parts.some((part) => part.kind === 'text' && part.text === '上一轮正文'), true);
  assert.equal(behind.messages[1]?.parts.some((part) => part.kind === 'tool' && part.tool?.id === 'b'), true);
  assert.equal(behind.messages[2], steer);
  assert.equal(behind.messages[3], live);
});

test('truncated disk thinking is extended in place instead of replayed as a second block', () => {
  const mark = '\n… [truncated for display]';
  const body = '先看目录';
  const full = `${body}，再读 read.rs，然后说明原因`;
  const messages = [{
    role: 'assistant',
    parts: [
      { kind: 'reasoning' as const, text: body + mark },
      { kind: 'text' as const, text: '正文开头' + mark },
      { kind: 'tool' as const, tool: { id: 'b', name: 'bash', args: '', status: 'done' as const } },
    ],
  }];
  const withThinking = paintAssistantReasoning(messages, full, true);
  assert.equal(withThinking[0]?.parts.filter((part) => part.kind === 'reasoning').length, 1);
  assert.equal(withThinking[0]?.parts[0]?.text, full);
  assert.equal(withThinking[0]?.parts[2]?.kind, 'tool');

  const withText = paintAssistantText(withThinking, '正文开头，以及后面的结论', true);
  assert.equal(withText[0]?.parts.filter((part) => part.kind === 'text').length, 1);
  assert.equal(withText[0]?.parts[1]?.text, '正文开头，以及后面的结论');
  assert.equal(withText[0]?.parts[2]?.kind, 'tool');
});

test('an incremental todo event keeps the hydrated plan', () => {
  const applied = new Set<string>(['t1']);
  const next = foldLiveTodo({
    state: null,
    remembered: plan,
    name: 'todowrite',
    args: JSON.stringify({ actions: [{ action: 'update', id: 2, status: 'completed' }] }),
    callId: 't2',
    appliedIds: applied,
  });
  assert.equal(next?.length, 4);
  assert.equal(next?.[1]?.status, 'completed');
});

test('paintAssistantReasoning dedupes replayed thinking blocks completely', () => {
  const messages = [{
    role: 'assistant',
    parts: [
      { kind: 'reasoning' as const, text: '这是第一段深度思考过程' },
      { kind: 'tool' as const, tool: { id: 'call_1', name: 'read', status: 'done' as const } },
      { kind: 'reasoning' as const, text: '这是第二段思考过程' },
    ],
  }];

  // 1. 重放完全相同的思考块，绝对不应增加新的 reasoning part
  const replayed1 = paintAssistantReasoning(messages, '这是第一段深度思考过程', true);
  assert.equal(replayed1[0]?.parts.filter((p) => p.kind === 'reasoning').length, 2);

  const replayed2 = paintAssistantReasoning(messages, '这是第二段思考过程', true);
  assert.equal(replayed2[0]?.parts.filter((p) => p.kind === 'reasoning').length, 2);

  // 2. 重放已有思考块的子集/前缀，也绝不应增加新的 reasoning part
  const replayedSub = paintAssistantReasoning(messages, '这是第二段思考', true);
  assert.equal(replayedSub[0]?.parts.filter((p) => p.kind === 'reasoning').length, 2);
});

test('paintUserMessage skips replayed original user prompt when turn has a steer', () => {
  const originalUser = {
    role: 'user',
    parts: [{ kind: 'text' as const, text: '修复 webui ipv6 缺失' }],
    ts: 1000,
  };
  const assistantTool = {
    role: 'assistant',
    parts: [{ kind: 'tool' as const, tool: { id: 'call_1', name: 'read', status: 'done' as const } }],
  };
  const steerUser = {
    role: 'user',
    parts: [{ kind: 'text' as const, text: '不要动 api_config.rs' }],
    ts: 2000,
  };
  const assistantPending = {
    role: 'assistant',
    parts: [],
  };
  const messages = [originalUser, assistantTool, steerUser, assistantPending];

  // 收到原始提问的 replay 事件时，因原始提问已在画布上，绝不能追加在 steerUser 下方
  const updated = paintUserMessage(
    messages,
    '修复 webui ipv6 缺失',
    1000,
    () => ({ role: 'user', parts: [{ kind: 'text', text: '修复 webui ipv6 缺失' }], ts: 1000 }),
  );
  assert.equal(updated.filter((m) => m.role === 'user').length, 2);
  assert.equal(updated[0], originalUser);
  assert.equal(updated[2], steerUser);
});

test('paintUserMessage never duplicates original user prompt even with mismatched ts and settled tool step after steer', () => {
  const originalUser = {
    role: 'user',
    parts: [{ kind: 'text' as const, text: '你好 请你对比一下各项目设计' }],
    ts: 1791403200000,
  };
  const step1 = {
    role: 'assistant',
    parts: [
      { kind: 'reasoning' as const, text: '深度思考中' },
      { kind: 'tool' as const, tool: { id: 'call_1', name: 'read', status: 'done' as const } },
      { kind: 'text' as const, text: '兄弟目录已确认' },
    ],
  };
  const steerUser = {
    role: 'user',
    parts: [{ kind: 'text' as const, text: 'OK啊' }],
    ts: 1791403260000,
  };
  const step2 = {
    role: 'assistant',
    parts: [
      { kind: 'reasoning' as const, text: '继续执行' },
      { kind: 'tool' as const, tool: { id: 'call_2', name: 'todowrite', status: 'done' as const } },
      { kind: 'tool' as const, tool: { id: 'call_3', name: 'glob', status: 'done' as const } },
    ],
  };
  const messages = [originalUser, step1, steerUser, step2];

  // 此时时间戳偏差达到 2 分钟，且 step2 里的工具都已经 done
  const result = paintUserMessage(
    messages,
    '你好 请你对比一下各项目设计',
    1791403320000, // 2分钟后的新时间戳
    () => {
      throw new Error('must not re-append original prompt below steer!');
    },
  );
  assert.equal(result.filter((m) => m.role === 'user').length, 2);
  assert.equal(result[0]?.parts[0]?.text, '你好 请你对比一下各项目设计');
  assert.equal(result[2]?.parts[0]?.text, 'OK啊');
});

test('paintUserMessage never duplicates original prompt on detached watch / live replay when no steer occurred and tools are done', () => {
  const originalUser = {
    role: 'user',
    parts: [{ kind: 'text' as const, text: '请你扫描我的setup命令 setup命令是啥？' }],
    ts: 1791423600000,
  };
  const assistant = {
    role: 'assistant',
    parts: [
      { kind: 'tool' as const, tool: { id: 'call_1', name: 'grep', status: 'done' as const } },
      { kind: 'tool' as const, tool: { id: 'call_2', name: 'grep', status: 'done' as const } },
    ],
  };
  const messages = [originalUser, assistant];

  // Replay of original prompt with slightly different timestamp or trailing newline
  const result = paintUserMessage(
    messages,
    '请你扫描我的setup命令 setup命令是啥？\n',
    1791423780000,
    () => {
      throw new Error('must not re-append prompt on detached replay!');
    },
  );
  assert.equal(result.filter((m) => m.role === 'user').length, 1);
  assert.equal(result[0]?.parts[0]?.text, '请你扫描我的setup命令 setup命令是啥？');
});

test('paintAssistantText streams text normally even if phrases occurred in prior assistant turns', () => {
  const user1 = { role: 'user', parts: [{ kind: 'text' as const, text: '你好' }] };
  const assistant1 = {
    role: 'assistant',
    parts: [{ kind: 'text' as const, text: '好的，请问有什么可以帮助您的？' }],
  };
  const user2 = { role: 'user', parts: [{ kind: 'text' as const, text: '帮我查一下当前项目' }] };
  const assistant2 = {
    role: 'assistant',
    parts: [],
  };
  const messages = [user1, assistant1, user2, assistant2];

  // Streaming text in turn 2 starts with "好的" which was present in assistant1
  const streamed = paintAssistantText(messages, '好的', false);
  assert.equal(streamed[3]?.parts.length, 1);
  assert.equal(streamed[3]?.parts[0]?.kind, 'text');
  assert.equal(streamed[3]?.parts[0]?.text, '好的');
});

test('paintAssistantText merges into existing text part without slicing around non-text parts', () => {
  const messages = [{
    role: 'assistant',
    parts: [
      { kind: 'reasoning' as const, text: '思考中...' },
      { kind: 'text' as const, text: '三、总结\n这次修复彻底解决了' },
    ],
  }];
  const next = paintAssistantText(messages, '以下两个关键问题：\n1. 终端环境异常', false);
  assert.equal(next[0]?.parts.length, 2);
  assert.equal(next[0]?.parts[0]?.kind, 'reasoning');
  assert.equal(next[0]?.parts[1]?.kind, 'text');
  assert.equal(next[0]?.parts[1]?.text, '三、总结\n这次修复彻底解决了以下两个关键问题：\n1. 终端环境异常');
});

test('paintUserMessage never duplicates multiline user prompt with Windows CRLF vs LF', () => {
  const multilineCRLF = '第一段：不要这个\r\n\r\n第二段：免建清单去掉\r\n- 条目1\r\n- 条目2';
  const multilineLF = '第一段：不要这个\n\n第二段：免建清单去掉\n- 条目1\n- 条目2';

  // Canvas has CRLF from Windows input
  const initial = [
    { role: 'user', parts: [{ kind: 'text' as const, text: multilineCRLF }], ts: 1000 },
    { role: 'assistant', parts: [] },
  ];

  // Incoming SSE echo has normalized LF from daemon
  const result = paintUserMessage(
    initial,
    multilineLF,
    2000,
    () => {
      throw new Error('Should not append duplicate user message');
    },
    { repeatAfterSettled: true },
  );

  assert.equal(result.filter((m) => m.role === 'user').length, 1);
});

test('paintUserMessage never duplicates user prompt while assistant is still reasoning or running tools without text answer', () => {
  const userText = '请帮我实现一个新功能';
  // Assistant is currently reasoning or running tools (turn in flight, no settled text answer)
  const inFlightMessages = [
    { role: 'user', parts: [{ kind: 'text' as const, text: userText }], ts: 1000 },
    {
      role: 'assistant',
      parts: [
        { kind: 'reasoning' as const, text: 'Thinking about the architecture...' },
        { kind: 'tool' as const, tool: { id: 'call_1', name: 'read_file', status: 'pending' as const } },
      ],
    },
  ];

  const result = paintUserMessage(
    inFlightMessages,
    userText,
    1500,
    () => {
      throw new Error('Should not append duplicate user prompt during in-flight reasoning/tools');
    },
    { repeatAfterSettled: true },
  );

  assert.equal(result.filter((m) => m.role === 'user').length, 1);
});

test('paintUserMessage accurately appends a mid-turn steer when agent is in-flight on tools/thinking without final answer', () => {
  const originalUser = { role: 'user', parts: [{ kind: 'text' as const, text: '帮我重构网络层' }], ts: 1000 };
  const inFlightAssistant = {
    role: 'assistant',
    parts: [
      { kind: 'reasoning' as const, text: '检查现存网络模块...' },
      { kind: 'tool' as const, tool: { id: 'c1', name: 'read_file', status: 'done' as const } },
    ],
  };
  const canvas = [originalUser, inFlightAssistant];

  // User sends a steer: "改用 reqwest，不要用 hyper"
  const steerText = '改用 reqwest，不要用 hyper';
  const withSteer = paintUserMessage(
    canvas,
    steerText,
    1500,
    () => ({
      role: 'user',
      parts: [{ kind: 'text' as const, text: steerText }],
      ts: 1500,
    }),
    { repeatAfterSettled: true },
  );

  // Steer must be cleanly appended after inFlightAssistant
  assert.equal(withSteer.filter((m) => m.role === 'user').length, 2);
  assert.equal(withSteer[0]?.parts[0]?.text, '帮我重构网络层');
  assert.equal(withSteer[2]?.parts[0]?.text, '改用 reqwest，不要用 hyper');
  assert.equal(withSteer[withSteer.length - 1]?.role, 'assistant');
});

test('paintUserMessage does not duplicate the steer itself when steer echo arrives while agent is still running steer tools', () => {
  const originalUser = { role: 'user', parts: [{ kind: 'text' as const, text: '帮我重构网络层' }], ts: 1000 };
  const step1 = {
    role: 'assistant',
    parts: [{ kind: 'tool' as const, tool: { id: 'c1', name: 'read_file', status: 'done' as const } }],
  };
  const steerUser = { role: 'user', parts: [{ kind: 'text' as const, text: '改用 reqwest' }], ts: 1500 };
  const step2 = {
    role: 'assistant',
    parts: [{ kind: 'tool' as const, tool: { id: 'c2', name: 'search_replace', status: 'pending' as const } }],
  };
  const canvas = [originalUser, step1, steerUser, step2];

  // SSE echo of the steer itself arrives while step2 is still running
  const result = paintUserMessage(
    canvas,
    '改用 reqwest',
    1500,
    () => {
      throw new Error('Must not duplicate steer during in-flight step2');
    },
    { repeatAfterSettled: true },
  );

  // Count of user messages must remain 2 (original + steer), not 3!
  assert.equal(result.filter((m) => m.role === 'user').length, 2);
  assert.equal(result[0]?.parts[0]?.text, '帮我重构网络层');
  assert.equal(result[2]?.parts[0]?.text, '改用 reqwest');
});
test('single event bus stream updates in-memory session cache correctly for background sessions', () => {
  const initial = [
    { role: 'user', parts: [{ kind: 'text' as const, text: '分析代码性能' }], ts: 1000 },
    { role: 'assistant', parts: [] },
  ];

  // Background stream delivers reasoning delta
  const r1 = paintAssistantReasoning(initial, '分析当前瓶颈...', false);
  assert.equal(r1[1]?.parts.length, 1);
  assert.equal(r1[1]?.parts[0]?.kind, 'reasoning');
  assert.equal(r1[1]?.parts[0]?.text, '分析当前瓶颈...');

  // Background stream delivers text delta
  const t1 = paintAssistantText(r1, '建议使用 SIMD 加速。', false);
  assert.equal(t1[1]?.parts.length, 2);
  assert.equal(t1[1]?.parts[1]?.kind, 'text');
  assert.equal(t1[1]?.parts[1]?.text, '建议使用 SIMD 加速。');

  // Background stream delivers second text delta
  const t2 = paintAssistantText(t1, '具体步骤如下：', false);
  assert.equal(t2[1]?.parts.length, 2);
  assert.equal(t2[1]?.parts[1]?.kind, 'text');
  assert.equal(t2[1]?.parts[1]?.text, '建议使用 SIMD 加速。具体步骤如下：');
});

test('bindUserMessageIdentity binds the stored id to the optimistic bubble once', () => {
  const local = {
    role: 'user',
    id: 'client-id-1',
    parts: [{ kind: 'text' as const, text: '你好' }],
  };
  const messages = [local, { role: 'assistant', id: 'm-a1', parts: [] }];
  const bound = bindUserMessageIdentity(messages, 'm-user-1');
  assert.equal(bound[0]?.id, 'm-user-1');
  assert.equal(bound[1], messages[1]);
  // 幂等：同一个 id 第二次到达不改变画布。
  assert.equal(bindUserMessageIdentity(bound, 'm-user-1'), bound);
  // 唯一性：已在画布上的 id 绝不再贴到另一条消息上。
  const other = [
    { role: 'user', id: 'm-user-9', parts: [{ kind: 'text' as const, text: '别人的提问' }] },
    { role: 'user', parts: [{ kind: 'text' as const, text: '我的提问' }] },
  ];
  assert.equal(bindUserMessageIdentity(other, 'm-user-9'), other);
  // 无用户气泡 / 无 id：原样返回（同一引用，避免无谓重绘）。
  const empty: Array<{ role: string; parts: Array<{ kind: 'text'; text: string }> }> = [];
  assert.equal(bindUserMessageIdentity(empty, 'm-x'), empty);
  assert.equal(bindUserMessageIdentity(other, undefined), other);
});

test('identifiedAssistantIndex resolves the owning round, never the steer bubble', () => {
  const round = { role: 'assistant', id: 'm-1', parts: [] };
  const steer = { role: 'user', id: 'client-1', parts: [{ kind: 'text' as const, text: '换个方向' }] };
  const messages = [round, steer];
  assert.equal(identifiedAssistantIndex(messages, 'm-1'), 0);
  // A user bubble carrying its own client id is not an assistant target.
  assert.equal(identifiedAssistantIndex(messages, 'client-1'), -1);
  assert.equal(identifiedAssistantIndex(messages, undefined), -1);
  assert.equal(identifiedAssistantIndex(messages, 'm-missing'), -1);
});

// 回合中途 steer 的回归防线：上一回合迟到的思考/正文/工具增量必须回到它所属的
// assistant 消息，绝不能渲染到 steer 气泡下方（错序 + 重复的根因）。
test('late deltas keep their owning round above a mid-turn steer bubble', () => {
  const round = {
    role: 'assistant',
    id: 'm-1',
    parts: [{ kind: 'text' as const, text: '前半段正文' }],
  };
  const steer = { role: 'user', parts: [{ kind: 'text' as const, text: '改个方向' }] };
  const canvas = [round, steer];

  const text = paintAssistantText(canvas, '后半段正文', false, 'm-1');
  assert.equal(text.length, 2, 'steer 气泡之后绝不能另起一条 assistant');
  assert.equal(text[1], steer);
  const mergedPart = text[0]?.parts[0];
  assert.equal(mergedPart?.kind, 'text');
  assert.equal(mergedPart?.text, '前半段正文后半段正文');

  const reasoning = paintAssistantReasoning(text, '补充思考', false, 'm-1');
  assert.equal(reasoning.length, 2);
  assert.equal(reasoning[1], steer);
  assert.equal(reasoning[0]?.parts.length, 2);
  assert.equal(reasoning[0]?.parts[0]?.text, '前半段正文后半段正文');
  assert.equal(reasoning[0]?.parts[1]?.kind, 'reasoning');
  assert.equal(reasoning[0]?.parts[1]?.text, '补充思考');

  // 未携带身份（旧 daemon）时保持原有尾随语义，不回归。
  const trailing = paintAssistantText(canvas, '新回合正文', false);
  assert.equal(trailing.length, 3);
  assert.equal(trailing[1], steer);
  assert.equal(trailing[2]?.role, 'assistant');
  assert.equal(trailing[2]?.parts[0]?.text, '新回合正文');
});

test('streamed markdown keeps paragraph breaks when whitespace arrives as its own delta', () => {
  // 真实流序：正文 → "\n\n"（独立 delta）→ 下一条列表项。
  // 空白 delta 被吞会让列表/段落粘连，就是“首帧乱排、刷新后正常”的根因。
  let canvas = paintAssistantText([], '一、顶层开关是活的语义', true);
  canvas = paintAssistantText(canvas, '\n\n', true);
  canvas = paintAssistantText(canvas, '1. 对外 schema 只暴露 hunk 级', true);
  canvas = paintAssistantText(canvas, '\n\n', true);
  canvas = paintAssistantText(canvas, '2. 但底层也接受顶层开关', true);
  const text = (canvas[0]?.parts ?? []).map((part) => part.text ?? '').join('');
  assert.equal(
    text,
    '一、顶层开关是活的语义\n\n1. 对外 schema 只暴露 hunk 级\n\n2. 但底层也接受顶层开关',
  );
  // 同一段空白重复到达（重放）不得叠加空行：
  // 画布末尾已是空白时不再追加（否则空行滚雪球）。
  const endsWithBreak = paintAssistantText([], '段落一\n\n', true);
  const replayed = paintAssistantText(endsWithBreak, '\n\n', true);
  assert.equal(
    (replayed[0]?.parts ?? []).map((part) => part.text ?? '').join(''),
    '段落一\n\n',
  );
});

test('a new round identity still opens its own bubble after the steer', () => {
  const round = { role: 'assistant', id: 'm-1', parts: [{ kind: 'text' as const, text: '旧回合' }] };
  const steer = { role: 'user', parts: [{ kind: 'text' as const, text: 'steer' }] };
  const canvas = [round, steer];

  const next = paintAssistantText(canvas, '新回合回答', false, 'm-2');
  assert.equal(next.length, 3);
  assert.equal(next[1], steer);
  assert.equal(next[2]?.role, 'assistant');
  assert.equal(next[2]?.parts[0]?.text, '新回合回答');
});
