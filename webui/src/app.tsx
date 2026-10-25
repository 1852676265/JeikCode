// Two-column layout: sidebar + chat, header with cwd breadcrumb + config.
// VSCode design system: timeline messages, violet brand, floating input.

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { lazy, Suspense } from 'preact/compat';
import { Chat } from './components/Chat';
import { Sidebar } from './components/Sidebar';
import { RenameDialog, DeleteDialog } from './components/SessionDialogs';
import { CwdPicker } from './components/CwdPicker';
import { onboardingDone } from './lib/onboarding';
import { LiveReviewState, NotificationDock } from './components/NotificationDock';
import { onGlobalEvent, startGlobalEventStream } from './lib/globalEvents';
import { RemoteAccessControl } from './components/RemoteAccessControl';
import { resolvePendingAfterDecision } from './lib/pendingPermission';
import { ToastHost, showToast } from './components/Toast';
import { ConfirmModalHost } from './components/ConfirmDialog';
import { parseFilePathAndLines } from './lib/displayPath';
import { languageOptions } from './i18n';

// 动态按需懒加载非首屏必需的独立弹窗，削减冷启动初始 JS 解析开销
const ThemeDialog = lazy(() => import('./components/SettingsDialogs').then((m) => ({ default: m.ThemeDialog })));
const LanguageDialog = lazy(() => import('./components/SettingsDialogs').then((m) => ({ default: m.LanguageDialog })));
const ModelConfigDialog = lazy(() => import('./components/SettingsDialogs').then((m) => ({ default: m.ModelConfigDialog })));
const OnboardingWizard = lazy(() => import('./components/OnboardingWizard').then((m) => ({ default: m.OnboardingWizard })));
const UpdateDialog = lazy(() => import('./components/UpdateDialog').then((m) => ({ default: m.UpdateDialog })));
const ConfigSyncModal = lazy(() => import('./components/ConfigSyncModal').then((m) => ({ default: m.ConfigSyncModal })));
const LegacyMigrationModal = lazy(() => import('./components/LegacyMigrationModal').then((m) => ({ default: m.LegacyMigrationModal })));
const SystemSettingsDialog = lazy(() => import('./components/SystemSettingsDialog').then((m) => ({ default: m.SystemSettingsDialog })));
const DesktopClosePromptDialog = lazy(() => import('./components/DesktopClosePromptDialog').then((m) => ({ default: m.DesktopClosePromptDialog })));
import {
  getProject,
  getConfig,
  getModels,
  changeDir,
  resolveSession,
  createSession,
  getSession,
  getActiveChatSessions,
  checkUpdate,
  fetchUpgradeDiffs,
  UpdateCheckResponse,
  ConfigDiffItem,
  SessionMetaWithProject,
} from './api';
import { useT, useSettings, SettingsSection } from './settings';
import { sessionMessagesToMarkdownLines } from './lib/historyMessages';

// 从 URL (?session=<id>) 读取要打开的会话 id（短 id），用于刷新后恢复。
function readSessionIdFromUrl(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('session');
  } catch {
    return null;
  }
}

// URL 里只放 UUID 前 8 位以缩短地址；刷新时按前缀在会话列表里还原成完整 id。
function shortSessionId(id: string): string {
  return id.slice(0, 8);
}

