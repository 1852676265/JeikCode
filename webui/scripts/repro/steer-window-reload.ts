/**
 * BUG2 复现：长回合里 steer + 大量 sleep 工具 + 页面远超 48 行时，
 * 重连/刷新后 steer 气泡与它后面的工具行错位、丢失或假死。
 *
 * 现场：手机丢了 steer 卡 → 别处点了「转向」→ 手机立刻断网；内核随后跑了大量
 * sleep 类长命令。整轮消息远超 48 行，磁盘只返回尾部窗口（daemon 会吸附到回合
 * 起点，所以正常结算后 steer 在窗口里；但 daemon 正在收尾 / 重启丢快照时不在）。
 *
 * 客户端落盘管线（与 Chat.tsx 完全一致）：
 *   spliceAuthoritativeDiskTail(L1 缓存, 磁盘尾部窗口, diskOffset)
 *   → mergeDiskWithUnpersistedTail(..., { diskCoversTail })
 *   → sanitizeCanvasMessages
 *
 * 运行：node webui/scripts/repro/steer-window-reload.ts
 */
import {
  spliceAuthoritativeDiskTail,
  sanitizeCanvasMessages,
} from '../../src/lib/sessionProjection.ts';
import { mergeDiskWithUnpersistedTail } from '../../src/lib/chatTerminal.ts';

type Part = {
  kind: string;
  text?: string;
  id?: string;
  tool?: { id?: string; name?: string; status?: string; output?: string };
};
type Row = {
  id?: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  parts: Part[];
  sourceIndex?: number;
  isSteer?: boolean;
};

const TAIL_WINDOW = 48;
const POST_TICKS = 60;

function diskTranscript(withSteer: boolean): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < 8; i++) {
    rows.push({ id: `uq${i}`, role: 'user', sourceIndex: rows.length, parts: [{ kind: 'text', text: `历史提问 ${i}` }] });
    rows.push({
      id: `am${i}`,
      role: 'assistant',
      sourceIndex: rows.length,
      parts: [
        { kind: 'text', text: `历史回答 ${i}` },
        { kind: 'tool', tool: { id: `hist-${i}`, name: 'Read', status: 'done', output: 'ok' } },
      ],
    });
  }
  rows.push({ id: 'q-main', role: 'user', sourceIndex: rows.length, parts: [{ kind: 'text', text: '先把项目跑起来，持续巡检' }] });
  rows.push({
    id: 'a-main-0',
    role: 'assistant',
    sourceIndex: rows.length,
    parts: [{ kind: 'text', text: '好的，我先写脚本' }, { kind: 'tool', tool: { id: 'w-0', name: 'Write', status: 'done' } }],
  });
  if (!withSteer) return rows; // daemon 还没把这一轮写进 display 日志
  rows.push({
    id: 'steer-1',
    role: 'user',
    sourceIndex: rows.length,
    isSteer: true,
    parts: [{ kind: 'text', text: '改成每 30 秒轮询一次' }],
  });
  for (let i = 0; i < POST_TICKS; i++) {
    rows.push({
      id: `a-post-${i}`,
      role: 'assistant',
      sourceIndex: rows.length,
      parts: [
        { kind: 'reasoning', text: `第 ${i} 轮巡检` },
        { kind: 'tool', tool: { id: `bash-${i}`, name: 'RunCommand', status: 'done', output: `tick ${i}` } },
      ],
    });
  }
  rows.push({
    id: 'a-final',
    role: 'assistant',
    sourceIndex: rows.length,
    parts: [{ kind: 'text', text: '巡检完成，服务稳定。' }],
  });
  return rows;
}

/**
 * daemon 的尾页算法（resolve_page_indices + take_session_page）：
 * 从 total-48 起算，再吸附回「回合起点提问」的绝对下标，因此整轮都在页内。
 */
