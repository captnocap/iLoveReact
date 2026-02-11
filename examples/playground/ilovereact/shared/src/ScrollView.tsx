/**
 * ScrollView -- scrollable container primitive
 *
 * In web mode:   renders as a <div> with overflow:auto/scroll and CSS styling
 * In native mode: renders as a string-typed 'View' host element with
 *                 overflow:'scroll' -- the Lua side handles scissor clipping,
 *                 scroll translation, scrollbar indicators, and wheel events.
 *
 * Supports both vertical (default) and horizontal scrolling.
 * Exposes an imperative scrollTo() method via React.forwardRef.
 */

import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useCallback,
  useEffect,
} from 'react';
import { useRendererMode } from './context';
import { styleToCSS, colorToCSS } from './primitives';
import type {
  ScrollViewProps,
  ScrollViewRef,
  ScrollEvent,
  Style,
} from './types';

// ── Scroll-end debounce delay (ms) ─────────────────────
const SCROLL_END_DELAY = 150;

// ── Web mode ScrollView ─────────────────────────────────

const WebScrollView = forwardRef<ScrollViewRef, ScrollViewProps>(
  function WebScrollView(
    {
      style,
      horizontal = false,
      showScrollIndicator = true,
      onScroll,
      onScrollBegin,
      onScrollEnd,
      children,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const isScrollingRef = useRef(false);
    const scrollEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useImperativeHandle(ref, () => ({
      scrollTo({ x, y, animated }) {
        const el = containerRef.current;
        if (!el) return;
        el.scrollTo({
          left: x ?? el.scrollLeft,
          top: y ?? el.scrollTop,
          behavior: animated ? 'smooth' : 'instant',
        });
      },
    }));

    const handleScroll = useCallback(() => {
      const el = containerRef.current;
      if (!el) return;

      if (!isScrollingRef.current) {
        isScrollingRef.current = true;
        onScrollBegin?.();
      }

      if (onScroll) {
        const event: ScrollEvent = {
          scrollX: el.scrollLeft,
          scrollY: el.scrollTop,
          contentWidth: el.scrollWidth,
          contentHeight: el.scrollHeight,
        };
        onScroll(event);
      }

      // Debounce scroll-end detection
      if (scrollEndTimerRef.current !== null) {
        clearTimeout(scrollEndTimerRef.current);
      }
      scrollEndTimerRef.current = setTimeout(() => {
        isScrollingRef.current = false;
        scrollEndTimerRef.current = null;
        onScrollEnd?.();
      }, SCROLL_END_DELAY);
    }, [onScroll, onScrollBegin, onScrollEnd]);

    // Clean up timer on unmount
    useEffect(() => {
      return () => {
        if (scrollEndTimerRef.current !== null) {
          clearTimeout(scrollEndTimerRef.current);
        }
      };
    }, []);

    // Build the merged style. The user's style forms the base, and we layer
    // scroll-specific CSS on top.
    const mergedStyle: Style = {
      ...(style || {}),
      overflow: 'scroll',
    };

    // For horizontal scrolling, default flexDirection to 'row'
    if (horizontal && !mergedStyle.flexDirection) {
      mergedStyle.flexDirection = 'row';
    }

    const css = styleToCSS(mergedStyle);

    // Override overflow to the appropriate CSS value.
    // The styleToCSS helper maps 'scroll' literally, but we want directional
    // overflow control for web.
    if (horizontal) {
      css.overflowX = 'auto';
      css.overflowY = 'hidden';
    } else {
      css.overflowX = 'hidden';
      css.overflowY = 'auto';
    }

    // Hide native scrollbar when showScrollIndicator is false
    if (!showScrollIndicator) {
      // Webkit/Blink and Firefox handle scrollbar hiding differently.
      // We use a combination that covers modern browsers.
      css.scrollbarWidth = 'none'; // Firefox
      // For Webkit/Blink, we inject a className-based approach below,
      // but inline styles cannot target pseudo-elements. We use msOverflowStyle
      // for legacy IE/Edge and rely on the scrollbarWidth property for others.
      (css as any).msOverflowStyle = 'none'; // Legacy Edge/IE
    }

    css.userSelect = 'none';

    return (
      <div ref={containerRef} style={css} onScroll={handleScroll}>
        {children}
      </div>
    );
  }
);

// ── Native mode ScrollView ──────────────────────────────

const NativeScrollView = forwardRef<ScrollViewRef, ScrollViewProps>(
  function NativeScrollView(
    {
      style,
      horizontal = false,
      showScrollIndicator = true,
      onScroll,
      onScrollBegin,
      onScrollEnd,
      children,
    },
    ref
  ) {
    // In native mode, scroll position is managed by the Lua layout engine.
    // We store a local scroll target for the imperative scrollTo() API
    // and pass it via style.scrollX / style.scrollY so the Lua layout
    // picks it up as controlled scroll values.
    const scrollStateRef = useRef({ x: 0, y: 0 });

    useImperativeHandle(ref, () => ({
      scrollTo({ x, y }) {
        // Update local state. The Lua side reads scrollX/scrollY from style
        // props on every layout pass, so the next render cycle will apply them.
        if (x !== undefined) scrollStateRef.current.x = x;
        if (y !== undefined) scrollStateRef.current.y = y;
      },
    }));

    const mergedStyle: Style = {
      ...(style || {}),
      overflow: 'scroll',
    };

    // For horizontal scrolling, default flexDirection to 'row'
    if (horizontal && !mergedStyle.flexDirection) {
      mergedStyle.flexDirection = 'row';
    }

    // Pass through scroll position from imperative API
    if (scrollStateRef.current.x !== 0) {
      mergedStyle.scrollX = scrollStateRef.current.x;
    }
    if (scrollStateRef.current.y !== 0) {
      mergedStyle.scrollY = scrollStateRef.current.y;
    }

    return React.createElement(
      'View',
      {
        style: mergedStyle,
        showScrollIndicator,
        onScroll,
        onScrollBegin,
        onScrollEnd,
      },
      children
    );
  }
);

// ── Dual-mode ScrollView ────────────────────────────────

export const ScrollView = forwardRef<ScrollViewRef, ScrollViewProps>(
  function ScrollView(props, ref) {
    const mode = useRendererMode();
    if (mode === 'web') {
      return <WebScrollView ref={ref} {...props} />;
    }
    return <NativeScrollView ref={ref} {...props} />;
  }
);
