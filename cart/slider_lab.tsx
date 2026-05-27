// slider_lab — five slider implementations vs. a brutal consumer.
//
// Goal: make NAIVE actually freeze the UI so the comparison is real.
// The consumer is a 900-cell grid where each cell renders Text (forces
// font measurement) + a Box with value-derived width/borderRadius/bg.
// Reconciling 900 cells per mousemove pegs the JS thread.
//
// Dragging uses a FULL-VIEWPORT capture overlay: on mousedown the row
// mounts a transparent <Pressable> covering the whole window at the
// highest zIndex. All mousemove/up events route through it, so the
// cursor doesn't need to stay over the track. Release tears it down.
//
// Approaches (top → bottom, heaviest → cheapest cost during drag):
//   1. NAIVE         — setState every move. Reconciler eats the consumer.
//   2. THROTTLED     — drop intermediate moves (32ms gate).
//   3. COALESCED     — setTimeout(0) coalesces N moves → one commit/tick.
//   4. ON-RELEASE    — latch previews the handle; React state commits
//                      only at mouseup. Consumer is frozen during drag.
//   5. LATCH         — pure host-side. __latchSet + 'latch:KEY' on the
//                      consumer's width prop. React reconciler is silent
//                      during drag.

import { useEffect, useRef, useState, useCallback } from 'react';
import { Box, Row, Col, Text, Pressable } from '@reactjit/runtime/primitives';
import { useTelemetry } from '@reactjit/runtime/hooks/useTelemetry';

// ── consumer cost knobs ────────────────────────────────────────────
// 900 cells × Text + computed style is enough to choke NAIVE on most
// machines. Bump if your box is too fast; drop if NAIVE is so slow it
// won't release the mouseup.
const CELLS = 900;
const CELL_BASE_W = 6;
const CELL_RANGE_W = 26;
const CELL_HEIGHT = 18;

const SLIDER_W = 220;
const SLIDER_H = 22;
const ROW_GAP = 10;

// ── theme ──────────────────────────────────────────────────────────
const BG = '#0b1220';
const PANEL = '#131c2e';
const INK = '#e7eaff';
const MUTED = '#8e9bbd';
const TRACK = '#1f2a44';
const TRACK_FILL = '#4f8cff';
const HANDLE = '#cdd9ff';
const CELL_A = '#3da9ff';
const CELL_B = '#7ee787';
const ACCENT = '#ffb84a';

