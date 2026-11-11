import {
  isInternalHistoryUserMessage,
  stripInjectedRemindersForDisplay,
  stripSteerEnvelopeForDisplay,
} from './historyMessages.ts';

/** Token status for the turn state machine. */
export type TurnTokenStatus = 'settled' | 'in_progress' | 'pending';

export interface TurnTokenState {
  /** 轮次状态：settled 已结算, in_progress 进行中/流式中, pending 等待处理 */
  status: TurnTokenStatus;
  /** 本轮 Token 消耗量（若未开始或仍在等待则为 undefined） */
  turnTokens?: number;
  /** 截止到该轮结束或当前的累计上下文 Token */
  cumulativeTokens?: number;
  /** 缓存命中的 Token 数量（可选拓展） */
  cachedTokens?: number;
}

/** One user question in the session outline (DeepSeek-style right rail). */
export interface TurnNavItem {
  /** Stable DOM id on the user message wrapper. */
  id: string;
  /** Stable ordinal among real user questions. */
  ordinal: number;
  /** Absolute index in the raw persisted transcript, used for history loading. */
  index: number;
  /** Truncated label shown in the outline. */
  label: string;
  /** Full compacted question text for search. */
  text: string;
  /** 1-based turn number (e.g. 1, 2, 3...) */
  turn: number;
  /** Bounded prompt preview for navigation card. */
  prompt: string;
  /** Bounded response preview for navigation card. */
  response: string;
  /** True when the turn is known from the outline but its body is not yet loaded. */
  unloaded?: boolean;
  /** Tokens used in this single turn (prompt + completion + reasoning). */
  tokens?: number;
  /** Cumulative tokens from start of session up to the end of this turn. */
  cumulativeTokens?: number;
  /** 完整的轮次 Token 状态机对象 */
  tokenState?: TurnTokenState;
}

export function formatTokenMetric(num: number | undefined | null): string {
  if (num == null || num <= 0) return '0';
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 10_000) return `${(num / 1_000).toFixed(0)}k`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
  return String(num);
}

export interface ResolveTurnTokenOptions {
  item: TurnNavItem;
  isLastTurn?: boolean;
  isBusy?: boolean;
  sessionTotalTokens?: number | null;
  activeTurnDeltaTokens?: number | null;
}

/**
 * 状态机纯函数：将轮次导航项、当前活跃运行状态及会话级总量归一化为统一的 TurnTokenState。
 */
export function resolveTurnTokenState(options: ResolveTurnTokenOptions): TurnTokenState {
  const { item, isLastTurn = false, isBusy = false, sessionTotalTokens, activeTurnDeltaTokens } = options;

  // 1. 如果该轮处于活跃执行中（正在进行中/生成中/执行工具）
  if (isBusy) {
    const liveTurn =
      typeof activeTurnDeltaTokens === 'number' && activeTurnDeltaTokens > 0
        ? activeTurnDeltaTokens
        : item.tokens;
    const liveCumulative = sessionTotalTokens ?? item.cumulativeTokens;
    return {
      status: 'in_progress',
      turnTokens: liveTurn,
      cumulativeTokens: liveCumulative != null ? liveCumulative : undefined,
    };
  }

  // 2. 如果是最后一轮且尚未结算出本轮 Token
  if (isLastTurn && item.tokens == null) {
    return {
      status: 'pending',
      turnTokens: undefined,
      cumulativeTokens: sessionTotalTokens ?? item.cumulativeTokens,
    };
  }

  // 3. 常规已结算或具有估算值的轮次
  const status: TurnTokenStatus = item.tokens != null ? 'settled' : 'pending';
  return {
    status,
    turnTokens: item.tokens,
    cumulativeTokens: item.cumulativeTokens,
    cachedTokens: item.tokenState?.cachedTokens,
  };
}

const DEFAULT_MAX_LABEL = 28;

export function turnNavId(ordinal: number): string {
  return `turn-nav-${ordinal}`;
}

export function compactTurnNavText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Collapse whitespace and truncate for the outline label. */
export function truncateTurnNavLabel(text: string, max = DEFAULT_MAX_LABEL): string {
  const compact = compactTurnNavText(text);
  if (!compact) return '';
  if (compact.length <= max) return compact;
  return compact.slice(0, Math.max(1, max - 1)) + '…';
}

export interface TurnStatLike {
  turn_id?: number;
  total_tokens?: number;
  used_tokens?: number;
  round_count?: number;
  model_usage?: Array<{
    prompt_tokens?: number;
    completion_tokens?: number;
    tokens?: { input?: number; output?: number; cached_input?: number };
  }>;
}

