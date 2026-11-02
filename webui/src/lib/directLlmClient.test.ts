import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveDirectChatUrl,
  getDirectSessionList,
  createDirectSession,
  getDirectSessionDetail,
  saveDirectSessionMessages,
  deleteDirectSession,
  DIRECT_LLM_PROJECT_HASH,
} from './directLlmClient.ts';
import type { ServerProfile } from './serverProfiles.ts';
import {
  isDirectLlmProfile,
  upsertServerProfile,
} from './serverProfiles.ts';

// Mock localStorage for node environment
const storage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, String(v)),
  removeItem: (k: string) => storage.delete(k),
  clear: () => storage.clear(),
};

test('resolveDirectChatUrl formats base URLs correctly', () => {
  assert.equal(
    resolveDirectChatUrl('https://api.deepseek.com/v1'),
    'https://api.deepseek.com/v1/chat/completions',
  );
  assert.equal(
    resolveDirectChatUrl('https://api.openai.com/v1/chat/completions'),
    'https://api.openai.com/v1/chat/completions',
  );
  assert.equal(
    resolveDirectChatUrl('https://my-gateway.internal.net'),
    'https://my-gateway.internal.net/chat/completions',
  );
});

test('isDirectLlmProfile detects node modes properly', () => {
  const hostProfile: ServerProfile = {
    id: 'h1',
    name: '工位电脑',
    type: 'host',
    url: 'http://192.168.1.100:13458',
    token: 'sec',
  };
  const directProfile: ServerProfile = {
    id: 'd1',
    name: 'DeepSeek 随身直连',
    type: 'direct_llm',
    url: 'https://api.deepseek.com/v1',
    token: 'sk-1234',
    model: 'deepseek-chat',
  };

  assert.equal(isDirectLlmProfile(hostProfile), false);
  assert.equal(isDirectLlmProfile(directProfile), true);
  assert.equal(isDirectLlmProfile(null), false);
  assert.equal(isDirectLlmProfile(undefined), false);
});

test('Direct LLM local session lifecycle works independently', () => {
  storage.clear();
  const initialList = getDirectSessionList();
  assert.equal(initialList.length, 0);

  // 1. 创建直连会话
  const sessionMeta = createDirectSession('我的旅行规划');
  assert.equal(sessionMeta.project_hash, DIRECT_LLM_PROJECT_HASH);
  assert.equal(sessionMeta.name, '我的旅行规划');

  // 2. 检查会话列表
  const listAfterCreate = getDirectSessionList();
  assert.equal(listAfterCreate.length, 1);
  assert.equal(listAfterCreate[0].id, sessionMeta.id);

  // 3. 存储消息历史
  saveDirectSessionMessages(sessionMeta.id, [
    { role: 'user', content: '帮我规划三天两晚成都亲子游', created_at: Date.now() },
    { role: 'assistant', content: '没问题，以下是为您定制的行程安排：\n- 第一天：大熊猫繁育研究基地...', created_at: Date.now() },
  ]);

  const detail = getDirectSessionDetail(sessionMeta.id);
  assert.ok(detail);
  assert.equal(detail.messages.length, 2);
  assert.equal(detail.messages[0].content, '帮我规划三天两晚成都亲子游');
  assert.match(detail.messages[1].content, /大熊猫/);

  // 4. 删除会话
  deleteDirectSession(sessionMeta.id);
  assert.equal(getDirectSessionList().length, 0);
  assert.equal(getDirectSessionDetail(sessionMeta.id)?.messages.length, 0);
});
