// head_lab — paint a whole character into existence.
//
// The pipeline, designed turn by turn with the user: every body part is the
// SAME sculptable surface (Geometry.Globe) wearing a different silhouette
// profile — head egg, tall+wide torso barrel, ONE limb pipe placed eight
// times (upper/fore arms and thighs/shins both), wide flat hand and foot
// blocks. Each part has a 2:1 unwrap you paint depth onto; the head also
// carries .hed feature layers (generated faces, photo, animations). Nothing
// is ever unwrapped or re-wrapped — paint space IS texture space IS sculpt
// space, per part.
//
//   left:  part tabs + the selected part's unwrap painter
//          (blue = raised, orange = carved in)
//   right: the selected part alone, or the ASSEMBLED FIGURE (view toggle)
//
// Strokes paint straight into a per-part GPU texture (usePaintable); the
// overlay is one <Effect> quad; React only sees a stroke on release (readback
// → 48×24 grid → mesh re-sculpt through a dynamic geometry slot).
//
// Documents: .hed.json = a head (face layers + sculpt). .body.json = the
// whole character (all five part sculpts + the face). Drop either back in.
//
// Ship: ./scripts/ship head_lab      Dev: ./scripts/dev head_lab

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Col, Row, Effect, Image, Paintable, Pressable, Text, Scene3D, StaticSurface } from '@reactjit/runtime/primitives';
import { useFileDrop } from '@reactjit/runtime/hooks/useFileDrop';
import { usePaintable, type PaintableHandle } from '@reactjit/runtime/hooks/usePaintable';
import { readFile, writeFile, mkdir } from '@reactjit/runtime/hooks/fs';
import * as Geometry from '@reactjit/geometries';
import { OrbitCamera } from '@reactjit/cameras';
import {
  buildHed, parseHed, serializeHed, generateFace, hedDepthGrid,
  animateHed, HED_ANIM_FRAMES,
  type HedDocument, type HedLayer, type HedAnimation,
} from './hed';
import {
  PART_IDS, PART_PRESETS, ASSEMBLY, buildBody, parseBody, serializeBody,
  type PartId,
} from './parts';

const BG = '#0b1018';
const INK = '#e8eef8';
const DIM = '#7f93b1';
const ACCENT = '#3da9ff';
const GOOD = '#34d399';

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
type View = 'part' | 'figure';

