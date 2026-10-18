/**
 * 极轻量、极速且精准的代码语法高亮与格式化引擎。
 * 支持 JSON/JSONC、TypeScript/JavaScript、Rust、Python、HTML、CSS、TOML/YAML 等常见开发语言。
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const KEYWORDS_JS_TS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'function',
  'if', 'import', 'in', 'instanceof', 'new', 'return', 'super', 'switch',
  'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
  'let', 'static', 'enum', 'await', 'async', 'implements', 'interface',
  'package', 'private', 'protected', 'public', 'type', 'declare', 'as',
  'from', 'of', 'true', 'false', 'null', 'undefined', 'NaN', 'Infinity'
]);

const KEYWORDS_RUST = new Set([
  'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn',
  'else', 'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in',
  'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return',
  'self', 'Self', 'static', 'struct', 'super', 'trait', 'true', 'type',
  'union', 'unsafe', 'use', 'where', 'while', 'None', 'Some', 'Ok', 'Err'
]);

const KEYWORDS_PYTHON = new Set([
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
  'def', 'del', 'elif', 'else', 'except', 'False', 'finally', 'for',
  'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'None', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'True', 'try', 'while', 'with', 'yield'
]);

const KEYWORDS_KOTLIN = new Set([
  'package', 'import', 'class', 'interface', 'fun', 'val', 'var', 'is', 'in',
  'this', 'super', 'when', 'try', 'catch', 'finally', 'for', 'do', 'while',
  'if', 'else', 'return', 'throw', 'continue', 'break', 'object', 'typeof',
  'as', 'typealias', 'override', 'open', 'final', 'abstract', 'private',
  'protected', 'public', 'internal', 'enum', 'sealed', 'annotation', 'data',
  'inline', 'noinline', 'crossinline', 'reified', 'external', 'operator',
  'infix', 'suspend', 'tailrec', 'vararg', 'field', 'it', 'by', 'constructor',
  'init', 'companion', 'where', 'actual', 'expect', 'set', 'get', 'null',
  'true', 'false'
]);

const KEYWORDS_ALL = new Set([
  ...KEYWORDS_JS_TS,
  ...KEYWORDS_RUST,
  ...KEYWORDS_PYTHON,
  ...KEYWORDS_KOTLIN,
  // Java, C#, C/C++
  'public', 'private', 'protected', 'class', 'interface', 'extends', 'implements',
  'package', 'import', 'void', 'int', 'float', 'double', 'long', 'short', 'byte',
  'char', 'boolean', 'string', 'String', 'static', 'final', 'const', 'new', 'this',
  'super', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
  'break', 'continue', 'try', 'catch', 'finally', 'throw', 'throws', 'namespace',
  'using', 'get', 'set', 'override', 'virtual', 'abstract', 'sealed', 'async', 'await',
  'auto', 'constexpr', 'template', 'typename', 'nullptr', 'include', 'define',
  // Go
  'func', 'package', 'import', 'type', 'struct', 'interface', 'var', 'const', 'defer',
  'go', 'select', 'chan', 'range', 'map', 'make', 'len', 'cap', 'nil',
  // Swift
  'protocol', 'extension', 'guard', 'mutating',
  // PHP
  'function', 'echo', 'print', 'array', 'isset', 'empty', 'die', 'exit',
  // Shell / Bash
  'echo', 'export', 'source', 'alias', 'cd', 'ls', 'mkdir', 'rm', 'cp', 'mv', 'cat',
  'grep', 'find', 'curl', 'wget', 'sudo', 'chmod', 'chown', 'tar', 'unzip', 'git'
]);

// 纯结构与大型锁定文件集合：不应被当做普通编程代码误染
const RAW_LOCK_EXTS = new Set([
  'lock', 'out', 'bin', 'gitignore', 'gitattributes', 'npmignore', 'dockerignore'
]);

// 仅支持 # 作为单行注释的语言（绝不支持 // 或 -- 注释，防止 URL 协议或命令行参数被腰斩）
const HASH_COMMENT_LANGS = new Set([
  'bash', 'sh', 'zsh', 'shell', 'ksh', 'csh', 'fish',
  'python', 'py', 'python3', 'pyw',
  'ruby', 'rb',
  'perl', 'pl', 'pm',
  'yaml', 'yml',
  'toml',
  'dockerfile', 'containerfile',
  'r',
  'makefile', 'make', 'cmake',
  'powershell', 'ps', 'ps1', 'psm1',
  'ini', 'conf', 'cfg', 'properties', 'env'
]);

// 支持 // 作为单行注释的语言
const SLASH_COMMENT_LANGS = new Set([
  'javascript', 'js', 'jsx', 'mjs', 'cjs',
  'typescript', 'ts', 'tsx', 'mts', 'cts',
  'c', 'cpp', 'cc', 'cxx', 'c++', 'h', 'hpp', 'hxx',
  'java', 'kotlin', 'kt', 'kts', 'scala', 'groovy',
  'csharp', 'cs', 'c#',
  'go', 'golang',
  'rust', 'rs',
  'swift',
  'php',
  'dart',
  'jsonc'
]);

// 支持 -- 作为单行注释的语言 (SQL, Lua, Haskell 等)
const DASH_COMMENT_LANGS = new Set([
  'sql', 'mysql', 'pgsql', 'sqlite', 'tsql', 'plsql',
  'lua',
  'haskell', 'hs',
  'ada', 'elm'
]);

// 纯文本或无单行注释语言
const NO_COMMENT_LANGS = new Set([
  'txt', 'text', 'log', 'csv', 'tsv', 'json', 'md', 'markdown', 'html', 'xml', 'svg',
  'diff', 'patch'
]);

/**
 * 将代码文本转换为带有丰富高亮 span 的 HTML 字符串。
 */
