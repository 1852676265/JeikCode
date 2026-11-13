import { render } from 'preact';
import { App } from './app';
import { SettingsProvider } from './settings';
import { ensureRandomUUIDPolyfill } from './lib/randomId';
import { initPageZoom, initEditorFontSize } from './lib/pageZoom';
// Bundled serif for the landing greeting (close to claude.ai's display serif).
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/500.css';
import './styles/theme.css';
import './styles/app.css';
import './index.css';
import './custom/custom.css';
import './custom/custom-registry';
import './custom/glass-theme-plugin';
import 'katex/dist/katex.min.css';

// 禁用浏览器默认的历史滚动恢复，避免刷新时与聊天时间线底部粘性定位冲突产生跳变
if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}

// 当服务端发版重启导致异地旧标签页请求的异步 chunk hash 失效时，自动刷新页面拉取最新资源
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', () => {
    window.location.reload();
  });
}

// http://LAN-IP (jeikcode serve remote clients) is not a secure context —
// crypto.randomUUID is missing there. Polyfill before any component mounts.
ensureRandomUUIDPolyfill();

// 初始化类似 Chrome 的页面缩放（Ctrl + 滚轮 / 快捷键）
initPageZoom();
// 初始化代码编辑/预览全局字号
initEditorFontSize();

// 单实例挂载：HMR、重复执行入口或上一轮未清理的挂载都可能在同一 #app 下叠加多份应用，
// 表现就是侧栏与主区各来自不同实例（点开一个会话却看到“发送消息开始对话…”）。
// 挂载前先显式卸载旧 Preact 树并清空容器，同时在 HMR dispose 时清理，保证整页只有一个 App 根节点。
const container = document.getElementById('app');
if (container) {
  render(null, container);
  container.replaceChildren();
  render(
    <SettingsProvider>
      <App />
    </SettingsProvider>,
    container,
  );
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      render(null, container);
      container.replaceChildren();
    });
  }
}
