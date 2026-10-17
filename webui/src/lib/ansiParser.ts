/**
 * 现代终端 ANSI SGR (Select Graphic Rendition) 彩色与样式解析引擎。
 * 支持 ANSI 16 色、256 色、24 位 RGB 真彩色、粗体、暗淡、下划线及样式重置。
 * 能够完美匹配 Claude Code、JeikCode CLI、OpenCode 等现代 Agent CLI 丰富的色彩输出。
 */

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const ANSI_16_COLORS: Record<number, string> = {
  30: 'var(--ansi-black, #282c34)',
  31: 'var(--ansi-red, #f87171)',
  32: 'var(--ansi-green, #4ade80)',
  33: 'var(--ansi-yellow, #fbbf24)',
  34: 'var(--ansi-blue, #60a5fa)',
  35: 'var(--ansi-magenta, #c084fc)',
  36: 'var(--ansi-cyan, #38bdf8)',
  37: 'var(--ansi-white, #f3f4f6)',
  90: 'var(--ansi-bright-black, #6b7280)',
  91: 'var(--ansi-red, #f87171)',
  92: 'var(--ansi-green, #4ade80)',
  93: 'var(--ansi-yellow, #fbbf24)',
  94: 'var(--ansi-blue, #60a5fa)',
  95: 'var(--ansi-magenta, #c084fc)',
  96: 'var(--ansi-cyan, #38bdf8)',
  97: 'var(--ansi-white, #f3f4f6)',
};

const ANSI_16_BG_COLORS: Record<number, string> = {
  40: '#282c34',
  41: 'rgba(224, 108, 117, 0.25)',
  42: 'rgba(152, 195, 121, 0.25)',
  43: 'rgba(229, 192, 123, 0.25)',
  44: 'rgba(97, 175, 239, 0.25)',
  45: 'rgba(198, 120, 221, 0.25)',
  46: 'rgba(86, 182, 194, 0.25)',
  47: 'rgba(171, 178, 191, 0.25)',
  100: 'rgba(92, 99, 112, 0.3)',
};

/**
 * 256 色转 16 进制 RGB
 */
function get256Color(index: number): string {
  if (index < 16) {
    if (index === 0) return '#000000';
    if (index === 1) return '#cd3131';
    if (index === 2) return '#0dbc79';
    if (index === 3) return '#e5e510';
    if (index === 4) return '#2472c8';
    if (index === 5) return '#bc3fbc';
    if (index === 6) return '#11a8cd';
    if (index === 7) return '#e5e5e5';
    if (index === 8) return '#666666';
    if (index === 9) return '#f14c4c';
    if (index === 10) return '#23d18b';
    if (index === 11) return '#f5f543';
    if (index === 12) return '#3b8eea';
    if (index === 13) return '#d670d6';
    if (index === 14) return '#29b8db';
    return '#ffffff';
  }
  if (index >= 232) {
    // 灰阶 232 - 255
    const gray = Math.round(((index - 232) / 23) * 255);
    return `rgb(${gray},${gray},${gray})`;
  }
  // 6x6x6 颜色立方体 16 - 231
  const code = index - 16;
  const b = code % 6;
  const g = Math.floor(code / 6) % 6;
  const r = Math.floor(code / 36);
  const conv = (n: number) => (n === 0 ? 0 : 55 + n * 40);
  return `rgb(${conv(r)},${conv(g)},${conv(b)})`;
}

/**
 * 将含有 ANSI 转义序列的终端文本解析转换为带 CSS 样式的 HTML。
 */