export function App() {
  const t = useT();
  const { theme, setTheme, lang, setLang } = useSettings();
  // URL 里是短 id，不能直接当完整 id 用（后端需要完整 id）；先置空，挂载后再还原。
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<SessionMetaWithProject | null>(null);
  // 乐观会话集合：让新创建/首条消息发出的会话即时出现在侧栏（即使切到其他会话也不丢失）。
  // 当后端列表出现同 id 的真实会话后，Sidebar 的 mergeOptimisticSessions 会自动以落盘条目为准去重。
  const [optimisticSessions, setOptimisticSessions] = useState<Record<string, SessionMetaWithProject>>({});
  const [cwd, setCwd] = useState('');
  // Physical session-bucket hash of the current project. The sidebar scopes its
  // list by this (see Sidebar `projectHash`), not by the `cwd` string, so a
  // session whose stored `working_dir` was restamped by the daemon's global
  // working_dir can't leak into the wrong project. Tracked alongside `cwd`.
  const [projectHash, setProjectHash] = useState('');
  const [pending, setPending] = useState<any | null>(null);
  const [liveReview, setLiveReview] = useState<LiveReviewState | null>(null);
  // 跨实例增量流（每实例一条）：侧栏/通知 dock 各自订阅自己需要的增量，
  // 全程按 id 就地 upsert/remove，无周期性轮询、无整表重拉。
  useEffect(() => startGlobalEventStream(), []);
  // 待交互卡在别处被解决时，同步清掉本实例正在展示的卡片状态。
  useEffect(
    () =>
      onGlobalEvent((event) => {
        if (event.type !== 'review_resolved') return;
        setPending((cur: any | null) =>
          cur && event.approval_id && cur.approval_id === event.approval_id ? null : cur,
        );
        setLiveReview((cur) =>
          cur && cur.sessionId === event.session_id && !cur.userInput ? null : cur,
        );
      }),
    [],
  );
  const dismissLiveReview = useRef({
    permission: (_runtimeInstanceId: string, _generation: number, _requestId: number, _callId: string) => {},
    userInput: () => {},
  });
  const onLiveReview = useCallback((review: LiveReviewState) => {
    setLiveReview((prev) => {
      if (
        prev
        && prev.sessionId === review.sessionId
        && (prev.permission?.runtime_instance_id ?? '') === (review.permission?.runtime_instance_id ?? '')
        && (prev.permission?.generation ?? -1) === (review.permission?.generation ?? -1)
        && (prev.permission?.request_id ?? -1) === (review.permission?.request_id ?? -1)
        && (prev.userInput?.request_id ?? -1) === (review.userInput?.request_id ?? -1)
      ) {
        return prev;
      }
      return review;
    });
  }, []);
  const onBindReviewDismiss = useCallback((fns: {
    permission: (runtimeInstanceId: string, generation: number, requestId: number, callId: string) => void;
    userInput: () => void;
  }) => {
    dismissLiveReview.current = fns;
  }, []);
  const [showCwd, setShowCwd] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sessionListVersion, setSessionListVersion] = useState(0);
  const [liveRunningIds, setLiveRunningIds] = useState<Set<string>>(() => new Set());
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  // 表头会话菜单改用 fixed 定位，避免被祖先 overflow/层叠裁剪；记录锚点坐标。
  const [headerMenuPos, setHeaderMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [headerDialog, setHeaderDialog] = useState<'rename' | 'delete' | null>(null);
  const [headerExporting, setHeaderExporting] = useState(false);
  const headerMenuRef = useRef<HTMLDivElement>(null);

  // 升级检测与配置同步状态
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResponse | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [configDiffs, setConfigDiffs] = useState<ConfigDiffItem[] | null>(null);

  // 右上角工具栏收纳菜单（更多操作：刷新、远程访问、更新、主题切换）
  const [topNavMoreOpen, setTopNavMoreOpen] = useState(false);
  const topNavMoreRef = useRef<HTMLDivElement | null>(null);

  // 顶栏电脑端语言切换下拉框状态
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const langMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!langMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) {
        setLangMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [langMenuOpen]);

  // 顶栏自适应收纳：监听 header 实际宽度，桌面窗口缩窄时及时收纳到三个点
  const [headerWidth, setHeaderWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1200
  );

  // ── 活跃会话运行态（蓝圈圈）幂等校准：每 12 秒与后端权威 active_chats 列表对齐一次，彻底消灭幽灵转圈卡死 ──
  useEffect(() => {
    let cancelled = false;
    const reconcileRunning = () => {
      getActiveChatSessions()
        .then((serverActiveIds) => {
          if (cancelled) return;
          setLiveRunningIds((prev) => {
            if (prev.size === 0 && serverActiveIds.length === 0) return prev;
            const next = new Set<string>();
            for (const id of serverActiveIds) {
              next.add(id);
            }
            if (prev.size === next.size && [...prev].every((id) => next.has(id))) {
              return prev;
            }
            return next;
          });
        })
        .catch(() => {});
    };

    reconcileRunning();
    const timer = window.setInterval(reconcileRunning, 12000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!headerMenuRef.current) return;
    const updateWidth = () => {
      if (headerMenuRef.current) {
        setHeaderWidth(headerMenuRef.current.clientWidth);
      }
    };
    updateWidth();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setHeaderWidth(entry.contentRect.width);
        }
      });
      ro.observe(headerMenuRef.current);
    }
    window.addEventListener('resize', updateWidth);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', updateWidth);
    };
  }, []);

  const isHeaderCompact = headerWidth < 820;
  const isHeaderUltraCompact = headerWidth < 560;

  useEffect(() => {
    if (!topNavMoreOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (topNavMoreRef.current && !topNavMoreRef.current.contains(e.target as Node)) {
        setTopNavMoreOpen(false);
      }
    };
    window.addEventListener('mousedown', onClickOutside);
    return () => window.removeEventListener('mousedown', onClickOutside);
  }, [topNavMoreOpen]);

  // VSCode-style open diff tabs in the session header
  const [diffTabs, setDiffTabs] = useState<any[]>([]);
  const [activeMainTabId, setActiveMainTabId] = useState<string>('chat');
  const tabsContainerRef = useRef<HTMLDivElement>(null);

  // 顶部主标签栏滚轮水平滑动与激活标签自动居中 (在 activeMainTabId 声明之后定义，避免 TDZ 报错)
  const handleTabsWheel = (e: WheelEvent) => {
    if (tabsContainerRef.current) {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        tabsContainerRef.current.scrollLeft += e.deltaY;
      }
    }
  };

  useEffect(() => {
    if (!tabsContainerRef.current || activeMainTabId === 'chat') return;
    const activeEl = tabsContainerRef.current.querySelector('.header-editor-tab.active');
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [activeMainTabId]);

  // 移动端顶部会话与Diff标签下拉收纳状态
  const [mobileTabsDropdownOpen, setMobileTabsDropdownOpen] = useState(false);
  const mobileTabsDropdownRef = useRef<HTMLDivElement>(null);

  // 点击外部自动关闭移动端收纳下拉菜单
  useEffect(() => {
    if (!mobileTabsDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        mobileTabsDropdownOpen &&
        mobileTabsDropdownRef.current &&
        !mobileTabsDropdownRef.current.contains(target)
      ) {
        setMobileTabsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [mobileTabsDropdownOpen]);

  // 右侧检视面板（提问记录 / Git面板）折叠与宽度布局状态，用于自适应避让右上角快捷工具栏
  const [rightPanelLayout, setRightPanelLayout] = useState<{ collapsed: boolean; width: number }>(() => {
    try {
      const saved = localStorage.getItem('jeikcode:right-panel-collapsed');
      const collapsed = saved !== 'false';
      const savedWidth = localStorage.getItem('jeikcode:right-panel-width');
      const width = savedWidth ? parseInt(savedWidth, 10) : 260;
      return { collapsed, width: Number.isFinite(width) ? width : 260 };
    } catch {
      return { collapsed: true, width: 260 };
    }
  });

  // 桌面端/Web 原生通知权限：在用户首次交互后温和请求，保障失焦通知能调起系统原生弹窗
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (window.Notification.permission === 'default') {
        const handler = () => {
          void window.Notification.requestPermission();
          window.removeEventListener('click', handler);
          window.removeEventListener('keydown', handler);
        };
        window.addEventListener('click', handler, { once: true });
        window.addEventListener('keydown', handler, { once: true });
      }
    }
  }, []);

  // 右上角模型选择器插槽宿主 DOM 元素
  const [topModelSlot, setTopModelSlot] = useState<HTMLElement | null>(null);

  const handleCloseDiffTab = (tabId: string) => {
    setDiffTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (activeMainTabId === tabId) {
        if (next.length > 0) {
          setActiveMainTabId(next[next.length - 1]!.id);
        } else {
          setActiveMainTabId('chat');
        }
      }
      return next;
    });
  };

  // 顶部主标签栏拖拽与排序状态
  const [isMainTabsDragOver, setIsMainTabsDragOver] = useState(false);
  const [mainTabDragIdx, setMainTabDragIdx] = useState<number | null>(null);
  const [mainTabOverIdx, setMainTabOverIdx] = useState<number | null>(null);

  const handleOpenFile = (
    filePath: string,
    insertIndex?: number,
    targetStartLine?: number,
    targetEndLine?: number,
  ) => {
    const { filePath: cleanRaw, startLine: parsedStart, endLine: parsedEnd } = parseFilePathAndLines(filePath);
    const startLine = targetStartLine ?? parsedStart;
    const endLine = targetEndLine ?? parsedEnd;
    let normPath = (cleanRaw || '').trim().replace(/\\/g, '/');
    if (!/^[a-zA-Z]:\//.test(normPath) && !normPath.startsWith('/') && cwd) {
      const base = cwd.trim().replace(/\\/g, '/').replace(/\/+$/, '');
      normPath = `${base}/${normPath.replace(/^\.?\/+/, '')}`;
    }
    const tabId = `editor_${normPath}`;
    const existingIdx = diffTabs.findIndex((t) => t.id === tabId || t.filePath === normPath);
    if (existingIdx !== -1) {
      const next = [...diffTabs];
      if (next[existingIdx]) {
        next[existingIdx] = {
          ...next[existingIdx],
          startLine,
          endLine,
        };
        if (insertIndex !== undefined && insertIndex !== existingIdx) {
          const [item] = next.splice(existingIdx, 1);
          const targetSlot = insertIndex > existingIdx ? insertIndex - 1 : insertIndex;
          next.splice(targetSlot, 0, item);
        }
        setDiffTabs(next);
      }
      setActiveMainTabId(tabId);
      return;
    }
    const fileName = normPath.split(/[\\/]/).pop() || normPath;
    const ext = fileName.split('.').pop() || 'FILE';
    const newTab = {
      id: tabId,
      type: 'editor',
      fileName,
      filePath: normPath,
      fileStatus: ext.slice(0, 3).toUpperCase(),
      startLine,
      endLine,
    };
    setDiffTabs((prev) => {
      if (insertIndex !== undefined && insertIndex >= 0 && insertIndex <= prev.length) {
        const next = [...prev];
        next.splice(insertIndex, 0, newTab);
        return next;
      }
      return [...prev, newTab];
    });
    setActiveMainTabId(tabId);
  };

  // 全局文件打开事件广播监听 (例如 Markdown 相对链接点击、文件树定位等)
  useEffect(() => {
    const onOpenFileEvent = (e: any) => {
      const p = e.detail?.path;
      if (p) {
        handleOpenFile(p, undefined, e.detail?.startLine, e.detail?.endLine);
      }
    };
    window.addEventListener('jeikcode:open_file', onOpenFileEvent);
    return () => window.removeEventListener('jeikcode:open_file', onOpenFileEvent);
  }, [diffTabs, cwd]);

  // 监听全局主视图切换广播 (例如从侧边栏快捷回到对话主舞台)
  useEffect(() => {
    const onSwitchTab = (e: any) => {
      const tab = e.detail;
      if (typeof tab === 'string') {
        setActiveMainTabId(tab);
      }
    };
    window.addEventListener('jeikcode:switch_main_tab', onSwitchTab);
    return () => window.removeEventListener('jeikcode:switch_main_tab', onSwitchTab);
  }, []);

  // 全局拖拽防护与解绑：彻底解除拖动限制，杜绝光标在未监听区域出现禁止图标，
  // 并阻止原生浏览器/WebView 将网页直接导航替换为所拖动文件的默认行为。
  // 使用捕获阶段 (capture: true) 拦截 dragenter/dragover，确保在进入任何子元素前已标记 copy 效果，绝不闪现禁止图标！
  useEffect(() => {
    const handleGlobalDragOver = (e: DragEvent) => {
      e.preventDefault();
      const dt = e.dataTransfer;
      if (!dt) return;
      // WebView2 比 Chrome 严：dropEffect 不在 effectAllowed 里时，光标直接变成禁止。
      // 预览标签只允许 move，这里若写死 copy，拖到编辑区就会一直是禁止。
      const allowed = dt.effectAllowed;
      dt.dropEffect =
        allowed === 'move' || allowed === 'linkMove'
          ? 'move'
          : allowed === 'link' || allowed === 'copyLink'
            ? 'link'
            : 'copy';
    };
    const handleGlobalDrop = (e: DragEvent) => {
      e.preventDefault();
      try {
        const raw = e.dataTransfer?.getData('application/jeikcode-tab');
        const data = raw ? JSON.parse(raw) : (window as any).__jeikcode_dragged_tab;
        const targetPath = data?.filePath || e.dataTransfer?.getData('text/plain');
        if (targetPath && typeof targetPath === 'string' && targetPath.trim()) {
          window.dispatchEvent(new CustomEvent('jeikcode:switch_right_tab', { detail: 'preview' }));
          window.dispatchEvent(
            new CustomEvent('jeikcode:preview:open_file', {
              detail: typeof data === 'object' && data?.filePath ? data : { filePath: targetPath.trim() },
            }),
          );
          return;
        }
        if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
          for (let i = 0; i < e.dataTransfer.files.length; i++) {
            const file = e.dataTransfer.files[i];
            const p = (file as any).path || file.name;
            if (p) {
              window.dispatchEvent(new CustomEvent('jeikcode:switch_right_tab', { detail: 'preview' }));
              window.dispatchEvent(
                new CustomEvent('jeikcode:preview:open_file', {
                  detail: { filePath: p, fileName: file.name },
                }),
              );
            }
          }
        }
      } catch {}
    };

    const listen = { capture: true, passive: false } as const;
    window.addEventListener('dragenter', handleGlobalDragOver, listen);
    window.addEventListener('dragover', handleGlobalDragOver, listen);
    window.addEventListener('drop', handleGlobalDrop, listen);
    document.addEventListener('dragenter', handleGlobalDragOver, listen);
    document.addEventListener('dragover', handleGlobalDragOver, listen);
    return () => {
      window.removeEventListener('dragenter', handleGlobalDragOver, listen);
      window.removeEventListener('dragover', handleGlobalDragOver, listen);
      window.removeEventListener('drop', handleGlobalDrop, listen);
      document.removeEventListener('dragenter', handleGlobalDragOver, listen);
      document.removeEventListener('dragover', handleGlobalDragOver, listen);
    };
  }, []);
  // Chat reports whether it is showing the centered landing (empty) state, so the
  // session-title header can hide on landing (matching the design's full-bleed hero).
  const [isLanding, setIsLanding] = useState(true);

  useEffect(() => {
    let desktop = false;
    try {
      desktop = new URLSearchParams(window.location.search).get('desktop') === '1';
    } catch {
      desktop = false;
    }
    if (!desktop || onboardingDone()) return;
    let cancelled = false;
    getModels()
      .then((models) => {
        if (!cancelled && models.length === 0) setShowOnboarding(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  // Skills picked from the sidebar Skills menu → bumped so Chat inserts `/name `.
  const [skillInsert, setSkillInsert] = useState<{ name: string; seq: number } | null>(null);
  // 挂载时 URL 里的（短）session id；用 ref 暂存，避免被 URL 同步 effect 清掉。
  const urlSessionRef = useRef<string | null>(readSessionIdFromUrl());
  // 跳过首次 URL 同步：此时可能正等待把短 id 还原成完整会话，别先清掉参数。
  const firstUrlSync = useRef(true);
  // 刷新时若 URL 带 session id，先进入「恢复中」态：在按短 id 还原出会话前，
  // 抑制 Chat 的新建落地页，避免「先闪一下新建页再跳到历史」的体验。
  const [restoring, setRestoring] = useState<boolean>(() => readSessionIdFromUrl() != null);
  // 导航序列号：递增标记每次用户发起的会话/目录/新建切换。
  // 用于使网络飞行中已过期的异步操作（如 openNewSession 的 createSession）直接作废，
  // 彻底杜绝「在一个项目点新建后立即切到另一个项目会话，前一个异步请求晚到覆盖当前视图导致工作目录错乱与穿透」的竞态 BUG。
  const navSeqRef = useRef(0);

  // 关闭表头会话菜单：外部点击 / 滚动 / 缩放（fixed 菜单不跟随锚点，故一并关闭）。
  useEffect(() => {
    if (!headerMenuOpen) return;
    const close = () => setHeaderMenuOpen(false);
    const onDown = (e: MouseEvent) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target as Node)) {
        setHeaderMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [headerMenuOpen]);

  // Chat 完成首条消息后会回传它创建的 session id；刷新侧栏列表。
  // `claimView=false`：只对齐侧栏/列表，绝不切换当前视图（用户在发送飞行期间已切走）。
  function handleSessionAssigned(id: string, opts?: { claimView?: boolean }) {
    // 把乐观条目的临时 id 对齐到后端真实 id（落地页发送时乐观条目用的是临时 id），
    // 这样接下来的列表刷新能按 id 去重，用真实条目（含自动命名）覆盖乐观条目。
    setOptimisticSessions((prev) => {
      const next: Record<string, SessionMetaWithProject> = { ...prev };
      for (const key of Object.keys(next)) {
        if (key.startsWith('optimistic-') || key === id) {
          const item = next[key];
          delete next[key];
          if (item) next[id] = { ...item, id };
        }
      }
      return next;
    });
    // 只有仍在看这条 turn 归属的会话（或落地页）才把视图切过去；已切走时保持用户选择，
    // 新会话由侧栏列表与 /events 的 session_upsert 自行出现。
    if (id !== sessionId && opts?.claimView !== false) {
      setSessionId(id);
    }
    // 关键触发：一旦服务端确认会话分配，立即刷新侧栏，确保切换会话后该会话稳固展示
    setSessionListVersion((v) => v + 1);
  }

  // 首条消息发出瞬间：用消息前 10 字做临时标题，乐观插入侧栏（即时可见）。
  // 优先复用已创建会话的 id / 目录（新建按钮、切目录会预建会话）；落地页直发时
  // 还没有 id，先用临时 id，待 done 回传真实 id 后由 handleSessionAssigned 对齐。
  function handleOptimisticSession(title: string) {
    const now = Math.floor(Date.now() / 1000);
    const id = activeSession?.id ?? `optimistic-${now}`;
    const newSession: SessionMetaWithProject = {
      id,
      name: title,
      working_dir: activeSession?.working_dir ?? cwd,
      // Fall back to the current project's hash (not '') so the optimistic row
      // survives the sidebar's project_hash filter on a landing-page first send.
      project_hash: activeSession?.project_hash ?? projectHash,
      created_at: activeSession?.created_at ?? now,
      updated_at: now,
      message_count: 1,
    };
    setOptimisticSessions((prev) => ({
      ...prev,
      [id]: newSession,
    }));
    // 顶部标题头用的是 activeSession.name；首发时同步成临时标题（已有会话元数据时），
    // 否则标题头会一直停在占位名 session-<ts>。落地页首发无 activeSession，标题头本就
    // 隐藏，待回合结束列表刷新后由 handleActiveSessionMeta 回填真实标题。
    // 但如果用户已手动重命名过会话（名称非 session-xxx 格式），则不覆盖，保护用户选择。
    setActiveSession((prev) =>
      prev
        ? {
            ...prev,
            name: prev.name.startsWith('session-') ? title : prev.name,
          }
        : prev,
    );
  }

  // 侧栏列表（重新）加载后回传当前会话的真实元数据：回合落盘后后端已自动命名，
  // 用真实标题覆盖顶部标题头的临时标题（前 10 字）。仅在仍是同一会话且标题有变时更新。
  function handleActiveSessionMeta(s: SessionMetaWithProject) {
    setActiveSession((prev) =>
      prev && prev.id === s.id && prev.name !== s.name ? { ...prev, name: s.name } : prev,
    );
    // 当真实会话已经从后端拉出且已拥有消息时，才从乐观池移除对应的临时记录，杜绝首轮执行中断档消失
    setOptimisticSessions((prev) => {
      if (!prev[s.id]) return prev;
      if ((s.message_count ?? 0) === 0) return prev;
      const next = { ...prev };
      delete next[s.id];
      return next;
    });
  }

  // ☰：移动端专用，开/关抽屉。桌面端的收起/展开由侧栏自身的按钮处理。
  function toggleSidebar() {
    setSidebarOpen((o) => !o);
  }

  // Seed cwd from /project on mount（恢复会话时以会话目录为准，故只在仍为空时填充）
  useEffect(() => {
    let cancelled = false;
    getProject()
      .then((p) => {
        if (cancelled) return;
        if (p.working_dir) setCwd((c) => c || p.working_dir);
        if (p.project_hash) setProjectHash((h) => h || p.project_hash!);
      })
      .catch(() => {
        // Ignore; cwd stays empty
      });

    // 自动静默检测版本更新（遵循用户选定的通道，有新版本时点亮绿色向上箭头）
    const fetchLatestUpdate = () => {
      if (cancelled) return;
      const savedChannel = localStorage.getItem('jeikcode_update_channel') || undefined;
      checkUpdate(savedChannel)
        .then((res) => {
          if (!cancelled) setUpdateInfo(res);
        })
        .catch(() => {});
    };

    // 升级后首次启动配置覆盖检测（延迟执行，错峰避让冷启动首屏会话加载）
    const fetchConfigUpgrade = () => {
      if (cancelled) return;
      fetchUpgradeDiffs(true, false)
        .then((res) => {
          if (!cancelled && res.should_prompt && res.diffs.length > 0) {
            setConfigDiffs(res.diffs);
          }
        })
        .catch(() => {});
    };

    // 1.5 秒后自动静默检测版本与配置覆盖（错峰延迟）
    const updateTimer = setTimeout(() => {
      fetchLatestUpdate();
      fetchConfigUpgrade();
    }, 1500);

    // 每 15 分钟后台自动静默检测一次，保持更新时效性
    const updateInterval = setInterval(fetchLatestUpdate, 15 * 60 * 1000);

    // 窗口重新获得焦点时静默检测一次（防止开着网页期间发布了新版未及时同步）
    const onWindowFocus = () => {
      fetchLatestUpdate();
    };
    window.addEventListener('focus', onWindowFocus);

    return () => {
      cancelled = true;
      clearTimeout(updateTimer);
      clearInterval(updateInterval);
      window.removeEventListener('focus', onWindowFocus);
    };
  }, []);

  const openUpdateDialogWithFreshCheck = () => {
    setShowUpdateDialog(true);
    const savedChannel = localStorage.getItem('jeikcode_update_channel') || undefined;
    checkUpdate(savedChannel)
      .then((res) => setUpdateInfo(res))
      .catch(() => {});
  };

  const handleManualCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    try {
      const savedChannel = localStorage.getItem('jeikcode_update_channel') || undefined;
      const res = await checkUpdate(savedChannel);
      setUpdateInfo(res);
      if (res.has_update) {
        setShowUpdateDialog(true);
      } else {
        showToast(t('update.latest', { version: res.current_version }), 'info');
      }
    } catch (e: any) {
      showToast(t('update.failed', { error: e?.message || String(e) }), 'error');
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  // 把当前 session id（取前 8 位）同步进 URL，刷新后可恢复。
  useEffect(() => {
    // 跳过首次：挂载时若 URL 已带短 id 而 sessionId 尚未还原，别先把参数清掉。
    if (firstUrlSync.current) {
      firstUrlSync.current = false;
      return;
    }
    const url = new URL(window.location.href);
    if (sessionId) {
      url.searchParams.set('session', shortSessionId(sessionId));
    } else {
      url.searchParams.delete('session');
    }
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }, [sessionId]);

  // 刷新后用 URL 里的短 id 还原成完整记录（完整 id + project_hash + working_dir），
  // 再交给 Chat 加载历史。用 resolveSession（跨所有桶按 id 定位，不受 /sessions 的
  // 50 条上限影响），否则较旧的会话刷新后会找不到、回落到新建页。仅在挂载时执行一次。
  useEffect(() => {
    const urlSid = urlSessionRef.current;
    if (!urlSid) return;
    let cancelled = false;
    resolveSession(urlSid)
      .then((found) => {
        if (cancelled || !found) return;
        setSessionId(found.id);
        setActiveSession(found);
        if (found.working_dir) setCwd(found.working_dir);
        if (found.project_hash) setProjectHash(found.project_hash);
      })
      .catch(() => {
        /* 找不到就维持现状（回到新建页） */
      })
      .finally(() => {
        // 无论找没找到，恢复流程结束：解除抑制（找到→历史页，没找到→新建页）。
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 全局拦截外部链接点击：确保以新标签页（或系统原生浏览器）打开，绝不覆盖 JeikCode WebUI
  useEffect(() => {
    function handleGlobalAnchorClick(e: MouseEvent) {
      const anchor = (e.target as HTMLElement)?.closest('a') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
      if (/^https?:\/\//i.test(href)) {
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
      }
    }
    document.addEventListener('click', handleGlobalAnchorClick, { capture: true });
    return () => document.removeEventListener('click', handleGlobalAnchorClick, { capture: true });
  }, []);

  // 当 sessionId 改变，且 activeSession 的 id 与之不匹配时，自动解析/加载该会话的元数据。
  // 解决了在 TUI 或其他端中执行 /resume 切换会话、或新建会话后，webui 无法同步更新
  // activeSession、CWD 以及 projectHash 的问题。
  useEffect(() => {
    if (!sessionId) return;
    if (activeSession && activeSession.id === sessionId) return;

    let cancelled = false;
    resolveSession(sessionId)
      .then((found) => {
        if (cancelled || !found) return;
        setActiveSession(found);
        if (found.working_dir) setCwd(found.working_dir);
        if (found.project_hash) setProjectHash(found.project_hash);
        setSessionListVersion((v) => v + 1);
      })
      .catch((err) => {
        console.warn('[syncSession] resolve session failed:', err);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // 在指定目录下开启一个新建会话视图（草稿态，首条用户消息前绝不调用后端预创建，不占位不写盘）。
  function openNewSession(targetCwd: string | undefined) {
    navSeqRef.current++;
    setSessionId(null);
    setActiveSession(null);
    if (targetCwd && targetCwd !== '~') {
      setCwd(targetCwd);
    }
  }

  function handleNewSession(targetDir?: string) {
    setSidebarOpen(false);
    setActiveMainTabId('chat');
    // Top-level 「新建对话」 stays in the current/serve workspace.
    openNewSession(targetDir || cwd || undefined);
  }

  function applySessionSelection(session: SessionMetaWithProject) {
    navSeqRef.current++;
    setSessionId(session.id);
    setActiveSession(session);
    setActiveMainTabId('chat');
    if (session.working_dir) {
      setCwd(session.working_dir);
    }
    if (session.project_hash) setProjectHash(session.project_hash);
    setSidebarOpen(false);
  }

  function handleSelectSession(session: SessionMetaWithProject) {
    navSeqRef.current++;
    applySessionSelection(session);
  }

  // 点击系统/桌面通知跳转会话与唤醒窗口
  useEffect(() => {
    const onFocusReq = (e: Event) => {
      const sid = (e as CustomEvent<{ sessionId: string }>).detail?.sessionId;
      if (!sid) return;
      try {
        window.focus();
      } catch {}
      resolveSession(sid)
        .then((found) => {
          if (found) handleSelectSession(found);
        })
        .catch(() => {});
    };
    window.addEventListener('jeikcode:focus-session', onFocusReq);
    return () => {
      window.removeEventListener('jeikcode:focus-session', onFocusReq);
    };
  }, []);

  // 切换工作目录：侧栏按新目录过滤会话，并在该目录下新建一个会话（落地、侧栏可见）。
  // 也是「切换项目」下拉选中另一个项目时的入口（真正切进去，而非只浏览）。
  function handlePickCwd(path: string) {
    navSeqRef.current++;
    setSidebarOpen(false);
    setCwd(path);
    // We don't know the new dir's bucket hash until the daemon creates a session
    // there; clear it so the sidebar falls back to filtering by `cwd` in the
    // meantime, then openNewSession's response re-pins projectHash.
    setProjectHash('');
    openNewSession(path || undefined);
  }

  // 当从外部（TUI `/cd` 等）收到工作目录变更通知时：
  // 更新 cwd 并拉取最新的项目信息以更新 projectHash。
  function handleCwdChanged(newCwd: string) {
    setCwd(newCwd);
    getProject()
      .then((p) => {
        if (p.project_hash) {
          setProjectHash(p.project_hash);
        }
        setSessionListVersion((v) => v + 1);
      })
      .catch((err) => {
        console.warn('[cwdChanged] failed to get project state:', err);
      });
  }

  // 删除会话：若删的是当前打开的会话，回到空白新对话。
  function handleSessionDeleted(id: string) {
    if (id === sessionId) {
      navSeqRef.current++;
      setSessionId(null);
      setActiveSession(null);
    }
  }

  // 重命名会话：若是当前会话，同步更新标题。
  function handleSessionRenamed(id: string, name: string) {
    if (id === sessionId) {
      setActiveSession((prev) => (prev ? { ...prev, name } : prev));
      setOptimisticSessions((prev) => {
        const current = prev[id];
        if (!current) return prev;
        return { ...prev, [id]: { ...current, name } };
      });
    }
  }

  /** Export the active session's conversation as a Markdown file. */
  async function handleExportMarkdown() {
    if (!activeSession) return;
    setHeaderMenuOpen(false);
    setHeaderExporting(true);
    try {
      const detail = await getSession(activeSession.project_hash, activeSession.id);
      const title = detail.name || detail.id.slice(0, 8);
      const lines = sessionMessagesToMarkdownLines(detail.messages, title);
      const mdContent = lines.join('\n');
      const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title.replace(/[\\/:*?"<>|]/g, '_')}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      showToast(t('sidebar.exportFailed'), 'error');
    } finally {
      setHeaderExporting(false);
    }
  }

  return (
    <div class="app">
      {/* ===== Full-height sidebar (通栏)：品牌 + 收起按钮在其顶部 ===== */}
      <Sidebar
        activeSessionId={sessionId}
        onSelect={handleSelectSession}
        onNew={handleNewSession}
        open={sidebarOpen}
        onCloseDrawer={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        onOpenSettings={(section) => setSettingsSection(section)}
        reloadKey={sessionListVersion}
        optimisticSessions={optimisticSessions}
        onActiveSessionMeta={handleActiveSessionMeta}
        cwd={cwd}
        projectHash={projectHash}
        onSessionRenamed={handleSessionRenamed}
        onSessionDeleted={handleSessionDeleted}
        onPickSkill={(name) => setSkillInsert({ name, seq: Date.now() })}
        onOpenCwd={() => setShowCwd(true)}
        onSwitchProject={handlePickCwd}
        extraRunningIds={Array.from(liveRunningIds)}
        onOpenFile={handleOpenFile}
        activeFilePath={diffTabs.find((t) => t.id === activeMainTabId)?.filePath}
      />
      <div
        class={'sidebar-backdrop' + (sidebarOpen ? ' show' : '')}
        onClick={() => setSidebarOpen(false)}
      />

      {/* ===== Main column: sticky session-title header + chat (no top bar) ===== */}
      <div class={'main-column' + (isLanding ? ' is-landing' : '')}>
        {/* 全局统一应用顶栏：带坚实底色、底边线与清晰边界感，杜绝滚动穿透 */}
        <header
          class={
            'session-header' +
            (isHeaderCompact ? ' is-compact' : '') +
            (isHeaderUltraCompact ? ' is-ultra-compact' : '')
          }
          ref={headerMenuRef}
          onDragOver={(e) => {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={(e) => {
            const raw = e.dataTransfer?.getData('application/jeikcode-tab');
            const data = raw ? JSON.parse(raw) : (window as any).__jeikcode_dragged_tab;
            if (data?.filePath && diffTabs.length === 0) {
              e.preventDefault();
              handleOpenFile(data.filePath);
            }
          }}
        >
          {/* Mobile-only menu button */}
          <button
            class="mobile-menu-btn"
            onClick={toggleSidebar}
            aria-label={t('header.menu')}
            title={t('header.sessionList')}
          >
            ☰
          </button>

          {/* 移动端顶部：左上角会话与Diff标签下拉收纳框 */}
          {activeSession?.name && !isLanding && isHeaderCompact ? (
            <div class="mobile-session-tab-dropdown-wrap" ref={mobileTabsDropdownRef}>
              <button
                type="button"
                class={'mobile-session-tab-btn' + (mobileTabsDropdownOpen ? ' open' : '')}
                onClick={(e) => {
                  e.stopPropagation();
                  setMobileTabsDropdownOpen((v) => !v);
                }}
                aria-label={t('header.tabsMenu')}
              >
                {liveRunningIds.has(activeSession.id) ? (
                  <span
                    class="session-item-running session-header-running"
                    title={t('sidebar.running')}
                    aria-label={t('sidebar.running')}
                  />
                ) : activeMainTabId === 'chat' ? (
                  <span class="mobile-tab-icon">💬</span>
                ) : (
                  <span
                    class={
                      'vscode-tab-badge status-' +
                      (diffTabs.find((t) => t.id === activeMainTabId)?.fileStatus?.toLowerCase() || 'm')
                    }
                  >
                    {diffTabs.find((t) => t.id === activeMainTabId)?.fileStatus || 'M'}
                  </span>
                )}
                <span class="mobile-tab-current-title">
                  {activeMainTabId === 'chat'
                    ? activeSession.name
                    : diffTabs.find((t) => t.id === activeMainTabId)?.fileName || activeSession.name}
                </span>
                {diffTabs.length > 0 && (
                  <span class="mobile-tab-count-badge">{diffTabs.length}</span>
                )}
                <svg
                  class="mobile-tab-chevron"
                  width="11"
                  height="11"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M4 6l4 4 4-4"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>

              {mobileTabsDropdownOpen && (
                <div class="mobile-session-tabs-menu" onClick={(e) => e.stopPropagation()}>
                  <div class="mobile-tabs-group-title">{t('git.chatTab')}</div>
                  <button
                    type="button"
                    class={'mobile-tabs-menu-row' + (activeMainTabId === 'chat' ? ' active' : '')}
                    onClick={() => {
                      setActiveMainTabId('chat');
                      setMobileTabsDropdownOpen(false);
                    }}
                  >
                    <span class="mobile-tabs-row-icon">💬</span>
                    <span class="mobile-tabs-row-name">{activeSession.name}</span>
                    {activeMainTabId === 'chat' && <span class="mobile-tabs-active-check">✓</span>}
                  </button>

                  {diffTabs.length > 0 && (
                    <>
                      <div class="mobile-tabs-group-title">
                        {t('git.changes')} ({diffTabs.length})
                      </div>
                      {diffTabs.map((tab) => (
                        <div
                          key={tab.id}
                          class={'mobile-tabs-menu-row' + (activeMainTabId === tab.id ? ' active' : '')}
                          onClick={() => {
                            setActiveMainTabId(tab.id);
                            setMobileTabsDropdownOpen(false);
                          }}
                        >
                          <span class={'vscode-tab-badge status-' + tab.fileStatus.toLowerCase()}>
                            {tab.fileStatus}
                          </span>
                          <span class="mobile-tabs-row-name" title={tab.filePath}>
                            {tab.fileName}
                          </span>
                          <button
                            type="button"
                            class="mobile-tabs-row-close"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCloseDiffTab(tab.id);
                            }}
                            title={t('preview.closeTab')}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          ) : activeSession?.name && (activeSession.message_count ?? 0) > 0 ? (
            /* 桌面端会话标题：只有当该会话真实拥有消息时才展示其标题 */
            <button
              type="button"
              class={
                'session-title-btn' +
                (activeMainTabId === 'chat' ? ' active' : ' clickable-nav')
              }
              title={activeSession.name}
              onClick={() => setActiveMainTabId('chat')}
            >
              <span class="session-title-text">{activeSession.name}</span>
              {liveRunningIds.has(activeSession.id) && (
                <span
                  class="session-item-running session-header-running"
                  title={t('sidebar.running')}
                  aria-label={t('sidebar.running')}
                />
              )}
            </button>
          ) : (
            /* 桌面端常驻小云朵标签：当处于新建会话或无活跃会话时，常驻展示云朵标签，点击直接新建/切回对话 */
            <button
              type="button"
              class={
                'session-title-btn session-new-cloud-btn' +
                (activeMainTabId === 'chat' ? ' active' : ' clickable-nav')
              }
              title={t('sidebar.newChat')}
              aria-label={t('sidebar.newChat')}
              onClick={() => {
                setActiveMainTabId('chat');
                handleNewSession();
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
              </svg>
              <span class="session-title-text">{t('sidebar.newChat')}</span>
            </button>
          )}

          {/* 桌面端 VSCode Editor Tabs：全标签平铺横滑，支持微高度横向滚动条，彻底消除 +20 按钮遮挡 */}
          {!isHeaderCompact && diffTabs.length > 0 && (
            <div
              class={'header-editor-tabs-bar' + (isMainTabsDragOver ? ' is-drag-over-main' : '')}
              ref={tabsContainerRef}
              onWheel={handleTabsWheel}
              onDragOver={(e) => {
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                setIsMainTabsDragOver(true);
              }}
              onDragLeave={(e) => {
                if (!tabsContainerRef.current?.contains(e.relatedTarget as Node)) {
                  setIsMainTabsDragOver(false);
                  setMainTabOverIdx(null);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                setIsMainTabsDragOver(false);
                setMainTabOverIdx(null);
                if (mainTabDragIdx !== null) {
                  setDiffTabs((prev) => {
                    const next = [...prev];
                    const [moved] = next.splice(mainTabDragIdx, 1);
                    if (moved) next.push(moved);
                    return next;
                  });
                  setMainTabDragIdx(null);
                  return;
                }
                try {
                  const raw = e.dataTransfer?.getData('application/jeikcode-tab');
                  const data = raw ? JSON.parse(raw) : (window as any).__jeikcode_dragged_tab;
                  if (data?.filePath) {
                    handleOpenFile(data.filePath);
                  }
                } catch {}
              }}
              role="tablist"
            >
              {diffTabs.map((tab, idx) => {
                const isActive = activeMainTabId === tab.id;
                const isOver = mainTabOverIdx === idx;
                const isDragging = mainTabDragIdx === idx;
                return (
                  <div
                    key={tab.id}
                    class={
                      'header-editor-tab' +
                      (isActive ? ' active' : '') +
                      (isOver ? ' is-drag-over-tab' : '') +
                      (isDragging ? ' is-dragging-tab' : '')
                    }
                    onClick={() => setActiveMainTabId(tab.id)}
                    onDblClick={(e) => {
                      e.stopPropagation();
                      handleCloseDiffTab(tab.id);
                    }}
                    title={`${tab.filePath}${tab.commitShortHash ? ` (${tab.commitShortHash})` : ''} (${t('header.doubleClickClose')})`}
                    draggable={true}
                    onDragStart={(e) => {
                      setMainTabDragIdx(idx);
                      const data = {
                        id: tab.id,
                        filePath: tab.filePath,
                        fileName: tab.fileName,
                        fileStatus: tab.fileStatus,
                      };
                      (window as any).__jeikcode_dragged_tab = data;
                      e.dataTransfer?.setData('application/jeikcode-tab', JSON.stringify(data));
                      e.dataTransfer?.setData('application/jeikcode-main-tab-index', String(idx));
                      e.dataTransfer?.setData('text/plain', tab.filePath);
                      if (e.dataTransfer) {
                        e.dataTransfer.effectAllowed = 'copyMove';
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (e.dataTransfer) {
                        e.dataTransfer.dropEffect = mainTabDragIdx !== null ? 'move' : 'copy';
                      }
                      if (mainTabOverIdx !== idx) {
                        setMainTabOverIdx(idx);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setMainTabOverIdx(null);
                      setIsMainTabsDragOver(false);

                      const fromIndexStr = e.dataTransfer?.getData('application/jeikcode-main-tab-index');
                      if (fromIndexStr !== undefined && fromIndexStr !== '') {
                        const fromIdx = parseInt(fromIndexStr, 10);
                        if (!Number.isNaN(fromIdx) && fromIdx !== idx) {
                          setDiffTabs((prev) => {
                            const next = [...prev];
                            const [moved] = next.splice(fromIdx, 1);
                            if (moved) next.splice(idx, 0, moved);
                            return next;
                          });
                          setMainTabDragIdx(null);
                          return;
                        }
                      }

                      try {
                        const raw = e.dataTransfer?.getData('application/jeikcode-tab');
                        const data = raw ? JSON.parse(raw) : (window as any).__jeikcode_dragged_tab;
                        if (data?.filePath) {
                          handleOpenFile(data.filePath, idx);
                        }
                      } catch {}
                      setMainTabDragIdx(null);
                    }}
                    onDragEnd={() => {
                      (window as any).__jeikcode_dragged_tab = null;
                      setMainTabDragIdx(null);
                      setMainTabOverIdx(null);
                    }}
                  >
                    <span class={'vscode-tab-badge status-' + (tab.fileStatus || 'M').toLowerCase()}>
                      {tab.fileStatus || 'M'}
                    </span>
                    <span class="tab-filename">{tab.fileName}</span>
                    <button
                      type="button"
                      class="vscode-tab-close"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCloseDiffTab(tab.id);
                      }}
                      title={t('preview.closeTab')}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* 右上角精炼工具栏：桌面端外显快捷操作（刷新、远程、更新、主题、语言），缩放窄屏或手机时动态收纳至三个点 */}
          <div
            class="top-nav-actions"
            role="toolbar"
            aria-label={t('header.quickSettings')}
          >
            {/* 桌面端外显：刷新当前会话 */}
            <button
              type="button"
              class="top-nav-btn top-nav-desktop-action top-nav-refresh-btn"
              onClick={() => window.location.reload()}
              title={t('header.refresh')}
              aria-label={t('header.refresh')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
                <path d="M3 21v-5h5" />
                <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
            </button>

            {/* 桌面端外显：远程访问控制 */}
            <div class="top-nav-desktop-action top-nav-remote-desktop">
              <RemoteAccessControl />
            </div>

            {/* 桌面端外显：软件更新 */}
            <button
              type="button"
              class={`top-nav-btn top-nav-desktop-action top-nav-update-btn ${updateInfo?.has_update ? 'has-update' : ''}`}
              onClick={openUpdateDialogWithFreshCheck}
              title={updateInfo?.has_update ? t('update.hasUpdate', { version: updateInfo.latest_version }) : t('update.modalTitle')}
              aria-label={t('update.modalTitle')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>

            {/* 主题切换（桌面外显，极窄或手机收纳） */}
            <button
              type="button"
              class="top-nav-btn top-nav-theme-btn"
              onClick={() => {
                if (theme === 'light') setTheme('dark');
                else if (theme === 'dark') setTheme('system');
                else setTheme('light');
              }}
              title={theme === 'light' ? t('settings.theme.light') : theme === 'dark' ? t('settings.theme.dark') : t('settings.theme.system')}
              aria-label={t('settings.theme')}
            >
              {theme === 'light' ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              ) : theme === 'dark' ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 3v18" />
                  <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
                </svg>
              )}
            </button>

            {/* 常驻语言切换（电脑版轻量现代下拉框，手机版保持居中弹窗） */}
            <div class="top-nav-lang-wrap" ref={langMenuRef}>
              <button
                type="button"
                class={'top-nav-btn top-nav-lang-btn' + (langMenuOpen ? ' active' : '')}
                onClick={() => {
                  const isMobile = typeof window !== 'undefined'
                    ? (window.innerWidth <= 768 || ('ontouchstart' in window && window.innerWidth <= 1024))
                    : false;
                  if (isMobile) {
                    setSettingsSection('language');
                  } else {
                    setLangMenuOpen((o) => !o);
                  }
                }}
                title={t('settings.menuLang')}
                aria-label={t('settings.menuLang')}
                aria-expanded={langMenuOpen}
              >
                <span>{(() => {
                  switch (lang) {
                    case 'zh': return '简';
                    case 'zh-TW': return '繁';
                    case 'ja': return 'JA';
                    case 'ko': return 'KO';
                    case 'ru': return 'RU';
                    case 'fr': return 'FR';
                    case 'es': return 'ES';
                    case 'de': return 'DE';
                    case 'ar': return 'AR';
                    case 'vi': return 'VI';
                    default: return 'EN';
                  }
                })()}</span>
              </button>

              {langMenuOpen && (
                <div class="top-nav-lang-menu" role="menu">
                  {languageOptions.map(({ value: v, label }) => (
                    <button
                      key={v}
                      type="button"
                      class={'lang-menu-item' + (lang === v ? ' active' : '')}
                      onClick={() => {
                        setLang(v);
                        setLangMenuOpen(false);
                      }}
                    >
                      <span class="lang-item-name">{label}</span>
                      {lang === v && <span class="lang-item-check">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 模型选择控件插槽（核心操作，内含思考档位与模型胶囊，齿轮已内置） */}
            <div ref={setTopModelSlot} class="top-nav-model-slot" id="top-nav-model-slot" />

            {/* 更多收纳菜单（桌面宽屏隐藏；缩放窄屏或手机时动态显现并承载收纳项） */}
            <div class="top-nav-more-wrap" ref={topNavMoreRef}>
              <button
                type="button"
                class={'top-nav-btn top-nav-more-btn' + (updateInfo?.has_update ? ' has-update-dot' : '')}
                onClick={() => setTopNavMoreOpen((o) => !o)}
                title={t('sidebar.itemMenu')}
                aria-label={t('sidebar.itemMenu')}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="1.5" fill="currentColor" />
                  <circle cx="12" cy="5" r="1.5" fill="currentColor" />
                  <circle cx="12" cy="19" r="1.5" fill="currentColor" />
                </svg>
              </button>

              {topNavMoreOpen && (
                <div class="top-nav-more-menu" role="menu">
                  <button
                    type="button"
                    class="top-nav-more-item"
                    onClick={() => {
                      setTopNavMoreOpen(false);
                      window.location.reload();
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
                      <path d="M3 21v-5h5" />
                      <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
                      <path d="M21 3v5h-5" />
                    </svg>
                    <span>{t('header.refresh')}</span>
                  </button>

                  <div class="top-nav-more-remote-wrapper">
                    <RemoteAccessControl />
                  </div>

                  <button
                    type="button"
                    class="top-nav-more-item"
                    onClick={() => {
                      setTopNavMoreOpen(false);
                      openUpdateDialogWithFreshCheck();
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="12" y1="19" x2="12" y2="5" />
                      <polyline points="5 12 12 5 19 12" />
                    </svg>
                    <span>{updateInfo?.has_update ? t('update.hasUpdate', { version: updateInfo.latest_version }) : t('update.modalTitle')}</span>
                    {updateInfo?.has_update && <span class="update-more-badge">NEW</span>}
                  </button>

                  <button
                    type="button"
                    class="top-nav-more-item top-nav-more-lang-item"
                    onClick={() => setSettingsSection('language')}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M3 12h18" />
                      <path d="M12 3a15 15 0 0 1 0 18" />
                      <path d="M12 3a15 15 0 0 0 0 18" />
                    </svg>
                    <span>{t('header.language')}</span>
                    <span class="top-nav-more-trailing">{languageOptions.find((o) => o.value === lang)?.label ?? 'English'}</span>
                  </button>

                  <button
                    type="button"
                    class="top-nav-more-item top-nav-more-theme-item"
                    onClick={() => {
                      if (theme === 'light') setTheme('dark');
                      else if (theme === 'dark') setTheme('system');
                      else setTheme('light');
                    }}
                  >
                    {theme === 'light' ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="5" />
                        <line x1="12" y1="1" x2="12" y2="3" />
                        <line x1="12" y1="21" x2="12" y2="23" />
                        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                        <line x1="1" y1="12" x2="3" y2="12" />
                        <line x1="21" y1="12" x2="23" y2="12" />
                        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                      </svg>
                    ) : theme === 'dark' ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 3v18" />
                        <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
                      </svg>
                    )}
                    <span>{theme === 'light' ? t('settings.theme.light') : theme === 'dark' ? t('settings.theme.dark') : t('settings.theme.system')}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div
          class="session-body app-sidebar"
          onDragOver={(e) => {
            e.preventDefault();
            if (e.dataTransfer) {
              e.dataTransfer.dropEffect = 'copy';
            }
          }}
          onDrop={(e) => {
            if (e.defaultPrevented) return;
            e.preventDefault();
            try {
              const raw = e.dataTransfer?.getData('application/jeikcode-tab');
              const data = raw ? JSON.parse(raw) : (window as any).__jeikcode_dragged_tab;
              const targetPath = data?.filePath || e.dataTransfer?.getData('text/plain');
              if (targetPath && typeof targetPath === 'string' && targetPath.trim()) {
                handleOpenFile(targetPath.trim());
              }
            } catch {}
          }}
        >
          <Chat
            sessionId={sessionId}
            onSessionId={handleSessionAssigned}
            cwd={cwd}
            onPermission={setPending}
            onPermissionResolved={(callId) =>
              setPending((cur: any) =>
                callId === null ? null : resolvePendingAfterDecision(cur, callId),
              )}
            activeSession={activeSession}
            restoring={restoring}
            onLiveTurnDone={() => {
              setSessionListVersion((v) => v + 1);
              // 回合完成时，立即主动校准本地 liveRunningIds，确保清除残留的旋转菊花
              getActiveChatSessions()
                .then((ids) => {
                  setLiveRunningIds((prev) => {
                    const next = new Set<string>();
                    for (const id of prev) {
                      if (ids.includes(id)) next.add(id);
                    }
                    return next;
                  });
                })
                .catch(() => {});
            }}
            onLiveRunningChange={(id, running) => {
              if (!id) return;
              setLiveRunningIds((prev) => {
                const next = new Set(prev);
                if (running) next.add(id);
                else next.delete(id);
                return next;
              });
            }}
            onOptimisticSession={handleOptimisticSession}
            onOpenCwd={() => setShowCwd(true)}
            onCwdChanged={handleCwdChanged}
            onLanding={setIsLanding}
            skillInsert={skillInsert}
            onSessionRenamed={(name) => {
              setActiveSession((prev) => (prev ? { ...prev, name } : prev));
              setOptimisticSessions((prev) => {
                const curId = activeSession?.id ?? sessionId;
                if (!curId || !prev[curId]) return prev;
                return {
                  ...prev,
                  [curId]: { ...prev[curId], name },
                };
              });
              setSessionListVersion((v) => v + 1);
            }}
            onOpenSidebar={() => setSidebarOpen(true)}
            onNewSession={handleNewSession}
            diffTabs={diffTabs}
            setDiffTabs={setDiffTabs}
            activeMainTabId={activeMainTabId}
            setActiveMainTabId={setActiveMainTabId}
            onRightPanelLayoutChange={setRightPanelLayout}
            topModelSlot={topModelSlot}
            onOpenModelConfig={() => setSettingsSection('model')}
            onLiveReview={onLiveReview}
            onBindReviewDismiss={onBindReviewDismiss}
          />
        </div>
      </div>

      {/* ===== Modals ===== */}
      <Suspense fallback={null}>
        {showCwd && (
          <CwdPicker
            current={cwd}
            onPick={handlePickCwd}
            onClose={() => setShowCwd(false)}
          />
        )}
        {settingsSection === 'theme' && (
          <ThemeDialog onClose={() => setSettingsSection(null)} />
        )}
        {settingsSection === 'language' && (
          <LanguageDialog onClose={() => setSettingsSection(null)} />
        )}
        {settingsSection === 'model' && (
          <SystemSettingsDialog initialTab="models" onClose={() => setSettingsSection(null)} />
        )}
        {settingsSection === 'system' && (
          <SystemSettingsDialog initialTab="models" onClose={() => setSettingsSection(null)} />
        )}
        {headerDialog === 'rename' && activeSession && (
          <RenameDialog
            session={activeSession}
            onClose={() => setHeaderDialog(null)}
            onDone={(name) => {
              handleSessionRenamed(activeSession.id, name);
              setSessionListVersion((v) => v + 1);
            }}
          />
        )}
        {headerDialog === 'delete' && activeSession && (
          <DeleteDialog
            sessions={[activeSession]}
            onClose={() => setHeaderDialog(null)}
            onDone={(ids) => {
              for (const id of ids) handleSessionDeleted(id);
              setSessionListVersion((v) => v + 1);
            }}
          />
        )}
        {showUpdateDialog && (
          <UpdateDialog
            info={updateInfo}
            onClose={() => setShowUpdateDialog(false)}
            onUpdateInfoChange={(newInfo) => setUpdateInfo(newInfo)}
          />
        )}
        {showOnboarding && (
          <OnboardingWizard
            onClose={() => setShowOnboarding(false)}
            onConfigureModel={() => setSettingsSection('model')}
          />
        )}
        {configDiffs && configDiffs.length > 0 && (
          <ConfigSyncModal
            diffs={configDiffs}
            onDone={(count) => {
              setConfigDiffs(null);
              // 选中大于 0 个文件才弹出成功提示；若选中 0 个文件点击确定直接静默完成，不跳提示
              if (count > 0) {
                showToast(t('configSync.successToast', { n: count }), 'success');
              }
            }}
            onSkip={() => {
              setConfigDiffs(null);
            }}
          />
        )}
        <LegacyMigrationModal />
        <DesktopClosePromptDialog />
      </Suspense>
      <ConfirmModalHost />
      <ToastHost />
      <NotificationDock
        liveReview={liveReview}
        chatPermission={pending}
        activeSession={activeSession}
        onDismissChatPermission={() => setPending(null)}
        onDismissLivePermission={(runtimeInstanceId, generation, requestId, callId) =>
          dismissLiveReview.current.permission(runtimeInstanceId, generation, requestId, callId)}
        onDismissLiveUserInput={() => dismissLiveReview.current.userInput()}
        onFocusSession={(id) => {
          if (!id || id === sessionId) return;
          resolveSession(id)
            .then((found) => {
              if (found) handleSelectSession(found);
            })
            .catch(() => {});
        }}
      />
    </div>
  );
}
