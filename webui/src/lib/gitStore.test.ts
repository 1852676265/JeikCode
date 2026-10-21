import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gitStore, type GitProjectState } from './gitStore.ts';

test('gitStore provides synchronous default state without blank loading screen', () => {
  const cwd = '/test/repo/project-a';
  const state = gitStore.getState(cwd);
  assert.equal(state.loading, false);
  assert.equal(state.commits.length, 0);
  assert.equal(state.error, null);
});

test('gitStore subscriber detects listener attachment and detachment', () => {
  const cwd = '/test/repo/project-b';
  assert.equal(gitStore.hasSubscribers(cwd), false);

  let notified = false;
  const unsubscribe = gitStore.subscribe(cwd, () => {
    notified = true;
  });

  assert.equal(gitStore.hasSubscribers(cwd), true);
  unsubscribe();
  assert.equal(gitStore.hasSubscribers(cwd), false);
  assert.equal(notified, false);
});

test('gitStore setOptimisticState updates state synchronously and notifies subscribers', () => {
  const cwd = '/test/repo/project-c';
  let observedState: GitProjectState | null = null;
  const unsubscribe = gitStore.subscribe(cwd, (s) => {
    observedState = s;
  });

  gitStore.setOptimisticState(cwd, (prev) => ({
    ...prev,
    gitStatus: {
      is_repo: true,
      ahead: 1,
      behind: 0,
      staged: [{ path: 'foo.txt', status: 'M', staged: true }],
      unstaged: [],
      untracked: [],
    },
  }));

  assert.ok(observedState);
  assert.equal((observedState as any).gitStatus?.ahead, 1);
  assert.equal((observedState as any).gitStatus?.staged.length, 1);
  assert.equal((observedState as any).gitStatus?.staged[0]?.path, 'foo.txt');
  unsubscribe();
});
