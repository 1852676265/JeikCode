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
