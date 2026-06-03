// head_lab — paint a head into existence.
//
// The user's pipeline, verbatim: take a face picture, put it on a HEAD-SHAPED
// unwrap (not a flat plane), paint depth over it with a brush, and the painted
// rectangle wraps back around a 3D head. The paint surface IS the unwrap —
// photo, depth strokes, and the head's texture all live in the same 2:1
// equirect space (Geometry.Globe), so nothing ever needs un/re-wrapping.
//
//   left:  the unwrap canvas — skin base, dropped photo (position/scale knobs),
//          heat overlay = painted depth (blue = raised, orange = carved in)
//   right: the live 3D head — drag orbits; mesh re-sculpts on stroke release
//
// Depth is SIGNED around a neutral midpoint: `raise` pushes the surface out
// (nose, brow, chin), `lower` carves in (eye sockets, temples), `flatten`
// erases back to the bare skull. Strokes paint straight into a GPU texture
// (usePaintable) and the overlay is one <Effect> quad sampling it — no React
// re-render happens while the brush moves; only releasing a stroke reads the
// texture back and re-sculpts the mesh.
//
// Ship: ./scripts/ship head_lab      Dev: ./scripts/dev head_lab

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Col, Row, Effect, Image, Paintable, Pressable, Text, Scene3D, StaticSurface } from '@reactjit/runtime/primitives';
import { useFileDrop } from '@reactjit/runtime/hooks/useFileDrop';
import { usePaintable } from '@reactjit/runtime/hooks/usePaintable';
import { readFile, writeFile, mkdir } from '@reactjit/runtime/hooks/fs';
import * as Geometry from '@reactjit/geometries';
import { OrbitCamera } from '@reactjit/cameras';
import {
  buildHed, parseHed, serializeHed, generateFace, hedDepthGrid,
  type HedDocument, type HedLayer,
} from './hed';

const BG = '#0b1018';
const INK = '#e8eef8';
const DIM = '#7f93b1';
const ACCENT = '#3da9ff';

// Unwrap canvas + bake share these dims (2:1 equirect).
const UNWRAP_W = 512;
const UNWRAP_H = 256;
// Depth lives at two resolutions: the GPU paint texture (smooth brushing) and
// the mesh displacement grid it downsamples to on stroke release (4×4 blocks).
const PAINT_W = 192;
const PAINT_H = 96;
const GRID_W = 48;
const GRID_H = 24;
// R8 midpoint = flat. Above raises, below carves in.
const NEUTRAL = 0.5;

const SKINS = ['#caa07a', '#8d5a3c', '#e0b48c', '#a9785a'];

type Mode = 'raise' | 'lower' | 'flatten';

// Heat overlay shader: samples the paint texture, tints raised regions blue
// and carved regions orange, stays transparent at neutral so the photo reads
// through. Declares the FULL textures-mode binding set (2 tex + 2 samp) like
// cutout's MaskQuad shaders — the textures-enabled pipeline layout expects all
// four slots; unused ones fall through to the framework's dummy 1×1.
// (No backticks in WGSL — they'd close the JS template literal.)
const DEPTH_OVERLAY_WGSL = `
@group(0) @binding(1) var<storage, read> data: array<f32>;
@group(0) @binding(2) var depth_tex: texture_2d<f32>;
@group(0) @binding(3) var depth_samp: sampler;
@group(0) @binding(4) var unused_tex: texture_2d<f32>;
@group(0) @binding(5) var unused_samp: sampler;

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let v = textureSampleLevel(depth_tex, depth_samp, in.uv, 0.0).r - 0.5;
  let a = clamp(abs(v) * 2.0, 0.0, 1.0) * 0.55;
  let raised = vec3f(0.24, 0.66, 1.0);
  let carved = vec3f(1.0, 0.58, 0.2);
  let tint = select(carved, raised, v > 0.0);
  return vec4f(tint * a, a);
}
`;

type Photo = { path: string; stamp: number };

