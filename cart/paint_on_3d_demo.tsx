// paint_on_3d_demo — painting ON the 3D model, the correct way. The running proof
// for the Studio painter rewrite. Built across triangle_mask_demo (per-pixel mask)
// then lifted to 3D here. Properties proven, in order:
//
//   1. Paint on the 3D MODEL surface (raycast pick), NOT on the atlas. The atlas is
//      READ-ONLY base; paint is a SEPARATE LAYER composited over it.
//   2. UNIFORM model-space grid: one fixed world-size cell (CELL) on every face —
//      no slivers — and camera zoom never changes it (idle auto-orbit + zoom proves
//      it; it freezes while you paint).
//   3. PER-FACE mask: a painted cell clips to its face, never spilling across a
//      shared edge onto the perpendicular neighbour.
//   4. NO PINSTRIPES: a painted cell is ONE solid polygon (Graph.Path fill) from its
//      projected corners; adjacent cells share exact corners so fills tile with no
//      seam — a continuous layer, not the old per-row run-boxes that rounded into
//      periodic gaps.
//
//   5. PSEUDO-COLOUR / PALETTE paint (req_1258). You don't paint a colour — you paint
//      a SLOT (a placement id: Body / Trim / Glass). The paint layer stores the slot
//      INDEX, never RGB. A separate palette maps slot -> real colour, and a slot can
//      have a SET of possible colours. So you paint ONE truck with detail, then a
//      recolour tool swaps the palette to make blue / green / white trucks from the
//      same painting — no repainting. Toggle "View: Pseudo" (the colourless slot
//      layer you actually paint) vs "View: Painted" (a palette variant applied).
//
// The grid/paint is a 2D layer projected through the SAME camera the host renders
// with (meshSelect.makeProjector replicates gpu/3d.zig), so it sits on the faces.
//
// Verify: ./tools/rjit shot paint_on_3d_demo --out /tmp/paint3d.png   (drag to paint live)

import { useEffect, useRef, useState } from 'react';
import { Box, Graph, Pressable, Scene3D, Text } from '@reactjit/runtime/primitives';
import { makeProjector, orbitalEyeJS, type CameraSnap } from './hmsc-int/editors/model/meshSelect';
import { screenRay } from './hmsc-int/editors/model/meshPaint';

type V3 = [number, number, number];

const SIZE = 560;
const FOV = 48;
const CELL = 0.3;            // grid cell size, in MODEL/WORLD units — uniform on every face
const PITCH = 20;            // camera elevation (deg)
const HX = 1.35, HY = 0.85, HZ = 0.85; // box half-extents (deliberately unequal faces)
const Geom = { box: (require('@reactjit/geometries') as any).Box };

// You paint a SLOT, not a colour. The paint layer stores this id; `pseudo` is just a
// placeholder hue so the colourless slot layer is visible while you paint.
type Slot = { id: number; name: string; pseudo: string };
const SLOTS: Slot[] = [
  { id: 0, name: 'Body', pseudo: '#ff4d6d' },
  { id: 1, name: 'Trim', pseudo: '#4d8bff' },
  { id: 2, name: 'Glass', pseudo: '#3ddc84' },
];

// The recolour tool's output: named variants, each a palette mapping slot -> real
// colour. "What colours are possible" lives here — swap the variant, recolour the
// SAME painted cells. One painting → many trucks.
const VARIANTS: { name: string; colors: Record<number, string> }[] = [
  { name: 'Blue', colors: { 0: '#3f6fb0', 1: '#20242b', 2: '#bfe6f2' } },
  { name: 'Green', colors: { 0: '#4f9e63', 1: '#20242b', 2: '#bfe6f2' } },
  { name: 'White', colors: { 0: '#dfe3ea', 1: '#3a3f47', 2: '#bfe6f2' } },
];