function setLatch(key: string, value: number): void {
  const fn = (globalThis as any).__latchSet;
  if (typeof fn === 'function') fn(key, value);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ── DragCapture: full-viewport overlay that owns the drag ───────────
// Mounted only while dragging. Pointer events on this overlay route
// `onMove(pct)` based on the track's last-known rect; release tears it
// down via onUp. zIndex 99999 keeps it above everything else.
function DragCapture({
  trackRect,
  onMove,
  onUp,
}: {
  trackRect: { x: number; width: number };
  onMove: (pct: number) => void;
  onUp: (pct: number) => void;
}) {
  const lastRef = useRef(0);
  const pctFromX = (sx: number): number => {
    if (trackRect.width <= 0) return lastRef.current;
    const p = clamp01((sx - trackRect.x) / trackRect.width);
    lastRef.current = p;
    return p;
  };
  return (
    <Pressable
      onMouseMove={(p: any) => onMove(pctFromX(p.x))}
      onMouseUp={(p: any) => onUp(pctFromX(p.x))}
      onMouseLeave={(p: any) => onUp(pctFromX(p?.x ?? 0))}
      style={{
        position: 'absolute',
        left: 0, top: 0, right: 0, bottom: 0,
        zIndex: 99999,
        backgroundColor: 'rgba(0,0,0,0.001)', // invisible but eats events
      }}
    />
  );
}

// ── SliderTrack: the chrome. Doesn't manage React value state — only
// drives onMove via a captured rect + an overlay while dragging.
function SliderTrack({
  onDown,
  onMove,
  onUp,
  fillKey,
  handleKey,
  staticFillPct,
  staticHandlePct,
}: {
  onDown?: (pct: number) => void;
  onMove: (pct: number) => void;
  onUp?: (pct: number) => void;
  fillKey?: string;
  handleKey?: string;
  staticFillPct?: number;
  staticHandlePct?: number;
}) {
  const rectRef = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const pctFromX = (sx: number): number => {
    const r = rectRef.current;
    if (!r || r.width <= 0) return 0;
    return clamp01((sx - r.x) / r.width);
  };

  return (
    <Box style={{ position: 'relative' }}>
      <Box
        onLayout={(r: any) => { rectRef.current = { x: r.x, width: r.width }; }}
        onMouseDown={(p: any) => {
          const pct = pctFromX(p.x);
          onDown?.(pct);
          onMove(pct);
          setDragging(true);
        }}
        style={{
          width: SLIDER_W,
          height: SLIDER_H,
          backgroundColor: TRACK,
          borderRadius: 4,
          position: 'relative',
          justifyContent: 'center',
        }}
      >
        <Box style={{
          position: 'absolute',
          left: 0,
          top: SLIDER_H / 2 - 2,
          height: 4,
          width: fillKey ? ('latch:' + fillKey) as any : Math.max(0, (staticFillPct ?? 0) * SLIDER_W),
          backgroundColor: TRACK_FILL,
          borderRadius: 2,
        }} />
        <Box style={{
          position: 'absolute',
          top: 3,
          left: handleKey ? ('latch:' + handleKey) as any : Math.max(0, (staticHandlePct ?? 0) * (SLIDER_W - 16)),
          width: 16,
          height: 16,
          backgroundColor: HANDLE,
          borderRadius: 8,
          borderWidth: 2,
          borderColor: '#1f2a44',
        }} />
      </Box>
      {dragging && rectRef.current ? (
        <DragCapture
          trackRect={rectRef.current}
          onMove={onMove}
          onUp={(p) => {
            setDragging(false);
            onUp?.(p);
          }}
        />
      ) : null}
    </Box>
  );
}

// ── consumers ──────────────────────────────────────────────────────
// React-driven: every cell re-renders on every `value` change. Text
// inside the cell forces per-cell layout/measurement.
function ReactConsumer({ value }: { value: number }) {
  const cells = [];
  for (let i = 0; i < CELLS; i++) {
    const phase = (i / CELLS) * Math.PI * 2;
    const v = clamp01(value * 0.6 + 0.4 * Math.sin(phase + value * 6));
    const w = CELL_BASE_W + v * CELL_RANGE_W;
    cells.push(
      <Box key={i} style={{
        width: w,
        height: CELL_HEIGHT,
        backgroundColor: i % 2 === 0 ? CELL_A : CELL_B,
        borderRadius: 2 + v * 6,
        borderWidth: 1,
        borderColor: '#0b1220',
        justifyContent: 'center',
        alignItems: 'center',
        opacity: 0.4 + v * 0.6,
      }}>
        <Text style={{ color: '#0b1220', fontSize: 8, fontWeight: '700' }}>
          {v.toFixed(2)}
        </Text>
      </Box>
    );
  }
  return <Row style={{ flexWrap: 'wrap', gap: 1, flexGrow: 1 }}>{cells}</Row>;
}

// Latch-driven: rendered ONCE at mount. Host writes the bound latch
// keys per frame; React reconciler does nothing during drag.
function LatchConsumer({ widthKey, radiusKey }: { widthKey: string; radiusKey: string }) {
  const cells = [];
  for (let i = 0; i < CELLS; i++) {
    cells.push(
      <Box key={i} style={{
        width: ('latch:' + widthKey) as any,
        height: CELL_HEIGHT,
        backgroundColor: i % 2 === 0 ? CELL_A : CELL_B,
        borderRadius: ('latch:' + radiusKey) as any,
        borderWidth: 1,
        borderColor: '#0b1220',
        opacity: 0.8,
      }} />
    );
  }
  return <Row style={{ flexWrap: 'wrap', gap: 1, flexGrow: 1 }}>{cells}</Row>;
}

// ── rows ───────────────────────────────────────────────────────────
function NaiveRow({ onActive }: { onActive: () => void }) {
  const [v, setV] = useState(0.3);
  return (
    <RowShell label="1. NAIVE setState" hint="setValue() on every move — expect a lock-up" value={v}>
      <SliderTrack
        staticFillPct={v}
        staticHandlePct={v}
        onMove={(p) => { onActive(); setV(p); }}
      />
      <ReactConsumer value={v} />
    </RowShell>
  );
}

const THROTTLE_MS = 32;
function ThrottledRow({ onActive }: { onActive: () => void }) {
  const [v, setV] = useState(0.3);
  const lastRef = useRef(0);
  return (
    <RowShell label="2. THROTTLED 32ms" hint="drop intermediate moves" value={v}>
      <SliderTrack
        staticFillPct={v}
        staticHandlePct={v}
        onMove={(p) => {
          const now = (globalThis as any).performance?.now?.() ?? 0;
          if (now - lastRef.current < THROTTLE_MS) return;
          lastRef.current = now;
          onActive();
          setV(p);
        }}
        onUp={(p) => { onActive(); setV(p); }}
      />
      <ReactConsumer value={v} />
    </RowShell>
  );
}

function CoalescedRow({ onActive }: { onActive: () => void }) {
  const [v, setV] = useState(0.3);
  const pendingRef = useRef<number | null>(null);
  const scheduledRef = useRef(false);
  const flush = useCallback(() => {
    scheduledRef.current = false;
    const p = pendingRef.current;
    pendingRef.current = null;
    if (p != null) setV(p);
  }, []);
  return (
    <RowShell label="3. COALESCED setTimeout(0)" hint="one commit per host tick" value={v}>
      <SliderTrack
        staticFillPct={v}
        staticHandlePct={v}
        onMove={(p) => {
          pendingRef.current = p;
          if (scheduledRef.current) return;
          scheduledRef.current = true;
          onActive();
          setTimeout(flush, 0);
        }}
      />
      <ReactConsumer value={v} />
    </RowShell>
  );
}

function OnReleaseRow({ onActive }: { onActive: () => void }) {
  const [v, setV] = useState(0.3);
  const fillKey = 'slider_lab:release:fill';
  const handleKey = 'slider_lab:release:handle';
  useEffect(() => {
    setLatch(fillKey, v * SLIDER_W);
    setLatch(handleKey, v * (SLIDER_W - 16));
  }, [v]);
  return (
    <RowShell label="4. COMMIT ON RELEASE" hint="latch previews handle, setValue on mouseup" value={v}>
      <SliderTrack
        fillKey={fillKey}
        handleKey={handleKey}
        onDown={() => onActive()}
        onMove={(p) => {
          setLatch(fillKey, p * SLIDER_W);
          setLatch(handleKey, p * (SLIDER_W - 16));
        }}
        onUp={(p) => { onActive(); setV(p); }}
      />
      <ReactConsumer value={v} />
    </RowShell>
  );
}

function LatchRow({ onActive }: { onActive: () => void }) {
  const fillKey = 'slider_lab:latch:fill';
  const handleKey = 'slider_lab:latch:handle';
  const cellWidthKey = 'slider_lab:latch:cellw';
  const cellRadiusKey = 'slider_lab:latch:cellr';
  useEffect(() => {
    setLatch(fillKey, 0.3 * SLIDER_W);
    setLatch(handleKey, 0.3 * (SLIDER_W - 16));
    setLatch(cellWidthKey, CELL_BASE_W + 0.3 * CELL_RANGE_W);
    setLatch(cellRadiusKey, 2 + 0.3 * 6);
  }, []);
  return (
    <RowShell label="5. LATCH (host-side)" hint="__latchSet; consumer binds 'latch:KEY'" value={null}>
      <SliderTrack
        fillKey={fillKey}
        handleKey={handleKey}
        onDown={() => onActive()}
        onMove={(p) => {
          setLatch(fillKey, p * SLIDER_W);
          setLatch(handleKey, p * (SLIDER_W - 16));
          setLatch(cellWidthKey, CELL_BASE_W + p * CELL_RANGE_W);
          setLatch(cellRadiusKey, 2 + p * 6);
        }}
      />
      <LatchConsumer widthKey={cellWidthKey} radiusKey={cellRadiusKey} />
    </RowShell>
  );
}

// ── shell ──────────────────────────────────────────────────────────
function RowShell({
  label,
  hint,
  value,
  children,
}: {
  label: string;
  hint: string;
  value: number | null;
  children: any;
}) {
  return (
    <Row style={{
      gap: 10,
      padding: 8,
      backgroundColor: PANEL,
      borderRadius: 8,
      alignItems: 'center',
    }}>
      <Col style={{ width: 220, gap: 2 }}>
        <Text style={{ color: INK, fontSize: 12, fontWeight: '700' }}>{label}</Text>
        <Text style={{ color: MUTED, fontSize: 10 }}>{hint}</Text>
        <Text style={{ color: ACCENT, fontSize: 10, fontWeight: '600' }}>
          {value == null ? 'value: (latch — no React state)' : `value: ${value.toFixed(3)}`}
        </Text>
      </Col>
      {children}
    </Row>
  );
}

export default function SliderLab() {
  const { value: fps } = useTelemetry({ kind: 'fps', pollMs: 250 });
  const [active, setActive] = useState<string>('—');
  const mkActive = (name: string) => () => {
    if (active !== name) setActive(name);
  };
  return (
    <Col style={{
      width: '100%',
      height: '100%',
      backgroundColor: BG,
      padding: 12,
      gap: ROW_GAP,
    }}>
      <Row style={{ gap: 14, alignItems: 'center' }}>
        <Text style={{ color: INK, fontSize: 18, fontWeight: '800' }}>SLIDER LAB</Text>
        <Text style={{ color: MUTED, fontSize: 11 }}>
          drag each row. {CELLS} consumer cells per row, with text + computed style. expect row 1 to choke.
        </Text>
        <Box style={{ flexGrow: 1 }} />
        <Box style={{
          backgroundColor: PANEL,
          paddingTop: 6, paddingBottom: 6, paddingLeft: 10, paddingRight: 10,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: '#26334d',
        }}>
          <Text style={{ color: fps >= 55 ? '#7ee787' : fps >= 30 ? ACCENT : '#ff6f6f', fontSize: 16, fontWeight: '800' }}>
            {Math.round(fps)} fps
          </Text>
        </Box>
        <Box style={{
          backgroundColor: PANEL,
          paddingTop: 6, paddingBottom: 6, paddingLeft: 10, paddingRight: 10,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: '#26334d',
        }}>
          <Text style={{ color: MUTED, fontSize: 10 }}>last dragged</Text>
          <Text style={{ color: INK, fontSize: 12, fontWeight: '700' }}>{active}</Text>
        </Box>
      </Row>

      <NaiveRow     onActive={mkActive('NAIVE')} />
      <ThrottledRow onActive={mkActive('THROTTLED')} />
      <CoalescedRow onActive={mkActive('COALESCED')} />
      <OnReleaseRow onActive={mkActive('ON-RELEASE')} />
      <LatchRow     onActive={mkActive('LATCH')} />

      <Box style={{ flexGrow: 1 }} />
      <Text style={{ color: MUTED, fontSize: 10 }}>
        Drag-capture: each slider mounts a full-viewport overlay on mousedown so the cursor can stray anywhere.
        Slot-in: bind any numeric style prop to 'latch:KEY', call __latchSet(KEY, n) on move. Zero reconciliation.
      </Text>
    </Col>
  );
}
