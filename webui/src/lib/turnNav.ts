import {
  isInternalHistoryUserMessage,
  stripInjectedRemindersForDisplay,
  stripSteerEnvelopeForDisplay,
} from './historyMessages.ts';

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
}

export function formatTokenMetric(num: number | undefined | null): string {
  if (num == null || num <= 0) return '0';
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 10_000) return `${(num / 1_000).toFixed(0)}k`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
  return String(num);
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

    if (turnStats && turnStats.length > 0) {
      const stat =
        turnStats.find((s) => s.turn_id === ordinal + 1) ??
        turnStats.find((s) => s.turn_id === i + 1) ??
        turnStats[ordinal] ??
        turnStats[i];

      if (stat) {
        const total = stat.total_tokens || stat.used_tokens || 0;
        if (total > 0) {
          statCumulative = total;
          if (stat.model_usage && stat.model_usage.length > 0) {
            let roundSum = 0;
            for (const mu of stat.model_usage) {
              const inTok = mu.prompt_tokens ?? mu.tokens?.input ?? 0;
              const outTok = mu.completion_tokens ?? mu.tokens?.output ?? 0;
              roundSum += inTok + outTok;
            }
            if (roundSum > 0) statTokens = roundSum;
          }
          if (!statTokens && prevContextTokens > 0 && total >= prevContextTokens) {
            statTokens = total - prevContextTokens;
          } else if (!statTokens && prevContextTokens === 0) {
            statTokens = total;
          }
          prevContextTokens = total;
        }
      }
    }

    const finalTokens = statTokens ?? loaded?.tokens;
    const finalCumulative = statCumulative ?? loaded?.cumulativeTokens;

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
  const bottomSlack = opts?.bottomSlack ?? 32;
  const { scrollTop, clientHeight, scrollHeight } = metrics;
  if (scrollTop + clientHeight >= scrollHeight - bottomSlack) {
    return items[items.length - 1].id;
  }
  const marker = scrollTop + markerOffsetPx;
  let active = items[0].id;
  for (const item of items) {
    const top = contentTopById(item.id);
    if (top == null || !Number.isFinite(top)) continue;
    if (top <= marker) active = item.id;
    else break;
  }
  return active;
}
