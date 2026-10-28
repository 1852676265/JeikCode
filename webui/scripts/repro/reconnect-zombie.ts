/**
 * BUG1 复现：手机端长断网后重连，画布停在「工具行 Running…」+ 停止按钮不回落。
 *
 * 这不是 UI 渲染问题：工具行的状态完全由消息 part 的 `status` 决定（`pending` →
 * "Running…"），而画布只在两条路径上被磁盘校正：
 *   1) 会话切换/冷启动时（`spliceAuthoritativeDiskTail`）
 *   2) 终态/唤醒收尾时（`catchUpFromDisk`）
 * 路径 2 的旧实现有两个致命闸门：
 *   • 只在「画布为空」时才采用磁盘（`if (!canvas || canvas.length === 0)`），
 *     非空画布永远不会被修正 —— 丢掉一帧 tool_result 就永久停在运行中；
 *   • 收尾前 `isLocalTurnInFlight()` 把 `/chat/watch` 观察流条目也算「本端回合」，
 *     断网后这条观察流永远收不到终态，于是收尾永不发生（停止按钮一直亮）。
 *
 * 本脚本用仓库真实的投影/合并函数，把「旧闸门」与「新闸门」跑同一份数据做差分。
 * 运行：node webui/scripts/repro/reconnect-zombie.ts
 */
import {
  spliceAuthoritativeDiskTail,
  sanitizeCanvasMessages,
} from '../../src/lib/sessionProjection.ts';
import {
  mergeDiskWithUnpersistedTail,
  transcriptHasInFlightAssistant,
} from '../../src/lib/chatTerminal.ts';
import {
  lastAssistantTextLen,
  ownsRunningLocalSend,
  shouldAdoptAuthoritativeTail,
} from '../../src/lib/chatSettle.ts';

type Part = {
  kind: string;
  text?: string;
  tool?: { id?: string; name?: string; status?: string; output?: string };
};
type Row = {
  id?: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  parts: Part[];
  sourceIndex?: number;
};

const textLen = (rows: Row[]) =>
  rows.reduce(
    (sum, m) =>
      sum +
      m.parts
        .filter((p) => p.kind === 'text' || p.kind === 'reasoning')
        .reduce((n, p) => n + (p.text?.length ?? 0), 0),
    0,
  );

/** 手机画布：断网前只画到 RunCommand 的实时输出（20s），之后一帧都没收到。 */
function phoneCanvas(): Row[] {
  return [
    { id: 'u1', role: 'user', sourceIndex: 0, parts: [{ kind: 'text', text: '你好 请帮我运行一个 sleep120s 后输出 helloworld 的任务' }] },
    {
      id: 'a1',
      role: 'assistant',
      sourceIndex: 1,
      parts: [
        { kind: 'text', text: '好的，我开始尝试写脚本' },
        { kind: 'tool', tool: { id: 'call_write', name: 'Write', status: 'done', output: 'dummy.txt 已写入' } },
        { kind: 'reasoning', text: 'Thinking' },
        {
          kind: 'tool',
          tool: {
            id: 'call_bash',
            name: 'RunCommand',
            status: 'pending',
            output: '[still running: 20s total, 20s without output (pid 8268)]',
          },
        },
      ],
    },
  ];
}

/** 服务端磁盘：回合已结算（sleep 结束、helloworld 已输出、loop 已停）。 */
function settledDisk(): Row[] {
  const canvas = phoneCanvas();
  return [
    canvas[0]!,
    {
      ...canvas[1]!,
      parts: [
        { kind: 'text', text: '好的，我开始尝试写脚本' },
        { kind: 'tool', tool: { id: 'call_write', name: 'Write', status: 'done', output: 'dummy.txt 已写入' } },
        { kind: 'reasoning', text: 'Thinking' },
        {
          kind: 'tool',
          tool: { id: 'call_bash', name: 'RunCommand', status: 'done', output: 'helloworld' },
        },
        { kind: 'text', text: 'helloworld 已输出，任务完成。' },
      ],
    },
  ];
}

const diskHasCanvasUser = (disk: Row[], canvas: Row[]) => {
  const lastUser = (rows: Row[]) => {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i]!.role === 'user') {
        return rows[i]!.parts.filter((p) => p.kind === 'text').map((p) => p.text ?? '').join('');
      }
    }
    return '';
  };
  const canvasUser = lastUser(canvas).trim();
  if (!canvasUser) return true;
  const diskUser = lastUser(disk).trim();
  return diskUser === canvasUser || diskUser.endsWith(canvasUser) || canvasUser.endsWith(diskUser);
};

// ───────────────────────── 旧闸门（当前 Chat.tsx catchUpFromDisk） ─────────────────────────
function oldAdoptGate(canvas: Row[], disk: Row[]) {
  const running = false; // 服务端权威：已空闲
  const diskHasUser = diskHasCanvasUser(disk, canvas);
  const diskSettled = diskHasUser && !transcriptHasInFlightAssistant(disk) && !running;
  const adoptSettledDisk =
    !running && diskSettled && diskHasUser && textLen(disk) > textLen(canvas);
  // ← 就是这一行：非空画布直接跳过
  return { adopt: adoptSettledDisk && canvas.length === 0 };
}

