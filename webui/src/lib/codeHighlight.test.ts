import assert from 'node:assert/strict';
import { test } from 'node:test';
import { highlightCode, formatCodeContent } from './codeHighlight.ts';

test('highlightCode highlights JSON property keys and strings', () => {
  const jsonCode = '{\n  "mcpServers": {\n    "test": "hello"\n  }\n}';
  const html = highlightCode(jsonCode, '.mcp.json.example');
  assert.ok(html.includes('class="hl-property"'));
  assert.ok(html.includes('"mcpServers"'));
  assert.ok(html.includes('class="hl-string"'));
});

test('highlightCode highlights comments in code', () => {
  const code = '// This is a comment\nconst x = 123;';
  const html = highlightCode(code, 'app.ts');
  assert.ok(html.includes('class="hl-comment"'));
  assert.ok(html.includes('This is a comment'));
  assert.ok(html.includes('class="hl-keyword"'));
  assert.ok(html.includes('const'));
  assert.ok(html.includes('class="hl-number"'));
  assert.ok(html.includes('123'));
});

test('formatCodeContent formats valid JSON with 2 spaces', () => {
  const unformatted = '{"a":1,"b":[2,3]}';
  const formatted = formatCodeContent(unformatted, 'data.json');
  assert.equal(formatted, '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}\n');
});

test('formatCodeContent trims trailing spaces and normalizes code', () => {
  const code = 'const a = 1;   \n\n\n\nconst b = 2;  ';
  const formatted = formatCodeContent(code, 'test.js');
  assert.ok(!formatted.includes('   \n'));
  assert.ok(formatted.endsWith('\n'));
});

test('highlightCode highlights Kotlin syntax and keywords', () => {
  const ktCode = 'package com.example\nfun main(args: Array<String>) {\n  val x = 123\n}';
  const html = highlightCode(ktCode, 'JeikCodeChatPanel.kt');
  assert.ok(html.includes('class="hl-keyword"'));
  assert.ok(html.includes('fun'));
  assert.ok(html.includes('val'));
  assert.ok(html.includes('class="hl-bracket'));
});

test('highlightCode parses rainbow brackets and structure for txt files', () => {
  const txtContent = 'Section 1: [Important Item] {priority: 1}';
  const html = highlightCode(txtContent, 'notes.txt');
  assert.ok(html.includes('class="hl-bracket'));
  assert.ok(html.includes('['));
  assert.ok(html.includes('{'));
});

test('highlightCode does not treat URL slashes as comments in bash commands', () => {
  const bashCmd = '# Linux / macOS / OpenWrt / HarmonyOS PC 适用一键安装\ncurl -fsSL https://raw.githubusercontent.com/jeikl/JeikCode/main/scripts/install.sh | sh';
  const html = highlightCode(bashCmd, 'snippet.bash');
  assert.ok(html.includes('class="hl-comment"'));
  assert.ok(html.includes('# Linux / macOS'));
  assert.ok(!html.includes('<span class="hl-comment">//raw.githubusercontent.com'));
  assert.ok(html.includes('https://raw.githubusercontent.com/jeikl/JeikCode/main/scripts/install.sh'));
  assert.ok(html.includes('|'));
  assert.ok(html.includes('sh'));
});

test('highlightCode does not treat python floor division // as comments', () => {
  const pyCode = 'result = a // b  # floor division';
  const html = highlightCode(pyCode, 'calc.py');
  assert.ok(!html.includes('class="hl-comment">//'));
  assert.ok(html.includes('class="hl-comment"># floor division'));
});

test('highlightCode does not treat decrement operator -- as comment in JS/TS/Rust', () => {
  const tsCode = 'count--;\n// finished';
  const html = highlightCode(tsCode, 'main.ts');
  assert.ok(!html.includes('class="hl-comment">--'));
  assert.ok(html.includes('class="hl-comment">// finished'));
});

test('highlightCode highlights SQL dashed comments properly', () => {
  const sql = 'SELECT * FROM users; -- select all';
  const html = highlightCode(sql, 'query.sql');
  assert.ok(html.includes('class="hl-comment">-- select all'));
});

test('highlightCode does not treat URL with colon in TS as comment', () => {
  const tsCode = 'const endpoint = https://api.jeikcode.top/v1;';
  const html = highlightCode(tsCode, 'config.ts');
  assert.ok(!html.includes('class="hl-comment">//api.jeikcode.top'));
});
