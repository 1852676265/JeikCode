import { useState, useEffect } from 'preact/hooks';
import {
  ServerProfile,
  getServerProfiles,
  getActiveServerProfileId,
  setActiveServerProfileId,
  upsertServerProfile,
  deleteServerProfile,
  pingServer,
  PingResult,
  exportServerProfiles,
  importServerProfiles,
  normalizeServerUrl,
} from '../lib/serverProfiles.ts';

interface ServerSwitcherModalProps {
  open: boolean;
  onClose: () => void;
}

export function ServerSwitcherModal({ open, onClose }: ServerSwitcherModalProps) {
  const [profiles, setProfiles] = useState<ServerProfile[]>([]);
  const [activeId, setActiveId] = useState<string>('default');
  const [editingId, setEditingId] = useState<string | null>(null);

  // 编辑表单
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formToken, setFormToken] = useState('');
  const [isAddingNew, setIsAddingNew] = useState(false);

  // Ping 状态映射: profileId -> PingResult | 'testing'
  const [pingStatus, setPingStatus] = useState<Record<string, PingResult | 'testing'>>({});

  // 导入/导出
  const [showImportExport, setShowImportExport] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const triggerToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const reloadData = () => {
    const list = getServerProfiles();
    setProfiles(list);
    setActiveId(getActiveServerProfileId());
  };

  useEffect(() => {
    if (open) {
      reloadData();
      setIsAddingNew(false);
      setEditingId(null);
    }
  }, [open]);

  if (!open) return null;

  const handleTestConnection = async (id: string, url: string, token: string) => {
    setPingStatus((prev) => ({ ...prev, [id]: 'testing' }));
    const res = await pingServer(url, token);
    setPingStatus((prev) => ({ ...prev, [id]: res }));
  };

  const handleSaveForm = (andSwitch: boolean = false) => {
    const norm = normalizeServerUrl(formUrl);
    if (!formName.trim() && !norm) {
      triggerToast('请输入主机名称或主机网络地址');
      return;
    }
    const saved = upsertServerProfile({
      id: editingId || undefined,
      name: formName.trim() || norm || '未命名主机',
      url: norm,
      token: formToken.trim(),
    });

    reloadData();
    setIsAddingNew(false);
    setEditingId(null);

    if (andSwitch) {
      setActiveServerProfileId(saved.id, true);
    } else {
      triggerToast('主机配置已保存');
    }
  };

  const handleStartEdit = (p: ServerProfile) => {
    setEditingId(p.id);
    setIsAddingNew(false);
    setFormName(p.name);
    setFormUrl(p.url);
    setFormToken(p.token);
  };

  const handleStartAdd = () => {
    setIsAddingNew(true);
    setEditingId(null);
    setFormName('');
    setFormUrl('');
    setFormToken('');
  };

  const handleSwitch = (id: string) => {
    if (id === activeId) {
      onClose();
      return;
    }
    setActiveServerProfileId(id, true);
  };

  const handleDelete = (id: string, name: string) => {
    if (window.confirm(`确定要删除主机「${name}」的配置吗？`)) {
      deleteServerProfile(id);
      reloadData();
      triggerToast('主机已移除');
    }
  };

  const handleExport = () => {
    const json = exportServerProfiles();
    navigator.clipboard.writeText(json).then(
      () => triggerToast('全部主机配置已复制到剪贴板！可在其他手机或电脑上一键粘贴'),
      () => triggerToast('复制失败，请手动复制'),
    );
  };

  const handleImportSubmit = () => {
    if (!importJson.trim()) return;
    const res = importServerProfiles(importJson);
    if (res.error) {
      triggerToast(`导入失败: ${res.error}`);
    } else {
      triggerToast(`成功导入 ${res.count} 个主机节点`);
      setImportJson('');
      setShowImportExport(false);
      reloadData();
    }
  };

  return (
    <div
      class="modal-overlay server-switcher-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div class="modal-card server-switcher-card" onClick={(e) => e.stopPropagation()}>
        {/* 顶部标题栏 */}
        <div class="modal-header server-switcher-header">
          <div class="modal-title-row">
            <span class="modal-title-icon">💻</span>
            <span class="modal-title-text">多主机管理与快速切换</span>
          </div>
          <button type="button" class="modal-close-btn" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* 提示条 */}
        {toastMsg && <div class="server-switcher-toast">{toastMsg}</div>}

        <div class="modal-body server-switcher-body">
          <div class="server-switcher-intro">
            📱 随时在手机上切换连接工位电脑、家里台式机或云端沙箱。点击对应主机即可秒级直连。
          </div>

          {/* 添加 / 编辑 面板 */}
          {(isAddingNew || editingId) ? (
            <div class="server-profile-edit-box">
              <div class="server-profile-edit-title">
                {editingId ? '编辑主机配置' : '➕ 添加新主机节点'}
              </div>
              <div class="server-profile-form-row">
                <label>主机标签 / 备注名</label>
                <input
                  type="text"
                  placeholder="如：公司工位电脑 / 家里台式机"
                  value={formName}
                  onInput={(e) => setFormName((e.target as HTMLInputElement).value)}
                />
              </div>
              <div class="server-profile-form-row">
                <label>网络地址 (局域网 IP / Tailscale / 域名)</label>
                <input
                  type="text"
                  placeholder="如：http://192.168.1.100:13458 或 http://my-pc:13458"
                  value={formUrl}
                  onInput={(e) => setFormUrl((e.target as HTMLInputElement).value)}
                />
                <span class="server-form-hint">留空则代表使用当前网页所在的默认同源宿主。</span>
              </div>
              <div class="server-profile-form-row">
                <label>访问 Token (凭据)</label>
                <input
                  type="text"
                  placeholder="从目标电脑的终端启动日志或远程设置中获取"
                  value={formToken}
                  onInput={(e) => setFormToken((e.target as HTMLInputElement).value)}
                />
              </div>

              <div class="server-profile-edit-actions">
                <button
                  type="button"
                  class="btn btn-sm btn-secondary"
                  onClick={() => handleTestConnection('form-test', formUrl, formToken)}
                >
                  🔍 测试连通性
                </button>
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  class="btn btn-sm btn-secondary"
                  onClick={() => {
                    setIsAddingNew(false);
                    setEditingId(null);
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-primary"
                  onClick={() => handleSaveForm(false)}
                >
                  保存
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-primary"
                  style={{ background: '#2ea043', borderColor: '#2ea043' }}
                  onClick={() => handleSaveForm(true)}
                >
                  保存并切换
                </button>
              </div>

              {/* 连通测试结果 */}
              {pingStatus['form-test'] && (
                <div class={'server-ping-res ' + (pingStatus['form-test'] === 'testing' ? 'testing' : pingStatus['form-test'].ok ? 'ok' : 'err')}>
                  {pingStatus['form-test'] === 'testing' ? (
                    '⏳ 正在探测目标主机连通性与服务响应...'
                  ) : pingStatus['form-test'].ok ? (
                    `🟢 连通正常！耗时: ${pingStatus['form-test'].latencyMs}ms | 守护版本: ${pingStatus['form-test'].version}`
                  ) : (
                    `🔴 无法连通: ${pingStatus['form-test'].error}`
                  )}
                </div>
              )}
            </div>
          ) : null}

          {/* 已配置的主机列表 */}
          <div class="server-profiles-list">
            <div class="server-list-header">
              <span>已保存主机 ({profiles.length})</span>
              {!isAddingNew && !editingId && (
                <button type="button" class="btn btn-xs btn-primary" onClick={handleStartAdd}>
                  ➕ 添加主机
                </button>
              )}
            </div>

            {profiles.map((p) => {
              const isActive = p.id === activeId;
              const pStatus = pingStatus[p.id];

              return (
                <div key={p.id} class={'server-profile-card' + (isActive ? ' is-active' : '')}>
                  <div class="server-profile-info">
                    <div class="server-profile-header">
                      <span class="server-profile-name">{p.name}</span>
                      {isActive && <span class="server-badge-active">当前使用中</span>}
                      {p.isDefault && <span class="server-badge-default">默认宿主</span>}
                    </div>

                    <div class="server-profile-url">
                      {p.url || (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.host} (同源)` : '本地默认')}
                    </div>

                    {/* 状态检测结果显示 */}
                    {pStatus && (
                      <div class={'server-profile-ping-line ' + (pStatus === 'testing' ? 'testing' : pStatus.ok ? 'ok' : 'err')}>
                        {pStatus === 'testing' ? (
                          '⏳ 测速中...'
                        ) : pStatus.ok ? (
                          `🟢 在线 (${pStatus.latencyMs}ms, v${pStatus.version})`
                        ) : (
                          `🔴 离线: ${pStatus.error}`
                        )}
                      </div>
                    )}
                  </div>

                  <div class="server-profile-actions">
                    <button
                      type="button"
                      class="btn btn-xs btn-secondary"
                      title="测试连通性与延迟"
                      onClick={() => handleTestConnection(p.id, p.url, p.token)}
                    >
                      📡 测速
                    </button>
                    {!isActive ? (
                      <button
                        type="button"
                        class="btn btn-xs btn-primary"
                        onClick={() => handleSwitch(p.id)}
                      >
                        切到此机
                      </button>
                    ) : (
                      <button
                        type="button"
                        class="btn btn-xs btn-secondary"
                        disabled
                        style={{ opacity: 0.6 }}
                      >
                        活跃中
                      </button>
                    )}
                    <button
                      type="button"
                      class="btn btn-xs btn-secondary"
                      title="编辑"
                      onClick={() => handleStartEdit(p)}
                    >
                      ✏️
                    </button>
                    {!p.isDefault && (
                      <button
                        type="button"
                        class="btn btn-xs btn-secondary danger-btn"
                        title="删除"
                        onClick={() => handleDelete(p.id, p.name)}
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 备份与同步折叠面板 */}
          <div class="server-backup-section">
            <button
              type="button"
              class="server-backup-toggle-btn"
              onClick={() => setShowImportExport((v) => !v)}
            >
              <span>{showImportExport ? '▾ 收起跨设备配置导入/导出' : '▸ 跨手机与电脑同步配置 (导入/导出)'}</span>
            </button>

            {showImportExport && (
              <div class="server-backup-content">
                <p class="server-backup-desc">
                  您可以将已配置好的主机列表一键复制出来，发送到新手机或家里的电脑上直接粘贴恢复，免去重复输入的烦恼。
                </p>
                <div class="server-backup-btns">
                  <button type="button" class="btn btn-xs btn-secondary" onClick={handleExport}>
                    📋 复制全部配置 (JSON)
                  </button>
                </div>
                <div class="server-import-box">
                  <textarea
                    rows={3}
                    placeholder="在此粘贴导出的配置 JSON 字符串..."
                    value={importJson}
                    onInput={(e) => setImportJson((e.target as HTMLTextAreaElement).value)}
                  />
                  <button
                    type="button"
                    class="btn btn-xs btn-primary"
                    disabled={!importJson.trim()}
                    onClick={handleImportSubmit}
                  >
                    导入配置
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div class="modal-footer server-switcher-footer">
          <button type="button" class="btn btn-secondary" onClick={onClose}>
            完成并关闭
          </button>
        </div>
      </div>
    </div>
  );
}