// ───────────────────────── 新闸门（修复后：仓库真实决策函数） ─────────────────────────
function newAdoptGate(canvas: Row[], disk: Row[]) {
  const running = false;
  const diskHasUser = diskHasCanvasUser(disk, canvas);
  const diskSettled = diskHasUser && !transcriptHasInFlightAssistant(disk) && !running;
  return {
    adopt: shouldAdoptAuthoritativeTail({
      running,
      diskHasUser,
      diskSettled,
      canvasInFlight: transcriptHasInFlightAssistant(canvas),
      diskLastTextLen: lastAssistantTextLen(disk),
      canvasLastTextLen: lastAssistantTextLen(canvas),
    }),
  };
}

function applyAdopt(canvas: Row[], disk: Row[], diskOffset: number): Row[] {
  const spliced = spliceAuthoritativeDiskTail(canvas, disk, diskOffset);
  return sanitizeCanvasMessages(mergeDiskWithUnpersistedTail(spliced, canvas));
}

function describe(rows: Row[]): string {
  const parts: string[] = [];
  for (const m of rows) {
    for (const p of m.parts) {
      if (p.kind === 'tool') parts.push(`${p.tool?.name}:${p.tool?.status}`);
      else if (p.kind === 'text' && p.text) parts.push(`text(${p.text.length})`);
    }
  }
  return parts.join(' | ');
}

// ───────────────────── 旧闸门：收尾被观察流条目永久拦住 ─────────────────────
type RuntimeBelief = {
  localTurn: boolean;
  backgroundRunning: boolean;
  /** localActiveStreamsBySessionRef 条目；/chat/watch 注册的是 watchOnly。 */
  stream: { watchOnly: boolean; aborted: boolean } | null;
};

const oldIsLocalTurnInFlight = (s: RuntimeBelief) =>
  s.localTurn || s.backgroundRunning || s.stream != null;

const newOwnsRunningLocalSend = (s: RuntimeBelief) =>
  ownsRunningLocalSend(
    s.stream
      ? {
          watchOnly: s.stream.watchOnly,
          abortController: { signal: { aborted: s.stream.aborted } },
        }
      : null,
  );

function runScenario(label: string, adoptGate: 'old' | 'new') {
  const canvas = phoneCanvas();
  const disk = settledDisk();
  const belief: RuntimeBelief = {
    localTurn: false,
    backgroundRunning: true, // 会话加载时 /chat/active 说 active，观察开始
    stream: { watchOnly: true, aborted: false }, // /chat/watch 断网后永远不更新
  };

  const inFlight = adoptGate === 'old' ? oldIsLocalTurnInFlight(belief) : newOwnsRunningLocalSend(belief);
  const settledBusy = !inFlight; // 收尾能跑到底 → busy 回落成发送箭头

  const gate = adoptGate === 'old' ? oldAdoptGate(canvas, disk) : newAdoptGate(canvas, disk);
  const next = settledBusy && gate.adopt ? applyAdopt(canvas, disk, 0) : canvas;

  const zombie = next.some((m) =>
    m.parts.some((p) => p.kind === 'tool' && p.tool?.status === 'pending'),
  );
  const hasFinal = next.some((m) =>
    m.parts.some((p) => p.kind === 'text' && (p.text ?? '').includes('任务完成')),
  );

  console.log(`\n[${label}]`);
  console.log(`  收尾被本地状态拦住: ${inFlight}`);
  console.log(`  采用磁盘权威尾部:   ${gate.adopt}`);
  console.log(`  画布:               ${describe(next)}`);
  console.log(`  僵尸工具行 Running…: ${zombie ? '有 ❌' : '无 ✅'}`);
  console.log(`  最终回答已回补:      ${hasFinal ? '是 ✅' : '否 ❌'}`);

  return { blocked: inFlight, zombie, hasFinal };
}

const before = runScenario('修复前：手机重连后收尾', 'old');
const after = runScenario('修复后：手机重连后收尾', 'new');

const failures: string[] = [];
if (!(before.blocked && before.zombie && !before.hasFinal)) {
  failures.push('旧逻辑未能复现 BUG1（预期：收尾被拦 + 僵尸工具行 + 缺最终回答）');
}
if (after.blocked || after.zombie || !after.hasFinal) {
  failures.push('新逻辑未修复 BUG1（预期：收尾放行 + 僵尸清除 + 最终回答回补）');
}

// 长会话变体：画布正文总量大于磁盘 48 行窗口时，旧的 diskText>canvasText 触发条件也失效。
{
  const longCanvas: Row[] = [
    { role: 'user', parts: [{ kind: 'text', text: 'Q1'.repeat(40) }], sourceIndex: 0 },
    { role: 'assistant', parts: [{ kind: 'text', text: 'A1'.repeat(400) }], sourceIndex: 1 },
    ...phoneCanvas().map((m) => ({ ...m, sourceIndex: (m.sourceIndex ?? 0) + 2 })),
  ];
  const longDisk = [
    longCanvas[0]!,
    longCanvas[1]!,
    ...settledDisk().map((m) => ({ ...m, sourceIndex: (m.sourceIndex ?? 0) + 2 })),
  ];
  const oldGate = oldAdoptGate(longCanvas, longDisk);
  const newGate = newAdoptGate(longCanvas, longDisk);
  console.log('\n[长会话：画布正文 > 磁盘尾部窗口]');
  console.log(`  旧闸门是否尝试对账: ${oldGate.adopt ? '是' : '否 ❌'}`);
  console.log(`  新闸门是否尝试对账: ${newGate.adopt ? '是 ✅' : '否'}`);
  if (!newGate.adopt) failures.push('长会话下新闸门仍未触发磁盘对账');
}

if (failures.length > 0) {
  console.error('\n❌ 差分实验未达标：');
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log('\n✅ 差分实验通过：旧逻辑复现 BUG1，新逻辑修复。');
