import type { SessionDetail, SessionMessage, TurnStat } from '../api';

export interface ParsedTurnAnalysis {
  turnIndex: number;
  question: string;
  durationMs: number;
  durationText: string;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  roundCount: number;
  toolCallCount: number;
  toolsUsed: Array<{ name: string; count: number }>;
  hasError: boolean;
  errorMessages: string[];
  assistantSummary: string;
  userCorrectionHint?: string;
  isSlow: boolean;
  statusTag: '正常' | '耗时较长' | '执行报错' | '用户纠错';
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '< 1s';
  const sec = ms / 1000;
  if (sec < 60) {
    return `${sec.toFixed(1)}s`;
  }
  const min = Math.floor(sec / 60);
  const remSec = Math.round(sec % 60);
  return `${min}m ${remSec}s`;
}

function truncateText(str: string, maxLen = 260): string {
  const clean = str.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen) + '…';
}

/**
 * 将 SessionDetail 消息与 turn_stats 结构化拆解为逐轮执行与性能数据
 */
export function extractSessionTurnMetrics(detail: SessionDetail): ParsedTurnAnalysis[] {
  const messages = detail.messages || [];
  const turns: Array<{
    userMsg: SessionMessage;
    assistantMsgs: SessionMessage[];
    toolMsgs: SessionMessage[];
  }> = [];

  let currentTurn: {
    userMsg: SessionMessage;
    assistantMsgs: SessionMessage[];
    toolMsgs: SessionMessage[];
  } | null = null;

  for (const msg of messages) {
    if (msg.role === 'user' && !msg.synthetic) {
      if (currentTurn) {
        turns.push(currentTurn);
      }
      currentTurn = {
        userMsg: msg,
        assistantMsgs: [],
        toolMsgs: [],
      };
    } else if (currentTurn) {
      if (msg.role === 'assistant') {
        currentTurn.assistantMsgs.push(msg);
      } else if (msg.role === 'tool') {
        currentTurn.toolMsgs.push(msg);
      }
    }
  }
  if (currentTurn) {
    turns.push(currentTurn);
  }

  const turnStats = detail.turn_stats || [];
  const result: ParsedTurnAnalysis[] = [];

  for (let i = 0; i < turns.length; i++) {
    const { userMsg, assistantMsgs, toolMsgs } = turns[i];
    const stat: TurnStat | undefined = turnStats[i];

    // 1. 耗时计算
    let durationMs = 0;
    if (stat && stat.duration_ms > 0) {
      durationMs = stat.duration_ms;
    } else {
      const lastAssistant = assistantMsgs[assistantMsgs.length - 1];
      if (lastAssistant?.elapsed_ms && lastAssistant.elapsed_ms > 0) {
        durationMs = lastAssistant.elapsed_ms;
      } else if (lastAssistant?.created_at && userMsg.created_at && lastAssistant.created_at >= userMsg.created_at) {
        durationMs = lastAssistant.created_at - userMsg.created_at;
      }
    }

    // 2. Token 计算
    let totalTokens = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let cachedTokens = 0;

    if (stat && stat.total_tokens > 0) {
      totalTokens = stat.total_tokens;
      if (stat.model_usage && stat.model_usage.length > 0) {
        for (const mu of stat.model_usage) {
          promptTokens += mu.prompt_tokens || 0;
          completionTokens += mu.completion_tokens || 0;
          cachedTokens += mu.cached_tokens || 0;
        }
      }
    } else {
      // 备选估算（按中英混合字符 ~3.5 字符/token）
      const questionTokens = Math.round(userMsg.content.length / 3.5);
      const answerChars = assistantMsgs.map((m) => m.content.length).reduce((a, b) => a + b, 0);
      const answerTokens = Math.round(answerChars / 3.5);
      promptTokens = questionTokens;
      completionTokens = answerTokens;
      totalTokens = questionTokens + answerTokens;
    }

    // 3. 工具调用与报错探测
    const toolCounts: Record<string, number> = {};
    const errorMessages: string[] = [];
    let hasError = Boolean(stat?.errored);

    for (const aMsg of assistantMsgs) {
      if (aMsg.tool_calls) {
        for (const tc of aMsg.tool_calls) {
          toolCounts[tc.name] = (toolCounts[tc.name] || 0) + 1;
        }
      }
    }

    for (const tMsg of toolMsgs) {
      const tr = tMsg.tool_result;
      if (tr) {
        const isErr = tr.success === false || /error|failed|exception|not found/i.test(tr.summary || '');
        if (isErr) {
          hasError = true;
          if (tr.summary) {
            errorMessages.push(truncateText(tr.summary, 120));
          }
        }
      }
    }

    const toolsUsed = Object.entries(toolCounts).map(([name, count]) => ({ name, count }));
    const toolCallCount = stat?.tool_call_count ?? toolsUsed.reduce((sum, item) => sum + item.count, 0);
    const roundCount = stat?.round_count ?? Math.max(1, assistantMsgs.length);

    // 4. 用户纠错倾向识别（检测下一轮用户的反馈）
    let userCorrectionHint: string | undefined;
    if (i + 1 < turns.length) {
      const nextUserContent = turns[i + 1].userMsg.content.trim();
      if (/^(不|错|不对|有问题|报错|还是不行|失败|改一下|重新|bug|error|failed)/i.test(nextUserContent) ||
          /(不对|报错|运行失败|没有效果|语法错误|重新检查)/.test(nextUserContent)) {
        userCorrectionHint = truncateText(nextUserContent, 100);
      }
    }

    // 5. 状态评定（>20秒 或 >6次工具调用 视为偏慢）
    const isSlow = durationMs > 20000 || toolCallCount >= 6;
    let statusTag: ParsedTurnAnalysis['statusTag'] = '正常';
    if (hasError) {
      statusTag = '执行报错';
    } else if (userCorrectionHint) {
      statusTag = '用户纠错';
    } else if (isSlow) {
      statusTag = '耗时较长';
    }

    // 6. 最终助手回答摘要
    const lastAssistant = assistantMsgs[assistantMsgs.length - 1];
    const assistantSummary = truncateText(lastAssistant?.content || '(无文字回复)', 240);

    result.push({
      turnIndex: i + 1,
      question: truncateText(userMsg.content, 200),
      durationMs,
      durationText: formatDuration(durationMs),
      totalTokens,
      promptTokens,
      completionTokens,
      cachedTokens,
      roundCount,
      toolCallCount,
      toolsUsed,
      hasError,
      errorMessages: errorMessages.slice(0, 3),
      assistantSummary,
      userCorrectionHint,
      isSlow,
      statusTag,
    });
  }

  return result;
}

