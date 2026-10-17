import DOMPurify from 'dompurify';
import { useMemo, useRef, useEffect, useState } from 'preact/hooks';
import { render } from 'preact';
import { createPortal } from 'preact/compat';
import { markdownToHtml } from '../lib/markdownRender';
import { MermaidDiagram } from './MermaidDiagram';
import { useSettings } from '../settings';
import { showToast } from './Toast';
import { parseFilePathAndLines } from '../lib/displayPath';

export { preprocessMarkdown, markdownToHtml } from '../lib/markdownRender';

export function highlightHtml(html: string, search: string, activeIdx?: number): { html: string; count: number } {
  if (!search.trim()) return { html, count: 0 };
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const walk = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walk.nextNode())) {
    nodes.push(node as Text);
  }
  const searchLower = search.toLowerCase();
  let matchCount = 0;
  for (const textNode of nodes) {
    const text = textNode.nodeValue ?? '';
    if (!text.toLowerCase().includes(searchLower)) continue;

    const parent = textNode.parentNode;
    if (!parent) continue;

    const parentTag = (parent as HTMLElement).tagName?.toLowerCase();
    if (parentTag === 'script' || parentTag === 'style') continue;

    const newFragment = doc.createDocumentFragment();
    let lastIndex = 0;
    let index = text.toLowerCase().indexOf(searchLower);
    while (index !== -1) {
      if (index > lastIndex) {
        newFragment.appendChild(doc.createTextNode(text.substring(lastIndex, index)));
      }
      const mark = doc.createElement('mark');
      const isCurrent = activeIdx !== undefined && matchCount === activeIdx;
      mark.className = 'msg-search-highlight' + (isCurrent ? ' is-current-match' : '');
      mark.setAttribute('data-match-idx', String(matchCount));
      mark.textContent = text.substring(index, index + search.length);
      newFragment.appendChild(mark);
      matchCount++;
      lastIndex = index + search.length;
      index = text.toLowerCase().indexOf(searchLower, lastIndex);
    }
    if (lastIndex < text.length) {
      newFragment.appendChild(doc.createTextNode(text.substring(lastIndex)));
    }
    parent.replaceChild(newFragment, textNode);
  }
  return { html: doc.body.innerHTML, count: matchCount };
}

