/**
 * 工业级双层会话缓存引擎 (L1 内存 LRU + L2 原生 IndexedDB)
 * 彻底打破 sessionStorage 5MB 配额瓶颈，支持几十 GB 异步非阻塞持久化，
 * 解决切换与刷新白屏冷启动延迟。
 */

/// Canvas projection schema. Bump when the display list's indexing changes
/// (e.g. rebuilding the pre-compaction prefix from the raw transcript, or
/// switching a session to the append-only display log). Old rows carry
/// `sourceIndex` from a different coordinate system and must not be merged
/// with the new server list.
///
/// v4: also drop canvases saved around the natural-steer race (a stale todo
/// host / a dropped steer bubble). The server display log is authoritative;
/// one cold refetch is cheaper than showing an old polluted canvas.
/// v6: the daemon no longer truncates display fields at 24 KiB; drop canvases
/// that still carry the old `… [truncated for display]` tail.
export const CACHE_DISPLAY_VERSION = 6;

export interface CachedSessionData {
  sessionId: string;
  projectHash: string;
  messages: any[];
  displayVersion?: number;
  todos?: any[] | null;
  turns?: any[] | null;
  tokenUsage?: any | null;
  historyOffset?: number;
  historyTotal?: number;
  timestamp: number;
  /** Last read/write time; LRU eviction uses this instead of write time. */
  lastAccess?: number;
  /** Approximate stored bytes (UTF-8 JSON payload). */
  size?: number;
  mtime_ms?: number;
  approvalMode?: string | null;
  preferredModel?: string | null;
  reasoningEffort?: string | null;
  thinkingBudget?: number | null;
}

const DB_NAME = 'jeikcode_cache';
const DB_VERSION = 2;
const STORE_SESSIONS = 'sessions';
const STORE_FILES = 'files';
const STORE_TREES = 'trees';
const MAX_MEMORY_ENTRIES = 30;
/** L2 IndexedDB budget. Keep it well below typical browser quotas. */
const MAX_DB_BYTES = 64 * 1024 * 1024;
const MAX_DB_ENTRIES = 200;
const DB_TARGET_RATIO = 0.8;
let evictionScheduled = false;

// L1 内存 LRU 缓存 (0.00ms 极速响应)
const memoryCache = new Map<string, CachedSessionData>();
const fileMemoryCache = new Map<string, string>();
const treeMemoryCache = new Map<string, any>();

function makeKey(projectHash: string, sessionId: string): string {
  return `${projectHash}:${sessionId}`;
}

function estimateCachedBytes(data: CachedSessionData): number {
  try {
    const json = JSON.stringify(data);
    if (typeof Blob !== 'undefined') return new Blob([json]).size;
    return json.length * 2;
  } catch {
    return 0;
  }
}

function persistSessionCacheAccess(projectHash: string, sessionId: string, data: CachedSessionData): void {
  void (async () => {
    const db = await getDB();
    if (!db) return;
    try {
      const key = makeKey(projectHash, sessionId);
      const tx = db.transaction(STORE_SESSIONS, 'readwrite');
      const store = tx.objectStore(STORE_SESSIONS);
      const req = store.get(key);
      req.onsuccess = () => {
        const latest = req.result as CachedSessionData | undefined;
        // Only touch the access time; never overwrite a newer save with the
        // stale snapshot that was read a moment ago.
        if (latest && latest.timestamp === data.timestamp) {
          store.put({ ...latest, lastAccess: data.lastAccess ?? Date.now() });
        }
      };
    } catch {
      // best effort: LRU accuracy does not justify surfacing a cache error
    }
  })();
}

function scheduleSessionCacheEviction(): void {
  if (evictionScheduled) return;
  evictionScheduled = true;
  const timer = typeof window !== 'undefined' ? window.setTimeout : globalThis.setTimeout;
  timer(() => {
    evictionScheduled = false;
    void evictSessionCacheBudget();
  }, 1000);
}

