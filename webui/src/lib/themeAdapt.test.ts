import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { resolveEffectiveTheme } from './theme.ts';

test('resolveEffectiveTheme handles light, dark and system preferences accurately', () => {
  assert.equal(resolveEffectiveTheme('light'), 'light');
  assert.equal(resolveEffectiveTheme('dark'), 'dark');

  // Mock prefers-color-scheme: light
  const originalMatchMedia = (globalThis as any).window?.matchMedia;
  try {
    (globalThis as any).window = {
      matchMedia: (query: string) => ({
        matches: query.includes('prefers-color-scheme: dark') ? false : true,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    };
    assert.equal(resolveEffectiveTheme('system'), 'light');

    // Mock prefers-color-scheme: dark
    (globalThis as any).window = {
      matchMedia: (query: string) => ({
        matches: query.includes('prefers-color-scheme: dark') ? true : false,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    };
    assert.equal(resolveEffectiveTheme('system'), 'dark');
  } finally {
    if (originalMatchMedia) {
      (globalThis as any).window.matchMedia = originalMatchMedia;
    }
  }
});

test('app.css contains full light-theme adaptations for DiffViewer, tabs, preview eye and markdown badges', () => {
  const root = join(process.cwd(), 'src/styles/app.css');
  const css = readFileSync(root, 'utf8');

  // DiffViewer & Editor tabs
  assert.match(css, /:root\[data-theme=['"]light['"]\]\s+\.vscode-diff-view-stage/);
  assert.match(css, /:root\[data-theme=['"]light['"]\]\s+\.diff-viewer-root/);
  assert.match(css, /:root\[data-theme=['"]light['"]\]\s+\.diff-viewer-toolbar/);
  assert.match(css, /:root\[data-theme=['"]light['"]\]\s+\.diff-row-add/);
  assert.match(css, /:root\[data-theme=['"]light['"]\]\s+\.diff-row-del/);
  assert.match(css, /:root\[data-theme=['"]light['"]\]\s+\.diff-row-hunk/);
  assert.match(css, /:root\[data-theme=['"]light['"]\]\s+\.vscode-editor-tabs-bar/);

  // Markdown inline code & path badges
  assert.match(css, /:root\[data-theme=['"]light['"]\]\s+\.markdown-root\s+:not\(pre\)\s*>\s*code/);
  assert.match(css, /:root\[data-theme=['"]light['"]\]\s+\.markdown-root\s+:not\(pre\)\s*>\s*code\.file-path-badge/);

  // Right preview panel & eye icon
  assert.match(css, /:root\[data-theme=['"]light['"]\]\s+\.preview-panel-root/);
  assert.match(css, /:root\[data-theme=['"]light['"]\]\s+\.right-panel-tab-btn\.is-drag-over-eye/);
});

test('index.html initializes data-theme with prefers-color-scheme fallback for system preference', () => {
  const root = join(process.cwd(), 'index.html');
  const html = readFileSync(root, 'utf8');
  assert.match(html, /data-theme/);
  assert.match(html, /prefers-color-scheme:\s*dark/);
  assert.match(html, /data-theme-preference/);
});

test('vi catalog preserves untranslated reasoning effort level names (Low, Medium, High, etc.)', () => {
  const viPath = join(process.cwd(), 'src/vi.ts');
  const viContent = readFileSync(viPath, 'utf8');
  assert.match(viContent, /'effort\.low':\s*'Low'/);
  assert.match(viContent, /'effort\.medium':\s*'Medium'/);
  assert.match(viContent, /'effort\.high':\s*'High'/);
  assert.match(viContent, /'effort\.xhigh':\s*'XHigh'/);
  assert.match(viContent, /'effort\.max':\s*'Max'/);
  assert.match(viContent, /'effort\.label':\s*'Mức suy luận'/);
});
