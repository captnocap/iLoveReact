// polygon_bench — proof-of-life for <Graph.Polygon>, the filled sibling
// of Graph.Polyline. Three chart families that all need fills (and which
// Graph.Polyline fundamentally cannot draw): bars, area, donut.
//
// Each cell is rendered as a single <Graph.Polygon> (or a small handful of
// them, like donut wedges). Engine fan-triangulates from vertex 0 into the
// batched polys pipeline → one batched draw call total per frame regardless
// of how many shapes are on screen.
//
// Toggles:
//   N      — cells in the grid (1, 4, 16, 64, 256)
//   ANIM   — drift the data per tick (forces real per-frame UPDATE work)

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Graph, Pressable, StaticSurface, Text } from '@reactjit/runtime/primitives';

const TICK_MS = 16;
const COUNTS = [1, 4, 16, 64, 256];
const CELL_W = 220;
const CELL_H = 140;

const COLOR_BG = '#0b1018';
const COLOR_INK = '#e8eef8';
const COLOR_DIM = '#7f93b1';
const COLOR_PLOT_BG = '#0a0a0d';
const COLOR_GREEN = '#34d399';
const COLOR_BLUE = '#3da9ff';
const COLOR_AMBER = '#ff9f43';
const COLOR_PINK = '#f472b6';
const COLOR_PURPLE = '#a78bfa';

type Family = 'bars' | 'area' | 'donut';

function Toggle({ label, on, onPress, accent }: { label: string; on: boolean; onPress: () => void; accent: string }) {
  return (
    <Pressable onPress={onPress} style={{
      paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6,
      borderRadius: 6,
      backgroundColor: on ? accent : '#1a2333',
      borderWidth: 1, borderColor: on ? accent : '#243044',
    }}>
      <Text style={{ fontSize: 11, color: on ? COLOR_BG : COLOR_INK, fontWeight: 'bold' }}>{label}</Text>
    </Pressable>
  );
}

function CellFrame({ children }: { children: any }) {
  return (
    <Box style={{
      width: CELL_W, height: CELL_H,
      backgroundColor: COLOR_PLOT_BG,
      borderWidth: 1, borderColor: '#1d2c45',
      borderRadius: 6, overflow: 'hidden',
    }}>
      {children}
    </Box>
  );
}

