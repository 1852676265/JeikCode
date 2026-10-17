import { useState, useEffect, useRef, useMemo, useCallback } from 'preact/hooks';
import { useT, useSettings } from '../settings';
import { fetchFsRead } from '../api';
import { Markdown } from './Markdown';
import { showToast } from './Toast';

export interface PreviewTab {
  id: string;
  filePath: string;
  fileName: string;
  fileStatus?: string;
}

export interface PreviewPanelProps {
  cwd?: string;
  onOpenInMainEditor?: (filePath: string) => void;
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp']);

function normalizeToAbsolute(filePath: string, cwd?: string): string {
  let p = (filePath || '').trim().replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(p) || p.startsWith('/')) {
    return p;
  }
  const base = (cwd || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
  return base ? `${base}/${p.replace(/^\.?\/+/, '')}` : p;
}

export function PreviewPanel({ cwd, onOpenInMainEditor }: PreviewPanelProps) {
  const t = useT();
  const { theme } = useSettings();
  const isDark =
    theme === 'dark' ||
    (theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches) ||
    (typeof document !== 'undefined' && document.documentElement.dataset.theme !== 'light');

  const normCwd = useMemo(() => (cwd || 'default').replace(/\\/g, '/').toLowerCase(), [cwd]);
  const storageKeyTabs = `jeikcode:right_preview_tabs:${normCwd}`;
  const storageKeyActive = `jeikcode:right_preview_active_tab:${normCwd}`;

  const [tabs, setTabs] = useState<PreviewTab[]>(() => {
    try {
      const saved = localStorage.getItem(storageKeyTabs);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [];
  });

  const [activeTabId, setActiveTabId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(storageKeyActive);
      if (saved) return saved;
    } catch {}
    return '';
  });

  // 当项目/工作目录切换时，自动同步对应项目的独立预览标签列表，彻底杜绝跨项目同名文件混淆
  useEffect(() => {
    try {
      const savedTabs = localStorage.getItem(storageKeyTabs);
      const parsedTabs = savedTabs ? JSON.parse(savedTabs) : [];
      setTabs(Array.isArray(parsedTabs) ? parsedTabs : []);

      const savedActive = localStorage.getItem(storageKeyActive) || '';
      setActiveTabId(savedActive);
    } catch {
      setTabs([]);
      setActiveTabId('');
    }
  }, [storageKeyTabs, storageKeyActive]);

  // 持久化保存当前项目的标签与当前激活项
  useEffect(() => {
    try {
      localStorage.setItem(storageKeyTabs, JSON.stringify(tabs));
    } catch {}
  }, [tabs, storageKeyTabs]);

  useEffect(() => {
    try {
      if (activeTabId) {
        localStorage.setItem(storageKeyActive, activeTabId);
      }
    } catch {}
  }, [activeTabId, storageKeyActive]);

  // 保证 activeTabId 在 tabs 变化时有效
  useEffect(() => {
    if (tabs.length === 0) {
      if (activeTabId) setActiveTabId('');
    } else if (!tabs.some((t) => t.id === activeTabId)) {
      setActiveTabId(tabs[tabs.length - 1]!.id);
    }
  }, [tabs, activeTabId]);