export function ansiToHtml(raw: string): string {
  // 快速路径：如果不包含转义字符，直接高亮命令前缀
  if (!raw.includes('\x1b') && !raw.includes('\u001b')) {
    return formatSpecialTerminalLines(escapeHtml(raw));
  }

  // 清除非渲染的光标移动与屏幕清除序列（如 \x1b[2J, \x1b[?25h 等）
  const clean = raw
    .replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\[[0-9;]*[ABCDEFGHJKSTf]/g, '');

  let out = '';
  let fgColor: string | null = null;
  let bgColor: string | null = null;
  let bold = false;
  let italic = false;
  let underline = false;
  let dim = false;

  const regex = /\x1b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;

  const buildStyle = (): string => {
    const styles: string[] = [];
    if (fgColor) styles.push(`color:${fgColor}`);
    if (bgColor) styles.push(`background-color:${bgColor}`);
    if (bold) styles.push('font-weight:bold');
    if (italic) styles.push('font-style:italic');
    if (underline) styles.push('text-decoration:underline');
    if (dim) styles.push('opacity:0.65');
    return styles.join(';');
  };

  while ((match = regex.exec(clean)) !== null) {
    const textPart = clean.slice(lastIndex, match.index);
    if (textPart) {
      const style = buildStyle();
      if (style) {
        out += `<span style="${style}">${escapeHtml(textPart)}</span>`;
      } else {
        out += escapeHtml(textPart);
      }
    }

    lastIndex = regex.lastIndex;
    const codes = (match[1] || '0')
      .split(';')
      .map((n) => parseInt(n, 10))
      .filter((n) => !isNaN(n));

    let cIdx = 0;
    while (cIdx < codes.length) {
      const c = codes[cIdx];
      if (c === 0) {
        // 重置
        fgColor = null;
        bgColor = null;
        bold = false;
        italic = false;
        underline = false;
        dim = false;
      } else if (c === 1) {
        bold = true;
      } else if (c === 2) {
        dim = true;
      } else if (c === 3) {
        italic = true;
      } else if (c === 4) {
        underline = true;
      } else if (c === 22) {
        bold = false;
        dim = false;
      } else if (c === 23) {
        italic = false;
      } else if (c === 24) {
        underline = false;
      } else if (ANSI_16_COLORS[c]) {
        fgColor = ANSI_16_COLORS[c];
      } else if (c === 39) {
        fgColor = null; // 默认前景色
      } else if (ANSI_16_BG_COLORS[c]) {
        bgColor = ANSI_16_BG_COLORS[c];
      } else if (c === 49) {
        bgColor = null; // 默认背景色
      } else if (c === 38 || c === 48) {
        // 扩展色彩
        const isBg = c === 48;
        if (codes[cIdx + 1] === 5 && codes[cIdx + 2] !== undefined) {
          // 256 色: 38;5;N
          const color256 = get256Color(codes[cIdx + 2]);
          if (isBg) bgColor = color256;
          else fgColor = color256;
          cIdx += 2;
        } else if (
          codes[cIdx + 1] === 2 &&
          codes[cIdx + 2] !== undefined &&
          codes[cIdx + 3] !== undefined &&
          codes[cIdx + 4] !== undefined
        ) {
          // 24 位真彩色 RGB: 38;2;R;G;B
          const rgbColor = `rgb(${codes[cIdx + 2]},${codes[cIdx + 3]},${codes[cIdx + 4]})`;
          if (isBg) bgColor = rgbColor;
          else fgColor = rgbColor;
          cIdx += 4;
        }
      }
      cIdx++;
    }
  }

  // 拼接末尾文本
  const remaining = clean.slice(lastIndex);
  if (remaining) {
    const style = buildStyle();
    if (style) {
      out += `<span style="${style}">${escapeHtml(remaining)}</span>`;
    } else {
      out += escapeHtml(remaining);
    }
  }

  return formatSpecialTerminalLines(out);
}

/**
 * 增强命令行提示符与状态标识（对齐现代终端）
 */
function formatSpecialTerminalLines(html: string): string {
  // PowerShell / Bash 提示行高亮美化
  if (html.startsWith('PS ') && html.includes('&gt;')) {
    const parts = html.split('&gt;', 2);
    return `<span class="term-prompt">${parts[0]}&gt;</span><span class="term-cmd">${parts[1] || ''}</span>`;
  }
  if (html.startsWith('[terminal] Executed:')) {
    return `<span class="term-badge">[terminal]</span> <span class="term-executed-cmd">${html.slice(20)}</span>`;
  }
  return html;
}
