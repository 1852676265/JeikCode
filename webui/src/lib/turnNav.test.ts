import { test } from 'node:test';
import assert from 'node:assert';
import {
  buildTurnNavItems,
  buildTurnNavItemsFromOutline,
  filterTurnNavItems,
  formatTokenMetric,
  resolveActiveTurnId,
  resolveTurnTokenState,
  truncateTurnNavLabel,
  turnNavId,
  turnNavScrollTop,
} from './turnNav.ts';

test('turnNavId is stable per user-turn ordinal', () => {
  assert.equal(turnNavId(3), 'turn-nav-3');
});

test('truncateTurnNavLabel collapses whitespace and ellipsizes', () => {
  assert.equal(truncateTurnNavLabel('  hello   world  '), 'hello world');
  assert.equal(truncateTurnNavLabel('abcdefghij', 6), 'abcde…');
  assert.equal(truncateTurnNavLabel('short', 28), 'short');
  assert.equal(truncateTurnNavLabel('   '), '');
});

test('buildTurnNavItems keeps user questions in order and skips empty/system', () => {
  const items = buildTurnNavItems([
    { role: 'user', text: '你好 今天天气' },
    { role: 'assistant', text: '晴' },
    { role: 'system', text: 'notice' },
    { role: 'user', text: '' },
    { role: 'user', text: '第二问' },
  ]);
  assert.deepEqual(
    items.map((i) => ({ id: i.id, ordinal: i.ordinal, index: i.index, label: i.label, text: i.text })),
    [
      { id: 'turn-nav-0', ordinal: 0, index: 0, label: '你好 今天天气', text: '你好 今天天气' },
      { id: 'turn-nav-1', ordinal: 1, index: 4, label: '第二问', text: '第二问' },
    ],
  );
});

test('buildTurnNavItems preserves raw transcript indexes after display filtering', () => {
  const items = buildTurnNavItems([
    { role: 'assistant', text: '', sourceIndex: 80 },
    { role: 'user', text: '工具调用后的问题', sourceIndex: 87 },
  ], 80);
  assert.deepEqual(
    items.map((i) => ({ id: i.id, index: i.index })),
    [{ id: 'turn-nav-0', index: 87 }],
  );
});

test('buildTurnNavItems falls back to the history window offset', () => {
  const items = buildTurnNavItems([
    { role: 'assistant', text: '' },
    { role: 'user', text: '窗口内问题' },
  ], 40);
  assert.equal(items[0]?.index, 41);
});

test('turnNavScrollTop targets the chat container and clamps above its start', () => {
  assert.equal(turnNavScrollTop(600, 100, 240), 740);
  assert.equal(turnNavScrollTop(20, 100, 40), 0);
});

test('buildTurnNavItemsFromOutline uses absolute transcript indexes', () => {
  const items = buildTurnNavItemsFromOutline([
    { ordinal: 0, index: 0, text: '第一问' },
    { ordinal: 1, index: 25, text: '<system-reminder>internal</system-reminder>' },
    { ordinal: 2, index: 80, text: '很后面的提问' },
  ]);
  assert.deepEqual(
    items.map((i) => ({ id: i.id, index: i.index, label: i.label })),
    [
      { id: 'turn-nav-0', index: 0, label: '第一问' },
      { id: 'turn-nav-2', index: 80, label: '很后面的提问' },
    ],
  );
});

