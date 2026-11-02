import type { SSEEvent, SessionDetail, SessionMessage, SessionMetaWithProject, ImageData } from '../api.ts';
import type { ServerProfile } from './serverProfiles.ts';
import { normalizeServerUrl, normalizeDirectApiBase, getActiveServerProfile } from './serverProfiles.ts';

export const DIRECT_LLM_PROJECT_HASH = 'direct_llm';
export const DIRECT_LLM_PROJECT_NAME = '⚡ 随身 AI 助理';

const DIRECT_SESSIONS_INDEX_KEY = 'jeikcode_direct_sessions_list';
const DIRECT_SESSION_PREFIX = 'jeikcode_direct_msg_';

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
    /* quota */
  }
}

/**
 * 获取离线直连会话列表
 */
export function getDirectSessionList(): SessionMetaWithProject[] {
  const raw = safeStorageGet(DIRECT_SESSIONS_INDEX_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.map((item) => ({
      ...item,
      project_hash: DIRECT_LLM_PROJECT_HASH,
      project_name: DIRECT_LLM_PROJECT_NAME,
    }));
  } catch {
    return [];
  }
}

/**
 * 保存离线直连会话列表元数据
 */
function saveDirectSessionList(list: SessionMetaWithProject[]): void {
  safeStorageSet(DIRECT_SESSIONS_INDEX_KEY, JSON.stringify(list));
}

/**
 * 获取单个离线直连会话详情
 */
export function getDirectSessionDetail(sessionId: string): SessionDetail | null {
  const list = getDirectSessionList();
  const meta = list.find((s) => s.id === sessionId);
  const rawMsgs = safeStorageGet(`${DIRECT_SESSION_PREFIX}${sessionId}`);
  let messages: SessionMessage[] = [];
  if (rawMsgs) {
    try {
      messages = JSON.parse(rawMsgs);
    } catch {}
  }

  const now = Date.now();
  return {
    id: sessionId,
    name: meta?.name || '随身问答',
    working_dir: '',
    created_at: meta?.created_at || now,
    updated_at: meta?.updated_at || now,
    message_count: messages.length,
    messages,
  };
}

/**
 * 创建新的离线直连会话
 */
export function createDirectSession(initialName?: string): SessionMetaWithProject {
  const now = Date.now();
  const id = `direct_${now}_${Math.random().toString(36).slice(2, 7)}`;
  const newMeta: SessionMetaWithProject = {
    id,
    name: initialName?.trim() || '新对话',
    working_dir: '',
    project_hash: DIRECT_LLM_PROJECT_HASH,
    created_at: now,
    updated_at: now,
    message_count: 0,
  };

  const list = getDirectSessionList();
  list.unshift(newMeta);
  saveDirectSessionList(list);
  saveDirectSessionMessages(id, []);
  return newMeta;
}

/**
 * 保存直连会话消息历史
 */
export function saveDirectSessionMessages(
  sessionId: string,
  messages: SessionMessage[],
  newTitle?: string,
): void {
  safeStorageSet(`${DIRECT_SESSION_PREFIX}${sessionId}`, JSON.stringify(messages));

  const list = getDirectSessionList();
  const idx = list.findIndex((s) => s.id === sessionId);
  const now = Date.now();
  if (idx >= 0) {
    list[idx].updated_at = now;
    list[idx].message_count = messages.length;
    if (newTitle?.trim()) {
      list[idx].name = newTitle.trim();
    } else if (list[idx].name === '新对话' && messages.length > 0) {
      // 提取首条用户消息生成会话标题
      const firstUser = messages.find((m) => m.role === 'user');
      if (firstUser?.content) {
        list[idx].name = firstUser.content.slice(0, 24).trim();
      }
    }
    saveDirectSessionList(list);
  }
}

/**
 * 重命名直连会话
 */
export function renameDirectSession(sessionId: string, newName: string): void {
  const list = getDirectSessionList();
  const idx = list.findIndex((s) => s.id === sessionId);
  if (idx >= 0) {
    list[idx].name = newName.trim();
    list[idx].updated_at = Date.now();
    saveDirectSessionList(list);
  }
}

