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

export function PluginCenterHostApp() {
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
  // 侧边栏与顶栏不再强制注入硬编码的「插件中心」按钮；统一由左下角「设置」入口承载，侧边栏仅保留插件预留插槽 (`sidebar.nav`)
  const cleanupLegacyTriggers = () => {
    document
      .querySelectorAll('.zap-sidebar-plugins-btn, .zap-dsh-sidebar-plugins-btn, .zap-dsh-header-btn')
      .forEach((el) => el.remove());
  };
  cleanupLegacyTriggers();
}

customRegistry.register({
  id: 'zap-deepseek-plugin-center',
  name: 'Zap DeepSeek-Style Plugin & Settings Center',
  version: '1.0.0',
  init() {
    if (typeof document === 'undefined') return;
    const mount = () => {
      const legacyHost = document.getElementById('zap-dsh-plugin-center-root');
      if (legacyHost) {
        legacyHost.remove();
      }
      injectTriggersIntoWorkspace();
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount, { once: true });
    } else {
      mount();
    }
  },
});
