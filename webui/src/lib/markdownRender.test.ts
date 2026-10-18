import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markdownToHtml } from './markdownRender.ts';

test('GitHub alerts become classed blockquotes', () => {
  const note = markdownToHtml('> [!NOTE]\n> hello');
  assert.match(note, /md-alert md-alert-note/);
  assert.match(note, /md-alert-title/);
  assert.match(note, /hello/);

  const warn = markdownToHtml('> [!WARNING] be careful');
  assert.match(warn, /md-alert-warning/);
  assert.match(warn, /be careful/);
});

test('code fence language sentinel is stripped and generic lang is hidden', () => {
  const out = markdownToHtml('```text\ntext\nBase URL: http://127.0.0.1:8045\n```');
  assert.match(out, /Base URL: http:\/\/127\.0\.0\.1:8045/);
  assert.doesNotMatch(out, /<code[^>]*>text\nBase URL/);
  assert.doesNotMatch(out, /<span class="code-block-lang">text<\/span>/);
});

test('named language gets a toolbar label', () => {
  const out = markdownToHtml('```ts\nconst n = 1;\n```');
  assert.match(out, /<span class="code-block-lang">ts<\/span>/);
  assert.match(out, /const n = 1;/);
});

test('two indented ```text fences in one numbered list both render', () => {
  const content = [
    '已通过并发工具调用同时并行执行了两个 Hello World 任务：',
    '',
    '1. **任务 1** 输出：',
    '   ```text',
    '   Hello World 1',
    '   ```',
    '',
    '2. **任务 2** 输出：',
    '   ```text',
    '   Hello World 2',
    '   ```',
    '',
    '两个任务已在单轮中并行派发并成功完成。',
  ].join('\n');
  const out = markdownToHtml(content);
  assert.match(out, /Hello World 1/);
  assert.match(out, /Hello World 2/);
  assert.equal((out.match(/code-block-wrapper/g) ?? []).length, 2);
  assert.doesNotMatch(out, /<p>[^<]*```/);
});

test('code fence inside list ending with backslash closes properly without swallowing following text', () => {
  const content = [
    '- **开发与构建目录**：',
    '  ```text',
    '  E:\\code\\jeikcode\\target\\',
    '  E:\\code\\Antigravity-Manager\\src-tauri\\target\\',
    '  %USERPROFILE%\\.cargo\\bin\\',
    '  ```',
    '- **进程白名单**：',
    '  - `jeikcode.exe`',
    '',
    '#### 2. Linux 服务器环境',
    '',
    '- **二进制目录与文件**：',
    '  ```text',
    '  /usr/local/bin/jeikcode',
    '  ```',
  ].join('\n');
  const out = markdownToHtml(content);
  assert.match(out, /<strong>进程白名单<\/strong>/);
  assert.match(out, /<h4[^>]*>2\. Linux 服务器环境<\/h4>/);
  assert.match(out, /<strong>二进制目录与文件<\/strong>/);
  assert.equal((out.match(/code-block-wrapper/g) ?? []).length, 2);
});

test('structural fence auto-close when closing fence is omitted before heading', () => {
  // 模型输出了 ```rust 代码块，但是漏写了闭合的 ```，直接写了 #### 3. 标题
  const brokenMd = [
    '2. grok-build 分析',
    '* 底层实现：',
    '```rust',
    'cmd.arg("-e").arg(&input.pattern);',
    // 注意：这里漏掉了闭合 ```
    '* 同样没有传 `-F`，没有做任何符号转义保护。',
    '',
    '#### 3. 相比之下，`jeikcode` 的防护其实已经领先了一步：',
    '* `jeikcode` 写的智能回退逻辑：',
    '```rust',
    'let matcher = 1;',
    '```',
  ].join('\n');

  const out = markdownToHtml(brokenMd);
  // 结构性自愈生效：标题必须独立渲染为 h4，而不是被吞进代码块
  assert.match(out, /<h4[^>]*>3\. 相比之下/);
  // 必须有两个独立的代码块，而不是融为一个大块
  assert.equal((out.match(/code-block-wrapper/g) ?? []).length, 2);
});

test('indented code blocks with nested markdown are unpacked and rendered as rich text', () => {
  const md = [
    '    * 同样没有传 `-F`，没有符号保护。',
    '    ',
    '    #### 标题内容',
    '    * 列表条目',
  ].join('\n');
  const out = markdownToHtml(md);
  assert.match(out, /<h4[^>]*>标题内容<\/h4>/);
  assert.match(out, /<li>列表条目<\/li>/);
});