test('buildTurnNavItemsFromOutline strips steer envelope and keeps clean query', () => {
  const items = buildTurnNavItemsFromOutline([
    {
      ordinal: 0,
      index: 0,
      text: '<user-query>\n跨平台都只需要声音通知就可以\n</user-query>\n\n[jeikcode-steer]\nYou are currently in the middle of executing a task...',
    },
    {
      ordinal: 1,
      index: 1,
      text: '<user-query>不用引入播放器 直接调用系统原生的就可以了</user-query>\n\n[jeikcode-steer]\nnotes',
    },
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[0].label, '跨平台都只需要声音通知就可以');
  assert.equal(items[0].text, '跨平台都只需要声音通知就可以');
  assert.equal(items[1].label, '不用引入播放器 直接调用系统原生的就可以了');
  assert.equal(items[1].text, '不用引入播放器 直接调用系统原生的就可以了');
});

test('buildTurnNavItems strips steer envelope from user messages', () => {
  const items = buildTurnNavItems([
    {
      role: 'user',
      text: '<user-query>\n我只需要响一声就行了\n</user-query>\n\n[jeikcode-steer]\nguidelines',
    },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].label, '我只需要响一声就行了');
  assert.equal(items[0].text, '我只需要响一声就行了');
});

test('outline ids do not shift when failed turns insert diagnostic rows', () => {
  const items = buildTurnNavItemsFromOutline([
    { ordinal: 4, index: 10, text: '第一次继续' },
    { ordinal: 5, index: 12, text: '第二次继续' },
    { ordinal: 6, index: 15, text: '服务恢复后继续' },
  ]);
  assert.deepEqual(
    items.map((i) => ({ id: i.id, ordinal: i.ordinal, index: i.index })),
    [
      { id: 'turn-nav-4', ordinal: 4, index: 10 },
      { id: 'turn-nav-5', ordinal: 5, index: 12 },
      { id: 'turn-nav-6', ordinal: 6, index: 15 },
    ],
  );
});

test('filterTurnNavItems matches full question text, not only the truncated label', () => {
  const items = buildTurnNavItems([
    { role: 'user', text: '请根据用户需求配置 MCP 服务器' },
    { role: 'user', text: '现在搜索试一下' },
  ]);
  const hit = filterTurnNavItems(items, 'mcp');
  assert.equal(hit.length, 1);
  assert.equal(hit[0].index, 0);
  assert.deepEqual(filterTurnNavItems(items, '没有这句'), []);
  assert.equal(filterTurnNavItems(items, '  ').length, 2);
});

test('resolveActiveTurnId is monotonic and pins the last item at the bottom', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const tops: Record<string, number> = { a: 0, b: 400, c: 800 };
  const topOf = (id: string) => tops[id];
  const metrics = (scrollTop: number) => ({
    scrollTop,
    clientHeight: 400,
    scrollHeight: 1200,
  });

  assert.equal(resolveActiveTurnId(items, topOf, metrics(0)), 'a');
  assert.equal(resolveActiveTurnId(items, topOf, metrics(390)), 'b');
  // Near the bottom of the thread: last question, even if the marker sits on a neighbour.
  assert.equal(resolveActiveTurnId(items, topOf, metrics(780)), 'c');
  assert.equal(resolveActiveTurnId(items, topOf, metrics(800)), 'c');
});

test('resolveActiveTurnId does not skip a short question just below the marker', () => {
  const items = [{ id: 'a' }, { id: 'b' }];
  const tops: Record<string, number> = { a: 8, b: 80 };
  const topOf = (id: string) => tops[id];
  // Clicking A scrolls it to the top; a 24px marker must not jump to B at 80px.
  assert.equal(
    resolveActiveTurnId(items, topOf, { scrollTop: 0, clientHeight: 600, scrollHeight: 2000 }),
    'a',
  );
});

test('resolveActiveTurnId pins the last turn when visible near the bottom of short threads', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  // 最后一轮 c 位于 750px，视口高度 600，整个容器高度 1100（最大 scrollTop 为 500）
  // 滚动到底时，c 处于 750 - 500 = 250px（视口中央），虽然未到达顶部 24px marker，但由于已展示在视口中且接近底端，应可靠激活 c
  const tops: Record<string, number> = { a: 0, b: 350, c: 750 };
  const topOf = (id: string) => tops[id];
  assert.equal(
    resolveActiveTurnId(items, topOf, { scrollTop: 450, clientHeight: 600, scrollHeight: 1100 }),
    'c',
  );
});

