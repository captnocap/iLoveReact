/**
 * Highlight — selection / hover affordance built on <Background> + animated
 * dashed border. Two interaction states drive two distinct visuals:
 *
 *   • active           → continuous marching-ants border (continuous flow)
 *                        + static-mode shader inside (autonomous bloom)
 *   • hovered          → one-shot trace fires around the perimeter (a single
 *                        dash extends from 0 to full perimeter, easeOutCubic,
 *                        ~400ms; reverses on exit) + cursor-mode shader
 *   • neither          → no border, no shader (cheap idle path)
 *
 * Border-trace pattern follows cart/app/app.md convention. The trace driver
 * is a tiny RAF tween over the [borderDashOn, borderDashOff] pair.
 */

import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import { Box, Pressable } from './primitives';
import { Background, type BackgroundType } from './background';
import { useThemeColors, type ThemeColors } from './classifier';

interface HighlightProps {
  active?: boolean;
  type?: BackgroundType;
  borderRadius?: number;
  onPress?: () => void;
  style?: Record<string, any>;
  children?: React.ReactNode;
}

function pickColor(colors: ThemeColors, ...keys: string[]): string {
  const map = colors as unknown as Record<string, string>;
  for (const k of keys) {
    const v = map[k];
    if (v) return v;
  }
  return '#888888';
}

// Assumed perimeter for the trace tween. The framework's border_dash.zig
// quantizes the dash period to fit the actual perimeter exactly, so this
// just needs to be "large enough that progress=1 reads as fully traced".
const TRACE_PERIMETER = 2000;
const TRACE_DURATION_MS = 400;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function Highlight({
  active = false,
  type = 'dots',
  borderRadius = 12,
  onPress,
  style,
  children,
}: HighlightProps) {
  const [hovered, setHovered] = useState(false);
  const [trace, setTrace] = useState(0); // 0 = not traced, 1 = fully traced
  const traceRef = useRef(0);
  traceRef.current = trace;

  // Drive trace toward the hover state on enter/exit. This V8 runtime has no
  // requestAnimationFrame; probe for it and fall back to setTimeout(16ms),
  // matching the pattern in cart/list_lab/index.tsx:68.
  useEffect(() => {
    const target = hovered ? 1 : 0;
    const start = Date.now();
    const startVal = traceRef.current;
    const g: any = globalThis;
    const sched: (fn: () => void) => any = g.requestAnimationFrame
      ? g.requestAnimationFrame.bind(g)
      : (fn: () => void) => setTimeout(fn, 16);
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const t = Math.min(1, (Date.now() - start) / TRACE_DURATION_MS);
      setTrace(startVal + (target - startVal) * easeOutCubic(t));
      if (t < 1) sched(tick);
    };
    sched(tick);
    return () => { cancelled = true; };
  }, [hovered]);

  const colors = useThemeColors();
  const accent = pickColor(colors, 'accentHot', 'error', 'flag', 'accent');

  const showBg = active || hovered;
  const bgMode = active && !hovered ? 'static' : 'cursor';

  // Border state machine:
  //   active           → continuous marching flow (always-on selected state)
  //   hovered (no act) → one-shot trace tween over the perimeter
  //   active && hover  → continuous flow (don't break the active rhythm)
  //   idle             → invisible border placeholder (keeps layout stable)
  let borderProps: Record<string, any>;
  if (active) {
    borderProps = {
      borderColor: accent,
      borderWidth: 2,
      borderDashOn: 18,
      borderDashOff: 12,
      borderDashWidth: 2,
      borderFlowSpeed: 28,
    };
  } else if (trace > 0.001) {
    borderProps = {
      borderColor: accent,
      borderWidth: 2,
      borderDashOn: trace * TRACE_PERIMETER,
      borderDashOff: (1 - trace) * TRACE_PERIMETER,
      borderDashWidth: 2,
      borderFlowSpeed: 0,
    };
  } else {
    borderProps = {
      borderColor: 'transparent',
      borderWidth: 2,
    };
  }

  const Wrap: any = onPress ? Pressable : Box;

  return (
    <Wrap
      onPress={onPress}
      onHoverEnter={() => setHovered(true)}
      onHoverExit={() => setHovered(false)}
      style={{
        position: 'relative',
        borderRadius,
        ...borderProps,
        ...style,
      }}
    >
      {/* Backdrop holds the GPU effect; cornerRadius arrives at the shader
          which fades alpha along the rounded perimeter (CSS overflow doesn't
          clip the texture quad in this stack). Border stays on the outer
          wrapper so the framework draws it as a true rounded border. */}
      {showBg && (
        <Box style={{
          position: 'absolute',
          width: '100%', height: '100%',
        }}>
          <Background type={type} mode={bgMode} cornerRadius={borderRadius} />
        </Box>
      )}
      {children}
    </Wrap>
  );
}