// Painter overlay shader. Three layers in one quad:
//   1. live stroke heat — blue raised / orange carved (the paint texture)
//   2. CONTOUR RINGS of the current form — the combined relief (sculpt +
//      face features) rides in the second texture slot; a topo line every
//      1/12 of full depth, tinted by direction and faded where flat, shows
//      where the surface already curves before you stroke
//   3. faint unwrap guides — front meridian (u=.5), side/ear meridians
//      (u=.25/.75), equator — so you always know where on the head you are
// Declares the FULL textures-mode binding set (2 tex + 2 samp) like cutout's
// MaskQuad shaders — the textures-enabled pipeline layout expects all four.
// (No backticks in WGSL — they'd close the JS template literal.)
const DEPTH_OVERLAY_WGSL = `
@group(0) @binding(1) var<storage, read> data: array<f32>;
@group(0) @binding(2) var depth_tex: texture_2d<f32>;
@group(0) @binding(3) var depth_samp: sampler;
@group(0) @binding(4) var relief_tex: texture_2d<f32>;
@group(0) @binding(5) var relief_samp: sampler;

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let live = textureSampleLevel(depth_tex, depth_samp, in.uv, 0.0).r - 0.5;
  let relief = textureSampleLevel(relief_tex, relief_samp, in.uv, 0.0).r - 0.5;

  let raised = vec3f(0.24, 0.66, 1.0);
  let carved = vec3f(1.0, 0.58, 0.2);

  // contour rings of the current form, faded out where the surface is flat
  let levels = 12.0;
  let t = fract(abs(relief) * levels);
  let ring = 1.0 - smoothstep(0.0, 0.18, min(t, 1.0 - t));
  let contour_a = ring * 0.3 * smoothstep(0.01, 0.05, abs(relief));
  let contour_c = select(carved, raised, relief > 0.0);

  // unwrap guides
  let gx = min(abs(in.uv.x - 0.5), min(abs(in.uv.x - 0.25), abs(in.uv.x - 0.75)));
  let gy = abs(in.uv.y - 0.5);
  let guide_a = max((1.0 - smoothstep(0.0015, 0.0035, gx)) * 0.13,
                    (1.0 - smoothstep(0.003, 0.007, gy)) * 0.09);

  // live stroke heat
  let heat_a = clamp(abs(live) * 2.0, 0.0, 1.0) * 0.5;
  let heat_c = select(carved, raised, live > 0.0);

  let ink = vec3f(0.07, 0.1, 0.16);
  let color = heat_c * heat_a + contour_c * contour_a + ink * guide_a;
  let a = min(heat_a + contour_a + guide_a, 0.85);
  return vec4f(color, a);
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

// ── the unwrap composition — rendered for display AND inside the StaticSurface
// bakes, so canvas and texture can never disagree. Stack: skin base → photo
// (head only) → .hed feature layers (head only).
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

function Chip(props: { label: string; active: boolean; color?: string; onPress: () => void }) {
  const color = props.color ?? ACCENT;
  return (
    <Pressable
      onPress={props.onPress}
      style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 5, borderWidth: 1, borderColor: props.active ? color : '#22324a', backgroundColor: props.active ? '#11263d' : '#101a2a' }}
    >
      <Text fontSize={12} color={props.active ? color : DIM}>{props.label}</Text>
    </Pressable>
  );
}

const emptyGrid = () => new Array(GRID_W * GRID_H).fill(0);
const emptyGrids = (): Record<PartId, number[]> =>
  Object.fromEntries(PART_IDS.map((id) => [id, emptyGrid()])) as Record<PartId, number[]>;

// The 3D meshes, memo'd HARD. Orbit drag updates yaw/pitch per mousemove and
// re-renders the whole cart — and every mesh node carries the full sculpt
// vertex payload through the reconciler, so re-diffing ~14 of them per move
// is the lag. Props here are stable identities (one useMemo bundle), so a
// drag re-renders ONLY the camera node; the meshes update on sculpt/knob/
// animation changes alone. Same perf isolation hmsc's GameWorld3D uses.
type PartRender = { params: any; dynKey: string; texKey: string };
const PartMeshes = memo(function PartMeshes(props: { view: View; selPart: PartId; parts: Record<PartId, PartRender> }) {
  if (props.view === 'part') {
    const p = props.parts[props.selPart];
    return (
      <Scene3D.Mesh
        geometry={Geometry.Globe}
        params={p.params}
        dynamicKey={p.dynKey}
        material="#ffffff"
        textureKey={p.texKey}
        position={[0, 1.4, 0]}
      />
    );
  }
  return (
    <>
      {ASSEMBLY.map((inst, i) => {
        const p = props.parts[inst.part];
        return (
          <Scene3D.Mesh
            key={i}
            geometry={Geometry.Globe}
            params={p.params}
            dynamicKey={p.dynKey}
            material="#ffffff"
            textureKey={p.texKey}
            position={inst.position}
            rotation={inst.rotation ?? [0, 0, 0]}
            scale={inst.thickness != null ? [inst.scale * inst.thickness, inst.scale, inst.scale * inst.thickness] : inst.scale}
          />
        );
      })}
    </>
  );
});

export default function HeadLab() {
  const [selPart, setSelPart] = useState<PartId>('head');
  const [view, setView] = useState<View>('part');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoScale, setPhotoScale] = useState(0.4);
  const [photoY, setPhotoY] = useState(0);
  const [skin, setSkin] = useState(SKINS[0]);
  const [brush, setBrush] = useState(14); // paint-texture px
  const [strength, setStrength] = useState(0.5);
  const [mode, setMode] = useState<Mode>('raise');
  // Symmetry brush: every dab also lands mirrored across the front meridian.
  const [mirror, setMirror] = useState(true);
  const [amount, setAmount] = useState(0.35);
  const [scaleY, setScaleY] = useState(1.2); // head skull stretch
  const [yaw, setYaw] = useState(20);
  const [pitch, setPitch] = useState(12);
  const [dist, setDist] = useState(4.2);
  // Per-part displacement grids (signed −1..1) + per-part sculpt versions.
  const [grids, setGrids] = useState<Record<PartId, number[]>>(emptyGrids);
  const [seqs, setSeqs] = useState<Record<PartId, number>>(
    () => Object.fromEntries(PART_IDS.map((id) => [id, 0])) as Record<PartId, number>,
  );
  // The loaded/generated .hed face (feature layers); id versions keys/caches.
  const [face, setFace] = useState<{ doc: HedDocument; id: string } | null>(null);
  // Playing animation + its frame clock (setInterval — the cart host has no
  // requestAnimationFrame). Phase is frame % loop length, so every key the
  // animation produces is one of a small cycling set: N cached bakes total.
  const [anim, setAnim] = useState<HedAnimation | null>(null);
  const [animFrame, setAnimFrame] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const paintingRef = useRef(false);
  const canvasRect = useRef({ x: 0, y: 0, width: UNWRAP_W, height: UNWRAP_H });
  const orbitRef = useRef<{ x: number; y: number } | null>(null);

  // One GPU paint surface PER PART (PART_IDS is constant → stable hook order).
  // Strokes call straight into the host — zero re-renders while brushing.
  const paints = {} as Record<PartId, PaintableHandle>;
  for (const id of PART_IDS) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- fixed-length constant list
    paints[id] = usePaintable({ id: `bodylab-${id}`, w: PAINT_W, h: PAINT_H });
  }
  useEffect(() => { for (const id of PART_IDS) paints[id].paint.clear(NEUTRAL); }, []);
  // The selected part's combined relief (sculpt + face features) as a small
  // texture — the overlay's contour-ring layer samples it.
  const relief = usePaintable({ id: 'bodylab-relief', w: GRID_W, h: GRID_H });

  // Animation clock — only ticks while something is playing on a face.
  useEffect(() => {
    if (!anim || !face) return;
    const iv = setInterval(() => setAnimFrame((f) => f + 1), 150);
    return () => clearInterval(iv);
  }, [anim, !!face]);

  // The doc the canvas/bake/mesh actually show: the face with the playing
  // animation's frame applied (a pure transform — base doc stays untouched,
  // so save/sculpt always work on the still face).
  const phase = anim ? animFrame % HED_ANIM_FRAMES[anim] : 0;
  const shownDoc = useMemo(
    () => (face ? (anim ? animateHed(face.doc, anim, phase) : face.doc) : null),
    [face, anim, phase],
  );

  // Write a signed grid into a part's paint texture (nearest-upscaled).
  const uploadGrid = (id: PartId, g: number[]) => {
    const bytes = new Uint8Array(PAINT_W * PAINT_H);
    for (let py = 0; py < PAINT_H; py++) {
      const gy = Math.min(GRID_H - 1, Math.floor((py / PAINT_H) * GRID_H));
      for (let px = 0; px < PAINT_W; px++) {
        const gx = Math.min(GRID_W - 1, Math.floor((px / PAINT_W) * GRID_W));
        bytes[py * PAINT_W + px] = Math.max(0, Math.min(255, Math.round((g[gy * GRID_W + gx] / 2 + NEUTRAL) * 255)));
      }
    }
    paints[id].paint.upload(bytes);
  };

  const setPartGrid = (id: PartId, g: number[]) => {
    setGrids((prev) => ({ ...prev, [id]: g }));
    setSeqs((prev) => ({ ...prev, [id]: prev[id] + 1 }));
  };

  // Apply a .hed document to the HEAD: knobs from the doc, hand-sculpt residue
  // into the paint texture + grid, feature layers kept (with sculpt zeroed so
  // it can't double-count — the residue now lives in the paint texture).
  const applyDoc = (doc: HedDocument, id: string) => {
    setSkin(doc.skin);
    setAmount(doc.amount);
    setScaleY(doc.scaleY);
    const g = doc.sculpt.map((b) => b / 127);
    setPartGrid('head', g);
    uploadGrid('head', g);
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
      sculpt: grids.head,
      layers: face?.doc.layers ?? [],
      title: `head ${stamp}`,
      seed: face?.doc.metadata?.seed,
    });
    writeFile(`cart/heads/head_${stamp}.hed.json`, serializeHed(doc));
    setStatus(`saved cart/heads/head_${stamp}.hed.json — drop it back in to reload`);
  };

  const saveBody = () => {
    mkdir('cart/heads');
    const stamp = Date.now();
    const doc = buildBody({
      skin, amount, headScaleY: scaleY,
      sculpts: grids,
      headLayers: face?.doc.layers ?? [],
      title: `body ${stamp}`,
    });
    writeFile(`cart/heads/body_${stamp}.body.json`, serializeBody(doc));
    setStatus(`saved cart/heads/body_${stamp}.body.json — the whole character`);
  };

  const loadBody = (doc: ReturnType<typeof parseBody> & {}) => {
    if (!doc) return;
    setSkin(doc.skin);
    setAmount(doc.amount);
    setScaleY(doc.headScaleY);
    const nextGrids = emptyGrids();
    for (const id of PART_IDS) {
      const sculpt = doc.parts[id]?.sculpt ?? [];
      const g = sculpt.length === GRID_W * GRID_H ? sculpt.map((b: number) => b / 127) : emptyGrid();
      nextGrids[id] = g;
      uploadGrid(id, g);
    }
    setGrids(nextGrids);
    setSeqs((prev) => Object.fromEntries(PART_IDS.map((id) => [id, prev[id] + 1])) as Record<PartId, number>);
    const headLayers = doc.parts.head?.layers ?? [];
    if (headLayers.length > 0) {
      setFace({
        doc: {
          kind: 'hed', version: 1, cols: GRID_W, rows: GRID_H,
          skin: doc.skin, amount: doc.amount, scaleY: doc.headScaleY,
          sculpt: emptyGrid(), layers: headLayers,
        },
        id: `body${Date.now()}`,
      });
    } else {
      setFace(null);
    }
  };

  // Drop: .body.json = whole character, .hed.json = a head, else a face photo.
  useFileDrop((path) => {
    if (path.endsWith('.body.json')) {
      const text = readFile(path);
      const doc = text ? parseBody(text) : null;
      if (!doc) { setStatus(`${path.split('/').pop()} is not a .body document`); return; }
      loadBody(doc);
      setStatus(`loaded ${path.split('/').pop()}`);
      return;
    }
    if (path.endsWith('.json')) {
      const text = readFile(path);
      const doc = text ? parseHed(text) : null;
      if (!doc) { setStatus(`${path.split('/').pop()} is not a .hed head document`); return; }
      setSelPart('head');
      applyDoc(doc, `load${Date.now()}`);
      setStatus(`loaded ${path.split('/').pop()}`);
      return;
    }
    setSelPart('head');
    setPhoto({ path, stamp: Date.now() });
  });

  const modeValue = () =>
    mode === 'flatten' ? NEUTRAL : mode === 'raise' ? NEUTRAL + 0.5 * strength : NEUTRAL - 0.5 * strength;

  const dab = (sx: number, sy: number) => {
    const r = canvasRect.current;
    const tx = ((sx - r.x) / r.width) * PAINT_W;
    const ty = ((sy - r.y) / r.height) * PAINT_H;
    const value = modeValue();
    paints[selPart].paint.circle(tx, ty, brush, value);
    // symmetry: also dab mirrored across the front meridian (u=0.5) — limbs
    // and faces are symmetric, so one stroke does both sides
    if (mirror) {
      const mx = PAINT_W - tx;
      if (Math.abs(mx - tx) > 2) paints[selPart].paint.circle(mx, ty, brush, value);
    }
  };

  // bytes (paint-texture R8) → mesh grid: average 4×4 blocks, recenter signed.
  const gridFromBytes = (bytes: Uint8Array): number[] => {
    const next = emptyGrid();
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
    return next;
  };

  // Stroke release → read the paint texture back into the mesh grid. The one
  // expensive hop, once per stroke instead of per mousemove.
  const syncGrid = () => {
    const bytes = paints[selPart].paint.readback();
    if (!bytes || bytes.length < PAINT_W * PAINT_H) return;
    setPartGrid(selPart, gridFromBytes(bytes));
  };

  const onPaintDown = (e: any) => { paintingRef.current = true; dab(Number(e?.x ?? 0), Number(e?.y ?? 0)); };
  const onPaintMove = (e: any) => { if (paintingRef.current) dab(Number(e?.x ?? 0), Number(e?.y ?? 0)); };
  const onPaintUp = () => {
    if (!paintingRef.current) return;
    paintingRef.current = false;
    syncGrid();
  };

  const clearStrokes = () => {
    paints[selPart].paint.clear(NEUTRAL);
    setPartGrid(selPart, emptyGrid());
  };

  // One-click whole-part raise/carve at the current mode+strength — what the
  // user was doing by scrubbing the brush over the entire unwrap. The result
  // is uniform, so the grid is computed directly (no readback race with the
  // queued clear op).
  const fillAll = () => {
    const value = modeValue();
    paints[selPart].paint.clear(value);
    setPartGrid(selPart, new Array(GRID_W * GRID_H).fill((value - NEUTRAL) * 2));
  };

  // 3×3 box blur over the paint texture — evens out lumpy hand strokes.
  const soften = () => {
    const p = paints[selPart].paint;
    const src = p.readback();
    if (!src || src.length < PAINT_W * PAINT_H) return;
    const out = new Uint8Array(PAINT_W * PAINT_H);
    for (let y = 0; y < PAINT_H; y++) {
      for (let x = 0; x < PAINT_W; x++) {
        let sum = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy, xx = x + dx;
            if (xx < 0 || yy < 0 || xx >= PAINT_W || yy >= PAINT_H) continue;
            sum += src[yy * PAINT_W + xx];
            n++;
          }
        }
        out[y * PAINT_W + x] = Math.round(sum / n);
      }
    }
    p.upload(out);
    setPartGrid(selPart, gridFromBytes(out));
  };

  // Final HEAD displacement = hand sculpt + the face's feature relief (the
  // shown doc, so a playing animation moves the geometry too).
  const faceDepth = useMemo(() => (shownDoc ? hedDepthGrid(shownDoc) : null), [shownDoc]);
  const headDisplace = useMemo(
    () => (faceDepth ? grids.head.map((v, i) => Math.max(-1, Math.min(1, v + faceDepth[i]))) : grids.head),
    [grids.head, faceDepth],
  );

  // Keep the overlay's contour texture in sync with the selected part's
  // current form, packed around the same midpoint convention as the brush.
  const selDisplace = selPart === 'head' ? headDisplace : grids[selPart];
  useEffect(() => {
    const bytes = new Uint8Array(GRID_W * GRID_H);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.max(0, Math.min(255, Math.round((selDisplace[i] / 2 + NEUTRAL) * 255)));
    }
    relief.paint.upload(bytes);
  }, [selDisplace]);

  // Per-part geometry. All meshes ride dynamic geometry slots (one per part),
  // so only the KEY matters for regeneration — params can be built inline.
  const partDisplace = (id: PartId) => (id === 'head' ? headDisplace : grids[id]);
  const partParams = (id: PartId) => {
    const preset = PART_PRESETS[id];
    return {
      radius: 1, segments: 48, rings: 24,
      displace: partDisplace(id), dCols: GRID_W, dRows: GRID_H,
      amount,
      profile: preset.profile,
      scaleX: preset.scaleX,
      scaleY: id === 'head' ? scaleY : preset.scaleY,
      scaleZ: preset.scaleZ,
    };
  };
  const partDynKey = (id: PartId) => {
    const headBits = id === 'head' ? `${face?.id ?? 'nf'}.${anim ?? 'still'}.${phase}.${scaleY.toFixed(2)}` : 'x';
    return `bodylab-${id}~${seqs[id]}.${headBits}.${amount.toFixed(2)}`;
  };

  // Content-addressed texture keys (pure functions of their inputs — the
  // carve_lab stale-bake lesson). All non-head parts share the skin bake.
  const headTexKey = `head.lab.${photo?.stamp ?? 'bare'}.${face?.id ?? 'noface'}.${anim ?? 'still'}.${phase}.${skin}.${photoScale.toFixed(2)}.${photoY}`;
  const skinTexKey = `body.skin.${skin}`;
  const partTexKey = (id: PartId) => (id === 'head' ? headTexKey : skinTexKey);

  // One stable bundle for the memo'd meshes — identity changes only when
  // something a mesh actually depends on changes, never on orbit drag.
  const partRender = useMemo(() => {
    const out = {} as Record<PartId, PartRender>;
    for (const id of PART_IDS) {
      out[id] = { params: partParams(id), dynKey: partDynKey(id), texKey: partTexKey(id) };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the helpers read exactly these
  }, [grids, headDisplace, seqs, face?.id, anim, phase, amount, scaleY, skin, headTexKey]);

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

  const isHead = selPart === 'head';
  const camTarget: [number, number, number] = view === 'figure' ? [0, 1.05, 0] : [0, 1.4, 0];

  return (
    <Row style={{ width: '100%', height: '100%', backgroundColor: BG }}>
      {/* ── left: part tabs + the unwrap painter ── */}
      <Col style={{ width: UNWRAP_W + 28, padding: 14, gap: 10 }}>
        <Text fontSize={15} color={INK} style={{ fontWeight: 900 }}>HEAD LAB</Text>
        <Text fontSize={11} color={DIM}>
          {status ?? (photo || face
            ? 'paint depth — blue pushes out, orange carves in'
            : 'drop a face picture (or generate one), then paint depth over it')}
        </Text>
        <Row style={{ gap: 6, alignItems: 'center' }}>
          {PART_IDS.map((id) => (
            <Chip key={id} label={PART_PRESETS[id].label} active={selPart === id} onPress={() => setSelPart(id)} />
          ))}
          <Box style={{ width: 10 }} />
          <Chip label="figure" active={view === 'figure'} color={GOOD} onPress={() => setView((v) => (v === 'figure' ? 'part' : 'figure'))} />
        </Row>
        <Pressable
          onLayout={(lr: any) => { canvasRect.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
          onMouseDown={onPaintDown}
          onMouseMove={onPaintMove}
          onMouseUp={onPaintUp}
          style={{ width: UNWRAP_W, height: UNWRAP_H, borderWidth: 1, borderColor: '#22324a', position: 'relative' }}
        >
          <UnwrapContent
            skin={skin}
            photo={isHead ? photo : null}
            photoScale={photoScale}
            photoY={photoY}
            layers={isHead ? shownDoc?.layers ?? null : null}
          />
          <Effect
            shader={DEPTH_OVERLAY_WGSL}
            data={[0]}
            textures={[paints[selPart].id, relief.id]}
            style={{ position: 'absolute', left: 0, top: 0, width: UNWRAP_W, height: UNWRAP_H }}
          />
        </Pressable>
        <Row style={{ gap: 8, alignItems: 'center' }}>
          <Chip label="raise" active={mode === 'raise'} onPress={() => setMode('raise')} />
          <Chip label="carve in" active={mode === 'lower'} color="#ff9445" onPress={() => setMode('lower')} />
          <Chip label="flatten" active={mode === 'flatten'} color="#94a3b8" onPress={() => setMode('flatten')} />
        </Row>
        <Row style={{ gap: 8, alignItems: 'center' }}>
          <Chip label="fill" active={false} onPress={fillAll} />
          <Chip label="soften" active={false} onPress={soften} />
          <Chip label="mirror" active={mirror} onPress={() => setMirror((v) => !v)} />
          <Chip label="clear" active={false} onPress={clearStrokes} />
        </Row>
        {isHead ? (
          <Row style={{ gap: 8, alignItems: 'center' }}>
            <Chip label="generate face" active={false} color={GOOD} onPress={generate} />
            <Chip label="save head" active={false} onPress={saveHead} />
            {face ? <Chip label="remove face" active={false} onPress={() => { setFace(null); setAnim(null); setStatus(null); }} /> : null}
          </Row>
        ) : null}
        {isHead && face ? (
          <Row style={{ gap: 8, alignItems: 'center' }}>
            <Text fontSize={11} color={DIM} style={{ width: 84 }}>animate</Text>
            {(['talk', 'chew', 'cry'] as HedAnimation[]).map((a) => (
              <Chip key={a} label={anim === a ? `${a} ■` : a} active={anim === a} color={GOOD} onPress={() => setAnim((cur) => (cur === a ? null : a))} />
            ))}
          </Row>
        ) : null}
        <Row style={{ gap: 8, alignItems: 'center' }}>
          <Chip label="save body" active={false} color={GOOD} onPress={saveBody} />
          <Row style={{ gap: 6, alignItems: 'center' }}>
            {SKINS.map((s) => (
              <Pressable key={s} onPress={() => setSkin(s)} style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: s, borderWidth: 2, borderColor: skin === s ? ACCENT : '#22324a' }} />
            ))}
          </Row>
        </Row>
        <Knob label="brush size" value={String(brush)} onMinus={() => setBrush((v) => Math.max(4, v - 2))} onPlus={() => setBrush((v) => Math.min(40, v + 2))} />
        <Knob label="strength" value={strength.toFixed(1)} onMinus={() => setStrength((v) => Math.max(0.1, v - 0.1))} onPlus={() => setStrength((v) => Math.min(1, v + 0.1))} />
        <Knob label="depth amount" value={amount.toFixed(2)} onMinus={() => setAmount((v) => Math.max(0.05, v - 0.05))} onPlus={() => setAmount((v) => Math.min(0.8, v + 0.05))} />
        {isHead ? (
          <>
            <Knob label="skull stretch" value={scaleY.toFixed(2)} onMinus={() => setScaleY((v) => Math.max(0.9, v - 0.05))} onPlus={() => setScaleY((v) => Math.min(1.6, v + 0.05))} />
            <Knob label="photo size" value={photoScale.toFixed(2)} onMinus={() => setPhotoScale((v) => Math.max(0.15, v - 0.05))} onPlus={() => setPhotoScale((v) => Math.min(0.95, v + 0.05))} />
            <Knob label="photo up/down" value={String(photoY)} onMinus={() => setPhotoY((v) => v - 8)} onPlus={() => setPhotoY((v) => v + 8)} />
          </>
        ) : null}
      </Col>

      {/* ── right: the selected part, or the assembled figure ── */}
      <Pressable
        onMouseDown={orbitDown}
        onMouseMove={orbitMove}
        onMouseUp={orbitUp}
        style={{ flexGrow: 1, height: '100%', position: 'relative', overflow: 'hidden' }}
      >
        <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={BG} showGrid={false} showAxes={false}>
          <OrbitCamera target={camTarget} yaw={yaw} pitch={pitch} dist={dist} fov={45} />
          <Scene3D.AmbientLight color="#aab8d6" intensity={0.6} />
          <Scene3D.DirectionalLight direction={[0.4, 0.9, 0.35]} color="#fff0d6" intensity={0.85} />
          <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 8, height: 0.03, depth: 8 }} material="#0e1726" position={[0, -0.015, 0]} />
          <PartMeshes view={view} selPart={selPart} parts={partRender} />
        </Scene3D>
        <Box style={{ position: 'absolute', right: 14, bottom: 14 }}>
          <Knob label="zoom" value={dist.toFixed(1)} onMinus={() => setDist((v) => Math.max(1.6, v - 0.4))} onPlus={() => setDist((v) => Math.min(12, v + 0.4))} />
        </Box>
      </Pressable>

      {/* offscreen: per-part GPU paint textures + the two unwrap bakes (the
          head's composition + the shared plain-skin bake every other part
          samples). Paintables MUST sit outside the flex flow — a bare host
          node here takes proportional-fallback space and blows up the layout. */}
      <Box style={{ position: 'absolute', left: -99999, top: 0, width: 1, height: 1 }}>
        {PART_IDS.map((id) => (
          <Paintable key={id} id={paints[id].id} w={PAINT_W} h={PAINT_H} />
        ))}
        <Paintable id={relief.id} w={GRID_W} h={GRID_H} />
      </Box>
      <StaticSurface staticKey={headTexKey} style={surfaceStyle}>
        <UnwrapContent skin={skin} photo={photo} photoScale={photoScale} photoY={photoY} layers={shownDoc?.layers ?? null} />
      </StaticSurface>
      <StaticSurface staticKey={skinTexKey} style={surfaceStyle}>
        <UnwrapContent skin={skin} photo={null} photoScale={photoScale} photoY={photoY} layers={null} />
      </StaticSurface>
    </Row>
  );
}
