/**
 * 苹果毛玻璃与透明度定制套件 (Apple Glassmorphism & Opacity Suite)
 * -----------------------------------------------------------------------------
 * 1. 负责持久化存储、预设方案以及全局 CSS 变量的无级动态映射。
 * 2. 支持面板/侧边栏透明度、消息卡片透明度、高斯模糊半径、边框透明度及光晕壁纸强度的实时无缝调节。
 */

export interface GlassThemeSettings {
  enabled: boolean;
  panelOpacity: number; // 0.10 ~ 1.00 (主面板/侧边栏背景透明度，默认 0.50)
  cardOpacity: number; // 0.20 ~ 1.00 (会话消息与输入框卡片透明度，默认 0.88)
  blur: number; // 0 ~ 48 (高斯模糊半径 px，默认 28)
  borderOpacity: number; // 0.00 ~ 1.00 (毛玻璃高光边框不透明度，默认 0.86)
  wallpaperMesh: boolean; // 是否开启苹果极光渐变光晕壁纸，默认 true
  wallpaperIntensity: number; // 0.00 ~ 1.00 (壁纸光晕色彩饱和度/强度，默认 0.90)
}

export const DEFAULT_GLASS_THEME_SETTINGS: GlassThemeSettings = {
  enabled: true,
  panelOpacity: 0.50,
  cardOpacity: 0.88,
  blur: 28,
  borderOpacity: 0.86,
  wallpaperMesh: true,
  wallpaperIntensity: 0.90,
};

export interface GlassPresetOption {
  id: string;
  name: string;
  desc: string;
  settings: Partial<GlassThemeSettings>;
}

export const GLASS_PRESETS: GlassPresetOption[] = [
  {
    id: 'apple-default',
    name: '✨ 苹果原汁 (Apple Default)',
    desc: '官方均衡调校，通透与内容可读性的黄金平衡',
    settings: {
      panelOpacity: 0.50,
      cardOpacity: 0.88,
      blur: 28,
      borderOpacity: 0.86,
      wallpaperMesh: true,
      wallpaperIntensity: 0.90,
    },
  },
  {
    id: 'ultra-transparent',
    name: '🫧 空灵极透 (Ultra Transparent)',
    desc: '极低面板不透明度，最大化展现壁纸流光与次世代通透感',
    settings: {
      panelOpacity: 0.22,
      cardOpacity: 0.62,
      blur: 36,
      borderOpacity: 0.75,
      wallpaperMesh: true,
      wallpaperIntensity: 1.0,
    },
  },
  {
    id: 'deep-frosted',
    name: '🌫️ 雾面厚磨砂 (Deep Frosted)',
    desc: '更浓郁的磨砂质感，减少背景干扰，兼顾高对比度',
    settings: {
      panelOpacity: 0.72,
      cardOpacity: 0.94,
      blur: 22,
      borderOpacity: 0.90,
      wallpaperMesh: true,
      wallpaperIntensity: 0.75,
    },
  },
  {
    id: 'solid-focus',
    name: '🧱 纯净低透 (Solid Focus)',
    desc: '接近纯色的轻度微光，专注纯粹文本与密集代码阅读',
    settings: {
      panelOpacity: 0.92,
      cardOpacity: 0.98,
      blur: 10,
      borderOpacity: 0.95,
      wallpaperMesh: false,
      wallpaperIntensity: 0.40,
    },
  },
];

const STORAGE_KEY = 'zap.glass-theme.settings';
export const GLASS_THEME_CHANGE_EVENT = 'zap:glass-theme-changed';

export function loadGlassThemeSettings(): GlassThemeSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_GLASS_THEME_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_GLASS_THEME_SETTINGS,
        ...parsed,
      };
    }
  } catch {
    /* ignore parse error */
  }
  return { ...DEFAULT_GLASS_THEME_SETTINGS };
}

export function saveGlassThemeSettings(settings: GlassThemeSettings) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    applyGlassThemeSettings(settings);
    window.dispatchEvent(
      new CustomEvent(GLASS_THEME_CHANGE_EVENT, { detail: settings }),
    );
  } catch {
    /* ignore storage error */
  }
}

/**
 * 将设置动态计算并注入到 document.documentElement 的 CSS 变量中
 */