test('code blocks with numbered lines and dashed dividers are not truncated when closed properly', () => {
  const md = [
    '```text',
    '1. 插入老数据: id=3673',
    '2. 首次查询结果: Track 2',
    '------------------------------------------------------------',
    '协议 [OpenAI Chat]:',
    '  - 首位是合法思考块: True',
    '>>> [PASS] 验证通过！',
    '```',
    '*老数据首次查询无损捞出并自动自愈打上标签。*',
  ].join('\n');
  const out = markdownToHtml(md);
  // 必须只生成 1 个完整的代码块，里面的数字列表和横线完好保留
  assert.equal((out.match(/code-block-wrapper/g) ?? []).length, 1);
  assert.match(out, /1\. 插入老数据/);
  assert.match(out, /------------------------------------------------------------/);
  // 代码块外部的斜体必须作为普通段落渲染，绝不能被反相吞入代码块
  assert.match(out, /<em>老数据首次查询无损捞出并自动自愈打上标签。<\/em>/);
});

test('markdown code block containing headings is preserved without splitting', () => {
  const md = [
    '```markdown',
    '# 🚀 Antigravity Tools v4.8.1 Release Notes',
    '',
    '> [🇨🇳 中文更新日志](#-中文更新日志-chinese)',
    '',
    '## 🇨🇳 中文更新日志 (Chinese)',
    '### 🌟 核心亮点与重大更新',
    '```',
    '正文内容应该作为普通文本渲染，绝不被吞入代码块。',
  ].join('\n');
  const out = markdownToHtml(md);
  // 必须只生成 1 个代码块，代码块内完整包含标题语法
  assert.equal((out.match(/code-block-wrapper/g) ?? []).length, 1);
  assert.match(out, /# 🚀 Antigravity Tools v4\.8\.1 Release Notes/);
  assert.match(out, /## 🇨🇳 中文更新日志 \(Chinese\)/);
  assert.match(out, /<p>正文内容应该作为普通文本渲染/);
});

test('python code block with hash comments is preserved without premature truncation', () => {
  const py = [
    '```python',
    '# 这是一个重要配置注释',
    'def configure():',
    '    # TODO: 支持更多协议',
    '    return True',
    '```',
    '代码块结束后的普通段落。',
  ].join('\n');
  const out = markdownToHtml(py);
  assert.equal((out.match(/code-block-wrapper/g) ?? []).length, 1);
  assert.match(out, /# 这是一个重要配置注释/);
  assert.match(out, /<p>代码块结束后的普通段落。<\/p>/);
});

test('headings generate slug ids and support GFM anchor link targets', () => {
  const md = [
    '> [🇨🇳 中文更新日志](#-中文更新日志-chinese) | [🇺🇸 English Release Notes](#-english-release-notes)',
    '',
    '## 🇨🇳 中文更新日志 (Chinese)',
    '## 🇺🇸 English Release Notes',
  ].join('\n');
  const out = markdownToHtml(md);
  assert.match(out, /id="-中文更新日志-chinese"/);
  assert.match(out, /data-alt-id="中文更新日志-chinese"/);
  assert.match(out, /id="-english-release-notes"/);
});

test('nested markdown code blocks do not break outer block or trigger double fences', () => {
  const md = [
    '```markdown',
    '# JeikCode 项目全局开发约束',
    '### 步骤 2：更新 CHANGELOG.md',
    '- **编写模板**：',
    '',
    '  ```markdown',
    '  ## vX.Y.Z (YYYY-MM-DD)',
    '  - Detail',
    '  ```',
    '',
    '#### 步骤 3：同步更新 README 文档日志',
    '#### 步骤 5：打 Tag 并触发发布流水线',
    '```bash',
    'git tag vX.Y.Z && git push origin vX.Y.Z',
    '```',
    '> 更多发版细则详见 docs/release-tutorial.md。',
    '```',
    '',
    '---',
    '',
    '### 三、当前工作区状态',
    '',
    '`git status` 为 `working tree clean`',
  ].join('\n');

  const out = markdownToHtml(md);

  // 1. 外部的大 markdown 代码块必须完整作为一个整体，绝不能被提前拆碎
  assert.equal((out.match(/code-block-wrapper/g) ?? []).length, 1);
  // 2. 内部的嵌套内容（包含二级代码块与模板）必须完整保留在代码块内部
  assert.match(out, /## vX\.Y\.Z \(YYYY-MM-DD\)/);
  assert.match(out, /#### 步骤 3：同步更新 README 文档日志/);
  assert.match(out, /git tag vX\.Y\.Z/);
  // 3. 内部标题绝不能泄露并被解析为富文本 h2 标题
  assert.doesNotMatch(out, /<h2[^>]*>vX\.Y\.Z/);
  // 4. 外层代码块闭合后，后续的正文必须正常渲染为富文本，绝不能被错误吞进代码块
  assert.match(out, /<hr>/);
  assert.match(out, /<h3[^>]*>三、当前工作区状态<\/h3>/);
  assert.match(out, /<code>git status<\/code>/);
});

test('mermaid code block is intercepted and transformed into mermaid mount point', () => {
  const md = [
    '下面是一个系统架构图：',
    '```mermaid',
    'graph TD',
    '    A[客户端] --> B[API网关]',
    '    B --> C[服务集群]',
    '```',
    '图表结束后的普通段落。',
  ].join('\n');

  const out = markdownToHtml(md);

  // 1. 验证生成了 mermaid-diagram-mount 容器
  assert.match(out, /<div class="mermaid-diagram-mount"/);
  // 2. 验证容器内携带了编码后的 mermaid 源代码
  assert.match(out, /data-mermaid-code="/);
  // 3. 验证未渲染为普通代码块 wrapper
  assert.doesNotMatch(out, /code-block-wrapper.*mermaid/);
  // 4. 验证前后的普通段落未受影响
  assert.match(out, /<p>下面是一个系统架构图：<\/p>/);
  assert.match(out, /<p>图表结束后的普通段落。<\/p>/);
});

test('unclosed streaming mermaid code block remains stable code block to prevent flashing', () => {
  const streamingMd = [
    '这是正在流式生成的流程图：',
    '```mermaid',
    'graph TD',
    '    A[客户端] --> B[API网关]',
  ].join('\n');

  const out = markdownToHtml(streamingMd);

  // 1. 验证流式未闭合时不应提前渲染为交互图表挂载点，彻底消除 MD 与图表来回跳跃闪烁
  assert.doesNotMatch(out, /<div class="mermaid-diagram-mount"/);
  // 2. 验证渲染为标准的 mermaid 代码块 wrapper
  assert.match(out, /code-block-wrapper.*has-language/);
  assert.match(out, /<span class="code-block-lang">mermaid<\/span>/);
  assert.match(out, /<code class="language-mermaid">/);
  assert.match(out, /A\[客户端\] --&gt; B\[API网关\]/);
});

test('nested mermaid block inside markdown code block is kept as source and does not fragment or corrupt post-block headings', () => {
  const md = [
    '典型情况是大模型正在输出一份完整的文档草稿：',
    '````markdown',
    '这里是给你生成的 README.md 模板：',
    '```markdown',
    '# 项目设计说明',
    '以下是系统架构拓扑：',
    '```mermaid',
    'graph TD',
    '    A --> B',
    '```',
    '```',
    '````',
    '',
    '#### 结论：完成',
    '#### 理由：测试',
  ].join('\n');

  const out = markdownToHtml(md);

  // 1. 外部的大 markdown 代码块必须完整作为一个整体，且仅有 1 个代码块 wrapper
  assert.equal((out.match(/code-block-wrapper/g) ?? []).length, 1);
  // 2. 内部的 mermaid 语法必须保留在代码块内部，绝不能被外泄并转为 mermaid-diagram-mount
  assert.doesNotMatch(out, /<div class="mermaid-diagram-mount"/);
  assert.match(out, /```mermaid/);
  assert.match(out, /graph TD/);
  // 3. 代码块外部紧跟的 #### 结论 必须正常被渲染为 <h4> 标签，绝不能沦为裸文本
  assert.match(out, /<h4[^>]*>结论：完成<\/h4>/);
  assert.match(out, /<h4[^>]*>理由：测试<\/h4>/);
});

test('Mermaid labels and TeX survive mount encoding without injecting HTML', () => {
  const source = [
    'flowchart LR',
    String.raw`A["$$\\frac{1}{2}$$<br/>ready & waiting"] --> B["<script>alert(1)</script>"]`,
  ].join('\n');
  const html = markdownToHtml(`\`\`\`mermaid\n${source}\n\`\`\``);
  const mount = /data-mermaid-code="([^"]+)"/.exec(html);

  assert.ok(mount);
  assert.equal(decodeURIComponent(mount[1]), source);
  assert.doesNotMatch(html, /<script\b|<br\s*\/?>|class="katex"/i);
});

test('markdownToHtml with highlight=true correctly highlights bash command containing URL without treating // as comment', () => {
  const md = [
    '```bash',
    '# Linux / macOS / OpenWrt / HarmonyOS PC 适用一键安装',
    'curl -fsSL https://raw.githubusercontent.com/jeikl/JeikCode/main/scripts/install.sh | sh',
    '```',
  ].join('\n');
  const html = markdownToHtml(md, { highlight: true });

  assert.match(html, /class="hl-comment"># Linux \/ macOS/);
  assert.doesNotMatch(html, /class="hl-comment">\/\/raw/);
  assert.match(html, /https:\/\/raw\.githubusercontent\.com\/jeikl\/JeikCode\/main\/scripts\/install\.sh/);
  assert.match(html, /class="hl-operator">\|<\/span>/);
});

test('markdownToHtml correctly closes diff code block containing nested diff markers without swallowing subsequent prose and headings', () => {
  const userSample = [
    '我们可以把目前的报错拆解一下，看看它为什么会误导 Agent：',
    '',
    '---',
    '',
    '### 一、当前报错存在的 3 个核心痛点（为什么会误导模型）',
    '',
    '#### 1. 上下文行全部打上 `+` 号，造成严重的视觉/注意力噪音',
    '看你工具打印出来的 Diff：',
    '```diff',
    '--- expected (your old_string)',
    '+++ actual (in file)',
    '@@ -1,3 +1,14 @@',
    '+',
    '+### 官方一键在线安装',
    '+',
    '+脚本会自动检测系统与 CPU 架构（x86_64、aarch64 等）...',
    '+',
    '+::: code-group',
    '+',
    ' ```bash [Linux / macOS / OpenWrt / HarmonyOS PC]',
    ' curl -fsSL https://raw.githubusercontent.com/jeikl/JeikCode/main/scripts/install.sh | bash',
    '-```}],path:',
    '\\ No newline at end of file',
    '+```',
    '+',
    '+```powershell [Windows (PowerShell)]',
    '+irm https://raw.githubusercontent.com/jeikl/JeikCode/main/scripts/install.ps1 | iex',
    '+```',
    '```',
    '- **模型的心理逻辑**：在标准的 Diff 里，`+` 代表多余新增内容。',
    '',
    '#### 2. `\\ No newline at end of file` 制造了二次干扰',
    '`-```}],path:` 下面紧跟着一行 `\\ No newline at end of file`。',
    '',
    '#### 3. 提示语容易让模型“病急乱投医”',
    '',
    '---',
    '',
    '### 二、如何改进？什么样的报错对 LLM 最清晰？',
    '',
    '#### 方案 A：只高亮真正冲突的字符',
    '```text',
    'edit failed: old_string not found in file.',
    '```',
    '',
    '#### 方案 B：优化 Diff 格式',
    '```diff',
    '--- your old_string',
    '+++ actual in file',
    '```',
  ].join('\n');

  const html = markdownToHtml(userSample);

  // 1. 标题必须独立渲染为 h3 和 h4，严禁被吞入代码块
  assert.match(html, /<h3[^>]*>一、当前报错存在的 3 个核心痛点/);
  assert.match(html, /<h4[^>]*>1\. 上下文行全部打上 <code>\+<\/code> 号/);
  assert.match(html, /<h4[^>]*>2\. <code>\\ No newline at end of file<\/code> 制造了二次干扰/);
  assert.match(html, /<h4[^>]*>3\. 提示语容易让模型“病急乱投医”/);
  assert.match(html, /<h3[^>]*>二、如何改进？什么样的报错对 LLM 最清晰？/);
  assert.match(html, /<h4[^>]*>方案 A：只高亮真正冲突的字符/);
  assert.match(html, /<h4[^>]*>方案 B：优化 Diff 格式/);

  // 2. 正确分割为 3 个独立的代码块，无正文泄漏
  const blocks = html.match(/class="code-block-wrapper/g) ?? [];
  assert.equal(blocks.length, 3);
});
