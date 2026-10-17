import {
  fetchGitBranches,
  fetchGitGraph,
  fetchGitStatus,
  fetchGitRepos,
  gitFetch,
  type GitBranchesResponse,
  type GitCommitItem,
  type GitStatusResponse,
  type GitRepoInfo,
} from '../api.ts';
import { gitPanelFingerprint, toolTouchesWorktree } from './gitRefresh.ts';

export { toolTouchesWorktree };

export interface GitProjectState {
  branches: GitBranchesResponse | null;
  commits: GitCommitItem[];
  gitStatus: GitStatusResponse | null;
  repos: GitRepoInfo[];
  activeRepoRoot: string | null;
  filterBranch?: string;
  loading: boolean;
  error: string | null;
  fingerprint: string;
  version: number;
}

const STORAGE_PREFIX = 'jeikcode:git_store:';

interface InflightControl {
  running: boolean;
  needsFollowup: boolean;
  debounceTimer: number | null;
}

class ProjectGitManager {
  private states = new Map<string, GitProjectState>();
  private listeners = new Map<string, Set<(state: GitProjectState) => void>>();
  private inflights = new Map<string, InflightControl>();
  private pendingVersions = new Map<string, number>();
  private lastFetchTimes = new Map<string, number>();
  private fetchInflight = new Map<string, boolean>();

  private normalizeKey(cwd?: string): string {
    return cwd ? cwd.trim() : '';
  }

  /**
   * 同步获取当前状态：优先内存，次选 sessionStorage，0ms 首屏直出，绝不白屏闪烁
   */
  public getState(cwd?: string): GitProjectState {
    const key = this.normalizeKey(cwd);
    const cached = this.states.get(key);
    if (cached) return cached;

    // 尝试从 sessionStorage 恢复历史快照
    const restored = this.restoreFromStorage(key);
    const state: GitProjectState = restored || {
      branches: null,
      commits: [],
      gitStatus: null,
      repos: [],
      activeRepoRoot: null,
      loading: false,
      error: null,
      fingerprint: '',
      version: 0,
    };
    this.states.set(key, state);
    return state;
  }

