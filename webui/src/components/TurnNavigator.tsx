import { memo } from 'preact/compat';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import { useT } from '../settings';
import type { TurnNavItem } from '../lib/turnNav';
import { formatTokenMetric } from '../lib/turnNav';

export interface TurnNavigatorProps {
  readonly items: readonly TurnNavItem[];
  readonly activeId: string | null;
  readonly busyId?: string | null;
  readonly sessionTotalTokens?: number | null;
  readonly onNavigate: (item: TurnNavItem) => void;
}

/** 标记点间固定间距 (px) */
const TURN_SPACING_PX = 10;
/** 顶端和底端边缘留白 (px) */
const RAIL_INSET_PX = 6;

export const TurnNavigator = memo(function TurnNavigator({
  items,
  activeId,
  busyId,
  sessionTotalTokens,
  onNavigate,
}: TurnNavigatorProps) {
  const t = useT();
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const pointerInsideRef = useRef(false);
  const previewId = useId();

  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(0);

  const activeIndex = useMemo(() => {
    if (!activeId) return -1;
    return items.findIndex((it) => it.id === activeId);
  }, [items, activeId]);

  const handleScroll = useCallback(() => {
    if (!scrollerRef.current) return;
    setScrollTop(scrollerRef.current.scrollTop);
  }, []);

  // 监听容器高度与滚动位置
  useEffect(() => {
    if (!scrollerRef.current) return;
    const updateSize = () => {
      if (scrollerRef.current) {
        setViewHeight(scrollerRef.current.clientHeight);
        setScrollTop(scrollerRef.current.scrollTop);
      }
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(scrollerRef.current);
    return () => observer.disconnect();
  }, [items.length]);

  // 当外部滚动切换 activeTurn 时，若标记点在可视区域外则平滑滚入视野（指针悬浮交互时不强夺滚动）
  useEffect(() => {
    if (activeIndex === -1 || pointerInsideRef.current || !scrollerRef.current) return;
    const scroller = scrollerRef.current;
    const height = scroller.clientHeight;
    if (height <= 0) return;
    const center = activeIndex * TURN_SPACING_PX + RAIL_INSET_PX;
    const current = scroller.scrollTop;
    if (center < current + 20 || center > current + height - 20) {
      const target = Math.max(0, center - height / 2);
      scroller.scrollTo({ top: target, behavior: 'smooth' });
    }
  }, [activeIndex]);

  // 对话轮次少于 2 轮时不渲染导航轨道（与 deepseek-harness 严格一致）
  if (items.length < 2) return null;

  const totalHeight = items.length * TURN_SPACING_PX + RAIL_INSET_PX * 2;
  const canScrollTop = scrollTop > 1;
  const canScrollBottom = scrollTop < totalHeight - viewHeight - 1;

  const fadeClasses = ['turn-navigator-scroller'];
  if (canScrollTop && canScrollBottom) {
    fadeClasses.push('fade-both');
  } else if (canScrollTop) {
    fadeClasses.push('fade-top');
  } else if (canScrollBottom) {
    fadeClasses.push('fade-bottom');
  }

  const preview = previewIndex !== null && previewIndex >= 0 && previewIndex < items.length
    ? items[previewIndex]
    : undefined;

  const previewCenterY = previewIndex !== null
    ? previewIndex * TURN_SPACING_PX + RAIL_INSET_PX - scrollTop
    : 0;

  return (
    <div class="turn-navigator-slot">
      <nav
        class="turn-navigator-frame"
        aria-label={t('chat.turnNavigation.label')}
        onPointerEnter={() => {
          pointerInsideRef.current = true;
        }}
        onPointerLeave={() => {
          pointerInsideRef.current = false;
          setPreviewIndex(null);
        }}
      >
        <div
          ref={scrollerRef}
          class={fadeClasses.join(' ')}
          onScroll={handleScroll}
        >
          <div
            class="turn-navigator-marks"
            style={{ height: `${totalHeight}px` }}
          >
            {items.map((item, index) => {
              const active = item.id === activeId || index === activeIndex;
              const busy = item.id === busyId;
              const isPreview = index === previewIndex;

              const markClasses = ['turn-navigator-mark'];
              if (item.unloaded) markClasses.push('turn-mark-unloaded');
              if (active) markClasses.push('turn-mark-active');
              else if (isPreview) markClasses.push('turn-mark-preview');
              if (busy) markClasses.push('turn-mark-busy');

              return (
                <button
                  key={item.id}
                  type="button"
                  class={markClasses.join(' ')}
                  style={{ top: `${index * TURN_SPACING_PX + RAIL_INSET_PX - 5}px` }}
                  aria-label={t(
                    item.unloaded ? 'chat.turnNavigation.jumpLoad' : 'chat.turnNavigation.jump',
                    { turn: String(item.turn) },
                  )}
                  aria-current={active ? 'true' : undefined}
                  aria-busy={busy ? 'true' : undefined}
                  aria-describedby={isPreview ? previewId : undefined}
                  onPointerMove={() => setPreviewIndex(index)}
                  onFocus={() => setPreviewIndex(index)}
                  onBlur={() => setPreviewIndex(null)}
                  onClick={() => onNavigate(item)}
                />
              );
            })}
          </div>
        </div>

        {preview && (() => {
          const isLastTurn = previewIndex === items.length - 1;
          const turnTokens = preview.tokens;
          const cumulativeTokens =
            preview.cumulativeTokens ?? (isLastTurn ? (sessionTotalTokens ?? undefined) : undefined);
          const hasTokens = turnTokens != null || cumulativeTokens != null;

          return (
            <div
              id={previewId}
              role="tooltip"
              class="turn-navigator-preview"
              style={{
                '--turn-preview-center': `${previewCenterY}px`,
              } as any}
            >
              <div class="turn-navigator-preview-header">
                <span class="turn-navigator-preview-turn">
                  {t('chat.turnNavigation.turn', { turn: String(preview.turn) })}
                </span>
                {hasTokens && (
                  <span class="turn-navigator-preview-tokens" title={t('chat.turnNavigation.tokensTooltip')}>
                    <span class="turn-tokens-icon">⚡</span>
                    {turnTokens != null && cumulativeTokens != null && turnTokens !== cumulativeTokens ? (
                      <>
                        <span class="turn-tokens-val">
                          {t('chat.turnNavigation.turnPrefix')}{formatTokenMetric(turnTokens)}
                        </span>
                        <span class="turn-tokens-total">
                          ({t('chat.turnNavigation.totalPrefix')}{formatTokenMetric(cumulativeTokens)})
                        </span>
                      </>
                    ) : (
                      <span class="turn-tokens-val">
                        {t('chat.turnNavigation.turnPrefix')}{formatTokenMetric(turnTokens ?? cumulativeTokens)}
                      </span>
                    )}
                  </span>
                )}
              </div>
              <div class="turn-navigator-preview-prompt">
                {preview.prompt || t('chat.turnNavigation.turn', { turn: String(preview.turn) })}
              </div>
            </div>
          );
        })()}
      </nav>
    </div>
  );
});
