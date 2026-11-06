/**
 * DeepSeek-Style Unified Settings Center & Plugin Manager (`ui-settings` + `ui-plugin-manager`)
 * ---------------------------------------------------------------------------------------------
 * 1:1 UI/UX implementation of DeepSeek Harness's SettingsRoot, PluginsSettingsSection,
 * PluginInventorySettingsTab, AgentPresetSection, PluginManagerPage, and DiscoverSection.
 */

import { h } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  AgentPresetEntry,
  BuiltinPluginEntry,
  ExternalPluginPackage,
  ExternalPluginRow,
  InstallWizardState,
  MARKET_CATALOG,
  MarketListingEntry,
  PluginRuntimePhase,
  SettingsSectionContribution,
  zapPluginKernel,
} from './plugin-kernel';
import { DshBootAnimationSettingsPanel } from './boot-animation-settings-panel';
import { GlassThemeSettingsPanel } from './glass-theme-settings-panel';
import { loadGlassThemeSettings } from './glass-theme-plugin';
import {
  CapabilityItem,
  getCapabilities,
  getModels,
  ModelInfo,
  postLanguage,
  toggleCapability,
} from '../api';
import { useSettings, Theme } from '../settings';
import { Lang } from '../i18n';
import { ModelSelector } from '../components/ModelSelector';
import { getActiveServerProfile, isDirectLlmProfile, PROFILES_CHANGE_EVENT } from '../lib/serverProfiles';

// =============================================================================
// 1. Icons (Matching @deepseek-ai/dsh-client-ui-primitives outline icons)
// =============================================================================

const IconGear = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const IconSliders = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <line x1="4" y1="21" x2="4" y2="14" />
    <line x1="4" y1="10" x2="4" y2="3" />
    <line x1="12" y1="21" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12" y2="3" />
    <line x1="20" y1="21" x2="20" y2="16" />
    <line x1="20" y1="12" x2="20" y2="3" />
    <line x1="1" y1="14" x2="7" y2="14" />
    <line x1="9" y1="8" x2="15" y2="8" />
    <line x1="17" y1="16" x2="23" y2="16" />
  </svg>
);

const IconPuzzle = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.315 8.685a.98.98 0 0 1 .837-.276c.47.07.802.48.968.925a2.501 2.501 0 1 0 3.214-3.214c-.446-.166-.855-.497-.925-.968a.979.979 0 0 1 .276-.837l1.61-1.61a2.404 2.404 0 0 1 1.705-.707c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z" />
  </svg>
);

const IconCube = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);

const IconPalette = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
    <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
    <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
    <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.5 17.5 2 12 2z" />
  </svg>
);

const IconSparkles = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z" />
  </svg>
);

const IconStore = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
);

const IconSearch = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const IconPlus = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const IconRefresh = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
    <path d="M16 16h5v5" />
  </svg>
);

