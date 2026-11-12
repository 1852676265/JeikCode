import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gitStore,
  resolveDefaultRepoRoot,
  saveSessionActiveRepo,
  getSessionActiveRepo,
  type GitProjectState,
} from './gitStore.ts';

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

test('resolveDefaultRepoRoot prioritizes JeikCode and fallbacks gracefully', () => {
  const dummyRepos = [
    { root: '/root/src-dev/hermes-agent', name: 'hermes-agent', relative_path: 'hermes-agent', is_root: false },
    { root: '/root/src-dev/JeikCode', name: 'JeikCode', relative_path: 'JeikCode', is_root: false },
    { root: '/root/src-dev/openclaw', name: 'openclaw', relative_path: 'openclaw', is_root: false },
  ];

  assert.equal(resolveDefaultRepoRoot(dummyRepos as any), '/root/src-dev/JeikCode');

  const otherRepos = [
    { root: '/root/other/a', name: 'sub-a', relative_path: 'sub-a', is_root: false },
    { root: '/root/other/b', name: 'sub-b', relative_path: 'sub-b', is_root: true },
  ];
  assert.equal(resolveDefaultRepoRoot(otherRepos as any), '/root/other/b');

  const plainRepos = [
    { root: '/root/other/x', name: 'sub-x', relative_path: 'sub-x', is_root: false },
    { root: '/root/other/y', name: 'sub-y', relative_path: 'sub-y', is_root: false },
  ];
  assert.equal(resolveDefaultRepoRoot(plainRepos as any), '/root/other/x');
  assert.equal(resolveDefaultRepoRoot([]), null);
});

test('saveSessionActiveRepo and getSessionActiveRepo restore binding with fallback', () => {
  const dummyRepos = [
    { root: '/root/src-dev/hermes-agent', name: 'hermes-agent', relative_path: 'hermes-agent', is_root: false },
    { root: '/root/src-dev/JeikCode', name: 'JeikCode', relative_path: 'JeikCode', is_root: false },
  ];

  // Mock localStorage in Node.js test environment
  const store = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });

  const sid = 'test-session-123';
  saveSessionActiveRepo(sid, '/root/src-dev/JeikCode', dummyRepos as any);
  const restored = getSessionActiveRepo(sid, dummyRepos as any);
  assert.equal(restored, '/root/src-dev/JeikCode');

  // Test name matching even if root path changed
  const movedRepos = [
    { root: '/mnt/storage/JeikCode', name: 'JeikCode', relative_path: 'JeikCode', is_root: false },
  ];
  assert.equal(getSessionActiveRepo(sid, movedRepos as any), '/mnt/storage/JeikCode');
});

test('gitStore triggerAutoFetch shares in-flight Promise for concurrent calls', async () => {
  const cwd = '/test/repo/concurrent-fetch';
  // Mock fetch by triggering two concurrent calls
  const p1 = gitStore.triggerAutoFetch(cwd, { force: true });
  const p2 = gitStore.triggerAutoFetch(cwd, { force: true });
  assert.equal(p1, p2, 'Concurrent calls to triggerAutoFetch must return the exact same in-flight Promise');
  await Promise.allSettled([p1, p2]);
});
