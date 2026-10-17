import { useState, useEffect, useRef, useCallback, useMemo } from 'preact/hooks';
import {
  fetchFsRead,
  fetchFsWrite,
  openFileWithOs,
  revealInFileExplorer,
  getFsRawUrl,
} from '../api';
import { Markdown, highlightHtml } from './Markdown';
import { showToast } from './Toast';
import { highlightCode, formatCodeContent } from '../lib/codeHighlight';
import { changeEditorFontSize } from '../lib/pageZoom';
import { getCachedFileContent, saveCachedFileContent } from '../lib/sessionCache';
import { useT } from '../settings';

export interface CodeEditorTabProps {
  filePath: string;
  onClose?: () => void;
  cwd?: string;
  defaultViewMode?: 'edit' | 'preview';
  onViewModeChange?: (mode: 'edit' | 'preview') => void;
  hideHeaderToolbar?: boolean;
  startLine?: number;
  endLine?: number;
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif']);
const ARCHIVE_EXTS = new Set(['zip', 'tar', 'gz', 'tgz', '7z', 'rar', 'bz2', 'xz', 'iso']);
const BINARY_EXTS = new Set([
  'exe', 'dll', 'so', 'dylib', 'bin', 'pdf', 'wasm',
  'mp3', 'wav', 'ogg', 'flac', 'aac',
  'mp4', 'webm', 'mkv', 'avi', 'mov',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
]);

export function CodeEditorTab({
  filePath,
  onClose,
  cwd,
  defaultViewMode,
  onViewModeChange,
  hideHeaderToolbar = false,
  startLine,
  endLine,
}: CodeEditorTabProps) {
  const t = useT();
  const ext = useMemo(() => (filePath.split('.').pop() || '').toLowerCase(), [filePath]);
  const isImage = useMemo(() => IMAGE_EXTS.has(ext), [ext]);
  const isArchive = useMemo(() => ARCHIVE_EXTS.has(ext), [ext]);
  const isBinary = useMemo(() => isArchive || BINARY_EXTS.has(ext), [ext, isArchive]);
  const isSvg = ext === 'svg';

  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(!isImage && !isBinary);
  const [saving, setSaving] = useState<boolean>(false);
  const [isDirty, setIsDirty] = useState<boolean>(false);

  // 跨行完备 Undo / Redo 历史快照栈 (彻底解决原生 textarea 跨行回车后无法撤回的痛点)
  const historyRef = useRef<Array<{ text: string; cursor: number }>>([]);
  const historyIndexRef = useRef<number>(-1);
  const isUndoRedoActionRef = useRef<boolean>(false);
  const inputDebounceTimerRef = useRef<number | null>(null);

  const pushSnapshot = useCallback((newText: string, cursor: number) => {
    if (isUndoRedoActionRef.current) return;
    const history = historyRef.current;
    const curIdx = historyIndexRef.current;
    if (curIdx >= 0 && history[curIdx]?.text === newText) {
      history[curIdx].cursor = cursor;
      return;
    }
    const nextHistory = history.slice(0, curIdx + 1);
    nextHistory.push({ text: newText, cursor });
    if (nextHistory.length > 500) {
      nextHistory.shift();
    }
    historyRef.current = nextHistory;
    historyIndexRef.current = nextHistory.length - 1;
  }, []);

  const undo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      isUndoRedoActionRef.current = true;
      historyIndexRef.current--;
      const snapshot = historyRef.current[historyIndexRef.current];
      if (snapshot) {
        setContent(snapshot.text);
        setIsDirty(true);
        window.requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.setSelectionRange(snapshot.cursor, snapshot.cursor);
          }
          isUndoRedoActionRef.current = false;
        });
      }
    }
  }, []);

  const redo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      isUndoRedoActionRef.current = true;
      historyIndexRef.current++;
      const snapshot = historyRef.current[historyIndexRef.current];
      if (snapshot) {
        setContent(snapshot.text);
        setIsDirty(true);
        window.requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.setSelectionRange(snapshot.cursor, snapshot.cursor);
          }
          isUndoRedoActionRef.current = false;
        });
      }
    }
  }, []);

  // 模式：'edit' (源码编辑) | 'preview' (Markdown深度渲染) | 'image' (图片自适应预览) | 'binary' (二进制引导卡片)
  const isMarkdown = useMemo(() => {
    return /\.md$/i.test(filePath) || /\.markdown$/i.test(filePath);
  }, [filePath]);

  const [viewMode, setViewModeState] = useState<'edit' | 'preview' | 'image' | 'binary'>(() => {
    if (isImage && !isSvg) return 'image';
    if (isSvg) return 'image';
    if (isBinary) return 'binary';
    return defaultViewMode || (isMarkdown ? 'preview' : 'edit');
  });

  // 图片预览与缩放状态
  const [imgScale, setImgScale] = useState<number>(1.0);
  const [imgDimensions, setImgDimensions] = useState<{ w: number; h: number } | null>(null);

  const setViewMode = useCallback(
    (updater: 'edit' | 'preview' | 'image' | 'binary' | ((prev: 'edit' | 'preview' | 'image' | 'binary') => 'edit' | 'preview' | 'image' | 'binary')) => {
      setViewModeState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        if (next === 'edit' || next === 'preview') {
          onViewModeChange?.(next);
        }
        return next;
      });
    },
    [onViewModeChange],
  );

  // 当 filePath 切换时，重置视图模式与图片缩放，优先使用外部传入的 defaultViewMode
  useEffect(() => {
    if (isImage && !isSvg) setViewModeState('image');
    else if (isSvg) setViewModeState('image');
    else if (isBinary) setViewModeState('binary');
    else if (defaultViewMode) {
      setViewModeState(defaultViewMode);
      onViewModeChange?.(defaultViewMode);
    } else if (isMarkdown) {
      setViewModeState('preview');
      onViewModeChange?.('preview');
    } else {
      setViewModeState('edit');
      onViewModeChange?.('edit');
    }
    setImgScale(1.0);
    setImgDimensions(null);
  }, [filePath, isImage, isSvg, isBinary, isMarkdown, defaultViewMode, onViewModeChange]);

  // 监听外部触发的视图切换广播 (例如右侧面板顶栏铅笔图标点击)
  useEffect(() => {
    const handleToggle = () => {
      const next = viewMode === 'edit' ? 'preview' : 'edit';
      setViewMode(next);
      showToast(next === 'preview' ? t('editor.switchToPreview') : t('editor.switchToEdit'), 'info');
    };
    window.addEventListener(`jeikcode:editor:toggle_mode:${filePath}`, handleToggle);
    return () => {
      window.removeEventListener(`jeikcode:editor:toggle_mode:${filePath}`, handleToggle);
    };
  }, [viewMode, filePath, setViewMode]);

  // 图片预览模式下 Ctrl + 鼠标滚轮缩放图片
  const handleImageWheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      setImgScale((s) => Math.max(0.1, Math.min(10.0, Math.round((s + delta) * 100) / 100)));
    }
  };

  // 搜索替换栏状态 (Ctrl+F, Ctrl+H)
  const [findOpen, setFindOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [currentMatchIdx, setCurrentMatchIdx] = useState<number>(0);
  const [previewMatchCount, setPreviewMatchCount] = useState<number>(0);
  const findInputRef = useRef<HTMLInputElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);

  // 计算所有匹配项的起始索引
  const matchIndices = useMemo(() => {
    if (!findText) return [];
    const indices: number[] = [];
    const query = findText.toLowerCase();
    const haystack = content.toLowerCase();
    let pos = 0;
    while ((pos = haystack.indexOf(query, pos)) !== -1) {
      indices.push(pos);
      pos += Math.max(1, query.length);
    }
    return indices;
  }, [content, findText]);

  // 跳转到指定序号的匹配项并在 textarea 或预览 Markdown 中选中与滚动定位
  const jumpToMatch = useCallback(
    (idx: number) => {
      const total = viewMode === 'preview' ? previewMatchCount : matchIndices.length;
      if (total === 0) return;
      const safeIdx = (idx + total) % total;
      setCurrentMatchIdx(safeIdx);

      if (viewMode === 'preview') {
        const container = previewContainerRef.current;
        if (container) {
          const marks = container.querySelectorAll<HTMLElement>('.msg-search-highlight');
          marks.forEach((m, i) => {
            if (i === safeIdx) {
              m.classList.add('is-current-match');
              m.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
              m.classList.remove('is-current-match');
            }
          });
        }
        return;
      }

      if (!textareaRef.current) return;
      const targetPos = matchIndices[safeIdx];
      if (targetPos === undefined) return;
      const ta = textareaRef.current;
      // 保持焦点在搜索框中，防止用户按回车切换时误将选中文本删除覆盖！
      findInputRef.current?.focus();

      const textBefore = content.slice(0, targetPos);
      const lineNo = textBefore.split('\n').length - 1;
      const lineHeight = 20;
      const targetScroll = Math.max(0, lineNo * lineHeight - 60);
      ta.scrollTop = targetScroll;
      if (preRef.current) preRef.current.scrollTop = targetScroll;
      if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = targetScroll;
    },
    [matchIndices, findText, content, viewMode, previewMatchCount]
  );

  const handleFindNext = useCallback(() => {
    jumpToMatch(currentMatchIdx + 1);
  }, [jumpToMatch, currentMatchIdx]);

  const handleFindPrev = useCallback(() => {
    jumpToMatch(currentMatchIdx - 1);
  }, [jumpToMatch, currentMatchIdx]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const fileName = useMemo(() => filePath.split(/[\\/]/).pop() || filePath, [filePath]);

  // 语法高亮分词 HTML (与 Markdown 预览模式共享黄色搜索高亮与当前项聚焦高亮！)
  const highlightedHtml = useMemo(() => {
    const codeHtml = highlightCode(content, filePath);
    if (findOpen && findText.trim()) {
      return highlightHtml(codeHtml, findText, currentMatchIdx).html;
    }
    return codeHtml;
  }, [content, filePath, findOpen, findText, currentMatchIdx]);

  // 一键格式化代码 (支持 JSON/JSONC、JS/TS/Rust 等标准化美化)
  const handleFormat = useCallback(() => {
    const formatted = formatCodeContent(content, filePath);
    if (formatted !== content) {
      setContent(formatted);
      setIsDirty(true);
      pushSnapshot(formatted, 0);
      showToast(t('editor.formatted'), 'success');
    } else {
      showToast(t('editor.alreadyFormatted'), 'info');
    }
  }, [content, filePath, t]);

  const handleScroll = (e: Event) => {
    const ta = e.target as HTMLTextAreaElement;
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop;
      preRef.current.scrollLeft = ta.scrollLeft;
    }
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = ta.scrollTop;
    }
  };

  // 独立的编辑器/文件预览字号滚轮缩放 (全局共享，不影响主画布)
  const handleEditorWheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 1 : -1;
      changeEditorFontSize(delta);
    }
  };

  // 现代代码编辑器键盘增强：全局撤销重做、智能回车缩进、成对括号展开、Tab/Shift+Tab 缩进与智能退格
  const handleTextareaKeyDown = (e: KeyboardEvent) => {
    const ta = textareaRef.current;
    if (!ta) return;

    // 0. 全局撤销 (Ctrl+Z / Cmd+Z) 与 重做 (Ctrl+Y / Ctrl+Shift+Z / Cmd+Shift+Z)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) {
        redo();
      } else {
        undo();
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      e.stopPropagation();
      redo();
      return;
    }

    // 1. Enter 键智能缩进
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = ta.value;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;

      // 在跨行前如果尚未推入快照，先锁定当前行状态
      pushSnapshot(val, start);

      // 获取当前行文本与当前缩进
      const lastNewline = val.lastIndexOf('\n', start - 1);
      const currentLine = val.slice(lastNewline + 1, start);
      const indent = currentLine.match(/^\s*/)?.[0] || '';

      // 检查光标前一个字符与后一个字符
      const trimmedBefore = currentLine.trimEnd();
      const lastChar = trimmedBefore[trimmedBefore.length - 1];
      const nextChar = val[start];

      // 判断是否需要增加一级缩进 (遇到 { 或 [ 或 ( 或 :)
      const shouldIncreaseIndent = lastChar === '{' || lastChar === '[' || lastChar === '(' || lastChar === ':';
      const isBracketPair =
        (lastChar === '{' && nextChar === '}') ||
        (lastChar === '[' && nextChar === ']') ||
        (lastChar === '(' && nextChar === ')');

      if (isBracketPair) {
        // 成对大/中括号中间回车：展开为 3 行，光标停在中间行缩进位置
        const innerIndent = indent + '  ';
        const inserted = `\n${innerIndent}\n${indent}`;
        const nextVal = val.slice(0, start) + inserted + val.slice(end);
        setContent(nextVal);
        setIsDirty(true);
        const cursorPosition = start + 1 + innerIndent.length;
        pushSnapshot(nextVal, cursorPosition);
        window.requestAnimationFrame(() => {
          ta.setSelectionRange(cursorPosition, cursorPosition);
        });
        return;
      }

      const extraIndent = shouldIncreaseIndent ? '  ' : '';
      const inserted = `\n${indent}${extraIndent}`;
      const nextVal = val.slice(0, start) + inserted + val.slice(end);
      setContent(nextVal);
      setIsDirty(true);
      const cursorPosition = start + inserted.length;
      pushSnapshot(nextVal, cursorPosition);
      window.requestAnimationFrame(() => {
        ta.setSelectionRange(cursorPosition, cursorPosition);
      });
      return;
    }

    // 2. Tab 键缩进 (支持单点插入与 Shift+Tab 反向减少缩进)
    if (e.key === 'Tab') {
      e.preventDefault();
      const val = ta.value;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;

      pushSnapshot(val, start);

      if (!e.shiftKey) {
        // Tab 正向缩进 2 空格
        if (start === end) {
          const nextVal = val.slice(0, start) + '  ' + val.slice(end);
          setContent(nextVal);
          setIsDirty(true);
          const cursorPosition = start + 2;
          pushSnapshot(nextVal, cursorPosition);
          window.requestAnimationFrame(() => {
            ta.setSelectionRange(cursorPosition, cursorPosition);
          });
        } else {
          // 多行选区：每行首加 2 空格
          const lineStart = val.lastIndexOf('\n', start - 1) + 1;
          const selectedBlock = val.slice(lineStart, end);
          const indentedBlock = selectedBlock.split('\n').map((l) => '  ' + l).join('\n');
          const nextVal = val.slice(0, lineStart) + indentedBlock + val.slice(end);
          setContent(nextVal);
          setIsDirty(true);
          const nextCursor = end + (indentedBlock.length - selectedBlock.length);
          pushSnapshot(nextVal, nextCursor);
          window.requestAnimationFrame(() => {
            ta.setSelectionRange(start + 2, nextCursor);
          });
        }
      } else {
        // Shift+Tab 反向缩进
        const lineStart = val.lastIndexOf('\n', start - 1) + 1;
        const selectedBlock = val.slice(lineStart, end);
        const unindentedBlock = selectedBlock
          .split('\n')
          .map((l) => (l.startsWith('  ') ? l.slice(2) : l.startsWith(' ') ? l.slice(1) : l))
          .join('\n');
        const nextVal = val.slice(0, lineStart) + unindentedBlock + val.slice(end);
        setContent(nextVal);
        setIsDirty(true);
        const nextCursor = Math.max(lineStart, end - (selectedBlock.length - unindentedBlock.length));
        pushSnapshot(nextVal, nextCursor);
        window.requestAnimationFrame(() => {
          ta.setSelectionRange(
            Math.max(lineStart, start - 2),
            nextCursor,
          );
        });
      }
      return;
    }

    // 3. 智能退格 (Backspace：若光标前是 2 个空格且行首全为空格，一次删除 2 空格)
    if (e.key === 'Backspace') {
      const val = ta.value;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      if (start === end && start >= 2) {
        const lastNewline = val.lastIndexOf('\n', start - 1);
        const beforeCursor = val.slice(lastNewline + 1, start);
        if (/^\s+$/.test(beforeCursor) && beforeCursor.endsWith('  ')) {
          e.preventDefault();
          pushSnapshot(val, start);
          const nextVal = val.slice(0, start - 2) + val.slice(end);
          setContent(nextVal);
          setIsDirty(true);
          const cursorPosition = start - 2;
          pushSnapshot(nextVal, cursorPosition);
          window.requestAnimationFrame(() => {
            ta.setSelectionRange(cursorPosition, cursorPosition);
          });
        }
      }
    }
  };

  // 读取文件内容 (非文本类文件直接跳过文本读取，进入图片/二进制视图)
  useEffect(() => {
    let cancelled = false;
    if ((isImage && !isSvg) || isBinary) {
      setLoading(false);
      return;
    }

    // 优先从 L1/L2 IndexedDB 异步直出已缓存内容（1~2ms），杜绝白屏等待与加载中闪烁
    void getCachedFileContent(filePath).then((cached) => {
      if (!cancelled && cached !== null) {
        setContent(cached);
        historyRef.current = [{ text: cached, cursor: 0 }];
        historyIndexRef.current = 0;
        setLoading(false);
      }
    });

    setLoading(true);
    fetchFsRead(filePath, cwd)
      .then((res) => {
        if (!cancelled) {
          const loaded = res.content || '';
          setContent(loaded);
          historyRef.current = [{ text: loaded, cursor: 0 }];
          historyIndexRef.current = 0;
          setIsDirty(false);
          void saveCachedFileContent(filePath, loaded);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          showToast(t('editor.readFailed', { error: err?.message || String(err) }), 'error');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, isImage, isSvg, isBinary]);

  // 保存文件
  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      await fetchFsWrite(filePath, content);
      setIsDirty(false);
      void saveCachedFileContent(filePath, content);
      showToast(t('editor.saveSuccess', { name: fileName }), 'success');
    } catch (err: any) {
      showToast(t('editor.saveFailed', { error: err?.message || String(err) }), 'error');
    } finally {
      setSaving(false);
    }
  }, [filePath, content, saving, fileName]);

  // 快捷键监听：Ctrl+S (保存), Ctrl+F (查找), Ctrl+H (替换), Ctrl+Shift+V (MD切换)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !e.shiftKey) {
        e.preventDefault();
        void handleSave();
        return;
      }
      // Ctrl+Alt+L (格式化代码)
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        handleFormat();
        return;
      }
      // Ctrl+Shift+V (切换预览/代码编辑模式，对齐主面板与右侧面板)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        const next = viewMode === 'edit' ? 'preview' : 'edit';
        setViewMode(next);
        showToast(next === 'preview' ? t('editor.switchToPreview') : t('editor.switchToEdit'), 'info');
        return;
      }
      // Ctrl+F
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !e.shiftKey) {
        const target = e.target as HTMLElement | null;
        if (target && target.closest('.file-explorer-root, .chat-messages-scroll, .terminal-panel-root, .xterm')) return;
        e.preventDefault();
        e.stopPropagation();
        setFindOpen(true);
        setReplaceOpen(false);
        setTimeout(() => findInputRef.current?.focus(), 50);
        return;
      }
      // Ctrl+H
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
        const target = e.target as HTMLElement | null;
        if (target && target.closest('.file-explorer-root, .chat-messages-scroll, .terminal-panel-root, .xterm')) return;
        e.preventDefault();
        e.stopPropagation();
        setFindOpen(true);
        setReplaceOpen(true);
        return;
      }
      // Escape
      if (e.key === 'Escape' && findOpen) {
        setFindOpen(false);
        setReplaceOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSave, isMarkdown, viewMode, findOpen]);

  // 执行替换
  const handleReplaceOne = () => {
    if (!findText) return;
    const idx = content.indexOf(findText);
    if (idx === -1) {
      showToast(t('editor.noMatch'), 'info');
      return;
    }
    const next = content.slice(0, idx) + replaceText + content.slice(idx + findText.length);
    setContent(next);
    setIsDirty(true);
  };

  const handleReplaceAll = () => {
    if (!findText) return;
    const parts = content.split(findText);
    if (parts.length <= 1) {
      showToast(t('editor.noMatch'), 'info');
      return;
    }
    const next = parts.join(replaceText);
    setContent(next);
    setIsDirty(true);
    showToast(t('editor.replaceAllSuccess', { n: String(parts.length - 1) }), 'success');
  };

  // 计算行号范围高亮带 (支持单行号及多行范围)
  const targetLineBand = useMemo(() => {
    if (!startLine || startLine <= 0 || !content) return null;
    const lines = content.split('\n');
    const start = Math.min(lines.length, startLine);
    const end = endLine && endLine >= start ? Math.min(lines.length, endLine) : start;
    const lineCount = end - start + 1;
    return {
      top: `${(start - 1) * 20 + 8}px`,
      height: `${lineCount * 20}px`,
    };
  }, [startLine, endLine, content]);

  // 平滑滚动并高亮选中目标行号范围
  const scrollToTargetLine = useCallback(
    (targetStart?: number, targetEnd?: number) => {
      if (!targetStart || targetStart <= 0 || !content) return;
      const lines = content.split('\n');
      const startIdx = Math.min(lines.length, Math.max(1, targetStart));
      const endIdx = targetEnd && targetEnd >= startIdx ? Math.min(lines.length, targetEnd) : startIdx;

      let charStart = 0;
      for (let i = 0; i < startIdx - 1; i++) {
        charStart += lines[i].length + 1;
      }
      let charEnd = charStart;
      for (let i = startIdx - 1; i < endIdx; i++) {
        charEnd += lines[i].length + (i < lines.length - 1 ? 1 : 0);
      }

      const ta = textareaRef.current;
      if (ta) {
        try {
          ta.focus();
          ta.setSelectionRange(charStart, charEnd);
        } catch {}
        const totalLines = Math.max(1, lines.length);
        const approxLineHeight = ta.scrollHeight / totalLines || 20;
        const targetScrollTop = Math.max(0, (startIdx - 4) * approxLineHeight);
        ta.scrollTop = targetScrollTop;
        if (preRef.current) preRef.current.scrollTop = targetScrollTop;
        if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = targetScrollTop;
      }

      if (viewMode === 'preview' && previewContainerRef.current) {
        const container = previewContainerRef.current;
        const targetScrollTop = Math.max(0, ((startIdx - 4) / Math.max(1, lines.length)) * container.scrollHeight);
        container.scrollTop = targetScrollTop;
      }
    },
    [content, viewMode],
  );

  useEffect(() => {
    if (startLine && content) {
      requestAnimationFrame(() => {
        scrollToTargetLine(startLine, endLine);
      });
      const t1 = setTimeout(() => {
        scrollToTargetLine(startLine, endLine);
      }, 80);
      const t2 = setTimeout(() => {
        scrollToTargetLine(startLine, endLine);
      }, 240);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [startLine, endLine, content, scrollToTargetLine]);

  // 计算行号列表与行号纯文本（将原本上万个 DOM 节点精简为单个 pre 文本节点，大文件缩放性能提升 100 倍！）
  const lines = useMemo(() => content.split('\n'), [content]);
  const lineNumbersText = useMemo(() => {
    const len = lines.length;
    let res = '';
    for (let i = 1; i <= len; i++) {
      res += i + '\n';
    }
    return res;
  }, [lines.length]);

  const editorRootRef = useRef<HTMLDivElement>(null);

  // 独立的编辑器/文件预览字号滚轮缩放 (在捕获阶段拦截，支持代码编辑模式与 Markdown 预览模式平滑缩放，40ms 防抖杜绝卡顿)
  useEffect(() => {
    const el = editorRootRef.current;
    if (!el) return;
    let zoomTimer: any = null;
    let accum = 0;
    const onWheelCapture = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        accum += e.deltaY < 0 ? 1 : -1;
        if (zoomTimer) clearTimeout(zoomTimer);
        zoomTimer = setTimeout(() => {
          if (accum !== 0) {
            changeEditorFontSize(accum > 0 ? 1 : -1);
            accum = 0;
          }
        }, 40);
      }
    };
    el.addEventListener('wheel', onWheelCapture, { capture: true, passive: false });
    return () => {
      el.removeEventListener('wheel', onWheelCapture, { capture: true } as any);
      if (zoomTimer) clearTimeout(zoomTimer);
    };
  }, []);

  return (
    <div
      class="code-editor-root"
      ref={editorRootRef}
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          const raw = e.dataTransfer?.getData('application/jeikcode-tab');
          const data = raw ? JSON.parse(raw) : (window as any).__jeikcode_dragged_tab;
          const targetPath = data?.filePath || e.dataTransfer?.getData('text/plain');
          if (targetPath) {
            window.dispatchEvent(new CustomEvent('jeikcode:open_file', { detail: { path: targetPath.trim() } }));
          }
        } catch {}
      }}
    >
      {/* 顶部工具栏 */}
      {!hideHeaderToolbar && (
        <div class="code-editor-toolbar">
        <div class="editor-file-info">
          <span class="editor-file-badge">{fileName.split('.').pop()?.toUpperCase() || 'FILE'}</span>
          <span class="editor-file-name">{fileName}</span>
          {isDirty && <span class="editor-dirty-dot" title={t('editor.dirty')}>●</span>}
          <span class="editor-file-path" title={filePath}>{filePath}</span>
        </div>

        <div class="editor-toolbar-actions">
          {/* 图片模式专属控制 */}
          {viewMode === 'image' && (
            <>
              {isSvg && (
                <button
                  type="button"
                  class="editor-tool-btn"
                  onClick={() => setViewMode('edit')}
                  title="切换为 SVG 源码编辑"
                >
                  <span class="editor-btn-icon">✏️</span>
                  <span class="editor-btn-text">源码</span>
                </button>
              )}
              <button
                type="button"
                class="editor-tool-btn"
                onClick={() => setImgScale((s) => Math.max(0.2, s - 0.2))}
                title="缩小图片"
              >
                <span class="editor-btn-icon">➖</span>
              </button>
              <button
                type="button"
                class="editor-tool-btn"
                onClick={() => setImgScale(1.0)}
                title="1:1 原图大小"
              >
                <span class="editor-btn-icon">{`${Math.round(imgScale * 100)}%`}</span>
              </button>
              <button
                type="button"
                class="editor-tool-btn"
                onClick={() => setImgScale((s) => Math.min(5.0, s + 0.2))}
                title="放大图片"
              >
                <span class="editor-btn-icon">➕</span>
              </button>
              <button
                type="button"
                class="editor-tool-btn"
                onClick={() => setImgScale(1.0)}
                title="自适应"
              >
                <span class="editor-btn-icon">⤢</span>
                <span class="editor-btn-text">自适应</span>
              </button>
              <button
                type="button"
                class="editor-tool-btn"
                onClick={async () => {
                  try {
                    await openFileWithOs(filePath);
                    showToast('已调用系统默认应用打开', 'success');
                  } catch (err: any) {
                    showToast(`打开失败: ${err?.message || err}`, 'error');
                  }
                }}
                title="使用系统默认应用打开"
              >
                <span class="editor-btn-icon">🚀</span>
                <span class="editor-btn-text">系统应用</span>
              </button>
              <button
                type="button"
                class="editor-tool-btn"
                onClick={async () => {
                  try {
                    await revealInFileExplorer(filePath);
                    showToast('已在资源管理器中显示', 'success');
                  } catch (err: any) {
                    showToast(`定位失败: ${err?.message || err}`, 'error');
                  }
                }}
                title="在系统资源管理器中定位"
              >
                <span class="editor-btn-icon">📁</span>
                <span class="editor-btn-text">定位文件</span>
              </button>
            </>
          )}

          {/* 二进制模式专属控制 */}
          {viewMode === 'binary' && (
            <>
              <button
                type="button"
                class="editor-tool-btn"
                onClick={async () => {
                  try {
                    await openFileWithOs(filePath);
                    showToast('已调用系统默认应用打开', 'success');
                  } catch (err: any) {
                    showToast(`打开失败: ${err?.message || err}`, 'error');
                  }
                }}
                title="使用系统默认应用打开"
              >
                <span class="editor-btn-icon">🚀</span>
                <span class="editor-btn-text">系统应用</span>
              </button>
              <button
                type="button"
                class="editor-tool-btn"
                onClick={async () => {
                  try {
                    await revealInFileExplorer(filePath);
                    showToast('已在资源管理器中显示', 'success');
                  } catch (err: any) {
                    showToast(`定位失败: ${err?.message || err}`, 'error');
                  }
                }}
                title="在系统资源管理器中定位"
              >
                <span class="editor-btn-icon">📁</span>
                <span class="editor-btn-text">定位文件</span>
              </button>
            </>
          )}

          {/* 代码与文本编辑模式控制 */}
          {(viewMode === 'edit' || viewMode === 'preview') && (
            <>
              {isSvg && (
                <button
                  type="button"
                  class="editor-tool-btn"
                  onClick={() => setViewMode('image')}
                  title="切换为图片预览模式"
                >
                  <span class="editor-btn-icon">🖼️</span>
                  <span class="editor-btn-text">图片预览</span>
                </button>
              )}

              {/* Markdown 双模切换按钮 */}
              {isMarkdown && (
                <button
                  type="button"
                  class={'editor-tool-btn' + (viewMode === 'preview' ? ' active' : '')}
                  onClick={() => setViewMode((m) => (m === 'edit' ? 'preview' : 'edit'))}
                  title={viewMode === 'edit' ? t('editor.preview') : t('editor.source')}
                >
                  <span class="editor-btn-icon">{viewMode === 'edit' ? '📖' : '✏️'}</span>
                  <span class="editor-btn-text">{viewMode === 'edit' ? t('editor.preview') : t('editor.source')}</span>
                </button>
              )}

              <button
                type="button"
                class="editor-tool-btn"
                onClick={handleFormat}
                title={t('editor.format')}
              >
                <span class="editor-btn-icon">🪄</span>
                <span class="editor-btn-text">{t('editor.format')}</span>
              </button>
              <button
                type="button"
                class={'editor-tool-btn' + (findOpen ? ' active' : '')}
                onClick={() => {
                  setFindOpen((v) => !v);
                  if (!findOpen) setReplaceOpen(false);
                }}
                title={t('editor.find')}
              >
                <span class="editor-btn-icon">🔍</span>
                <span class="editor-btn-text">{t('editor.find')}</span>
              </button>
              <button
                type="button"
                class={'editor-tool-btn' + (replaceOpen ? ' active' : '')}
                onClick={() => {
                  setFindOpen(true);
                  setReplaceOpen((v) => !v);
                }}
                title={t('editor.replace')}
              >
                <span class="editor-btn-icon">🔄</span>
                <span class="editor-btn-text">{t('editor.replace')}</span>
              </button>
              <button
                type="button"
                class="editor-save-btn"
                onClick={handleSave}
                disabled={saving || !isDirty}
                title={t('editor.save')}
              >
                <span class="editor-btn-icon">{saving ? '⏳' : isDirty ? '💾' : '✓'}</span>
                <span class="editor-btn-text">{saving ? t('editor.saving') : isDirty ? t('editor.save') : t('editor.saved')}</span>
              </button>
            </>
          )}
        </div>
      </div>
      )}

      {/* 搜索与替换浮动条 (标准上下双行 VS Code 经典排版) */}
      {findOpen && (
        <div class="editor-find-bar">
          <div class="find-row">
            <button
              type="button"
              class="find-toggle-chevron"
              onClick={() => setReplaceOpen((v) => !v)}
              title={replaceOpen ? '收起替换 (Ctrl+H)' : '展开替换 (Ctrl+H)'}
            >
              {replaceOpen ? '▼' : '▶'}
            </button>
            <div class="find-input-wrap">
              <input
                ref={findInputRef}
                type="text"
                class="find-input"
                placeholder={t('editor.find') || '查找'}
                value={findText}
                onInput={(e) => {
                  setFindText((e.target as HTMLInputElement).value);
                  setCurrentMatchIdx(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (e.shiftKey) {
                      handleFindPrev();
                    } else {
                      handleFindNext();
                    }
                  }
                }}
              />
              {findText && (
                <span class="find-count-badge">
                  {(viewMode === 'preview' ? previewMatchCount : matchIndices.length) > 0
                    ? `${currentMatchIdx + 1}/${viewMode === 'preview' ? previewMatchCount : matchIndices.length}`
                    : '0/0'}
                </span>
              )}
            </div>
            <button
              type="button"
              class="find-nav-btn"
              onClick={handleFindPrev}
              disabled={(viewMode === 'preview' ? previewMatchCount : matchIndices.length) === 0}
              title="上一个匹配项 (Shift+Enter)"
            >
              ↑
            </button>
            <button
              type="button"
              class="find-nav-btn"
              onClick={handleFindNext}
              disabled={(viewMode === 'preview' ? previewMatchCount : matchIndices.length) === 0}
              title="下一个匹配项 (Enter)"
            >
              ↓
            </button>
            <button
              type="button"
              class="find-close-btn"
              onClick={() => {
                setFindOpen(false);
                setReplaceOpen(false);
              }}
              title="关闭 (Esc)"
            >
              ✕
            </button>
          </div>

          {/* 第二行：替换行 (展开在搜索框正下方) */}
          {replaceOpen && (
            <div class="replace-row">
              <div class="replace-indent-spacer" />
              <div class="find-input-wrap">
                <input
                  type="text"
                  class="find-input"
                  placeholder={t('editor.replace') || '替换'}
                  value={replaceText}
                  onInput={(e) => setReplaceText((e.target as HTMLInputElement).value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (e.altKey || (e.ctrlKey && e.altKey)) {
                        handleReplaceAll();
                      } else {
                        handleReplaceOne();
                      }
                    }
                  }}
                />
              </div>
              <button
                type="button"
                class="find-action-btn"
                onClick={handleReplaceOne}
                title="替换当前项 (Enter)"
              >
                {t('editor.replace') || '替换'}
              </button>
              <button
                type="button"
                class="find-action-btn"
                onClick={handleReplaceAll}
                title="全部替换 (Ctrl+Alt+Enter)"
              >
                {t('editor.replaceAll') || '全部替换'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* 核心舞台：代码编辑器 或 Markdown 深度渲染 或 图片预览 或 二进制引导卡片 */}
      <div class="code-editor-stage">
        {loading ? (
          <div class="diff-loading-wrap">
            <div class="git-spinner" />
            <span>{t('editor.loading')}</span>
          </div>
        ) : viewMode === 'image' ? (
          <div class="editor-image-stage" onWheel={handleImageWheel}>
            <div class="editor-image-wrapper" style={{ transform: `scale(${imgScale})` }}>
              <img
                src={getFsRawUrl(filePath)}
                alt={fileName}
                class="editor-image-elem"
                onLoad={(e) => {
                  const img = e.currentTarget as HTMLImageElement;
                  setImgDimensions({ w: img.naturalWidth, h: img.naturalHeight });
                }}
              />
            </div>
            {imgDimensions && (
              <div class="editor-image-pill">
                <span>{`${imgDimensions.w} × ${imgDimensions.h} px`}</span>
                <span>•</span>
                <span>{`${Math.round(imgScale * 100)}%`}</span>
              </div>
            )}
          </div>
        ) : viewMode === 'binary' ? (
          <div class="editor-binary-stage">
            <div class="editor-binary-card">
              <div class="editor-binary-icon">
                {isArchive
                  ? '📦'
                  : ext === 'pdf'
                  ? '📕'
                  : ['mp3', 'wav', 'ogg'].includes(ext)
                  ? '🎵'
                  : ['mp4', 'mov', 'webm'].includes(ext)
                  ? '🎬'
                  : '⚙️'}
              </div>
              <div class="editor-binary-title">{fileName}</div>
              <div class="editor-binary-desc">
                {isArchive
                  ? '此压缩包为非文本格式，无法在代码编辑器中直接展示内容。'
                  : '该文件是二进制或非文本格式，无法在文本代码编辑器中直接展示内容。'}
              </div>
              <div class="editor-binary-path">{filePath}</div>
              <div class="editor-binary-actions">
                <button
                  type="button"
                  class="binary-action-primary-btn"
                  onClick={async () => {
                    try {
                      await openFileWithOs(filePath);
                      showToast('已调用系统默认应用打开', 'success');
                    } catch (err: any) {
                      showToast(`打开失败: ${err?.message || err}`, 'error');
                    }
                  }}
                >
                  <span>🚀 用系统默认应用打开</span>
                </button>
                <button
                  type="button"
                  class="binary-action-secondary-btn"
                  onClick={async () => {
                    try {
                      await revealInFileExplorer(filePath);
                      showToast('已在资源管理器中显示', 'success');
                    } catch (err: any) {
                      showToast(`定位失败: ${err?.message || err}`, 'error');
                    }
                  }}
                >
                  <span>📁 在资源管理器中显示</span>
                </button>
              </div>
            </div>
          </div>
        ) : viewMode === 'preview' && isMarkdown ? (
          <div
            class="editor-markdown-preview"
            ref={previewContainerRef}
            onDragOver={(e) => {
              e.preventDefault();
              if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              try {
                const raw = e.dataTransfer?.getData('application/jeikcode-tab');
                const data = raw ? JSON.parse(raw) : (window as any).__jeikcode_dragged_tab;
                const targetPath = data?.filePath || e.dataTransfer?.getData('text/plain');
                if (targetPath) {
                  window.dispatchEvent(new CustomEvent('jeikcode:open_file', { detail: { path: targetPath.trim() } }));
                }
              } catch {}
            }}
          >
            <Markdown
              content={content}
              basePath={filePath}
              search={findOpen ? findText : undefined}
              activeSearchIndex={findOpen ? currentMatchIdx : undefined}
              onMatchCountChange={setPreviewMatchCount}
              targetContext="main"
            />
          </div>
        ) : (
          <div class="editor-code-container">
            {/* 行号侧栏 (单个 pre 极速渲染，大文件缩放与滚动零延迟) */}
            <div class="editor-line-numbers" ref={lineNumbersRef} aria-hidden="true">
              {targetLineBand && (
                <div class="editor-target-gutter-band" style={targetLineBand} aria-hidden="true" />
              )}
              <pre class="line-numbers-pre">{lineNumbersText}</pre>
            </div>
            {/* 代码主体包装器 (双层叠加：高亮预览底层 + 原生透明编辑上层) */}
            <div class="editor-code-wrapper">
              {targetLineBand && (
                <div class="editor-target-lines-band" style={targetLineBand} aria-hidden="true" />
              )}
              <pre ref={preRef} class="editor-syntax-highlight" aria-hidden="true">
                <code dangerouslySetInnerHTML={{ __html: highlightedHtml + '\n' }} />
              </pre>
              <textarea
                ref={textareaRef}
                class={'editor-textarea' + (viewMode === 'preview' ? ' is-preview-readonly' : '')}
                value={content}
                readOnly={viewMode === 'preview'}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                }}
                onDrop={(e) => {
                  // 拦截原生插入文本行为，防止将文件路径追加到代码中，统一在新标签页打开！
                  e.preventDefault();
                  e.stopPropagation();
                  try {
                    const raw = e.dataTransfer?.getData('application/jeikcode-tab');
                    const data = raw ? JSON.parse(raw) : (window as any).__jeikcode_dragged_tab;
                    const targetPath = data?.filePath || e.dataTransfer?.getData('text/plain');
                    if (targetPath) {
                      window.dispatchEvent(new CustomEvent('jeikcode:open_file', { detail: { path: targetPath.trim() } }));
                    }
                  } catch {}
                }}
                onInput={(e) => {
                  const val = (e.target as HTMLTextAreaElement).value;
                  const cur = (e.target as HTMLTextAreaElement).selectionStart;
                  setContent(val);
                  setIsDirty(true);
                  if (inputDebounceTimerRef.current) {
                    clearTimeout(inputDebounceTimerRef.current);
                  }
                  inputDebounceTimerRef.current = window.setTimeout(() => {
                    pushSnapshot(val, cur);
                  }, 280);
                }}
                onKeyDown={handleTextareaKeyDown}
                onScroll={handleScroll}
                spellcheck={false}
                wrap="off"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