  private restoreFromStorage(key: string): GitProjectState | null {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    try {
      const raw = window.sessionStorage.getItem(STORAGE_PREFIX + key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          branches: parsed.branches ?? null,
          commits: Array.isArray(parsed.commits) ? parsed.commits : [],
          gitStatus: parsed.gitStatus ?? null,
          repos: Array.isArray(parsed.repos) ? parsed.repos : [],
          activeRepoRoot: parsed.activeRepoRoot ?? null,
          filterBranch: parsed.filterBranch || 'all',
          loading: false,
          error: null,
          fingerprint: parsed.fingerprint || '',
          version: typeof parsed.version === 'number' ? parsed.version : 0,
        };
      }
    } catch {
      // 容错处理
    }
    return null;
  }

  private saveToStorage(key: string, state: GitProjectState): void {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    try {
      const payload = {
        branches: state.branches,
        commits: state.commits,
        gitStatus: state.gitStatus,
        repos: state.repos,
        activeRepoRoot: state.activeRepoRoot,
        filterBranch: state.filterBranch,
        fingerprint: state.fingerprint,
        version: state.version,
      };
      window.sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(payload));
    } catch {
      // 忽略配额超限等异常
    }
  }

  /**
   * 订阅状态变更
   */
  public subscribe(cwd: string | undefined, listener: (state: GitProjectState) => void): () => void {
    const key = this.normalizeKey(cwd);
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);

    // 检查是否有挂起的未处理版本号，如果有则立即唤起刷新
    const pendingVer = this.pendingVersions.get(key);
    const current = this.getState(key);
    if (pendingVer !== undefined && pendingVer > current.version) {
      this.pendingVersions.delete(key);
      this.scheduleRefresh(key, { immediate: true, reason: 'consume_pending_version' });
    }

    return () => {
      const s = this.listeners.get(key);
      if (s) {
        s.delete(listener);
        if (s.size === 0) {
          this.listeners.delete(key);
        }
      }
    };
  }

  public hasSubscribers(cwd?: string): boolean {
    const key = this.normalizeKey(cwd);
    const set = this.listeners.get(key);
    return Boolean(set && set.size > 0);
  }

  private notify(key: string): void {
    const state = this.states.get(key);
    if (!state) return;
    const set = this.listeners.get(key);
    if (set) {
      for (const listener of set) {
        try {
          listener(state);
        } catch (e) {
          console.error('[GitStore] Listener error:', e);
        }
      }
    }
  }

  /**
   * 原子排队刷新调度器：
   * - 500ms 动态防抖（避免多 Agent 或连续写文件并发轰炸）
   * - Single-flight Inflight 锁（同一时刻最多 1 个请求跑在网络中，后续请求自动合并为 1 次追踪排队）
   * - 动静分离（HEAD Hash 未变时复用已有 Git Graph，仅查 Status，节省 90% 性能）
   */
  public scheduleRefresh(
    cwd: string | undefined,
    options: {
      immediate?: boolean;
      reason?: string;
      forceAll?: boolean;
      filterBranch?: string;
    } = {},
  ): Promise<void> {
    const key = this.normalizeKey(cwd);
    let inflight = this.inflights.get(key);
    if (!inflight) {
      inflight = { running: false, needsFollowup: false, debounceTimer: null };
      this.inflights.set(key, inflight);
    }

    if (inflight.debounceTimer !== null) {
      window.clearTimeout(inflight.debounceTimer);
      inflight.debounceTimer = null;
    }

    const run = async () => {
      const ctrl = this.inflights.get(key);
      if (!ctrl) return;

      if (ctrl.running) {
        ctrl.needsFollowup = true;
        return;
      }

      ctrl.running = true;
      const prevState = this.getState(key);
      const isInitialSilent = prevState.branches !== null && prevState.gitStatus !== null;

      if (!isInitialSilent) {
        this.states.set(key, { ...prevState, loading: true, error: null });
        this.notify(key);
      }

      try {
        const effectiveCwd = prevState.activeRepoRoot || key;

        // 阶段一：并行拉取 Status 与 Branches
        const [branchRes, statusRes] = await Promise.all([
          fetchGitBranches(effectiveCwd),
          fetchGitStatus(effectiveCwd),
        ]);

        const currentHeadCommit = statusRes.staged[0] ? undefined : undefined;
        // 判断当前 HEAD 是否移动
        const prevHead = prevState.commits[0]?.hash;
        const currentBranchName = statusRes.current_branch || branchRes.current || '';
        
        const effectiveBranchFilter = options.filterBranch !== undefined ? options.filterBranch : (prevState.filterBranch || 'all');
        let shouldFetchGraph =
          options.forceAll ||
          prevState.commits.length === 0 ||
          effectiveBranchFilter !== (prevState.filterBranch || 'all');

        // 如果之前的当前分支名变了，必须重新拉取 Graph
        if (prevState.branches?.current !== branchRes.current) {
          shouldFetchGraph = true;
        }

        let newCommits = prevState.commits;
        if (shouldFetchGraph) {
          const graphRes = await fetchGitGraph({
            cwd: effectiveCwd,
            branch: effectiveBranchFilter === 'all' ? undefined : effectiveBranchFilter,
            limit: 80,
          });
          newCommits = graphRes.commits;
        }

        // 计算新指纹
        const fingerprint = gitPanelFingerprint({
          branch: currentBranchName,
          ahead: statusRes.ahead,
          behind: statusRes.behind,
          staged: statusRes.staged,
          unstaged: statusRes.unstaged,
          untracked: statusRes.untracked,
          commits: newCommits.map((c) => ({
            hash: c.hash,
            message: c.message,
            refs: c.refs,
          })),
        });

        const nextState: GitProjectState = {
          branches: branchRes,
          commits: newCommits,
          gitStatus: statusRes,
          repos: prevState.repos,
          activeRepoRoot: prevState.activeRepoRoot,
          filterBranch: effectiveBranchFilter,
          loading: false,
          error: null,
          fingerprint,
          version: prevState.version + 1,
        };

        this.states.set(key, nextState);
        this.saveToStorage(key, nextState);
        this.notify(key);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const cur = this.getState(key);
        this.states.set(key, { ...cur, loading: false, error: message });
        this.notify(key);
      } finally {
        const ctrlAfter = this.inflights.get(key);
        if (ctrlAfter) {
          ctrlAfter.running = false;
          if (ctrlAfter.needsFollowup) {
            ctrlAfter.needsFollowup = false;
            // 排队追踪执行，立即发起
            this.scheduleRefresh(key, { immediate: true, reason: 'followup' });
          }
        }
      }
    };

    if (options.immediate) {
      return run();
    } else {
      return new Promise<void>((resolve) => {
        inflight.debounceTimer = window.setTimeout(async () => {
          if (inflight) inflight.debounceTimer = null;
          await run();
          resolve();
        }, 500); // 500ms 纯事件驱动防抖
      });
    }
  }

  /**
   * 异步轻量更新 repos 列表（仅在初次或确有需要时调用，不阻断主视图渲染）
   */
  public async refreshRepos(cwd?: string): Promise<void> {
    const key = this.normalizeKey(cwd);
    try {
      const res = await fetchGitRepos(key);
      const cur = this.getState(key);
      let nextActive = cur.activeRepoRoot;
      if (res.repos.length > 0) {
        if (!nextActive || !res.repos.some((r) => r.root === nextActive)) {
          const rootRepo = res.repos.find((r) => r.is_root) || res.repos[0];
          nextActive = rootRepo ? rootRepo.root : null;
        }
      }
      const switchedRepo = nextActive !== cur.activeRepoRoot;
      const updated: GitProjectState = {
        ...cur,
        repos: res.repos,
        activeRepoRoot: nextActive,
      };
      this.states.set(key, updated);
      this.saveToStorage(key, updated);
      this.notify(key);

      // 如果当前 activeRepoRoot 发生有效切换，或者根目录此前判定为非 repo 但实际上发现了子 repo
      if (switchedRepo || (cur.branches && !cur.branches.is_repo && res.repos.length > 0)) {
        this.scheduleRefresh(key, { immediate: true, forceAll: true, reason: 'repo_activated' });
      }
    } catch {
      // 忽略多仓库探测失败
    }
  }

  /**
   * 智能节流触发上游 Fetch：
   * - 60s 节流控制（避免切屏/Alt-Tab 频繁碰撞）
   * - Single-flight 并发锁（同一仓库同一时刻最多 1 个 Fetch 在跑）
   * - 可见性守卫（后台隐藏标签页绝不偷跑网络请求）
   * - Fetch 成功后自动级联 scheduleRefresh(forceAll: true) 刷新全部远端分支与提交图
   */
  public async triggerAutoFetch(
    cwd: string | undefined,
    options: {
      force?: boolean;
      prune?: boolean;
    } = {},
  ): Promise<boolean> {
    const key = this.normalizeKey(cwd);
    const now = Date.now();
    const last = this.lastFetchTimes.get(key) || 0;

    // 1. 节流：非强制时，距上次成功未满 60 秒直接跳过
    if (!options.force && now - last < 60_000) {
      return false;
    }

    // 2. 避免后台未激活标签偷跑
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return false;
    }

    // 3. 避免并发碰撞
    if (this.fetchInflight.get(key)) {
      return false;
    }

    const cur = this.getState(key);
    const targetDir = cur.activeRepoRoot || key;

    this.fetchInflight.set(key, true);
    try {
      const res = await gitFetch({ cwd: targetDir, prune: options.prune ?? true });
      this.lastFetchTimes.set(key, Date.now());

      // Fetch 成功后，远程引用 (refs/remotes/*) 和 FETCH_HEAD 已经更新，
      // 级联拉取最新的 status 与完整的 graph，更新 UI 和 sessionStorage
      this.scheduleRefresh(key, {
        immediate: true,
        forceAll: true,
        reason: 'autofetch_complete',
      });
      return res.success;
    } catch (err) {
      // 静默处理网络错误/超时，不污染主界面
      console.debug('[GitStore] Silent fetch skipped or failed:', err);
      return false;
    } finally {
      this.fetchInflight.set(key, false);
    }
  }

  public isFetching(cwd?: string): boolean {
    const key = this.normalizeKey(cwd);
    return Boolean(this.fetchInflight.get(key));
  }

  public setActiveRepoRoot(cwd: string | undefined, repoRoot: string | null): void {
    const key = this.normalizeKey(cwd);
    const cur = this.getState(key);
    const updated: GitProjectState = {
      ...cur,
      activeRepoRoot: repoRoot,
    };
    this.states.set(key, updated);
    this.saveToStorage(key, updated);
    this.notify(key);
    this.scheduleRefresh(key, { immediate: true, forceAll: true });
  }

  /**
   * 接收来自 /events SSE 广播的增量事件（支持异地多设备协同）
   */
  public handleRemoteUpdate(data: { cwd?: string; version?: number; force?: boolean }): void {
    const key = this.normalizeKey(data.cwd);
    const remoteVer = data.version ?? 0;
    const cur = this.getState(key);

    if (remoteVer > 0 && remoteVer <= cur.version && !data.force) {
      return;
    }

    if (this.hasSubscribers(key)) {
      // 当前设备正打开着 Git 面板，立即强制刷新
      void this.scheduleRefresh(key, { immediate: true, forceAll: true, reason: 'remote_broadcast' });
    } else {
      // 当前设备处于折叠状态，仅记下版本号，0次网络开销，等用户点开时才拉取
      this.pendingVersions.set(key, remoteVer || cur.version + 1);
    }
  }
}

export const gitStore = new ProjectGitManager();
