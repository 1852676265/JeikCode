export interface ServerProfile {
  id: string;
  name: string;
  url: string; // e.g. "http://192.168.1.100:13458" or "" for current origin
  token: string;
  isDefault?: boolean;
  notes?: string;
  lastConnectedAt?: number;
}

export interface PingResult {
  ok: boolean;
  latencyMs: number;
  version?: string;
  service?: string;
  error?: string;
}

export const SERVER_PROFILES_KEY = 'jeikcode_server_profiles';
export const ACTIVE_SERVER_ID_KEY = 'jeikcode_active_server_id';
export const PROFILES_CHANGE_EVENT = 'jeikcode:server_profiles_changed';

function safeStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, val: string): void {
  try {
    localStorage.setItem(key, val);
  } catch {
    /* quota / private mode */
  }
}

/**
 * 规范化主机地址：去除尾部斜杠，补全 http:// 前缀（若缺失协议）
 */
export function normalizeServerUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  let formatted = trimmed;
  if (!/^https?:\/\//i.test(formatted)) {
    formatted = `http://${formatted}`;
  }
  return formatted.replace(/\/+$/, '');
}

/**
 * 获取默认主机（当前网页宿主自身）
 */
export function getDefaultProfile(): ServerProfile {
  let initialToken = '';
  try {
    initialToken = localStorage.getItem('jeikcode_webui_token') || sessionStorage.getItem('jeikcode_webui_token') || '';
  } catch {}

  let hostLabel = '当前宿主机';
  if (typeof window !== 'undefined' && window.location.host) {
    hostLabel = `本地宿主 (${window.location.host})`;
  }

  return {
    id: 'default',
    name: hostLabel,
    url: '',
    token: initialToken,
    isDefault: true,
  };
}

/**
 * 读取所有已保存的主机配置列表
 */
export function getServerProfiles(): ServerProfile[] {
  const raw = safeStorageGet(SERVER_PROFILES_KEY);
  if (!raw) {
    const def = getDefaultProfile();
    return [def];
  }
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list) || list.length === 0) {
      return [getDefaultProfile()];
    }
    return list;
  } catch {
    return [getDefaultProfile()];
  }
}

/**
 * 获取当前激活的主机 ID
 */
export function getActiveServerProfileId(): string {
  return safeStorageGet(ACTIVE_SERVER_ID_KEY) || 'default';
}

/**
 * 获取当前激活的主机配置
 */
export function getActiveServerProfile(): ServerProfile {
  const profiles = getServerProfiles();
  const activeId = getActiveServerProfileId();
  const found = profiles.find((p) => p.id === activeId);
  if (found) return found;
  return profiles[0] || getDefaultProfile();
}

/**
 * 保存主机列表
 */
export function saveServerProfiles(profiles: ServerProfile[]): void {
  safeStorageSet(SERVER_PROFILES_KEY, JSON.stringify(profiles));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PROFILES_CHANGE_EVENT, { detail: profiles }));
  }
}

/**
 * 切换当前激活主机
 */
export function setActiveServerProfileId(id: string, reload: boolean = true): void {
  safeStorageSet(ACTIVE_SERVER_ID_KEY, id);
  const profiles = getServerProfiles();
  const profile = profiles.find((p) => p.id === id);
  if (profile && profile.token) {
    try {
      localStorage.setItem('jeikcode_webui_token', profile.token);
      sessionStorage.setItem('jeikcode_webui_token', profile.token);
    } catch {}
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PROFILES_CHANGE_EVENT, { detail: profiles }));
    if (reload) {
      window.location.reload();
    }
  }
}

/**
 * 新增或更新主机配置
 */
export function upsertServerProfile(profile: Omit<ServerProfile, 'id'> & { id?: string }): ServerProfile {
  const profiles = getServerProfiles();
  const normUrl = normalizeServerUrl(profile.url);

  if (profile.id) {
    // 更新
    const index = profiles.findIndex((p) => p.id === profile.id);
    if (index >= 0) {
      profiles[index] = {
        ...profiles[index],
        ...profile,
        url: normUrl,
      };
      saveServerProfiles(profiles);
      return profiles[index];
    }
  }

  // 新增
  const newProfile: ServerProfile = {
    id: `srv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: profile.name.trim() || normUrl || '未命名主机',
    url: normUrl,
    token: profile.token.trim(),
    notes: profile.notes?.trim(),
  };

  profiles.push(newProfile);
  saveServerProfiles(profiles);
  return newProfile;
}

/**
 * 删除主机配置
 */
export function deleteServerProfile(id: string): void {
  if (id === 'default') return; // 禁止删除默认本地主机
  let profiles = getServerProfiles();
  profiles = profiles.filter((p) => p.id !== id);
  saveServerProfiles(profiles);

  if (getActiveServerProfileId() === id) {
    setActiveServerProfileId('default', true);
  }
}

/**
 * 测试远程主机连通性与健康状态
 */
export async function pingServer(rawUrl: string, token: string): Promise<PingResult> {
  const baseUrl = normalizeServerUrl(rawUrl);
  const targetUrl = baseUrl ? `${baseUrl}/health` : '/health';
  const startTime = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);

  try {
    const headers: Record<string, string> = {
      'X-JeikCode-Client': 'webui-ping',
    };
    if (token.trim()) {
      headers.Authorization = `Bearer ${token.trim()}`;
    }

    const res = await fetch(targetUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
      mode: 'cors',
      credentials: 'omit',
    });

    clearTimeout(timer);
    const latencyMs = Date.now() - startTime;

    if (!res.ok) {
      if (res.status === 401) {
        return { ok: false, latencyMs, error: '认证失败 (401 Unauthorized)：Token 不匹配' };
      }
      return { ok: false, latencyMs, error: `HTTP ${res.status}: ${res.statusText}` };
    }

    const data = await res.json().catch(() => ({}));
    return {
      ok: true,
      latencyMs,
      version: data.version || 'unknown',
      service: data.service || 'jeikcode-daemon',
    };
  } catch (err: any) {
    clearTimeout(timer);
    const latencyMs = Date.now() - startTime;
    if (err.name === 'AbortError') {
      return { ok: false, latencyMs, error: '连接超时 (超过 6 秒未响应)' };
    }
    return { ok: false, latencyMs, error: err.message || '网络连接失败 (无法访问目标地址或已被防火墙拦截)' };
  }
}

/**
 * 导出配置 JSON
 */
export function exportServerProfiles(): string {
  const profiles = getServerProfiles();
  return JSON.stringify(profiles, null, 2);
}

/**
 * 导入配置 JSON
 */
export function importServerProfiles(jsonStr: string): { count: number; error?: string } {
  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) {
      return { count: 0, error: '导入数据格式有误，必须为主机配置数组' };
    }
    const current = getServerProfiles();
    const map = new Map<string, ServerProfile>();
    for (const p of current) {
      map.set(p.id, p);
    }
    let imported = 0;
    for (const item of parsed) {
      if (item && typeof item === 'object' && item.name) {
        const id = item.id || `srv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        map.set(id, {
          id,
          name: String(item.name || ''),
          url: normalizeServerUrl(String(item.url || '')),
          token: String(item.token || ''),
          notes: item.notes ? String(item.notes) : undefined,
          isDefault: item.id === 'default',
        });
        imported++;
      }
    }
    saveServerProfiles(Array.from(map.values()));
    return { count: imported };
  } catch (err: any) {
    return { count: 0, error: err.message || 'JSON 解析失败' };
  }
}
