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

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Box, Pressable } from '@reactjit/primitives';
import { busOn } from '@reactjit/hooks/useIFTTT';

const DIVIDER = 6; // px thickness of the divider bars
const KNOB = 20; // px diameter of the visible center grab dot
const HIT = 28; // px square of the (invisible) hover/grab target around the dot

// 'col'/'row' come from the edge bars (one axis each); 'both' from the center
// knob, which trades width AND height at once so you can sweep one pane into
// focus diagonally instead of dragging two bars in sequence.
type Axis = 'col' | 'row' | 'both';

export function QuadSplit(props: {
  fx: number;
  fy: number;
  onResize: (axis: Axis, deltaFrac: number) => void;
  /** double-press the center knob → even split (replaced the SettingsTab's
   *  "Reset panes" button — the affordance lives ON the thing it resets) */
  onReset?: () => void;
  topLeft: ReactNode;
  topRight: ReactNode;
  bottomLeft: ReactNode;
  bottomRight: ReactNode;
}) {
  const { fx, fy } = props;
  const sizeRef = useRef<{ width: number; height: number }>({ width: 1, height: 1 });
  // Measured size in *state* (not just the ref) so the absolute knob can be placed
  // in real pixels: the layout path doesn't resolve percentage left/top for
  // absolute children, so `left: '50%'` would pin it to the corner.
  const [dims, setDims] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [knobHot, setKnobHot] = useState(false); // hover (or active drag) → paint the dot
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
    if (axis === 'col' || axis === 'both') onResizeRef.current('col', Number(e?.dx ?? 0) / width);
    if (axis === 'row' || axis === 'both') onResizeRef.current('row', Number(e?.dy ?? 0) / height);
  }), []);

  const begin = (axis: Axis) => () => { dragRef.current = axis; };
  const end = () => { dragRef.current = null; };
  // Double-press detection for the knob's reset (no host dblclick event).
  const lastKnobPressRef = useRef(0);
  const knobPress = () => {
    const now = Date.now();
    if (now - lastKnobPressRef.current < 350) props.onReset?.();
    lastKnobPressRef.current = now;
  };

  const vDivider = (
    <Pressable onMouseDown={begin('col')} onMouseUp={end} style={{ width: DIVIDER, height: '100%', backgroundColor: '#1e293b' }} />
  );

  return (
    <Box
      onLayout={(lr: any) => {
        const w = Number(lr?.width ?? 1), h = Number(lr?.height ?? 1);
        sizeRef.current = { width: w, height: h };
        setDims((d) => (d.width === w && d.height === h ? d : { width: w, height: h }));
      }}
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

      {/* Center knob — an always-present (but invisible) hit target on the divider
          cross that drags both axes at once, so one pane sweeps into focus
          diagonally. The dot only paints while hovered/held. Pixel-positioned (not
          %) because the absolute-layout path ignores percentage left/top; offset by
          DIVIDER/2 to land on the visual center of the 6px-thick bars. */}
      {dims.width > 0 && (
        <Pressable
          onPress={knobPress}
          onMouseDown={begin('both')}
          onMouseUp={end}
          onHoverEnter={() => setKnobHot(true)}
          onHoverExit={() => setKnobHot(false)}
          style={{
            position: 'absolute',
            left: fx * dims.width + DIVIDER / 2 - HIT / 2,
            top: fy * dims.height + DIVIDER / 2 - HIT / 2,
            width: HIT,
            height: HIT,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {knobHot && (
            <Box
              style={{
                width: KNOB,
                height: KNOB,
                borderRadius: KNOB / 2,
                backgroundColor: '#334155',
                borderWidth: 2,
                borderColor: '#64748b',
              }}
            />
          )}
        </Pressable>
      )}
    </Box>
  );
}
