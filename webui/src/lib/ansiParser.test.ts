import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ansiToHtml } from './ansiParser.ts';

test('ansiToHtml parses basic 16 colors (red, green, bold)', () => {
  const input = '\x1b[31mRed Error\x1b[0m \x1b[1;32mGreen Bold Success\x1b[0m';
  const html = ansiToHtml(input);
  assert.ok(html.includes('--ansi-red'));
  assert.ok(html.includes('Red Error'));
  assert.ok(html.includes('--ansi-green'));
  assert.ok(html.includes('font-weight:bold'));
  assert.ok(html.includes('Green Bold Success'));
});

test('ansiToHtml parses 24-bit truecolor RGB sequences', () => {
  const input = '\x1b[38;2;123;45;67mCustom Color\x1b[0m';
  const html = ansiToHtml(input);
  assert.ok(html.includes('color:rgb(123,45,67)'));
  assert.ok(html.includes('Custom Color'));
});

test('ansiToHtml strips unrendered cursor controls', () => {
  const input = '\x1b[2J\x1b[?25hNormal Text';
  const html = ansiToHtml(input);
  assert.ok(!html.includes('[2J'));
  assert.ok(!html.includes('?25h'));
  assert.ok(html.includes('Normal Text'));
});