async function evictSessionCacheBudget(): Promise<void> {
  const db = await getDB();
  if (!db) return;
  const entries: Array<{ key: string; size: number; lastAccess: number }> = [];
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_SESSIONS, 'readonly');
      const req = tx.objectStore(STORE_SESSIONS).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        const value = cursor.value as CachedSessionData & { key?: string };
        const size = typeof value.size === 'number' ? value.size : estimateCachedBytes(value);
        entries.push({
          key: value.key ?? cursor.primaryKey as string,
          size,
          lastAccess: value.lastAccess ?? value.timestamp ?? 0,
        });
        cursor.continue();
      };
      req.onerror = () => resolve();
    });
  } catch {
    return;
  }

  let total = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (total <= MAX_DB_BYTES && entries.length <= MAX_DB_ENTRIES) return;

  entries.sort((a, b) => a.lastAccess - b.lastAccess);
  const targetBytes = Math.floor(MAX_DB_BYTES * DB_TARGET_RATIO);
  const targetEntries = Math.floor(MAX_DB_ENTRIES * DB_TARGET_RATIO);
  const deleted: string[] = [];
  const tx = db.transaction(STORE_SESSIONS, 'readwrite');
  const store = tx.objectStore(STORE_SESSIONS);
  for (const entry of entries) {
    if (total <= targetBytes && entries.length - deleted.length <= targetEntries) break;
    store.delete(entry.key);
    deleted.push(entry.key);
    total -= entry.size;
  }
  for (const key of deleted) memoryCache.delete(key);
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function getDB(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve(null);
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = window.indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = (e.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
            db.createObjectStore(STORE_SESSIONS, { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains(STORE_FILES)) {
            db.createObjectStore(STORE_FILES, { keyPath: 'path' });
          }
          if (!db.objectStoreNames.contains(STORE_TREES)) {
            db.createObjectStore(STORE_TREES, { keyPath: 'path' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
          console.warn('[SessionCache] IndexedDB open failed, falling back to memory only');
          resolve(null);
        };
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

/**
 * 同步快速检查 L1 内存中是否已存在该会话 (0.00ms)
 */
export function hasMemorySession(projectHash: string, sessionId: string): boolean {
  const key = makeKey(projectHash, sessionId);
  return memoryCache.has(key);
}

/**
 * 同步从 L1 内存获取该会话 (0.00ms)
 */
export function getMemorySession(projectHash: string, sessionId: string): CachedSessionData | null {
  const key = makeKey(projectHash, sessionId);
  const data = memoryCache.get(key);
  if (data && data.displayVersion === CACHE_DISPLAY_VERSION) {
    // LRU: 刷新访问顺序
    memoryCache.delete(key);
    memoryCache.set(key, data);
    return data;
  }
  return null;
}

/**
 * 异步获取会话缓存：优先 L1 内存，次选 L2 IndexedDB (1~3ms)
 * 当 projectHash 未知时（如冷启动首帧），自动按 sessionId 检索，实现真正的 0ms 离线秒出。
 */
export async function getSessionCache(
  projectHash: string,
  sessionId: string,
): Promise<CachedSessionData | null> {
  if (projectHash) {
    const mem = getMemorySession(projectHash, sessionId);
    if (mem) return mem;
  } else {
    for (const data of memoryCache.values()) {
      if (data.sessionId === sessionId && data.displayVersion === CACHE_DISPLAY_VERSION) {
        return data;
      }
    }
  }

  const db = await getDB();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_SESSIONS, 'readonly');
      const store = tx.objectStore(STORE_SESSIONS);
      if (projectHash) {
        const req = store.get(makeKey(projectHash, sessionId));
        req.onsuccess = () => {
          const result = req.result as CachedSessionData | undefined;
          if (
            result &&
            result.displayVersion === CACHE_DISPLAY_VERSION &&
            Array.isArray(result.messages)
          ) {
            result.lastAccess = Date.now();
            if (typeof result.size !== 'number') result.size = estimateCachedBytes(result);
            setMemorySession(projectHash, sessionId, result);
            persistSessionCacheAccess(projectHash, sessionId, result);
            resolve(result);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      } else {
        const req = store.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            const result = cursor.value as CachedSessionData | undefined;
            if (
              result &&
              result.sessionId === sessionId &&
              result.displayVersion === CACHE_DISPLAY_VERSION &&
              Array.isArray(result.messages)
            ) {
              result.lastAccess = Date.now();
              if (typeof result.size !== 'number') result.size = estimateCachedBytes(result);
              setMemorySession(result.projectHash, sessionId, result);
              persistSessionCacheAccess(result.projectHash, sessionId, result);
              resolve(result);
              return;
            }
            cursor.continue();
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      }
    } catch {
      resolve(null);
    }
  });
}

function setMemorySession(projectHash: string, sessionId: string, data: CachedSessionData): void {
  const key = makeKey(projectHash, sessionId);
  if (memoryCache.has(key)) {
    memoryCache.delete(key);
  } else if (memoryCache.size >= MAX_MEMORY_ENTRIES) {
    // 淘汰最久未访问的首个 entry
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey) memoryCache.delete(oldestKey);
  }
  memoryCache.set(key, data);
}

/**
 * 写入会话缓存：同步更新 L1 内存，并异步持久化至 L2 IndexedDB (不阻塞主线程)
 */
export async function saveSessionCache(
  projectHash: string,
  sessionId: string,
  messages: any[],
  todos?: any[] | null,
  mtime_ms?: number,
  turns?: any[] | null,
  tokenUsage?: any | null,
  historyOffset?: number,
  historyTotal?: number,
  approvalMode?: string | null,
  preferredModel?: string | null,
  reasoningEffort?: string | null,
  thinkingBudget?: number | null,
): Promise<void> {
  // 保留上一次写入的会话级配置：调用方大多只更新消息，不能因未传而抹掉
  // approvalMode / preferredModel / reasoningEffort 等持久字段。
  const previous = memoryCache.get(makeKey(projectHash, sessionId));
  const now = Date.now();
  const data: CachedSessionData = {
    sessionId,
    projectHash,
    displayVersion: CACHE_DISPLAY_VERSION,
    messages,
    todos: todos ?? undefined,
    turns: turns ?? previous?.turns,
    tokenUsage: tokenUsage ?? undefined,
    historyOffset: historyOffset ?? previous?.historyOffset,
    historyTotal: historyTotal ?? previous?.historyTotal,
    timestamp: now,
    lastAccess: now,
    mtime_ms,
    approvalMode: approvalMode ?? previous?.approvalMode,
    preferredModel: preferredModel ?? previous?.preferredModel,
    reasoningEffort: reasoningEffort ?? previous?.reasoningEffort,
    thinkingBudget: thinkingBudget ?? previous?.thinkingBudget,
  };
  data.size = estimateCachedBytes(data);

  // 1. 同步更新 L1 内存
  setMemorySession(projectHash, sessionId, data);

  // 2. 异步落盘至 L2 IndexedDB
  const db = await getDB();
  if (!db) return;

  try {
    const tx = db.transaction(STORE_SESSIONS, 'readwrite');
    const store = tx.objectStore(STORE_SESSIONS);
    store.put({
      key: makeKey(projectHash, sessionId),
      ...data,
    });
    scheduleSessionCacheEviction();
  } catch (err) {
    console.warn('[SessionCache] Failed to write to IndexedDB:', err);
  }
}

/**
 * 就地更新会话缓存中的“会话级配置”字段（模型 / 模式 / 强度），不触碰消息画布。
 *
 * 用于下拉框一行变更就立即落库：即使随后切走会话或刷新，也不会被另一会话的
 * 选择或全局默认值覆盖。若尚无缓存条目则静默跳过（首屏拉取会补全）。
 */
export function updateSessionCacheMeta(
  projectHash: string,
  sessionId: string,
  patch: {
    approvalMode?: string | null;
    preferredModel?: string | null;
    reasoningEffort?: string | null;
    thinkingBudget?: number | null;
  },
): void {
  const key = makeKey(projectHash, sessionId);
  const current = memoryCache.get(key);
  if (!current) return;
  const next: CachedSessionData = {
    ...current,
    approvalMode:
      patch.approvalMode !== undefined ? (patch.approvalMode ?? undefined) : current.approvalMode,
    preferredModel:
      patch.preferredModel !== undefined
        ? (patch.preferredModel ?? undefined)
        : current.preferredModel,
    reasoningEffort:
      patch.reasoningEffort !== undefined
        ? (patch.reasoningEffort ?? undefined)
        : current.reasoningEffort,
    thinkingBudget:
      patch.thinkingBudget !== undefined
        ? (patch.thinkingBudget ?? undefined)
        : current.thinkingBudget,
    timestamp: Date.now(),
    lastAccess: Date.now(),
  };
  setMemorySession(projectHash, sessionId, next);
}

/**
 * 删除某会话的本地缓存（L1 内存 + L2 IndexedDB）。
 *
 * 会话被删除（本端操作或跨实例推送）后必须立即失效：否则侧栏/正文一旦
 * 再次读到旧缓存，幽灵会话就会复活到下一次冷启动重拉为止。
 */
export async function deleteSessionCache(
  projectHash: string,
  sessionId: string,
): Promise<void> {
  const key = makeKey(projectHash, sessionId);
  memoryCache.delete(key);
  const db = await getDB();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_SESSIONS, 'readwrite');
    tx.objectStore(STORE_SESSIONS).delete(key);
  } catch (err) {
    console.warn('[SessionCache] Failed to delete from IndexedDB:', err);
  }
}