// vec helpers
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Each box face as a planar rect in MODEL space: a min-corner + two in-plane axes
// (unit dir + world length) + outward normal. The grid steps along uDir/vDir.
type Face = { corner: V3; uDir: V3; uLen: number; vDir: V3; vLen: number; normal: V3 };
const FACES: Face[] = [
  { corner: [HX, -HY, -HZ], uDir: [0, 1, 0], uLen: 2 * HY, vDir: [0, 0, 1], vLen: 2 * HZ, normal: [1, 0, 0] },   // +X
  { corner: [-HX, -HY, -HZ], uDir: [0, 1, 0], uLen: 2 * HY, vDir: [0, 0, 1], vLen: 2 * HZ, normal: [-1, 0, 0] }, // -X
  { corner: [-HX, HY, -HZ], uDir: [1, 0, 0], uLen: 2 * HX, vDir: [0, 0, 1], vLen: 2 * HZ, normal: [0, 1, 0] },   // +Y
  { corner: [-HX, -HY, -HZ], uDir: [1, 0, 0], uLen: 2 * HX, vDir: [0, 0, 1], vLen: 2 * HZ, normal: [0, -1, 0] }, // -Y
  { corner: [-HX, -HY, HZ], uDir: [1, 0, 0], uLen: 2 * HX, vDir: [0, 1, 0], vLen: 2 * HY, normal: [0, 0, 1] },   // +Z
  { corner: [-HX, -HY, -HZ], uDir: [1, 0, 0], uLen: 2 * HX, vDir: [0, 1, 0], vLen: 2 * HY, normal: [0, 0, -1] }, // -Z
];

const facePoint = (f: Face, u: number, v: number): V3 => add(add(f.corner, mul(f.uDir, u)), mul(f.vDir, v));
const faceCenter = (f: Face): V3 => facePoint(f, f.uLen / 2, f.vLen / 2);
const faceVisible = (f: Face, eye: V3): boolean => dot(f.normal, sub(eye, faceCenter(f))) > 0;

function camAt(tick: number): CameraSnap {
  const yaw = tick * 0.5;
  const dist = 5.4 + 1.7 * Math.sin(tick * 0.018);
  const eye = orbitalEyeJS([0, 0, 0], yaw, PITCH, dist);
  return { eye, target: [0, 0, 0], fov: FOV, aspect: 1, w: SIZE, h: SIZE, near: 0.02 };
}

type Hit = { face: number; cu: number; cv: number };
const cellKey = (h: Hit) => `${h.face}:${h.cu}:${h.cv}`;

function pickFace(cam: CameraSnap, sx: number, sy: number): Hit | null {
  const { o, d } = screenRay(cam, sx, sy);
  let best: Hit | null = null;
  let bestT = Infinity;
  FACES.forEach((f, i) => {
    const denom = dot(d, f.normal);
    if (denom >= -1e-6) return;
    const t = dot(sub(f.corner, o), f.normal) / denom;
    if (t <= 1e-3 || t >= bestT) return;
    const hit = add(o, mul(d, t));
    const rel = sub(hit, f.corner);
    const u = dot(rel, f.uDir), v = dot(rel, f.vDir);
    if (u < 0 || u > f.uLen || v < 0 || v > f.vLen) return;
    bestT = t;
    best = { face: i, cu: Math.floor(u / CELL), cv: Math.floor(v / CELL) };
  });
  return best;
}

type Proj = { x: number; y: number; front: boolean };

function Seg(props: { a: Proj; b: Proj; color: string; thick: number; opacity?: number }) {
  const { a, b } = props;
  if (!a.front || !b.front) return null;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 0.001;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return <Box style={{ position: 'absolute', left: (a.x + b.x) / 2 - len / 2, top: (a.y + b.y) / 2 - props.thick / 2, width: len, height: props.thick, borderRadius: props.thick / 2, backgroundColor: props.color, opacity: props.opacity ?? 1, transform: { rotate: angle } }} />;
}

function Chip(props: { label: string; active: boolean; swatch?: string; onPress: () => void }) {
  return (
    <Pressable onMouseDown={props.onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: props.active ? '#27324b' : '#161b26', borderWidth: 1, borderColor: props.active ? '#5fe0bf' : '#2a3140' }}>
      {props.swatch ? <Box style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: props.swatch }} /> : null}
      <Text style={{ fontSize: 12, color: props.active ? '#dfe9f5' : '#8aa0bd' }}>{props.label}</Text>
    </Pressable>
  );
}