export function applyGlassThemeSettings(settings: GlassThemeSettings = loadGlassThemeSettings()) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const isDark =
    root.getAttribute('data-theme') === 'dark' ||
    (!root.getAttribute('data-theme') &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  if (!settings.enabled) {
    // 禁用时清理动态注入的内联变量，回退到原始 theme.css
    root.style.removeProperty('--zap-glass-blur');
    root.style.removeProperty('--zap-glass-bg');
    root.style.removeProperty('--zap-glass-panel-bg');
    root.style.removeProperty('--zap-glass-card-bg');
    root.style.removeProperty('--zap-glass-card-hover-bg');
    root.style.removeProperty('--zap-glass-border');
    root.style.removeProperty('--zap-wallpaper');
    return;
  }

  const pOp = Math.max(0.05, Math.min(1, settings.panelOpacity));
  const cOp = Math.max(0.10, Math.min(1, settings.cardOpacity));
  const cHoverOp = Math.min(1, cOp + 0.08);
  const blurVal = Math.max(0, Math.min(60, settings.blur));
  const bOp = Math.max(0, Math.min(1, settings.borderOpacity));

  root.style.setProperty('--zap-glass-blur', `${blurVal}px`);

  if (isDark) {
    // 暗黑模式配色基调（Slate 900 ~ 800）
    root.style.setProperty('--zap-glass-bg', `rgba(15, 23, 42, ${pOp * 1.15})`);
    root.style.setProperty('--zap-glass-panel-bg', `rgba(15, 23, 42, ${pOp})`);
    root.style.setProperty('--zap-glass-card-bg', `rgba(30, 41, 59, ${cOp})`);
    root.style.setProperty('--zap-glass-card-hover-bg', `rgba(30, 41, 59, ${cHoverOp})`);
    root.style.setProperty('--zap-glass-border', `rgba(255, 255, 255, ${bOp * 0.16})`);

    if (!settings.wallpaperMesh) {
      root.style.setProperty(
        '--zap-wallpaper',
        'linear-gradient(135deg, #0b1120 0%, #0f172a 45%, #111827 100%)',
      );
    } else {
      const wi = settings.wallpaperIntensity;
      root.style.setProperty(
        '--zap-wallpaper',
        `radial-gradient(circle at 10% 85%, rgba(30, 58, 138, ${0.42 * wi}) 0%, transparent 55%), ` +
          `radial-gradient(circle at 38% 10%, rgba(15, 118, 110, ${0.32 * wi}) 0%, transparent 55%), ` +
          `radial-gradient(circle at 88% 20%, rgba(49, 46, 129, ${0.40 * wi}) 0%, transparent 58%), ` +
          `radial-gradient(circle at 86% 88%, rgba(29, 78, 216, ${0.35 * wi}) 0%, transparent 58%), ` +
          `linear-gradient(135deg, #0b1120 0%, #0f172a 45%, #111827 100%)`,
      );
    }
  } else {
    // 浅色模式配色基调（Pure Ivory & Ice Slate）
    root.style.setProperty('--zap-glass-bg', `rgba(255, 255, 255, ${pOp * 1.15})`);
    root.style.setProperty('--zap-glass-panel-bg', `rgba(255, 255, 255, ${pOp})`);
    root.style.setProperty('--zap-glass-card-bg', `rgba(255, 255, 255, ${cOp})`);
    root.style.setProperty('--zap-glass-card-hover-bg', `rgba(255, 255, 255, ${cHoverOp})`);
    root.style.setProperty('--zap-glass-border', `rgba(255, 255, 255, ${bOp})`);

    if (!settings.wallpaperMesh) {
      root.style.setProperty(
        '--zap-wallpaper',
        'linear-gradient(135deg, #f1f5f9 0%, #f8fafc 100%)',
      );
    } else {
      const wi = settings.wallpaperIntensity;
      root.style.setProperty(
        '--zap-wallpaper',
        `radial-gradient(circle at 6% 88%, rgba(244, 190, 174, ${0.94 * wi}) 0%, rgba(248, 212, 200, ${0.62 * wi}) 34%, transparent 62%), ` +
          `radial-gradient(circle at 38% 6%, rgba(192, 238, 232, ${0.90 * wi}) 0%, rgba(216, 246, 242, ${0.56 * wi}) 38%, transparent 66%), ` +
          `radial-gradient(circle at 92% 22%, rgba(200, 218, 252, ${0.88 * wi}) 0%, rgba(218, 232, 254, ${0.54 * wi}) 42%, transparent 68%), ` +
          `radial-gradient(circle at 90% 90%, rgba(190, 212, 252, ${0.94 * wi}) 0%, rgba(214, 228, 254, ${0.60 * wi}) 40%, transparent 66%), ` +
          `linear-gradient(135deg, #e5f3f1 0%, #f5ebe6 36%, #ecf1fb 70%, #d6e4fc 100%)`,
      );
    }
  }
}

/**
 * 监听主题切换，自动重算生效变量
 */
if (typeof window !== 'undefined') {
  // 初次启动立即应用持久化配置
  applyGlassThemeSettings();

  // 观察 html[data-theme] 属性变动
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'data-theme') {
        applyGlassThemeSettings();
      }
    }
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