// The .hed feature layers as paint: every colored shape (plus its mirror twin)
// is one absolutely-positioned Box in unwrap px. Depth-only layers (color
// null) draw nothing here — they exist purely in the displacement grid.
function HedLayerPaint(props: { layers: HedLayer[] }) {
  const boxes: any[] = [];
  for (const layer of props.layers) {
    if (!layer.color) continue;
    layer.shapes.forEach((s, si) => {
      const centers = s.mirror ? [s.cx, 1 - s.cx] : [s.cx];
      centers.forEach((cx, ci) => {
        const w = s.rx * 2 * UNWRAP_W;
        const h = s.ry * 2 * UNWRAP_H;
        boxes.push(
          <Box
            key={`${layer.id}.${si}.${ci}`}
            style={{
              position: 'absolute',
              left: cx * UNWRAP_W - w / 2,
              top: s.cy * UNWRAP_H - h / 2,
              width: w,
              height: h,
              backgroundColor: layer.color,
              borderRadius: s.kind === 'ellipse' ? Math.min(w, h) / 2 : 2,
            }}
          />,
        );
      });
    });
  }
  return <>{boxes}</>;
}

// ── the unwrap composition — rendered TWICE: once as the visible paint canvas
// (with the heat overlay on top) and once inside the StaticSurface bake that
// the head samples. One component, so display and texture can never disagree.
// Stack: skin base → photo → .hed feature layers.
function UnwrapContent(props: { skin: string; photo: Photo | null; photoScale: number; photoY: number; layers: HedLayer[] | null }) {
  const side = props.photoScale * UNWRAP_W;
  return (
    <Box style={{ width: UNWRAP_W, height: UNWRAP_H, backgroundColor: props.skin, position: 'relative', overflow: 'hidden' }}>
      {props.photo ? (
        <Image
          src={props.photo.path}
          style={{
            position: 'absolute',
            left: UNWRAP_W / 2 - side / 2,
            top: UNWRAP_H / 2 - side / 2 + props.photoY,
            width: side,
            height: side,
          }}
        />
      ) : null}
      {props.layers ? <HedLayerPaint layers={props.layers} /> : null}
    </Box>
  );
}

function Knob(props: { label: string; value: string; onMinus: () => void; onPlus: () => void }) {
  const btn = { width: 24, height: 24, borderRadius: 5, borderWidth: 1, borderColor: '#22324a', backgroundColor: '#101a2a', alignItems: 'center' as const, justifyContent: 'center' as const };
  return (
    <Row style={{ alignItems: 'center', gap: 6 }}>
      <Text fontSize={11} color={DIM} style={{ width: 84 }}>{props.label}</Text>
      <Pressable onPress={props.onMinus} style={btn}><Text fontSize={13} color={INK}>-</Text></Pressable>
      <Text fontSize={12} color={INK} style={{ width: 46, textAlign: 'center' }}>{props.value}</Text>
      <Pressable onPress={props.onPlus} style={btn}><Text fontSize={13} color={INK}>+</Text></Pressable>
    </Row>
  );
}