/**
 * 删除直连会话
 */
export function deleteDirectSession(sessionId: string): void {
  let list = getDirectSessionList();
  list = list.filter((s) => s.id !== sessionId);
  saveDirectSessionList(list);
  try {
    localStorage.removeItem(`${DIRECT_SESSION_PREFIX}${sessionId}`);
  } catch {}
}

interface PendingPromptInfo {
  message: string;
  images?: ImageData[];
  signal?: AbortSignal;
}

const pendingDirectPrompts = new Map<string, PendingPromptInfo>();
const activeDirectControllers = new Map<string, AbortController>();

export function enqueueDirectPrompt(
  sessionId: string,
  message: string,
  images?: ImageData[],
  signal?: AbortSignal,
): void {
  pendingDirectPrompts.set(sessionId, { message, images, signal });
}

export function abortDirectStream(sessionId?: string): void {
  if (sessionId) {
    activeDirectControllers.get(sessionId)?.abort();
    activeDirectControllers.delete(sessionId);
    pendingDirectPrompts.delete(sessionId);
  } else {
    for (const ctrl of activeDirectControllers.values()) {
      ctrl.abort();
    }
    activeDirectControllers.clear();
    pendingDirectPrompts.clear();
  }
}

export async function runDirectWatch(
  sessionId: string,
  onEvent: (event: SSEEvent) => void,
  parentSignal?: AbortSignal,
): Promise<void> {
  const pending = pendingDirectPrompts.get(sessionId);
  if (!pending) {
    // 没有待处理的新回合（例如切会话或刷新只做 standby 监听），直接返回 idle 状态
    onEvent({
      type: 'done',
      session_id: sessionId,
      stop_reason: 'not_active',
      tokens: {},
      tool_calls: [],
    });
    return;
  }

  pendingDirectPrompts.delete(sessionId);

  const controller = new AbortController();
  activeDirectControllers.set(sessionId, controller);

  const onParentAbort = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }
  if (pending.signal) {
    if (pending.signal.aborted) controller.abort();
    else pending.signal.addEventListener('abort', onParentAbort, { once: true });
  }

  const profile = getActiveServerProfile();
  const detail = getDirectSessionDetail(sessionId);
  const history = detail?.messages || [];

  try {
    await streamDirectLlmPrompt({
      profile,
      sessionId,
      message: pending.message,
      images: pending.images,
      history,
      signal: controller.signal,
      onEvent,
    });
  } finally {
    activeDirectControllers.delete(sessionId);
    if (parentSignal) {
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  }
}


/**
 * 解析并构建 OpenAI 兼容请求地址（对齐桌面端，域名自动补全 /v1）
 */
export function resolveDirectChatUrl(baseUrl: string): string {
  const trimmed = (baseUrl || '').trim();
  if (!trimmed) return 'https://api.deepseek.com/v1/chat/completions';
  const norm = normalizeServerUrl(trimmed);
  if (norm.endsWith('/chat/completions')) return norm;
  const base = normalizeDirectApiBase(norm);
  return `${base}/chat/completions`;
}

export interface StreamDirectPromptParams {
  profile: ServerProfile;
  sessionId: string;
  message: string;
  images?: ImageData[];
  history?: SessionMessage[];
  signal?: AbortSignal;
  onEvent: (event: SSEEvent) => void;
}

/**
 * 纯前端直连调用 OpenAI 兼容大模型流式接口 (SSE)
 */
