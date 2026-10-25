import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  consumesProgrammaticStopMark,
  isStaleProgrammaticStopFrame,
  isStaleTerminalForArmedTurn,
  runningTurnStopAliases,
  stopAliasAllowsNextTurn,
} from './turnStop.ts';

test('runningTurnStopAliases falls back to the session id after requestIdRef was cleared', () => {
  // 回归防线：本端回合被 /chat admit 之后 requestIdRef 已清空（null），
  // 此时仍必须能停止运行中的回合——否则「立即发送」会整体跳过停止并撞上 409 session_busy。
  assert.deepEqual(
    runningTurnStopAliases({ requestAlias: null, sessionId: 'session-1' }),
    ['session-1'],
  );
});

test('runningTurnStopAliases sends request alias first and dedupes a bound session', () => {
  assert.deepEqual(
    runningTurnStopAliases({ requestAlias: 'req-1', sessionId: 'session-1' }),
    ['req-1', 'session-1'],
  );
  assert.deepEqual(
    runningTurnStopAliases({ requestAlias: 'session-1', sessionId: 'session-1' }),
    ['session-1'],
  );
});

test('runningTurnStopAliases ignores blanks and stays empty when idle', () => {
  assert.deepEqual(runningTurnStopAliases({}), []);
  assert.deepEqual(runningTurnStopAliases({ requestAlias: '  ', sessionId: null }), []);
  assert.deepEqual(
    runningTurnStopAliases({ requestAlias: ' req-1 ', sessionId: undefined }),
    ['req-1'],
  );
});

test('consumesProgrammaticStopMark only matches the same session inside the window', () => {
  const mark = { sessionId: 'session-1', expiresAt: 1000 };
  assert.equal(consumesProgrammaticStopMark(mark, 'session-1', 999), true);
  assert.equal(consumesProgrammaticStopMark(mark, 'session-1', 1000), true);
  assert.equal(consumesProgrammaticStopMark(mark, 'session-1', 1001), false);
  assert.equal(consumesProgrammaticStopMark(mark, 'session-2', 500), false);
  assert.equal(consumesProgrammaticStopMark(mark, null, 500), false);
  assert.equal(consumesProgrammaticStopMark(null, 'session-1', 500), false);
});

test('stopAliasAllowsNextTurn treats an idle alias as free and a live turn as busy', () => {
  assert.equal(stopAliasAllowsNextTurn({ released: true, message: 'stopped' }), true);
  assert.equal(stopAliasAllowsNextTurn({ released: true }), true);
  assert.equal(
    stopAliasAllowsNextTurn({ released: false, message: 'Chat session req-1 was not running' }),
    true,
  );
  assert.equal(
    stopAliasAllowsNextTurn({ released: false, message: 'Chat session s1 stopped' }),
    false,
  );
  assert.equal(stopAliasAllowsNextTurn({ released: false }), false);
});

test('isStaleTerminalForArmedTurn 只吞“新回合尚未吐帧”窗口内的终态', () => {
  // 刚投递、还没吐帧：这就是上一回合的缓存终态（自动 drain 后的假停止根因）。
  assert.equal(isStaleTerminalForArmedTurn({ armedAt: 1_000, frameSeen: false, now: 1_500 }), true);
  // 已吐过帧：这条终态属于本轮，必须照常收尾。
  assert.equal(isStaleTerminalForArmedTurn({ armedAt: 1_000, frameSeen: true, now: 1_500 }), false);
  // 没投递过新回合：不干预。
  assert.equal(isStaleTerminalForArmedTurn({ frameSeen: false, now: 1_500 }), false);
  // 窗口过期（真失败永远收不到帧）：交回正常终态处理，避免 bus 永久卡住。
  assert.equal(isStaleTerminalForArmedTurn({ armedAt: 1_000, frameSeen: false, now: 20_000 }), false);
  assert.equal(
    isStaleTerminalForArmedTurn({ armedAt: 1_000, frameSeen: false, now: 5_000, ttlMs: 2_000 }),
    false,
  );
});

test('isStaleProgrammaticStopFrame swallows only the displaced turn terminal pair', () => {
  const mark = { sessionId: 's1', expiresAt: 10_000 };
  const at = 9_000;

  // 取消会先发 done(cancelled)，再发 legacy stopped；两条都属于被「立即发送」换掉的那一轮。
  assert.equal(isStaleProgrammaticStopFrame(mark, { type: 'stopped' }, 's1', at), true);
  assert.equal(
    isStaleProgrammaticStopFrame(mark, { type: 'done', stop_reason: 'cancelled' }, 's1', at),
    true,
  );
  assert.equal(
    isStaleProgrammaticStopFrame(mark, { type: 'done', stop_reason: 'stopped' }, 's1', at),
    true,
  );

  // 新回合的正常完成绝不能被吞（否则真实终态不弹通知/不回吐队列）。
  assert.equal(
    isStaleProgrammaticStopFrame(mark, { type: 'done', stop_reason: 'provider_error' }, 's1', at),
    false,
  );
  assert.equal(isStaleProgrammaticStopFrame(mark, { type: 'done' }, 's1', at), false);

  // 会话不匹配 / 标记过期 / 无标记：一律不算旧回合。
  assert.equal(isStaleProgrammaticStopFrame(mark, { type: 'stopped' }, 's2', at), false);
  assert.equal(isStaleProgrammaticStopFrame(mark, { type: 'stopped' }, 's1', 10_001), false);
  assert.equal(isStaleProgrammaticStopFrame(null, { type: 'stopped' }, 's1', at), false);
});