export function buildTurnNavItemsFromOutline(
  turns: { ordinal?: number; index: number; text: string }[],
  loadedItems?: TurnNavItem[],
  turnStats?: TurnStatLike[],
): TurnNavItem[] {
  const items: TurnNavItem[] = [];
  const loadedByOrdinal = new Map(loadedItems?.map((it) => [it.ordinal, it]));
  let runningCumulativeTokens = 0;
  let prevContextTokens = 0;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    // Older sessions may not mark injected user rows as synthetic. Keep the
    // server outline aligned with the same rows history rendering suppresses.
    if (isInternalHistoryUserMessage(turn.text)) continue;
    const text = compactTurnNavText(
      stripSteerEnvelopeForDisplay(stripInjectedRemindersForDisplay(turn.text)),
    );
    const label = truncateTurnNavLabel(text);
    if (!label) continue;
    // New daemons provide an ordinal that stays stable when failed turns add
    // diagnostic rows to the raw transcript. Older daemons fall back to the
    // visible outline order, which has the same semantics.
    const ordinal = turn.ordinal ?? items.length;
    const loaded = loadedByOrdinal.get(ordinal);

    let statTokens: number | undefined;
    let statCumulative: number | undefined;
    let turnCached: number | undefined;

    if (turnStats && turnStats.length > 0) {
      // 精准匹配当前轮次统计：优先基于 turn_id 匹配，仅当 turnStats 与大纲轮次完全一对一时才按下标回退
      const stat =
        turnStats.find((s) => s.turn_id === ordinal + 1) ??
        turnStats.find((s) => s.turn_id === i + 1) ??
        (turnStats.length === turns.length ? turnStats[i] : undefined);

      if (stat) {
        const total = stat.total_tokens || stat.used_tokens || 0;
        if (total > 0) {
          statCumulative = total;
        }

        // 计算本轮消耗：优先累加本轮产生的实际模型新增计算与生成输出
        if (stat.model_usage && stat.model_usage.length > 0) {
          let roundSum = 0;
          let cachedSum = 0;
          for (const mu of stat.model_usage) {
            const outTok = mu.completion_tokens ?? mu.tokens?.output ?? 0;
            let inTok = 0;
            if (typeof mu.prompt_tokens === 'number') {
              inTok = mu.prompt_tokens;
            } else if (mu.tokens) {
              const uncachedInput = mu.tokens.input ?? 0;
              const cachedInput = mu.tokens.cached_input ?? 0;
              cachedSum += cachedInput;
              // 关键修复：在多轮工具调用（tool calls）中，cached_input 是每次请求命中的历史 KV 缓存，
              // 在几十轮工具循环中会被重复累加导致数百万的虚假膨胀（例如 40 次调用累加 5.8M）。
              // 仅在完全没有 total_tokens 且为首轮时，才将 cached_input 算入初次载入总额；
              // 正常对话及多轮工具执行中，本轮实际新增计算量严格为 uncachedInput + outTok。
              if (!total && items.length === 0) {
                inTok = uncachedInput + cachedInput;
              } else {
                inTok = uncachedInput;
              }
            }
            roundSum += inTok + outTok;
          }
          if (roundSum > 0) statTokens = roundSum;
          if (cachedSum > 0) turnCached = cachedSum;
        }

        // 首轮在具备 total_tokens 时直接以 total_tokens 作为该轮基线
        if (items.length === 0 && total > 0) {
          statTokens = total;
        } else if (!statTokens && total > 0) {
          // 后续轮次若无 model_usage 细项，取上下文净增量作为本轮消耗
          if (prevContextTokens > 0 && total >= prevContextTokens) {
            statTokens = total - prevContextTokens;
          } else {
            statTokens = total;
          }
        }

        if (total > 0) {
          prevContextTokens = total;
        }
      }
    }

    // 本轮 Token：优先使用后端精确统计，无统计时回退到消息体估算值
    const finalTokens = statTokens ?? loaded?.tokens;
    if (typeof finalTokens === 'number' && finalTokens > 0) {
      runningCumulativeTokens += finalTokens;
    }

    // 累计 Token：
    // 1. 如果有后端报告的 authoritative total_tokens (statCumulative)，优先以此为基准；
    // 2. 同时结合 runningCumulativeTokens 保证累计值单调递增且不倒挂小于单轮消耗；
    // 3. 若无 statCumulative 则回退到 runningCumulativeTokens 或 loaded?.cumulativeTokens。
    let finalCumulative = statCumulative;
    if (finalCumulative != null && finalCumulative > 0) {
      if (runningCumulativeTokens > finalCumulative) {
        finalCumulative = Math.max(finalCumulative, runningCumulativeTokens);
      }
    } else {
      finalCumulative =
        runningCumulativeTokens > 0 ? runningCumulativeTokens : loaded?.cumulativeTokens;
    }

    if (
      typeof finalTokens === 'number' &&
      typeof finalCumulative === 'number' &&
      finalCumulative < finalTokens
    ) {
      finalCumulative = finalTokens;
    }

    const status: TurnTokenStatus =
      statTokens != null || (loaded?.tokens != null && !loaded?.unloaded) ? 'settled' : 'pending';

    items.push({
      id: turnNavId(ordinal),
      ordinal,
      index: turn.index,
      label,
      text,
      turn: ordinal + 1,
      prompt: label,
      response: loaded?.response ?? '',
      unloaded: !loaded,
      tokens: finalTokens,
      cumulativeTokens: finalCumulative,
      tokenState: {
        status,
        turnTokens: finalTokens,
        cumulativeTokens: finalCumulative,
        cachedTokens: turnCached,
      },
    });
  }
  return items;
}

