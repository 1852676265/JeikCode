import { h } from 'preact';
import { useState, useRef } from 'preact/hooks';

const IconPlus = ({ size = 14, style }: { size?: number; style?: any }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={style}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const IconVolume2 = ({ size = 15, style }: { size?: number; style?: any }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={style}>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
  </svg>
);

export interface PetEntry {
  id: string;
  name: string;
  size: number;
  sizePercent: number;
  display: 'both' | 'web' | 'desktop' | 'none';
  corner: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  marginX: number;
  marginY: number;
  balanceEnabled: boolean;
  whisperEnabled: boolean;
  workStatusEnabled: boolean;
  fixedEnabled: boolean;
  persona: string;
  avatar: string;
}

export interface GlobalFlags {
  notificationsEnabled: boolean;
  clickSoundEnabled: boolean;
  confineToScreen: boolean;
  trayEnabled: boolean;
}

export interface VoiceConfig {
  enabled: boolean;
  voice: string;
  rate: number;
  volume: number;
}

export interface DshPetFullConfig {
  activeKind: string;
  activePetId: string;
  pets: PetEntry[];
  globalFlags: GlobalFlags;
  voiceConfig: VoiceConfig;
}

const DEFAULT_AVATAR = '/fs/raw?path=' + encodeURIComponent('D:/插件/dsh-pet/assets/main-character.png');

const DEFAULT_CONFIG: DshPetFullConfig = {
  activeKind: 'builtin',
  activePetId: 'main',
  pets: [
    {
      id: 'main',
      name: '蓝毛小女仆',
      size: 462,
      sizePercent: 20,
      display: 'both',
      corner: 'top-right',
      marginX: 24,
      marginY: 100,
      balanceEnabled: true,
      whisperEnabled: true,
      workStatusEnabled: true,
      fixedEnabled: false,
      persona: '你是主人桌面上的Q版蓝发小女仆，会时不时碎碎念一句。说话要自然随意、短短一句（20字以内），温柔乖巧带点俏皮，说人话不啰嗦，不要解释你自己，不要提你是AI。',
      avatar: DEFAULT_AVATAR,
    },
  ],
  globalFlags: {
    notificationsEnabled: true,
    clickSoundEnabled: true,
    confineToScreen: false,
    trayEnabled: true,
  },
  voiceConfig: {
    enabled: false,
    voice: 'zh-CN-XiaoxiaoNeural',
    rate: 1.0,
    volume: 1.0,
  },
};

const STORAGE_KEY = 'zap_dsh_pet_full_config';

export function loadDshPetConfig(): DshPetFullConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.pets) && parsed.pets.length > 0) {
        return {
          ...DEFAULT_CONFIG,
          ...parsed,
          pets: parsed.pets.map((p: any) => ({
            ...DEFAULT_CONFIG.pets[0],
            ...p,
            avatar: p.avatar || DEFAULT_AVATAR,
          })),
          globalFlags: { ...DEFAULT_CONFIG.globalFlags, ...parsed.globalFlags },
          voiceConfig: { ...DEFAULT_CONFIG.voiceConfig, ...parsed.voiceConfig },
        };
      }
    }
  } catch (err) {
    console.warn('[dsh-pet] Failed to parse stored config, fallback to default', err);
  }
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

export function saveDshPetConfig(cfg: DshPetFullConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    // 同步旧版简易存储，保持双向兼容
    const mainPet = cfg.pets.find((p) => p.id === cfg.activePetId) || cfg.pets[0];
    if (mainPet) {
      localStorage.setItem('zap_pet_scale', String(mainPet.size / 220));
      localStorage.setItem('zap_pet_sound', String(cfg.globalFlags.clickSoundEnabled));
      localStorage.setItem('zap_pet_locked', String(mainPet.fixedEnabled));
      localStorage.setItem('zap_pet_whisper', String(mainPet.whisperEnabled));
      localStorage.setItem('zap_pet_hidden', String(mainPet.display === 'none'));
    }
    window.dispatchEvent(new CustomEvent('zap:pet-config-changed', { detail: cfg }));
  } catch (err) {
    console.error('[dsh-pet] Save config failed', err);
  }
}

// 辅助组件：带浮动说明的小问号 (?)
function Tooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span
      class="dsh-pet-tip-trigger"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={(e) => { e.stopPropagation(); setShow(!show); }}
    >
      <span class="dsh-pet-q">?</span>
      {show && (
        <span class="dsh-pet-tip-bubble">
          {text}
        </span>
      )}
    </span>
  );
}

