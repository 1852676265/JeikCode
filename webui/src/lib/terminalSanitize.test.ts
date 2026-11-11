import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  hasLiveDsrQuery,
  hasShellPromptOutput,
  isColumnOneCursorReport,
  isTerminalProtocolReply,
  sanitizeInitialFrame,
  stripTerminalQueries,
} from './terminalSanitize.ts';

test('stripTerminalQueries removes DSR/DA/DECRQM/OSC queries without harming visible output', () => {
  const raw =
    '\x1b[32m[Zap Terminal: t1 (powershell)]\x1b[0m\r\nActive workspace: D:\\Projects\\Zap\r\nReady.\r\n\r\n' +
    '\x1b[6n\x1b[?6n\x1b[c\x1b[>0c\x1b[?1004$p\x1b[18t\x1b]11;?\x07PS D:\\Projects\\Zap> \x1b[?25h';
  const cleaned = stripTerminalQueries(raw);
  assert.equal(cleaned.includes('\x1b[6n'), false);
  assert.equal(cleaned.includes('\x1b[c'), false);
  assert.equal(cleaned.includes('\x1b[>0c'), false);
  assert.equal(cleaned.includes('\x1b[18t'), false);
  assert.equal(cleaned.includes('PS D:\\Projects\\Zap> \x1b[?25h'), true);
});

test('sanitizeInitialFrame treats snapshot with output after 6n as replay and strips 6n', () => {
  const greeting =
    '\x1b[32m[Zap Terminal: term_1 (powershell)]\x1b[0m\r\nActive workspace: D:\\Projects\\Zap\r\nReady.\r\n\r\n';
  const snapshot = `${greeting}\x1b[6nFiles: 1091\r\nPS D:\\Projects\\Zap> `;
  const res = sanitizeInitialFrame(snapshot, false);
  assert.equal(res.isReplay, true);
  assert.equal(res.hasLiveDsr, false);
  assert.equal(res.text.includes('\x1b[6n'), false);
  assert.equal(res.text.includes('PS D:\\Projects\\Zap> '), true);
});

test('sanitizeInitialFrame keeps single trailing startup 6n only once for live ConPTY handshake', () => {
  const greeting =
    '\x1b[32m[Zap Terminal: term_1 (powershell)]\x1b[0m\r\nActive workspace: D:\\Projects\\Zap\r\nReady.\r\n\r\n';
  const liveStartup = `${greeting}\x1b[6n`;
  const first = sanitizeInitialFrame(liveStartup, false);
  assert.equal(first.isReplay, false);
  assert.equal(first.hasLiveDsr, true);
  assert.equal(first.text.endsWith('\x1b[6n'), true);

  const duplicate = sanitizeInitialFrame(liveStartup, true);
  assert.equal(duplicate.isReplay, true);
  assert.equal(duplicate.hasLiveDsr, false);
  assert.equal(duplicate.text.includes('\x1b[6n'), false);
});

test('protocol reply and column-1 CPR detection does not block Shift+F3 or normal text', () => {
  assert.equal(isTerminalProtocolReply('\x1b[5;1R'), true);
  assert.equal(isTerminalProtocolReply('\x1b[?1;2c'), true);
  assert.equal(isTerminalProtocolReply('\x1b[I'), true);
  assert.equal(isTerminalProtocolReply('zap init --force\r'), false);

  assert.equal(isColumnOneCursorReport('\x1b[5;1R'), true);
  assert.equal(isColumnOneCursorReport('\x1b[1;1R'), true);
  // Shift+F3 / Ctrl+F3 modifier != 1
  assert.equal(isColumnOneCursorReport('\x1b[1;2R'), false);
  assert.equal(isColumnOneCursorReport('\x1b[1;5R'), false);
  // Plain F3 in xterm.js is SS3 R
  assert.equal(isColumnOneCursorReport('\x1bOR'), false);
  assert.equal(isTerminalProtocolReply('\x1bOR'), false);
});

test('hasShellPromptOutput ignores greeting and detects real PowerShell/bash prompts', () => {
  const greeting =
    '\x1b[32m[Zap Terminal: term_1 (powershell)]\x1b[0m\r\nActive workspace: D:\\Projects\\Zap\r\nReady.\r\n\r\n';
  assert.equal(hasShellPromptOutput(greeting), false);
  assert.equal(hasShellPromptOutput('\x1b[?9001h\x1b[?1004h'), false);
  assert.equal(
    hasShellPromptOutput('\x1b[?25l\x1b[2J\x1b[m\x1b[HPS D:\\Projects\\Zap>\x1b[1C\x1b[?25h'),
    true
  );
  assert.equal(hasShellPromptOutput('user@host:~/Zap$ '), true);
  assert.equal(hasLiveDsrQuery('abc\x1b[6ndef'), true);
});
