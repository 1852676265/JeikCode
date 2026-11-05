/**
 * Zap 二开扩展注册表 (Custom Extension Registry)
 * -----------------------------------------------------------------------------
 * 挂载对标 DeepSeek (`deepseek-harness`) 架构的统一插件设置中心与 Cordis 风格插槽内核。
 */

import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { DeepSeekSettingsCenterModal } from './plugin-settings-center';
import { zapPluginKernel } from './plugin-kernel';
import './custom.css';

export interface CustomExtension {
  id: string;
  name: string;
  version: string;
  init: () => void;
}

class CustomExtensionRegistry {
  private extensions: Map<string, CustomExtension> = new Map();

  register(ext: CustomExtension) {
    if (this.extensions.has(ext.id)) return;
    this.extensions.set(ext.id, ext);
    try {
      ext.init();
    } catch (err) {
      console.error(`[CustomRegistry] Failed to init extension "${ext.id}":`, err);
    }
  }

  getAll(): CustomExtension[] {
    return Array.from(this.extensions.values());
  }
}

export const customRegistry = new CustomExtensionRegistry();

// Global event bus for opening the DeepSeek Settings & Plugin Center from anywhere
const OPEN_CENTER_EVENT = 'zap:open-deepseek-settings-center';

export function openDeepSeekSettingsCenter(initialSection: string = 'general') {
  window.dispatchEvent(
    new CustomEvent(OPEN_CENTER_EVENT, { detail: { section: initialSection } }),
  );
}

function PluginCenterHostApp() {
  const [open, setOpen] = useState(false);
  const [initialSection, setInitialSection] = useState<string>('general');
  const [overlaysVersion, setOverlaysVersion] = useState(0);

  useEffect(() => {
    zapPluginKernel.syncAllPackagesRuntimeEffects();
    const unsub = zapPluginKernel.subscribe(() => {
      setOverlaysVersion((v) => v + 1);
    });
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ section?: string }>).detail;
      setInitialSection(detail?.section || 'general');
      setOpen(true);
    };
    window.addEventListener(OPEN_CENTER_EVENT, handler);
    return () => {
      unsub();
      window.removeEventListener(OPEN_CENTER_EVENT, handler);
    };
  }, []);

  const overlays = zapPluginKernel.getSlotEntries('shell.overlay');

  return (
    <>
      {overlays.map((ov) => (
        <div key={ov.id} class="zap-plugin-overlay-slot">
          {ov.render()}
        </div>
      ))}
      <DeepSeekSettingsCenterModal
        open={open}
        initialSection={initialSection}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

function injectTriggersIntoWorkspace() {
  const ensureTriggers = () => {
    // 1. Inject "插件与设置" action button into `.sidebar-actions` (兜底防重复)
    const sidebarActions = document.querySelector('.sidebar-actions');
    if (
      sidebarActions &&
      !sidebarActions.querySelector('.zap-sidebar-plugins-btn') &&
      !sidebarActions.querySelector('.zap-dsh-sidebar-plugins-btn')
    ) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sidebar-action zap-sidebar-plugins-btn';
      btn.title = '打开插件与设置中心 (DeepSeek Plugin & Settings Center)';
      btn.innerHTML = `
        <span class="sidebar-action-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1 1.705-.707c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z"/>
          </svg>
        </span>
        <span class="sidebar-action-label">插件中心</span>
      `;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openDeepSeekSettingsCenter('plugins');
      });
      sidebarActions.appendChild(btn);
    }

    // 2. Inject entry into `.settings-popup-menu` when user clicks the bottom-left Settings gear
    const settingsPopup = document.querySelector('.settings-popup-menu');
    if (settingsPopup && !settingsPopup.querySelector('.zap-dsh-popup-entry')) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'settings-menu-item zap-dsh-popup-entry';
      item.innerHTML = `
        <span class="settings-menu-icon">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1 1.705-.707c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z"/>
          </svg>
        </span>
        <span class="settings-menu-label">插件与统一设置中心</span>
      `;
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openDeepSeekSettingsCenter('general');
      });
      settingsPopup.insertBefore(item, settingsPopup.firstChild);
    }

    // 3. Inject quick button into top header `.header-actions`
    const headerActions = document.querySelector('header.session-header > .header-actions');
    if (headerActions && !headerActions.querySelector('.zap-dsh-header-btn')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'zap-dsh-header-btn';
      btn.title = '打开插件与设置中心';
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1 1.705-.707c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z"/>
        </svg>
        <span>插件中心</span>
      `;
      btn.addEventListener('click', () => openDeepSeekSettingsCenter('plugin-manager'));
      headerActions.insertBefore(btn, headerActions.firstChild);
    }
  };

  ensureTriggers();
  const observer = new MutationObserver(() => ensureTriggers());
  observer.observe(document.body, { childList: true, subtree: true });
}

customRegistry.register({
  id: 'zap-deepseek-plugin-center',
  name: 'Zap DeepSeek-Style Plugin & Settings Center',
  version: '1.0.0',
  init() {
    if (typeof document === 'undefined') return;
    const mount = () => {
      let host = document.getElementById('zap-dsh-plugin-center-root');
      if (!host) {
        host = document.createElement('div');
        host.id = 'zap-dsh-plugin-center-root';
        document.body.appendChild(host);
      }
      render(<PluginCenterHostApp />, host);
      injectTriggersIntoWorkspace();
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount, { once: true });
    } else {
      mount();
    }
  },
});
