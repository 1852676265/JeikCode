/**
 * 1:1 DeepSeek Harness (DSH) 原生启动动画与壁纸配置面板
 * -----------------------------------------------------------------------------
 * 100% 像素级对齐 DSH 官方 `dsh-boot-suite` / `dsh-startup-screen` 控制台
 */

import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';

export interface BootSuiteSettings {
  startup: {
    enabled: boolean;
    mode: 'session' | 'always' | 'daily';
    theme: string;
    speed: number;
    requireInteraction: boolean;
    allowSkip: boolean;
    sound: boolean;
    soundVolume: number;
    voice: boolean;
    voicePack: string;
    voiceVolume: number;
    act1VideoSound: boolean;
    act2: boolean;
    act2Template: string;
    transition: string;
    identity: string;
    identityId: string;
    accessLevel: string;
    accent: string;
    bgmEnabled: boolean;
    bgmLoop: boolean;
    bgmFile?: string;
    bgmFile2?: string;
  };
  wallpaper: {
    enabled: boolean;
    image: string;
    veilOpacity: number;
    blur: number;
    bannerEnabled: boolean;
    bannerText: string;
    bannerOpacity: number;
  };
}

export const DEFAULT_BOOT_SETTINGS: BootSuiteSettings = {
  startup: {
    enabled: true,
    mode: 'session', // 默认为会话单次播放，解决刷新无谓重复弹出的问题
    theme: 'dark',
    speed: 1.0,
    requireInteraction: true,
    allowSkip: true,
    sound: true,
    soundVolume: 0.6,
    voice: true,
    voicePack: 'f',
    voiceVolume: 0.9,
    act1VideoSound: false,
    act2: true,
    act2Template: 'whale-girl-scan',
    transition: 'dissolve',
    identity: 'JOYCE MOORE',
    identityId: '0087',
    accessLevel: '3',
    accent: '#ff7500',
    bgmEnabled: false,
    bgmLoop: true,
    bgmFile: '',
    bgmFile2: '',
  },
  wallpaper: {
    enabled: true,
    image: '/api/plugins/assets/dsh-boot-suite/assets/default-background.jpg',
    veilOpacity: 0.38,
    blur: 0,
    bannerEnabled: true,
    bannerText: 'DEEPSEEK HARNESS',
    bannerOpacity: 0.08,
  },
};

const STORAGE_KEY = 'zap.boot-suite.settings';

export function loadBootSettings(): BootSuiteSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        startup: { ...DEFAULT_BOOT_SETTINGS.startup, ...(parsed.startup || {}) },
        wallpaper: { ...DEFAULT_BOOT_SETTINGS.wallpaper, ...(parsed.wallpaper || {}) },
      };
    }
  } catch {
    /* ignore */
  }
  return JSON.parse(JSON.stringify(DEFAULT_BOOT_SETTINGS));
}

export function saveBootSettings(settings: BootSuiteSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    // 派发全局变更事件
    window.dispatchEvent(
      new CustomEvent('zap:boot-suite-settings-changed', { detail: settings }),
    );
  } catch {
    /* ignore */
  }
}

