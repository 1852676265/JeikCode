/**
 * Zap Unified Settings Center (`SettingsModal`)
 * -----------------------------------------------------------------------------
 * 现代化设置中心：提供通用设置、界面透明度、模型与供应商、MCP 与技能扩展四大核心模块。
 * 彻底移除无用冗余 mock，提供极致细腻的桌面交互与双主题视觉体验。
 */

import { h } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useMemo, useState, useRef } from 'preact/hooks';
import { GlassThemeSettingsPanel } from './glass-theme-settings-panel';
import { DshPetSettingsView } from './dsh-pet-settings';
import {
  CapabilityItem,
  getCapabilities,
  postLanguage,
  toggleCapability,
  fetchFsRead,
} from '../api';
import { useSettings, Theme } from '../settings';
import { Lang } from '../i18n';
import { ModelSelector } from '../components/ModelSelector';
import { getActiveServerProfile, isDirectLlmProfile, PROFILES_CHANGE_EVENT } from '../lib/serverProfiles';
import { zapPluginKernel, ExternalPluginPackage, ZapPluginManifest } from './plugin-kernel';

// =============================================================================
// 1. 精致矢量图标 (Refined Outline Icons)
// =============================================================================

const IconGear = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
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

const IconCube = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);

const IconPuzzle = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M19.439 7.85c-.049-.942-.78-1.71-1.722-1.764-1.042-.06-1.942-.87-1.942-1.916V4a2 2 0 0 0-2-2h-3.5a2 2 0 0 0-2 2v.17c0 1.047-.9 1.856-1.942 1.916-.942.054-1.673.822-1.722 1.764L4.5 10a2 2 0 0 0 2 2h.17c1.047 0 1.856.9 1.916 1.942.054.942.822 1.673 1.764 1.722l2.15.11a2 2 0 0 0 2-2v-.17c0-1.047.9-1.856 1.942-1.916.942-.054 1.673-.822 1.722-1.764L19.439 7.85z" />
  </svg>
);

const IconTrash = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const IconPlug = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 22v-5" />
    <path d="M9 8V2" />
    <path d="M15 8V2" />
    <path d="M18 8v5a6 6 0 0 1-12 0V8z" />
  </svg>
);

const IconSparkles = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z" />
  </svg>
);

const IconSearch = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
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

const IconClose = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const IconSun = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);

const IconMoon = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const IconMonitor = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

// =============================================================================
// 2. 现代轻量原子组件 (Switch, Tag, Section Header)
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

function DshTag({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'solid';
  children: any;
}) {
  return <span class={`dsh-tag tone-${tone}`}>{children}</span>;
}

// =============================================================================
// 3. 通用状态 Hook (Bridge & Profile)
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

// =============================================================================
// 4. 面板 1：通用设置 (General Settings)
// =============================================================================