export function DshPetSettingsView() {
  const [cfg, setCfg] = useState<DshPetFullConfig>(() => loadDshPetConfig());
  const [feedback, setFeedback] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentPet = cfg.pets.find((p) => p.id === cfg.activePetId) || cfg.pets[0] || DEFAULT_CONFIG.pets[0];

  const updateCurrentPet = (patch: Partial<PetEntry>) => {
    setCfg((prev) => {
      const nextPets = prev.pets.map((p) => {
        if (p.id === currentPet.id) {
          return { ...p, ...patch };
        }
        return p;
      });
      return { ...prev, pets: nextPets };
    });
  };

  const updateGlobalFlags = (patch: Partial<GlobalFlags>) => {
    setCfg((prev) => ({
      ...prev,
      globalFlags: { ...prev.globalFlags, ...patch },
    }));
  };

  const updateVoiceConfig = (patch: Partial<VoiceConfig>) => {
    setCfg((prev) => ({
      ...prev,
      voiceConfig: { ...prev.voiceConfig, ...patch },
    }));
  };

  const handleSave = () => {
    saveDshPetConfig(cfg);
    setFeedback('已保存并即时生效');
    setTimeout(() => setFeedback(''), 2500);
  };

  const handleAddPet = () => {
    const newId = `pet_${Date.now()}`;
    const newPet: PetEntry = {
      ...DEFAULT_CONFIG.pets[0],
      id: newId,
      name: `自定义宠物 ${cfg.pets.length + 1}`,
      size: 462,
      sizePercent: 20,
    };
    setCfg((prev) => ({
      ...prev,
      activePetId: newId,
      pets: [...prev.pets, newPet],
    }));
    setFeedback('已新增宠物');
    setTimeout(() => setFeedback(''), 2500);
  };

  const handleRemovePet = () => {
    if (cfg.pets.length <= 1) {
      alert('至少保留一只桌宠');
      return;
    }
    if (!confirm(`确定删除宠物「${currentPet.name}」吗？`)) return;
    setCfg((prev) => {
      const nextPets = prev.pets.filter((p) => p.id !== currentPet.id);
      return {
        ...prev,
        activePetId: nextPets[0]?.id || 'main',
        pets: nextPets,
      };
    });
    setFeedback('已删除宠物');
    setTimeout(() => setFeedback(''), 2500);
  };

  const handleAvatarFile = (e: Event) => {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) {
          updateCurrentPet({ avatar: ev.target.result as string });
          setFeedback('头像已更新');
          setTimeout(() => setFeedback(''), 2500);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const playVoiceTest = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(currentPet.persona.slice(0, 30) || '主人好！我是你的桌宠伴侣。');
      utterance.rate = cfg.voiceConfig.rate || 1.0;
      utterance.volume = cfg.voiceConfig.volume || 1.0;
      window.speechSynthesis.speak(utterance);
    } else {
      alert('当前运行环境不支持 Web Speech 语音合成');
    }
  };

  return (
    <div class="dsh-pet-settings-container">
      {/* 顶部标题区 */}
      <div class="dsh-pet-head-row">
        <div class="dsh-pet-main-title">
          <span>桌宠配置</span>
          <Tooltip text="管理多个桌宠：每个宠物可独立设置大小与位置（保存后即时生效）。" />
        </div>
      </div>

      {/* 种类分类标签栏 */}
      <div class="dsh-pet-tabs-row">
        <span class="dsh-pet-tabs-label">种类</span>
        <div class="dsh-pet-tabs-pill active">
          内置 (1)
        </div>
      </div>

      {/* 宠物列表标签栏 */}
      <div class="dsh-pet-tabs-row" style={{ marginTop: '4px' }}>
        <span class="dsh-pet-tabs-label">宠物列表</span>
        <div class="dsh-pet-tabs-list">
          {cfg.pets.map((p) => (
            <button
              key={p.id}
              type="button"
              class={`dsh-pet-pet-tab ${p.id === currentPet.id ? 'active' : ''}`}
              onClick={() => setCfg((prev) => ({ ...prev, activePetId: p.id }))}
            >
              {p.name} ({p.size}px)
            </button>
          ))}
          <button type="button" class="dsh-pet-add-btn" onClick={handleAddPet}>
            <IconPlus size={14} style={{ marginRight: '3px' }} /> 添加宠物
          </button>
        </div>
      </div>

      {/* 宠物配置主卡片 */}
      <div class="dsh-pet-card">
        <div class="dsh-pet-card-head">
          <span class="dsh-pet-card-title">宠物配置</span>
          <Tooltip text="每只宠物独立配置：名字 / 大小 / 显示位置 / 位置 / 偏移 / 四个功能开关。改完点右上角的「保存」即时生效。" />
          
          <div class="dsh-pet-head-actions">
            {feedback && <span class="dsh-pet-feedback">{feedback}</span>}
            <button type="button" class="dsh-pet-btn-save" onClick={handleSave}>
              保存
            </button>
            <button
              type="button"
              class="dsh-pet-btn-remove"
              disabled={cfg.pets.length <= 1}
              onClick={handleRemovePet}
            >
              删除
            </button>
          </div>
        </div>

        {/* 顶部行：左侧头像 + 右侧 2x2 网格 */}
        <div class="dsh-pet-top-row">
          <div
            class="dsh-pet-avatar-col"
            onClick={() => fileInputRef.current?.click()}
            title="点击更换头像"
          >
            <img
              src={currentPet.avatar || DEFAULT_AVATAR}
              alt={currentPet.name}
              class="dsh-pet-avatar-img"
              onError={(e) => { (e.target as HTMLImageElement).src = DEFAULT_AVATAR; }}
            />
            <div class="dsh-pet-avatar-mask">更换头像</div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleAvatarFile}
            />
          </div>

          <div class="dsh-pet-grid2">
            <div class="dsh-pet-field">
              <label class="dsh-pet-label">
                <span>名字</span>
                <Tooltip text="显示名：鼠标悬浮宠物时弹出，也会加进 AI 人设（你的名字是 X）。" />
              </label>
              <input
                type="text"
                class="dsh-pet-input"
                value={currentPet.name}
                onInput={(e) => updateCurrentPet({ name: (e.target as HTMLInputElement).value })}
              />
            </div>

            <div class="dsh-pet-field">
              <label class="dsh-pet-label">
                <span>大小（宽度 px）</span>
                <Tooltip text="高度自动 = 宽度 × 9/16。" />
              </label>
              <input
                type="number"
                class="dsh-pet-input"
                min="100"
                max="1200"
                step="10"
                value={currentPet.size}
                onInput={(e) => updateCurrentPet({ size: parseInt((e.target as HTMLInputElement).value) || 220 })}
              />
            </div>

            <div class="dsh-pet-field">
              <label class="dsh-pet-label">
                <span>屏幕宽度上限（%）</span>
                <Tooltip text="桌宠最多占屏幕多宽，100 = 不超过一屏宽。填 20~40 适合适中视觉比例。" />
              </label>
              <input
                type="number"
                class="dsh-pet-input"
                min="5"
                max="100"
                value={currentPet.sizePercent}
                onInput={(e) => updateCurrentPet({ sizePercent: parseInt((e.target as HTMLInputElement).value) || 20 })}
              />
            </div>

            <div class="dsh-pet-field">
              <label class="dsh-pet-label">
                <span>显示位置</span>
                <Tooltip text="both=两者都显示 / web=仅浏览器客户端 / desktop=仅桌面 / none=都不显示" />
              </label>
              <select
                class="dsh-pet-select"
                value={currentPet.display}
                onChange={(e) => updateCurrentPet({ display: (e.target as HTMLSelectElement).value as any })}
              >
                <option value="both">两者都显示</option>
                <option value="web">仅客户端内</option>
                <option value="desktop">仅桌面</option>
                <option value="none">都不显示</option>
              </select>
            </div>
          </div>
        </div>

        {/* 坐标与偏移 3 栏网格 */}
        <div class="dsh-pet-grid3">
          <div class="dsh-pet-field">
            <label class="dsh-pet-label">
              <span>位置</span>
              <Tooltip text="宠物贴着屏幕的哪个角落。" />
            </label>
            <select
              class="dsh-pet-select"
              value={currentPet.corner}
              onChange={(e) => updateCurrentPet({ corner: (e.target as HTMLSelectElement).value as any })}
            >
              <option value="top-right">右上角</option>
              <option value="top-left">左上角</option>
              <option value="bottom-right">右下角</option>
              <option value="bottom-left">左下角</option>
            </select>
          </div>

          <div class="dsh-pet-field">
            <label class="dsh-pet-label">
              <span>水平偏移</span>
              <Tooltip text="距所选角落的水平距离（px）。" />
            </label>
            <input
              type="number"
              class="dsh-pet-input"
              value={currentPet.marginX}
              onInput={(e) => updateCurrentPet({ marginX: parseInt((e.target as HTMLInputElement).value) || 0 })}
            />
          </div>

          <div class="dsh-pet-field">
            <label class="dsh-pet-label">
              <span>垂直偏移</span>
              <Tooltip text="距所选角落的垂直距离（px）。" />
            </label>
            <input
              type="number"
              class="dsh-pet-input"
              value={currentPet.marginY}
              onInput={(e) => updateCurrentPet({ marginY: parseInt((e.target as HTMLInputElement).value) || 0 })}
            />
          </div>
        </div>

        {/* 四大功能复选框 */}
        <div class="dsh-pet-checkbox-grid">
          <label class="dsh-pet-checkbox-item">
            <input
              type="checkbox"
              checked={currentPet.balanceEnabled}
              onChange={(e) => updateCurrentPet({ balanceEnabled: (e.target as HTMLInputElement).checked })}
            />
            <span>余额功能</span>
            <Tooltip text="启用后该宠物触发余额动画并显示余额气泡。" />
          </label>

          <label class="dsh-pet-checkbox-item">
            <input
              type="checkbox"
              checked={currentPet.whisperEnabled}
              onChange={(e) => updateCurrentPet({ whisperEnabled: (e.target as HTMLInputElement).checked })}
            />
            <span>碎碎念</span>
            <Tooltip text="启用后该宠物按周期用 AI 生成一句话并播碎碎念动画。" />
          </label>

          <label class="dsh-pet-checkbox-item">
            <input
              type="checkbox"
              checked={currentPet.workStatusEnabled}
              onChange={(e) => updateCurrentPet({ workStatusEnabled: (e.target as HTMLInputElement).checked })}
            />
            <span>工作状态联动</span>
            <Tooltip text="启用后该宠物跟随 Zap 实时推理状态：写代码/思考/完工时自动切对应动画并弹气泡。" />
          </label>

          <label class="dsh-pet-checkbox-item">
            <input
              type="checkbox"
              checked={currentPet.fixedEnabled}
              onChange={(e) => updateCurrentPet({ fixedEnabled: (e.target as HTMLInputElement).checked })}
            />
            <span>宠物固定</span>
            <Tooltip text="启用后锁定在固定角落，不再允许鼠标拖拽或抛掷。" />
          </label>
        </div>

        {/* 人设输入框 */}
        <div class="dsh-pet-field" style={{ marginTop: '8px' }}>
          <label class="dsh-pet-label">
            <span>人设（可选）</span>
            <Tooltip text="只影响这只宠物。留空 = 跟随系统默认人设。发给模型的 system 提示词将以此为准驱动碎碎念与对话。" />
          </label>
          <textarea
            class="dsh-pet-textarea"
            rows={3}
            value={currentPet.persona}
            onInput={(e) => updateCurrentPet({ persona: (e.target as HTMLTextAreaElement).value })}
          />
          <div class="dsh-pet-char-count">{currentPet.persona.length} 字</div>
        </div>
      </div>

      {/* 全局开关卡片 */}
      <div class="dsh-pet-card" style={{ marginTop: '14px' }}>
        <div class="dsh-pet-card-head">
          <span class="dsh-pet-card-title">全局开关</span>
          <Tooltip text="所有宠物共用的全局行为选项。点击「保存」后同步生效。" />
        </div>

        <div class="dsh-pet-checkbox-grid">
          <label class="dsh-pet-checkbox-item">
            <input
              type="checkbox"
              checked={cfg.globalFlags.notificationsEnabled}
              onChange={(e) => updateGlobalFlags({ notificationsEnabled: (e.target as HTMLInputElement).checked })}
            />
            <span>系统通知</span>
            <Tooltip text="任务长耗时完成或需审批确认时，在屏幕右下角触发原生系统通知。" />
          </label>

          <label class="dsh-pet-checkbox-item">
            <input
              type="checkbox"
              checked={cfg.globalFlags.clickSoundEnabled}
              onChange={(e) => updateGlobalFlags({ clickSoundEnabled: (e.target as HTMLInputElement).checked })}
            />
            <span>点击音效</span>
            <Tooltip text="点击宠物或投喂时播放内置可爱音效。" />
          </label>

          <label class="dsh-pet-checkbox-item">
            <input
              type="checkbox"
              checked={cfg.globalFlags.confineToScreen}
              onChange={(e) => updateGlobalFlags({ confineToScreen: (e.target as HTMLInputElement).checked })}
            />
            <span>锁定在当前屏幕</span>
            <Tooltip text="多显示器环境：拖拽或抛掷时不飞到隔壁屏幕外。" />
          </label>

          <label class="dsh-pet-checkbox-item">
            <input
              type="checkbox"
              checked={cfg.globalFlags.trayEnabled}
              onChange={(e) => updateGlobalFlags({ trayEnabled: (e.target as HTMLInputElement).checked })}
            />
            <span>系统托盘</span>
            <Tooltip text="在系统通知区域常驻快捷托盘图标。" />
          </label>
        </div>
      </div>

      {/* 语音播报卡片 */}
      <div class="dsh-pet-card" style={{ marginTop: '14px' }}>
        <div class="dsh-pet-card-head">
          <span class="dsh-pet-card-title">语音播报</span>
          <Tooltip text="桌宠在气泡说话或碎碎念时，调用系统 TTS 进行拟真语音朗读。" />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <label class="dsh-pet-checkbox-item">
            <input
              type="checkbox"
              checked={cfg.voiceConfig.enabled}
              onChange={(e) => updateVoiceConfig({ enabled: (e.target as HTMLInputElement).checked })}
            />
            <span>启用语音播报</span>
          </label>

          <div class="dsh-pet-grid3" style={{ opacity: cfg.voiceConfig.enabled ? 1 : 0.5, pointerEvents: cfg.voiceConfig.enabled ? 'auto' : 'none' }}>
            <div class="dsh-pet-field">
              <label class="dsh-pet-label">
                <span>音色选择</span>
              </label>
              <select
                class="dsh-pet-select"
                value={cfg.voiceConfig.voice}
                onChange={(e) => updateVoiceConfig({ voice: (e.target as HTMLSelectElement).value })}
              >
                <option value="zh-CN-XiaoxiaoNeural">晓晓 (温柔少女)</option>
                <option value="zh-CN-YunxiNeural">云希 (阳光少年)</option>
                <option value="zh-CN-XiaohanNeural">晓涵 (自然女仆)</option>
                <option value="default">系统默认合成音</option>
              </select>
            </div>

            <div class="dsh-pet-field">
              <label class="dsh-pet-label">
                <span>语速 ({cfg.voiceConfig.rate}x)</span>
              </label>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                value={cfg.voiceConfig.rate}
                onInput={(e) => updateVoiceConfig({ rate: parseFloat((e.target as HTMLInputElement).value) || 1.0 })}
              />
            </div>

            <div class="dsh-pet-field" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
              <button type="button" class="dsh-pet-btn-test" onClick={playVoiceTest}>
                <IconVolume2 size={15} style={{ marginRight: '4px' }} /> 试听语音
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 嵌入样式 */}
      <style>{`
        .dsh-pet-settings-container {
          padding: 16px 20px 40px;
          color: var(--text-primary, #f1f5f9);
          font-size: 13px;
          line-height: 1.5;
        }
        .dsh-pet-head-row {
          display: flex;
          align-items: center;
          margin-bottom: 12px;
        }
        .dsh-pet-main-title {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary, #f1f5f9);
        }
        .dsh-pet-tabs-row {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 8px;
        }
        .dsh-pet-tabs-label {
          font-size: 13px;
          color: var(--text-secondary, #94a3b8);
          min-width: 56px;
        }
        .dsh-pet-tabs-pill {
          padding: 3px 12px;
          border-radius: 6px;
          font-size: 12px;
          background: rgba(56, 189, 248, 0.15);
          color: #38bdf8;
          border: 1px solid rgba(56, 189, 248, 0.35);
          font-weight: 500;
        }
        .dsh-pet-tabs-list {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .dsh-pet-pet-tab {
          padding: 4px 14px;
          border-radius: 8px;
          font-size: 13px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.12);
          color: var(--text-secondary, #94a3b8);
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .dsh-pet-pet-tab.active {
          background: rgba(56, 189, 248, 0.18);
          border-color: #38bdf8;
          color: #38bdf8;
          font-weight: 500;
        }
        .dsh-pet-add-btn {
          display: inline-flex;
          align-items: center;
          padding: 4px 10px;
          border-radius: 8px;
          font-size: 12px;
          background: transparent;
          border: 1px dashed rgba(255, 255, 255, 0.2);
          color: var(--text-secondary, #94a3b8);
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .dsh-pet-add-btn:hover {
          border-color: #38bdf8;
          color: #38bdf8;
        }
        .dsh-pet-card {
          background: var(--bg-card, rgba(30, 41, 59, 0.65));
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          padding: 14px 18px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .dsh-pet-card-head {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .dsh-pet-card-title {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary, #f1f5f9);
        }
        .dsh-pet-head-actions {
          margin-left: auto;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .dsh-pet-feedback {
          font-size: 12px;
          color: #10b981;
          font-weight: 500;
        }
        .dsh-pet-btn-save {
          background: #2563eb;
          color: #fff;
          border: none;
          border-radius: 6px;
          padding: 4px 16px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.15s ease;
        }
        .dsh-pet-btn-save:hover {
          background: #1d4ed8;
        }
        .dsh-pet-btn-remove {
          background: transparent;
          color: #ef4444;
          border: 1px solid rgba(239, 68, 68, 0.4);
          border-radius: 6px;
          padding: 4px 14px;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .dsh-pet-btn-remove:hover:not(:disabled) {
          background: rgba(239, 68, 68, 0.15);
        }
        .dsh-pet-btn-remove:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .dsh-pet-top-row {
          display: grid;
          grid-template-columns: 120px 1fr;
          gap: 16px;
          align-items: stretch;
        }
        .dsh-pet-avatar-col {
          position: relative;
          width: 120px;
          height: 120px;
          border-radius: 12px;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.12);
          cursor: pointer;
          background: #0f172a;
        }
        .dsh-pet-avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .dsh-pet-avatar-mask {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.65);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          opacity: 0;
          transition: opacity 0.2s ease;
        }
        .dsh-pet-avatar-col:hover .dsh-pet-avatar-mask {
          opacity: 1;
        }
        .dsh-pet-grid2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px 14px;
        }
        .dsh-pet-grid3 {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 10px 14px;
        }
        .dsh-pet-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .dsh-pet-label {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          color: var(--text-secondary, #94a3b8);
        }
        .dsh-pet-input, .dsh-pet-select, .dsh-pet-textarea {
          background: rgba(15, 23, 42, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 6px;
          padding: 6px 10px;
          font-size: 13px;
          color: var(--text-primary, #f1f5f9);
          outline: none;
          box-sizing: border-box;
          width: 100%;
        }
        .dsh-pet-input:focus, .dsh-pet-select:focus, .dsh-pet-textarea:focus {
          border-color: #38bdf8;
        }
        .dsh-pet-textarea {
          resize: vertical;
          font-family: inherit;
          line-height: 1.4;
        }
        .dsh-pet-char-count {
          text-align: right;
          font-size: 11px;
          color: var(--text-tertiary, #64748b);
        }
        .dsh-pet-checkbox-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px 16px;
          margin-top: 4px;
        }
        .dsh-pet-checkbox-item {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          cursor: pointer;
          user-select: none;
        }
        .dsh-pet-checkbox-item input[type="checkbox"] {
          width: 15px;
          height: 15px;
          accent-color: #2563eb;
          cursor: pointer;
        }
        .dsh-pet-tip-trigger {
          position: relative;
          display: inline-flex;
          align-items: center;
          cursor: help;
        }
        .dsh-pet-q {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          border: 1px solid rgba(255, 255, 255, 0.25);
          font-size: 10px;
          color: var(--text-secondary, #94a3b8);
          line-height: 1;
        }
        .dsh-pet-tip-bubble {
          position: absolute;
          bottom: calc(100% + 6px);
          left: 50%;
          transform: translateX(-50%);
          background: rgba(15, 23, 42, 0.95);
          border: 1px solid rgba(255, 255, 255, 0.15);
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
          color: #f1f5f9;
          font-size: 11px;
          line-height: 1.4;
          padding: 6px 10px;
          border-radius: 6px;
          white-space: normal;
          width: max-content;
          max-width: 260px;
          z-index: 99999;
          pointer-events: none;
        }
        .dsh-pet-btn-test {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: rgba(56, 189, 248, 0.15);
          border: 1px solid rgba(56, 189, 248, 0.35);
          color: #38bdf8;
          border-radius: 6px;
          padding: 6px 12px;
          font-size: 12px;
          cursor: pointer;
          transition: background 0.15s ease;
        }
        .dsh-pet-btn-test:hover {
          background: rgba(56, 189, 248, 0.25);
        }
      `}</style>
    </div>
  );
}