export function DshBootAnimationSettingsPanel({
  onClose,
}: {
  onClose?: () => void;
}) {
  const [settings, setSettings] = useState<BootSuiteSettings>(() => loadBootSettings());
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);

  useEffect(() => {
    const handleSync = () => setSettings(loadBootSettings());
    window.addEventListener('zap:boot-suite-settings-changed', handleSync);
    return () => window.removeEventListener('zap:boot-suite-settings-changed', handleSync);
  }, []);

  const updateStartup = <K extends keyof BootSuiteSettings['startup']>(
    key: K,
    val: BootSuiteSettings['startup'][K],
  ) => {
    const next: BootSuiteSettings = {
      ...settings,
      startup: { ...settings.startup, [key]: val },
    };
    setSettings(next);
    saveBootSettings(next);
  };

  const updateWallpaper = <K extends keyof BootSuiteSettings['wallpaper']>(
    key: K,
    val: BootSuiteSettings['wallpaper'][K],
  ) => {
    const next: BootSuiteSettings = {
      ...settings,
      wallpaper: { ...settings.wallpaper, [key]: val },
    };
    setSettings(next);
    saveBootSettings(next);
  };

  const handleSave = () => {
    saveBootSettings(settings);
    setSaveStatus('已保存设置！下次启动或立即预览生效。');
    setTimeout(() => setSaveStatus(null), 3000);
  };

  const handlePreview = () => {
    saveBootSettings(settings);
    const win = window as any;
    if (win.__DSH_BOOT_SUITE_API__?.replay) {
      win.__DSH_BOOT_SUITE_API__.replay();
    } else if (win.__DSH_STARTUP_API__?.replay) {
      win.__DSH_STARTUP_API__.replay();
    } else {
      // 动态注入脚本触发重播
      const script = document.createElement('script');
      script.src = `/api/plugins/assets/dsh-boot-suite/splash.js?t=${Date.now()}`;
      document.body.appendChild(script);
    }
  };

  const s = settings.startup;
  const wp = settings.wallpaper;

  return (
    <div class="__ss_root">
      {/* 顶部版本号与快捷栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
        <div class="__ss_version">版本 v2.16.10</div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            class="__ss_btn"
            style={{ fontSize: '12px', padding: '4px 10px' }}
            onClick={() => setShowConfigModal(true)}
          >
            打开配置文件
          </button>
        </div>
      </div>

      {/* 1. 播放配置组 */}
      <div class="__ss_group">
        <div class="__ss_groupTitle">播放</div>
        <label class="__ss_check">
          <input
            type="checkbox"
            checked={s.enabled}
            onChange={(e) => updateStartup('enabled', (e.target as HTMLInputElement).checked)}
          />
          <div class="__ss_checkText">
            <span class="__ss_label">启用启动动画</span>
            <span class="__ss_hint">关闭后直接进界面，不再显示启动界面。</span>
          </div>
        </label>

        <div class="__ss_field">
          <label class="__ss_label">播放时机</label>
          <select
            class="__ss_select"
            value={s.mode}
            onChange={(e) =>
              updateStartup('mode', (e.target as HTMLSelectElement).value as 'session' | 'always' | 'daily')
            }
          >
            <option value="session">每个浏览器会话一次</option>
            <option value="always">每次打开都播放</option>
            <option value="daily">每天一次</option>
          </select>
        </div>

        <div class="__ss_field">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label class="__ss_label">速度倍率</label>
            <span class="__ss_status">{Number(s.speed || 1).toFixed(2)}×</span>
          </div>
          <div class="__ss_row">
            <input
              type="range"
              min="0.35"
              max="3"
              step="0.05"
              value={s.speed || 1}
              style={{ flex: '1 1 240px' }}
              onInput={(e) => updateStartup('speed', Number((e.target as HTMLInputElement).value))}
            />
          </div>
          <div class="__ss_hint">
            0.35 慢放 · 1 原速 · 3 快放；参考片时长约 27 秒，默认整套约 16 秒。
          </div>
        </div>
      </div>

      {/* 2. 自定义动画导入 */}
      <div class="__ss_group">
        <div class="__ss_groupTitle">自定义动画</div>
        <div class="__ss_hint">
          把你的视频 / 动图 / 图片导入成模板，再到下面的「模板」组里选它（第一幕 / 第二幕都行）。文件只存本机，不会上传。
        </div>
        <div class="__ss_row">
          <label class="__ss_btn" style={{ cursor: 'pointer' }}>
            <span>📥 导入动画</span>
            <input
              type="file"
              accept="video/mp4,video/webm,image/gif,image/png,image/jpeg,image/webp"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) {
                  alert(`已选择动画文件: ${file.name}（大小: ${(file.size / 1024 / 1024).toFixed(1)}MB）`);
                }
              }}
            />
          </label>
          <span class="__ss_hint">支持 mp4 / webm / gif / png / jpg / webp，单文件 ≤ 64MB</span>
        </div>
      </div>

      {/* 3. 背景音乐（用户自备） */}
      <div class="__ss_group">
        <div class="__ss_groupTitle">背景音乐（用户自备）</div>
        <div class="__ss_hint">
          导入你自己的音乐给开机动画配乐：只存本机、不上传、不内置。请确认你拥有该音乐的使用权。
        </div>
        <label class="__ss_check">
          <input
            type="checkbox"
            checked={s.bgmEnabled}
            onChange={(e) => updateStartup('bgmEnabled', (e.target as HTMLInputElement).checked)}
          />
          <div class="__ss_checkText">
            <span class="__ss_label">启用背景音乐</span>
          </div>
        </label>
        <label class="__ss_check">
          <input
            type="checkbox"
            checked={s.bgmLoop}
            onChange={(e) => updateStartup('bgmLoop', (e.target as HTMLInputElement).checked)}
          />
          <div class="__ss_checkText">
            <span class="__ss_label">循环播放</span>
          </div>
        </label>
        <div class="__ss_row">
          <label class="__ss_btn" style={{ cursor: 'pointer' }}>
            <span>🎵 导入音乐</span>
            <input
              type="file"
              accept="audio/mp3,audio/wav,audio/ogg"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) {
                  updateStartup('bgmFile', file.name);
                }
              }}
            />
          </label>
          <span class="__ss_hint">{s.bgmFile || '还没有导入音乐'}</span>
        </div>
        <div class="__ss_field">
          <label class="__ss_label">第二段换曲</label>
          <div class="__ss_row">
            <select
              class="__ss_select"
              value={s.bgmFile2 || ''}
              onChange={(e) => updateStartup('bgmFile2', (e.target as HTMLSelectElement).value)}
            >
              <option value="">同第一段</option>
              {s.bgmFile && <option value={s.bgmFile}>{s.bgmFile}</option>}
            </select>
            <label class="__ss_btn" style={{ cursor: 'pointer' }}>
              <span>导入第二首</span>
              <input
                type="file"
                accept="audio/mp3,audio/wav,audio/ogg"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (file) {
                    updateStartup('bgmFile2', file.name);
                  }
                }}
              />
            </label>
          </div>
        </div>
      </div>

      {/* 4. 模板与视觉 */}
      <div class="__ss_group">
        <div class="__ss_groupTitle">模板与视觉</div>
        <div class="__ss_field">
          <label class="__ss_label">启动动画第一幕</label>
          <div class="__ss_row">
            <select class="__ss_select" value="archive-warm" disabled>
              <option value="archive-warm">内置（档案暖白）</option>
            </select>
            <button type="button" class="__ss_btn" disabled>移出测试类</button>
            <button type="button" class="__ss_btn" disabled>删除该动画</button>
          </div>
          <div class="__ss_hint">先播这一段。默认「档案暖白」，结尾是 WELCOME TO DEEPSEEK HARNESS。</div>
        </div>

        <label class="__ss_check">
          <input
            type="checkbox"
            checked={s.act1VideoSound}
            onChange={(e) => updateStartup('act1VideoSound', (e.target as HTMLInputElement).checked)}
          />
          <div class="__ss_checkText">
            <span class="__ss_label">播放第一幕视频原声</span>
            <span class="__ss_hint">第一幕使用视频/导入动画时，是否播放视频自带的声音；默认静音。</span>
          </div>
        </label>

        <div class="__ss_field">
          <label class="__ss_label">启动动画第二幕</label>
          <div class="__ss_row">
            <select
              class="__ss_select"
              value={s.act2 ? (s.act2Template || 'whale-girl-scan') : ''}
              onChange={(e) => {
                const val = (e.target as HTMLSelectElement).value;
                if (!val) {
                  updateStartup('act2', false);
                } else {
                  updateStartup('act2', true);
                  updateStartup('act2Template', val);
                }
              }}
            >
              <option value="whale-girl-scan">whale-girl-scan · 鲸鱼娘睁眼扫描短片 (2K)</option>
              <option value="whale-girl-scan-4k">whale-girl-scan-4k · 4K 高码率母带版</option>
              <option value="bigfish-v5-act2">bigfish-v5-act2 · 全景大肥鱼第二幕</option>
              <option value="">不播放（第一幕结束直接进聊天）</option>
            </select>
          </div>
          <div class="__ss_hint">第一幕播完接着播这一段；选「不播放」就第一幕结束直接进聊天。</div>
        </div>

        <div class="__ss_field">
          <label class="__ss_label">第二幕转场</label>
          <select
            class="__ss_select"
            value={s.transition || 'dissolve'}
            onChange={(e) => updateStartup('transition', (e.target as HTMLSelectElement).value)}
          >
            <option value="dissolve">交叉叠化（默认）</option>
            <option value="flash">闪白</option>
            <option value="glitch">故障</option>
            <option value="scanline">扫描线</option>
            <option value="none">硬切</option>
          </select>
        </div>
      </div>

      {/* 5. 声效与配音 */}
      <div class="__ss_group">
        <div class="__ss_groupTitle">声音与真人配音</div>
        <label class="__ss_check">
          <input
            type="checkbox"
            checked={s.sound}
            onChange={(e) => updateStartup('sound', (e.target as HTMLInputElement).checked)}
          />
          <div class="__ss_checkText">
            <span class="__ss_label">启用界面音效</span>
            <span class="__ss_hint">准星锁定、数据跳动、开关接通的拟真音效。</span>
          </div>
        </label>
        {s.sound && (
          <div class="__ss_field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label class="__ss_label">音效音量</label>
              <span class="__ss_status">{Math.round((s.soundVolume ?? 0.6) * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={s.soundVolume ?? 0.6}
              onInput={(e) => updateStartup('soundVolume', Number((e.target as HTMLInputElement).value))}
            />
          </div>
        )}

        <label class="__ss_check">
          <input
            type="checkbox"
            checked={s.voice}
            onChange={(e) => updateStartup('voice', (e.target as HTMLInputElement).checked)}
          />
          <div class="__ss_checkText">
            <span class="__ss_label">启用真人语音解说</span>
            <span class="__ss_hint">技术档案认证与系统苏醒阶段的真人语音台词。</span>
          </div>
        </label>
        {s.voice && (
          <div class="__ss_two">
            <div class="__ss_field">
              <label class="__ss_label">语音包声线</label>
              <select
                class="__ss_select"
                value={s.voicePack || 'f'}
                onChange={(e) => updateStartup('voicePack', (e.target as HTMLSelectElement).value)}
              >
                <option value="f">声线 f · 清爽干练女声</option>
                <option value="g">声线 g · 磁性稳重女声</option>
                <option value="h">声线 h · 沉稳专业男声</option>
                <option value="i">声线 i · 温柔治愈女声</option>
                <option value="j">声线 j · 知性御姐音</option>
                <option value="k">声线 k · 阳光清亮少年音</option>
              </select>
            </div>
            <div class="__ss_field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label class="__ss_label">解说音量</label>
                <span class="__ss_status">{Math.round((s.voiceVolume ?? 0.9) * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={s.voiceVolume ?? 0.9}
                onInput={(e) => updateStartup('voiceVolume', Number((e.target as HTMLInputElement).value))}
              />
            </div>
          </div>
        )}
      </div>

      {/* 6. 聊天室全景壁纸与大字横幅 */}
      <div class="__ss_group">
        <div class="__ss_groupTitle">聊天背景与大字横幅</div>
        <label class="__ss_check">
          <input
            type="checkbox"
            checked={wp.enabled}
            onChange={(e) => updateWallpaper('enabled', (e.target as HTMLInputElement).checked)}
          />
          <div class="__ss_checkText">
            <span class="__ss_label">启用聊天室全景背景</span>
            <span class="__ss_hint">在对话区铺设沉浸式背景底图。</span>
          </div>
        </label>
        {wp.enabled && (
          <>
            <div class="__ss_field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label class="__ss_label">半透明遮罩浓度 (Veil)</label>
                <span class="__ss_status">{Math.round((wp.veilOpacity ?? 0.38) * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.02"
                value={wp.veilOpacity ?? 0.38}
                onInput={(e) => updateWallpaper('veilOpacity', Number((e.target as HTMLInputElement).value))}
              />
            </div>

            <label class="__ss_check">
              <input
                type="checkbox"
                checked={wp.bannerEnabled}
                onChange={(e) => updateWallpaper('bannerEnabled', (e.target as HTMLInputElement).checked)}
              />
              <div class="__ss_checkText">
                <span class="__ss_label">大字横幅 (Banner)</span>
                <span class="__ss_hint">窗口中央的半透明立体矢量字。</span>
              </div>
            </label>
            {wp.bannerEnabled && (
              <div class="__ss_field">
                <input
                  type="text"
                  class="__ss_input"
                  value={wp.bannerText}
                  placeholder="DEEPSEEK HARNESS"
                  onInput={(e) => updateWallpaper('bannerText', (e.target as HTMLInputElement).value)}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* 底部操作栏 */}
      <div class="__ss_actions" style={{ marginTop: '12px' }}>
        <button
          type="button"
          class="__ss_btn __ss_btnPrimary"
          onClick={handlePreview}
          title="立即在当前窗口全屏重放开机动画"
        >
          <span>🎬 立即预览</span>
        </button>
        <button
          type="button"
          class="__ss_btn"
          onClick={handleSave}
        >
          保存设置
        </button>
        {saveStatus && <span class="__ss_ok">{saveStatus}</span>}
      </div>

      {/* 配置文件弹窗 */}
      {showConfigModal && (
        <div
          class="dsh-settings-backdrop"
          style={{ zIndex: 9999 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowConfigModal(false);
          }}
        >
          <div
            class="dsh-settings-dialog"
            style={{ maxWidth: '600px', width: '90%', padding: '24px', background: '#181b22', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>startup-screen.json 配置文件</h3>
              <button
                type="button"
                class="dsh-settings-close-btn"
                onClick={() => setShowConfigModal(false)}
              >
                ✕
              </button>
            </div>
            <p style={{ fontSize: '13px', color: '#94a3b8', margin: '0 0 12px 0' }}>
              本插件配置持久化在浏览器的 <code>localStorage['{STORAGE_KEY}']</code> 中：
            </p>
            <pre
              style={{
                background: '#0d1117',
                padding: '12px',
                borderRadius: '8px',
                fontSize: '12px',
                fontFamily: 'Consolas, monospace',
                maxHeight: '320px',
                overflow: 'auto',
                color: '#58a6ff',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              {JSON.stringify(settings, null, 2)}
            </pre>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button
                type="button"
                class="__ss_btn"
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(settings, null, 2));
                  alert('已复制 JSON 配置到剪贴板！');
                }}
              >
                复制配置
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
