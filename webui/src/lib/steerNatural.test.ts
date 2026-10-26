import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mergeDiskWithUnpersistedTail,
  transcriptHasInFlightAssistant,
} from './chatTerminal.ts';
import { placeArchivedTodos } from './todos.ts';
import { spliceAuthoritativeDiskTail } from './sessionProjection.ts';

/**
 * Regression: a steer card that naturally drains after the previous turn ends.
 *
 * The old turn's `done` can run after the steer has already appended its user
 * bubble + an empty assistant placeholder. Two things must hold:
 * 1. the completed todo archive lands on the previous answer, not the new loop;
 * 2. an old disk-tail reconcile must not drop the steer bubble or the new loop.
 */
test('natural steer keeps its bubble/new loop and archives the previous todo', () => {
  const prevUser = {
    role: 'user',
    id: 'u-prev',
    sourceIndex: 0,
    parts: [{ kind: 'text', text: '上一问' }],
  };
  const prevAssistant = {
    role: 'assistant',
    id: 'a-prev',
    sourceIndex: 1,
    parts: [{ kind: 'text', text: '上一轮回答' }],
  };
  const steerUser = {
    role: 'user',
    isSteer: true,
    // The optimistic turn index is a guess, not the persisted absolute index.
    sourceIndex: 48,
    parts: [{ kind: 'text', text: 'steer 自然发出' }],
  };
  const steerAssistant = { role: 'assistant', parts: [] };
  const canvas = [prevUser, prevAssistant, steerUser, steerAssistant];
  const archive = [
    { content: '步骤 1', status: 'completed' },
    { content: '步骤 2', status: 'completed' },
  ];

  const archived = placeArchivedTodos(canvas, archive, null);
  assert.equal(
    archived[1]!.parts.some((part) => part.kind === 'todo_list'),
    true,
    'the completed plan belongs to the previous answer',
  );
  assert.equal(
    archived[3]!.parts.some((part) => part.kind === 'todo_list'),
    false,
    'the new-loop placeholder must stay clean',
  );

  // The first tool of the new loop arrives before the old disk tail catches up.
  const live = {
    ...archived[3]!,
    parts: [
      ...archived[3]!.parts,
      { kind: 'reasoning', text: '新 loop 思考' },
      { kind: 'tool', tool: { id: 'call-new', name: 'run_command', status: 'pending' } },
    ],
  };
  const running = [archived[0]!, archived[1]!, archived[2]!, live];
  assert.equal(transcriptHasInFlightAssistant(running), true);

  const disk = [prevUser, prevAssistant];
  const spliced = spliceAuthoritativeDiskTail(running, disk, 0);
  const merged = mergeDiskWithUnpersistedTail(spliced, running);
  assert.equal(merged.length, 4, 'steer bubble + new loop must survive the old tail');
  assert.equal(merged[2]!.role, 'user');
  assert.equal(
    merged[2]!.parts.some((part) => part.kind === 'text' && part.text === 'steer 自然发出'),
    true,
  );
  assert.equal(
    merged[3]!.parts.some((part) => part.kind === 'tool' && part.tool?.id === 'call-new'),
    true,
  );
});