function GeneralSettingsSection({
  close,
}: {
  close: () => void;
}) {
  const { theme, setTheme, lang, setLang } = useSettings();
  const modelBridge = useChatModelBridge();
  const activeProfile = useActiveServerProfile();

  const applyTheme = (next: Theme) => {
    setTheme(next);
  };

  const applyLang = (next: Lang) => {
    setLang(next);
    void postLanguage(next).catch(() => {});
  };

  return (
    <div class="dsh-general-list">
      {/* 会话模型与运行宿主 */}
      <div class="dsh-general-card dsh-general-card-elevated">
        <div class="dsh-general-row">
          <div class="dsh-general-meta">
            <div class="dsh-general-label">当前模型与思考强度</div>
            <div class="dsh-general-desc">切换当前会话所用的推理模型、供应商账号及思考强度档位</div>
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
            <div class="dsh-general-label">当前连接宿主</div>
            <div class="dsh-general-desc">查看当前连接的服务节点，支持管理并快速切换本地、团队内网或云端远程节点</div>
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

      {/* 外观与环境偏好 */}
      <div class="dsh-general-card">
        <div class="dsh-general-row">
          <div class="dsh-general-meta">
            <div class="dsh-general-label">外观主题</div>
            <div class="dsh-general-desc">选择工作台的色彩方案，支持浅色、深色或与操作系统保持一致</div>
          </div>
          <div class="dsh-segmented-pills">
            {(
              [
                { id: 'light', label: '浅色', icon: <IconSun size={14} /> },
                { id: 'dark', label: '深色', icon: <IconMoon size={14} /> },
                { id: 'system', label: '跟随系统', icon: <IconMonitor size={14} /> },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                class={`dsh-seg-pill ${theme === opt.id ? 'is-active' : ''}`}
                onClick={() => applyTheme(opt.id)}
              >
                <span class="dsh-seg-pill-icon">{opt.icon}</span>
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div class="dsh-general-divider" />

        <div class="dsh-general-row">
          <div class="dsh-general-meta">
            <div class="dsh-general-label">界面语言</div>
            <div class="dsh-general-desc">设置工作台导航、按钮、提示与菜单的显示语言</div>
          </div>
          <div class="dsh-select-wrapper">
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
        </div>

        <div class="dsh-general-divider" />

        <div class="dsh-general-row">
          <div class="dsh-general-meta">
            <div class="dsh-general-label">版本与软件更新</div>
            <div class="dsh-general-desc">查看客户端版本信息、最新发布说明与在线检查更新</div>
          </div>
          <button
            type="button"
            class="dsh-btn dsh-btn-outline"
            onClick={() => {
              close();
              window.dispatchEvent(new CustomEvent('jeikcode:open-update-modal'));
            }}
          >
            检查更新
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// 6. 面板 2：MCP 与技能扩展 (MCP & Capabilities)
// =============================================================================

function McpCapabilitiesSection() {
  const [caps, setCaps] = useState<CapabilityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const loadCaps = () => {
    setLoading(true);
    getCapabilities()
      .then((res: CapabilityItem[]) => {
        setCaps(res);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    loadCaps();
  }, []);

  const handleToggle = async (cap: CapabilityItem, enable: boolean) => {
    try {
      await toggleCapability(cap.kind, cap.id, 'global', !enable);
      const updated = await getCapabilities();
      setCaps(updated);
    } catch (err) {
      console.error('Failed to toggle capability:', err);
    }
  };

  const filteredCaps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return caps;
    return caps.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        (c.description && c.description.toLowerCase().includes(q)),
    );
  }, [caps, searchQuery]);

  const mcpCount = caps.filter((c) => c.kind === 'mcp').length;
  const skillCount = caps.filter((c) => c.kind === 'skill').length;

  return (
    <div class="dsh-section-stack">
      {/* 顶部统计卡片 */}
      <div class="dsh-banner-card dsh-general-card-elevated">
        <div class="dsh-banner-main">
          <div class="dsh-banner-title">MCP 服务与扩展技能管理</div>
          <div class="dsh-banner-sub">
            已挂载 {mcpCount} 个 MCP 服务、{skillCount} 个智能体技能 · 开关实时作用于全局与会话
          </div>
        </div>
        <button
          type="button"
          class="dsh-btn dsh-btn-outline"
          onClick={loadCaps}
          disabled={loading}
          title="重新扫描并读取能力列表"
        >
          <IconRefresh size={14} />
          <span>刷新能力</span>
        </button>
      </div>

      <div class="dsh-group-stack">
        <div class="dsh-inv-toolbar">
          <div class="dsh-search-box">
            <IconSearch size={14} />
            <input
              type="search"
              class="dsh-search-input"
              placeholder="搜索 MCP 服务或技能名称..."
              value={searchQuery}
              onInput={(e) => setSearchQuery((e.currentTarget as HTMLInputElement).value)}
            />
          </div>
        </div>

        {loading ? (
          <div class="dsh-empty-state">正在读取系统已挂载的 MCP 与技能能力…</div>
        ) : filteredCaps.length === 0 ? (
          <div class="dsh-empty-state">
            {searchQuery ? '没有找到匹配的扩展能力' : '暂未检测到挂载的 MCP 服务或技能。'}
          </div>
        ) : (
          <ul class="dsh-card-list">
            {filteredCaps.map((cap) => {
              const isEnabled = !cap.effective_disabled;
              return (
                <li key={`${cap.kind}-${cap.id}`} class="dsh-item-card">
                  <div class="dsh-item-card-head">
                    <span class="dsh-item-icon">
                      {cap.kind === 'mcp' ? <IconPlug size={18} /> : <IconSparkles size={18} />}
                    </span>
                    <div class="dsh-item-main">
                      <div class="dsh-item-title-row">
                        <span class="dsh-item-title">{cap.name}</span>
                        <DshTag tone={cap.kind === 'mcp' ? 'info' : 'neutral'}>
                          {cap.kind === 'mcp' ? 'MCP 服务' : 'Skill 技能'}
                        </DshTag>
                        <DshTag tone={isEnabled ? 'success' : 'neutral'}>
                          {isEnabled ? '已启用' : '已停用'}
                        </DshTag>
                      </div>
                      {cap.description && <span class="dsh-item-desc">{cap.description}</span>}
                    </div>
                    <div class="dsh-item-actions">
                      <DshSwitch
                        checked={isEnabled}
                        onChange={(next) => handleToggle(cap, next)}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// 6. 扩展插件管理板块 (Plugins Manager Section)
// =============================================================================

function PluginsManagerSection({
  navigate,
}: {
  close?: () => void;
  navigate?: (targetId: string) => void;
}) {
  const [packages, setPackages] = useState<ExternalPluginPackage[]>(() =>
    zapPluginKernel.getExternalPackages(),
  );
  const [importInput, setImportInput] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importMsg, setImportMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    return zapPluginKernel.subscribe(() => {
      setPackages(zapPluginKernel.getExternalPackages());
    });
  }, []);

  const handleToggle = (pkg: ExternalPluginPackage) => {
    zapPluginKernel.togglePackage(pkg.name);
  };

  const handleUninstall = (pkg: ExternalPluginPackage) => {
    if (confirm(`确认卸载插件 "${pkg.title || pkg.name}" 吗？该操作将注销所有相关工作台插槽与侧栏入口。`)) {
      zapPluginKernel.uninstallPackage(pkg.name);
    }
  };

  const handleImport = async () => {
    const raw = importInput.trim();
    if (!raw) {
      setImportMsg({ type: 'err', text: '请输入本地插件目录路径或完整的 manifest.json 内容' });
      return;
    }
    setImportLoading(true);
    setImportMsg(null);

    try {
      let manifest: ZapPluginManifest | null = null;
      let manifestSource = raw;

      if (raw.startsWith('{') && raw.endsWith('}')) {
        manifest = JSON.parse(raw);
      } else {
        const normalizedPath = raw.replace(/\\/g, '/');
        const manifestFilePath = normalizedPath.endsWith('.json')
          ? normalizedPath
          : `${normalizedPath.replace(/\/+$/, '')}/manifest.json`;

        const res = await fetchFsRead(manifestFilePath);
        if (!res.success || !res.content) {
          throw new Error(`无法从路径读取 manifest.json: ${manifestFilePath}`);
        }
        manifest = JSON.parse(res.content);
        manifestSource = normalizedPath;
      }

      if (!manifest || !manifest.name) {
        throw new Error('无效的插件清单：必须包含唯一的 name 或 id 字段');
      }

      const installed = zapPluginKernel.installFromManifest(manifest, manifestSource);
      setImportMsg({ type: 'ok', text: `插件 "${installed.title || installed.name}" 导入成功并已激活！` });
      setImportInput('');
    } catch (err: any) {
      setImportMsg({ type: 'err', text: err.message || '导入失败，请检查路径与清单内容' });
    } finally {
      setImportLoading(false);
    }
  };

  const handleFileSelect = (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const installed = zapPluginKernel.installFromManifest(parsed, `file:${file.name}`);
        setImportMsg({ type: 'ok', text: `从清单文件导入 "${installed.title || installed.name}" 成功并已激活！` });
      } catch (err: any) {
        setImportMsg({ type: 'err', text: `解析文件失败: ${err.message}` });
      }
    };
    reader.readAsText(file);
  };

  const installedPlugins = packages.filter((p) => p.installed);

  return (
    <div class="dsh-section-stack">
      {/* 导入外部插件卡片 */}
      <div class="dsh-general-card dsh-plugin-import-banner">
        <div class="dsh-plugin-import-header">
          <div class="dsh-banner-main">
            <div class="dsh-banner-title">导入外部插件包</div>
            <div class="dsh-banner-sub">
              输入本地插件目录（含 manifest.json）或选取清单文件，按需即插即用
            </div>
          </div>
          <label
            class="dsh-btn dsh-btn-outline dsh-btn-sm"
            style="cursor: pointer; display: inline-flex; align-items: center; gap: 6px;"
          >
            <span>选择本地 manifest.json</span>
            <input type="file" accept=".json" onChange={handleFileSelect} style="display: none;" />
          </label>
        </div>

        <div class="dsh-plugin-import-row">
          <div class="dsh-search-box" style="flex: 1;">
            <input
              type="text"
              class="dsh-search-input"
              placeholder="例如: D:/Projects/dev-orbit 或粘贴 manifest.json 内容"
              value={importInput}
              onInput={(e) => setImportInput((e.target as HTMLInputElement).value)}
            />
          </div>
          <button
            type="button"
            class="dsh-btn dsh-btn-primary dsh-btn-sm"
            disabled={importLoading}
            onClick={handleImport}
            style="white-space: nowrap; padding: 7px 18px;"
          >
            {importLoading ? '导入中...' : '导入并启用'}
          </button>
        </div>

        {importMsg && (
          <div class={`dsh-plugin-import-msg tone-${importMsg.type}`}>
            {importMsg.text}
          </div>
        )}
      </div>

      {/* 已安装插件列表 */}
      <div class="dsh-group-stack">
        <h3 class="dsh-group-heading">已安装插件 ({installedPlugins.length})</h3>

        {installedPlugins.length === 0 ? (
          <div class="dsh-empty-state">
            暂未安装任何独立插件包。Zap 保持极致轻量与零冗余，您可通过上方输入插件目录随时按需导入。
          </div>
        ) : (
          <ul class="dsh-card-list">
            {installedPlugins.map((pkg) => {
              const hasConfig = Boolean(pkg.configSchema && pkg.configSchema.length > 0);
              const sectionId =
                pkg.contributesSettingsSection?.id ||
                `ext-${pkg.name.replace(/^@/, '').replace(/\//g, '-')}`;

              return (
                <li key={pkg.name} class="dsh-item-card">
                  <div class="dsh-item-card-head">
                    <span class="dsh-item-icon">
                      <IconPlug size={18} />
                    </span>
                    <div class="dsh-item-main">
                      <div class="dsh-item-title-row">
                        <span class="dsh-item-title">{pkg.title || pkg.name}</span>
                        <DshTag tone="neutral">v{pkg.version}</DshTag>
                        {pkg.contributesWorkbenchView && (
                          <DshTag tone="info">工作台</DshTag>
                        )}
                        <DshTag tone={pkg.enabled ? 'success' : 'neutral'}>
                          {pkg.enabled ? '已启用' : '已停用'}
                        </DshTag>
                      </div>
                      {pkg.description && (
                        <span class="dsh-item-desc">{pkg.description}</span>
                      )}
                    </div>

                    <div class="dsh-item-actions">
                      {hasConfig && (
                        <button
                          type="button"
                          class="dsh-btn dsh-btn-outline dsh-btn-sm"
                          onClick={() => navigate?.(sectionId)}
                        >
                          配置
                        </button>
                      )}
                      <DshSwitch
                        checked={pkg.enabled}
                        onChange={() => handleToggle(pkg)}
                        title={pkg.enabled ? '已启用' : '已禁用'}
                      />
                      <button
                        type="button"
                        class="dsh-btn dsh-btn-outline dsh-btn-sm"
                        style="color: #ef4444; border-color: rgba(239, 68, 68, 0.25);"
                        onClick={() => handleUninstall(pkg)}
                        title="卸载插件"
                      >
                        <IconTrash size={14} />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function DynamicPluginConfigForm({ pkg }: { pkg: ExternalPluginPackage }) {
  const schema = pkg.configSchema || [];
  const [values, setValues] = useState<Record<string, any>>(() => ({ ...(pkg.configValues || {}) }));

  const handleChange = (key: string, val: any) => {
    setValues((prev) => ({ ...prev, [key]: val }));
    zapPluginKernel.updatePackageConfig(pkg.name, key, val);
  };

  if (!schema.length) {
    return (
      <div class="dsh-empty-state">
        该插件暂未提供可配置的自定义参数。
      </div>
    );
  }

  return (
    <ul class="dsh-card-list">
      {schema.map((item) => (
        <li key={item.key} class="dsh-item-card">
          <div class="dsh-item-card-head">
            <div class="dsh-item-main">
              <span class="dsh-item-title">{item.label}</span>
              {item.description && (
                <span class="dsh-item-desc">{item.description}</span>
              )}
            </div>
            <div class="dsh-item-actions">
              {item.type === 'boolean' && (
                <DshSwitch
                  checked={Boolean(values[item.key])}
                  onChange={(checked) => handleChange(item.key, checked)}
                />
              )}
              {item.type === 'string' && (
                <div class="dsh-search-box" style="min-width: 260px;">
                  <input
                    type="text"
                    class="dsh-search-input"
                    value={values[item.key] ?? ''}
                    onInput={(e) => handleChange(item.key, (e.target as HTMLInputElement).value)}
                  />
                </div>
              )}
              {item.type === 'select' && item.options && (
                <select
                  class="dsh-btn dsh-btn-outline dsh-btn-sm"
                  style="padding: 6px 10px; font-size: 13px;"
                  value={values[item.key]}
                  onChange={(e) => handleChange(item.key, (e.target as HTMLSelectElement).value)}
                >
                  {item.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

// =============================================================================
// 7. 设置分类定义 (Sections Definition)
// =============================================================================

interface SettingsSectionItem {
  id: string;
  icon: any;
  label: string;
  title: string;
  description: string;
  render: (props: { close: () => void; navigate: (targetId: string) => void }) => any;
}

const SETTINGS_SECTIONS: SettingsSectionItem[] = [
  {
    id: 'general',
    icon: <IconGear size={17} />,
    label: '通用',
    title: '通用设置',
    description: '管理界面主题、语言偏好与当前连接宿主',
    render: ({ close }) => <GeneralSettingsSection close={close} />,
  },
  {
    id: 'ui-glass',
    icon: <IconPalette size={17} />,
    label: '界面与透明度',
    title: '界面毛玻璃与透明度定制',
    description: '自由调节侧边栏、对话消息卡片透明度、高斯模糊度与壁纸氛围',
    render: () => <GlassThemeSettingsPanel />,
  },
  {
    id: 'mcp-capabilities',
    icon: <IconPlug size={17} />,
    label: 'MCP 与技能',
    title: 'MCP 服务与技能扩展',
    description: '配置宿主中挂载的 MCP 协议服务器与 Agent 技能工具链',
    render: () => <McpCapabilitiesSection />,
  },
  {
    id: 'plugins-manager',
    icon: <IconPuzzle size={17} />,
    label: '插件管理',
    title: '扩展插件中心',
    description: '按需导入外部插件包，管理插槽扩展与独立工作台',
    render: (props) => <PluginsManagerSection {...props} />,
  },
];

// =============================================================================
// 8. 设置中心统一模态弹窗 (Settings Center Modal)
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
  const [pluginsTick, setPluginsTick] = useState(0);

  useEffect(() => {
    return zapPluginKernel.subscribe(() => {
      setPluginsTick((v) => v + 1);
    });
  }, []);

  const dynamicSections = useMemo(() => {
    const customSlots = zapPluginKernel.getSlotEntries('settings.section');
    return customSlots.map((slot) => {
      const pkg = slot.pluginPackage ? zapPluginKernel.getPackage(slot.pluginPackage) : null;
      return {
        id: slot.id,
        icon: slot.icon || <IconPlug size={17} />,
        label: slot.label,
        title: slot.title || slot.label,
        description: slot.description || '',
        render: (props: any) => {
          if (slot.id === 'ext-dsh-pet' || slot.id === 'pet-config' || slot.pluginPackage === '@dsh-community/pet') {
            return <DshPetSettingsView />;
          }
          const res = slot.render ? slot.render(props) : null;
          if (res) return res;
          if (pkg) return <DynamicPluginConfigForm pkg={pkg} />;
          return null;
        },
      };
    });
  }, [pluginsTick]);

  const allSections = useMemo(() => {
    return [...SETTINGS_SECTIONS, ...dynamicSections];
  }, [dynamicSections]);

  // 智能规整 sectionId（兼容旧标识与动态注册标识）
  const resolveSectionId = (sec: string) => {
    if (sec === 'plugins' || sec === 'plugins-manager') return 'plugins-manager';
    if (sec === 'mcp' || sec === 'skills') return 'mcp-capabilities';
    if (sec === 'theme' || sec === 'glass') return 'ui-glass';
    if (sec === 'model' || sec === 'models') return 'general';
    const exists = allSections.some((s) => s.id === sec);
    return exists ? sec : 'general';
  };

  const [activeId, setActiveId] = useState<string>(() => resolveSectionId(initialSection));

  useEffect(() => {
    setActiveId(resolveSectionId(initialSection));
  }, [initialSection, open, allSections]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const activeSection =
    allSections.find((s) => s.id === activeId) ?? allSections[0];

  if (!open) return null;

  return createPortal(
    <div
      class="dsh-settings-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="dsh-settings-dialog" role="dialog" aria-modal="true" aria-label="设置中心">
        <div class="dsh-settings-layout">
          {/* 左侧导航侧边栏 */}
          <aside class="dsh-settings-sidebar">
            <div class="dsh-settings-nav-header">
              <h2 class="dsh-settings-nav-title">设置中心</h2>
              <p class="dsh-settings-nav-desc">工作台偏好与系统配置</p>
            </div>

            <nav class="dsh-settings-nav" aria-label="设置分类导航">
              {allSections.map((section) => {
                const isSelected = section.id === activeSection.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    class={`dsh-settings-nav-item ${isSelected ? 'is-active' : ''}`}
                    onClick={() => setActiveId(section.id)}
                  >
                    <span class="dsh-settings-nav-icon">{section.icon}</span>
                    <span class="dsh-settings-nav-label">{section.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* 侧边栏底部版本标识 */}
            <div class="dsh-settings-sidebar-footer">
              <span class="dsh-settings-footer-badge">Zap Desktop</span>
            </div>
          </aside>

          {/* 右侧主内容区 */}
          <main class="dsh-settings-content">
            <header class="dsh-settings-content-header">
              <div class="dsh-settings-content-heading">
                <h3 class="dsh-settings-content-title">
                  {activeSection.title}
                </h3>
                {activeSection.description && (
                  <p class="dsh-settings-content-desc">{activeSection.description}</p>
                )}
              </div>
              <button
                type="button"
                class="dsh-settings-close-btn"
                aria-label="关闭设置中心"
                onClick={onClose}
              >
                <IconClose size={17} />
              </button>
            </header>

            <div class="dsh-settings-content-body">
              {activeSection.render({
                close: onClose,
                navigate: (targetId) => setActiveId(resolveSectionId(targetId)),
              })}
            </div>
          </main>
        </div>
      </div>
    </div>,
    document.body,
  );
}
