import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getMemorySession,
  getSessionCache,
  hasMemorySession,
  saveSessionCache,
  appendMessageToSessionCache,
  clearAllSessionCache,
} from './sessionCache.ts';

test('sessionCache manages L1 memory LRU correctly', async () => {
  const p = 'proj-1';
  const s = 'sess-1';
  await clearAllSessionCache();
  assert.equal(hasMemorySession(p, s), false);

  await saveSessionCache(p, s, [{ role: 'user', content: 'hello' }]);
  assert.equal(hasMemorySession(p, s), true);

  const mem = getMemorySession(p, s);
  assert.ok(mem);
  assert.equal(mem?.messages.length, 1);
  assert.equal(mem?.messages[0].content, 'hello');

  appendMessageToSessionCache(p, s, { role: 'assistant', content: 'world' });
  const updated = getMemorySession(p, s);
  assert.equal(updated?.messages.length, 2);

  await clearAllSessionCache();
  assert.equal(hasMemorySession(p, s), false);
});

test('sessionCache preserves turns outline', async () => {
  const p = 'proj-2';
  const s = 'sess-2';
  const turns = [{ index: 0, ordinal: 0, text: 'Q1' }, { index: 1, ordinal: 1, text: 'Q2' }];
  await saveSessionCache(p, s, [{ role: 'user', content: 'Q1' }], undefined, undefined, turns);
  const mem = getMemorySession(p, s);
  assert.ok(mem);
  assert.deepEqual(mem?.turns, turns);

  // 验证当 projectHash 为空时，按 sessionId 能够成功检索命中（冷启动离线秒出保障）
  const offline = await getSessionCache('', s);
  assert.ok(offline);
  assert.equal(offline?.sessionId, s);
  assert.equal(offline?.projectHash, p);
  assert.equal(offline?.messages.length, 1);
  assert.equal(offline?.messages[0].content, 'Q1');

  await clearAllSessionCache();
});
