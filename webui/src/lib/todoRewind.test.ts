import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  foldTodoToolCall,
  reduceLiveTodo,
  restoreStickyTodos,
  stickyFromDiskCatchUp,
  type TodoItem,
} from './todos.ts';

/**
 * 「删除 / 回溯」之后的清单回退回归（Node 版模拟）。
 *
 * 生产路径：daemon 在改写快照时按**剩余转录**重推 todo 板
 * （`crates/jeikcode-capabilities/src/tools/todo.rs::derive_current_todos`），
 * WebUI 只把 `GET sessions/:id` 的 `todos` 回填（`resyncTodosAfterMutation`）。
 *
 * 这里用前端真实的折叠原语 `foldTodoToolCall` 复刻同一套语义，断言两件事：
 * 1. 跨轮次回溯只回退被删掉的那些动作，**不是**一刀切清空；
 * 2. 单轮内「建清单→改清单→整轮删掉」仍然得到空清单（与旧行为等价）。
 */

type Msg = {
  role: 'user' | 'assistant';
  isSteer?: boolean;
  parts?: Array<{ kind: 'tool'; tool: { name: string; args: string } }>;
};

const todoCall = (args: unknown): Msg => ({
  role: 'assistant',
  parts: [{ kind: 'tool', tool: { name: 'todowrite', args: JSON.stringify(args) } }],
});
const ask = (isSteer = false): Msg => ({ role: 'user', isSteer });

/** 参照 Rust `derive_current_todos`：按序折叠；真实用户消息（含 steer）是轮次边界。 */
function deriveCurrentTodos(messages: Msg[]): TodoItem[] {
  let list: TodoItem[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      if (list.length > 0 && list.every((item) => item.status === 'completed')) list = [];
      continue;
    }
    for (const part of message.parts ?? []) {
      if (part.kind !== 'tool') continue;
      list = foldTodoToolCall(list, part.tool.name, part.tool.args) ?? [];
    }
  }
  return list;
}

const statuses = (items: TodoItem[]) => items.map((item) => `${item.content}:${item.status}`);

/**
 * A 轮：建清单（2 项）+ 推进第 1 项；
 * steer 轮：新增 1 项 + 把第 2 项改为进行中。
 */
const PLAN = {
  todos: [
    { content: '读取项目结构', status: 'in_progress' },
    { content: '修复渲染', status: 'pending' },
  ],
};
function transcript(): Msg[] {
  return [
    ask(), // 0  A 轮提问
    todoCall(PLAN), // 1  A 轮建清单
    todoCall({ action: 'update', id: 1, status: 'completed' }), // 2  A 轮推进
    ask(true), // 3  steer（插队）
    todoCall({ action: 'add', content: '补充单元测试' }), // 4  steer 之后的新动作
    todoCall({ action: 'update', id: 2, status: 'in_progress' }), // 5
  ];
}

test('跨轮次回溯：删掉 steer 轮不误杀 A 轮清单', () => {
  const all = deriveCurrentTodos(transcript());
  assert.deepEqual(statuses(all), [
    '读取项目结构:completed',
    '修复渲染:in_progress',
    '补充单元测试:pending',
  ]);

  // ① 删除 steer 整轮（提问 + 之后所有 agent 消息）：只剩 A 轮的动作。
  const afterDeleteSteerTurn = deriveCurrentTodos(transcript().slice(0, 3));
  assert.deepEqual(statuses(afterDeleteSteerTurn), [
    '读取项目结构:completed',
    '修复渲染:pending',
  ], 'A 轮的清单必须原样保留，绝不能被一刀切清空');

  // ② 回溯到 steer 提问之后（保留提问、删掉 steer 之后的内容）：状态同上。
  assert.deepEqual(
    statuses(deriveCurrentTodos(transcript().slice(0, 4))),
    statuses(afterDeleteSteerTurn),
  );

  // ③ 只回溯掉 steer 之后的第二条动作：该动作之前的都保留。
  assert.deepEqual(statuses(deriveCurrentTodos(transcript().slice(0, 5))), [
    '读取项目结构:completed',
    '修复渲染:pending',
    '补充单元测试:pending',
  ]);

  // ④ 删除 agent 回答（保留用户消息，只删本轮 assistant 行）。
  const afterDeleteAnswer = deriveCurrentTodos([...transcript().slice(0, 3), ask(true)]);
  assert.deepEqual(
    statuses(afterDeleteAnswer),
    statuses(afterDeleteSteerTurn),
    '删回答同样只回退该轮动作',
  );
});

test('单轮内建清单又整轮删除：仍然回到空清单（与旧行为等价）', () => {
  const singleTurn = [
    ask(),
    todoCall(PLAN),
    todoCall({ action: 'update', id: 1, status: 'completed' }),
  ];
  assert.equal(deriveCurrentTodos(singleTurn).length, 2);
  assert.deepEqual(deriveCurrentTodos([]), [], '整轮删干净 → 空清单');
});

test('已全部完成的清单在下一轮提问处关闭（含 steer）', () => {
  const completed = [
    ask(),
    todoCall({ todos: [{ content: '唯一一步', status: 'completed' }] }),
    ask(true),
  ];
  assert.deepEqual(deriveCurrentTodos(completed), [], '已完成清单被新轮次关闭');
});

test('前端只做权威回填：hydrate 的清单就是回退结果，不再自己算', () => {
  const rolledBack = deriveCurrentTodos(transcript().slice(0, 3));

  // 新路径：mutation 之后拉回服务端 todos → hydrate（跨轮次保留 A 轮）。
  const hydrated = reduceLiveTodo(null, { type: 'hydrate', items: rolledBack });
  assert.deepEqual(statuses(hydrated?.items ?? []), [
    '读取项目结构:completed',
    '修复渲染:pending',
  ]);
  assert.equal(
    restoreStickyTodos({ messages: [], authoritativeTodos: rolledBack })?.length,
    2,
    '切会话/刷新时 sticky 面板用同一份权威清单恢复',
  );
  assert.equal(
    stickyFromDiskCatchUp({ running: false, messages: [], authoritativeTodos: rolledBack })?.length,
    2,
  );

  // 旧路径：一刀切 clear —— 这正是被修掉的误杀。
  assert.equal(reduceLiveTodo(hydrated, { type: 'clear' }), null);
  assert.equal(
    restoreStickyTodos({ messages: [], authoritativeTodos: [] }),
    null,
    '真的删空时仍要显示为空清单',
  );
});