export function buildTurnNavItems(
  messages: {
    role: string;
    text: string;
    sourceIndex?: number;
    turnNavOrdinal?: number;
    hasImages?: boolean;
    tokens?: number;
  }[],
  windowOffset = 0,
): TurnNavItem[] {
  const items: TurnNavItem[] = [];
  let runningTotalTokens = 0;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== 'user') continue;
    let text = compactTurnNavText(
      stripSteerEnvelopeForDisplay(stripInjectedRemindersForDisplay(msg.text)),
    );
    if (!text && msg.hasImages) {
      text = '[图片]';
    }
    const label = truncateTurnNavLabel(text);
    if (!label) continue;
    // History rendering filters synthetic messages and folds tool-result rows
    // into their assistant. Prefer the raw transcript index carried through
    // conversion; the visible index is only a fallback for live/legacy data.
    const index = msg.sourceIndex ?? windowOffset + i;
    const ordinal = typeof msg.turnNavOrdinal === 'number' ? msg.turnNavOrdinal : items.length;

    // 寻找随后紧跟的 assistant 回答首段正文并累加当前 turn 的所有消息 token
    let responseText = '';
    let turnTokens = msg.tokens || 0;
    for (let j = i + 1; j < messages.length; j++) {
      if (messages[j].role === 'user') break;
      if (typeof messages[j].tokens === 'number') {
        turnTokens += messages[j].tokens!;
      }
      if (messages[j].role === 'assistant' && !responseText) {
        const full = messages[j].text?.trim() || '';
        if (full) {
          responseText = compactTurnNavText(full);
          if (responseText.length > 120) responseText = responseText.slice(0, 119) + '…';
        }
      }
    }

    runningTotalTokens += turnTokens;

    items.push({
      id: turnNavId(ordinal),
      ordinal,
      index,
      label,
      text,
      turn: ordinal + 1,
      prompt: label,
      response: responseText,
      unloaded: false,
      tokens: turnTokens > 0 ? turnTokens : undefined,
      cumulativeTokens: runningTotalTokens > 0 ? runningTotalTokens : undefined,
      tokenState: {
        status: turnTokens > 0 ? 'settled' : 'pending',
        turnTokens: turnTokens > 0 ? turnTokens : undefined,
        cumulativeTokens: runningTotalTokens > 0 ? runningTotalTokens : undefined,
      },
    });
  }
  return items;
}

/** Convert a target's viewport position into a scrollTop inside its chat root. */
export function turnNavScrollTop(
  rootScrollTop: number,
  rootViewportTop: number,
  targetViewportTop: number,
): number {
  return Math.max(0, rootScrollTop + targetViewportTop - rootViewportTop);
}

/** Case-insensitive substring filter over the full question text. */
export function filterTurnNavItems(items: TurnNavItem[], query: string): TurnNavItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((it) => it.text.toLowerCase().includes(q));
}

export interface TurnNavScrollMetrics {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

/**
 * Stable outline spy: last question whose content top is still above a
 * near-top marker. Avoids IntersectionObserver flicker between neighbours.
 * At the bottom of the thread, always the last question (its answer fills the view).
 */
export function resolveActiveTurnId(
  items: { id: string }[],
  contentTopById: (id: string) => number | undefined,
  metrics: TurnNavScrollMetrics,
  opts?: { markerOffsetPx?: number; bottomSlack?: number },
): string | null {
  if (items.length === 0) return null;
  const markerOffsetPx = opts?.markerOffsetPx ?? 24;
  const bottomSlack = opts?.bottomSlack ?? 96;
  const { scrollTop, clientHeight, scrollHeight } = metrics;
  if (scrollTop + clientHeight >= scrollHeight - bottomSlack) {
    return items[items.length - 1].id;
  }
  const marker = scrollTop + markerOffsetPx;
  let active = items[0].id;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const top = contentTopById(item.id);
    if (top == null || !Number.isFinite(top)) continue;
    if (top <= marker) {
      active = item.id;
    } else {
      // 最后一轮特殊处理：当且仅当整个线程已滚动接近底端（例如下方无多余高度无法推至视口顶部），
      // 且最后一轮问题本身已进入视口展现时，保持最后一轮激活
      if (
        i === items.length - 1 &&
        top < scrollTop + clientHeight - 40 &&
        scrollHeight - (scrollTop + clientHeight) < Math.max(bottomSlack * 2, 160)
      ) {
        active = item.id;
      }
      break;
    }
  }
  return active;
}