export function highlightCode(code: string, fileName: string): string {
  // 对于超大极端文件（代码长度 > 800KB 或超过 16000 行），采用纯文本快速安全转义，保证瞬时毫秒级秒开与缩放零卡顿！
  // 放宽至 800KB / 16000 行以完美覆盖 Chat.tsx (~1.1万行/460KB) 等大型复杂组件的语法高亮
  if (code.length > 800_000 || (code.length > 5000 && code.split('\n').length > 16_000)) {
    return escapeHtml(code);
  }

  const lowerName = fileName.toLowerCase().replace(/\\/g, '/');
  const baseName = lowerName.split('/').pop() || '';
  const ext = baseName.includes('.') ? baseName.split('.').pop() || '' : baseName;

  let resolvedLang = ext;
  if (baseName === 'dockerfile' || baseName.startsWith('dockerfile.')) resolvedLang = 'dockerfile';
  else if (baseName === 'makefile' || baseName.startsWith('makefile.')) resolvedLang = 'makefile';
  else if (baseName === 'gemfile') resolvedLang = 'ruby';

  const isLockFile = lowerName.endsWith('.lock') || lowerName.includes('cargo.lock') || lowerName.includes('package-lock.json') || lowerName.includes('yarn.lock') || lowerName.includes('pnpm-lock.yaml');
  const isCodeExample = (ext === 'example' || ext === 'sample') && (lowerName.includes('.json') || lowerName.includes('.js') || lowerName.includes('.ts') || lowerName.includes('.rs') || lowerName.includes('.py'));
  const isRawFile = !isCodeExample && (isLockFile || RAW_LOCK_EXTS.has(ext));

  // 超大原始二进制/锁文件直接纯净转义
  if (isRawFile) {
    return escapeHtml(code);
  }

  const isJson = resolvedLang === 'json' || fileName.endsWith('.json.example') || fileName.includes('.json');
  const isRust = resolvedLang === 'rs' || resolvedLang === 'rust';
  const isPy = resolvedLang === 'py' || resolvedLang === 'python' || resolvedLang === 'python3';
  const isKotlin = resolvedLang === 'kt' || resolvedLang === 'kts' || resolvedLang === 'kotlin';
  const isPureText = NO_COMMENT_LANGS.has(resolvedLang);

  const isHashComment = HASH_COMMENT_LANGS.has(resolvedLang);
  const isSlashComment = SLASH_COMMENT_LANGS.has(resolvedLang);
  const isDashComment = DASH_COMMENT_LANGS.has(resolvedLang);
  const isNoComment = isPureText || resolvedLang === 'json';

  const lines = code.split('\n');
  let bracketDepth = 0;

  const highlightedLines = lines.map((line) => {
    let out = '';
    let i = 0;
    const len = line.length;

    while (i < len) {
      // 0. 连续 3 个及以上反引号属于代码块围栏，整行作为围栏输出，避免将围栏语言标记拆分
      if (line.slice(i, i + 3) === '```') {
        out += escapeHtml(line.slice(i));
        break;
      }

      // 1. URL 协议检测 (https://, http://, ftp://, file://, ws://, wss://, git://)
      // 绝不将 URL 中的 // 暴力识别为注释！在代码块/命令中将完整 URL 作为独立整体渲染
      const urlMatch = line.slice(i).match(/^(?:https?|ftp|file|ws|wss|git):\/\/[^\s"'`<>]+/i);
      if (urlMatch) {
        const urlStr = urlMatch[0];
        out += `<span class="hl-string">${escapeHtml(urlStr)}</span>`;
        i += urlStr.length;
        continue;
      }

      // 2. 单行注释检测 (严格按语言规则匹配，避免将 URL 或自减操作符暴力判定为注释)
      if (!isNoComment) {
        if (isHashComment) {
          // 仅支持 # 作为注释的语言 (bash, python, yaml 等)
          if (line[i] === '#') {
            const isBashVarLen = (resolvedLang === 'bash' || resolvedLang === 'sh' || resolvedLang === 'zsh') && (
              (i > 0 && line[i - 1] === '$') ||
              (i >= 2 && line.slice(i - 2, i) === '${')
            );
            if (!isBashVarLen && (i === 0 || /\s|;/.test(line[i - 1]))) {
              out += `<span class="hl-comment">${escapeHtml(line.slice(i))}</span>`;
              break;
            }
          }
        } else if (isDashComment) {
          // 仅支持 -- 作为注释的语言 (sql, lua 等)
          if (line.slice(i, i + 2) === '--' && (i === 0 || /\s/.test(line[i - 1]))) {
            out += `<span class="hl-comment">${escapeHtml(line.slice(i))}</span>`;
            break;
          }
        } else if (isSlashComment) {
          // 支持 // 作为注释的语言 (js, ts, rust, c, cpp, java, go 等)
          if (line.slice(i, i + 2) === '//') {
            const isColonPrefix = i > 0 && line[i - 1] === ':';
            if (!isColonPrefix) {
              out += `<span class="hl-comment">${escapeHtml(line.slice(i))}</span>`;
              break;
            }
          }
        } else {
          // 兜底 / 未知语言：支持 // 和 #，必须排除 :// 且不开启 -- 避免误伤 CLI 参数与自减
          if (line.slice(i, i + 2) === '//') {
            const isColonPrefix = i > 0 && line[i - 1] === ':';
            if (!isColonPrefix) {
              out += `<span class="hl-comment">${escapeHtml(line.slice(i))}</span>`;
              break;
            }
          } else if (line[i] === '#' && (i === 0 || /\s|;/.test(line[i - 1]))) {
            out += `<span class="hl-comment">${escapeHtml(line.slice(i))}</span>`;
            break;
          }
        }
      }

      // 2. 字符串检测 (双引号 / 单引号 / 反引号)
      if (line[i] === '"' || line[i] === "'" || line[i] === '`') {
        const quote = line[i];
        let j = i + 1;
        while (j < len && line[j] !== quote) {
          if (line[j] === '\\') j++; // 跳过转义字符
          j++;
        }
        if (j < len) j++; // 包含闭合引号
        const strVal = line.slice(i, j);

        // 如果在 JSON 中，且紧跟着冒号，说明是 JSON 键名 (property)
        const rest = line.slice(j).trimStart();
        if (isJson && rest.startsWith(':')) {
          out += `<span class="hl-property">${escapeHtml(strVal)}</span>`;
        } else {
          out += `<span class="hl-string">${escapeHtml(strVal)}</span>`;
        }
        i = j;
        continue;
      }

      // 3. 数字检测 (0x..., 123, 3.14)
      if (/\d/.test(line[i]) && (i === 0 || /[\s\(\[\{,\:\+\-\*\/=<>]/.test(line[i - 1]))) {
        let j = i;
        while (j < len && /[0-9a-fA-FxX\._]/.test(line[j])) {
          j++;
        }
        out += `<span class="hl-number">${escapeHtml(line.slice(i, j))}</span>`;
        i = j;
        continue;
      }

      // 4. 标识符 / 关键字检测
      if (/[a-zA-Z_$]/.test(line[i])) {
        let j = i;
        while (j < len && /[a-zA-Z0-9_$]/.test(line[j])) {
          j++;
        }
        const word = line.slice(i, j);

        let isKw = false;
        if (isPureText) isKw = false;
        else if (isKotlin) isKw = KEYWORDS_KOTLIN.has(word);
        else if (isRust) isKw = KEYWORDS_RUST.has(word);
        else if (isPy) isKw = KEYWORDS_PYTHON.has(word);
        else isKw = KEYWORDS_ALL.has(word);

        if (isKw) {
          out += `<span class="hl-keyword">${escapeHtml(word)}</span>`;
        } else {
          // 查看后面是否跟着括号，如果是则是函数调用
          const afterWord = line.slice(j).trimStart();
          if (!isPureText && afterWord.startsWith('(')) {
            out += `<span class="hl-function">${escapeHtml(word)}</span>`;
          } else {
            out += isPureText ? escapeHtml(word) : `<span class="hl-variable">${escapeHtml(word)}</span>`;
          }
        }
        i = j;
        continue;
      }

      // 5. 符号与标点符号 (彩虹括号：根据嵌套深度区分色彩)
      const ch = line[i];
      if (ch === '{' || ch === '[' || ch === '(') {
        const d = bracketDepth % 3;
        bracketDepth++;
        out += `<span class="hl-bracket hl-bracket-${d}">${escapeHtml(ch)}</span>`;
        i++;
        continue;
      }
      if (ch === '}' || ch === ']' || ch === ')') {
        bracketDepth = Math.max(0, bracketDepth - 1);
        const d = bracketDepth % 3;
        out += `<span class="hl-bracket hl-bracket-${d}">${escapeHtml(ch)}</span>`;
        i++;
        continue;
      }

      if (/[\:\;\,]/.test(line[i])) {
        out += `<span class="hl-punct">${escapeHtml(line[i])}</span>`;
        i++;
        continue;
      }
      if (/[\=\+\-\*\/\%\&\|\^\!\<\>]/.test(line[i])) {
        out += `<span class="hl-operator">${escapeHtml(line[i])}</span>`;
        i++;
        continue;
      }

      // 普通字符
      out += escapeHtml(line[i]);
      i++;
    }

    return out;
  });

  return highlightedLines.join('\n');
}

/**
 * 一键标准化格式化代码 (支持 JSON/JSONC、规范行尾空白、统一缩进)。
 */
export function formatCodeContent(code: string, fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const isJson = ext === 'json' || fileName.endsWith('.json.example') || fileName.includes('.json');

  if (isJson) {
    // 优先尝试标准 JSON 解析与格式化
    try {
      const parsed = JSON.parse(code);
      return JSON.stringify(parsed, null, 2) + '\n';
    } catch {
      // 容错：如果是带 // 注释的 JSONC，进行安全的基于行的格式化缩进
      return formatJsonc(code);
    }
  }

  // 通用代码格式化：清理行尾多余空白，去除首尾过多的空白行，保证末尾有且仅有一个换行符
  const lines = code.split('\n').map((l) => l.trimEnd());
  // 消除连续超过 2 行的冗余空行
  const cleaned: string[] = [];
  let emptyStreak = 0;
  for (const line of lines) {
    if (!line.trim()) {
      emptyStreak++;
      if (emptyStreak <= 2) cleaned.push('');
    } else {
      emptyStreak = 0;
      cleaned.push(line);
    }
  }
  return cleaned.join('\n').trim() + '\n';
}

function formatJsonc(jsonc: string): string {
  const lines = jsonc.split('\n');
  let indentLevel = 0;
  const formatted: string[] = [];

  for (let rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      formatted.push('');
      continue;
    }

    // 如果该行以闭合括号开头，先减少当前缩进
    if (trimmed.startsWith('}') || trimmed.startsWith(']')) {
      indentLevel = Math.max(0, indentLevel - 1);
    }

    const indent = '  '.repeat(indentLevel);
    formatted.push(`${indent}${trimmed}`);

    // 计算该行带来的缩进增加
    const opens = (trimmed.match(/[\{\[]/g) || []).length;
    const closes = (trimmed.match(/[\}\]]/g) || []).length;
    const delta = opens - closes;

    if (trimmed.startsWith('}') || trimmed.startsWith(']')) {
      // 刚才已经减过了
      indentLevel = Math.max(0, indentLevel + (delta + 1));
    } else {
      indentLevel = Math.max(0, indentLevel + delta);
    }
  }

  return formatted.join('\n').trim() + '\n';
}
