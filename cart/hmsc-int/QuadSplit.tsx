// QuadSplit — a 2x2 pane grid with a native cross divider (controlled).
//
// Layout mirrors the spec: a column of two rows, each row two cells. One shared
// column fraction (fx) and one shared row fraction (fy) place a clean cross of
// dividers — drag the vertical divider to trade width between the columns, the
// horizontal divider to trade height between the rows. Pull both and any one of
// the four panes becomes the focus while all four stay mounted.
//
// Controlled: the parent owns fx/fy (so they can be persisted across hot reloads
// via the workspace layer) and receives per-event fraction deltas through
// onResize. The drag is driven by the HOST's global cursor channel
// (system:cursor:move, pumped by Zig from SDL_GetGlobalMouseState — see
// runtime/hooks/useIFTTT.ts), NOT a per-node onMouseMove. We forward the
// channel's dx/dy as fractions of the measured container, so it tracks across the
// whole window with no capture gaps. onMouseDown/onMouseUp on the bars only
// bracket the gesture (begin/end).

import { useEffect, useRef, type ReactNode } from 'react';
import { Box, Pressable } from '@reactjit/primitives';
import { busOn } from '@reactjit/hooks/useIFTTT';

const DIVIDER = 6; // px thickness of the divider bars

type Axis = 'col' | 'row';

export function QuadSplit(props: {
  fx: number;
  fy: number;
  onResize: (axis: Axis, deltaFrac: number) => void;
  topLeft: ReactNode;
  topRight: ReactNode;
  bottomLeft: ReactNode;
  bottomRight: ReactNode;
}) {
  const { fx, fy } = props;
  const sizeRef = useRef<{ width: number; height: number }>({ width: 1, height: 1 });
  const dragRef = useRef<Axis | null>(null);
  // Mirror the latest onResize so the cursor subscription never needs to re-bind.
  const onResizeRef = useRef(props.onResize);
  onResizeRef.current = props.onResize;

  // Subscribe once to the host's global cursor channel. No-op unless a divider is
  // held; while held it reports the cursor delta as a fraction of the container.
  useEffect(() => busOn('system:cursor:move', (e: any) => {
    const axis = dragRef.current;
    if (!axis) return;
    const { width, height } = sizeRef.current;
    if (axis === 'col') onResizeRef.current('col', Number(e?.dx ?? 0) / width);
    else onResizeRef.current('row', Number(e?.dy ?? 0) / height);
  }), []);

  const begin = (axis: Axis) => () => { dragRef.current = axis; };
  const end = () => { dragRef.current = null; };

  const vDivider = (
    <Pressable onMouseDown={begin('col')} onMouseUp={end} style={{ width: DIVIDER, height: '100%', backgroundColor: '#1e293b' }} />
  );

  return (
    <Box
      onLayout={(lr: any) => { sizeRef.current = { width: Number(lr?.width ?? 1), height: Number(lr?.height ?? 1) }; }}
      onMouseUp={end}
      style={{ width: '100%', height: '100%', flexDirection: 'column' }}
    >
      {/* Top row */}
      <Box style={{ flexDirection: 'row', width: '100%', height: `${fy * 100}%` }}>
        <Box style={{ width: `${fx * 100}%`, height: '100%', overflow: 'hidden' }}>{props.topLeft}</Box>
        {vDivider}
        <Box style={{ flexGrow: 1, height: '100%', overflow: 'hidden' }}>{props.topRight}</Box>
      </Box>

      {/* Horizontal divider (full width) */}
      <Pressable onMouseDown={begin('row')} onMouseUp={end} style={{ width: '100%', height: DIVIDER, backgroundColor: '#1e293b' }} />

      {/* Bottom row */}
      <Box style={{ flexDirection: 'row', flexGrow: 1, width: '100%' }}>
        <Box style={{ width: `${fx * 100}%`, height: '100%', overflow: 'hidden' }}>{props.bottomLeft}</Box>
        {vDivider}
        <Box style={{ flexGrow: 1, height: '100%', overflow: 'hidden' }}>{props.bottomRight}</Box>
      </Box>
    </Box>
  );
}