export default function HeadLab() {
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoScale, setPhotoScale] = useState(0.4);
  const [photoY, setPhotoY] = useState(0);
  const [skin, setSkin] = useState(SKINS[0]);
  const [brush, setBrush] = useState(14); // paint-texture px
  const [strength, setStrength] = useState(0.5);
  const [mode, setMode] = useState<Mode>('raise');
  const [amount, setAmount] = useState(0.35);
  const [scaleY, setScaleY] = useState(1.2);
  const [yaw, setYaw] = useState(20);
  const [pitch, setPitch] = useState(12);
  const [dist, setDist] = useState(4.2);
  // The mesh's displacement grid (signed −1..1), refreshed from the paint
  // texture on stroke release. This is the ONLY paint state React sees.
  const [grid, setGrid] = useState<number[]>(() => new Array(GRID_W * GRID_H).fill(0));
  // Bumped whenever the grid changes — versions the mesh's dynamicKey.
  const [sculptSeq, setSculptSeq] = useState(0);
  // The loaded/generated .hed face (feature layers); id versions keys/caches.
  const [face, setFace] = useState<{ doc: HedDocument; id: string } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const paintingRef = useRef(false);
  const canvasRect = useRef({ x: 0, y: 0, width: UNWRAP_W, height: UNWRAP_H });
  const orbitRef = useRef<{ x: number; y: number } | null>(null);

  // GPU paint surface. Strokes call straight into the host — zero re-renders.
  const depth = usePaintable({ id: 'headlab-depth', w: PAINT_W, h: PAINT_H });
  useEffect(() => { depth.paint.clear(NEUTRAL); }, []);

  // Apply a .hed document: knobs from the doc, hand-sculpt residue into the
  // paint texture + grid, feature layers kept (with sculpt zeroed so it can't
  // double-count — the residue now lives in the paint texture).
  const applyDoc = (doc: HedDocument, id: string) => {
    setSkin(doc.skin);
    setAmount(doc.amount);
    setScaleY(doc.scaleY);
    const g = doc.sculpt.map((b) => b / 127);
    setGrid(g);
    setSculptSeq((s) => s + 1);
    const bytes = new Uint8Array(PAINT_W * PAINT_H);
    for (let py = 0; py < PAINT_H; py++) {
      const gy = Math.min(GRID_H - 1, Math.floor((py / PAINT_H) * GRID_H));
      for (let px = 0; px < PAINT_W; px++) {
        const gx = Math.min(GRID_W - 1, Math.floor((px / PAINT_W) * GRID_W));
        bytes[py * PAINT_W + px] = Math.max(0, Math.min(255, Math.round((g[gy * GRID_W + gx] / 2 + NEUTRAL) * 255)));
      }
    }
    depth.paint.upload(bytes);
    setFace({ doc: { ...doc, sculpt: new Array(doc.cols * doc.rows).fill(0) }, id });
  };

  const generate = () => {
    const seed = (Date.now() ^ Math.floor(Math.random() * 0xffff)) >>> 0;
    applyDoc(generateFace(seed), `gen${seed}`);
    setStatus(`generated face ${seed} — sculpt over it, or generate again`);
  };

  const saveHead = () => {
    mkdir('cart/heads');
    const stamp = Date.now();
    const doc = buildHed({
      skin, amount, scaleY,
      sculpt: grid,
      layers: face?.doc.layers ?? [],
      title: `head ${stamp}`,
      seed: face?.doc.metadata?.seed,
    });
    writeFile(`cart/heads/head_${stamp}.hed.json`, serializeHed(doc));
    setStatus(`saved cart/heads/head_${stamp}.hed.json — drop it back in to reload`);
  };

  // Drop: a .hed.json reloads a saved head; anything else is a face photo.
  useFileDrop((path) => {
    if (path.endsWith('.json')) {
      const text = readFile(path);
      const doc = text ? parseHed(text) : null;
      if (!doc) { setStatus(`${path.split('/').pop()} is not a .hed head document`); return; }
      applyDoc(doc, `load${Date.now()}`);
      setStatus(`loaded ${path.split('/').pop()}`);
      return;
    }
    setPhoto({ path, stamp: Date.now() });
  });

  const dab = (sx: number, sy: number) => {
    const r = canvasRect.current;
    const tx = ((sx - r.x) / r.width) * PAINT_W;
    const ty = ((sy - r.y) / r.height) * PAINT_H;
    const value = mode === 'flatten' ? NEUTRAL : mode === 'raise' ? NEUTRAL + 0.5 * strength : NEUTRAL - 0.5 * strength;
    depth.paint.circle(tx, ty, brush, value);
  };

  // Stroke release → read the paint texture back, average 4×4 blocks down to
  // the mesh grid, recenter to signed −1..1. The one expensive hop, once per
  // stroke instead of per mousemove.
  const syncGrid = () => {
    const bytes = depth.paint.readback();
    if (!bytes || bytes.length < PAINT_W * PAINT_H) return;
    const next = new Array(GRID_W * GRID_H).fill(0);
    const bx = PAINT_W / GRID_W;
    const by = PAINT_H / GRID_H;
    for (let gy = 0; gy < GRID_H; gy++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        let sum = 0;
        for (let oy = 0; oy < by; oy++) {
          for (let ox = 0; ox < bx; ox++) {
            sum += bytes[(gy * by + oy) * PAINT_W + gx * bx + ox];
          }
        }
        next[gy * GRID_W + gx] = (sum / (bx * by) / 255 - NEUTRAL) * 2;
      }
    }
    setGrid(next);
    setSculptSeq((s) => s + 1);
  };

  const onPaintDown = (e: any) => { paintingRef.current = true; dab(Number(e?.x ?? 0), Number(e?.y ?? 0)); };
  const onPaintMove = (e: any) => { if (paintingRef.current) dab(Number(e?.x ?? 0), Number(e?.y ?? 0)); };
  const onPaintUp = () => {
    if (!paintingRef.current) return;
    paintingRef.current = false;
    syncGrid();
  };

  const clearStrokes = () => {
    depth.paint.clear(NEUTRAL);
    setGrid(new Array(GRID_W * GRID_H).fill(0));
    setSculptSeq((s) => s + 1);
  };

  // Final displacement = hand sculpt (paint texture) + the face's feature
  // relief, clamped. Both live in the same grid space, so this is one add.
  const faceDepth = useMemo(() => (face ? hedDepthGrid(face.doc) : null), [face]);
  const displace = useMemo(
    () => (faceDepth ? grid.map((v, i) => Math.max(-1, Math.min(1, v + faceDepth[i]))) : grid),
    [grid, faceDepth],
  );

  // Geometry identity changes only on stroke release / knob change — the
  // interned mesh regenerates exactly then, never per mousemove.
  const params = useMemo(
    () => ({
      radius: 1, segments: 48, rings: 24,
      displace, dCols: GRID_W, dRows: GRID_H,
      amount, scaleY,
    }),
    [displace, amount, scaleY],
  );

  // Content-addressed texture key: the bake is a pure function of these values,
  // so a key can never serve a stale image (the carve_lab hot-reload lesson),
  // and stepping a knob back reuses the earlier bake.
  const texKey = `head.lab.${photo?.stamp ?? 'bare'}.${face?.id ?? 'noface'}.${skin}.${photoScale.toFixed(2)}.${photoY}`;
  const surfaceStyle = useMemo(
    () => ({ position: 'absolute' as const, left: -99999, top: 0, width: UNWRAP_W, height: UNWRAP_H }),
    [],
  );

  const orbitDown = (e: any) => { orbitRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) }; };
  const orbitMove = (e: any) => {
    const d = orbitRef.current;
    if (!d) return;
    const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
    setYaw((v) => v + (nx - d.x) * 0.4);
    setPitch((v) => Math.max(4, Math.min(85, v - (ny - d.y) * 0.3)));
    d.x = nx; d.y = ny;
  };
  const orbitUp = () => { orbitRef.current = null; };

  const modeBtn = (m: Mode, label: string, color: string) => (
    <Pressable
      onPress={() => setMode(m)}
      style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 5, borderWidth: 1, borderColor: mode === m ? color : '#22324a', backgroundColor: mode === m ? '#11263d' : '#101a2a' }}
    >
      <Text fontSize={12} color={mode === m ? color : DIM}>{label}</Text>
    </Pressable>
  );

  return (
    <Row style={{ width: '100%', height: '100%', backgroundColor: BG }}>
      {/* ── left: the unwrap painter ── */}
      <Col style={{ width: UNWRAP_W + 28, padding: 14, gap: 10 }}>
        <Text fontSize={15} color={INK} style={{ fontWeight: 900 }}>HEAD LAB</Text>
        <Text fontSize={11} color={DIM}>
          {status ?? (photo || face
            ? 'paint depth over the face — blue pushes out, orange carves in'
            : 'drop a face picture (or generate one), then paint depth over it')}
        </Text>
        <Pressable
          onLayout={(lr: any) => { canvasRect.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
          onMouseDown={onPaintDown}
          onMouseMove={onPaintMove}
          onMouseUp={onPaintUp}
          style={{ width: UNWRAP_W, height: UNWRAP_H, borderWidth: 1, borderColor: '#22324a', position: 'relative' }}
        >
          <UnwrapContent skin={skin} photo={photo} photoScale={photoScale} photoY={photoY} layers={face?.doc.layers ?? null} />
          <Effect
            shader={DEPTH_OVERLAY_WGSL}
            data={[0]}
            textures={[depth.id]}
            style={{ position: 'absolute', left: 0, top: 0, width: UNWRAP_W, height: UNWRAP_H }}
          />
        </Pressable>
        <Row style={{ gap: 8, alignItems: 'center' }}>
          {modeBtn('raise', 'raise', ACCENT)}
          {modeBtn('lower', 'carve in', '#ff9445')}
          {modeBtn('flatten', 'flatten', '#94a3b8')}
          <Pressable onPress={clearStrokes} style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 5, borderWidth: 1, borderColor: '#22324a', backgroundColor: '#101a2a' }}>
            <Text fontSize={12} color={DIM}>clear</Text>
          </Pressable>
        </Row>
        <Row style={{ gap: 8, alignItems: 'center' }}>
          <Pressable onPress={generate} style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 5, borderWidth: 1, borderColor: '#34d399', backgroundColor: '#0d2a20' }}>
            <Text fontSize={12} color="#34d399">generate face</Text>
          </Pressable>
          <Pressable onPress={saveHead} style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 5, borderWidth: 1, borderColor: '#22324a', backgroundColor: '#101a2a' }}>
            <Text fontSize={12} color={INK}>save head</Text>
          </Pressable>
          {face ? (
            <Pressable onPress={() => { setFace(null); setStatus(null); }} style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 5, borderWidth: 1, borderColor: '#22324a', backgroundColor: '#101a2a' }}>
              <Text fontSize={12} color={DIM}>remove face</Text>
            </Pressable>
          ) : null}
        </Row>
        <Row style={{ gap: 6, alignItems: 'center' }}>
          <Text fontSize={11} color={DIM} style={{ width: 84 }}>skin</Text>
          {SKINS.map((s) => (
            <Pressable key={s} onPress={() => setSkin(s)} style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: s, borderWidth: 2, borderColor: skin === s ? ACCENT : '#22324a' }} />
          ))}
        </Row>
        <Knob label="brush size" value={String(brush)} onMinus={() => setBrush((v) => Math.max(4, v - 2))} onPlus={() => setBrush((v) => Math.min(40, v + 2))} />
        <Knob label="strength" value={strength.toFixed(1)} onMinus={() => setStrength((v) => Math.max(0.1, v - 0.1))} onPlus={() => setStrength((v) => Math.min(1, v + 0.1))} />
        <Knob label="depth amount" value={amount.toFixed(2)} onMinus={() => setAmount((v) => Math.max(0.05, v - 0.05))} onPlus={() => setAmount((v) => Math.min(0.8, v + 0.05))} />
        <Knob label="skull stretch" value={scaleY.toFixed(2)} onMinus={() => setScaleY((v) => Math.max(0.9, v - 0.05))} onPlus={() => setScaleY((v) => Math.min(1.6, v + 0.05))} />
        <Knob label="photo size" value={photoScale.toFixed(2)} onMinus={() => setPhotoScale((v) => Math.max(0.15, v - 0.05))} onPlus={() => setPhotoScale((v) => Math.min(0.95, v + 0.05))} />
        <Knob label="photo up/down" value={String(photoY)} onMinus={() => setPhotoY((v) => v - 8)} onPlus={() => setPhotoY((v) => v + 8)} />
      </Col>

      {/* ── right: the live head ── */}
      <Pressable
        onMouseDown={orbitDown}
        onMouseMove={orbitMove}
        onMouseUp={orbitUp}
        style={{ flexGrow: 1, height: '100%', position: 'relative', overflow: 'hidden' }}
      >
        <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={BG} showGrid={false} showAxes={false}>
          <OrbitCamera target={[0, 1.4, 0]} yaw={yaw} pitch={pitch} dist={dist} fov={45} />
          <Scene3D.AmbientLight color="#aab8d6" intensity={0.6} />
          <Scene3D.DirectionalLight direction={[0.4, 0.9, 0.35]} color="#fff0d6" intensity={0.85} />
          <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 8, height: 0.03, depth: 8 }} material="#0e1726" position={[0, -0.015, 0]} />
          {/* dynamicKey routes the sculpt through ONE reused host geometry
              slot, overwritten per version — WITHOUT it every stroke release
              interns a brand-new mesh into the host's fixed static pool, and
              when that pool fills the head silently vanishes mid-session.
              Contract: equal key ⇒ equal verts, so the version encodes
              everything the verts depend on. */}
          <Scene3D.Mesh
            geometry={Geometry.Globe}
            params={params}
            dynamicKey={`headlab~${sculptSeq}.${face?.id ?? 'noface'}.${amount.toFixed(2)}.${scaleY.toFixed(2)}`}
            material="#ffffff"
            textureKey={texKey}
            position={[0, 1.4, 0]}
          />
        </Scene3D>
        <Box style={{ position: 'absolute', right: 14, bottom: 14 }}>
          <Knob label="zoom" value={dist.toFixed(1)} onMinus={() => setDist((v) => Math.max(1.6, v - 0.4))} onPlus={() => setDist((v) => Math.min(12, v + 0.4))} />
        </Box>
      </Pressable>

      {/* offscreen: the GPU paint texture + the unwrap baked to the head's
          texture. The Paintable MUST sit outside the flex flow (a bare host
          node here would take proportional-fallback space in the Row and blow
          up the whole layout). */}
      <Box style={{ position: 'absolute', left: -99999, top: 0, width: 1, height: 1 }}>
        <Paintable id={depth.id} w={PAINT_W} h={PAINT_H} />
      </Box>
      <StaticSurface staticKey={texKey} style={surfaceStyle}>
        <UnwrapContent skin={skin} photo={photo} photoScale={photoScale} photoY={photoY} layers={face?.doc.layers ?? null} />
      </StaticSurface>
    </Row>
  );
}