  const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId), [tabs, activeTabId]);

  // 预览文件内容状态
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  const activeExt = useMemo(() => {
    if (!activeTab) return '';
    return (activeTab.filePath.split('.').pop() || '').toLowerCase();
  }, [activeTab]);

  const isImage = useMemo(() => IMAGE_EXTS.has(activeExt), [activeExt]);
  const isMarkdown = useMemo(
    () => activeExt === 'md' || activeExt === 'markdown' || activeExt === 'mdx',
    [activeExt],
  );

  // 加载当前文件内容
  useEffect(() => {
    if (!activeTab || isImage) {
      setContent('');
      setLoading(false);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    fetchFsRead(activeTab.filePath, cwd)
      .then((res) => {
        if (cancelled) return;
        if (res.success) {
          setContent(res.content || '');
        } else {
          setLoadError(t('common.loadError') || '读取文件失败');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err?.message || String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab?.filePath, refreshTrigger, isImage]);

  // 打开或追加一个标签页
  const openTab = useCallback((info: { filePath: string; fileName?: string; fileStatus?: string }, insertIndex?: number) => {
    const rawPath = info.filePath;
    const absPath = normalizeToAbsolute(rawPath, cwd);
    const fileName = info.fileName || absPath.split(/[\\/]/).pop() || absPath;
    const tabId = `preview_${absPath}`;

    setTabs((prev) => {
      const existingIdx = prev.findIndex((t) => t.id === tabId || t.filePath === absPath);
      if (existingIdx !== -1) {
        // 如果已经存在，并且指定了新插入位置，则移动到该位置
        if (insertIndex !== undefined && insertIndex !== existingIdx) {
          const next = [...prev];
          const [item] = next.splice(existingIdx, 1);
          const targetSlot = insertIndex > existingIdx ? insertIndex - 1 : insertIndex;
          next.splice(targetSlot, 0, item);
          return next;
        }
        return prev;
      }
      const newTab: PreviewTab = {
        id: tabId,
        filePath: absPath,
        fileName,
        fileStatus: info.fileStatus || (fileName.split('.').pop() || 'FILE').slice(0, 3).toUpperCase(),
      };
      if (insertIndex !== undefined && insertIndex >= 0 && insertIndex <= prev.length) {
        const next = [...prev];
        next.splice(insertIndex, 0, newTab);
        return next;
      }
      return [...prev, newTab];
    });

    setActiveTabId(tabId);
  }, [cwd]);

  // 监听全局打开预览事件
  useEffect(() => {
    const handleOpenFileEvent = (e: CustomEvent<{ filePath: string; fileName?: string; fileStatus?: string }>) => {
      if (e.detail?.filePath) {
        openTab(e.detail);
      }
    };
    window.addEventListener('jeikcode:preview:open_file', handleOpenFileEvent as EventListener);
    return () => {
      window.removeEventListener('jeikcode:preview:open_file', handleOpenFileEvent as EventListener);
    };
  }, [openTab]);

  // 关闭标签
  const handleCloseTab = (tabId: string, e?: MouseEvent) => {
    e?.stopPropagation();
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (activeTabId === tabId) {
        if (next.length > 0) {
          setActiveTabId(next[next.length - 1]!.id);
        } else {
          setActiveTabId('');
        }
      }
      return next;
    });
  };

  // 清空所有标签
  const handleClearAll = () => {
    setTabs([]);
    setActiveTabId('');
  };

  // 标签栏横向滚动容器 Ref
  const tabsScrollRef = useRef<HTMLDivElement>(null);

  // 激活标签平滑滚动居中
  useEffect(() => {
    if (!tabsScrollRef.current || !activeTabId) return;
    const el = tabsScrollRef.current.querySelector('.preview-tab-item.active') as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [activeTabId]);

  // 拖拽排序状态（像浏览器标签一样在内部重排，或接收外部标签拖入）
  const [draggedTabIndex, setDraggedTabIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isDropTargetBar, setIsDropTargetBar] = useState(false);

  const handleTabDragStart = (index: number, e: DragEvent) => {
    setDraggedTabIndex(index);
    const tab = tabs[index];
    if (tab && e.dataTransfer) {
      e.dataTransfer.setData('application/jeikcode-tab', JSON.stringify(tab));
      e.dataTransfer.setData('application/jeikcode-preview-index', String(index));
      e.dataTransfer.effectAllowed = 'move';
      (window as any).__jeikcode_dragged_tab = tab;
    }
  };

  const handleTabDragOver = (index: number, e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = draggedTabIndex !== null ? 'move' : 'copy';
    }
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleTabDrop = (targetIndex: number, e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverIndex(null);
    setIsDropTargetBar(false);

    // 1. 如果是右侧内部标签排序
    const internalIndexStr = e.dataTransfer?.getData('application/jeikcode-preview-index');
    if (internalIndexStr !== undefined && internalIndexStr !== '') {
      const fromIndex = parseInt(internalIndexStr, 10);
      if (!Number.isNaN(fromIndex) && fromIndex !== targetIndex) {
        setTabs((prev) => {
          const next = [...prev];
          const [moved] = next.splice(fromIndex, 1);
          if (moved) {
            next.splice(targetIndex, 0, moved);
          }
          return next;
        });
        setDraggedTabIndex(null);
        return;
      }
    }

    // 2. 如果是从外部（如主标签栏）拖入到该标签位置
    try {
      const raw = e.dataTransfer?.getData('application/jeikcode-tab');
      const data = raw ? JSON.parse(raw) : (window as any).__jeikcode_dragged_tab;
      if (data?.filePath) {
        openTab(data, targetIndex);
      }
    } catch {}
    setDraggedTabIndex(null);
  };

  const handleBarDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = draggedTabIndex !== null ? 'move' : 'copy';
    }
    setIsDropTargetBar(true);
  };

  const handleBarDragLeave = (e: DragEvent) => {
    if (!tabsScrollRef.current?.contains(e.relatedTarget as Node)) {
      setIsDropTargetBar(false);
      setDragOverIndex(null);
    }
  };

  const handleBarDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDropTargetBar(false);
    setDragOverIndex(null);

    // 如果内部标签拖到了标签栏末尾空白处
    if (draggedTabIndex !== null) {
      setTabs((prev) => {
        const next = [...prev];
        const [moved] = next.splice(draggedTabIndex, 1);
        if (moved) next.push(moved);
        return next;
      });
      setDraggedTabIndex(null);
      return;
    }

    // 外部标签拖到空白处，追加到末尾
    try {
      const raw = e.dataTransfer?.getData('application/jeikcode-tab');
      const data = raw ? JSON.parse(raw) : (window as any).__jeikcode_dragged_tab;
      if (data?.filePath) {
        openTab(data);
      }
    } catch {}
  };

  // 获取文件图标或徽章
  const getTabIcon = (filePath: string) => {
    const ext = (filePath.split('.').pop() || '').toLowerCase();
    if (IMAGE_EXTS.has(ext)) return '🖼️';
    if (ext === 'md' || ext === 'markdown') return '📖';
    if (ext === 'rs') return '🦀';
    if (ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'jsx') return '⚡';
    if (ext === 'json' || ext === 'toml' || ext === 'yaml' || ext === 'yml') return '⚙️';
    if (ext === 'sh' || ext === 'bash' || ext === 'ps1') return '🐚';
    return '📄';
  };

  return (
    <div
      class="preview-panel-root"
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        e.preventDefault();
        try {
          const raw = e.dataTransfer?.getData('application/jeikcode-tab');
          const data = raw ? JSON.parse(raw) : (window as any).__jeikcode_dragged_tab;
          const targetPath = data?.filePath || e.dataTransfer?.getData('text/plain');
          if (targetPath) {
            openTab(typeof data === 'object' && data?.filePath ? data : { filePath: targetPath });
          }
        } catch {}
      }}
    >
      {/* 顶部多文件标签栏 (与终端多标签结构和样式高度一致) */}
      <div class="preview-tabs-bar">
        <div
          ref={tabsScrollRef}
          class={'preview-tabs-scroll' + (isDropTargetBar ? ' is-drag-over-bar' : '')}
          onWheel={(e) => {
            if (e.deltaY !== 0) {
              e.currentTarget.scrollLeft += e.deltaY;
            }
          }}
          onDragOver={handleBarDragOver}
          onDragLeave={handleBarDragLeave}
          onDrop={handleBarDrop}
        >
          {tabs.map((tab, idx) => {
            const isActive = tab.id === activeTabId;
            const isDragOver = dragOverIndex === idx;
            const isDragging = draggedTabIndex === idx;

            return (
              <div
                key={tab.id}
                class={
                  'preview-tab-item' +
                  (isActive ? ' active' : '') +
                  (isDragOver ? ' is-drag-over' : '') +
                  (isDragging ? ' is-dragging' : '')
                }
                draggable={true}
                onClick={() => setActiveTabId(tab.id)}
                onDblClick={(e) => {
                  e.stopPropagation();
                  handleCloseTab(tab.id, e as unknown as MouseEvent);
                }}
                onDragStart={(e) => handleTabDragStart(idx, e as unknown as DragEvent)}
                onDragOver={(e) => handleTabDragOver(idx, e as unknown as DragEvent)}
                onDrop={(e) => handleTabDrop(idx, e as unknown as DragEvent)}
                onDragEnd={() => {
                  setDraggedTabIndex(null);
                  setDragOverIndex(null);
                }}
                title={tab.filePath}
              >
                <span class="preview-tab-icon">{getTabIcon(tab.filePath)}</span>
                <span class="preview-tab-name">{tab.fileName}</span>
                <button
                  type="button"
                  class="preview-tab-close"
                  onClick={(e) => handleCloseTab(tab.id, e as unknown as MouseEvent)}
                  title={t('preview.closeTab') || '关闭标签'}
                  aria-label="Close tab"
                >
                  ×
                </button>
              </div>
            );
          })}

          {tabs.length === 0 && (
            <div class="preview-tabs-empty-hint">
              <span>{t('preview.dropHint') || '按住顶部标签拖至此处预览'}</span>
            </div>
          )}
        </div>

        {/* 顶部右侧快捷工具按钮 */}
        <div class="preview-bar-actions">
          {activeTab && (
            <button
              type="button"
              class="preview-action-btn"
              onClick={() => {
                setRefreshTrigger((n) => n + 1);
                showToast(t('preview.refresh') || '已刷新预览', 'info');
              }}
              title={t('preview.refresh') || '刷新预览'}
              aria-label="Refresh"
            >
              🔄
            </button>
          )}

          {activeTab && onOpenInMainEditor && (
            <button
              type="button"
              class="preview-action-btn"
              onClick={() => onOpenInMainEditor(activeTab.filePath)}
              title={t('preview.openInEditor') || '在主编辑区打开'}
              aria-label="Open in main editor"
            >
              📑
            </button>
          )}

          {tabs.length > 0 && (
            <button
              type="button"
              class="preview-action-btn preview-clear-btn"
              onClick={handleClearAll}
              title={t('preview.clearAll') || '清空全部预览'}
              aria-label="Clear all"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 主体预览舞台 (与文件预览区共用同一套高保真渲染引擎) */}
      <div
        class="preview-viewport-stage"
        onDragOver={(e) => {
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(e) => {
          e.preventDefault();
          try {
            const raw = e.dataTransfer?.getData('application/jeikcode-tab');
            const data = raw ? JSON.parse(raw) : (window as any).__jeikcode_dragged_tab;
            if (data?.filePath) {
              openTab(data);
            }
          } catch {}
        }}
      >
        {tabs.length === 0 ? (
          <div class="preview-empty-stage">
            <div class="preview-empty-box">
              <div class="preview-empty-icon">👁️</div>
              <div class="preview-empty-title">
                {t('preview.emptyTitle') || '右侧预览面板已就绪'}
              </div>
              <div class="preview-empty-desc">
                {t('preview.emptyDesc') || '按住顶部文件标签拖拽至此处或眼睛图标，边与 AI 交流边对照查阅文档与代码'}
              </div>
            </div>
          </div>
        ) : loading ? (
          <div class="preview-loading-stage">
            <div class="git-spinner" />
            <span>{t('git.loading') || '加载中...'}</span>
          </div>
        ) : loadError ? (
          <div class="preview-error-stage">
            <div class="preview-error-icon">⚠️</div>
            <div class="preview-error-text">{loadError}</div>
            <button
              type="button"
              class="preview-retry-btn"
              onClick={() => setRefreshTrigger((n) => n + 1)}
            >
              {t('common.retry') || '重试'}
            </button>
          </div>
        ) : isImage ? (
          <div class="preview-image-stage">
            <img
              src={`/fs/raw?path=${encodeURIComponent(activeTab!.filePath)}`}
              alt={activeTab!.fileName}
              class="preview-img-element"
            />
          </div>
        ) : isMarkdown ? (
          <div class="preview-markdown-stage">
            <Markdown content={content} basePath={activeTab!.filePath} targetContext="right" />
          </div>
        ) : (
          <div class="preview-code-stage">
            <Markdown
              content={`\`\`\`${activeExt || 'text'}\n${content}\n\`\`\``}
              basePath={activeTab!.filePath}
              targetContext="right"
            />
          </div>
        )}
      </div>
    </div>
  );
}
