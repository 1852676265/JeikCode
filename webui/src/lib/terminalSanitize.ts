// 终端输出回放清理、协议应答识别与 Shell 就绪检测辅助工具

const GREETING_PREFIX_RE =
  /^\x1b\[32m\[Zap Terminal:[^\r\n]*\r?\nActive workspace:[^\r\n]*\r?\nReady\.\r?\n\r?\n/;

const REPLAY_QUERY_RE =
  /\x1b\[(?:\??[0-9;]*n|[>=]?0*c|\??[0-9;]*\$p|(?:11|13|14|16|18|19|20|21)(?:;[0-9]+)*t)|\x1b\](?:4;\d+|10|11|12|17|19);\?(?:\x07|\x1b\\)/g;

const LIVE_DSR_QUERY_RE = /\x1b\[\??6n/;

const PROTOCOL_REPLY_RE =
  /^(?:\x1b\[\??\d+;\d+R|\x1b\[[?>=][\d;]*c|\x1b\[\??\d+;\d+\$y|\x1b\[0n|\x1b\[[IO])$/;

const COLUMN_ONE_CPR_RE = /^\x1b\[\??\d+;1R$/;

const ANSI_OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const ANSI_CSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const ANSI_ESC_RE = /\x1b[@-Z\\-_]/g;
const PROMPT_LINE_END_RE = /[>$#%\u276f\u279c\u00bb]\s*$/;

/**
 * 剥离终端历史快照中的设备/光标查询序列（如 `\x1b[6n`、`\x1b[c` 等）。
 * 若在回放时保留这些查询，`xterm.js` 会向仍在运行的 ConPTY 发回 `\x1b[<row>;1R`，
 * ConPTY 会将列号为 1 的 CPR 解析为 `VK_F3`，导致 PowerShell PSReadLine
 * 进入 `CharacterSearch` 并静默吞掉下一条命令的首字符。
 */
export function stripTerminalQueries(text: string): string {
  if (!text) return text;
  return text.replace(REPLAY_QUERY_RE, '');
}

/**
 * 处理 `/terminal/ws` 收到的首帧纯文本数据：
 * - 若包含历史命令输出或在 `\x1b[6n` 后已有后续输出，说明属于历史快照重放，清理所有查询序列；
 * - 若仅在全新启动末尾带有尚未应答的单个 `\x1b[6n`，放行一次供后端 ConPTY 完成继承光标握手。
 */
export function sanitizeInitialFrame(
  raw: string,
  alreadyAnsweredStartupProbe: boolean
): { text: string; isReplay: boolean; hasLiveDsr: boolean } {
  if (!raw) {
    return { text: raw, isReplay: false, hasLiveDsr: false };
  }
  const afterGreeting = raw.replace(GREETING_PREFIX_RE, '');
  const dsrMatch = /\x1b\[\??6n/g;
  let lastDsrEnd = -1;
  let match: RegExpExecArray | null;
  while ((match = dsrMatch.exec(afterGreeting)) !== null) {
    lastDsrEnd = match.index + match[0].length;
  }

  // 已应答过启动探测，或末尾查询后已有后续输出（说明是已运行会话的历史快照）
  if (alreadyAnsweredStartupProbe || (lastDsrEnd >= 0 && lastDsrEnd < afterGreeting.length)) {
    return {
      text: stripTerminalQueries(raw),
      isReplay: true,
      hasLiveDsr: false,
    };
  }

  // 刚启动且末尾正好停在 `\x1b[6n` 等待应答
  if (lastDsrEnd >= 0 && lastDsrEnd === afterGreeting.length) {
    const prefix = raw.slice(0, raw.length - (afterGreeting.length - (lastDsrEnd - 4)));
    // 只保留最后一个实时 `\x1b[6n`，前面部分仍清理潜在历史查询
    const dsrToken = afterGreeting.slice(
      afterGreeting.lastIndexOf('\x1b['),
      lastDsrEnd
    );
    const beforeToken = raw.slice(0, raw.length - dsrToken.length);
    return {
      text: stripTerminalQueries(beforeToken) + dsrToken,
      isReplay: false,
      hasLiveDsr: true,
    };
  }

  // 首帧没有 `\x1b[6n`，但已有非空输出（例如已启动的终端快照）
  const hasHistoricalBody = afterGreeting.length > 0;
  return {
    text: stripTerminalQueries(raw),
    isReplay: hasHistoricalBody,
    hasLiveDsr: false,
  };
}

export function hasLiveDsrQuery(text: string): boolean {
  return LIVE_DSR_QUERY_RE.test(text);
}

export function isTerminalProtocolReply(data: string): boolean {
  return PROTOCOL_REPLY_RE.test(data);
}

export function isColumnOneCursorReport(data: string): boolean {
  return COLUMN_ONE_CPR_RE.test(data);
}

/**
 * 检测 PTY 输出中是否已经出现交互式 Shell 提示符（如 PowerShell `PS ...>`、bash `$` 等），
 * 排除后端初始欢迎语 `[Zap Terminal: ...]\r\nActive workspace: ...\r\nReady.`。
 */
export function hasShellPromptOutput(text: string): boolean {
  if (!text) return false;
  const body = text.replace(GREETING_PREFIX_RE, '');
  if (!body) return false;
  const plain = body
    .replace(ANSI_OSC_RE, '')
    .replace(ANSI_CSI_RE, '')
    .replace(ANSI_ESC_RE, '');
  const lines = plain.split(/[\r\n]+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return false;
  const last = lines[lines.length - 1];
  if (last.startsWith('[Zap Terminal:') || last.startsWith('Active workspace:') || last === 'Ready.') {
    return false;
  }
  return PROMPT_LINE_END_RE.test(last);
}
