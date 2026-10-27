/**
 * 断点续传游标（每会话一份）。
 *
 * 服务器把「回放帧」按回合缓冲序号编号（`seq`），实时帧不带编号。前端每应用一帧
 * 就记住最大的 seq；断线重连时把它当作 `after_seq` 带回去，服务器只补这之后
 * 的帧 —— 于是重连天然不重复、不乱序，**不需要**再猜「这条是不是已经画过了」。
 *
 * 存 sessionStorage：按标签页隔离（另一个标签页有自己的游标）。
 * 会话回合结束时调用方应清掉它（缓冲已被服务器清空，旧游标会失效）。
 *
 * 关键约束：游标只在「写它的那份画布还活在同一个页面文档里」时有效。
 * 画布落 IndexedDB 是防抖异步的（每帧只排队一次 800ms 写），进程被刷新打断时
 * 画布会停在旧快照，而游标早已越过那些帧。若刷新后继续带游标续传，服务器会跳过
 * 已记账却从未画上的帧 —— 典型就是中途 steer 的 `steered` 边界帧：它的用户气泡
 * 在回合结算前根本不落盘，于是刷新后气泡凭空消失、新一轮正文贴到上一条回答下面。
 * 因此每条记录带上页面身份，新文档一律视为「无游标」走全量补发（前端按身份幂等收敛）。
 */

const CURSOR_PREFIX = 'jeikcode:stream_cursor:';

/** 当前页面文档的身份。同一文档内稳定，刷新 / 复制标签页后必然是新的。 */
const DOCUMENT_OWNER = (() => {
  try {
    const cryptoRef = globalThis.crypto;
    if (cryptoRef && typeof cryptoRef.randomUUID === 'function') return cryptoRef.randomUUID();
  } catch {
    /* 非浏览器环境 / 旧内核：退化为时间戳随机串 */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
})();

/** 可注入的存储：测试用假实现，浏览器用 sessionStorage。 */
export interface CursorStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): CursorStorage | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export interface StreamCursor {
  /** 已应用的最大缓冲序号。 */
  seq: number;
}

/** 读取某条流的游标；`stream` 用于区分画布流与镜像流（两条流的序号空间不同）。
 *  其它页面文档写下的游标一律视为无效（见文件头：画布可能落后于游标）。 */
export function readStreamCursor(
  sessionId: string,
  stream = 'watch',
  storage: CursorStorage | null = defaultStorage(),
  owner: string = DOCUMENT_OWNER,
): StreamCursor | null {
  if (!sessionId || !storage) return null;
  try {
    const raw = storage.getItem(CURSOR_PREFIX + stream + ':' + sessionId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { seq?: unknown; owner?: unknown };
    if (parsed?.owner !== owner) return null;
    return typeof parsed?.seq === 'number' && Number.isFinite(parsed.seq)
      ? { seq: parsed.seq }
      : null;
  } catch {
    return null;
  }
}

/** 记录游标（只前进：乱序/重放帧不会把游标往回拨）。 */
export function writeStreamCursor(
  sessionId: string,
  seq: number,
  stream = 'watch',
  storage: CursorStorage | null = defaultStorage(),
  owner: string = DOCUMENT_OWNER,
): void {
  if (!sessionId || !storage || !Number.isFinite(seq) || seq < 0) return;
  const current = readStreamCursor(sessionId, stream, storage, owner);
  if (current && current.seq >= seq) return;
  try {
    storage.setItem(
      CURSOR_PREFIX + stream + ':' + sessionId,
      JSON.stringify({ seq, owner }),
    );
  } catch {
    /* 存储不可用（隐私模式/配额）→ 退化为无游标，走全量补发兜底 */
  }
}

/** 清掉游标（回合结束：服务器缓冲已清空，旧序号不再有意义）。 */
export function clearStreamCursor(
  sessionId: string,
  stream = 'watch',
  storage: CursorStorage | null = defaultStorage(),
): void {
  if (!sessionId || !storage) return;
  try {
    storage.removeItem(CURSOR_PREFIX + stream + ':' + sessionId);
  } catch {
    /* ignore */
  }
}

/**
 * 决定这次连接带什么游标：
 * - 有游标 → 带上它（只补之后的帧，收到的全是新的）
 * - 无游标且画布为空（新会话）→ `-1`：服务器不补发，直接给一个起始游标后转实时
 * - 无游标但画布有历史（换设备/清缓存）→ `undefined`：全量补发，前端按身份幂等收敛
 */
export function resolveAfterSeq(
  cursor: StreamCursor | null,
  canvasIsEmpty: boolean,
): number | undefined {
  if (cursor) return cursor.seq;
  return canvasIsEmpty ? -1 : undefined;
}
