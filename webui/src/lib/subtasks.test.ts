import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applySubtaskProgress,
  applySubtaskResultsFromOutput,
  settleSubtasksFromOutput,
  subtaskCounts,
  subtasksFromTaskArgs,
  SUBAGENT_ACTIVITY_MARKER,
  taskArgsSummary,
} from './subtasks.ts';

const ARGS = JSON.stringify({
  tasks: [
    { subagent_type: 'explore', description: 'inspect jeikcode' },
    { subagent_type: 'explore', description: 'inspect codex' },
    { subagent_type: 'explore', description: 'inspect opencode' },
  ],
});

test('subtasksFromTaskArgs seeds pending rows', () => {
  const items = subtasksFromTaskArgs(ARGS)!;
  assert.equal(items.length, 3);
  assert.equal(items[0]!.label, 'explore#1');
  assert.equal(items[0]!.description, 'inspect jeikcode');
  assert.equal(items[0]!.status, 'pending');
  assert.equal(items[2]!.label, 'explore#3');
});

test('applySubtaskProgress updates rows independently (parallel view)', () => {
  let items = subtasksFromTaskArgs(ARGS)!;
  items = applySubtaskProgress(
    items,
    `${SUBAGENT_ACTIVITY_MARKER}\u{21bb} explore#1 \u{b7} deepseek-v4-flash \u{b7} inspect jeikcode`,
  );
  items = applySubtaskProgress(
    items,
    `${SUBAGENT_ACTIVITY_MARKER}\u{21bb} explore#3 \u{b7} deepseek-v4-flash \u{b7} inspect opencode`,
  );
  items = applySubtaskProgress(
    items,
    `${SUBAGENT_ACTIVITY_MARKER}explore#1 \u{b7} reading files \u{b7} tokens=100`,
  );
  items = applySubtaskProgress(
    items,
    `${SUBAGENT_ACTIVITY_MARKER}explore#3 \u{b7} thinking \u{b7} tokens=50`,
  );

  assert.equal(items[0]!.status, 'running');
  assert.equal(items[0]!.activity, 'reading files');
  assert.equal(items[0]!.outputTokens, 100);
  assert.equal(items[1]!.status, 'pending');
  assert.equal(items[2]!.status, 'running');
  assert.equal(items[2]!.activity, 'thinking');
  assert.equal(items[2]!.outputTokens, 50);

  const counts = subtaskCounts(items);
  assert.equal(counts.running, 2);
  assert.equal(counts.pending, 1);
  assert.equal(counts.completed, 0);
});

test('completed status is sticky', () => {
  let items = subtasksFromTaskArgs(ARGS)!;
  items = applySubtaskProgress(
    items,
    `${SUBAGENT_ACTIVITY_MARKER}\u{2713} done \u{b7} explore#1 \u{b7} deepseek-v4-flash \u{b7} inspect jeikcode`,
  );
  items = applySubtaskProgress(
    items,
    `${SUBAGENT_ACTIVITY_MARKER}explore#1 \u{b7} should-not-apply \u{b7} tokens=999`,
  );
  assert.equal(items[0]!.status, 'completed');
  assert.equal(items[0]!.activity, 'completed');
  assert.equal(items[0]!.outputTokens, 0);
});

test('applySubtaskResultsFromOutput restores panel after history reload', () => {
  const workerArgs = JSON.stringify({
    tasks: [
      { subagent_type: 'worker', description: '子代理1' },
      { subagent_type: 'worker', description: '子代理2' },
      { subagent_type: 'worker', description: '子代理3' },
      { subagent_type: 'worker', description: '子代理4' },
    ],
  });
  let items = subtasksFromTaskArgs(workerArgs)!;
  assert.equal(items.length, 4);
  assert.equal(taskArgsSummary(workerArgs), '4 subagents');

  const output = [
    '<task id="worker#1" model="auto" state="completed">你好1</task>',
    '<task id="worker#2" model="auto" state="completed">你好2</task>',
    '<task id="worker#3" model="auto" state="failed">err</task>',
    '<task id="worker#4" model="auto" state="completed">你好4</task>',
  ].join('\n');

  items = applySubtaskResultsFromOutput(items, output);
  assert.equal(items[0]!.status, 'completed');
  assert.equal(items[0]!.model, 'auto');
  assert.equal(items[1]!.status, 'completed');
  assert.equal(items[2]!.status, 'failed');
  assert.equal(items[3]!.status, 'completed');
  const counts = subtaskCounts(items);
  assert.equal(counts.completed, 3);
  assert.equal(counts.failed, 1);
});

test('settleSubtasksFromOutput settles a finished batch from <task> blocks', () => {
  // Live rows whose terminal `✓ done` progress line was lost stay `running`
  // under a tool row that already reads done. The tool result is authoritative.
  const args = JSON.stringify({
    tasks: [
      { subagent_type: 'explore', description: 'a' },
      { subagent_type: 'explore', description: 'b' },
    ],
  });
  const stuck = subtasksFromTaskArgs(args)!.map((item) => ({
    ...item,
    status: 'running' as const,
    activity: 'analyzing',
  }));
  const output = [
    '<task id="explore#1" model="auto" state="completed">done</task>',
    '<task id="explore#2" model="auto" state="completed">done</task>',
  ].join('\n');

  const settled = settleSubtasksFromOutput(
    { name: 'task', args, subtasks: stuck },
    output,
  );
  assert.ok(settled, 'stuck rows must settle');
  assert.equal(settled!.subtasks[0]!.status, 'completed');
  assert.equal(settled!.subtasks[1]!.status, 'completed');
  assert.equal(subtaskCounts(settled!.subtasks).running, 0);

  // Idempotent: settling again changes nothing, so there is no needless re-render.
  assert.equal(
    settleSubtasksFromOutput({ name: 'task', args, subtasks: settled!.subtasks }, output),
    undefined,
  );

  // Seeds from the dispatch args when the live panel was never created.
  const seeded = settleSubtasksFromOutput({ name: 'task', args }, output);
  assert.ok(seeded, 'panel must be seeded from args');
  assert.equal(seeded!.subtasks[0]!.status, 'completed');

  // Other tools / empty output are untouched.
  assert.equal(settleSubtasksFromOutput({ name: 'grep', args: '{}' }, output), undefined);
  assert.equal(settleSubtasksFromOutput({ name: 'task', args }, undefined), undefined);
});
