// SplitDivider — draggable resize handle for adjacent flex panes.
//
// Smooth-drag implementation ported from cart/deadcode/sweatshop/
// components/editor-split/SplitDivider.tsx. The deadcode version was
// the right pattern; this is the live theme'd port.
//
// Pattern:
//   - onMouseDown begins a drag
//   - rAF loop reads getMouseX/Y/Down each frame, computes delta,
//     calls onResize(delta * 0.01) so the parent rebalances weights
//   - rAF loop self-terminates when mouse-up is detected
//
// Why the rAF loop instead of a system:cursor:move bus subscription:
// the bus fires per move event but doesn't carry button state, so
// release detection still needs polling. One rAF that polls position
// AND button each frame collapses both into a single per-frame tick.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable } from '@reactjit/runtime/primitives';

const host: any = globalThis as any;

function readMouseX(): number {
  try {
    const fn = host.getMouseX;
    if (typeof fn !== 'function') return 0;
    const v = Number(fn());
    return Number.isFinite(v) ? v : 0;
  } catch { return 0; }
}

function readMouseY(): number {
  try {
    const fn = host.getMouseY;
    if (typeof fn !== 'function') return 0;
    const v = Number(fn());
    return Number.isFinite(v) ? v : 0;
  } catch { return 0; }
}

function readMouseDown(): boolean {
  try {
    const fn = host.getMouseDown;
    if (typeof fn !== 'function') return false;
    return !!fn();
  } catch { return false; }
}

interface SplitDividerProps {
  direction: 'horizontal' | 'vertical';
  thickness?: number;
  /** Called per frame during drag with the cursor delta in pixels.
   *  Parent should convert to a weight change with whatever scale it
   *  prefers (the deadcode pattern uses delta * 0.01). */
  onResize: (delta: number) => void;
}

export function SplitDivider({ direction, thickness = 4, onResize }: SplitDividerProps) {
  const [dragging, setDragging] = useState(false);
  const activeRef = useRef(false);
  const frameRef = useRef<any>(null);
  const lastRef = useRef(0);

  const stopLoop = useCallback(() => {
    if (frameRef.current != null) {
      const cancel = typeof host.cancelAnimationFrame === 'function'
        ? host.cancelAnimationFrame.bind(host)
        : null;
      if (cancel) cancel(frameRef.current);
      else clearTimeout(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    if (!activeRef.current) return;
    if (!readMouseDown()) {
      activeRef.current = false;
      setDragging(false);
      stopLoop();
      return;
    }
    const cur = direction === 'horizontal' ? readMouseX() : readMouseY();
    const delta = cur - lastRef.current;
    if (delta !== 0) onResize(delta);
    lastRef.current = cur;
    const raf = typeof host.requestAnimationFrame === 'function'
      ? host.requestAnimationFrame.bind(host)
      : null;
    frameRef.current = raf ? raf(tick) : setTimeout(tick, 16);
  }, [direction, onResize, stopLoop]);

  const begin = useCallback(() => {
    lastRef.current = direction === 'horizontal' ? readMouseX() : readMouseY();
    activeRef.current = true;
    setDragging(true);
    stopLoop();
    const raf = typeof host.requestAnimationFrame === 'function'
      ? host.requestAnimationFrame.bind(host)
      : null;
    frameRef.current = raf ? raf(tick) : setTimeout(tick, 16);
  }, [direction, stopLoop, tick]);

  useEffect(() => () => {
    activeRef.current = false;
    stopLoop();
  }, [stopLoop]);

  // 12px hit zone, 4px visual stripe centered. Wider invisible target
  // makes the handle easy to grab without making the rule line look heavy.
  const isHorizontal = direction === 'horizontal';
  const hitWidth = isHorizontal ? 12 : '100%';
  const hitHeight = isHorizontal ? '100%' : 12;

  return (
    <Pressable
      onMouseDown={begin}
      style={{
        [isHorizontal ? 'width' : 'height']: hitWidth as any,
        [isHorizontal ? 'height' : 'width']: hitHeight as any,
        flexShrink: 0,
        cursor: isHorizontal ? 'col-resize' : 'row-resize',
        backgroundColor: dragging ? 'theme:accent' : 'theme:rule',
        opacity: dragging ? 1 : 0.4,
      }}
    >
      <span />
    </Pressable>
  );
}
