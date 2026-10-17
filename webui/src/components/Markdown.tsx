import DOMPurify from 'dompurify';
import { useMemo, useRef, useEffect } from 'preact/hooks';
import { render } from 'preact';
import { markdownToHtml } from '../lib/markdownRender';
import { MermaidDiagram } from './MermaidDiagram';
import { useSettings } from '../settings';

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

    // 2. 拦截文件引用链接、Markdown超链接与行内代码路径识别
    const clickable = targetEl?.closest('a[href], .file-preview-link, code') as HTMLElement | null;
    if (clickable) {
      let href = clickable.getAttribute('href') || clickable.dataset.filePath || '';
      // 如果点击的是行内 code 标签，智能检测其内容是否是文件路径
      if (!href && clickable.tagName?.toLowerCase() === 'code') {
        const text = (clickable.textContent || '').trim();
        const isPath = /^[\w.\-\\/]+?\.(md|markdown|rs|ts|tsx|js|jsx|json|toml|yaml|yml|py|go|html|css|sh|bash|txt|lock|svg|png|jpg|jpeg)(:\d+)?$/i.test(text) ||
          /^[a-zA-Z]:[\\/][\w.\-\\/]+?\.[a-zA-Z0-9]+$/i.test(text) ||
          /^\/[\w.\-\\/]+?\.[a-zA-Z0-9]+$/i.test(text);
        if (isPath) {
          href = text;
        }
      }

      if (href && !href.startsWith('#') && !/^(https?:|mailto:|\/\/)/i.test(href)) {
        e.preventDefault();
        e.stopPropagation();

        const resolved = resolveTargetFile(href, basePath, cwd);
        const fileName = resolved.split(/[\\/]/).pop() || resolved;

        if (targetContext === 'right') {
          // 右侧预览区点击：在右侧标签区打开，绝不跳去中间主舞台，互不干扰！
          window.dispatchEvent(new CustomEvent('jeikcode:preview:open_file', {
            detail: { filePath: resolved, fileName }
          }));
        } else if (targetContext === 'main') {
          // 中间主预览区点击：在中间主标签区打开，绝不跳去右侧，互不干扰！
          window.dispatchEvent(new CustomEvent('jeikcode:open_file', {
            detail: { path: resolved }
          }));
        } else {
          // AI 对话主画布中点击：默认在右侧区域预览出来，复用异地浏览文件能力，不遮盖AI对话！
          window.dispatchEvent(new CustomEvent('jeikcode:preview:open_file', {
            detail: { filePath: resolved, fileName }
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

  return (
    <div
      ref={rootRef}
      class="markdown-root assistant-message-content"
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: renderedHtml }}
    />
  );
}