export default function PaintOn3DDemo() {
  const [tick, setTick] = useState(0);
  const [painted, setPainted] = useState<Record<string, number>>({}); // cell -> SLOT id (pseudo-colour, never RGB)
  const [activeSlot, setActiveSlot] = useState(0);
  const [view, setView] = useState<'pseudo' | 'final'>('pseudo');
  const [variant, setVariant] = useState(0);
  const hoverRef = useRef<Hit | null>(null);
  const drawingRef = useRef(false);
  const tickRef = useRef(0);
  const slotRef = useRef(0);
  const rectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  tickRef.current = tick;
  slotRef.current = activeSlot;

  useEffect(() => {
    const host: any = globalThis as any;
    const id = setInterval(() => {
      setTick((prev) => {
        const next = drawingRef.current ? prev : prev + 1;
        const r = rectRef.current;
        if (r && typeof host.getMouseX === 'function' && !drawingRef.current) {
          const mx = Number(host.getMouseX()), my = Number(host.getMouseY());
          const inside = mx >= r.x && mx <= r.x + r.width && my >= r.y && my <= r.y + r.height;
          hoverRef.current = inside ? pickFace(camAt(next), mx - r.x, my - r.y) : null;
        }
        return next;
      });
    }, 33);
    return () => clearInterval(id);
  }, []);

  // paint the cell under a screen point with the active SLOT id (not a colour).
  const paintAt = (screenX: number, screenY: number) => {
    const r = rectRef.current;
    if (!r) return;
    const hit = pickFace(camAt(tickRef.current), screenX - r.x, screenY - r.y);
    if (!hit) return;
    const key = cellKey(hit);
    setPainted((p) => (p[key] === slotRef.current ? p : { ...p, [key]: slotRef.current }));
  };

  const cam = camAt(tick);
  const project = makeProjector(cam);
  const proj = (p: V3): Proj => { const q = project(p); return { x: q.x, y: q.y, front: q.front }; };
  const hover = hoverRef.current;
  const C = SIZE / 2;

  // resolve a painted slot to a display colour: the pseudo placeholder, or the
  // chosen palette variant's colour for that slot. Same cells, swappable palette.
  const colorOf = (slot: number) => (view === 'pseudo' ? SLOTS[slot].pseudo : VARIANTS[variant].colors[slot]);

  const fills: any[] = [];
  for (const key in painted) {
    const [fs, cus, cvs] = key.split(':');
    const f = FACES[Number(fs)];
    if (!f || !faceVisible(f, cam.eye)) continue;
    const cu = Number(cus), cv = Number(cvs);
    const u0 = cu * CELL, u1 = Math.min(u0 + CELL, f.uLen), v0 = cv * CELL, v1 = Math.min(v0 + CELL, f.vLen);
    const q = [facePoint(f, u0, v0), facePoint(f, u1, v0), facePoint(f, u1, v1), facePoint(f, u0, v1)].map(proj);
    if (!q.every((p) => p.front)) continue;
    const d = `M ${q[0].x - C},${q[0].y - C} L ${q[1].x - C},${q[1].y - C} L ${q[2].x - C},${q[2].y - C} L ${q[3].x - C},${q[3].y - C} Z`;
    fills.push(<Graph.Path key={key} d={d} fill={colorOf(painted[key])} />);
  }

  const lines: any[] = [];
  FACES.forEach((f, fi) => {
    if (!faceVisible(f, cam.eye)) return;
    const corners = [facePoint(f, 0, 0), facePoint(f, f.uLen, 0), facePoint(f, f.uLen, f.vLen), facePoint(f, 0, f.vLen)].map(proj);
    for (let i = 0; i < 4; i++) lines.push(<Seg key={`o${fi}-${i}`} a={corners[i]} b={corners[(i + 1) % 4]} color="#7fd6c0" thick={1.6} opacity={0.85} />);
    for (let u = CELL; u < f.uLen - 1e-4; u += CELL) lines.push(<Seg key={`gu${fi}-${u.toFixed(2)}`} a={proj(facePoint(f, u, 0))} b={proj(facePoint(f, u, f.vLen))} color="#4fb8a0" thick={1.0} opacity={0.5} />);
    for (let v = CELL; v < f.vLen - 1e-4; v += CELL) lines.push(<Seg key={`gv${fi}-${v.toFixed(2)}`} a={proj(facePoint(f, 0, v))} b={proj(facePoint(f, f.uLen, v))} color="#4fb8a0" thick={1.0} opacity={0.5} />);
    if (hover && hover.face === fi) {
      const u0 = hover.cu * CELL, u1 = Math.min(u0 + CELL, f.uLen), v0 = hover.cv * CELL, v1 = Math.min(v0 + CELL, f.vLen);
      const hc = [facePoint(f, u0, v0), facePoint(f, u1, v0), facePoint(f, u1, v1), facePoint(f, u0, v1)].map(proj);
      for (let i = 0; i < 4; i++) lines.push(<Seg key={`hc${fi}-${i}`} a={hc[i]} b={hc[(i + 1) % 4]} color={SLOTS[activeSlot].pseudo} thick={3} />);
    }
  });

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0b0d13', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
      <Text style={{ fontSize: 14, color: '#7f93b1', letterSpacing: 1 }}>
        paint SLOTS (pseudo-colour) once — recolour the same cells by swapping the palette
      </Text>
      {/* toolbar: pick the slot you paint, toggle pseudo/painted view, cycle the palette variant */}
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {SLOTS.map((s) => <Chip key={s.id} label={s.name} swatch={s.pseudo} active={activeSlot === s.id} onPress={() => setActiveSlot(s.id)} />)}
        <Box style={{ width: 1, height: 22, backgroundColor: '#2a3140', marginLeft: 4, marginRight: 4 }} />
        <Chip label={view === 'pseudo' ? 'View: Pseudo' : 'View: Painted'} active={false} onPress={() => setView((v) => (v === 'pseudo' ? 'final' : 'pseudo'))} />
        <Chip label={`Variant: ${VARIANTS[variant].name}`} active={view === 'final'} swatch={VARIANTS[variant].colors[0]} onPress={() => { setView('final'); setVariant((v) => (v + 1) % VARIANTS.length); }} />
      </Box>
      <Box onLayout={(r: any) => { rectRef.current = r; }} style={{ width: SIZE, height: SIZE, position: 'relative', borderRadius: 10, overflow: 'hidden' }}>
        <Scene3D style={{ position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE }}>
          <Scene3D.Camera position={cam.eye} target={[0, 0, 0]} fov={FOV} />
          <Scene3D.AmbientLight color="#ffffff" intensity={0.55} />
          <Scene3D.DirectionalLight direction={[0.4, 1, 0.3]} color="#ffffff" intensity={0.7} />
          <Scene3D.Fog enabled={false} />
          <Scene3D.Mesh geometry={Geom.box} params={{ width: 2 * HX, height: 2 * HY, depth: 2 * HZ }} material={{ color: '#caa6e0' }} position={[0, 0, 0]} />
        </Scene3D>
        <Graph style={{ position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE, pointerEvents: 'none' }} viewX={0} viewY={0} viewZoom={1}>
          {fills}
        </Graph>
        <Box style={{ position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE, pointerEvents: 'none', overflow: 'visible' }}>{lines}</Box>
        <Pressable
          style={{ position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE, backgroundColor: '#00000000' }}
          onMouseDown={(e: any) => { drawingRef.current = true; paintAt(e.x, e.y); }}
          onMouseMove={(e: any) => { if (drawingRef.current) paintAt(e.x, e.y); }}
          onMouseUp={() => { drawingRef.current = false; }}
          onMouseLeave={() => { drawingRef.current = false; }}
        />
      </Box>
    </Box>
  );
}