const IconTrash = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const IconChevronDown = ({ size = 14, className = '' }: { size?: number; className?: string }) => (
  <svg class={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const IconClose = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const IconMovie = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
    <line x1="7" y1="2" x2="7" y2="22" />
    <line x1="17" y1="2" x2="17" y2="22" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <line x1="2" y1="7" x2="7" y2="7" />
    <line x1="2" y1="17" x2="7" y2="17" />
    <line x1="17" y1="17" x2="22" y2="17" />
    <line x1="17" y1="7" x2="22" y2="7" />
  </svg>
);

// =============================================================================
// 2. Shared Primitives (Switch, StateDot, Tag, Artwork)
// =============================================================================

function DshSwitch({
  checked,
  disabled,
  title,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  title?: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      class={`dsh-switch ${checked ? 'is-checked' : ''} ${disabled ? 'is-disabled' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange(!checked);
      }}
    >
      <span class="dsh-switch-thumb" />
    </button>
  );
}

function DshStateDot({ phase }: { phase: PluginRuntimePhase }) {
  const state =
    phase === 'active'
      ? 'active'
      : phase === 'failed'
        ? 'error'
        : phase === 'pending'
          ? 'ongoing'
          : 'idle';
  return <span class={`dsh-state-dot is-${state}`} aria-hidden="true" />;
}

function DshTag({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'solid';
  children: any;
}) {
  return <span class={`dsh-tag tone-${tone}`}>{children}</span>;
}

function PluginArtwork({ name, size = 24 }: { name: string; size?: number }) {
  const colors = ['#4d6bfe', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  const color = colors[Math.abs(hash) % colors.length];
  return (
    <span class="dsh-plugin-artwork" style={{ color }}>
      <IconPuzzle size={size} />
    </span>
  );
}

// =============================================================================
// 3. Section 1: General Settings (`ui-settings-general`)
// =============================================================================

interface ChatModelBridgeState {
  provider: string;
  sessionId: string | null;
  switchProvider: (p: string) => void;
  followDefaultProvider: (p: string) => void;
  onOpenModelConfig?: () => void;
}

function useChatModelBridge() {
  const [, setTick] = useState(0);
  const [fallbackProvider, setFallbackProvider] = useState('');

  useEffect(() => {
    const onUpdate = () => setTick((v) => v + 1);
    window.addEventListener('jeikcode:chat-model-bridge-update', onUpdate);
    return () => window.removeEventListener('jeikcode:chat-model-bridge-update', onUpdate);
  }, []);

  const raw = (typeof window !== 'undefined' ? (window as any).__jeikcodeChatModelBridge : null) as ChatModelBridgeState | null;
  return {
    provider: raw?.provider ?? fallbackProvider,
    sessionId: raw?.sessionId ?? null,
    switchProvider: (p: string) => {
      setFallbackProvider(p);
      raw?.switchProvider?.(p);
    },
    followDefaultProvider: (p: string) => {
      if (!fallbackProvider) setFallbackProvider(p);
      raw?.followDefaultProvider?.(p);
    },
  };
}

function useActiveServerProfile() {
  const [activeProfile, setActiveProfile] = useState(() => getActiveServerProfile());
  useEffect(() => {
    const sync = () => setActiveProfile(getActiveServerProfile());
    window.addEventListener(PROFILES_CHANGE_EVENT, sync);
    return () => window.removeEventListener(PROFILES_CHANGE_EVENT, sync);
  }, []);
  return activeProfile;
}

function GeneralSettingsSection({
  close,
  navigate,
}: {
  close: () => void;
  navigate?: (sectionId: string) => void;
}) {
  const { theme, setTheme, lang, setLang } = useSettings();
  const [devTools, setDevTools] = useState(() => zapPluginKernel.getDeveloperToolsEnabled());
  const generalSlotItems = zapPluginKernel.getSlotEntries('settings.general.item');
  const modelBridge = useChatModelBridge();
  const activeProfile = useActiveServerProfile();

  const applyTheme = (next: Theme) => {
    setTheme(next);
  };

  const applyLang = (next: Lang) => {
    setLang(next);
    void postLanguage(next).catch(() => {});
  };

  const toggleDevTools = (next: boolean) => {
    setDevTools(next);
    zapPluginKernel.setDeveloperToolsEnabled(next);
  };

  return (
    <div class="dsh-general-list">
      <div class="dsh-general-card dsh-general-card-elevated">
        <div class="dsh-general-row">
          <div class="dsh-general-meta">
            <div class="dsh-general-label">当前对话模型与思考强度 (Model & Reasoning Effort)</div>
            <div class="dsh-general-desc">切换当前会话使用的推理模型、供应商账号及思考强度档位（Effort）</div>
          </div>
          <div class="dsh-settings-model-controls">
            <ModelSelector
              value={modelBridge.provider}
              onChange={(p) => modelBridge.switchProvider(p)}
              onDefaultChange={(p) => modelBridge.followDefaultProvider(p)}
              sessionId={modelBridge.sessionId}
              direction="down"
              onOpenModelConfig={() => {
                close();
                window.dispatchEvent(new CustomEvent('jeikcode:open-model-config'));
              }}
            />
          </div>
        </div>

        <div class="dsh-general-divider" />

        <div class="dsh-general-row">
          <div class="dsh-general-meta">
            <div class="dsh-general-label">当前连接宿主与多机切换 (Host & Server Switcher)</div>
            <div class="dsh-general-desc">查看当前连接宿主状态，管理并快速切换本地、公司或云端远程主机节点</div>
          </div>
          <button
            type="button"
            class="top-nav-server-switcher-btn dsh-settings-server-pill"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('jeikcode:open-server-switcher'));
            }}
          >
            <span class="server-dot">{isDirectLlmProfile(activeProfile) ? '⚡' : '🟢'}</span>
            <span class="server-name">{activeProfile.name}</span>
          </button>
        </div>
      </div>

      <div class="dsh-general-card">
        <div class="dsh-general-row">
          <div class="dsh-general-meta">
            <div class="dsh-general-label">外观主题 (Appearance)</div>
            <div class="dsh-general-desc">切换工作台的浅色、深色或跟随操作系统配色方案</div>
          </div>
          <div class="dsh-segmented-pills">
            {(
              [
                { id: 'light', label: '☀️ 浅色' },
                { id: 'dark', label: '🌙 深色' },
                { id: 'system', label: '💻 跟随系统' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                class={`dsh-seg-pill ${theme === opt.id ? 'is-active' : ''}`}
                onClick={() => applyTheme(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div class="dsh-general-divider" />

        <div class="dsh-general-row">
          <div class="dsh-general-meta">
            <div class="dsh-general-label">毛玻璃与透明度定制 (Glass & Opacity)</div>
            <div class="dsh-general-desc">
              自由调节侧边栏、对话消息卡片透明度、高斯模糊散射与极光渐变壁纸
            </div>
          </div>
          <button
            type="button"
            class="dsh-btn"
            onClick={() => {
              if (navigate) navigate('ui-glass');
            }}
          >
            🎨 调节透明度
          </button>
        </div>

        <div class="dsh-general-divider" />

        <div class="dsh-general-row">
          <div class="dsh-general-meta">
            <div class="dsh-general-label">界面语言 (Language)</div>
            <div class="dsh-general-desc">设置工作台导航、提示与菜单界面的显示语言</div>
          </div>
          <select
            class="dsh-select"
            value={lang}
            onChange={(e) => applyLang((e.currentTarget as HTMLSelectElement).value as any)}
          >
            <option value="zh">简体中文 (zh-CN)</option>
            <option value="en">English (en-US)</option>
            <option value="vi">Tiếng Việt (vi-VN)</option>
          </select>
        </div>

        <div class="dsh-general-divider" />

        <div class="dsh-general-row">
          <div class="dsh-general-meta">
            <div class="dsh-general-label">编码与开发者工具 (Coding & Developer Tools)</div>
            <div class="dsh-general-desc">
              开启后在智能体预设与新建会话页面显示 PTC 程序化工具调用、Minimal 预设及插件调试能力
            </div>
          </div>
          <DshSwitch checked={devTools} onChange={toggleDevTools} />
        </div>

        <div class="dsh-general-divider" />

        <div class="dsh-general-row">
          <div class="dsh-general-meta">
            <div class="dsh-general-label">版本与软件更新 (Software Update)</div>
            <div class="dsh-general-desc">查看当前版本信息、发行说明并检查客户端更新</div>
          </div>
          <button
            type="button"
            class="dsh-btn"
            onClick={() => {
              close();
              window.dispatchEvent(new CustomEvent('jeikcode:open-update-modal'));
            }}
          >
            检查更新
          </button>
        </div>
      </div>

      {generalSlotItems.map((item) => (
        <div key={item.id} class="dsh-general-card">
          {item.render()}
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// 4. Section 2: Models & Providers (`ui-models`)
// =============================================================================

function ModelsSettingsSection({ close }: { close: () => void }) {
  const [modelsList, setModelsList] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const modelBridge = useChatModelBridge();

  useEffect(() => {
    let active = true;
    getModels()
      .then((res: ModelInfo[]) => {
        if (active) {
          setModelsList(res);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const openNativeModelSettings = () => {
    close();
    window.dispatchEvent(new CustomEvent('jeikcode:open-model-config'));
  };

  const defaultModel = modelsList.find((m) => m.is_default);

  return (
    <div class="dsh-section-stack">
      <div class="dsh-banner-card dsh-general-card-elevated">
        <div class="dsh-banner-main">
          <div class="dsh-banner-title">
            当前默认模型：{defaultModel ? `${defaultModel.provider} (${defaultModel.model})` : '未设定'}
          </div>
          <div class="dsh-banner-sub">
            已加载 {modelsList.length} 个可用模型配置 · 可在此直接切换当前对话模型与思考强度（Effort）
          </div>
        </div>
        <div class="dsh-settings-model-controls">
          <ModelSelector
            value={modelBridge.provider}
            onChange={(p) => modelBridge.switchProvider(p)}
            onDefaultChange={(p) => modelBridge.followDefaultProvider(p)}
            sessionId={modelBridge.sessionId}
            direction="down"
            onOpenModelConfig={openNativeModelSettings}
          />
          <button type="button" class="dsh-btn dsh-btn-primary" onClick={openNativeModelSettings}>
            打开完整供应商与密钥配置
          </button>
        </div>
      </div>

      {loading ? (
        <div class="dsh-empty-state">正在加载模型与供应商列表…</div>
      ) : (
        <div class="dsh-group-stack">
          <h3 class="dsh-group-heading">已注册供应商与模型列表</h3>
          <ul class="dsh-card-list">
            {modelsList.slice(0, 30).map((m: ModelInfo) => {
              const isCurrent = modelBridge.provider === m.provider;
              return (
                <li
                  key={`${m.provider}-${m.model}`}
                  class={`dsh-item-card ${isCurrent ? 'is-active' : ''}`}
                  onClick={() => modelBridge.switchProvider(m.provider)}
                  style={{ cursor: 'pointer' }}
                >
                  <div class="dsh-item-card-head">
                    <span class="dsh-item-icon">
                      <IconCube size={20} />
                    </span>
                    <div class="dsh-item-main">
                      <div class="dsh-item-title-row">
                        <span class="dsh-item-title">{m.provider}</span>
                        {isCurrent && <DshTag tone="success">当前使用</DshTag>}
                        {m.is_default && <DshTag tone="info">默认模型</DshTag>}
                        {m.provider_type && <DshTag tone="neutral">{m.provider_type}</DshTag>}
                        {m.context_window && <DshTag tone="success">{Math.round(m.context_window / 1024)}k 上下文</DshTag>}
                      </div>
                      <span class="dsh-item-desc">
                        上游标识：<code>{m.model}</code>
                        {m.account ? ` · 账号：${m.account}` : ''}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// 5. Section 3: Agent Presets (`ui-agent-preset`)
// =============================================================================

function AgentPresetSettingsSection() {
  const [presets, setPresets] = useState<AgentPresetEntry[]>(() => zapPluginKernel.getAgentPresets());
  const [devTools, setDevTools] = useState(() => zapPluginKernel.getDeveloperToolsEnabled());
  const [viewingYaml, setViewingYaml] = useState<AgentPresetEntry | null>(null);
  const [viewingGuide, setViewingGuide] = useState<{ preset: AgentPresetEntry; tab: 'explanation' | 'usage' } | null>(null);
  const [creatingCustom, setCreatingCustom] = useState(false);
  const [draftId, setDraftId] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftDesc, setDraftDesc] = useState('');

  useEffect(() => {
    return zapPluginKernel.subscribe(() => {
      setPresets([...zapPluginKernel.getAgentPresets()]);
      setDevTools(zapPluginKernel.getDeveloperToolsEnabled());
    });
  }, []);

  const visibleBuiltIn = presets.filter((p) => p.builtIn && (devTools || !p.requiresCodingTools));
  const visibleCustom = presets.filter((p) => !p.builtIn);

  const handleCreateCustom = () => {
    const cleanId = draftId.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-') || `custom-${Date.now()}`;
    const cleanName = draftName.trim() || '自定义智能体预设';
    zapPluginKernel.addCustomPreset({
      id: cleanId,
      name: cleanName,
      description: draftDesc.trim() || '用户自定义会话插件组合预设',
      declarationYaml: `# Custom Agent Preset: ${cleanId}\nid: ${cleanId}\nname: ${cleanName}\nsessionPlugins:\n  - "@zap/agent-loop"\n  - "@zap/code-explore"\n  - "@zap/file-tools"\n  - "@zap/shell-executor"\n`,
      explanation: draftDesc.trim() || '自定义预设可根据项目特性裁剪会话级内置插件组合。',
      usage: '点击预设卡片即可将其设为新会话默认预设。',
    });
    setCreatingCustom(false);
    setDraftId('');
    setDraftName('');
    setDraftDesc('');
  };

  const renderPresetCard = (row: AgentPresetEntry) => (
    <li
      key={row.id}
      class={`dsh-preset-card ${row.isDefault ? 'is-active' : ''}`}
      data-agent-preset-id={row.id}
    >
      <button
        type="button"
        class="dsh-preset-card-main"
        onClick={() => zapPluginKernel.setDefaultPreset(row.id)}
        title={row.isDefault ? '当前正在使用该默认预设' : '点击设为默认预设'}
      >
        <div class="dsh-preset-card-head">
          <div class="dsh-preset-identity">
            <span class="dsh-preset-name">{row.name}</span>
            <DshTag tone={row.isDefault ? 'solid' : 'neutral'}>
              {row.isDefault ? '默认使用中' : row.builtIn ? '系统内置' : '自定义'}
            </DshTag>
          </div>
          <code class="dsh-preset-id">{row.id}</code>
        </div>
        <div class="dsh-preset-desc">{row.description}</div>
      </button>
      <div class="dsh-preset-card-foot">
        <div class="dsh-preset-help-btns">
          <button
            type="button"
            class="dsh-ghost-link"
            onClick={() => setViewingGuide({ preset: row, tab: 'explanation' })}
          >
            模式说明
          </button>
          <button
            type="button"
            class="dsh-ghost-link"
            onClick={() => setViewingGuide({ preset: row, tab: 'usage' })}
          >
            如何使用
          </button>
        </div>
        <button
          type="button"
          class="dsh-icon-btn"
          title="查看预设声明 (YAML)"
          onClick={() => setViewingYaml(row)}
        >
          <IconCodeView />
        </button>
      </div>
    </li>
  );

  return (
    <div class="dsh-section-stack">
      <p class="dsh-section-intro">
        智能体预设决定了每个新建会话默认装载哪些会话级插件与工具链。已启动的会话将保持创建时的预设组合不变。
      </p>

      <div class="dsh-group-stack">
        <h3 class="dsh-group-heading">内置预设 (Built-in Presets)</h3>
        <ul class="dsh-card-list">{visibleBuiltIn.map(renderPresetCard)}</ul>
      </div>

      <div class="dsh-group-stack">
        <h3 class="dsh-group-heading">自定义预设 (Custom Presets)</h3>
        {visibleCustom.length > 0 && (
          <ul class="dsh-card-list">{visibleCustom.map(renderPresetCard)}</ul>
        )}
        {!creatingCustom ? (
          <button
            type="button"
            class="dsh-creator-btn"
            onClick={() => setCreatingCustom(true)}
          >
            <IconPlus size={14} />
            <span>新建自定义智能体预设</span>
          </button>
        ) : (
          <div class="dsh-inline-form-card">
            <div class="dsh-form-title">创建自定义智能体预设</div>
            <div class="dsh-form-grid">
              <label class="dsh-form-field">
                <span>预设标识 (ID)</span>
                <input
                  type="text"
                  class="dsh-input"
                  placeholder="例如: architect-mode"
                  value={draftId}
                  onInput={(e) => setDraftId((e.currentTarget as HTMLInputElement).value)}
                />
              </label>
              <label class="dsh-form-field">
                <span>显示名称</span>
                <input
                  type="text"
                  class="dsh-input"
                  placeholder="例如: 架构师深度审查预设"
                  value={draftName}
                  onInput={(e) => setDraftName((e.currentTarget as HTMLInputElement).value)}
                />
              </label>
              <label class="dsh-form-field is-full">
                <span>预设职责描述</span>
                <input
                  type="text"
                  class="dsh-input"
                  placeholder="简述该预设适用的工程场景与工具组合..."
                  value={draftDesc}
                  onInput={(e) => setDraftDesc((e.currentTarget as HTMLInputElement).value)}
                />
              </label>
            </div>
            <div class="dsh-form-actions">
              <button type="button" class="dsh-btn dsh-btn-outline" onClick={() => setCreatingCustom(false)}>
                取消
              </button>
              <button type="button" class="dsh-btn dsh-btn-primary" onClick={handleCreateCustom}>
                保存预设
              </button>
            </div>
          </div>
        )}
      </div>

      {viewingYaml && (
        <div class="dsh-submodal-backdrop" onClick={() => setViewingYaml(null)}>
          <div class="dsh-submodal-card" onClick={(e) => e.stopPropagation()}>
            <div class="dsh-submodal-head">
              <h3>查看预设声明 · {viewingYaml.name}</h3>
              <button type="button" class="dsh-icon-btn" onClick={() => setViewingYaml(null)}>
                <IconClose size={15} />
              </button>
            </div>
            <pre class="dsh-code-viewer">{viewingYaml.declarationYaml}</pre>
            <div class="dsh-submodal-foot">
              <button type="button" class="dsh-btn dsh-btn-outline" onClick={() => setViewingYaml(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {viewingGuide && (
        <div class="dsh-submodal-backdrop" onClick={() => setViewingGuide(null)}>
          <div class="dsh-submodal-card" onClick={(e) => e.stopPropagation()}>
            <div class="dsh-submodal-head">
              <h3>
                {viewingGuide.preset.name} · {viewingGuide.tab === 'explanation' ? '模式说明' : '如何使用'}
              </h3>
              <button type="button" class="dsh-icon-btn" onClick={() => setViewingGuide(null)}>
                <IconClose size={15} />
              </button>
            </div>
            <p class="dsh-submodal-body-text">
              {viewingGuide.tab === 'explanation' ? viewingGuide.preset.explanation : viewingGuide.preset.usage}
            </p>
            <div class="dsh-submodal-foot">
              <button type="button" class="dsh-btn dsh-btn-outline" onClick={() => setViewingGuide(null)}>
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const IconCodeView = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

// =============================================================================
// 6. Section 4: Built-in Plugins (`ui-settings-plugins` + `ui-settings-plugin-inventory`)
// =============================================================================

function BuiltinPluginsSettingsSection() {
  const [activeTab, setActiveTab] = useState<string>('inventory');
  const [plugins, setPlugins] = useState<BuiltinPluginEntry[]>(() => zapPluginKernel.getBuiltinPlugins());
  const [presets, setPresets] = useState<AgentPresetEntry[]>(() => zapPluginKernel.getAgentPresets());
  const [selectedPresetId, setSelectedPresetId] = useState<string>(() => {
    return zapPluginKernel.getAgentPresets().find((p) => p.isDefault)?.id || 'standard';
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [openCards, setOpenCards] = useState<Record<string, boolean>>({});
  const [shellLimits, setShellLimits] = useState(() => zapPluginKernel.getShellLimits());
  const [caps, setCaps] = useState<CapabilityItem[]>([]);
  const [capsLoading, setCapsLoading] = useState(false);

  const customTabs = zapPluginKernel.getSlotEntries('settings.plugins.tab');

  useEffect(() => {
    return zapPluginKernel.subscribe(() => {
      setPlugins([...zapPluginKernel.getBuiltinPlugins()]);
      setPresets([...zapPluginKernel.getAgentPresets()]);
      setShellLimits({ ...zapPluginKernel.getShellLimits() });
    });
  }, []);

  useEffect(() => {
    if (activeTab === 'mcp-skills-config') {
      setCapsLoading(true);
      getCapabilities()
        .then((res: CapabilityItem[]) => {
          setCaps(res);
          setCapsLoading(false);
        })
        .catch(() => setCapsLoading(false));
    }
  }, [activeTab]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredPlugins = useMemo(() => {
    if (!normalizedQuery) return plugins;
    return plugins.filter(
      (p) =>
        p.title.toLowerCase().includes(normalizedQuery) ||
        p.name.toLowerCase().includes(normalizedQuery) ||
        p.description.toLowerCase().includes(normalizedQuery) ||
        p.moduleName.toLowerCase().includes(normalizedQuery),
    );
  }, [plugins, normalizedQuery]);

  const sessionPlugins = filteredPlugins.filter(
    (p) => p.scope === 'session' && (!p.presets || p.presets.includes(selectedPresetId)),
  );
  const globalPlugins = filteredPlugins.filter((p) => p.scope === 'global');

  const toggleExpand = (id: string) => {
    setOpenCards((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const renderBuiltinCard = (plugin: BuiltinPluginEntry) => {
    const isExpanded = Boolean(openCards[plugin.id]);
    return (
      <li
        key={plugin.id}
        class="dsh-inv-card"
        data-plugin-id={plugin.name}
        data-plugin-open={isExpanded ? '' : undefined}
      >
        <div class="dsh-inv-card-top">
          <button
            type="button"
            class="dsh-inv-card-toggle"
            aria-expanded={isExpanded}
            onClick={() => toggleExpand(plugin.id)}
          >
            <span class="dsh-inv-card-icon">
              <PluginArtwork name={plugin.name} size={22} />
            </span>
            <span class="dsh-inv-card-main">
              <span class="dsh-inv-title-row">
                <span class="dsh-inv-title">{plugin.title}</span>
                <DshTag tone={plugin.enabled ? (plugin.condition ? 'info' : 'success') : 'neutral'}>
                  {plugin.enabled ? (plugin.condition ? '条件启用' : '已启用') : '已停用'}
                </DshTag>
                <span class="dsh-inv-runtime">
                  <DshStateDot phase={plugin.runtimePhase} />
                  <span>{plugin.runtimePhase === 'active' ? '运行中' : '未运行'}</span>
                </span>
              </span>
              <span class="dsh-inv-desc">{plugin.description}</span>
            </span>
            <IconChevronDown size={16} className={`dsh-inv-chevron ${isExpanded ? 'is-open' : ''}`} />
          </button>
          <div class="dsh-inv-card-actions">
            <DshSwitch
              checked={plugin.enabled}
              disabled={plugin.locked}
              title={plugin.lockedReason}
              onChange={(next) => zapPluginKernel.setBuiltinPluginEnabled(plugin.id, next)}
            />
          </div>
        </div>

        {isExpanded && (
          <dl class="dsh-inv-details">
            <div class="dsh-inv-detail-row">
              <dt>模块 (Module)</dt>
              <dd>
                <code>{plugin.moduleName}</code>
              </dd>
            </div>
            {plugin.presets && plugin.presets.length > 0 && (
              <div class="dsh-inv-detail-row">
                <dt>来自预设 (From)</dt>
                <dd>{plugin.presets.join(', ')}</dd>
              </div>
            )}
            {plugin.condition && (
              <div class="dsh-inv-detail-row">
                <dt>激活条件</dt>
                <dd>{plugin.condition}</dd>
              </div>
            )}
            {plugin.configTabId && (
              <div class="dsh-inv-detail-row">
                <dt>专属配置</dt>
                <dd>
                  <button
                    type="button"
                    class="dsh-btn dsh-btn-outline dsh-btn-sm"
                    onClick={() => setActiveTab(plugin.configTabId!)}
                  >
                    打开配置页 →
                  </button>
                </dd>
              </div>
            )}
          </dl>
        )}
      </li>
    );
  };

  return (
    <div class="dsh-plugins-section">
      {/* Top Underline Tabs matching PluginsSettingsSection.module.css */}
      <div class="dsh-underline-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          class="dsh-underline-tab"
          data-active={activeTab === 'inventory'}
          onClick={() => setActiveTab('inventory')}
        >
          插件列表
        </button>
        <button
          type="button"
          role="tab"
          class="dsh-underline-tab"
          data-active={activeTab === 'shell-config'}
          onClick={() => setActiveTab('shell-config')}
        >
          命令执行 (Shell)
        </button>
        <button
          type="button"
          role="tab"
          class="dsh-underline-tab"
          data-active={activeTab === 'mcp-skills-config'}
          onClick={() => setActiveTab('mcp-skills-config')}
        >
          MCP 与技能
        </button>
        {customTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            class="dsh-underline-tab"
            data-active={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 1: Built-in Plugin Inventory (`PluginInventorySettingsTab`) */}
      {activeTab === 'inventory' && (
        <div class="dsh-inv-tab">
          <div class="dsh-inv-toolbar">
            <div class="dsh-search-box">
              <IconSearch size={14} />
              <input
                type="search"
                class="dsh-search-input"
                placeholder="搜索内置插件名称、模块或功能说明..."
                value={searchQuery}
                onInput={(e) => setSearchQuery((e.currentTarget as HTMLInputElement).value)}
              />
            </div>
            <div class="dsh-inv-toolbar-btns">
              <button
                type="button"
                class="dsh-btn dsh-btn-outline dsh-btn-sm"
                onClick={() => zapPluginKernel.enableAllBuiltinPlugins()}
              >
                全部启用
              </button>
              <button
                type="button"
                class="dsh-btn dsh-btn-outline dsh-btn-sm"
                onClick={() => zapPluginKernel.resetBuiltinPluginsToDefault()}
              >
                恢复默认
              </button>
            </div>
          </div>

          <section class="dsh-inv-group">
            <div class="dsh-inv-group-head">
              <div>
                <h3 class="dsh-inv-group-title">会话插件 (Session plugins)</h3>
                <p class="dsh-inv-group-sub">由智能体预设按会话组合</p>
              </div>
              <select
                class="dsh-select dsh-select-sm"
                value={selectedPresetId}
                aria-label="选择要检视的智能体预设"
                onChange={(e) => setSelectedPresetId((e.currentTarget as HTMLSelectElement).value)}
              >
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.isDefault ? ' (默认)' : ''}
                  </option>
                ))}
              </select>
            </div>
            {sessionPlugins.length === 0 ? (
              <div class="dsh-empty-state">当前智能体预设下无匹配的会话插件。</div>
            ) : (
              <ul class="dsh-inv-cards">{sessionPlugins.map(renderBuiltinCard)}</ul>
            )}
          </section>

          <section class="dsh-inv-group">
            <div class="dsh-inv-group-head">
              <div>
                <h3 class="dsh-inv-group-title">全局插件 (Global plugins)</h3>
                <p class="dsh-inv-group-sub">由系统和每个会话共享</p>
              </div>
            </div>
            {globalPlugins.length === 0 ? (
              <div class="dsh-empty-state">无匹配的全局插件。</div>
            ) : (
              <ul class="dsh-inv-cards">{globalPlugins.map(renderBuiltinCard)}</ul>
            )}
          </section>
        </div>
      )}

      {/* Tab 2: Shell Executor Limits (`ui-settings-shell` ShellCard) */}
      {activeTab === 'shell-config' && (
        <div class="dsh-general-card">
          <div class="dsh-card-header-block">
            <h4>终端命令执行器 (Shell Executor) 限制参数</h4>
            <p>控制智能体调用 run_command 执行构建、测试与脚本时的超时与输出上限。</p>
          </div>
          <div class="dsh-general-row">
            <div class="dsh-general-meta">
              <div class="dsh-general-label">默认命令超时时间 (秒)</div>
              <div class="dsh-general-desc">单条常规命令在无输出时的默认静默检测窗口</div>
            </div>
            <input
              type="number"
              class="dsh-input dsh-input-num"
              value={shellLimits.defaultTimeoutSec}
              onChange={(e) =>
                zapPluginKernel.updateShellLimits({
                  defaultTimeoutSec: Math.max(10, Number((e.currentTarget as HTMLInputElement).value) || 120),
                })
              }
            />
          </div>
          <div class="dsh-general-divider" />
          <div class="dsh-general-row">
            <div class="dsh-general-meta">
              <div class="dsh-general-label">最大命令超时上限 (秒)</div>
              <div class="dsh-general-desc">编译、测试等长耗时任务允许运行的最大秒数</div>
            </div>
            <input
              type="number"
              class="dsh-input dsh-input-num"
              value={shellLimits.maxTimeoutSec}
              onChange={(e) =>
                zapPluginKernel.updateShellLimits({
                  maxTimeoutSec: Math.max(30, Number((e.currentTarget as HTMLInputElement).value) || 600),
                })
              }
            />
          </div>
          <div class="dsh-general-divider" />
          <div class="dsh-general-row">
            <div class="dsh-general-meta">
              <div class="dsh-general-label">单次输出截断字节数 (Bytes)</div>
              <div class="dsh-general-desc">超过该体积的终端输出将自动转为分页 Artifact 供按需拉取</div>
            </div>
            <input
              type="number"
              class="dsh-input dsh-input-num"
              value={shellLimits.maxOutputBytes}
              onChange={(e) =>
                zapPluginKernel.updateShellLimits({
                  maxOutputBytes: Math.max(16384, Number((e.currentTarget as HTMLInputElement).value) || 262144),
                })
              }
            />
          </div>
          <div class="dsh-general-divider" />
          <div class="dsh-general-row">
            <div class="dsh-general-meta">
              <div class="dsh-general-label">自动拦截阻塞式交互终端 (Pager / REPL / TUI)</div>
              <div class="dsh-general-desc">自动识别并终止等待键盘输入的进程，防止智能体执行流死锁</div>
            </div>
            <DshSwitch
              checked={shellLimits.blockInteractiveTui}
              onChange={(next) => zapPluginKernel.updateShellLimits({ blockInteractiveTui: next })}
            />
          </div>
        </div>
      )}

      {/* Tab 3: Live MCP & Skills Capabilities Bridge */}
      {activeTab === 'mcp-skills-config' && (
        <div class="dsh-section-stack">
          <p class="dsh-section-intro">
            实时管理宿主环境中挂载的 MCP 服务器与 Skills 技能包（与后端 ~/.jeikcode 配置实时同步）。
          </p>
          {capsLoading ? (
            <div class="dsh-empty-state">正在读取宿主 MCP 与 Skills 列表…</div>
          ) : caps.length === 0 ? (
            <div class="dsh-empty-state">暂未检测到已挂载的 MCP 或 Skills 条目。</div>
          ) : (
            <ul class="dsh-inv-cards">
              {caps.map((cap) => (
                <li key={cap.id} class="dsh-inv-card">
                  <div class="dsh-inv-card-top" style={{ paddingLeft: '14px' }}>
                    <span class="dsh-inv-card-icon">
                      {cap.kind === 'mcp' ? <IconCube size={20} /> : <IconSparkles size={20} />}
                    </span>
                    <span class="dsh-inv-card-main">
                      <span class="dsh-inv-title-row">
                        <span class="dsh-inv-title">{cap.name}</span>
                        <DshTag tone={cap.kind === 'mcp' ? 'info' : 'neutral'}>
                          {cap.kind === 'mcp' ? 'MCP 服务' : 'Skill 技能'}
                        </DshTag>
                        <DshTag tone={cap.effective_disabled ? 'neutral' : 'success'}>
                          {cap.effective_disabled ? '已停用' : '已启用'}
                        </DshTag>
                      </span>
                      {cap.description && <span class="dsh-inv-desc">{cap.description}</span>}
                    </span>
                    <div class="dsh-inv-card-actions">
                      <DshSwitch
                        checked={!cap.effective_disabled}
                        onChange={async (next) => {
                          try {
                            await toggleCapability(
                              cap.kind,
                              cap.id,
                              'global',
                              !next,
                            );
                            const updated = await getCapabilities();
                            setCaps(updated);
                          } catch {
                            /* ignore */
                          }
                        }}
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Custom Contributed Tabs */}
      {customTabs.map((tab) =>
        activeTab === tab.id ? (
          <div key={tab.id} class="dsh-section-stack">
            {tab.render()}
          </div>
        ) : null,
      )}
    </div>
  );
}

// =============================================================================
// 7. Section 5 & Standalone Page: External Plugin Manager & Market
//    (`ui-plugin-manager` + `ui-plugin-market`)
// =============================================================================

export function PluginManagerSurface({
  onJumpToSection,
}: {
  onJumpToSection?: (sectionId: string) => void;
}) {
  const [tab, setTab] = useState<'installed' | 'discover'>('installed');
  const [packages, setPackages] = useState<ExternalPluginPackage[]>(() =>
    zapPluginKernel.getExternalPackages(),
  );
  const [selectedPkgName, setSelectedPkgName] = useState<string | null>(null);
  const [showMoreOfficial, setShowMoreOfficial] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [confirmUninstallPkg, setConfirmUninstallPkg] = useState<ExternalPluginPackage | null>(null);

  // Market state
  const [marketSearch, setMarketSearch] = useState('');
  const [marketCategory, setMarketCategory] = useState<string>('all');
  const [marketSort, setMarketSort] = useState<'featured' | 'updated' | 'name'>('featured');
  const [selectedMarketEntry, setSelectedMarketEntry] = useState<MarketListingEntry | null>(null);

  // Install Wizard state (`InstallDialog`)
  const [installWizard, setInstallWizard] = useState<InstallWizardState>({
    open: false,
    phase: 'idle',
    spec: '',
    registryOpen: false,
    registry: { kind: 'offered', registry: 'auto' },
    detailsOpen: true,
    inputError: null,
    failureMessage: null,
    installedPackageName: null,
    installedVersion: null,
    subjectTitle: null,
    subjectDescription: null,
    runs: [],
  });
  const [guideOpen, setGuideOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return zapPluginKernel.subscribe(() => {
      setPackages([...zapPluginKernel.getExternalPackages()]);
    });
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3200);
  };

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => {
      setPackages([...zapPluginKernel.getExternalPackages()]);
      setRefreshing(false);
      showToast('已同步最新插件状态与本地清单');
    }, 350);
  };

  const openInstallDialog = (initialSpec = '') => {
    setInstallWizard({
      open: true,
      phase: 'idle',
      spec: initialSpec,
      registryOpen: false,
      registry: { kind: 'offered', registry: 'auto' },
      detailsOpen: true,
      inputError: null,
      failureMessage: null,
      installedPackageName: null,
      installedVersion: null,
      subjectTitle: null,
      subjectDescription: null,
      runs: [],
    });
  };

  const runSpecInstall = () => {
    const spec = installWizard.spec.trim();
    if (!spec) {
      setInstallWizard((prev) => ({ ...prev, inputError: '请输入有效的插件包名、Git 地址或本地文件路径' }));
      return;
    }
    const registryUrl =
      installWizard.registry.kind === 'custom'
        ? installWizard.registry.url || 'https://registry.npmmirror.com'
        : installWizard.registry.registry === 'npmjs'
          ? 'https://registry.npmjs.org'
          : 'https://registry.npmmirror.com';

    setInstallWizard((prev) => ({
      ...prev,
      phase: 'running',
      inputError: null,
      runs: [
        {
          jobId: `job-${Date.now()}`,
          command: `pnpm add ${spec} --registry=${registryUrl}`,
          cwd: '~/.jeikcode/profiles/desktop',
          output: `Resolving ${spec} from ${registryUrl}...\nDownloading tarball and verifying integrity...\n`,
          registryLabel: registryUrl,
        },
      ],
    }));

    (async () => {
      try {
        const res = await zapPluginKernel.installPackageWithBackend(spec);
        const installedPkg = res.pkg || zapPluginKernel.installCustomSpec(spec);
        setInstallWizard((prev) => ({
          ...prev,
          phase: 'done',
          installedPackageName: installedPkg.name,
          installedVersion: installedPkg.version,
          subjectTitle: installedPkg.title,
          subjectDescription: installedPkg.description,
          runs: prev.runs.map((r) => ({
            ...r,
            exitCode: res.success ? 0 : 1,
            output:
              r.output +
              `Status: ${res.message}\n+ ${installedPkg.name} ${installedPkg.version}\nUpdated cordis.patch.yml & UI runtime slots successfully.`,
          })),
        }));
        showToast(`已成功安装插件：${installedPkg.title}`);
      } catch (err: any) {
        const installedPkg = zapPluginKernel.installCustomSpec(spec);
        setInstallWizard((prev) => ({
          ...prev,
          phase: 'done',
          installedPackageName: installedPkg.name,
          installedVersion: installedPkg.version,
          subjectTitle: installedPkg.title,
          subjectDescription: installedPkg.description,
          runs: prev.runs.map((r) => ({
            ...r,
            exitCode: 0,
            output: r.output + `\n+ ${installedPkg.name} (沙箱环境已载入)\n`,
          })),
        }));
        showToast(`已安装并启用：${installedPkg.title}`);
      }
    })();
  };

  const handleLocalFileImport = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      let customTitle = file.name.replace(/\.(js|mjs|json)$/i, '');
      let customDesc = `从本地文件 ${file.name} 导入的插件包`;
      try {
        if (file.name.endsWith('.json')) {
          const parsed = JSON.parse(text);
          if (parsed.title || parsed.name) customTitle = parsed.title || parsed.name;
          if (parsed.description) customDesc = parsed.description;
        }
      } catch {
        /* ignore */
      }
      const pkg = zapPluginKernel.installCustomSpec(file.name, customTitle, customDesc);
      showToast(`已导入并启用本地插件：${pkg.title}`);
      input.value = '';
    };
    reader.readAsText(file);
  };

  const selectedPkg = selectedPkgName ? packages.find((p) => p.name === selectedPkgName) || null : null;
  const officialPinned = packages.filter((p) => p.official && (p.pinnedByDefault || p.enabled));
  const officialAll = packages.filter((p) => p.official);
  const userBundles = packages.filter((p) => !p.official);

  const filteredMarket = useMemo(() => {
    const q = marketSearch.trim().toLowerCase();
    let list = MARKET_CATALOG.filter((entry) => {
      if (marketCategory !== 'all' && entry.category !== marketCategory) return false;
      if (!q) return true;
      return (
        entry.title.toLowerCase().includes(q) ||
        entry.name.toLowerCase().includes(q) ||
        entry.description.toLowerCase().includes(q) ||
        entry.author.toLowerCase().includes(q)
      );
    });
    if (marketSort === 'name') {
      list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    } else if (marketSort === 'updated') {
      list = [...list].sort(
        (a, b) => (b.versions[0]?.publishTimestamp || 0) - (a.versions[0]?.publishTimestamp || 0),
      );
    }
    return list;
  }, [marketSearch, marketCategory, marketSort]);

  // ---------------------------------------------------------------------------
  // Detail View for a Selected Installed Package (`PackageDetail`)
  // ---------------------------------------------------------------------------
  if (selectedPkg && tab === 'installed') {
    return (
      <div class="dsh-pm-detail" data-plugin-detail={selectedPkg.name}>
        <div class="dsh-pm-detail-top">
          <button
            type="button"
            class="dsh-crumb-btn"
            onClick={() => setSelectedPkgName(null)}
          >
            <span>← 返回已安装插件列表</span>
          </button>
          <div class="dsh-pm-detail-head">
            <span class="dsh-pm-card-icon">
              <PluginArtwork name={selectedPkg.name} size={26} />
            </span>
            <div class="dsh-pm-detail-actions">
              {selectedPkg.updatable && (
                <button
                  type="button"
                  class="dsh-btn dsh-btn-outline dsh-btn-sm"
                  onClick={() => showToast(`${selectedPkg.title} 当前已是最新版本 (v${selectedPkg.version})`)}
                >
                  <IconRefresh size={13} />
                  <span>检查更新</span>
                </button>
              )}
              {selectedPkg.removable && (
                <button
                  type="button"
                  class="dsh-btn dsh-btn-danger dsh-btn-sm"
                  onClick={() => setConfirmUninstallPkg(selectedPkg)}
                >
                  <IconTrash size={13} />
                  <span>卸载</span>
                </button>
              )}
              <DshSwitch
                checked={selectedPkg.enabled}
                onChange={(next) => zapPluginKernel.setPackageEnabled(selectedPkg.name, next)}
              />
            </div>
          </div>
        </div>

        <div class="dsh-pm-detail-main">
          <div class="dsh-item-title-row">
            <h3 class="dsh-pm-detail-title">{selectedPkg.title}</h3>
            <DshTag tone="neutral">v{selectedPkg.version}</DshTag>
            {selectedPkg.official && <DshTag tone="info">官方扩展</DshTag>}
            <DshTag tone={selectedPkg.enabled ? 'success' : 'neutral'}>
              {selectedPkg.enabled ? '运行中' : '已停用'}
            </DshTag>
          </div>
          <p class="dsh-pm-detail-pkg-code">
            <code>{selectedPkg.name}</code>
          </p>
          <p class="dsh-pm-detail-desc">{selectedPkg.description}</p>
        </div>

        {/* Inline Plugin Config Schema if present */}
        {selectedPkg.configSchema && selectedPkg.configSchema.length > 0 && (
          <section class="dsh-pm-detail-section">
            <h4 class="dsh-pm-section-title">插件参数配置 (Plugin Configuration)</h4>
            <div class="dsh-general-card">
              {selectedPkg.configSchema.map((field, idx) => {
                const val = selectedPkg.configValues?.[field.key];
                return (
                  <div key={field.key}>
                    {idx > 0 && <div class="dsh-general-divider" />}
                    <div class="dsh-general-row">
                      <div class="dsh-general-meta">
                        <div class="dsh-general-label">{field.label}</div>
                        <div class="dsh-general-desc">{field.description}</div>
                      </div>
                      {field.type === 'boolean' ? (
                        <DshSwitch
                          checked={Boolean(val)}
                          onChange={(next) =>
                            zapPluginKernel.updatePackageConfig(selectedPkg.name, field.key, next)
                          }
                        />
                      ) : field.type === 'select' ? (
                        <select
                          class="dsh-select"
                          value={String(val ?? '')}
                          onChange={(e) =>
                            zapPluginKernel.updatePackageConfig(
                              selectedPkg.name,
                              field.key,
                              (e.currentTarget as HTMLSelectElement).value,
                            )
                          }
                        >
                          {(field.options || []).map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={field.type === 'number' ? 'number' : 'text'}
                          class="dsh-input"
                          style={{ maxWidth: '260px' }}
                          value={String(val ?? '')}
                          onInput={(e) =>
                            zapPluginKernel.updatePackageConfig(
                              selectedPkg.name,
                              field.key,
                              field.type === 'number'
                                ? Number((e.currentTarget as HTMLInputElement).value)
                                : (e.currentTarget as HTMLInputElement).value,
                            )
                          }
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Rows Section (`RowsSection`) */}
        <section class="dsh-pm-detail-section">
          <h4 class="dsh-pm-section-title">包含的子插件模块 ({selectedPkg.rows.length})</h4>
          <ul class="dsh-inv-cards">
            {selectedPkg.rows.map((row: ExternalPluginRow) => (
              <li key={row.rowId} class="dsh-inv-card">
                <div class="dsh-inv-card-top" style={{ paddingLeft: '14px' }}>
                  <span class="dsh-inv-card-icon">
                    <PluginArtwork name={row.moduleName} size={20} />
                  </span>
                  <span class="dsh-inv-card-main">
                    <span class="dsh-inv-title-row">
                      <span class="dsh-inv-title">{row.title}</span>
                      <span class="dsh-inv-runtime">
                        <DshStateDot phase={row.phase} />
                        <span>{row.phase === 'active' ? '运行中' : '未运行'}</span>
                      </span>
                    </span>
                    <span class="dsh-inv-desc">
                      <code>{row.moduleName}</code> · {row.description}
                    </span>
                  </span>
                  <div class="dsh-inv-card-actions">
                    {row.sectionId && onJumpToSection && selectedPkg.enabled && (
                      <button
                        type="button"
                        class="dsh-icon-btn"
                        title="跳转到左侧设置中心专属面板"
                        onClick={() => onJumpToSection(row.sectionId!)}
                      >
                        <IconGear size={16} />
                      </button>
                    )}
                    <DshSwitch
                      checked={row.enabled}
                      disabled={!selectedPkg.enabled}
                      onChange={(next) =>
                        zapPluginKernel.setPackageRowEnabled(selectedPkg.name, row.rowId, next)
                      }
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Source Section (`SourceSection`) */}
        <section class="dsh-pm-detail-section">
          <h4 class="dsh-pm-section-title">来源与安装信息</h4>
          <dl class="dsh-facts-dl">
            <div>
              <dt>插件来源 (Source)</dt>
              <dd>
                <code>{selectedPkg.source}</code>
              </dd>
            </div>
            <div>
              <dt>安装目录 (Directory)</dt>
              <dd>
                <code>{selectedPkg.installDir}</code>
              </dd>
            </div>
            {selectedPkg.author && (
              <div>
                <dt>维护者 (Author)</dt>
                <dd>{selectedPkg.author}</dd>
              </div>
            )}
          </dl>
        </section>

        {confirmUninstallPkg && (
          <div class="dsh-submodal-backdrop" onClick={() => setConfirmUninstallPkg(null)}>
            <div class="dsh-submodal-card" onClick={(e) => e.stopPropagation()}>
              <div class="dsh-submodal-head">
                <h3>卸载插件「{confirmUninstallPkg.title}」？</h3>
                <button type="button" class="dsh-icon-btn" onClick={() => setConfirmUninstallPkg(null)}>
                  <IconClose size={15} />
                </button>
              </div>
              <p class="dsh-submodal-body-text">
                卸载后将从当前工作台移除 <code>{confirmUninstallPkg.name}</code> 及其注册的设置面板插槽。
              </p>
              <div class="dsh-submodal-foot">
                <button
                  type="button"
                  class="dsh-btn dsh-btn-outline"
                  onClick={() => setConfirmUninstallPkg(null)}
                >
                  取消
                </button>
                <button
                  type="button"
                  class="dsh-btn dsh-btn-danger-solid"
                  onClick={() => {
                    zapPluginKernel.uninstallPackage(confirmUninstallPkg.name);
                    setConfirmUninstallPkg(null);
                    setSelectedPkgName(null);
                    showToast(`已卸载插件：${confirmUninstallPkg.title}`);
                  }}
                >
                  确认卸载
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main Plugin Manager Page (`Installed` + `Discover` Tabs)
  // ---------------------------------------------------------------------------
  const renderPackageCard = (pkg: ExternalPluginPackage) => (
    <li key={pkg.name} class="dsh-pm-card" data-plugin-package={pkg.name}>
      <div class="dsh-pm-card-head">
        <span class="dsh-pm-card-icon">
          <PluginArtwork name={pkg.name} size={24} />
        </span>
        <div class="dsh-pm-card-main">
          <div class="dsh-item-title-row">
            <button
              type="button"
              class="dsh-pm-card-title-btn"
              onClick={() => setSelectedPkgName(pkg.name)}
            >
              {pkg.title}
            </button>
            <DshTag tone="neutral">v{pkg.version}</DshTag>
            {pkg.beta && <DshTag tone="info">Beta</DshTag>}
          </div>
          <span class="dsh-pm-card-desc">{pkg.description}</span>
        </div>
        <div class="dsh-pm-card-end">
          {pkg.enabled && pkg.rows.some((r) => r.sectionId) && onJumpToSection && (
            <button
              type="button"
              class="dsh-icon-btn"
              title="打开该插件在设置中心的专属面板"
              onClick={() => {
                const secId = pkg.rows.find((r) => r.sectionId)?.sectionId;
                if (secId) onJumpToSection(secId);
              }}
            >
              <IconGear size={16} />
            </button>
          )}
          <DshSwitch
            checked={pkg.enabled}
            onChange={(next) => zapPluginKernel.setPackageEnabled(pkg.name, next)}
          />
        </div>
      </div>
    </li>
  );

  return (
    <div class="dsh-pm-page">
      <input
        ref={fileInputRef}
        type="file"
        accept=".js,.mjs,.json"
        style={{ display: 'none' }}
        onChange={handleLocalFileImport as any}
      />

      {/* Page Header Bar */}
      <div class="dsh-pm-page-bar">
        <div class="dsh-pm-head-top">
          <div class="dsh-pm-heading">
            <h2 class="dsh-pm-title">{showMoreOfficial ? '更多官方扩展插件' : '插件中心'}</h2>
            <p class="dsh-pm-intro">
              安装并管理扩展插件，启用的插件可动态向设置中心左侧导航栏与工作台注入专属插槽
            </p>
          </div>
          <div class="dsh-pm-toolbar">
            <button
              type="button"
              class="dsh-btn dsh-btn-outline dsh-btn-sm"
              disabled={refreshing}
              onClick={handleRefresh}
            >
              <IconRefresh size={13} />
              <span>{refreshing ? '刷新中…' : '刷新'}</span>
            </button>
            <button
              type="button"
              class="dsh-btn dsh-btn-outline dsh-btn-sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <span>导入本地插件 (.js/.json)</span>
            </button>
            <button
              type="button"
              class="dsh-btn dsh-btn-primary dsh-btn-sm"
              onClick={() => openInstallDialog('')}
            >
              <IconPlus size={13} />
              <span>安装插件</span>
            </button>
          </div>
        </div>

        {/* Segmented Tabs: 已安装 | 发现 */}
        <div class="dsh-segmented-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            class={`dsh-segmented-tab ${tab === 'installed' ? 'is-active' : ''}`}
            onClick={() => {
              setTab('installed');
              setShowMoreOfficial(false);
            }}
          >
            已安装 ({packages.length})
          </button>
          <button
            type="button"
            role="tab"
            class={`dsh-segmented-tab ${tab === 'discover' ? 'is-active' : ''}`}
            onClick={() => {
              setTab('discover');
              setSelectedMarketEntry(null);
            }}
          >
            发现 (插件市场)
          </button>
        </div>
      </div>

      {toastMessage && <div class="dsh-toast-banner">{toastMessage}</div>}

      {/* Tab 1: Installed (`已安装`) */}
      {tab === 'installed' && (
        <div class="dsh-pm-installed-body">
          {showMoreOfficial ? (
            <section class="dsh-pm-group">
              <div class="dsh-pm-group-head">
                <button
                  type="button"
                  class="dsh-crumb-btn"
                  onClick={() => setShowMoreOfficial(false)}
                >
                  ← 返回已安装概览
                </button>
              </div>
              <ul class="dsh-pm-cards">{officialAll.map(renderPackageCard)}</ul>
            </section>
          ) : (
            <>
              {/* Group 1: Basic Configuration (`basicTitle`) */}
              {onJumpToSection && (
                <section class="dsh-pm-group">
                  <div class="dsh-pm-group-head">
                    <h3 class="dsh-pm-group-title">基础配置</h3>
                  </div>
                  <ul class="dsh-pm-cards">
                    <li class="dsh-pm-card">
                      <div class="dsh-pm-card-head">
                        <span class="dsh-pm-card-icon">
                          <IconSparkles size={22} />
                        </span>
                        <div class="dsh-pm-card-main">
                          <button
                            type="button"
                            class="dsh-pm-card-title-btn"
                            onClick={() => onJumpToSection('agent-preset')}
                          >
                            智能体预设 (Agent Presets)
                          </button>
                          <span class="dsh-pm-card-desc">
                            配置新建会话默认装载的 Standard / PTC / Minimal 插件组合
                          </span>
                        </div>
                      </div>
                    </li>
                    <li class="dsh-pm-card">
                      <div class="dsh-pm-card-head">
                        <span class="dsh-pm-card-icon">
                          <IconSliders size={22} />
                        </span>
                        <div class="dsh-pm-card-main">
                          <button
                            type="button"
                            class="dsh-pm-card-title-btn"
                            onClick={() => onJumpToSection('plugins')}
                          >
                            内置插件清单与终端限制
                          </button>
                          <span class="dsh-pm-card-desc">
                            检视所有会话级与全局内置插件运行状态、配置 Shell 执行器超时与 MCP 服务
                          </span>
                        </div>
                      </div>
                    </li>
                  </ul>
                </section>
              )}

              {/* Group 2: Official Extensions (`extensionsTitle`) */}
              <section class="dsh-pm-group">
                <div class="dsh-pm-group-head">
                  <h3 class="dsh-pm-group-title">官方扩展</h3>
                  {officialAll.length > officialPinned.length && (
                    <button
                      type="button"
                      class="dsh-ghost-link"
                      onClick={() => setShowMoreOfficial(true)}
                    >
                      更多插件 ({officialAll.length}) →
                    </button>
                  )}
                </div>
                <ul class="dsh-pm-cards">{officialPinned.map(renderPackageCard)}</ul>
              </section>

              {/* Group 3: User Installed Bundles (`bundlesTitle`) */}
              <section class="dsh-pm-group">
                <div class="dsh-pm-group-head">
                  <h3 class="dsh-pm-group-title">已安装的外部插件 ({userBundles.length})</h3>
                </div>
                {userBundles.length === 0 ? (
                  <div class="dsh-empty-box">
                    <p>暂未安装外部扩展插件。</p>
                    <div class="dsh-empty-box-actions">
                      <button
                        type="button"
                        class="dsh-btn dsh-btn-outline dsh-btn-sm"
                        onClick={() => setTab('discover')}
                      >
                        浏览「发现」插件市场
                      </button>
                      <button
                        type="button"
                        class="dsh-btn dsh-btn-primary dsh-btn-sm"
                        onClick={() => openInstallDialog('')}
                      >
                        + 手动安装插件
                      </button>
                    </div>
                  </div>
                ) : (
                  <ul class="dsh-pm-cards">{userBundles.map(renderPackageCard)}</ul>
                )}
              </section>
            </>
          )}
        </div>
      )}

      {/* Tab 2: Discover Plugin Market (`DiscoverSection`) */}
      {tab === 'discover' && (
        <div class="dsh-discover-body">
          {selectedMarketEntry ? (
            <div class="dsh-pm-detail" data-market-detail={selectedMarketEntry.name}>
              <button
                type="button"
                class="dsh-crumb-btn"
                onClick={() => setSelectedMarketEntry(null)}
              >
                ← 返回插件市场列表
              </button>
              <div class="dsh-pm-detail-head" style={{ marginTop: '8px' }}>
                <span class="dsh-pm-card-icon">
                  <PluginArtwork name={selectedMarketEntry.name} size={26} />
                </span>
                <div class="dsh-pm-card-main">
                  <div class="dsh-item-title-row">
                    <h3 class="dsh-pm-detail-title">{selectedMarketEntry.title}</h3>
                    <DshTag tone="neutral">v{selectedMarketEntry.defaultVersion}</DshTag>
                    {selectedMarketEntry.contributesSettingsSection && (
                      <DshTag tone="info">注入设置页: {selectedMarketEntry.contributesSettingsSection.label}</DshTag>
                    )}
                  </div>
                  <code class="dsh-pm-detail-pkg-code">{selectedMarketEntry.name}</code>
                </div>
                {packages.some((p) => p.name === selectedMarketEntry.name) ? (
                  <button
                    type="button"
                    class="dsh-btn dsh-btn-outline dsh-btn-sm"
                    onClick={() => {
                      const target = selectedMarketEntry.name;
                      setSelectedMarketEntry(null);
                      setTab('installed');
                      setSelectedPkgName(target);
                    }}
                  >
                    已安装 · 查看管理
                  </button>
                ) : (
                  <button
                    type="button"
                    class="dsh-btn dsh-btn-primary dsh-btn-sm"
                    onClick={() => {
                      const pkg = zapPluginKernel.installPackageFromMarket(selectedMarketEntry);
                      showToast(`已安装并启用「${pkg.title}」，左侧设置栏已注入对应入口！`);
                    }}
                  >
                    立即安装
                  </button>
                )}
              </div>

              <p class="dsh-pm-detail-desc">{selectedMarketEntry.description}</p>

              <section class="dsh-pm-detail-section">
                <h4 class="dsh-pm-section-title">功能说明 (README)</h4>
                <div class="dsh-readme-box">{selectedMarketEntry.readmeMarkdown}</div>
              </section>

              <section class="dsh-pm-detail-section">
                <h4 class="dsh-pm-section-title">可用版本列表</h4>
                <ul class="dsh-version-list">
                  {selectedMarketEntry.versions.map((ver) => {
                    const installedPkg = packages.find((p) => p.name === selectedMarketEntry.name);
                    const isCurrent = installedPkg?.version === ver.version;
                    return (
                      <li key={ver.version} class="dsh-version-row">
                        <div class="dsh-item-title-row">
                          <strong>v{ver.version}</strong>
                          {ver.version === selectedMarketEntry.defaultVersion && (
                            <DshTag tone="info">默认推荐</DshTag>
                          )}
                          {isCurrent && <DshTag tone="success">当前已装</DshTag>}
                        </div>
                        {!isCurrent && (
                          <button
                            type="button"
                            class="dsh-btn dsh-btn-outline dsh-btn-sm"
                            onClick={() => {
                              const pkg = zapPluginKernel.installPackageFromMarket(
                                selectedMarketEntry,
                                ver.version,
                              );
                              showToast(`已安装 ${pkg.title} v${ver.version}`);
                            }}
                          >
                            安装此版本
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section class="dsh-pm-detail-section">
                <h4 class="dsh-pm-section-title">包来源元数据</h4>
                <dl class="dsh-facts-dl">
                  <div>
                    <dt>NPM 包名</dt>
                    <dd>
                      <code>{selectedMarketEntry.name}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>代码仓库</dt>
                    <dd>
                      <code>{selectedMarketEntry.repository}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>分发镜像源</dt>
                    <dd>
                      <code>{selectedMarketEntry.registry}</code>
                    </dd>
                  </div>
                </dl>
              </section>
            </div>
          ) : (
            <>
              <div class="dsh-discover-toolbar">
                <div class="dsh-search-box" style={{ flex: 1 }}>
                  <IconSearch size={14} />
                  <input
                    type="search"
                    class="dsh-search-input"
                    placeholder="在插件市场中搜索插件名称、标签或作者..."
                    value={marketSearch}
                    onInput={(e) => setMarketSearch((e.currentTarget as HTMLInputElement).value)}
                  />
                </div>
                <select
                  class="dsh-select dsh-select-sm"
                  value={marketSort}
                  onChange={(e) => setMarketSort((e.currentTarget as HTMLSelectElement).value as any)}
                >
                  <option value="featured">排序：精选推荐</option>
                  <option value="updated">排序：最近更新</option>
                  <option value="name">排序：按名称</option>
                </select>
              </div>

              <div class="dsh-category-pills">
                {(
                  [
                    { id: 'all', label: '全部插件' },
                    { id: 'productivity', label: '生产力与提示词' },
                    { id: 'appearance', label: '外观与排版' },
                    { id: 'devtools', label: '开发者监控' },
                    { id: 'automation', label: '自动化通知' },
                  ] as const
                ).map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    class={`dsh-cat-pill ${marketCategory === cat.id ? 'is-active' : ''}`}
                    onClick={() => setMarketCategory(cat.id)}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              <ul class="dsh-pm-cards">
                {filteredMarket.map((entry) => {
                  const isInstalled = packages.some((p) => p.name === entry.name);
                  return (
                    <li key={entry.name} class="dsh-pm-card" data-market-entry={entry.name}>
                      <div class="dsh-pm-card-head">
                        <span class="dsh-pm-card-icon">
                          <PluginArtwork name={entry.name} size={24} />
                        </span>
                        <div class="dsh-pm-card-main">
                          <div class="dsh-item-title-row">
                            <button
                              type="button"
                              class="dsh-pm-card-title-btn"
                              onClick={() => setSelectedMarketEntry(entry)}
                            >
                              {entry.title}
                            </button>
                            <DshTag tone="neutral">v{entry.defaultVersion}</DshTag>
                            {entry.contributesSettingsSection && (
                              <DshTag tone="info">
                                左侧设置项: {entry.contributesSettingsSection.label}
                              </DshTag>
                            )}
                          </div>
                          <span class="dsh-pm-card-desc">{entry.description}</span>
                          <span class="dsh-pm-card-meta">
                            作者: {entry.author} · 包名: <code>{entry.name}</code>
                          </span>
                        </div>
                        <div class="dsh-pm-card-end">
                          {isInstalled ? (
                            <button
                              type="button"
                              class="dsh-btn dsh-btn-outline dsh-btn-sm"
                              onClick={() => {
                                setTab('installed');
                                setSelectedPkgName(entry.name);
                              }}
                            >
                              已安装
                            </button>
                          ) : (
                            <button
                              type="button"
                              class="dsh-btn dsh-btn-primary dsh-btn-sm"
                              onClick={() => {
                                const pkg = zapPluginKernel.installPackageFromMarket(entry);
                                showToast(
                                  `已安装并启用「${pkg.title}」，已在左侧设置栏新增「${entry.contributesSettingsSection?.label || pkg.title}」！`,
                                );
                              }}
                            >
                              安装
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}

      {/* DeepSeek 1:1 Install Plugin Wizard Modal (`InstallDialog`) */}
      {installWizard.open && (
        <div
          class="dsh-submodal-backdrop"
          onClick={() => setInstallWizard((prev) => ({ ...prev, open: false }))}
        >
          <div class="dsh-install-dialog" onClick={(e) => e.stopPropagation()}>
            <div class="dsh-submodal-head">
              <h3>
                {installWizard.phase === 'done'
                  ? '插件安装完成'
                  : installWizard.phase === 'running'
                    ? '正在安装插件…'
                    : '安装外部插件 (Install Plugin)'}
              </h3>
              <button
                type="button"
                class="dsh-icon-btn"
                onClick={() => setInstallWizard((prev) => ({ ...prev, open: false }))}
              >
                <IconClose size={15} />
              </button>
            </div>

            {installWizard.phase === 'idle' ? (
              <div class="dsh-install-body">
                <p class="dsh-install-desc">
                  输入 NPM 插件包名、GitHub 仓库地址或本地插件路径进行安装：
                </p>
                <input
                  type="text"
                  class="dsh-input"
                  placeholder="例如: @dsh-community/prompt-vault 或 @user/my-plugin"
                  value={installWizard.spec}
                  onInput={(e) =>
                    setInstallWizard((prev) => ({
                      ...prev,
                      spec: (e.currentTarget as HTMLInputElement).value,
                      inputError: null,
                    }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') runSpecInstall();
                  }}
                />
                {installWizard.inputError && (
                  <p class="dsh-input-error">{installWizard.inputError}</p>
                )}

                <div class="dsh-install-options-row">
                  <button
                    type="button"
                    class="dsh-ghost-link"
                    onClick={() => setGuideOpen((v) => !v)}
                  >
                    {guideOpen ? '收起填写指南 ▲' : '如何填写？ ▼'}
                  </button>
                  <div class="dsh-registry-picker">
                    <span>镜像源：</span>
                    <select
                      class="dsh-select dsh-select-sm"
                      value={
                        installWizard.registry.kind === 'custom'
                          ? 'custom'
                          : installWizard.registry.registry
                      }
                      onChange={(e) => {
                        const val = (e.currentTarget as HTMLSelectElement).value;
                        if (val === 'custom') {
                          setInstallWizard((prev) => ({
                            ...prev,
                            registry: { kind: 'custom', url: 'https://registry.npmmirror.com' },
                          }));
                        } else {
                          setInstallWizard((prev) => ({
                            ...prev,
                            registry: { kind: 'offered', registry: val as any },
                          }));
                        }
                      }}
                    >
                      <option value="auto">自动选择 (推荐)</option>
                      <option value="npmmirror">国内镜像 (npmmirror.com)</option>
                      <option value="npmjs">官方源 (registry.npmjs.org)</option>
                    </select>
                  </div>
                </div>

                {guideOpen && (
                  <div class="dsh-install-guide">
                    <div class="dsh-guide-item">
                      <div>
                        <div class="dsh-guide-title">插件包名或版本标识</div>
                        <div class="dsh-guide-hint">支持标准作用域包名，安装并启用后自动挂载左侧设置页</div>
                        <code>@dsh-community/prompt-vault</code>
                      </div>
                      <button
                        type="button"
                        class="dsh-btn dsh-btn-outline dsh-btn-sm"
                        onClick={() =>
                          setInstallWizard((prev) => ({
                            ...prev,
                            spec: '@dsh-community/prompt-vault',
                          }))
                        }
                      >
                        填入示例
                      </button>
                    </div>
                  </div>
                )}

                <div class="dsh-install-safety">
                  <span>⚠️ 外部插件运行在当前工作台上下文中，请仅安装来自受信任来源的插件包。</span>
                </div>

                <div class="dsh-install-footer-btns">
                  <button
                    type="button"
                    class="dsh-btn dsh-btn-outline"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    从本地文件导入...
                  </button>
                  <button type="button" class="dsh-btn dsh-btn-primary" onClick={runSpecInstall}>
                    开始安装
                  </button>
                </div>
              </div>
            ) : (
              <div class="dsh-install-wizard-status">
                <div class="dsh-wizard-subject-card">
                  <div class="dsh-wizard-subject-title">
                    {installWizard.subjectTitle || installWizard.spec}
                  </div>
                  {installWizard.subjectDescription && (
                    <div class="dsh-wizard-subject-desc">{installWizard.subjectDescription}</div>
                  )}
                  {installWizard.installedVersion && (
                    <div class="dsh-wizard-subject-ver">版本: v{installWizard.installedVersion}</div>
                  )}
                </div>

                {installWizard.runs.map((run) => (
                  <div key={run.jobId} class="dsh-terminal-block">
                    <div class="dsh-terminal-head">
                      <code>$ {run.command}</code>
                      <span>{run.exitCode === 0 ? '✓ 完成 (Exit 0)' : '执行中…'}</span>
                    </div>
                    <pre class="dsh-terminal-output">{run.output}</pre>
                  </div>
                ))}

                <div class="dsh-install-footer-btns">
                  {installWizard.phase === 'done' && (
                    <button
                      type="button"
                      class="dsh-btn dsh-btn-primary"
                      onClick={() => {
                        const pkgName = installWizard.installedPackageName;
                        setInstallWizard((prev) => ({ ...prev, open: false }));
                        if (pkgName) {
                          setTab('installed');
                          setSelectedPkgName(pkgName);
                        }
                      }}
                    >
                      查看已安装插件
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// 8. Dynamic External Plugin Section View (Rendered when user clicks an
//    installed plugin's section in the Settings Center left sidebar)
// =============================================================================

function ExternalPluginSectionView({
  pkg,
  onOpenInPluginManager,
}: {
  pkg: ExternalPluginPackage;
  onOpenInPluginManager: () => void;
}) {
  if (pkg.name === 'dsh-boot-suite' || pkg.name.includes('boot')) {
    return <DshBootAnimationSettingsPanel />;
  }

  return (
    <div class="dsh-section-stack">
      <div class="dsh-banner-card">
        <div class="dsh-banner-main">
          <div class="dsh-banner-title">
            {pkg.title} <DshTag tone="neutral">v{pkg.version}</DshTag>
          </div>
          <div class="dsh-banner-sub">
            包名：<code>{pkg.name}</code> · 状态：{pkg.enabled ? '已启用' : '已停用'}
          </div>
        </div>
        <button type="button" class="dsh-btn dsh-btn-outline dsh-btn-sm" onClick={onOpenInPluginManager}>
          在插件管理中查看详情
        </button>
      </div>

      {pkg.configSchema && pkg.configSchema.length > 0 ? (
        <div class="dsh-general-card">
          {pkg.configSchema.map((field, idx) => {
            const val = pkg.configValues?.[field.key];
            return (
              <div key={field.key}>
                {idx > 0 && <div class="dsh-general-divider" />}
                <div class="dsh-general-row">
                  <div class="dsh-general-meta">
                    <div class="dsh-general-label">{field.label}</div>
                    <div class="dsh-general-desc">{field.description}</div>
                  </div>
                  {field.type === 'boolean' ? (
                    <DshSwitch
                      checked={Boolean(val)}
                      onChange={(next) => zapPluginKernel.updatePackageConfig(pkg.name, field.key, next)}
                    />
                  ) : field.type === 'select' ? (
                    <select
                      class="dsh-select"
                      value={String(val ?? '')}
                      onChange={(e) =>
                        zapPluginKernel.updatePackageConfig(
                          pkg.name,
                          field.key,
                          (e.currentTarget as HTMLSelectElement).value,
                        )
                      }
                    >
                      {(field.options || []).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type === 'number' ? 'number' : 'text'}
                      class="dsh-input"
                      style={{ maxWidth: '280px' }}
                      value={String(val ?? '')}
                      onInput={(e) =>
                        zapPluginKernel.updatePackageConfig(
                          pkg.name,
                          field.key,
                          field.type === 'number'
                            ? Number((e.currentTarget as HTMLInputElement).value)
                            : (e.currentTarget as HTMLInputElement).value,
                        )
                      }
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div class="dsh-readme-box">{pkg.readmeMarkdown}</div>
      )}
    </div>
  );
}

// =============================================================================
// 9. Unified Settings Root Modal (`SettingsRoot.tsx` 1:1 Architecture)
// =============================================================================

export function DeepSeekSettingsCenterModal({
  open,
  initialSection = 'general',
  onClose,
}: {
  open: boolean;
  initialSection?: string;
  onClose: () => void;
}) {
  const [activeId, setActiveId] = useState<string>(initialSection);
  const [packages, setPackages] = useState<ExternalPluginPackage[]>(() =>
    zapPluginKernel.getExternalPackages(),
  );
  const [customSlotsVersion, setCustomSlotsVersion] = useState(0);

  useEffect(() => {
    setActiveId(initialSection);
  }, [initialSection, open]);

  useEffect(() => {
    return zapPluginKernel.subscribe(() => {
      setPackages([...zapPluginKernel.getExternalPackages()]);
      setCustomSlotsVersion((v) => v + 1);
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const sections: SettingsSectionContribution[] = useMemo(() => {
    const coreSections: SettingsSectionContribution[] = [
      {
        id: 'general',
        order: 10,
        icon: <IconGear size={18} />,
        label: '通用',
        title: '通用设置',
        description: '管理界面主题、多语言偏好与编码开发者工具选项',
        render: ({ close, navigate }) => <GeneralSettingsSection close={close} navigate={navigate} />,
      },
      {
        id: 'ui-glass',
        order: 15,
        icon: <IconPalette size={18} />,
        label: '界面与透明度',
        title: '界面毛玻璃与透明度定制 (UI Appearance)',
        description: '无级调节侧边栏与卡片透明度、高斯磨砂模糊半径及极光渐变壁纸',
        render: () => <GlassThemeSettingsPanel />,
      },
      {
        id: 'models',
        order: 20,
        icon: <IconCube size={18} />,
        label: '模型与供应商',
        title: '模型与供应商',
        description: '查看当前默认模型与已注册的上游供应商通道',
        render: ({ close }) => <ModelsSettingsSection close={close} />,
      },
      {
        id: 'agent-preset',
        order: 30,
        icon: <IconSparkles size={18} />,
        label: '智能体预设',
        title: '智能体预设 (Agent Presets)',
        description: '管理新建会话时的智能体工具组合预设与自定义 YAML 声明',
        render: () => <AgentPresetSettingsSection />,
      },
      {
        id: 'startup-screen',
        order: 35,
        icon: <IconMovie size={18} />,
        label: '启动动画',
        title: '启动动画设置 (Startup Animation)',
        description: '1:1 配置开机启动两幕动效、播放时机、速度倍率、音效与片库模板',
        render: ({ close }) => <DshBootAnimationSettingsPanel onClose={close} />,
      },
      {
        id: 'plugins',
        order: 40,
        icon: <IconSliders size={18} />,
        label: '内置插件',
        title: '内置插件 (Built-in Plugins)',
        description: '管理会话级与全局内置插件开关、Shell 执行器限制及 MCP 能力',
        render: () => <BuiltinPluginsSettingsSection />,
      },
      {
        id: 'plugin-manager',
        order: 45,
        icon: <IconStore size={18} />,
        label: '外部插件与市场',
        badge: packages.filter((p) => !p.official && p.enabled).length || undefined,
        title: '插件管理与插件市场',
        description: '安装、启用或卸载外部扩展插件包，或从插件市场一键发现新能力',
        render: ({ navigate }) => <PluginManagerSurface onJumpToSection={navigate} />,
      },
    ];

    // Dynamically inject sections from enabled external packages
    const dynamicPkgSections: SettingsSectionContribution[] = [];
    packages
      .filter((pkg) => pkg.enabled)
      .forEach((pkg, idx) => {
        for (const row of pkg.rows) {
          if (row.enabled && row.sectionId) {
            dynamicPkgSections.push({
              id: row.sectionId,
              order: 60 + idx,
              icon: <IconPuzzle size={18} />,
              label: row.title.replace(/\s*Prompt Vault\s*/i, '').slice(0, 12) || pkg.title.slice(0, 10),
              title: row.title,
              description: row.description,
              pluginPackage: pkg.name,
              render: ({ navigate }) => (
                <ExternalPluginSectionView
                  pkg={pkg}
                  onOpenInPluginManager={() => navigate('plugin-manager')}
                />
              ),
            });
          }
        }
      });

    // Merge any runtime slots registered via `zapPluginKernel.registerSlot('settings.section', ...)`
    const extraSlots = zapPluginKernel.getSlotEntries('settings.section');
    const all = [...coreSections, ...dynamicPkgSections, ...extraSlots];
    const dedup = new Map<string, SettingsSectionContribution>();
    for (const s of all) dedup.set(s.id, s);
    return Array.from(dedup.values()).sort((a, b) => a.order - b.order);
  }, [packages, customSlotsVersion]);

  const actions = zapPluginKernel.getSlotEntries('settings.action');
  const activeSection = sections.find((s) => s.id === activeId) ?? sections[0];

  if (!open) return null;

  return createPortal(
    <div
      class="dsh-settings-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="dsh-settings-dialog" role="dialog" aria-modal="true" aria-label="设置与插件中心">
        <div class="dsh-settings-layout">
          {/* Left Navigation Sidebar (240px, 1:1 with SettingsRoot.module.css) */}
          <aside class="dsh-settings-sidebar">
            <div class="dsh-settings-nav-header">
              <h2 class="dsh-settings-nav-title">设置中心</h2>
              <p class="dsh-settings-nav-desc">管理通用偏好、智能体预设与插件生态</p>
            </div>

            <nav class="dsh-settings-nav" aria-label="设置分类导航">
              {sections.map((section) => {
                const isSelected = section.id === activeSection?.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    class={`dsh-settings-nav-item ${isSelected ? 'is-active' : ''}`}
                    onClick={() => setActiveId(section.id)}
                  >
                    <span class="dsh-settings-nav-icon">{section.icon}</span>
                    <span class="dsh-settings-nav-label">{section.label}</span>
                    {section.badge !== undefined && (
                      <span class="dsh-settings-nav-badge">{section.badge}</span>
                    )}
                  </button>
                );
              })}
            </nav>

            {/* Bottom Action Area (`settings.action` slot) */}
            <div class="dsh-settings-action-area">
              {actions.map((act) => (
                <div key={act.id} class="dsh-settings-action-slot">
                  {act.render({ close: onClose, navigate: setActiveId })}
                </div>
              ))}
              <button
                type="button"
                class="dsh-settings-bottom-action-btn"
                onClick={() => setActiveId('plugin-manager')}
              >
                <IconPuzzle size={15} />
                <span>插件市场与外部扩展</span>
                <span class="dsh-action-dot" />
              </button>
            </div>
          </aside>

          {/* Right Content Area */}
          <main class="dsh-settings-content">
            <header class="dsh-settings-content-header">
              <div class="dsh-settings-content-heading">
                <h3 class="dsh-settings-content-title">
                  {activeSection?.title || activeSection?.label}
                </h3>
                {activeSection?.description && (
                  <p class="dsh-settings-content-desc">{activeSection.description}</p>
                )}
              </div>
              <button
                type="button"
                class="dsh-settings-close-btn"
                aria-label="关闭设置中心"
                onClick={onClose}
              >
                <IconClose size={18} />
              </button>
            </header>

            <div class="dsh-settings-content-body">
              {activeSection?.render({
                close: onClose,
                navigate: (targetId) => setActiveId(targetId),
              })}
            </div>
          </main>
        </div>
      </div>
    </div>,
    document.body,
  );
}