// ── BARS ─────────────────────────────────────────────────────────────
// 8 bars per cell. Each bar = 4-point convex polygon = 2 triangles.
function BarsCell({ phase, tick }: { phase: number; tick: number }) {
  const bars = useMemo(() => {
    const N = 8;
    const padX = 12;
    const padY = 12;
    const baseY = CELL_H - padY;
    const topY = padY;
    const innerW = CELL_W - 2 * padX;
    const gap = 4;
    const barW = (innerW - gap * (N - 1)) / N;
    const out: { points: number[]; color: string }[] = [];
    for (let i = 0; i < N; i++) {
      const t = (i + phase * 0.7 + tick * 0.05);
      const h = (Math.sin(t) * 0.4 + 0.6) * (baseY - topY); // 0.2..1 of plot
      const x0 = padX + i * (barW + gap);
      const x1 = x0 + barW;
      const yTop = baseY - h;
      // Fan from v0 = top-left. (v0,v1,v2)=(TL,TR,BR), (v0,v2,v3)=(TL,BR,BL)
      out.push({
        points: [x0, yTop, x1, yTop, x1, baseY, x0, baseY],
        color: i % 2 === 0 ? COLOR_BLUE : COLOR_AMBER,
      });
    }
    return out;
  }, [phase, tick]);

  return (
    <CellFrame>
      <Graph style={{ width: CELL_W, height: CELL_H }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
        {bars.map((b, i) => (
          <Graph.Polygon key={i} points={b.points} fill={b.color} />
        ))}
      </Graph>
    </CellFrame>
  );
}

// ── AREA ─────────────────────────────────────────────────────────────
// One closed polygon: left baseline → curve top → right baseline → close.
// Fan from v0 = bottom-left works because the curve is always above v0's y.
function AreaCell({ phase, tick }: { phase: number; tick: number }) {
  const points = useMemo(() => {
    const N = 64;
    const padX = 8;
    const padY = 12;
    const baseY = CELL_H - padY;
    const topPad = padY;
    const innerW = CELL_W - 2 * padX;
    // Fan-anchor at bottom-left; then trace curve left → right; then bottom-right.
    const arr: number[] = [padX, baseY];
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const x = padX + t * innerW;
      const a = Math.sin(t * 6.28 + phase + tick * 0.05) * 0.4;
      const b = Math.sin(t * 17.0 + phase * 1.3 + tick * 0.07) * 0.18;
      const y01 = 0.5 + a + b; // 0..1, mostly
      const y = baseY - Math.max(0.05, Math.min(0.95, y01)) * (baseY - topPad);
      arr.push(x, y);
    }
    arr.push(padX + innerW, baseY);
    return arr;
  }, [phase, tick]);

  return (
    <CellFrame>
      <Graph style={{ width: CELL_W, height: CELL_H }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
        <Graph.Polygon points={points} fill={COLOR_GREEN} />
      </Graph>
    </CellFrame>
  );
}

// ── DONUT ────────────────────────────────────────────────────────────
// 6 wedges. Each wedge = fan from center, with arc segments around the rim.
// Donut hole: an inner-radius polygon won't naturally subtract — we fake the
// hole by drawing the background color on top. (Real donut subtraction would
// need an annular SDF in shader — out of scope here.)
// Build a wedge as: (radial body polygon: chord-approximation of arc, fan
// from center) + (gcurve bulges: one Loop-Blinn fill triangle per sub-arc
// filling the region between the chord and the true circular arc).
//
// Each sub-arc gets a quadratic bezier triangle whose:
//   p0, p2 = arc endpoints (on the rim circle)
//   p1     = bezier control point at distance R/cos(half_angle) from center
// That control formula is the standard quadratic approximation of a circular
// arc — exact at half_angle ≤ ~30°, smooth at any subdivision count.
function buildWedge(
  cx: number, cy: number, R: number,
  a0: number, a1: number,
  subdivs: number,
): { body: number[]; gcurves: number[] } {
  const body: number[] = [cx, cy];
  const gcurves: number[] = [];
  const half = (a1 - a0) / (2 * subdivs);
  const ctrlR = R / Math.cos(half);
  for (let s = 0; s <= subdivs; s++) {
    const a = a0 + (a1 - a0) * (s / subdivs);
    body.push(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
  }
  for (let s = 0; s < subdivs; s++) {
    const aA = a0 + (a1 - a0) * (s / subdivs);
    const aB = a0 + (a1 - a0) * ((s + 1) / subdivs);
    const aMid = (aA + aB) / 2;
    const p0x = cx + Math.cos(aA) * R;
    const p0y = cy + Math.sin(aA) * R;
    const p2x = cx + Math.cos(aB) * R;
    const p2y = cy + Math.sin(aB) * R;
    const p1x = cx + Math.cos(aMid) * ctrlR;
    const p1y = cy + Math.sin(aMid) * ctrlR;
    gcurves.push(p0x, p0y, p1x, p1y, p2x, p2y);
  }
  return { body, gcurves };
}

// Polygon-fan donut — old approach. Each wedge is a triangle fan from
// center (curve approximated by N short straight segments). Edges are
// visibly faceted at low subdivision counts; smooth at high counts but
// at a cost in triangle count.
function DonutCellPolygon({ phase, tick, w, h }: { phase: number; tick: number; w: number; h: number }) {
  const cx = w / 2;
  const cy = h / 2;
  const R_OUT = Math.min(w, h) / 2 - 12;
  const R_IN = R_OUT * 0.55;

  const wedges = useMemo(() => {
    const N = 6;
    const ARC_SEG = 2; // matches GCurve's SUBDIVS for a like-for-like A/B
    const weights: number[] = [];
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const ww = 0.5 + 0.5 * Math.sin(i * 1.7 + phase + tick * 0.05);
      weights.push(ww);
      sum += ww;
    }
    const colors = [COLOR_BLUE, COLOR_AMBER, COLOR_GREEN, COLOR_PURPLE, COLOR_PINK, '#facc15'];
    const out: { points: number[]; color: string }[] = [];
    let a0 = -Math.PI / 2;
    for (let i = 0; i < N; i++) {
      const span = (weights[i] / sum) * Math.PI * 2;
      const a1 = a0 + span;
      const pts: number[] = [cx, cy];
      for (let s = 0; s <= ARC_SEG; s++) {
        const t = s / ARC_SEG;
        const a = a0 + (a1 - a0) * t;
        pts.push(cx + Math.cos(a) * R_OUT, cy + Math.sin(a) * R_OUT);
      }
      out.push({ points: pts, color: colors[i % colors.length] });
      a0 = a1;
    }
    return out;
  }, [phase, tick, cx, cy, R_OUT]);

  const hole = useMemo(() => {
    const SEG = 32;
    const pts: number[] = [cx, cy];
    for (let s = 0; s <= SEG; s++) {
      const a = (s / SEG) * Math.PI * 2;
      pts.push(cx + Math.cos(a) * R_IN, cy + Math.sin(a) * R_IN);
    }
    return pts;
  }, [cx, cy, R_IN]);

  return (
    <Box style={{ width: w, height: h, backgroundColor: COLOR_PLOT_BG, borderWidth: 1, borderColor: '#1d2c45', borderRadius: 6, overflow: 'hidden' }}>
      <Graph style={{ width: w, height: h }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
        {wedges.map((wd, i) => (
          <Graph.Polygon key={`w-${i}`} points={wd.points} fill={wd.color} />
        ))}
        <Graph.Polygon points={hole} fill={COLOR_PLOT_BG} />
      </Graph>
    </Box>
  );
}

function DonutCell({ phase, tick }: { phase: number; tick: number }) {
  const cx = CELL_W / 2;
  const cy = CELL_H / 2;
  const R_OUT = Math.min(CELL_W, CELL_H) / 2 - 12;
  const R_IN = R_OUT * 0.55;

  const wedges = useMemo(() => {
    const N = 6;
    const SUBDIVS = 2; // 2 sub-arcs per wedge — bezier bulges large enough to be visibly smooth
    const weights: number[] = [];
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const w = 0.5 + 0.5 * Math.sin(i * 1.7 + phase + tick * 0.05);
      weights.push(w);
      sum += w;
    }
    const colors = [COLOR_BLUE, COLOR_AMBER, COLOR_GREEN, COLOR_PURPLE, COLOR_PINK, '#facc15'];
    const out: { body: number[]; gcurves: number[]; color: string }[] = [];
    let a0 = -Math.PI / 2;
    for (let i = 0; i < N; i++) {
      const span = (weights[i] / sum) * Math.PI * 2;
      const a1 = a0 + span;
      const w = buildWedge(cx, cy, R_OUT, a0, a1, SUBDIVS);
      out.push({ body: w.body, gcurves: w.gcurves, color: colors[i % colors.length] });
      a0 = a1;
    }
    return out;
  }, [phase, tick]);

  // Inner-circle "hole" rendered with gcurves too — full 2π circle as 8
  // sub-arcs gives a perfectly anti-aliased boundary. The body is a polygon
  // fan so there's nothing inside the hole to mask.
  const hole = useMemo(() => {
    const SUBDIVS = 8;
    const w = buildWedge(cx, cy, R_IN, 0, Math.PI * 2, SUBDIVS);
    return w;
  }, []);

  return (
    <CellFrame>
      <Graph style={{ width: CELL_W, height: CELL_H }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
        {wedges.flatMap((w, i) => [
          <Graph.Polygon key={`b-${i}`} points={w.body} fill={w.color} />,
          <Graph.GCurve key={`g-${i}`} gcurves={w.gcurves} fill={w.color} />,
        ])}
        <Graph.Polygon points={hole.body} fill={COLOR_PLOT_BG} />
        <Graph.GCurve gcurves={hole.gcurves} fill={COLOR_PLOT_BG} />
      </Graph>
    </CellFrame>
  );
}

// Side-by-side comparison cell for DONUT mode: POLYGON on the left,
// GCURVE on the right. Same wedge data, different render path.
function DonutCompareCell({ phase, tick }: { phase: number; tick: number }) {
  const halfW = (CELL_W - 6) / 2;
  return (
    <Box style={{ width: CELL_W, height: CELL_H + 14, flexDirection: 'column', gap: 2 }}>
      <Box style={{ flexDirection: 'row', gap: 6 }}>
        <Box style={{ width: halfW, height: CELL_H, alignItems: 'center', justifyContent: 'center' }}>
          <DonutCellPolygon phase={phase} tick={tick} w={halfW} h={CELL_H} />
        </Box>
        <Box style={{ width: halfW, height: CELL_H, alignItems: 'center', justifyContent: 'center' }}>
          {/* GCURVE version sized to halfW too — wraps DonutCell which
              uses CELL_W internally; for a proper apples-to-apples we'd
              parameterize DonutCell's size, but for the visual A/B the
              fixed-size version is fine. */}
          <Box style={{ width: halfW, height: CELL_H, backgroundColor: COLOR_PLOT_BG, borderWidth: 1, borderColor: '#1d2c45', borderRadius: 6, overflow: 'hidden' }}>
            <DonutCellGCurveSized phase={phase} tick={tick} w={halfW} h={CELL_H} />
          </Box>
        </Box>
      </Box>
      <Box style={{ flexDirection: 'row', gap: 6 }}>
        <Text style={{ width: halfW, fontSize: 9, color: COLOR_DIM, textAlign: 'center' }}>POLYGON fan</Text>
        <Text style={{ width: halfW, fontSize: 9, color: COLOR_GREEN, textAlign: 'center' }}>GCURVE</Text>
      </Box>
    </Box>
  );
}

// Parameterized GCurve donut sized to fit the side-by-side cells.
function DonutCellGCurveSized({ phase, tick, w, h }: { phase: number; tick: number; w: number; h: number }) {
  const cx = w / 2;
  const cy = h / 2;
  const R_OUT = Math.min(w, h) / 2 - 12;
  const R_IN = R_OUT * 0.55;

  const wedges = useMemo(() => {
    const N = 6;
    const SUBDIVS = 2; // matches the polygon comparison side; bulge ~ R × 3.4% (visible)
    const weights: number[] = [];
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const ww = 0.5 + 0.5 * Math.sin(i * 1.7 + phase + tick * 0.05);
      weights.push(ww);
      sum += ww;
    }
    const colors = [COLOR_BLUE, COLOR_AMBER, COLOR_GREEN, COLOR_PURPLE, COLOR_PINK, '#facc15'];
    const out: { body: number[]; gcurves: number[]; color: string }[] = [];
    let a0 = -Math.PI / 2;
    for (let i = 0; i < N; i++) {
      const span = (weights[i] / sum) * Math.PI * 2;
      const a1 = a0 + span;
      const wd = buildWedge(cx, cy, R_OUT, a0, a1, SUBDIVS);
      out.push({ body: wd.body, gcurves: wd.gcurves, color: colors[i % colors.length] });
      a0 = a1;
    }
    return out;
  }, [phase, tick, cx, cy, R_OUT]);

  // Hole = full circle. Need ≥ 4 sub-arcs (each ≤ 90°) so the quadratic
  // bezier approximation stays accurate; 4 gives ~7% sagitta per sub-arc
  // which is visibly smooth at this scale.
  const hole = useMemo(() => buildWedge(cx, cy, R_IN, 0, Math.PI * 2, 4), [cx, cy, R_IN]);

  return (
    <Graph style={{ width: w, height: h }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
      {wedges.flatMap((wd, i) => [
        <Graph.Polygon key={`b-${i}`} points={wd.body} fill={wd.color} />,
        <Graph.GCurve key={`g-${i}`} gcurves={wd.gcurves} fill={wd.color} />,
      ])}
      <Graph.Polygon points={hole.body} fill={COLOR_PLOT_BG} />
      <Graph.GCurve gcurves={hole.gcurves} fill={COLOR_PLOT_BG} />
    </Graph>
  );
}

const Cell = memo(function Cell({ family, phase, tick, ssaa }: { family: Family; phase: number; tick: number; ssaa: boolean }) {
  let inner: any;
  if (family === 'bars')       inner = <BarsCell phase={phase} tick={tick} />;
  else if (family === 'area')  inner = <AreaCell phase={phase} tick={tick} />;
  else                         inner = <DonutCompareCell phase={phase} tick={tick} />;
  if (!ssaa) return inner;
  // SSAA — render the cell at 2× and downsample on composite. Cache holds
  // when tick is stable (IDLE); ANIM forces re-render every frame and pays
  // the 4× fragment cost AND the per-cell render-to-texture roundtrip on
  // every frame. Useful for IDLE smoothness; catastrophic under animation.
  return (
    <StaticSurface staticKey={`ss-${family}-${phase}-${tick}`} staticSurfaceScale={2}>
      {inner}
    </StaticSurface>
  );
});

export default function PolygonBench() {
  const [count, setCount] = useState(16);
  const [family, setFamily] = useState<Family>('area');
  const [anim, setAnim] = useState(false);
  const [ssaa, setSsaa] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!anim) return;
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, [anim]);

  const renderCount = useRef(0);
  renderCount.current += 1;
  const [diag, setDiag] = useState({ rps: 0 });
  useEffect(() => {
    let last = renderCount.current;
    const id = setInterval(() => {
      const r = renderCount.current;
      setDiag({ rps: (r - last) * 2 });
      last = r;
    }, 500);
    return () => clearInterval(id);
  }, []);

  const cells = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push(i);
    return out;
  }, [count]);

  const familyAccent =
    family === 'bars'  ? COLOR_BLUE :
    family === 'area'  ? COLOR_GREEN :
                         COLOR_AMBER;

  return (
    <Box style={{
      flexGrow: 1, width: '100%', height: '100%',
      backgroundColor: COLOR_BG,
      paddingTop: 12, paddingLeft: 12, paddingRight: 12, paddingBottom: 12,
      flexDirection: 'column', gap: 8,
    }}>
      <Box style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: 14, color: COLOR_INK, fontWeight: 'bold' }}>
          Polygon-bench · Graph.Polygon (filled) — bars / area / donut
        </Text>
        <Box style={{ flexDirection: 'row', gap: 14 }}>
          <Text style={{ fontSize: 11, color: COLOR_DIM }}>{`cells ${count}`}</Text>
          <Text style={{ fontSize: 11, color: COLOR_DIM }}>{`renders/s ${diag.rps}`}</Text>
          <Text style={{ fontSize: 11, color: anim ? COLOR_GREEN : COLOR_DIM }}>{anim ? 'ANIM' : 'IDLE'}</Text>
          <Text style={{ fontSize: 11, color: familyAccent, fontWeight: 'bold' }}>{family.toUpperCase()}</Text>
        </Box>
      </Box>

      <Box style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Toggle label="BARS"  on={family === 'bars'}  onPress={() => setFamily('bars')}  accent={COLOR_BLUE} />
        <Toggle label="AREA"  on={family === 'area'}  onPress={() => setFamily('area')}  accent={COLOR_GREEN} />
        <Toggle label="DONUT" on={family === 'donut'} onPress={() => setFamily('donut')} accent={COLOR_AMBER} />
        <Box style={{ width: 12 }} />
        <Toggle label={anim ? 'ANIM ON' : 'ANIM OFF'} on={anim} onPress={() => setAnim((v) => !v)} accent={COLOR_PINK} />
        <Toggle label={ssaa ? 'SSAA 2× ON' : 'SSAA 2×'} on={ssaa} onPress={() => setSsaa((v) => !v)} accent={COLOR_PURPLE} />
        <Box style={{ width: 12 }} />
        {COUNTS.map((c) => (
          <Toggle key={c} label={String(c)} on={c === count} onPress={() => setCount(c)} accent={COLOR_INK} />
        ))}
      </Box>

      <Text style={{ fontSize: 10, color: COLOR_DIM }}>
        Each cell is 1+ {`<Graph.Polygon>`}. Engine fan-triangulates and pipes into the polys pipeline (one batched draw call total). ANIM ON → all data drifts every frame; cell count × shape complexity × 60Hz exercises the new primitive.
      </Text>

      <Box style={{
        flexGrow: 1, flexDirection: 'row', flexWrap: 'wrap',
        alignContent: 'flex-start', gap: 6,
      }}>
        {cells.map((i) => (
          <Box key={i} style={{ flexShrink: 0, flexGrow: 0 }}>
            <Cell family={family} phase={i * 0.41} tick={anim ? tick : 0} ssaa={ssaa} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}
