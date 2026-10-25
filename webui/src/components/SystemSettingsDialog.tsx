import { useEffect, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { getDesktopSettings, postDesktopSettings, getHealth, type DesktopSettings } from '../api';
import { bakedAppVersion, normalizeAppVersion } from '../lib/appVersion';
import { useBackdropDismiss } from '../lib/backdropDismiss';
import { useT } from '../settings';

interface SystemSettingsDialogProps {
  onClose: () => void;
}

type TabKey = 'desktop' | 'about';

interface ModuleTab {
  key: TabKey;
  labelKey: string;
  defaultLabel: string;
  icon: string;
}

export function SystemSettingsDialog({ onClose }: SystemSettingsDialogProps) {
  const t = useT();
  const [activeTab, setActiveTab] = useState<TabKey>('desktop');
  const [closeAction, setCloseAction] = useState<'ask' | 'tray' | 'quit'>('ask');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [appVersion, setAppVersion] = useState(bakedAppVersion());

  // 遮罩空白处点击关闭：避免弹窗内拖拽划词时被误判为外部点击而秒关。
  const backdropDismiss = useBackdropDismiss(onClose);

  const tabs: ModuleTab[] = [
    { key: 'desktop', labelKey: 'settings.tabDesktop', defaultLabel: '桌面与系统', icon: '🖥️' },
    { key: 'about', labelKey: 'settings.tabAbout', defaultLabel: '关于与版本', icon: 'ℹ️' },
  ];

  useEffect(() => {
    let cancelled = false;
    getDesktopSettings()
      .then((res) => {
        if (!cancelled && res.close_action) {
          setCloseAction(res.close_action);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getHealth()
      .then((info) => {
        if (cancelled) return;
        const running = normalizeAppVersion(info.version);
        if (running) setAppVersion(running);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSaveDesktopSettings() {
    if (saving) return;
    setSaving(true);
    setSavedSuccess(false);
    try {
      await postDesktopSettings({ close_action: closeAction });
      setSavedSuccess(true);
      window.setTimeout(() => setSavedSuccess(false), 2000);
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  }

  const modal = (
    <div
      class="modal-overlay system-settings-modal-overlay"
      {...backdropDismiss}
      role="dialog"
      aria-modal="true"
      style={{
        zIndex: 100000,
        background: 'var(--app-modal-background, rgba(0, 0, 0, 0.65))',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
      }}
    >
      <div
        class="modal-card modal-card-lg system-settings-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(760px, 94vw)',
          height: 'min(580px, 86dvh)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--app-menu-background, #181a20)',
          border: '1px solid var(--app-menu-border, rgba(255, 255, 255, 0.1))',
          borderRadius: '16px',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.55)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div class="modal-header" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '18px' }}>⚙️</span>
            <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>
              {t('settings.systemSettings') || '系统设置'}
            </h3>
          </div>
          <button
            type="button"
            class="modal-close btn btn-ghost"
            onClick={onClose}
            aria-label="Close"
            style={{ marginLeft: 'auto', padding: '6px' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content with Left Nav & Right Body */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Left Module Tabs */}
          <div
            style={{
              width: '180px',
              borderRight: '1px solid var(--app-menu-border, rgba(255, 255, 255, 0.08))',
              background: 'rgba(0, 0, 0, 0.1)',
              padding: '12px 8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            {tabs.map((tab) => {
              const active = activeTab === tab.key;
              return (
                <button
                  type="button"
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    fontSize: '13.5px',
                    fontWeight: active ? 600 : 400,
                    color: active ? 'var(--app-primary-foreground, #fff)' : 'var(--app-secondary-foreground, #9ca3af)',
                    background: active ? 'var(--app-accent-subtle, rgba(59, 130, 246, 0.15))' : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span style={{ fontSize: '15px' }}>{tab.icon}</span>
                  <span>{t(tab.labelKey as any) || tab.defaultLabel}</span>
                </button>
              );
            })}
          </div>

          {/* Right Module Details */}
          <div
            style={{
              flex: 1,
              padding: '24px',
              overflowY: 'auto',
              background: 'transparent',
            }}
          >
            {activeTab === 'desktop' && (
              <div>
                <h4 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 600 }}>
                  {t('settings.desktopBehaviorTitle') || '桌面客户端行为'}
                </h4>

                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid var(--app-menu-border, rgba(255, 255, 255, 0.06))',
                    borderRadius: '12px',
                    padding: '18px',
                    marginBottom: '20px',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '13.5px', marginBottom: '8px' }}>
                    {t('settings.closeActionLabel') || '关闭主窗口时'}
                  </div>
                  <div style={{ fontSize: '12.5px', color: 'var(--text-muted, #9ca3af)', marginBottom: '14px', lineHeight: '1.5' }}>
                    {t('settings.closeActionDesc') || '配置点击窗口右上角关闭按钮 (X) 时的默认动作'}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13.5px' }}>
                      <input
                        type="radio"
                        name="close_action"
                        value="tray"
                        checked={closeAction === 'tray'}
                        onChange={() => setCloseAction('tray')}
                      />
                      <span>{t('settings.closeActionTray') || '最小化到系统托盘并在后台运行'}</span>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13.5px' }}>
                      <input
                        type="radio"
                        name="close_action"
                        value="quit"
                        checked={closeAction === 'quit'}
                        onChange={() => setCloseAction('quit')}
                      />
                      <span>{t('settings.closeActionQuit') || '直接退出程序并停止服务'}</span>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13.5px' }}>
                      <input
                        type="radio"
                        name="close_action"
                        value="ask"
                        checked={closeAction === 'ask'}
                        onChange={() => setCloseAction('ask')}
                      />
                      <span>{t('settings.closeActionAsk') || '每次询问我'}</span>
                    </label>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button
                    type="button"
                    class="btn btn-primary"
                    disabled={loading || saving}
                    onClick={handleSaveDesktopSettings}
                    style={{ padding: '8px 20px', fontSize: '13.5px' }}
                  >
                    {saving
                      ? (t('settings.saving') || '正在保存…')
                      : (t('settings.save') || '保存设置')}
                  </button>
                  {savedSuccess && (
                    <span style={{ color: '#10b981', fontSize: '13px', fontWeight: 500 }}>
                      ✓ {t('settings.savedSuccess') || '设置已保存'}
                    </span>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'about' && (
              <div>
                <h4 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 600 }}>
                  {t('settings.aboutTitle')}
                </h4>
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid var(--app-menu-border, rgba(255, 255, 255, 0.06))',
                    borderRadius: '12px',
                    padding: '20px',
                    fontSize: '13.5px',
                    lineHeight: '1.8',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <strong style={{ fontSize: '15px' }}>JeikCode</strong>
                    {appVersion && (
                      <span
                        style={{
                          fontSize: '11px',
                          fontFamily: 'monospace',
                          padding: '1px 7px',
                          borderRadius: '4px',
                          background: 'var(--app-accent-subtle, rgba(59, 130, 246, 0.15))',
                          color: 'var(--accent-color, #3b82f6)',
                          fontWeight: 600,
                        }}
                      >
                        v{appVersion}
                      </span>
                    )}
                  </div>
                  <div style={{ color: 'var(--app-primary-foreground, #fff)', marginBottom: '4px', fontWeight: 500 }}>
                    {t('settings.aboutDesc')}
                  </div>
                  <div style={{ color: 'var(--text-muted, #9ca3af)', fontSize: '12.5px' }}>
                    {t('settings.aboutFeatures')}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modal, document.body) : modal;
}
