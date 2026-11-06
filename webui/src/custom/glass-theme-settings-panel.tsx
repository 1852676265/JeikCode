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
          <div class="dsh-banner-title">🎨 苹果全景毛玻璃与透明度定制套件</div>
          <div class="dsh-banner-sub">
            支持无级调节侧边栏、对话消息卡片透明度、高斯模糊强度以及光晕壁纸饱和度，打造独一无二的通透质感。
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            type="button"
            class="dsh-btn"
            onClick={handleReset}
            title="恢复默认毛玻璃设置"
          >
            重置默认
          </button>
          <label class="dsh-switch-wrap" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              class="dsh-switch-checkbox"
              checked={settings.enabled}
              onChange={(e) => update({ enabled: (e.currentTarget as HTMLInputElement).checked })}
            />
            <span class="dsh-switch-slider" />
          </label>
        </div>
      </div>

      {/* 预设方案一键套用 */}
      <div class="dsh-group-stack">
        <h3 class="dsh-group-heading">风格预设一键套用 (Style Presets)</h3>
        <div class="dsh-presets-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
          {GLASS_PRESETS.map((preset) => {
            const isCurrent = activePresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                class={`dsh-preset-card ${isCurrent ? 'is-active' : ''}`}
                style={{
                  textAlign: 'left',
                  cursor: 'pointer',
                  border: isCurrent ? '1px solid #38bdf8' : '1px solid rgba(148, 163, 184, 0.14)',
                  background: isCurrent ? 'rgba(56, 189, 248, 0.12)' : 'rgba(30, 41, 59, 0.45)',
                  padding: '14px',
                  borderRadius: '12px',
                  transition: 'all 0.18s ease',
                }}
                onClick={() => applyPreset(preset.id)}
              >
                <div style={{ fontWeight: 600, fontSize: '13px', color: '#f1f5f9', marginBottom: '4px' }}>
                  {preset.name}
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.4 }}>
                  {preset.desc}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 核心透明度与模糊度滑块调节 */}
      <div class="dsh-group-stack">
        <h3 class="dsh-group-heading">视觉参数精细调节 (Fine-tuning Controls)</h3>
        <div class="dsh-general-card">
          {/* 面板与侧边栏透明度 */}
          <div class="dsh-slider-row" style={{ padding: '8px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: '13px', color: '#f1f5f9' }}>
                  工作台与侧边栏透明度 (Panel Opacity)
                </span>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                  控制左侧导航栏、应用外壳与侧面板背景的不透明度（越低越透出壁纸）
                </div>
              </div>
              <span class="dsh-slider-value" style={{ fontWeight: 'bold', color: '#38bdf8', fontSize: '13px' }}>
                {Math.round(settings.panelOpacity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0.10"
              max="1.00"
              step="0.02"
              value={settings.panelOpacity}
              onInput={(e) => {
                setActivePresetId('custom');
                update({ panelOpacity: parseFloat((e.currentTarget as HTMLInputElement).value) });
              }}
              style={{ width: '100%', accentColor: '#38bdf8' }}
            />
          </div>

          <div class="dsh-general-divider" />

          {/* 消息与输入框卡片透明度 */}
          <div class="dsh-slider-row" style={{ padding: '8px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: '13px', color: '#f1f5f9' }}>
                  对话卡片与输入框透明度 (Card Opacity)
                </span>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                  控制问答消息卡片、输入框胶囊与弹窗内容区域的不透明度
                </div>
              </div>
              <span class="dsh-slider-value" style={{ fontWeight: 'bold', color: '#38bdf8', fontSize: '13px' }}>
                {Math.round(settings.cardOpacity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0.20"
              max="1.00"
              step="0.02"
              value={settings.cardOpacity}
              onInput={(e) => {
                setActivePresetId('custom');
                update({ cardOpacity: parseFloat((e.currentTarget as HTMLInputElement).value) });
              }}
              style={{ width: '100%', accentColor: '#38bdf8' }}
            />
          </div>

          <div class="dsh-general-divider" />

          {/* 高斯模糊度 */}
          <div class="dsh-slider-row" style={{ padding: '8px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: '13px', color: '#f1f5f9' }}>
                  高斯磨砂模糊半径 (Backdrop Blur)
                </span>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                  背景毛玻璃散射程度（0px 为纯透明玻璃，48px 为深厚雾面霜化）
                </div>
              </div>
              <span class="dsh-slider-value" style={{ fontWeight: 'bold', color: '#38bdf8', fontSize: '13px' }}>
                {settings.blur} px
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="48"
              step="1"
              value={settings.blur}
              onInput={(e) => {
                setActivePresetId('custom');
                update({ blur: parseInt((e.currentTarget as HTMLInputElement).value, 10) });
              }}
              style={{ width: '100%', accentColor: '#38bdf8' }}
            />
          </div>

          <div class="dsh-general-divider" />

          {/* 高光细边框透明度 */}
          <div class="dsh-slider-row" style={{ padding: '8px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: '13px', color: '#f1f5f9' }}>
                  毛玻璃高光边框强度 (Border Highlight)
                </span>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                  卡片与分界线边缘的微光反光强度，强化卡片立体悬浮层级感
                </div>
              </div>
              <span class="dsh-slider-value" style={{ fontWeight: 'bold', color: '#38bdf8', fontSize: '13px' }}>
                {Math.round(settings.borderOpacity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0.00"
              max="1.00"
              step="0.05"
              value={settings.borderOpacity}
              onInput={(e) => {
                setActivePresetId('custom');
                update({ borderOpacity: parseFloat((e.currentTarget as HTMLInputElement).value) });
              }}
              style={{ width: '100%', accentColor: '#38bdf8' }}
            />
          </div>

          <div class="dsh-general-divider" />

          {/* 极光壁纸开关与光晕饱和度 */}
          <div class="dsh-general-row">
            <div class="dsh-general-meta">
              <div class="dsh-general-label">流动极光渐变壁纸 (Aurora Mesh Wallpaper)</div>
              <div class="dsh-general-desc">
                开启苹果风格暖阳橙/水波青/极光蓝流动网格壁纸；关闭后呈现极简纯色背景
              </div>
            </div>
            <input
              type="checkbox"
              checked={settings.wallpaperMesh}
              onChange={(e) => {
                setActivePresetId('custom');
                update({ wallpaperMesh: (e.currentTarget as HTMLInputElement).checked });
              }}
              style={{ width: '18px', height: '18px', accentColor: '#38bdf8', cursor: 'pointer' }}
            />
          </div>

          {settings.wallpaperMesh && (
            <div class="dsh-slider-row" style={{ padding: '12px 0 4px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '12px', color: '#cbd5e1' }}>
                  壁纸光晕饱和度 (Wallpaper Intensity)
                </span>
                <span class="dsh-slider-value" style={{ fontWeight: 'bold', color: '#38bdf8', fontSize: '12px' }}>
                  {Math.round(settings.wallpaperIntensity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.10"
                max="1.00"
                step="0.05"
                value={settings.wallpaperIntensity}
                onInput={(e) => {
                  setActivePresetId('custom');
                  update({ wallpaperIntensity: parseFloat((e.currentTarget as HTMLInputElement).value) });
                }}
                style={{ width: '100%', accentColor: '#38bdf8' }}
              />
            </div>
          )}
        </div>
      </div>

      {/* 实时交互预览卡片 */}
      <div class="dsh-group-stack">
        <h3 class="dsh-group-heading">实时渲染预览效果 (Live Glass Preview)</h3>
        <div
          style={{
            position: 'relative',
            padding: '24px',
            borderRadius: '16px',
            background: 'var(--zap-wallpaper)',
            overflow: 'hidden',
            boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.1)',
          }}
        >
          <div
            style={{
              padding: '16px 20px',
              borderRadius: 'var(--zap-chat-card-radius, 22px)',
              background: 'var(--zap-glass-card-bg)',
              backdropFilter: 'blur(var(--zap-glass-blur, 28px))',
              WebkitBackdropFilter: 'blur(var(--zap-glass-blur, 28px))',
              border: '1px solid var(--zap-glass-border)',
              boxShadow: 'var(--zap-glass-shadow)',
              color: 'var(--app-primary-foreground, #0f172a)',
              maxWidth: '460px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span style={{ fontSize: '15px' }}>✨</span>
              <span style={{ fontWeight: 600, fontSize: '13px' }}>Apple Glassmorphism UI</span>
              <span
                style={{
                  fontSize: '10px',
                  background: 'rgba(56, 189, 248, 0.2)',
                  color: '#38bdf8',
                  padding: '2px 6px',
                  borderRadius: '999px',
                  marginLeft: 'auto',
                }}
              >
                实时透光
              </span>
            </div>
            <div style={{ fontSize: '12px', lineHeight: 1.5, opacity: 0.85 }}>
              拖动上方滑块即可实时预览毛玻璃透光、磨砂散射与背景流光的呼吸感，整站界面已同步即时渲染。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