function tailPage(rows: Row[]) {
  const total = rows.length;
  const raw = Math.max(0, total - TAIL_WINDOW);
  const isTurnStart = (m: Row) =>
    m.role === 'user' && !m.parts.some((p) => (p.text ?? '').includes('[jeikcode-steer]'));
  if (raw === 0) return { tail: rows, offset: 0 };
  let start = raw;
  if (!isTurnStart(rows[raw]!)) {
    for (let i = raw - 1; i >= 0; i--) {
      if (isTurnStart(rows[i]!)) {
        start = i;
        break;
      }
    }
  }
  return { tail: rows.slice(start), offset: start };
}

/** 手机 L1 缓存：历史 + steer（本地猜下标）+ 断网前直播出来的工具行。 */
function phoneCache(transcript: Row[], guessIndex: number | null, steers = 1, pending = true): Row[] {
  const steerIdx = transcript.findIndex((m) => m.id === 'steer-1');
  const base = transcript.filter((m) => (m.sourceIndex ?? 0) < steerIdx);
  const canvas: Row[] = [...base];
  for (let s = 0; s < steers; s++) {
    canvas.push({
      id: s === 0 ? 'steer-1' : `steer-${s + 1}`,
      role: 'user',
      sourceIndex: guessIndex ?? undefined,
      isSteer: true,
      parts: [{ kind: 'text', text: s === 0 ? '改成每 30 秒轮询一次' : `第二次转向 ${s}` }],
    });
    for (let i = s * 10; i < s * 10 + 10; i++) {
      canvas.push({
        id: `a-post-${i}`,
        role: 'assistant',
        sourceIndex: guessIndex ?? undefined,
        parts: [
          { kind: 'reasoning', text: `第 ${i} 轮巡检` },
          { kind: 'tool', tool: { id: `bash-${i}`, name: 'RunCommand', status: 'done', output: `tick ${i}` } },
        ],
      });
    }
  }
  canvas.push(
    pending
      ? {
          id: `a-post-${steers * 10}`,
          role: 'assistant',
          sourceIndex: guessIndex ?? undefined,
          parts: [
            { kind: 'reasoning', text: '最后一轮巡检' },
            {
              kind: 'tool',
              tool: {
                id: `bash-${steers * 10}`,
                name: 'RunCommand',
                status: 'pending',
                output: '[still running: 80s total, 80s without output (pid 9527)]',
              },
            },
          ],
        }
      : {
          id: 'a-final',
          role: 'assistant',
          sourceIndex: guessIndex ?? undefined,
          parts: [{ kind: 'text', text: '巡检完成，服务稳定。' }],
        },
  );
  return canvas;
}

function lastUserLike(rows: Row[]) {
  return [...rows].reverse().find((m) => m.role === 'user');
}
function sameUser(a: Row | undefined, b: Row | undefined) {
  if (!a || !b) return false;
  const text = (m: Row) => m.parts.filter((p) => p.kind === 'text').map((p) => p.text ?? '').join('');
  return text(a) === text(b);
}
/** 与 Chat.tsx `diskHasCanvasUser` 同义。 */
function diskCoversTail(disk: Row[], canvas: Row[]) {
  const canvasUser = (lastUserLike(canvas)?.parts ?? []).filter((p) => p.kind === 'text').map((p) => p.text ?? '').join('').trim();
  if (!canvasUser) return true;
  const diskUser = (lastUserLike(disk)?.parts ?? []).filter((p) => p.kind === 'text').map((p) => p.text ?? '').join('').trim();
  return diskUser.endsWith(canvasUser) || canvasUser.endsWith(diskUser) || diskUser === canvasUser;
}