// 路径归一化函数：兼容 Windows 盘符路径与 POSIX 路径
function normalizePath(rawPath: string): string {
  const norm = rawPath.trim().replace(/^['"`]|['"`]$/g, '').replace(/\\/g, '/');
  const lineCleaned = norm.replace(/:\d+(?::\d+)?$/, '');
  const hasDrive = /^[a-zA-Z]:/.test(lineCleaned);
  const parts = lineCleaned.split('/');
  const stack: string[] = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') stack.pop();
    else stack.push(p);
  }
  return (hasDrive ? '' : lineCleaned.startsWith('/') ? '/' : '') + stack.join('/');
}

const ALL_FILE_EXTS = 'kt|kts|java|c|cpp|cc|cxx|h|hpp|hxx|cs|swift|m|mm|scala|clj|cljs|rs|go|py|pyw|rb|php|pl|pm|lua|r|dart|ts|tsx|js|jsx|mjs|cjs|json|json5|jsonc|toml|yaml|yml|xml|html|htm|xhtml|css|scss|sass|less|styl|sh|bash|zsh|fish|ps1|psm1|bat|cmd|sql|prisma|proto|graphql|gql|vue|svelte|astro|md|markdown|mdx|txt|text|log|diff|patch|env|properties|ini|conf|cfg|lock|svg|png|jpg|jpeg|gif|webp|ico|bmp|avif|gradle|cmake|dockerfile|containerfile|nix';
const EXT_REGEX = new RegExp(`\\.(${ALL_FILE_EXTS})$`, 'i');
const ROOT_DIRS_REGEX = /^(crates|src|webui|packages|desktop|docs|scripts|extensions|functions|plans|tests|assets|public|internal|cmd|api|lib)\/[\w.\-\\/]+$/i;

/**
 * 智能识别一段文本是否是项目源码/资源文件路径（支持健壮提取附带的行号与行范围）
 */
export function isFilePathSnippet(text: string): boolean {
  const { filePath } = parseFilePathAndLines(text);
  const t = filePath.trim().replace(/^['"`]|['"`]$/g, '');
  if (t.length < 2 || t.length > 350) return false;
  if (/^(https?:|\/\/)/i.test(t) || /^www\./i.test(t)) return false;

  // 1. 标准扩展名匹配 (全语言源码、脚本、配置、文本及资源)
  if (EXT_REGEX.test(t)) return true;

  // 2. 绝对路径特征
  if (/^[a-zA-Z]:[\\/][\w.\-\\/]+?\.[a-zA-Z0-9]+$/i.test(t)) return true;
  if (/^\/[\w.\-\\/]+?\.[a-zA-Z0-9]+$/i.test(t)) return true;

  // 3. 常见工程目录层级结构
  if (ROOT_DIRS_REGEX.test(t)) return true;

  return false;
}

// 解析目标文件路径 (全面支持 Windows/POSIX 绝对路径与基于 basePath / cwd 的相对路径)
function resolveTargetFile(href: string, basePath?: string, cwd?: string): string {
  const clean = href.trim().replace(/^['"`]|['"`]$/g, '').replace(/\\/g, '/');
  const hasDrive = /^[a-zA-Z]:/.test(clean);
  const isPosixAbs = clean.startsWith('/') && !clean.startsWith('//');

  // 1. 如果是绝对路径
  if (hasDrive || isPosixAbs) {
    return normalizePath(clean);
  }

  // 2. 如果是相对路径
  let anchorDir = '';
  if (basePath) {
    const normBase = basePath.replace(/\\/g, '/');
    anchorDir = normBase.substring(0, normBase.lastIndexOf('/'));
  } else if (cwd) {
    anchorDir = cwd.replace(/\\/g, '/');
  }

  if (anchorDir) {
    return normalizePath(anchorDir + '/' + clean.replace(/^\.\//, ''));
  }
  return normalizePath(clean);
}

// 在 HTML 注入 DOM 之前，统一将相对图片 src 预重写为 /fs/raw 流式接口，根治离开久了图片 404 与休眠裂图问题！
function rewriteImageSources(html: string, basePath?: string, cwd?: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const imgNodes = doc.querySelectorAll('img');
  if (imgNodes.length === 0) return html;

  imgNodes.forEach((img) => {
    const src = img.getAttribute('src');
    if (!src || /^(https?:|data:|\/\/|\/fs\/raw|fs\/raw)/i.test(src)) return;
    const resolvedAbs = resolveTargetFile(src, basePath, cwd);
    img.setAttribute('src', `/fs/raw?path=${encodeURIComponent(resolvedAbs)}`);
    img.setAttribute('loading', 'lazy');
  });
  return doc.body.innerHTML;
}

export function Markdown({
  content,
  search,
  basePath,
  cwd,
  activeSearchIndex,
  onMatchCountChange,
  targetContext = 'chat',
}: {
  content: string;
  search?: string;
  basePath?: string;
  cwd?: string;
  activeSearchIndex?: number;
  onMatchCountChange?: (count: number) => void;
  targetContext?: 'main' | 'right' | 'chat';
}) {
  const { theme, lang, t } = useSettings();
  const isDark = (theme === 'dark') ||
    (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) ||
    (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark');

  const rootRef = useRef<HTMLDivElement>(null);

  const { renderedHtml, matchCount } = useMemo(() => {
    const raw = markdownToHtml(content ?? '', { highlight: true });
    // SECURITY: model output is untrusted — sanitize before injecting as HTML.
    const sanitized = DOMPurify.sanitize(raw, {
      ADD_TAGS: ['mark', 'math', 'annotation', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'ms', 'mtext', 'mspace', 'mfrac', 'msqrt', 'mroot', 'msub', 'msup', 'msubsup', 'munder', 'mover', 'munderover', 'mtable', 'mtr', 'mtd', 'mstyle'],
      ADD_ATTR: ['data-match-idx', 'id', 'data-alt-id', 'data-copy', 'data-mermaid-code', 'class', 'checked', 'disabled', 'type', 'align', 'start', 'colspan', 'rowspan', 'style', 'aria-hidden', 'encoding', 'target', 'rel'],
    });

    // 在 HTML 渲染前将相对图片直转为 /fs/raw 绝对地址
    const prepped = rewriteImageSources(sanitized, basePath, cwd);

    if (search && search.trim()) {
      const res = highlightHtml(prepped, search);
      return { renderedHtml: res.html, matchCount: res.count };
    }
    return { renderedHtml: prepped, matchCount: 0 };
  }, [content, search, basePath, cwd]);

  useEffect(() => {
    onMatchCountChange?.(matchCount);
  }, [matchCount, onMatchCountChange]);

  // 当前激活选中的匹配项切换时，添加 .is-current-match 并平滑滚动居中定位！
  useEffect(() => {
    if (!rootRef.current) return;
    const marks = rootRef.current.querySelectorAll<HTMLElement>('.msg-search-highlight');
    marks.forEach((m, idx) => {
      if (activeSearchIndex !== undefined && idx === activeSearchIndex) {
        m.classList.add('is-current-match');
        m.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        m.classList.remove('is-current-match');
      }
    });
  }, [activeSearchIndex, renderedHtml]);

  // 水合挂载 MermaidDiagram 交互矢量图组件
  useEffect(() => {
    if (!rootRef.current) return;

    const mountNodes = rootRef.current.querySelectorAll<HTMLElement>('.mermaid-diagram-mount');
    const mountedElements: HTMLElement[] = [];

    mountNodes.forEach((node) => {
      const rawCode = node.getAttribute('data-mermaid-code');
      if (!rawCode) return;
      try {
        const decoded = decodeURIComponent(rawCode);
        render(
          <MermaidDiagram code={decoded} isDark={isDark} t={t} />,
          node,
        );
        mountedElements.push(node);
      } catch (err) {
        console.warn('[Markdown] Failed to mount MermaidDiagram:', err);
      }
    });

    return () => {
      for (const node of mountedElements) {
        try {
          render(null, node);
        } catch {}
      }
    };
  }, [renderedHtml, isDark, lang, basePath]);

  // 智能扫描并标记画布上的文件引用胶囊徽章与 Web 链接，赋予高级胶囊动效、手形与无障碍聚焦
  useEffect(() => {
    if (!rootRef.current) return;
    const codes = rootRef.current.querySelectorAll<HTMLElement>(':not(pre) > code');
    codes.forEach((code) => {
      const text = (code.textContent || '').trim();
      if (/^(https?:|\/\/)/i.test(text) || /^www\./i.test(text)) {
        code.classList.add('file-path-badge', 'web-link-badge');
        code.setAttribute('title', `${text} (${t('preview.clickToOpenExternal')})`);
        code.setAttribute('tabindex', '0');
        code.setAttribute('role', 'link');
      } else if (isFilePathSnippet(text)) {
        code.classList.add('file-path-badge');
        code.setAttribute('title', `${text} (${t('preview.clickToPreview')}, Ctrl+Click: ${t('preview.openInMain')})`);
        code.setAttribute('tabindex', '0');
        code.setAttribute('role', 'button');
      }
    });

    const links = rootRef.current.querySelectorAll<HTMLElement>('a[href]');
    links.forEach((a) => {
      a.classList.add('markdown-link-pill');
    });
  }, [renderedHtml]);

  // 监听鼠标长按拖拽划词事件：拖选文字时光标自适应切换为点击形 (text)，松开即恢复
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let isMouseDown = false;
    let downX = 0;
    let downY = 0;
    let activeBadge: HTMLElement | null = null;

    const handleMouseDown = (e: MouseEvent) => {
      const badge = (e.target as HTMLElement)?.closest('.file-path-badge, a[href]') as HTMLElement | null;
      if (badge) {
        isMouseDown = true;
        downX = e.clientX;
        downY = e.clientY;
        activeBadge = badge;
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isMouseDown || !activeBadge) return;
      const dx = Math.abs(e.clientX - downX);
      const dy = Math.abs(e.clientY - downY);
      if (dx > 3 || dy > 3) {
        activeBadge.classList.add('is-selecting');
      }
    };

    const handleMouseUp = () => {
      isMouseDown = false;
      if (activeBadge) {
        activeBadge.classList.remove('is-selecting');
        activeBadge = null;
      }
    };

    root.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      root.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [renderedHtml]);

  function onClick(e: MouseEvent) {
    const targetEl = e.target as HTMLElement;

    // 1. 处理内部锚点平滑跳转（如 [中文更新日志](#-中文更新日志-chinese)）
    const anchor = targetEl?.closest('a[href^="#"]') as HTMLAnchorElement | null;
    if (anchor) {
      const rawHash = anchor.getAttribute('href')?.slice(1);
      if (rawHash) {
        e.preventDefault();
        const hash = decodeURIComponent(rawHash);
        const altHash = hash.startsWith('-') ? hash.slice(1) : `-${hash}`;
        const container = (e.currentTarget as HTMLElement)?.closest('.messages-container') || document;
        let target = container.querySelector(`[id="${CSS.escape(hash)}"]`) ||
          container.querySelector(`[id="${CSS.escape(altHash)}"]`) ||
          container.querySelector(`[data-alt-id="${CSS.escape(hash)}"]`) ||
          container.querySelector(`[data-alt-id="${CSS.escape(altHash)}"]`);
        if (!target && container !== document) {
          target = document.querySelector(`[id="${CSS.escape(hash)}"]`) ||
            document.querySelector(`[id="${CSS.escape(altHash)}"]`);
        }
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
      return;
    }

    // 2. 拦截文件引用链接、Markdown超链接与行内代码路径/链接识别
    const clickable = targetEl?.closest('a[href], .file-preview-link, code') as HTMLElement | null;
    if (clickable) {
      let href = clickable.getAttribute('href') || clickable.dataset.filePath || '';
      // 如果点击的是行内 code 标签，智能检测其内容是否是 Web 链接或文件路径
      if (!href && clickable.tagName?.toLowerCase() === 'code') {
        const text = (clickable.textContent || '').trim();
        if (/^(https?:|\/\/)/i.test(text) || /^www\./i.test(text)) {
          href = text;
        } else if (isFilePathSnippet(text)) {
          href = text;
        }
      }

      // (A) 外部 Web 链接：在系统默认原始浏览器中弹出打开 (Tauri 桌面壳自动由 on_new_window 接管)
      if (href && (/^(https?:|\/\/)/i.test(href) || /^www\./i.test(href))) {
        const sel = window.getSelection()?.toString().trim();
        if (sel && sel.length > 0) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        let targetUrl = href.trim();
        if (targetUrl.startsWith('//')) {
          targetUrl = 'https:' + targetUrl;
        } else if (/^www\./i.test(targetUrl)) {
          targetUrl = 'https://' + targetUrl;
        }

        try {
          window.open(targetUrl, '_blank', 'noopener,noreferrer');
        } catch {}
        return;
      }

      // (B) 本地文件路径引用：在预览或主编辑区打开
      if (href && !href.startsWith('#') && !/^(https?:|mailto:|\/\/)/i.test(href)) {
        // 如果用户正在划词选择复制文字，或者刚刚拖选了文字，绝不触发打开文件，保护复制体验
        const sel = window.getSelection()?.toString().trim();
        if (sel && sel.length > 0) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        const { filePath: cleanHref, startLine, endLine } = parseFilePathAndLines(href);
        const resolved = resolveTargetFile(cleanHref, basePath, cwd);
        const fileName = resolved.split(/[\\/]/).pop() || resolved;

        if (e.ctrlKey || e.metaKey || e.altKey) {
          // 按住 Ctrl / Cmd / Alt 点击：直接在中间主编辑区打开并定位行号！
          window.dispatchEvent(new CustomEvent('jeikcode:open_file', {
            detail: { path: resolved, startLine, endLine }
          }));
          return;
        }

        if (targetContext === 'right') {
          // 右侧预览区点击：在右侧标签区打开，绝不跳去中间主舞台，互不干扰！
          window.dispatchEvent(new CustomEvent('jeikcode:preview:open_file', {
            detail: { filePath: resolved, fileName, startLine, endLine }
          }));
        } else if (targetContext === 'main') {
          // 中间主预览区点击：在中间主标签区打开，绝不跳去右侧，互不干扰！
          window.dispatchEvent(new CustomEvent('jeikcode:open_file', {
            detail: { path: resolved, startLine, endLine }
          }));
        } else {
          // AI 对话主画布中点击：默认在右侧区域预览出来，复用异地浏览文件能力，不遮盖AI对话！
          window.dispatchEvent(new CustomEvent('jeikcode:preview:open_file', {
            detail: { filePath: resolved, fileName, startLine, endLine }
          }));
          window.dispatchEvent(new CustomEvent('jeikcode:switch_right_tab', {
            detail: 'preview'
          }));
        }
        return;
      }
    }

    // 2. 处理代码块 Copy 按钮
    const t = targetEl?.closest('.copy-button') as HTMLElement | null;
    if (t?.dataset.copy) {
      const text = decodeURIComponent(t.dataset.copy);
      const prev = t.textContent;
      const mark = (ok: boolean) => {
        t.textContent = ok ? 'Copied' : 'Failed';
        setTimeout(() => {
          t.textContent = prev;
        }, 1200);
      };
      void (async () => {
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            mark(true);
            return;
          }
        } catch {
          /* fall through */
        }
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          const ok = document.execCommand('copy');
          document.body.removeChild(ta);
          mark(ok);
        } catch {
          mark(false);
        }
      })();
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      const targetEl = e.target as HTMLElement;
      if (targetEl?.classList.contains('file-path-badge')) {
        targetEl.click();
      }
    }
  }

  const [fileBadgeMenu, setFileBadgeMenu] = useState<{
    x: number;
    y: number;
    filePath: string;
    fileName: string;
    startLine?: number;
    endLine?: number;
  } | null>(null);

  useEffect(() => {
    if (!fileBadgeMenu) return;
    const close = () => setFileBadgeMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFileBadgeMenu(null);
    };
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [fileBadgeMenu]);

  function onContextMenu(e: MouseEvent) {
    const targetEl = e.target as HTMLElement;
    const clickable = targetEl?.closest('.file-path-badge, .file-preview-link') as HTMLElement | null;
    if (clickable) {
      let href = clickable.getAttribute('href') || clickable.dataset.filePath || '';
      if (!href && clickable.tagName?.toLowerCase() === 'code') {
        const text = (clickable.textContent || '').trim();
        if (isFilePathSnippet(text)) {
          href = text;
        }
      }
      if (href && !href.startsWith('#') && !/^(https?:|\/\/)/i.test(href)) {
        e.preventDefault();
        e.stopPropagation();
        const { filePath: cleanHref, startLine, endLine } = parseFilePathAndLines(href);
        const resolved = resolveTargetFile(cleanHref, basePath, cwd);
        const fileName = resolved.split(/[\\/]/).pop() || resolved;
        setFileBadgeMenu({
          x: e.clientX,
          y: e.clientY,
          filePath: resolved,
          fileName,
          startLine,
          endLine,
        });
      }
    }
  }

  return (
    <>
      <div
        ref={rootRef}
        class="markdown-root assistant-message-content"
        onClick={onClick}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />
      {fileBadgeMenu && typeof document !== 'undefined' && createPortal(
        <div
          class="file-context-menu"
          style={{ top: `${fileBadgeMenu.y}px`, left: `${fileBadgeMenu.x}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            class="context-menu-btn"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('jeikcode:preview:open_file', {
                detail: {
                  filePath: fileBadgeMenu.filePath,
                  fileName: fileBadgeMenu.fileName,
                  startLine: fileBadgeMenu.startLine,
                  endLine: fileBadgeMenu.endLine,
                }
              }));
              window.dispatchEvent(new CustomEvent('jeikcode:switch_right_tab', {
                detail: 'preview'
              }));
              setFileBadgeMenu(null);
            }}
          >
            <span>👁️ {t('preview.openInRight')}</span>
          </button>
          <button
            type="button"
            class="context-menu-btn"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('jeikcode:open_file', {
                detail: {
                  path: fileBadgeMenu.filePath,
                  startLine: fileBadgeMenu.startLine,
                  endLine: fileBadgeMenu.endLine,
                }
              }));
              setFileBadgeMenu(null);
            }}
          >
            <span>📑 {t('preview.openInMain')}</span>
          </button>
          <button
            type="button"
            class="context-menu-btn"
            onClick={() => {
              navigator.clipboard?.writeText(fileBadgeMenu.filePath);
              showToast(t('explorer.copyFullPath'), 'success');
              setFileBadgeMenu(null);
            }}
          >
            <span>📋 {t('explorer.copyFullPath')}</span>
          </button>
        </div>,
        document.body
      )}
    </>
  );
}
