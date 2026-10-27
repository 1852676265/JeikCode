import type { ImageData } from '../api';
import { userTextsMatch, visibleUserText } from './chatTerminal.ts';

export interface PendingLiveSteer {
  id: string;
  text: string;
  images?: ImageData[];
  confirmed: boolean;
}

export interface FoldedLiveSteer {
  text: string;
  images: ImageData[];
}

function sameImages(left: ImageData[] | undefined, right: ImageData[]): boolean {
  const a = left ?? [];
  if (a.length !== right.length) return false;
  return a.every((image, index) => {
    const other = right[index];
    return image.media_type === other.media_type && image.data === other.data;
  });
}

/**
 * Consume authoritative kernel steer acknowledgements in FIFO order.
 * A mismatched event may belong to another synchronized client, so it must not
 * remove locally-owned pending input.
 */
export function acknowledgeLiveSteers(
  pending: PendingLiveSteer[],
  folded: FoldedLiveSteer[],
  clientInputIds: Array<string | null> = [],
): PendingLiveSteer[] {
  const remaining = [...pending];
  for (const [index, input] of folded.entries()) {
    const clientInputId = clientInputIds[index];
    if (clientInputId) {
      const owned = remaining.findIndex((item) => item.id === clientInputId);
      if (owned >= 0) remaining.splice(owned, 1);
      continue;
    }
    const front = remaining[0];
    if (front && front.text === input.text && sameImages(front.images, input.images)) {
      remaining.shift();
    }
  }
  return remaining;
}

/** Restore unacknowledged steers to an editable draft without losing order. */
export function pendingSteersToDraft(pending: PendingLiveSteer[]): {
  text: string;
  images: ImageData[];
} {
  return {
    text: pending.map((item) => item.text).filter(Boolean).join('\n'),
    images: pending.flatMap((item) => item.images ?? []),
  };
}

export interface QueuedCardLike {
  text: string;
  images?: ImageData[];
  clientInputId?: string;
}

/**
 * 内核已 fold 的转向：从本地卡片队列删掉对应卡片（纯本地回写，不碰后端）。
 *
 * 转向卡可以“自然销毁”：用户没点任何按钮，内核在轮次边界把它并入本轮。
 * 源端会把这次消费写到 `/chat/queue`；其它实例收到广播后必须立刻从自己的缓存里
 * 删掉同一张卡，否则切过去 / 刷新时它会复活成一张还会被 drain 的待发卡片。
 *
 * 未命中任何卡片时返回原数组（调用方据此跳过存储写入）；文本按 UI 可见内容比对，
 * 因为卡片存的是用户原话，而 fold 回执带的是包了信封的运行时文本。
 */
export function dropFoldedQueuedCards<T extends QueuedCardLike>(
  queued: T[],
  folded: FoldedLiveSteer[],
  clientInputIds: Array<string | null | undefined> = [],
): T[] {
  if (queued.length === 0 || folded.length === 0) return queued;
  const remaining = queued.slice();
  for (const [index, input] of folded.entries()) {
    const clientInputId = clientInputIds[index];
    let match = clientInputId
      ? remaining.findIndex((item) => item.clientInputId === clientInputId)
      : -1;
    if (match < 0) {
      const want = visibleUserText(input.text);
      if (want) {
        match = remaining.findIndex((item) => userTextsMatch(visibleUserText(item.text), want));
      }
    }
    if (match < 0 && input.images.length > 0) {
      match = remaining.findIndex((item) => sameImages(item.images, input.images));
    }
    if (match >= 0) remaining.splice(match, 1);
  }
  return remaining.length === queued.length ? queued : remaining;
}

/**
 * 上一轮结束后仍留在队列里的 `steer`/`steering` 卡片的归属判定。
 *
 * 内核会在轮末把残留的转向缓冲落成新一轮（“自然发出”，用户气泡由 `user` 回显画出），
 * 此时卡片必须销毁；只有会话确实没重新跑、气泡也不在画布上时，才降级成普通排队卡
 * 交给 drain —— 否则本端会与内核抢同一句话，同一条回答被跑两遍。
 *
 * 没有 `steer`/`steering` 卡片时返回原数组（调用方据此跳过存储写入）。
 */
export function resolveLingeringSteers<T extends QueuedCardLike & { kind: string }>(
  queued: T[],
  running: boolean,
  isOnCanvas: (item: T) => boolean,
): T[] {
  let touched = false;
  const next = queued.flatMap((item) => {
    if (item.kind !== 'steer' && item.kind !== 'steering') return [item];
    touched = true;
    if (running || isOnCanvas(item)) return [];
    return [{ ...item, kind: 'queue' }];
  });
  return touched ? next : queued;
}
