import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  clearBubbleEditDraft,
  clearComposerDraft,
  loadBubbleEditDraft,
  loadComposerDraft,
  saveBubbleEditDraft,
  saveComposerDraft,
} from './composerDraft.ts';

// 模拟 window.localStorage 和 sessionStorage 环境
const localStorageMock = new Map<string, string>();
const sessionStorageMock = new Map<string, string>();

(globalThis as any).window = {
  localStorage: {
    getItem: (key: string) => localStorageMock.get(key) ?? null,
    setItem: (key: string, val: string) => localStorageMock.set(key, val),
    removeItem: (key: string) => localStorageMock.delete(key),
    clear: () => localStorageMock.clear(),
  },
  sessionStorage: {
    getItem: (key: string) => sessionStorageMock.get(key) ?? null,
    setItem: (key: string, val: string) => sessionStorageMock.set(key, val),
    removeItem: (key: string) => sessionStorageMock.delete(key),
    clear: () => sessionStorageMock.clear(),
  },
};

beforeEach(() => {
  localStorageMock.clear();
  sessionStorageMock.clear();
});

test('saveComposerDraft and loadComposerDraft preserve draft text and images', () => {
  const images = [
    { media_type: 'image/png', data: 'base64-png-1' },
    { media_type: 'image/jpeg', data: 'base64-jpeg-2' },
  ];
  saveComposerDraft('session-1', {
    text: 'hello draft text',
    images,
  });

  const loaded = loadComposerDraft('session-1');
  assert.ok(loaded);
  assert.equal(loaded?.text, 'hello draft text');
  assert.deepEqual(loaded?.images, images);
});

test('saveComposerDraft isolates drafts across sessions and handles new session key', () => {
  saveComposerDraft('session-a', { text: 'draft for A' });
  saveComposerDraft(null, { text: 'draft for new session' });

  assert.equal(loadComposerDraft('session-a')?.text, 'draft for A');
  assert.equal(loadComposerDraft(null)?.text, 'draft for new session');
  assert.equal(loadComposerDraft('session-b'), null);

  clearComposerDraft('session-a');
  assert.equal(loadComposerDraft('session-a'), null);
  assert.equal(loadComposerDraft(null)?.text, 'draft for new session');
});

test('saveComposerDraft clears storage when draft text and images are empty', () => {
  saveComposerDraft('session-1', { text: 'temporary' });
  assert.ok(loadComposerDraft('session-1'));

  saveComposerDraft('session-1', { text: '   ', images: [] });
  assert.equal(loadComposerDraft('session-1'), null);
});

test('saveBubbleEditDraft and loadBubbleEditDraft preserve edit sourceIndex, text, images, and model', () => {
  const images = [{ media_type: 'image/png', data: 'img-data' }];
  saveBubbleEditDraft('session-1', {
    sourceIndex: 3,
    text: 'rewritten user prompt',
    images,
    selectedModel: 'gpt-4o',
  });

  const loaded = loadBubbleEditDraft('session-1');
  assert.ok(loaded);
  assert.equal(loaded?.sourceIndex, 3);
  assert.equal(loaded?.text, 'rewritten user prompt');
  assert.deepEqual(loaded?.images, images);
  assert.equal(loaded?.selectedModel, 'gpt-4o');

  clearBubbleEditDraft('session-1');
  assert.equal(loadBubbleEditDraft('session-1'), null);
});

test('saveBubbleEditDraft ignores calls with null sessionId', () => {
  saveBubbleEditDraft(null, {
    sourceIndex: 0,
    text: 'foo',
  });
  assert.equal(loadBubbleEditDraft(null), null);
});