/**
 * 实时向缓存中追加新消息 (反向增量注入，保证后台和异地实例状态时刻新鲜)
 */
export function appendMessageToSessionCache(
  projectHash: string,
  sessionId: string,
  message: any,
  turns?: any[],
  tokenUsage?: any,
): void {
  const current = getMemorySession(projectHash, sessionId);
  if (current) {
    current.messages.push(message);
    if (turns) current.turns = turns;
    if (tokenUsage) current.tokenUsage = tokenUsage;
    current.timestamp = Date.now();
    current.lastAccess = current.timestamp;
    // 异步排队更新 IndexedDB
    void saveSessionCache(projectHash, sessionId, current.messages, current.todos, current.mtime_ms, current.turns, current.tokenUsage);
  }
}

/**
 * Ctrl + F5 强制清理：一网打尽清空所有 L1 内存与 L2 IndexedDB 缓存
 */
export async function clearAllSessionCache(): Promise<void> {
  memoryCache.clear();
  fileMemoryCache.clear();
  treeMemoryCache.clear();
  const db = await getDB();
  if (!db) return;
  try {
    const stores = [STORE_SESSIONS, STORE_FILES, STORE_TREES].filter((name) =>
      db.objectStoreNames.contains(name)
    );
    if (stores.length === 0) return;
    const tx = db.transaction(stores, 'readwrite');
    for (const name of stores) {
      tx.objectStore(name).clear();
    }
  } catch {
    // 忽略清空错误
  }
}