export async function streamDirectLlmPrompt(params: StreamDirectPromptParams): Promise<void> {
  const { profile, sessionId, message, images = [], history = [], signal, onEvent } = params;

  const targetUrl = resolveDirectChatUrl(profile.url);
  const targetModel = profile.model?.trim() || 'deepseek-chat';

  // 1. 发出初始握手事件 (保持与标准 EventBus 一致)
  onEvent({
    type: 'runtime_info',
    provider: profile.name,
    model: targetModel,
  });

  onEvent({
    type: 'session_assigned',
    session_id: sessionId,
  });

  onEvent({
    type: 'user',
    content: message,
    session_id: sessionId,
    created_at: Date.now(),
  });

  // 2. 构建符合 OpenAI 规范的消息上下文
  const wireMessages: Array<{ role: string; content: any }> = [];

  // 系统提示词
  const defaultSystemPrompt =
    profile.systemPrompt?.trim() ||
    '你是一名得力且智能的个人随身 AI 助理。请提供条理清晰、准确且友好的解答。当涉及行程规划或清单时，请善用清晰的项目符号与待办结构。';

  wireMessages.push({ role: 'system', content: defaultSystemPrompt });

  // 历史多轮对话（至多带入最近 20 轮上下文以防超限）
  const recentHistory = history.slice(-20);
  for (const h of recentHistory) {
    if (h.role === 'user' || h.role === 'assistant') {
      wireMessages.push({ role: h.role, content: h.content });
    }
  }

  // 最新的一条用户消息（包含文字与多模态图片）
  if (images.length > 0) {
    const contents: any[] = [{ type: 'text', text: message }];
    for (const img of images) {
      const mime = img.media_type || 'image/jpeg';
      contents.push({
        type: 'image_url',
        image_url: {
          url: `data:${mime};base64,${img.data}`,
        },
      });
    }
    wireMessages.push({ role: 'user', content: contents });
  } else {
    wireMessages.push({ role: 'user', content: message });
  }

  const payload = {
    model: targetModel,
    messages: wireMessages,
    stream: true,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
  };
  if (profile.token.trim()) {
    headers.Authorization = `Bearer ${profile.token.trim()}`;
  }

  let fullAssistantText = '';
  let fullReasoningText = '';

  try {
    const resp = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal,
      mode: 'cors',
      credentials: 'omit',
    });

    if (!resp.ok) {
      let errText = '';
      try {
        const errJson = await resp.json();
        errText = errJson.error?.message || errJson.message || JSON.stringify(errJson);
      } catch {
        errText = await resp.text().catch(() => '');
      }
      throw new Error(`API 响应错误 (HTTP ${resp.status}): ${errText || resp.statusText}`);
    }

    if (!resp.body) {
      throw new Error('未收到大模型流式响应体 (Stream body is empty)');
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;

        if (trimmed.startsWith('data:')) {
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') {
            continue;
          }

          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta;
            if (!delta) continue;

            // 1) 思考链增量 (如 DeepSeek R1 / o1 / o3)
            const reasoningChunk = delta.reasoning_content ?? delta.reasoning;
            if (reasoningChunk) {
              fullReasoningText += reasoningChunk;
              onEvent({
                type: 'reasoning',
                content: reasoningChunk,
              });
            }

            // 2) 正文回答增量
            const contentChunk = delta.content;
            if (contentChunk) {
              fullAssistantText += contentChunk;
              onEvent({
                type: 'text',
                content: contentChunk,
              });
            }
          } catch {
            /* 忽略心跳或解析警告 */
          }
        }
      }
    }

    // 3. 落盘存储本轮对话历史
    const userMsg: SessionMessage = {
      role: 'user',
      content: message,
      images: images.length ? images : undefined,
      created_at: Date.now(),
    };
    const assistantMsg: SessionMessage = {
      role: 'assistant',
      content: fullAssistantText,
      reasoning: fullReasoningText || undefined,
      created_at: Date.now(),
    };
    const updatedMessages = [...history, userMsg, assistantMsg];
    saveDirectSessionMessages(sessionId, updatedMessages);

    // 4. 广播完成事件
    onEvent({
      type: 'done',
      session_id: sessionId,
      tokens: { total: 0, prompt: 0, completion: 0 },
      tool_calls: [],
    });
  } catch (err: any) {
    if (signal?.aborted || err.name === 'AbortError') {
      onEvent({ type: 'stopped' });
    } else {
      const msg = err.message || '与大模型 API 连接异常中断';
      onEvent({ type: 'error', message: msg });
    }
  }
}
