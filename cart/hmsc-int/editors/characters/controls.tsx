// editors/characters/controls.tsx — the route's bespoke input atoms. Chips,
// knobs and panels come from GAME_CHROME; what lives here is what the chrome
// kit doesn't have: the latch-driven region slider (drag previews write GPU
// latches, React commits on release) and the skin swatch row.
//
// Behavior reference: cart/head_lab/index.tsx RegionSlider/DragCapture (read,
// never imported).

import { useEffect, useRef, useState } from 'react';
import { Box, Pressable, Row, Text } from '@reactjit/runtime/primitives';
import { GAME_CHROME } from '../../game/chrome';

const T = GAME_CHROME.tokens.color;

export const REGION_SLIDER_TUNING = Object.freeze({
  trackWidth: 160,
  trackHeight: 24,
  handleSize: 16,
  labelWidth: 84,
  valueWidth: 38,
  /** slider values live in −1..1 */
  range: { min: -1, max: 1 },
});

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function setLatch(key: string, value: number): void {
  const fn = (globalThis as any).__latchSet;
  if (typeof fn === 'function') fn(key, value);
}

/** Full-viewport invisible capture while a slider drags — move/up anywhere
 *  lands here (pointer capture doesn't follow overlays; see memory
 *  feedback_pointer_capture). */
function DragCapture(props: {
  trackRect: { x: number; width: number };
  onMove: (pct: number) => void;
  onUp: (pct: number) => void;
}) {
  const lastRef = useRef(0);
  const pctFromX = (sx: number): number => {
    if (props.trackRect.width <= 0) return lastRef.current;
    const pct = clamp01((sx - props.trackRect.x) / props.trackRect.width);
    lastRef.current = pct;
    return pct;
  };
  return (
    <Pressable
      onMouseMove={(e: any) => props.onMove(pctFromX(Number(e?.x ?? 0)))}
      onMouseUp={(e: any) => props.onUp(pctFromX(Number(e?.x ?? 0)))}
      onMouseLeave={(e: any) => props.onUp(pctFromX(Number(e?.x ?? 0)))}
      style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 99999, backgroundColor: 'rgba(0,0,0,0.001)' }}
    />
  );
}

/** A −1..1 slider whose drag preview writes latches only; React state (and
 *  the mesh re-sculpt behind it) commits once, on release. */
export function RegionSliderRow(props: { keyBase: string; label: string; value: number; onCommit: (value: number) => void }) {
  const S = REGION_SLIDER_TUNING;
  const rectRef = useRef<{ x: number; width: number } | null>(null);
  const previewRef = useRef(props.value);
  const [dragging, setDragging] = useState(false);
  const pct = clamp01((props.value - S.range.min) / (S.range.max - S.range.min));
  const fillKey = `${props.keyBase}.fill`;
  const handleKey = `${props.keyBase}.handle`;
  const pctToValue = (p: number) => Math.max(S.range.min, Math.min(S.range.max, p * (S.range.max - S.range.min) + S.range.min));
  const writePreview = (p: number) => {
    previewRef.current = pctToValue(p);
    setLatch(fillKey, Math.max(0, p * S.trackWidth));
    setLatch(handleKey, Math.max(0, p * (S.trackWidth - S.handleSize)));
  };
  const pctFromX = (sx: number): number => {
    const r = rectRef.current;
    if (!r || r.width <= 0) return pct;
    return clamp01((sx - r.x) / r.width);
  };

  useEffect(() => {
    writePreview(pct);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- latch sync follows the committed value
  }, [pct, fillKey, handleKey]);

  return (
    <Row style={{ gap: 8, alignItems: 'center' }}>
      <Text fontSize={11} color={T.dim} style={{ width: S.labelWidth }}>{props.label}</Text>
      <Box style={{ width: S.trackWidth, height: S.trackHeight, position: 'relative' }}>
        <Pressable
          onLayout={(r: any) => { rectRef.current = { x: r.x, width: r.width }; }}
          onMouseDown={(e: any) => {
            writePreview(pctFromX(Number(e?.x ?? 0)));
            setDragging(true);
          }}
          style={{ width: S.trackWidth, height: S.trackHeight, borderRadius: 4, backgroundColor: '#1a2942', justifyContent: 'center', position: 'relative' }}
        >
          <Box style={{ position: 'absolute', left: 0, top: 10, width: ('latch:' + fillKey) as any, height: 4, borderRadius: 2, backgroundColor: T.accent }} />
          <Box style={{ position: 'absolute', left: ('latch:' + handleKey) as any, top: 3, width: S.handleSize, height: S.handleSize, borderRadius: S.handleSize / 2, backgroundColor: '#d8e5ff', borderWidth: 2, borderColor: '#17253b' }} />
        </Pressable>
        {dragging && rectRef.current ? (
          <DragCapture
            trackRect={rectRef.current}
            onMove={writePreview}
            onUp={(p) => {
              writePreview(p);
              setDragging(false);
              props.onCommit(previewRef.current);
            }}
          />
        ) : null}
      </Box>
      <Text fontSize={11} color={T.ink} style={{ width: S.valueWidth, textAlign: 'right' }}>{props.value.toFixed(2)}</Text>
    </Row>
  );
}

/** A row of color swatches (skin tones, face paints). */
export function SwatchRow(props: { colors: readonly string[]; active: string; size?: number; onPick: (color: string) => void }) {
  const size = props.size ?? 20;
  return (
    <Row style={{ gap: 6, alignItems: 'center' }}>
      {props.colors.map((c) => (
        <Pressable
          key={c}
          onPress={() => props.onPick(c)}
          style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c, borderWidth: 2, borderColor: props.active === c ? T.accent : T.frame }}
        />
      ))}
    </Row>
  );
}

/** A labeled chip row — the editor's standard picker line. */
export function ChipRow(props: { label: string; children: any }) {
  return (
    <Row style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <Text fontSize={11} color={T.dim} style={{ width: 52 }}>{props.label}</Text>
      {props.children}
    </Row>
  );
}