/**
 * 组装发送给 AI 进行全方位复盘的分析 Prompt
 */
export function buildSessionAnalysisPrompt(detail: SessionDetail): string {
  const metrics = extractSessionTurnMetrics(detail);
  const sessionName = detail.name || '未命名会话';
  const totalTurns = metrics.length;

  if (totalTurns === 0) {
    return `请对会话【${sessionName}】进行诊断分析。注意：该会话当前暂无有效用户提问记录。`;
  }

  const totalDurationMs = metrics.reduce((acc, cur) => acc + cur.durationMs, 0);
  const totalTokens = metrics.reduce((acc, cur) => acc + cur.totalTokens, 0);
  const slowCount = metrics.filter((m) => m.isSlow).length;
  const errorCount = metrics.filter((m) => m.hasError || m.statusTag === '执行报错' || m.statusTag === '用户纠错').length;

  const turnsText = metrics
    .map((m) => {
      const toolDetails = m.toolsUsed.length > 0
        ? m.toolsUsed.map((t) => `${t.name}×${t.count}`).join(', ')
        : '无工具调用';
      const errorNote = m.errorMessages.length > 0
        ? `\n  - ⚠️ 报错/异常信息: ${m.errorMessages.join('; ')}`
        : '';
      const correctionNote = m.userCorrectionHint
        ? `\n  - ↩️ 用户后续纠错提示: "${m.userCorrectionHint}"`
        : '';

      return `#### 轮次 ${m.turnIndex}: [${m.statusTag}]
- **用户问题**: "${m.question}"
- **单轮耗时**: ${m.durationText} (${m.durationMs}ms)
- **Token 消耗**: 总计 ${m.totalTokens.toLocaleString()} (输入: ${m.promptTokens.toLocaleString()}, 输出: ${m.completionTokens.toLocaleString()}${m.cachedTokens > 0 ? `, 缓存命中: ${m.cachedTokens.toLocaleString()}` : ''})
- **模型交互**: ${m.roundCount} 轮对话, 工具调用共 ${m.toolCallCount} 次 (${toolDetails})
- **AI 回答简要**: "${m.assistantSummary}"${errorNote}${correctionNote}`;
    })
    .join('\n\n');

  return `请针对以下已完成会话的历史执行数据进行全方位深度复盘与性能/质量专项诊断：

【目标会话名称】：${sessionName}
【会话 ID】：${detail.id}
【工作目录】：${detail.working_dir}
【总交互轮次】：${totalTurns} 轮
【总耗时统计】：${formatDuration(totalDurationMs)}
【总 Token 消耗统计】：${totalTokens.toLocaleString()} tokens
【异常概览】：偏慢轮次 ${slowCount} 个，存在报错/纠错轮次 ${errorCount} 个

---
### 每一轮真实执行与量化指标：
${turnsText}
---

请作为资深 AI 架构师与系统效能专家，根据上述真实数据，输出一份详细专业的**会话复盘与性能/质量诊断报告**，严格涵盖以下 4 个核心维度：

### 1. 📊 各问题性能指标清单（汇总表格）
请绘制完整的 Markdown 表格：
| 轮次 | 用户问题简要 | 耗时 | Token 消耗 (总计/输入/输出/缓存) | 交互轮数 & 工具调用 | 评级状态 |
并在表后简明总结整个会话的资源利用效率。

### 2. ⏱️ 慢响应深度归因分析
逐一分析耗时偏长（例如用时偏慢、超过 20 秒或多轮交互）的具体轮次：
- 是因为模型长考推理（Reasoning）耗时较长？
- 还是因为陷入了多轮连续工具调用（如反复搜索、读取大量无关大文件）？
- 亦或是执行了较耗时的编译、测试或终端命令？给出明确的瓶颈定位。

### 3. 🎯 回答质量与准确性排查（错答 / 重试 / 报错剖析）
重点复盘出现“执行报错”或“用户纠错”的问题轮次：
- 哪些问题第一次回答不准确、有瑕疵、或者出现了工具报错？
- 导致 AI 当时判断失误、误选工具或修改失败的根本原因是什么（是缺少上下文、误判了行号、还是命令不兼容）？
- 当时本应该采取怎样的更优排查策略或解法？

### 4. 💡 提效与最佳实践优化建议
基于本会话暴露出的瓶颈与错误模式，给出 2~3 条高度可操作的改进建议（包括开发者后续更精准的提问姿势、项目规则/指令配置优化，以及如何降低不必要的 Token 消耗与往返轮次）。`;
}