function run(label: string, shape: 'complete' | 'lag' | 'lagSettled' | 'twoSteers') {
  const complete = shape === 'complete' || shape === 'twoSteers';
  const transcript = diskTranscript(complete);
  const { tail, offset } = tailPage(transcript);
  const canvas = phoneCache(
    complete ? transcript : diskTranscript(true),
    shape === 'complete' ? transcript.length + 5 : null,
    shape === 'twoSteers' ? 2 : 1,
    shape !== 'lagSettled',
  );
  const spliced = spliceAuthoritativeDiskTail(canvas, tail, offset);
  const covers = diskCoversTail(tail, canvas);
  const merged = mergeDiskWithUnpersistedTail(spliced, canvas, { diskCoversTail: covers });
  const rows = sanitizeCanvasMessages(merged);

  const ids = rows.map((m) => m.id).filter(Boolean);
  const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
  const steerRows = rows.filter((m) => m.isSteer);
  const steerAt = rows.findIndex((m) => m.isSteer);
  const pendingAt = rows.findIndex((m) => m.parts.some((p) => p.kind === 'tool' && p.tool?.status === 'pending'));
  const finalAt = rows.findIndex((m) => m.parts.some((p) => p.kind === 'text' && (p.text ?? '').includes('巡检完成')));
  const firstPostAt = rows.findIndex((m) => /^a-post-0$/.test(m.id ?? ''));

  console.log(`\n[${label}] diskCoversTail=${covers}  页面 offset=${offset}  画布 ${canvas.length} → ${rows.length} 行`);
  console.log(`  steer 条数=${steerRows.length}${steerRows.length ? `（首条位置 ${steerAt}）` : ''}  重复 id=${dups.length}  假死行位置=${pendingAt}  最终回答位置=${finalAt}  首条巡检位置=${firstPostAt}`);

  const problems: string[] = [];
  if (dups.length > 0) problems.push(`出现重复消息 id：${[...new Set(dups)].slice(0, 3).join(',')}`);
  if (shape === 'twoSteers' && steerRows.length !== 2) problems.push(`两条 steer 应全部保留，实际 ${steerRows.length}`);
  if (shape === 'complete' && steerRows.length !== 1) problems.push(`steer 应恰好 1 条，实际 ${steerRows.length}`);
  if (steerAt >= 0 && firstPostAt >= 0 && steerAt > firstPostAt) {
    problems.push('steer 排到了它之后的巡检工具行后面');
  }
  if (pendingAt >= 0 && finalAt >= 0 && pendingAt > finalAt) {
    problems.push('假死工具行排到了最终回答之后（时间线倒挂）');
  }
  if (shape === 'lag' || shape === 'lagSettled') {
    const steerKept = rows.some((m) => m.isSteer);
    if (!steerKept) problems.push('磁盘还没落盘时 steer 气泡被丢弃（刷新后消失）');
    const probeId = shape === 'lag' ? 'a-post-10' : 'a-post-0';
    const tailKept = rows.some((m) => m.id === probeId);
    if (!tailKept) problems.push('磁盘还没落盘时直播工具行被丢弃');
  }
  if (shape === 'lagSettled') {
    const answerKept = rows.some((m) => m.parts.some((p) => p.kind === 'text' && (p.text ?? '').includes('巡检完成')));
    if (!answerKept) problems.push('磁盘还没落盘时最终回答被旧磁盘尾部覆盖');
  }
  console.log(problems.length ? `  ❌ ${problems.join('；')}` : '  ✅ 不变量成立');
  return { problems, rows, pendingAt };
}

const results = [
  run('完整结算（daemon 已写 display）', 'complete'),
  run('daemon 收尾/重启（disk 停在上一轮，画布仍在跑）', 'lag'),
  run('daemon 收尾/重启（disk 停在上一轮，画布已出最终回答）', 'lagSettled'),
  run('连续两条中途转向', 'twoSteers'),
];

const all = results.flatMap((r) => r.problems);
if (all.length > 0) {
  console.error('\n❌ 复现到画布破坏：');
  for (const p of all) console.error('   -', p);
  process.exit(1);
}
console.log('\n✅ 四种形状均满足不变量（steer 保留/有序、无重复、无倒挂）');
