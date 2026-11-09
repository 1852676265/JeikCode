/**
 * 苹果毛玻璃与透明度定制面板 (Glass Theme & Opacity Settings Panel)
 * -----------------------------------------------------------------------------
 * 1. 提供预设一键切换（苹果原汁、空灵极透、雾面磨砂、纯净低透）。
 * 2. 提供面板透明度、卡片透明度、高斯模糊度、边框清晰度与光晕壁纸的精细滑块调节。
 * 3. 拖动过程中即时将 CSS 变量作用于整站界面，并在面板内部提供实时渲染预览卡片。
 */

import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import {
  GlassThemeSettings,
  DEFAULT_GLASS_THEME_SETTINGS,
  GLASS_PRESETS,
  loadGlassThemeSettings,
  saveGlassThemeSettings,
  GLASS_THEME_CHANGE_EVENT,
} from './glass-theme-plugin';

function DshSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
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

export function GlassThemeSettingsPanel() {
  const [settings, setSettings] = useState<GlassThemeSettings>(() => loadGlassThemeSettings());
  const [activePresetId, setActivePresetId] = useState<string>('apple-default');

  useEffect(() => {
    const handleSync = () => setSettings(loadGlassThemeSettings());
    window.addEventListener(GLASS_THEME_CHANGE_EVENT, handleSync);
    return () => window.removeEventListener(GLASS_THEME_CHANGE_EVENT, handleSync);
  }, []);

  const update = (patch: Partial<GlassThemeSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveGlassThemeSettings(next);
  };

  const applyPreset = (presetId: string) => {
    setActivePresetId(presetId);
    const found = GLASS_PRESETS.find((p) => p.id === presetId);
    if (!found) return;
    const next = { ...settings, ...found.settings };
    setSettings(next);
    saveGlassThemeSettings(next);
  };

  const handleReset = () => {
    setActivePresetId('apple-default');
    setSettings({ ...DEFAULT_GLASS_THEME_SETTINGS });
    saveGlassThemeSettings({ ...DEFAULT_GLASS_THEME_SETTINGS });
  };

  return (
    <div class="dsh-section-stack">
      {/* 顶部状态与开关卡片 */}
      <div class="dsh-banner-card dsh-general-card-elevated">
        <div class="dsh-banner-main">
          <div class="dsh-banner-title">全景毛玻璃与透明度定制</div>
          <div class="dsh-banner-sub">
            支持无级调节侧边栏、对话消息卡片透明度、高斯模糊度以及光晕壁纸饱和度
          </div>
        </div>
        <div class="dsh-banner-actions">
          <button
            type="button"
            class="dsh-btn dsh-btn-outline dsh-btn-sm"
            onClick={handleReset}
            title="恢复默认毛玻璃设置"
          >
            重置默认
          </button>
          <DshSwitch
            checked={settings.enabled}
            onChange={(next) => update({ enabled: next })}
          />
        </div>
      </div>

      {/* 预设方案一键套用 */}
      <div class="dsh-group-stack">
        <h4 class="dsh-group-heading">风格预设一键套用</h4>
        <div class="dsh-presets-grid">
          {GLASS_PRESETS.map((preset) => {
            const isCurrent = activePresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                class={`dsh-preset-card ${isCurrent ? 'is-active' : ''}`}
                onClick={() => applyPreset(preset.id)}
              >
                <div class="dsh-preset-name">{preset.name}</div>
                <div class="dsh-preset-desc">{preset.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 核心透明度与模糊度滑块调节 */}
      <div class="dsh-group-stack">
        <h4 class="dsh-group-heading">视觉参数精细调节</h4>
        <div class="dsh-general-card">
          {/* 面板与侧边栏透明度 */}
          <div class="dsh-slider-row">
            <div class="dsh-slider-header">
              <div class="dsh-slider-meta">
                <span class="dsh-slider-title">工作台与侧边栏透明度</span>
                <span class="dsh-slider-desc">控制左侧导航栏、应用外壳与侧面板背景的不透明度</span>
              </div>
              <span class="dsh-slider-value">{Math.round(settings.panelOpacity * 100)}%</span>
            </div>
            <input
              type="range"
              class="dsh-slider"
              min="0.10"
              max="1.00"
              step="0.02"
              value={settings.panelOpacity}
              onInput={(e) => {
                setActivePresetId('custom');
                update({ panelOpacity: parseFloat((e.currentTarget as HTMLInputElement).value) });
              }}
            />
          </div>

          <div class="dsh-general-divider" />

          {/* 消息与输入框卡片透明度 */}
          <div class="dsh-slider-row">
            <div class="dsh-slider-header">
              <div class="dsh-slider-meta">
                <span class="dsh-slider-title">对话卡片与输入框透明度</span>
                <span class="dsh-slider-desc">控制问答消息卡片、输入框胶囊与弹窗内容区域的不透明度</span>
              </div>
              <span class="dsh-slider-value">{Math.round(settings.cardOpacity * 100)}%</span>
            </div>
            <input
              type="range"
              class="dsh-slider"
              min="0.20"
              max="1.00"
              step="0.02"
              value={settings.cardOpacity}
              onInput={(e) => {
                setActivePresetId('custom');
                update({ cardOpacity: parseFloat((e.currentTarget as HTMLInputElement).value) });
              }}
            />
          </div>

          <div class="dsh-general-divider" />

          {/* 高斯模糊度 */}
          <div class="dsh-slider-row">
            <div class="dsh-slider-header">
              <div class="dsh-slider-meta">
                <span class="dsh-slider-title">高斯磨砂模糊半径</span>
                <span class="dsh-slider-desc">背景毛玻璃散射程度（0px 为纯透，48px 为浓厚雾面）</span>
              </div>
              <span class="dsh-slider-value">{settings.blur} px</span>
            </div>
            <input
              type="range"
              class="dsh-slider"
              min="0"
              max="48"
              step="1"
              value={settings.blur}
              onInput={(e) => {
                setActivePresetId('custom');
                update({ blur: parseInt((e.currentTarget as HTMLInputElement).value, 10) });
              }}
            />
          </div>

          <div class="dsh-general-divider" />

          {/* 高光细边框透明度 */}
          <div class="dsh-slider-row">
            <div class="dsh-slider-header">
              <div class="dsh-slider-meta">
                <span class="dsh-slider-title">毛玻璃微光边框强度</span>
                <span class="dsh-slider-desc">卡片与分界线边缘的反光强度，强化卡片立体悬浮层级感</span>
              </div>
              <span class="dsh-slider-value">{Math.round(settings.borderOpacity * 100)}%</span>
            </div>
            <input
              type="range"
              class="dsh-slider"
              min="0.00"
              max="1.00"
              step="0.05"
              value={settings.borderOpacity}
              onInput={(e) => {
                setActivePresetId('custom');
                update({ borderOpacity: parseFloat((e.currentTarget as HTMLInputElement).value) });
              }}
            />
          </div>

          <div class="dsh-general-divider" />

          {/* 极光壁纸开关与光晕饱和度 */}
          <div class="dsh-general-row">
            <div class="dsh-general-meta">
              <div class="dsh-general-label">流动极光渐变壁纸</div>
              <div class="dsh-general-desc">开启苹果风格暖阳橙/水波青/极光蓝流动网格壁纸；关闭后呈现极简底色</div>
            </div>
            <DshSwitch
              checked={settings.wallpaperMesh}
              onChange={(next) => {
                setActivePresetId('custom');
                update({ wallpaperMesh: next });
              }}
            />
          </div>

          {settings.wallpaperMesh && (
            <div class="dsh-slider-row" style={{ marginTop: '12px' }}>
              <div class="dsh-slider-header">
                <div class="dsh-slider-meta">
                  <span class="dsh-slider-title" style={{ fontSize: '13px' }}>壁纸光晕饱和度</span>
                </div>
                <span class="dsh-slider-value">{Math.round(settings.wallpaperIntensity * 100)}%</span>
              </div>
              <input
                type="range"
                class="dsh-slider"
                min="0.10"
                max="1.00"
                step="0.05"
                value={settings.wallpaperIntensity}
                onInput={(e) => {
                  setActivePresetId('custom');
                  update({ wallpaperIntensity: parseFloat((e.currentTarget as HTMLInputElement).value) });
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* 实时交互预览卡片 */}
      <div class="dsh-group-stack">
        <h4 class="dsh-group-heading">实时渲染预览效果</h4>
        <div class="dsh-glass-preview-stage">
          <div class="dsh-glass-preview-card">
            <div class="dsh-glass-preview-head">
              <span class="dsh-glass-preview-icon">✨</span>
              <span class="dsh-glass-preview-title">Glassmorphism UI</span>
              <span class="dsh-glass-preview-badge">实时透光</span>
            </div>
            <div class="dsh-glass-preview-body">
              拖动上方滑块即可实时预览毛玻璃透光、磨砂散射与背景流光的呼吸感，整站界面已同步即时渲染。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
