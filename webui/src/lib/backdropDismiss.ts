// 遮罩层「点击空白处关闭」的根因修复。
//
// 浏览器原生 click 事件的目标节点，是 mousedown 与 mouseup 目标节点的「最近公共祖先」。
// 因此当用户在弹窗内容里按下鼠标、拖拽划词（鼠标左键按住左滑选中文本）后松开时，
// 若松手位置落在遮罩空白处，click 会被派发到遮罩 overlay 自身上，
// `e.target === e.currentTarget` 成立，弹窗被误判为「点击了外部」而瞬间关闭——
// 这正是各类模型选择 / 弹窗输入框里划词即秒关的根因。
//
// 修复思路：只有「按下的起点」与「松开的终点」都落在遮罩本身（即真正点在空白处）
// 才触发关闭；任何从弹窗内容起手的拖拽划词都不会误关，同时保留点击遮罩关闭的原生交互。

import { useRef } from 'preact/hooks';

/**
 * 判定一次 click 是否属于「点击遮罩空白处」。
 * 抽成纯函数，便于脱离 DOM 做单元测试。
 */
export function isBackdropDismiss(
  pressedOnBackdrop: boolean,
  target: EventTarget | null,
  currentTarget: EventTarget | null,
): boolean {
  return pressedOnBackdrop && target != null && target === currentTarget;
}

export interface BackdropDismissOptions {
  /**
   * 为 true 时在 mousedown 阶段阻止冒泡，避免按下遮罩/弹窗时惊扰其它
   * document 级 mousedown 监听（如各处下拉菜单的外部点击关闭）。
   */
  stopPropagation?: boolean;
}

/**
 * 给 `.modal-overlay` 这类遮罩元素挂载「点击空白处关闭」行为。
 *
 * 用法：`<div class="modal-overlay" {...useBackdropDismiss(() => setOpen(false))}>`
 */
export function useBackdropDismiss(
  onClose: () => void,
  options: BackdropDismissOptions = {},
) {
  const pressedOnBackdrop = useRef(false);

  return {
    onPointerDown: (e: PointerEvent) => {
      pressedOnBackdrop.current = e.target === e.currentTarget;
    },
    onMouseDown: (e: MouseEvent) => {
      pressedOnBackdrop.current = e.target === e.currentTarget;
      if (options.stopPropagation) e.stopPropagation();
    },
    onClick: (e: MouseEvent) => {
      const dismiss = isBackdropDismiss(pressedOnBackdrop.current, e.target, e.currentTarget);
      pressedOnBackdrop.current = false;
      if (dismiss) onClose();
    },
  };
}