// ==================== 文件内容与目录树 IndexedDB 缓存 (打破 5MB 限制) ====================

/**
 * 异步获取文件内容缓存：优先 L1 内存，次选 L2 IndexedDB (1~2ms 极速直出)
 */
export async function getCachedFileContent(path: string): Promise<string | null> {
  const norm = path.replace(/\\/g, '/');
  if (fileMemoryCache.has(norm)) return fileMemoryCache.get(norm)!;

  const db = await getDB();
  if (!db || !db.objectStoreNames.contains(STORE_FILES)) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_FILES, 'readonly');
      const store = tx.objectStore(STORE_FILES);
      const req = store.get(norm);
      req.onsuccess = () => {
        const res = req.result;
        if (res && typeof res.content === 'string') {
          fileMemoryCache.set(norm, res.content);
          resolve(res.content);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * 同步将文件内容写入 L1 内存并异步持久化至 L2 IndexedDB
 */
export async function saveCachedFileContent(path: string, content: string): Promise<void> {
  const norm = path.replace(/\\/g, '/');
  fileMemoryCache.set(norm, content);

  const db = await getDB();
  if (!db || !db.objectStoreNames.contains(STORE_FILES)) return;

  try {
    const tx = db.transaction(STORE_FILES, 'readwrite');
    const store = tx.objectStore(STORE_FILES);
    store.put({ path: norm, content, timestamp: Date.now() });
  } catch {}
}

/**
 * 获取目录树缓存（L1 内存 + L2 IndexedDB，彻底解除 sessionStorage 5MB 限制）
 */
export async function getCachedDirectoryTree<T = any>(path: string): Promise<T | null> {
  const norm = (path || 'root').replace(/\\/g, '/');
  if (treeMemoryCache.has(norm)) return treeMemoryCache.get(norm) as T;

  const db = await getDB();
  if (!db || !db.objectStoreNames.contains(STORE_TREES)) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_TREES, 'readonly');
      const store = tx.objectStore(STORE_TREES);
      const req = store.get(norm);
      req.onsuccess = () => {
        const res = req.result;
        if (res && res.tree) {
          treeMemoryCache.set(norm, res.tree);
          resolve(res.tree as T);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * 持久化目录树快照至 L1 内存与 L2 IndexedDB
 */
export async function saveCachedDirectoryTree(path: string, tree: any): Promise<void> {
  const norm = (path || 'root').replace(/\\/g, '/');
  treeMemoryCache.set(norm, tree);

  const db = await getDB();
  if (!db || !db.objectStoreNames.contains(STORE_TREES)) return;

  try {
    const tx = db.transaction(STORE_TREES, 'readwrite');
    const store = tx.objectStore(STORE_TREES);
    store.put({ path: norm, tree, timestamp: Date.now() });
  } catch {}
}