test('buildTurnNavItems extracts prompt and response preview for turn navigation rail', () => {
  const items = buildTurnNavItems([
    { role: 'user', text: '你好' },
    { role: 'assistant', text: '你好！我是你的编码助手。' },
    { role: 'user', text: '你在干什么' },
    { role: 'assistant', text: '我没在做什么——刚才只是打了声招呼。' },
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[0].turn, 1);
  assert.equal(items[0].prompt, '你好');
  assert.equal(items[0].response, '你好！我是你的编码助手。');
  assert.equal(items[0].unloaded, false);

  assert.equal(items[1].turn, 2);
  assert.equal(items[1].prompt, '你在干什么');
  assert.equal(items[1].response, '我没在做什么——刚才只是打了声招呼。');
  assert.equal(items[1].unloaded, false);
});

test('buildTurnNavItemsFromOutline merges loaded responses and flags unloaded turns', () => {
  const loaded = buildTurnNavItems([
    { role: 'user', text: '第二问', sourceIndex: 10, turnNavOrdinal: 1 },
    { role: 'assistant', text: '第二问的回答', sourceIndex: 11 },
  ]);
  const outline = [
    { ordinal: 0, index: 0, text: '第一问（未加载）' },
    { ordinal: 1, index: 10, text: '第二问' },
  ];
  const items = buildTurnNavItemsFromOutline(outline, loaded);
  assert.equal(items.length, 2);
  assert.equal(items[0].turn, 1);
  assert.equal(items[0].prompt, '第一问（未加载）');
  assert.equal(items[0].response, '');
  assert.equal(items[0].unloaded, true);

  assert.equal(items[1].turn, 2);
  assert.equal(items[1].prompt, '第二问');
  assert.equal(items[1].response, '第二问的回答');
  assert.equal(items[1].unloaded, false);
});

test('formatTokenMetric formats tokens into human readable metric', () => {
  assert.equal(formatTokenMetric(0), '0');
  assert.equal(formatTokenMetric(undefined), '0');
  assert.equal(formatTokenMetric(500), '500');
  assert.equal(formatTokenMetric(1500), '1.5k');
  assert.equal(formatTokenMetric(18500), '19k');
  assert.equal(formatTokenMetric(1200000), '1.2M');
});

test('buildTurnNavItems computes per-turn and cumulative tokens', () => {
  const items = buildTurnNavItems([
    { role: 'user', text: '第一问', tokens: 100 },
    { role: 'assistant', text: '第一问回答', tokens: 400 },
    { role: 'user', text: '第二问', tokens: 200 },
    { role: 'assistant', text: '第二问回答', tokens: 800 },
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[0].tokens, 500);
  assert.equal(items[0].cumulativeTokens, 500);
  assert.equal(items[1].tokens, 1000);
  assert.equal(items[1].cumulativeTokens, 1500);
});

test('buildTurnNavItemsFromOutline incorporates turnStats per turn accurately', () => {
  const outline = [
    { ordinal: 0, index: 0, text: '第一问' },
    { ordinal: 1, index: 10, text: '第二问' },
  ];
  const turnStats = [
    { turn_id: 1, total_tokens: 85000, model_usage: [{ prompt_tokens: 80000, completion_tokens: 5000 }] },
    { turn_id: 2, total_tokens: 120000, model_usage: [{ prompt_tokens: 30000, completion_tokens: 5000 }] },
  ];
  const items = buildTurnNavItemsFromOutline(outline, undefined, turnStats);
  assert.equal(items.length, 2);
  assert.equal(items[0].tokens, 85000);
  assert.equal(items[0].cumulativeTokens, 85000);
  assert.equal(items[1].tokens, 35000);
  assert.equal(items[1].cumulativeTokens, 120000);
});

test('buildTurnNavItemsFromOutline ensures cumulativeTokens is monotonically increasing and never smaller than turn tokens', () => {
  const outline = [
    { ordinal: 0, index: 0, text: '最新版本都到1.0.5了' },
    { ordinal: 1, index: 5, text: '那别人的是怎么做到的' },
    { ordinal: 2, index: 12, text: '具体怎么做' },
    { ordinal: 3, index: 20, text: '给我一个最好的方案' },
  ];
  // 模拟真实生产场景：单轮消耗 83k，但 stat.total_tokens 仅记录最终请求（62k）
  const turnStats = [
    { turn_id: 1, total_tokens: 31000, model_usage: [{ prompt_tokens: 28000, completion_tokens: 3000 }] },
    { turn_id: 2, total_tokens: 62000, model_usage: [{ prompt_tokens: 75000, completion_tokens: 8000 }] },
    { turn_id: 3, total_tokens: 31000, model_usage: [{ prompt_tokens: 28000, completion_tokens: 3000 }] },
    { turn_id: 4, total_tokens: 62000, model_usage: [{ prompt_tokens: 75000, completion_tokens: 8000 }] },
  ];
  const items = buildTurnNavItemsFromOutline(outline, undefined, turnStats);
  assert.equal(items.length, 4);

  // 第 1 轮：31k，累计 31k
  assert.equal(items[0].tokens, 31000);
  assert.equal(items[0].cumulativeTokens, 31000);

  // 第 2 轮：本轮 83k，累计必须为 31k + 83k = 114k，绝不能倒挂成 62k！
  assert.equal(items[1].tokens, 83000);
  assert.equal(items[1].cumulativeTokens, 114000);
  assert.ok(items[1].cumulativeTokens! >= items[1].tokens!);

  // 第 3 轮：本轮 31k，累计必须单调递增为 114k + 31k = 145k
  assert.equal(items[2].tokens, 31000);
  assert.equal(items[2].cumulativeTokens, 145000);
  assert.ok(items[2].cumulativeTokens! > items[1].cumulativeTokens!);

  // 第 4 轮：本轮 83k，累计必须为 145k + 83k = 228k
  assert.equal(items[3].tokens, 83000);
  assert.equal(items[3].cumulativeTokens, 228000);
  assert.ok(items[3].cumulativeTokens! > items[2].cumulativeTokens!);
});

test('buildTurnNavItemsFromOutline handles model_usage with cached_input correctly', () => {
  const outline = [
    { ordinal: 0, index: 0, text: '第一问' },
  ];
  const turnStats = [
    {
      turn_id: 1,
      model_usage: [
        {
          tokens: { input: 12000, output: 2000, cached_input: 18000 },
        },
      ],
    },
  ];
  const items = buildTurnNavItemsFromOutline(outline, undefined, turnStats);
  assert.equal(items.length, 1);
  // input (12k) + cached_input (18k) + output (2k) = 32k
  assert.equal(items[0].tokens, 32000);
  assert.equal(items[0].cumulativeTokens, 32000);
});

test('buildTurnNavItemsFromOutline does not stack cached_input across multi-round tool calls into millions', () => {
  const outline = [
    { ordinal: 0, index: 0, text: '第一问' },
    { ordinal: 1, index: 10, text: '第二问（执行了40次工具调用）' },
  ];
  const turnStats = [
    {
      turn_id: 1,
      total_tokens: 85000,
      model_usage: [{ tokens: { input: 15000, output: 5000, cached_input: 65000 } }],
    },
    {
      turn_id: 2,
      total_tokens: 132000,
      round_count: 40,
      model_usage: [{ tokens: { input: 35000, output: 15000, cached_input: 5800000 } }],
    },
  ];
  const items = buildTurnNavItemsFromOutline(outline, undefined, turnStats);
  assert.equal(items.length, 2);
  assert.equal(items[0].tokens, 85000);
  assert.equal(items[0].cumulativeTokens, 85000);

  // 第 2 轮单轮消耗应为新增 uncached input (35k) + output (15k) = 50k，绝不能是 5.8M！
  assert.equal(items[1].tokens, 50000);
  // 累计应在 132k~135k 左右，绝不能是 11.8M！
  assert.equal(items[1].cumulativeTokens, 135000);
  assert.ok(items[1].tokens! < 100000);
  assert.ok(items[1].cumulativeTokens! < 200000);
});

test('resolveTurnTokenState accurately manages pending, in_progress and settled states', () => {
  const dummyItem = {
    id: 'turn-nav-2',
    ordinal: 2,
    index: 5,
    label: '第三问',
    text: '那我现在的把ds宠物的...',
    turn: 3,
    prompt: '第三问',
    response: '',
  };

  // 1. 用户刚发出的第 3 轮（isLastTurn = true, tokens = undefined），必须是 pending，且绝不将累计 132k 当成本轮！
  const pendingState = resolveTurnTokenState({
    item: dummyItem,
    isLastTurn: true,
    isBusy: false,
    sessionTotalTokens: 132000,
  });
  assert.equal(pendingState.status, 'pending');
  assert.equal(pendingState.turnTokens, undefined);
  assert.equal(pendingState.cumulativeTokens, 132000);

  // 2. 正在进行中的第 3 轮（isBusy = true）
  const inProgressState = resolveTurnTokenState({
    item: dummyItem,
    isLastTurn: true,
    isBusy: true,
    sessionTotalTokens: 132000,
    activeTurnDeltaTokens: 45,
  });
  assert.equal(inProgressState.status, 'in_progress');
  assert.equal(inProgressState.turnTokens, 45);
  assert.equal(inProgressState.cumulativeTokens, 132000);

  // 3. 已结算的轮次
  const settledItem = {
    ...dummyItem,
    tokens: 2800,
    cumulativeTokens: 35000,
  };
  const settledState = resolveTurnTokenState({
    item: settledItem,
    isLastTurn: false,
    isBusy: false,
  });
  assert.equal(settledState.status, 'settled');
  assert.equal(settledState.turnTokens, 2800);
  assert.equal(settledState.cumulativeTokens, 35000);
});
