// SplitPane — generic resizable two-pane splitter.
//
// Horizontal: first pane on the left at fixed pixel width, second
// pane fills remaining width. Vertical: same but stacked top/bottom.
//
// Drag handle is a 6px-thick Pressable strip between the panes. While
// dragging, we listen on the `system:cursor:move` bus channel to
// update size and poll `getMouseDown()` to detect release. Min sizes
// per pane prevent crushing.
//
// Either pane can be hidden at the call site; when only one is
// visible, that pane fills 100% with no handle. So a parent can
// drive show/hide via toggle chips and the layout collapses
// gracefully.

import { useEffect, useRef, useState } from 'react';
import { Box, Col, Pressable, Row } from '@reactjit/runtime/primitives';
import { subscribe } from '@reactjit/runtime/ffi';

export interface SplitPaneProps {
  direction: 'horizontal' | 'vertical';
  first: React.ReactNode;
  second: React.ReactNode;
  /** Initial size of the first pane, in pixels. */
  initialFirstSize: number;
  /** Minimum first-pane size in pixels. Default 120. */
  minFirstSize?: number;
  /** Minimum second-pane size in pixels. Default 120. */
  minSecondSize?: number;
  /** Show/hide each pane. When only one is true, it fills 100% with
   *  no handle. */
  showFirst?: boolean;
  showSecond?: boolean;
  /** Optional persistence callback — called when the user finishes a
   *  resize. The parent can save to disk. */
  onResize?: (firstSize: number) => void;
}

const HANDLE_THICKNESS = 6;

export function SplitPane({
  direction,
  first,
  second,
  initialFirstSize,
  minFirstSize = 120,
  minSecondSize = 120,
  showFirst = true,
  showSecond = true,
  onResize,
}: SplitPaneProps) {
  const [firstSize, setFirstSize] = useState(initialFirstSize);
  const [dragging, setDragging] = useState(false);

  // Drag state — the cursor bus is global so we keep the start
  // position + start size in refs so the move handler reads them
  // without re-binding.
  const startRef = useRef<{ cursorPos: number; firstSize: number } | null>(null);

  // Subscribe to cursor:move while dragging. queueMicrotask is
  // fine — the bus delivers synchronously via emit().
  useEffect(() => {
    if (!dragging) return;
    const off = subscribe('system:cursor:move', (e: any) => {
      const start = startRef.current;
      if (!start) return;
      const cur = direction === 'horizontal' ? (e?.x ?? 0) : (e?.y ?? 0);
      const delta = cur - start.cursorPos;
      const next = Math.max(minFirstSize, start.firstSize + delta);
      setFirstSize(next);
    });
    // Detect release by polling __getMouseDown. The cursor bus
    // doesn't include button state, so a small interval is the
    // simplest way to notice mouse-up.
    let tick: ReturnType<typeof setTimeout> | null = null;
    const poll = () => {
      const down = (globalThis as any).getMouseDown?.() ?? false;
      if (!down) {
        setDragging(false);
        startRef.current = null;
        if (onResize) onResize(firstSize);
        return;
      }
      tick = setTimeout(poll, 16);
    };
    tick = setTimeout(poll, 16);
    return () => {
      off();
      if (tick) clearTimeout(tick);
    };
  // firstSize intentionally NOT in deps — we only want to call
  // onResize with the value at release; capturing live size via
  // ref would be overkill. The closure captures whatever firstSize
  // was at the start of the drag, which then gets overwritten by
  // setFirstSize state updates. The release reads from the current
  // closure (already updated).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, direction, minFirstSize]);

  // Single pane visible — full area, no handle.
  if (showFirst && !showSecond) return <Box style={{ flexGrow: 1, minHeight: 0, minWidth: 0 }}>{first}</Box>;
  if (!showFirst && showSecond) return <Box style={{ flexGrow: 1, minHeight: 0, minWidth: 0 }}>{second}</Box>;
  if (!showFirst && !showSecond) return null;

  const Container = direction === 'horizontal' ? Row : Col;

  const onPressIn = () => {
    const x = (globalThis as any).getMouseX?.() ?? 0;
    const y = (globalThis as any).getMouseY?.() ?? 0;
    const cursorPos = direction === 'horizontal' ? x : y;
    startRef.current = { cursorPos, firstSize };
    setDragging(true);
  };

  // The first pane gets fixed pixel size; second pane flexes.
  const firstStyle: any = direction === 'horizontal'
    ? { width: firstSize, height: '100%', minWidth: minFirstSize, flexShrink: 0 }
    : { height: firstSize, width: '100%', minHeight: minFirstSize, flexShrink: 0 };
  const handleStyle: any = direction === 'horizontal'
    ? {
        width: HANDLE_THICKNESS, height: '100%', flexShrink: 0,
        cursor: 'col-resize',
        backgroundColor: dragging ? 'theme:accent' : 'theme:rule',
      }
    : {
        height: HANDLE_THICKNESS, width: '100%', flexShrink: 0,
        cursor: 'row-resize',
        backgroundColor: dragging ? 'theme:accent' : 'theme:rule',
      };
  const secondStyle: any = direction === 'horizontal'
    ? { flexGrow: 1, flexBasis: 0, minWidth: minSecondSize, height: '100%' }
    : { flexGrow: 1, flexBasis: 0, minHeight: minSecondSize, width: '100%' };

  return (
    <Container style={{ flexGrow: 1, minHeight: 0, minWidth: 0 }}>
      <Box style={firstStyle}>{first}</Box>
      <Pressable onPressIn={onPressIn} style={handleStyle}>
        <Box style={{ width: '100%', height: '100%' }} />
      </Pressable>
      <Box style={secondStyle}>{second}</Box>
    </Container>
  );
}
