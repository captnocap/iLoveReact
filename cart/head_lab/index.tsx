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
import { Box, Col, Row, Effect, Image, Paintable, Pressable, ScrollView, Text, TextInput, Scene3D, StaticSurface } from '@reactjit/runtime/primitives';
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
  PART_IDS, PART_PRESETS, buildRigFrame, BODY_SHAPES, CLOTHING, BOTTOMS, DEFAULT_BOTTOMS, CLOTHING_SKINS, CLOTHING_ACCESSORIES, BODY_POSES, buildBody, parseBody, serializeBody, clothingSkinTextureKey,
  PROFILE_N, defaultProfile,
  type BodyAnchor, type BodyHitbox, type BodyInstance, type BodyPoseId, type BodyShapeId, type BottomsId, type ClothingAccessoryId, type ClothingId, type ClothingInstance, type ClothingSkinId, type PartId,
} from './parts';
import { isAnimationTimelineLooping, parseAnimationDsl, sampleAnimationTimeline } from './animDsl';
import { ITEMS as GAME_ITEMS, TextureSources as GameItemTextureSources, type Item as GameItem, type ModelCtx as GameItemModelCtx } from '../game_item_gallery';

const BG = '#0b1018';
const INK = '#e8eef8';
const DIM = '#7f93b1';
const ACCENT = '#3da9ff';
const GOOD = '#34d399';
const DEFAULT_ANIM_SCRIPT = '[0.3,both_arms,lift_and_bend],[0.2,both_fists,clench],[1,both_arms,shake_in_air;1,mouth,yell]';
const ANIM_PRESETS: Record<string, string> = {
  point: '[0.5,right_arm,point;0.5,right_finger,point]',
  leftPoint: '[0.5,left_arm,point;0.5,left_finger,point]',
  middle: '[0.25,right_fist,clench],[0.75,right_finger,middle]',
  openClose: '[0.25,both_hands,open],[0.25,both_fists,clench]',
  fingerWiggle: '[1,both_fingers,wiggle_loop]',
  fingerCrawl: '[1,both_fingers,crawl_loop]',
  pinch: '[0.35,right_hand,pinch],[0.35,right_hand,open]',
  jazzHands: '[1,both_hands,jazz_loop]',
  wristFlick: '[1,right_wrist,flick_loop]',
  wristRoll: '[1,both_wrists,roll_loop]',
  punch: '[0.16,both_arms,guard],[0.3,right_arm,punch,cross;0.3,right_fist,clench],[0.18,right_arm,reach]',
  jab: '[0.1,both_arms,guard],[0.22,right_arm,punch,jab;0.22,right_fist,clench],[0.12,right_arm,reach]',
  cross: '[0.16,both_arms,guard],[0.3,right_arm,punch,cross;0.3,right_fist,clench],[0.18,right_arm,reach]',
  hook: '[0.16,both_arms,guard],[0.32,right_arm,punch,hook;0.32,right_fist,clench],[0.16,right_arm,reach]',
  uppercut: '[0.16,both_arms,guard],[0.34,right_arm,punch,uppercut;0.34,right_fist,clench],[0.16,right_arm,reach]',
  bodyShot: '[0.16,both_arms,guard],[0.3,right_arm,punch,body;0.3,right_fist,clench],[0.16,right_arm,reach]',
  leftPunch: '[0.16,both_arms,guard],[0.3,left_arm,punch,cross;0.3,left_fist,clench],[0.18,left_arm,reach]',
  guard: '[1,both_arms,guard;1,both_fists,clench]',
  salute: '[0.65,right_arm,salute;0.65,right_hand,open]',
  wave: '[1,right_arm,wave_loop;1,right_wrist,flick_loop]',
  shakeFist: '[1,right_arm,shake_in_air;1,right_fist,clench]',
  kick: '[0.55,right_leg,kick]',
  leftKick: '[0.55,left_leg,kick]',
  stomp: '[1,both_legs,stomp_loop]',
  footTap: '[1,right_foot,tap_loop]',
  dance: '[1,both_arms,swing_loop;1,both_feet,tap_loop;1,body,bounce_loop;1,head,nod_loop]',
  nodTalk: '[1,head,nod_loop;1,mouth,talk]',
  yellPunch: '[0.2,both_arms,guard],[0.35,right_arm,punch;0.35,right_fist,clench;0.35,mouth,yell]',
  faceGrab: '[0.22,right_arm,reach;0.22,right_hand,open;0.22,face_grab,target],[0.45,right_arm,punch;0.45,right_hand,grip;0.45,mouth,yell]',
  crouch: '[1,body,crouch]',
  sit: '[1,body,sit]',
  lay: '[1,body,lay]',
};
const DEFAULT_HELD_ITEM = 'none';
const TEXTURED_GAME_ITEMS = ['cash', 'football', 'basketball', 'pillbottle', 'beer', 'liquor', 'cigarettes', 'medkit', 'tv'];
const MemoGameItemTextureSources = memo(GameItemTextureSources);
const TEE_CAPTURE_W = 256;
const TEE_CAPTURE_H = 192;

// Unwrap canvas + bake share these dims (2:1 equirect).
const UNWRAP_W = 512;
const UNWRAP_H = 256;
const EDITOR_W = 768;
const EDITOR_H = 384;
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
type PaintTool = 'sculpt' | 'face';
type View = 'part' | 'figure';
type ShapeRegion = {
  id: string;
  label: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  mirror?: boolean;
};
const PART_LOD: Record<PartId, { segments: number; rings: number }> = {
  head: { segments: 48, rings: 24 },
  torso: { segments: 28, rings: 14 },
  pipe: { segments: 18, rings: 10 },
  hand: { segments: 20, rings: 10 },
  foot: { segments: 18, rings: 10 },
  finger: { segments: 12, rings: 8 },
};

const FACE_PAINTS = ['#1f2937', '#f8fafc', '#7a4a3a', '#c2410c', '#dc2626', '#facc15', '#38bdf8', '#8b5cf6'];
const SHAPE_REGIONS: Record<PartId, ShapeRegion[]> = {
  head: [
    { id: 'brow', label: 'brow ridge', cx: 0.5, cy: 0.38, rx: 0.22, ry: 0.07 },
    { id: 'eyes', label: 'eye sockets', cx: 0.43, cy: 0.45, rx: 0.07, ry: 0.08, mirror: true },
    { id: 'nose', label: 'nose', cx: 0.5, cy: 0.53, rx: 0.055, ry: 0.12 },
    { id: 'cheeks', label: 'cheeks', cx: 0.39, cy: 0.57, rx: 0.09, ry: 0.1, mirror: true },
    { id: 'mouth', label: 'mouth area', cx: 0.5, cy: 0.68, rx: 0.12, ry: 0.07 },
    { id: 'chin', label: 'chin', cx: 0.5, cy: 0.78, rx: 0.14, ry: 0.08 },
  ],
  torso: [
    { id: 'chest', label: 'chest', cx: 0.42, cy: 0.33, rx: 0.1, ry: 0.12, mirror: true },
    { id: 'belly', label: 'belly', cx: 0.5, cy: 0.55, rx: 0.15, ry: 0.18 },
    { id: 'waist', label: 'waist carve', cx: 0.5, cy: 0.66, rx: 0.2, ry: 0.08 },
    { id: 'hips', label: 'hips', cx: 0.38, cy: 0.76, rx: 0.12, ry: 0.12, mirror: true },
  ],
  pipe: [
    { id: 'upper', label: 'upper mass', cx: 0.5, cy: 0.28, rx: 0.34, ry: 0.14 },
    { id: 'middle', label: 'middle taper', cx: 0.5, cy: 0.52, rx: 0.28, ry: 0.12 },
    { id: 'lower', label: 'lower mass', cx: 0.5, cy: 0.76, rx: 0.34, ry: 0.14 },
  ],
  hand: [
    { id: 'palm', label: 'palm pad', cx: 0.5, cy: 0.52, rx: 0.2, ry: 0.22 },
    { id: 'knuckles', label: 'knuckles', cx: 0.39, cy: 0.3, rx: 0.08, ry: 0.08, mirror: true },
    { id: 'wrist', label: 'wrist', cx: 0.5, cy: 0.82, rx: 0.2, ry: 0.07 },
  ],
  foot: [
    { id: 'toe', label: 'toe box', cx: 0.5, cy: 0.74, rx: 0.24, ry: 0.11 },
    { id: 'arch', label: 'arch', cx: 0.5, cy: 0.52, rx: 0.2, ry: 0.11 },
    { id: 'heel', label: 'heel', cx: 0.5, cy: 0.28, rx: 0.22, ry: 0.11 },
  ],
  finger: [
    { id: 'tip', label: 'tip', cx: 0.5, cy: 0.18, rx: 0.42, ry: 0.08 },
    { id: 'middle', label: 'middle joint', cx: 0.5, cy: 0.48, rx: 0.42, ry: 0.07 },
    { id: 'base', label: 'base joint', cx: 0.5, cy: 0.76, rx: 0.42, ry: 0.08 },
  ],
};

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
function HedLayerPaint(props: { layers: HedLayer[]; width?: number; height?: number }) {
  const width = props.width ?? UNWRAP_W;
  const height = props.height ?? UNWRAP_H;
  const boxes: any[] = [];
  for (const layer of props.layers) {
    if (!layer.color) continue;
    layer.shapes.forEach((s, si) => {
      const centers = s.mirror ? [s.cx, 1 - s.cx] : [s.cx];
      centers.forEach((cx, ci) => {
        const w = s.rx * 2 * width;
        const h = s.ry * 2 * height;
        boxes.push(
          <Box
            key={`${layer.id}.${si}.${ci}`}
            style={{
              position: 'absolute',
              left: cx * width - w / 2,
              top: s.cy * height - h / 2,
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
function UnwrapContent(props: { skin: string; photo: Photo | null; photoScale: number; photoY: number; layers: HedLayer[] | null; width?: number; height?: number }) {
  const width = props.width ?? UNWRAP_W;
  const height = props.height ?? UNWRAP_H;
  const side = props.photoScale * width;
  return (
    <Box style={{ width, height, backgroundColor: props.skin, position: 'relative', overflow: 'hidden' }}>
      {props.photo ? (
        <Image
          src={props.photo.path}
          style={{
            position: 'absolute',
            left: width / 2 - side / 2,
            top: height / 2 - side / 2 + props.photoY * (height / UNWRAP_H),
            width: side,
            height: side,
          }}
        />
      ) : null}
      {props.layers ? <HedLayerPaint layers={props.layers} width={width} height={height} /> : null}
    </Box>
  );
}

function UnderwearTexturePaint(props: { part: PartId; clothing: ClothingId; bottoms: BottomsId; bodyShape: BodyShapeId }) {
  if (props.clothing !== 'underwear' || props.part !== 'torso') return null;
  const feminine = props.bodyShape === 'female';
  const main = BOTTOMS[props.bottoms].primary;
  const trim = BOTTOMS[props.bottoms].secondary;
  const boxes: any[] = [];
  const add = (key: string, left: number, top: number, width: number, height: number, color: string, radius = 2) => {
    boxes.push(
      <Box
        key={key}
        style={{
          position: 'absolute',
          left: left * UNWRAP_W,
          top: top * UNWRAP_H,
          width: width * UNWRAP_W,
          height: height * UNWRAP_H,
          backgroundColor: color,
          borderRadius: radius,
        }}
      />,
    );
  };

  // Torso texture coordinates are shared by the torso and pelvis globe
  // instances. These are texture stamps, not extra scene meshes.
  const short = props.bottoms === 'shorts';
  add('brief-front', feminine ? 0.32 : 0.29, short ? 0.69 : 0.75, feminine ? 0.36 : 0.42, short ? 0.2 : 0.14, main, 3);
  add('brief-back', feminine ? 0.32 : 0.29, short ? 0.06 : 0.08, feminine ? 0.36 : 0.42, short ? 0.19 : 0.14, main, 3);
  add('front-band', feminine ? 0.29 : 0.27, short ? 0.675 : 0.735, feminine ? 0.42 : 0.46, 0.022, trim, 1);
  add('back-band', feminine ? 0.29 : 0.27, short ? 0.045 : 0.065, feminine ? 0.42 : 0.46, 0.022, trim, 1);
  add('front-left-cut', feminine ? 0.28 : 0.27, short ? 0.86 : 0.87, 0.16, 0.025, trim, 1);
  add('front-right-cut', feminine ? 0.56 : 0.57, short ? 0.86 : 0.87, 0.16, 0.025, trim, 1);

  if (feminine) {
    add('bra-band', 0.28, 0.33, 0.44, 0.03, trim, 1);
    add('bra-left', 0.34, 0.25, 0.17, 0.105, main, 4);
    add('bra-right', 0.49, 0.25, 0.17, 0.105, main, 4);
    add('strap-left', 0.36, 0.13, 0.025, 0.19, trim, 1);
    add('strap-right', 0.615, 0.13, 0.025, 0.19, trim, 1);
  }

  return <>{boxes}</>;
}

function SkinUnwrapContent(props: { skin: string; part: PartId; clothing: ClothingId; bottoms: BottomsId; bodyShape: BodyShapeId }) {
  return (
    <Box style={{ width: UNWRAP_W, height: UNWRAP_H, backgroundColor: props.skin, position: 'relative', overflow: 'hidden' }}>
      <UnderwearTexturePaint part={props.part} clothing={props.clothing} bottoms={props.bottoms} bodyShape={props.bodyShape} />
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

function RegionSlider(props: { keyBase: string; label: string; value: number; onCommit: (value: number) => void }) {
  const rectRef = useRef<{ x: number; width: number } | null>(null);
  const previewRef = useRef(props.value);
  const [dragging, setDragging] = useState(false);
  const trackW = 160;
  const pct = clamp01((props.value + 1) / 2);
  const fillKey = `${props.keyBase}.fill`;
  const handleKey = `${props.keyBase}.handle`;
  const pctToValue = (p: number) => clamp(p * 2 - 1, -1, 1);
  const writePreview = (p: number) => {
    previewRef.current = pctToValue(p);
    setLatch(fillKey, Math.max(0, p * trackW));
    setLatch(handleKey, Math.max(0, p * (trackW - 16)));
  };
  const pctFromX = (sx: number): number => {
    const r = rectRef.current;
    if (!r || r.width <= 0) return pct;
    return clamp01((sx - r.x) / r.width);
  };

  useEffect(() => {
    writePreview(pct);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- latch sync follows committed value
  }, [pct, fillKey, handleKey]);

  return (
    <Row style={{ gap: 8, alignItems: 'center' }}>
      <Text fontSize={11} color={DIM} style={{ width: 84 }}>{props.label}</Text>
      <Box style={{ width: trackW, height: 24, position: 'relative' }}>
        <Pressable
          onLayout={(r: any) => { rectRef.current = { x: r.x, width: r.width }; }}
          onMouseDown={(e: any) => {
            const p = pctFromX(Number(e?.x ?? 0));
            writePreview(p);
            setDragging(true);
          }}
          style={{ width: trackW, height: 24, borderRadius: 4, backgroundColor: '#1a2942', justifyContent: 'center', position: 'relative' }}
        >
          <Box style={{ position: 'absolute', left: 0, top: 10, width: ('latch:' + fillKey) as any, height: 4, borderRadius: 2, backgroundColor: '#3da9ff' }} />
          <Box style={{ position: 'absolute', left: ('latch:' + handleKey) as any, top: 3, width: 16, height: 16, borderRadius: 8, backgroundColor: '#d8e5ff', borderWidth: 2, borderColor: '#17253b' }} />
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
      <Text fontSize={11} color={INK} style={{ width: 38, textAlign: 'right' }}>{props.value.toFixed(2)}</Text>
    </Row>
  );
}

function ClothingSkinSurface(props: { skin: ClothingSkinId }) {
  if (props.skin === 'plain') return <Box style={{ width: '100%', height: '100%', backgroundColor: '#ffffff' }} />;
  if (props.skin === 'designer') {
    return (
      <Box style={{ width: '100%', height: '100%', backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center', borderWidth: 10, borderColor: '#d4af37' }}>
        <Text fontSize={28} color="#d4af37" style={{ fontWeight: 900 }}>FAUX</Text>
        <Text fontSize={18} color="#f5e6a7" style={{ fontWeight: 900 }}>COUTURE</Text>
      </Box>
    );
  }
  if (props.skin === 'stupid') {
    return (
      <Box style={{ width: '100%', height: '100%', backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
        <Text fontSize={25} color="#111827" style={{ fontWeight: 900 }}>I AM</Text>
        <Text fontSize={21} color="#111827" style={{ fontWeight: 900 }}>WITH</Text>
        <Text fontSize={30} color="#dc2626" style={{ fontWeight: 900 }}>STUPID</Text>
        <Text fontSize={22} color="#111827">-&gt;</Text>
      </Box>
    );
  }
  if (props.skin === 'fourtwenty') {
    return (
      <Box style={{ width: '100%', height: '100%', backgroundColor: '#14532d', alignItems: 'center', justifyContent: 'center', padding: 10 }}>
        <Text fontSize={32} color="#bbf7d0" style={{ fontWeight: 900 }}>4:20</Text>
        <Text fontSize={19} color="#fef3c7" style={{ fontWeight: 900 }}>SOMEWHERE</Text>
      </Box>
    );
  }
  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0f172a', padding: 10, gap: 8 }}>
      {[0, 1, 2, 3].map((row) => (
        <Box key={row} style={{ flexGrow: 1, flexDirection: 'row', gap: 8 }}>
          {[0, 1, 2, 3].map((col) => (
            <Box key={col} style={{ flexGrow: 1, backgroundColor: (row + col) % 2 === 0 ? '#22d3ee' : '#f97316' }} />
          ))}
        </Box>
      ))}
    </Box>
  );
}

const ClothingSkinCaptures = memo(function ClothingSkinCaptures() {
  const surfaceStyle = useMemo(
    () => ({ position: 'absolute' as const, left: -99999, top: 0, width: TEE_CAPTURE_W, height: TEE_CAPTURE_H }),
    [],
  );
  return (
    <>
      {(Object.keys(CLOTHING_SKINS) as ClothingSkinId[]).filter((id) => id !== 'plain').map((id) => (
        <StaticSurface key={id} staticKey={clothingSkinTextureKey(id)} style={surfaceStyle}>
          <ClothingSkinSurface skin={id} />
        </StaticSurface>
      ))}
    </>
  );
});

const emptyGrid = () => new Array(GRID_W * GRID_H).fill(0);
const emptyGrids = (): Record<PartId, number[]> =>
  Object.fromEntries(PART_IDS.map((id) => [id, emptyGrid()])) as Record<PartId, number[]>;

function seededRandom(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, values: readonly T[]): T {
  return values[Math.min(values.length - 1, Math.floor(rand() * values.length))];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function clamp01(n: number): number {
  return clamp(n, 0, 1);
}

function setLatch(key: string, value: number): void {
  const fn = (globalThis as any).__latchSet;
  if (typeof fn === 'function') fn(key, value);
}

function bell(t: number, center: number, width: number): number {
  const d = (t - center) / width;
  return Math.exp(-d * d);
}

function stampGrid(grid: number[], cx: number, cy: number, rx: number, ry: number, depth: number, mirror = false) {
  for (let y = 0; y < GRID_H; y++) {
    const v = ((y + 0.5) / GRID_H - cy) / ry;
    for (let x = 0; x < GRID_W; x++) {
      const u = ((x + 0.5) / GRID_W - cx) / rx;
      const falloff = 1 - u * u - v * v;
      if (falloff <= 0) continue;
      const i = y * GRID_W + x;
      grid[i] = clamp(grid[i] + depth * falloff * falloff, -1, 1);
    }
  }
  if (mirror && Math.abs(cx - 0.5) > 0.001) stampGrid(grid, 1 - cx, cy, rx, ry, depth, false);
}

function stampRegion(grid: number[], region: ShapeRegion, value: number) {
  if (Math.abs(value) < 0.001) return;
  stampGrid(grid, region.cx, region.cy, region.rx, region.ry, value, region.mirror);
}

function applyRegionValues(id: PartId, base: number[], values: Record<string, number> | undefined): number[] {
  const regions = SHAPE_REGIONS[id];
  if (!values || regions.every((r) => Math.abs(values[r.id] ?? 0) < 0.001)) return base;
  const next = base.slice();
  for (const region of regions) {
    stampRegion(next, region, values[region.id] ?? 0);
  }
  for (let i = 0; i < next.length; i++) next[i] = clamp(next[i], -1, 1);
  return next;
}

function regionSignature(values: Record<string, number> | undefined): string {
  if (!values) return 'r0';
  const keys = Object.keys(values).sort();
  if (keys.length === 0) return 'r0';
  return keys.map((k) => `${k}:${(values[k] ?? 0).toFixed(2)}`).join(',');
}

function generatedProfile(id: PartId, shapeId: BodyShapeId, rand: () => number): number[] {
  const shape = BODY_SHAPES[shapeId];
  const base = defaultProfile(id);
  return base.map((v, i) => {
    const t = i / (PROFILE_N - 1);
    let factor = 1 + (rand() - 0.5) * 0.1;
    if (id === 'torso') {
      factor *= shape.torsoWide;
      factor *= 1
        + (shape.shoulder - 1) * 0.24 * bell(t, 0.2, 0.2)
        + (shape.hip - 1) * 0.24 * bell(t, 0.78, 0.22);
      if (shapeId === 'female') factor *= 1 - 0.08 * bell(t, 0.52, 0.18) + 0.08 * bell(t, 0.7, 0.2);
      if (shapeId === 'heavy') factor *= 1 + 0.16 * bell(t, 0.5, 0.35);
      if (shapeId === 'skinny') factor *= 0.92 + 0.08 * Math.abs(t - 0.5);
    } else if (id === 'pipe') {
      factor *= shape.limbThick * (0.94 + 0.08 * bell(t, 0.34, 0.24) + 0.05 * bell(t, 0.72, 0.2));
    } else if (id === 'hand' || id === 'finger') {
      factor *= shape.hand;
      if (id === 'finger') factor *= 1.12 + 0.06 * bell(t, 0.38, 0.24);
    } else if (id === 'foot') {
      factor *= shape.foot;
    }
    return clamp(v * factor, 0.06, 1.35);
  });
}

function generatedProfiles(shapeId: BodyShapeId, rand: () => number): Record<PartId, number[]> {
  return Object.fromEntries(PART_IDS.map((id) => [id, generatedProfile(id, shapeId, rand)])) as Record<PartId, number[]>;
}

// Thin the body slightly so the shirt/shoe boxes cover it. NEVER shrink the
// pipes: sleeves and pant tubes are already wider than the limbs, and profile
// shrink used to shorten limbs too (the detached-wrist bug, fixed in Globe —
// profiles are radial-only now, but the pipes still don't need it).
function fitProfilesUnderClothing(profiles: Record<PartId, number[]>, clothing: ClothingId): Record<PartId, number[]> {
  if (clothing === 'underwear') return profiles;
  const shrink: Partial<Record<PartId, number>> = {
    torso: clothing === 'dress' ? 0.88 : 0.9,
    foot: 0.86,
  };
  const out = { ...profiles };
  for (const id of Object.keys(shrink) as PartId[]) {
    const k = shrink[id] ?? 1;
    out[id] = profiles[id].map((v) => clamp(v * k, 0.05, 1.35));
  }
  return out;
}

function generatedBodyGrids(shapeId: BodyShapeId, rand: () => number): Record<PartId, number[]> {
  const grids = emptyGrids();
  const shape = BODY_SHAPES[shapeId];
  const tone = shapeId === 'heavy' ? 0.75 : shapeId === 'skinny' ? 0.5 : 0.62;

  stampGrid(grids.torso, 0.43, 0.32, 0.08, 0.11, 0.12 * tone, true);
  stampGrid(grids.torso, 0.5, 0.48, 0.13, 0.08, -0.08);
  stampGrid(grids.torso, 0.5, 0.62, 0.1, 0.16, shapeId === 'heavy' ? 0.16 : -0.03);
  stampGrid(grids.torso, 0.38, 0.74, 0.1, 0.1, 0.07 * shape.hip, true);
  if (shapeId === 'female') {
    stampGrid(grids.torso, 0.42, 0.34, 0.08, 0.1, 0.1, true);
    stampGrid(grids.torso, 0.5, 0.54, 0.13, 0.09, -0.07);
    stampGrid(grids.torso, 0.08, 0.73, 0.07, 0.1, 0.13);
    stampGrid(grids.torso, 0.92, 0.73, 0.07, 0.1, 0.13);
    stampGrid(grids.torso, 0.5, 0.68, 0.14, 0.1, -0.04);
  }
  if (shapeId === 'bodybuilder') {
    stampGrid(grids.torso, 0.4, 0.32, 0.09, 0.09, 0.16, true);
    stampGrid(grids.torso, 0.5, 0.5, 0.1, 0.16, -0.1);
    stampGrid(grids.torso, 0.08, 0.72, 0.06, 0.08, 0.07);
    stampGrid(grids.torso, 0.92, 0.72, 0.06, 0.08, 0.07);
  }
  if (shapeId === 'heavy') {
    stampGrid(grids.torso, 0.07, 0.72, 0.08, 0.11, 0.12);
    stampGrid(grids.torso, 0.93, 0.72, 0.08, 0.11, 0.12);
  }

  stampGrid(grids.pipe, 0.5, 0.28, 0.22, 0.12, 0.13 * tone);
  stampGrid(grids.pipe, 0.5, 0.56, 0.18, 0.09, -0.06);
  stampGrid(grids.pipe, 0.5, 0.78, 0.2, 0.11, 0.1 * tone);
  stampGrid(grids.pipe, 0.5, 0.08, 0.52, 0.025, -0.05);
  stampGrid(grids.pipe, 0.5, 0.92, 0.52, 0.025, -0.05);

  stampGrid(grids.hand, 0.5, 0.5, 0.16, 0.18, 0.15);
  stampGrid(grids.hand, 0.36, 0.28, 0.07, 0.07, 0.08, true);
  stampGrid(grids.finger, 0.5, 0.3, 0.46, 0.035, 0.08);
  stampGrid(grids.finger, 0.5, 0.62, 0.46, 0.035, 0.07);

  stampGrid(grids.foot, 0.5, 0.5, 0.18, 0.15, 0.1);
  stampGrid(grids.foot, 0.5, 0.75, 0.2, 0.08, -0.07);

  for (const id of PART_IDS) {
    for (let i = 0; i < grids[id].length; i++) {
      grids[id][i] = clamp(grids[id][i] + (rand() - 0.5) * 0.025, -0.72, 0.72);
    }
  }
  return grids;
}

// The 3D meshes, memo'd HARD. Orbit drag updates yaw/pitch per mousemove and
// re-renders the whole cart — and every mesh node carries the full sculpt
// vertex payload through the reconciler, so re-diffing ~14 of them per move
// is the lag. Props here are stable identities (one useMemo bundle), so a
// drag re-renders ONLY the camera node; the meshes update on sculpt/knob/
// animation changes alone. Same perf isolation hmsc's GameWorld3D uses.
type PartRender = { params: any; dynKey: string; texKey: string };
const clothingGeometry = (kind: ClothingInstance['geometry']) =>
  kind === 'sphere' ? Geometry.Sphere : kind === 'cone' ? Geometry.Cone : kind === 'cylinder' ? Geometry.Cylinder : Geometry.Box;

const PartMeshes = memo(function PartMeshes(props: {
  view: View;
  selPart: PartId;
  parts: Record<PartId, PartRender>;
  assembly: BodyInstance[];
  anatomy: BodyInstance[];
  clothing: ClothingInstance[];
  hitboxes: BodyHitbox[];
  anchors: BodyAnchor[];
  showHitboxes: boolean;
}) {
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
      {props.assembly.map((inst, i) => {
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
      {props.clothing.map((inst, i) => {
        return (
          <Scene3D.Mesh
            key={`cloth-${i}`}
            geometry={clothingGeometry(inst.geometry)}
            params={inst.params}
            material={inst.textureKey ? '#ffffff' : inst.color}
            textureKey={inst.textureKey}
            position={inst.position}
            rotation={inst.rotation ?? [0, 0, 0]}
            scale={inst.scale ?? 1}
          />
        );
      })}
      {props.anatomy.map((inst, i) => {
        const p = props.parts[inst.part];
        return (
          <Scene3D.Mesh
            key={`anatomy-${i}`}
            geometry={Geometry.Globe}
            params={p.params}
            dynamicKey={`${p.dynKey}.anatomy.${i}`}
            material="#ffffff"
            textureKey={p.texKey}
            position={inst.position}
            rotation={inst.rotation ?? [0, 0, 0]}
            scale={inst.thickness != null ? [inst.scale * inst.thickness, inst.scale, inst.scale * inst.thickness] : inst.scale}
          />
        );
      })}
      {props.showHitboxes ? props.hitboxes.map((box) => (
        <Scene3D.Mesh
          key={`hitbox-${box.id}`}
          geometry={Geometry.Box}
          params={{ width: box.size[0], height: box.size[1], depth: box.size[2] }}
          material={{ color: '#35d0ff', opacity: 0.18 }}
          position={box.position}
          rotation={box.rotation}
        />
      )) : null}
      {props.showHitboxes ? props.anchors.map((anchor) => (
        <Scene3D.Mesh
          key={`anchor-${anchor.id}`}
          geometry={Geometry.Sphere}
          params={{ radius: 0.5, segments: 12, rings: 8 }}
          material={anchor.id === 'face_grab' ? '#f97316' : anchor.role === 'origin' ? '#a78bfa' : '#34d399'}
          position={anchor.position}
          rotation={anchor.rotation}
          scale={anchor.radius}
        />
      )) : null}
    </>
  );
});

const HELD_ITEM_SCALE: Record<string, number> = {
  vehicle: 0.1,
  sailboat: 0.12,
  surfboard: 0.16,
  pitchfork: 0.18,
  bat: 0.2,
  tv: 0.12,
  backpack: 0.14,
  basketball: 0.18,
  football: 0.18,
};

function HeldGameItem(props: { item: GameItem | null; assembly: BodyInstance[] }) {
  if (!props.item) return null;
  const hand = props.assembly.find((inst) => inst.bone === 'rHand');
  if (!hand) return null;
  const scale = HELD_ITEM_SCALE[props.item.id] ?? 0.16;
  const origin: [number, number, number] = [
    hand.position[0] + 0.08,
    hand.position[1] - 0.18,
    hand.position[2] - 0.18,
  ];
  const ctx: GameItemModelCtx = {
    origin,
    yaw: -0.45,
    scale,
    active: true,
  };
  return <>{props.item.model(ctx)}</>;
}

export default function HeadLab() {
  const [selPart, setSelPart] = useState<PartId>('head');
  const [view, setView] = useState<View>('part');
  const [bodyShape, setBodyShape] = useState<BodyShapeId>('neutral');
  const [clothing, setClothing] = useState<ClothingId>('tee');
  const [bottoms, setBottoms] = useState<BottomsId>(DEFAULT_BOTTOMS.tee);
  const [clothingSkin, setClothingSkin] = useState<ClothingSkinId>('plain');
  const [clothingAccessories, setClothingAccessories] = useState<ClothingAccessoryId[]>([]);
  const [heldItemId, setHeldItemId] = useState(DEFAULT_HELD_ITEM);
  const [bodyPose, setBodyPose] = useState<BodyPoseId>('stand');
  const [bodyRigAnim, setBodyRigAnim] = useState(false);
  const [animScript, setAnimScript] = useState(DEFAULT_ANIM_SCRIPT);
  const [scriptPlaying, setScriptPlaying] = useState(false);
  const [showHitboxes, setShowHitboxes] = useState(false);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoScale, setPhotoScale] = useState(0.4);
  const [photoY, setPhotoY] = useState(0);
  const [skin, setSkin] = useState(SKINS[0]);
  const [brush, setBrush] = useState(14); // paint-texture px
  const [strength, setStrength] = useState(0.5);
  const [mode, setMode] = useState<Mode>('raise');
  const [paintTool, setPaintTool] = useState<PaintTool>('sculpt');
  const [facePaintColor, setFacePaintColor] = useState(FACE_PAINTS[0]);
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
  // Per-part editable OUTLINES — the part's silhouette as radius samples
  // top→bottom. A limb's identity is its outline, not a displacement field
  // (the head is the only part that's actually a displaced sphere), so this
  // is the PRIMARY editor for non-head parts; the paint field is the detail
  // pass. Live state updates per drag; the mesh re-sculpts on release.
  const [profiles, setProfiles] = useState<Record<PartId, number[]>>(
    () => Object.fromEntries(PART_IDS.map((id) => [id, defaultProfile(id)])) as Record<PartId, number[]>,
  );
  const [regionValues, setRegionValues] = useState<Record<PartId, Record<string, number>>>(
    () => Object.fromEntries(PART_IDS.map((id) => [id, {}])) as Record<PartId, Record<string, number>>,
  );
  // What the non-head canvas shows: drag the outline, or paint detail depth.
  const [editTab, setEditTab] = useState<'outline' | 'detail'>('outline');
  // The loaded/generated .hed face (feature layers); id versions keys/caches.
  const [face, setFace] = useState<{ doc: HedDocument; id: string } | null>(null);
  // Playing animation + its frame clock (setInterval — the cart host has no
  // requestAnimationFrame). Phase is frame % loop length, so every key the
  // animation produces is one of a small cycling set: N cached bakes total.
  const [anim, setAnim] = useState<HedAnimation | null>(null);
  const [animFrame, setAnimFrame] = useState(0);
  const [rigFrame, setRigFrame] = useState(0);
  const [scriptFrame, setScriptFrame] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const paintingRef = useRef(false);
  const faceStrokeRef = useRef<{ cx: number; cy: number }[]>([]);
  const profileDraftRef = useRef<number[] | null>(null);
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
  const profileLatchKey = (part: PartId, row: number, axis: 'left' | 'width') => `headlab.profile.${part}.${row}.${axis}`;
  const writeProfileLatch = (part: PartId, row: number, value: number) => {
    const width = value * EDITOR_W * 0.9;
    setLatch(profileLatchKey(part, row, 'width'), width);
    setLatch(profileLatchKey(part, row, 'left'), EDITOR_W / 2 - width / 2);
  };

  // Animation clock — only ticks while something is playing on a face.
  useEffect(() => {
    if (!anim || !face) return;
    const iv = setInterval(() => setAnimFrame((f) => f + 1), 150);
    return () => clearInterval(iv);
  }, [anim, !!face]);
  useEffect(() => {
    if (!bodyRigAnim) return;
    const iv = setInterval(() => setRigFrame((f) => f + 1), 90);
    return () => clearInterval(iv);
  }, [bodyRigAnim]);
  useEffect(() => {
    if (!scriptPlaying) return;
    const iv = setInterval(() => setScriptFrame((f) => f + 1), 50);
    return () => clearInterval(iv);
  }, [scriptPlaying]);

  const timeline = useMemo(() => parseAnimationDsl(animScript), [animScript]);
  const timelineLoops = useMemo(() => isAnimationTimelineLooping(timeline), [timeline]);
  const scriptActions = useMemo(
    () => ((scriptPlaying || scriptFrame > 0) ? sampleAnimationTimeline(timeline, scriptFrame / 20) : []),
    [scriptPlaying, timeline, scriptFrame],
  );
  useEffect(() => {
    if (!scriptPlaying || timelineLoops || timeline.total <= 0) return;
    if (scriptFrame / 20 >= timeline.total) setScriptPlaying(false);
  }, [scriptPlaying, timelineLoops, timeline.total, scriptFrame]);
  useEffect(() => {
    for (let i = 0; i < PROFILE_N; i++) writeProfileLatch(selPart, i, profiles[selPart][i]);
  }, [selPart, profiles]);
  const scriptMouth = scriptActions.find((a) => a.target === 'mouth' && (['talk', 'chew', 'cry', 'yell'] as string[]).includes(a.action));
  const activeAnim: HedAnimation | null = scriptMouth ? scriptMouth.action as HedAnimation : anim;

  // The doc the canvas/bake/mesh actually show: the face with the playing
  // animation's frame applied (a pure transform — base doc stays untouched,
  // so save/sculpt always work on the still face).
  const phase = activeAnim
    ? scriptMouth
      ? Math.min(HED_ANIM_FRAMES[activeAnim] - 1, Math.floor(scriptMouth.phase * HED_ANIM_FRAMES[activeAnim]))
      : animFrame % HED_ANIM_FRAMES[activeAnim]
    : 0;
  const shownDoc = useMemo(
    () => (face ? (activeAnim ? animateHed(face.doc, activeAnim, phase) : face.doc) : null),
    [face, activeAnim, phase],
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

  const bakedGridForPart = (id: PartId) => applyRegionValues(id, grids[id], regionValues[id]);

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
    setRegionValues((prev) => ({ ...prev, head: {} }));
    setFace({ doc: { ...doc, sculpt: new Array(doc.cols * doc.rows).fill(0) }, id });
  };

  const generateFaceOnly = () => {
    const seed = (Date.now() ^ Math.floor(Math.random() * 0xffff)) >>> 0;
    applyDoc(generateFace(seed), `gen${seed}`);
    setStatus(`generated face ${seed} — sculpt over it, or generate again`);
  };

  const generateCharacter = () => {
    const seed = (Date.now() ^ Math.floor(Math.random() * 0xffff)) >>> 0;
    const rand = seededRandom(seed);
    const shapes = Object.keys(BODY_SHAPES) as BodyShapeId[];
    const clothes = (Object.keys(CLOTHING) as ClothingId[]).filter((id) => id !== 'underwear' || rand() < 0.25);
    const clothingSkins = Object.keys(CLOTHING_SKINS) as ClothingSkinId[];
    const allAccessories = Object.keys(CLOTHING_ACCESSORIES) as ClothingAccessoryId[];
    const itemPool = GAME_ITEMS.filter((item) => item.id !== 'vehicle' && item.id !== 'tv' && item.id !== 'sailboat');
    let nextShape = pick(rand, shapes);
    const nextClothing = pick(rand, clothes.length > 0 ? clothes : (Object.keys(CLOTHING) as ClothingId[]));
    const nextClothingSkin = nextClothing === 'tee' || nextClothing === 'hoodie' ? pick(rand, clothingSkins) : 'plain';
    const nextAccessories = allAccessories.filter(() => rand() < 0.28).slice(0, 2);
    const nextHeldItem = rand() < 0.45 ? pick(rand, itemPool).id : DEFAULT_HELD_ITEM;
    if (nextAccessories.includes('cap') && nextAccessories.includes('beanie')) nextAccessories.splice(nextAccessories.indexOf('beanie'), 1);
    if (nextClothing === 'dress') nextShape = 'female';
    const faceStyle = nextShape === 'female' || nextClothing === 'dress' ? 'feminine' : rand() < 0.25 ? 'feminine' : 'masculine';
    const bottomsPool: BottomsId[] = nextClothing === 'dress'
      ? ['briefs']
      : nextClothing === 'underwear'
        ? ['briefs', 'briefs', 'shorts']
        : nextClothing === 'suit' || nextClothing === 'armor'
          ? ['slacks', 'slacks', 'jeans']
          : faceStyle === 'feminine'
            ? ['jeans', 'shorts', 'skirt', 'skirt']
            : ['jeans', 'jeans', 'shorts', 'slacks'];
    const nextBottoms = pick(rand, bottomsPool);
    const nextFace = generateFace(seed, { style: faceStyle });
    const nextProfiles = fitProfilesUnderClothing(generatedProfiles(nextShape, rand), nextClothing);
    const nextGrids = generatedBodyGrids(nextShape, rand);
    const headGrid = nextFace.sculpt.map((b) => b / 127);
    nextGrids.head = headGrid;

    applyDoc(nextFace, `gen${seed}`);
    for (const id of PART_IDS) uploadGrid(id, nextGrids[id]);
    setGrids(nextGrids);
    setProfiles(nextProfiles);
    setRegionValues(Object.fromEntries(PART_IDS.map((id) => [id, {}])) as Record<PartId, Record<string, number>>);
    setSeqs((prev) => Object.fromEntries(PART_IDS.map((id) => [id, prev[id] + 1])) as Record<PartId, number>);
    setBodyShape(nextShape);
    setClothing(nextClothing);
    setBottoms(nextBottoms);
    setClothingSkin(nextClothingSkin);
    setClothingAccessories(nextAccessories);
    setHeldItemId(nextHeldItem);
    setBodyPose(nextShape === 'bodybuilder' ? 'flex' : 'stand');
    setBodyRigAnim(false);
    setAmount(clamp(nextFace.amount * (nextShape === 'heavy' ? 1.08 : nextShape === 'skinny' ? 0.92 : 1), 0.22, 0.58));
    setScaleY(clamp(nextFace.scaleY * BODY_SHAPES[nextShape].head * (0.96 + rand() * 0.08), 0.9, 1.55));
    setSelPart('head');
    setView('figure');
    setStatus(`generated character ${seed} — ${BODY_SHAPES[nextShape].label}, ${CLOTHING[nextClothing].label} + ${BOTTOMS[nextBottoms].label}, ${CLOTHING_SKINS[nextClothingSkin].label}`);
  };

  const saveHead = () => {
    mkdir('cart/heads');
    const stamp = Date.now();
    const doc = buildHed({
      skin, amount, scaleY,
      sculpt: bakedGridForPart('head'),
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
      sculpts: Object.fromEntries(PART_IDS.map((id) => [id, bakedGridForPart(id)])) as Record<PartId, number[]>,
      profiles,
      headLayers: face?.doc.layers ?? [],
      bodyShape,
      clothing,
      bottoms,
      clothingSkin,
      clothingAccessories,
      heldItem: heldItemId === DEFAULT_HELD_ITEM ? undefined : heldItemId,
      bodyPose,
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
    setBodyShape(doc.bodyShape ?? 'neutral');
    setClothing(doc.clothing ?? 'tee');
    setBottoms(doc.bottoms ?? DEFAULT_BOTTOMS[doc.clothing ?? 'tee']);
    setClothingSkin(doc.clothingSkin ?? 'plain');
    setClothingAccessories(doc.clothingAccessories ?? []);
    setHeldItemId(doc.heldItem ?? DEFAULT_HELD_ITEM);
    setBodyPose(doc.bodyPose ?? 'stand');
    const nextGrids = emptyGrids();
    const nextProfiles = {} as Record<PartId, number[]>;
    for (const id of PART_IDS) {
      const sculpt = doc.parts[id]?.sculpt ?? [];
      const g = sculpt.length === GRID_W * GRID_H ? sculpt.map((b: number) => b / 127) : emptyGrid();
      nextGrids[id] = g;
      uploadGrid(id, g);
      const profile = doc.parts[id]?.profile;
      nextProfiles[id] = profile && profile.length === PROFILE_N ? profile.slice() : defaultProfile(id);
    }
    setGrids(nextGrids);
    setProfiles(nextProfiles);
    setRegionValues(Object.fromEntries(PART_IDS.map((id) => [id, {}])) as Record<PartId, Record<string, number>>);
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

  const facePaintDepth = () =>
    mode === 'flatten' ? 0 : mode === 'raise' ? 0.16 * strength : -0.16 * strength;

  const uvFromScreen = (sx: number, sy: number) => {
    const r = canvasRect.current;
    return {
      cx: clamp((sx - r.x) / r.width, 0, 1),
      cy: clamp((sy - r.y) / r.height, 0, 1),
    };
  };

  const appendFacePoint = (sx: number, sy: number) => {
    const p = uvFromScreen(sx, sy);
    const prev = faceStrokeRef.current[faceStrokeRef.current.length - 1];
    const minStep = Math.max(0.008, brush / PAINT_W * 0.35);
    if (prev) {
      const dx = p.cx - prev.cx;
      const dy = p.cy - prev.cy;
      if (Math.sqrt(dx * dx + dy * dy) < minStep) return;
    }
    faceStrokeRef.current.push(p);
  };

  const ensureFaceDoc = (): HedDocument => face?.doc ?? {
    kind: 'hed',
    version: 1,
    cols: GRID_W,
    rows: GRID_H,
    skin,
    amount,
    scaleY,
    sculpt: emptyGrid(),
    layers: [],
  };

  const commitFaceStroke = () => {
    const points = faceStrokeRef.current;
    faceStrokeRef.current = [];
    if (points.length === 0) return;
    const rx = clamp(brush / PAINT_W, 0.01, 0.2);
    const ry = clamp(brush / PAINT_H, 0.01, 0.2);
    const depth = facePaintDepth();
    const layer: HedLayer = {
      id: `paint-${Date.now()}`,
      label: 'paint stroke',
      color: facePaintColor,
      depth,
      feather: 0.42,
      shapes: points.map((p) => ({ kind: 'ellipse' as const, cx: p.cx, cy: p.cy, rx, ry, mirror: mirror && Math.abs(p.cx - 0.5) > 0.01 ? true : undefined })),
    };
    const doc = ensureFaceDoc();
    setFace({ doc: { ...doc, skin, amount, scaleY, layers: doc.layers.concat(layer) }, id: `paint${Date.now()}` });
    setStatus(`painted ${points.length} face dabs as one .hed layer`);
  };

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

  const onPaintDown = (e: any) => {
    paintingRef.current = true;
    const sx = Number(e?.x ?? 0);
    const sy = Number(e?.y ?? 0);
    if (isHead && paintTool === 'face') {
      faceStrokeRef.current = [];
      appendFacePoint(sx, sy);
    } else {
      dab(sx, sy);
    }
  };
  const onPaintMove = (e: any) => {
    if (!paintingRef.current) return;
    const sx = Number(e?.x ?? 0);
    const sy = Number(e?.y ?? 0);
    if (isHead && paintTool === 'face') appendFacePoint(sx, sy);
    else dab(sx, sy);
  };
  const onPaintUp = () => {
    if (!paintingRef.current) return;
    paintingRef.current = false;
    if (isHead && paintTool === 'face') commitFaceStroke();
    else syncGrid();
  };

  const clearStrokes = () => {
    paints[selPart].paint.clear(NEUTRAL);
    setPartGrid(selPart, emptyGrid());
  };

  // ── outline editor: drag the silhouette edge in/out, lathe-style ──────────
  // Drag previews write latches only; React state and mesh regeneration happen
  // on release via the seq bump (dynamicKey contract).
  const profDab = (sx: number, sy: number) => {
    const r = canvasRect.current;
    const row = Math.max(0, Math.min(PROFILE_N - 1, Math.floor(((sy - r.y) / r.height) * PROFILE_N)));
    const v = Math.max(0.08, Math.min(1, Math.abs(sx - r.x - r.width / 2) / (r.width * 0.45)));
    const next = profileDraftRef.current ?? profiles[selPart].slice();
    const touch = (idx: number, value: number) => {
      next[idx] = clamp(value, 0.06, 1.35);
      writeProfileLatch(selPart, idx, next[idx]);
    };
    touch(row, v);
    // blend the neighbors halfway so a drag carves a smooth curve
    if (row > 0) touch(row - 1, (next[row - 1] + v) / 2);
    if (row < PROFILE_N - 1) touch(row + 1, (next[row + 1] + v) / 2);
    profileDraftRef.current = next;
  };
  const onProfDown = (e: any) => {
    profileDraftRef.current = profiles[selPart].slice();
    paintingRef.current = true;
    profDab(Number(e?.x ?? 0), Number(e?.y ?? 0));
  };
  const onProfMove = (e: any) => { if (paintingRef.current) profDab(Number(e?.x ?? 0), Number(e?.y ?? 0)); };
  const onProfUp = () => {
    if (!paintingRef.current) return;
    paintingRef.current = false;
    const draft = profileDraftRef.current;
    profileDraftRef.current = null;
    if (draft) setProfiles((prev) => ({ ...prev, [selPart]: draft }));
    setSeqs((prev) => ({ ...prev, [selPart]: prev[selPart] + 1 }));
  };
  const resetOutline = () => {
    setProfiles((prev) => ({ ...prev, [selPart]: defaultProfile(selPart) }));
    setSeqs((prev) => ({ ...prev, [selPart]: prev[selPart] + 1 }));
  };

  const setRegionValue = (part: PartId, regionId: string, value: number) => {
    setRegionValues((prev) => ({
      ...prev,
      [part]: {
        ...(prev[part] ?? {}),
        [regionId]: Math.abs(value) < 0.01 ? 0 : clamp(value, -1, 1),
      },
    }));
  };

  const resetRegions = () => {
    setRegionValues((prev) => ({ ...prev, [selPart]: {} }));
  };

  const removeLastPaintLayer = () => {
    setFace((cur) => {
      if (!cur) return cur;
      let drop = -1;
      for (let i = cur.doc.layers.length - 1; i >= 0; i--) {
        if (cur.doc.layers[i].id.startsWith('paint-')) { drop = i; break; }
      }
      if (drop < 0) return cur;
      return { doc: { ...cur.doc, layers: cur.doc.layers.filter((_, i) => i !== drop) }, id: `paint${Date.now()}` };
    });
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
  const regionedGrids = useMemo(
    () => Object.fromEntries(PART_IDS.map((id) => [id, applyRegionValues(id, grids[id], regionValues[id])])) as Record<PartId, number[]>,
    [grids, regionValues],
  );
  const headDisplace = useMemo(
    () => (faceDepth ? regionedGrids.head.map((v, i) => Math.max(-1, Math.min(1, v + faceDepth[i]))) : regionedGrids.head),
    [regionedGrids.head, faceDepth],
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
  const partDisplace = (id: PartId) => (id === 'head' ? headDisplace : regionedGrids[id]);
  const partParams = (id: PartId) => {
    const preset = PART_PRESETS[id];
    const lod = PART_LOD[id];
    return {
      radius: 1, segments: lod.segments, rings: lod.rings,
      displace: partDisplace(id), dCols: GRID_W, dRows: GRID_H,
      amount,
      // non-head parts wear their DRAGGED outline; the head stays a sphere
      profile: id === 'head' ? preset.profile : profiles[id],
      scaleX: preset.scaleX,
      scaleY: id === 'head' ? scaleY : preset.scaleY,
      scaleZ: preset.scaleZ,
    };
  };
  const partDynKey = (id: PartId) => {
    const headBits = id === 'head' ? `${face?.id ?? 'nf'}.${activeAnim ?? 'still'}.${phase}.${scaleY.toFixed(2)}` : 'x';
    return `bodylab-${id}~${seqs[id]}.${headBits}.${amount.toFixed(2)}.${regionSignature(regionValues[id])}`;
  };

  // Content-addressed texture keys (pure functions of their inputs — the
  // carve_lab stale-bake lesson). Non-head parts get separate skin bakes so
  // painted-on garments can live on the torso texture without leaking to arms.
  const headTexKey = `head.lab.${photo?.stamp ?? 'bare'}.${face?.id ?? 'noface'}.${activeAnim ?? 'still'}.${phase}.${skin}.${photoScale.toFixed(2)}.${photoY}`;
  const skinTexKey = (id: PartId) => `body.skin.${id}.${skin}.${clothing}.${bottoms}.${bodyShape}`;
  const partTexKey = (id: PartId) => (id === 'head' ? headTexKey : skinTexKey(id));

  // One stable bundle for the memo'd meshes — identity changes only when
  // something a mesh actually depends on changes, never on orbit drag.
  const partRender = useMemo(() => {
    const out = {} as Record<PartId, PartRender>;
    for (const id of PART_IDS) {
      out[id] = { params: partParams(id), dynKey: partDynKey(id), texKey: partTexKey(id) };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the helpers read exactly these
  }, [regionedGrids, headDisplace, seqs, profiles, face?.id, activeAnim, phase, amount, scaleY, skin, headTexKey, clothing, bottoms, bodyShape, regionValues]);

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
  const bodyPhase = scriptPlaying ? scriptFrame / 20 : bodyRigAnim ? rigFrame / 24 : 0;
  const rigFrameData = useMemo(
    () => buildRigFrame(bodyShape, bodyPose, bodyPhase, scriptActions, clothing, clothingSkin, clothingAccessories, bottoms),
    [bodyShape, bodyPose, bodyPhase, scriptActions, clothing, clothingSkin, clothingAccessories, bottoms],
  );
  const { assembly, clothing: clothingMeshes, anatomy, hitboxes, anchors } = rigFrameData;
  const heldItem = useMemo(() => GAME_ITEMS.find((item) => item.id === heldItemId) ?? null, [heldItemId]);
  const heldItemNeedsTextures = TEXTURED_GAME_ITEMS.includes(heldItemId);

  return (
    <Row style={{ width: '100%', height: '100%', backgroundColor: BG }}>
      {/* ── left: part tabs + the unwrap painter ── */}
      <ScrollView showScrollbar={true} style={{ width: EDITOR_W + 36, height: '100%' }}>
      <Col style={{ width: EDITOR_W + 28, padding: 14, gap: 10 }}>
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
        <Row style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <Text fontSize={11} color={DIM} style={{ width: 52 }}>body</Text>
          {(Object.keys(BODY_SHAPES) as BodyShapeId[]).map((id) => (
            <Chip key={id} label={BODY_SHAPES[id].label} active={bodyShape === id} color={GOOD} onPress={() => { setBodyShape(id); setView('figure'); }} />
          ))}
        </Row>
        <Row style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <Text fontSize={11} color={DIM} style={{ width: 52 }}>clothes</Text>
          {(Object.keys(CLOTHING) as ClothingId[]).map((id) => (
            // picking a top snaps bottoms to its coherent default; override below
            <Chip key={id} label={CLOTHING[id].label} active={clothing === id} color={CLOTHING[id].accent} onPress={() => { setClothing(id); setBottoms(DEFAULT_BOTTOMS[id]); setView('figure'); }} />
          ))}
        </Row>
        <Row style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <Text fontSize={11} color={DIM} style={{ width: 52 }}>bottoms</Text>
          {(Object.keys(BOTTOMS) as BottomsId[]).map((id) => (
            <Chip key={id} label={BOTTOMS[id].label} active={bottoms === id} color={BOTTOMS[id].accent} onPress={() => { setBottoms(id); setView('figure'); }} />
          ))}
        </Row>
        <Row style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <Text fontSize={11} color={DIM} style={{ width: 52 }}>print</Text>
          {(Object.keys(CLOTHING_SKINS) as ClothingSkinId[]).map((id) => (
            <Chip key={id} label={CLOTHING_SKINS[id].label} active={clothingSkin === id} color={id === 'plain' ? GOOD : '#f59e0b'} onPress={() => { setClothingSkin(id); setView('figure'); }} />
          ))}
        </Row>
        <Row style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <Text fontSize={11} color={DIM} style={{ width: 52 }}>extras</Text>
          {(Object.keys(CLOTHING_ACCESSORIES) as ClothingAccessoryId[]).map((id) => (
            <Chip
              key={id}
              label={CLOTHING_ACCESSORIES[id].label}
              active={clothingAccessories.includes(id)}
              color="#a78bfa"
              onPress={() => {
                setClothingAccessories((cur) => {
                  if (cur.includes(id)) return cur.filter((x) => x !== id);
                  const withoutHatConflict = id === 'cap' ? cur.filter((x) => x !== 'beanie') : id === 'beanie' ? cur.filter((x) => x !== 'cap') : cur;
                  return withoutHatConflict.concat(id);
                });
                setView('figure');
              }}
            />
          ))}
        </Row>
        <Row style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <Text fontSize={11} color={DIM} style={{ width: 52 }}>prop</Text>
          <Chip label="none" active={heldItemId === DEFAULT_HELD_ITEM} color={GOOD} onPress={() => { setHeldItemId(DEFAULT_HELD_ITEM); setView('figure'); }} />
          {GAME_ITEMS.map((item) => (
            <Chip key={item.id} label={item.label} active={heldItemId === item.id} color={item.tone} onPress={() => { setHeldItemId(item.id); setView('figure'); }} />
          ))}
        </Row>
        <Row style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <Text fontSize={11} color={DIM} style={{ width: 52 }}>rig</Text>
          {(Object.keys(BODY_POSES) as BodyPoseId[]).map((id) => (
            <Chip key={id} label={BODY_POSES[id].label} active={bodyPose === id} color={GOOD} onPress={() => { setBodyPose(id); setView('figure'); }} />
          ))}
          <Chip label={bodyRigAnim ? 'anim ■' : 'anim'} active={bodyRigAnim} color={GOOD} onPress={() => { setBodyRigAnim((v) => !v); setView('figure'); }} />
          <Chip label="hitboxes" active={showHitboxes} color="#35d0ff" onPress={() => { setShowHitboxes((v) => !v); setView('figure'); }} />
        </Row>
        <Row style={{ gap: 8, alignItems: 'center' }}>
          <Text fontSize={11} color={DIM} style={{ width: 52 }}>script</Text>
          <TextInput
            value={animScript}
            onChangeText={(text: string) => setAnimScript(text)}
            fontSize={11}
            style={{ height: 30, flexGrow: 1, backgroundColor: '#0f172a', borderWidth: 1, borderColor: timeline.error ? '#7f1d1d' : '#22324a', borderRadius: 5, paddingLeft: 8, paddingRight: 8, color: INK }}
          />
          <Chip label={scriptPlaying ? 'play ■' : 'play'} active={scriptPlaying} color={GOOD} onPress={() => { setScriptPlaying((v) => !v); setBodyRigAnim(false); setView('figure'); }} />
          <Chip label="reset" active={false} onPress={() => { setScriptFrame(0); setAnimScript(DEFAULT_ANIM_SCRIPT); }} />
        </Row>
        <Row style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <Text fontSize={11} color={DIM} style={{ width: 52 }}>presets</Text>
          {Object.entries(ANIM_PRESETS).map(([label, script]) => (
            <Chip
              key={label}
              label={label}
              active={animScript === script}
              color="#f97316"
              onPress={() => {
                setAnimScript(script);
                setScriptFrame(0);
                setScriptPlaying(true);
                setBodyRigAnim(false);
                setView('figure');
              }}
            />
          ))}
        </Row>
        {!isHead ? (
          <Row style={{ gap: 8, alignItems: 'center' }}>
            <Chip label="outline" active={editTab === 'outline'} onPress={() => setEditTab('outline')} />
            <Chip label="detail paint" active={editTab === 'detail'} onPress={() => setEditTab('detail')} />
            {editTab === 'outline' ? <Chip label="reset outline" active={false} onPress={resetOutline} /> : null}
          </Row>
        ) : null}
        {isHead ? (
          <>
            <Row style={{ gap: 8, alignItems: 'center' }}>
              <Text fontSize={11} color={DIM} style={{ width: 52 }}>paint</Text>
              <Chip label="sculpt" active={paintTool === 'sculpt'} onPress={() => setPaintTool('sculpt')} />
              <Chip label="face color" active={paintTool === 'face'} color="#f59e0b" onPress={() => setPaintTool('face')} />
            </Row>
            {paintTool === 'face' ? (
              <Row style={{ gap: 6, alignItems: 'center' }}>
                <Text fontSize={11} color={DIM} style={{ width: 52 }}>color</Text>
                {FACE_PAINTS.map((c) => (
                  <Pressable key={c} onPress={() => setFacePaintColor(c)} style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: c, borderWidth: 2, borderColor: facePaintColor === c ? ACCENT : '#22324a' }} />
                ))}
              </Row>
            ) : null}
          </>
        ) : null}
        {!isHead && editTab === 'outline' ? (
          // the part's actual silhouette, dragged like a lathe: pull the edge
          // out or push it in at any height — this IS the shape, not a field
          <Pressable
            onLayout={(lr: any) => { canvasRect.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
            onMouseDown={onProfDown}
            onMouseMove={onProfMove}
            onMouseUp={onProfUp}
            style={{ width: EDITOR_W, height: EDITOR_H, borderWidth: 1, borderColor: '#22324a', position: 'relative', backgroundColor: '#0a1322' }}
          >
            {profiles[selPart].map((_p, i) => {
              const rowH = EDITOR_H / PROFILE_N;
              return (
                <Box
                  key={i}
                  style={{ position: 'absolute', left: ('latch:' + profileLatchKey(selPart, i, 'left')) as any, top: i * rowH, width: ('latch:' + profileLatchKey(selPart, i, 'width')) as any, height: rowH - 1, backgroundColor: skin, borderRadius: 4 }}
                />
              );
            })}
            <Box style={{ position: 'absolute', left: EDITOR_W / 2 - 1, top: 0, width: 2, height: EDITOR_H, backgroundColor: '#22324a' }} />
          </Pressable>
        ) : (
          <Pressable
            onLayout={(lr: any) => { canvasRect.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
            onMouseDown={onPaintDown}
            onMouseMove={onPaintMove}
            onMouseUp={onPaintUp}
            style={{ width: EDITOR_W, height: EDITOR_H, borderWidth: 1, borderColor: '#22324a', position: 'relative' }}
          >
            <UnwrapContent
              skin={skin}
              photo={isHead ? photo : null}
              photoScale={photoScale}
              photoY={photoY}
              layers={isHead ? shownDoc?.layers ?? null : null}
              width={EDITOR_W}
              height={EDITOR_H}
            />
            <Effect
              shader={DEPTH_OVERLAY_WGSL}
              data={[0]}
              textures={[paints[selPart].id, relief.id]}
              style={{ position: 'absolute', left: 0, top: 0, width: EDITOR_W, height: EDITOR_H }}
            />
          </Pressable>
        )}
        {isHead || editTab === 'detail' ? (
          <>
            <Row style={{ gap: 8, alignItems: 'center' }}>
              <Chip label="raise" active={mode === 'raise'} onPress={() => setMode('raise')} />
              <Chip label="carve in" active={mode === 'lower'} color="#ff9445" onPress={() => setMode('lower')} />
              <Chip label="flatten" active={mode === 'flatten'} color="#94a3b8" onPress={() => setMode('flatten')} />
            </Row>
            {isHead && paintTool === 'face' ? (
              <Row style={{ gap: 8, alignItems: 'center' }}>
                <Chip label="mirror" active={mirror} onPress={() => setMirror((v) => !v)} />
                {face && face.doc.layers.some((l) => l.id.startsWith('paint-')) ? (
                  <Chip
                    label="undo paint"
                    active={false}
                    color="#f59e0b"
                    onPress={removeLastPaintLayer}
                  />
                ) : null}
              </Row>
            ) : (
              <Row style={{ gap: 8, alignItems: 'center' }}>
                <Chip label="fill" active={false} onPress={fillAll} />
                <Chip label="soften" active={false} onPress={soften} />
                <Chip label="mirror" active={mirror} onPress={() => setMirror((v) => !v)} />
                <Chip label="clear" active={false} onPress={clearStrokes} />
              </Row>
            )}
          </>
        ) : null}
        {isHead ? (
          <Row style={{ gap: 8, alignItems: 'center' }}>
            <Chip label="generate face" active={false} color={GOOD} onPress={generateFaceOnly} />
            <Chip label="save head" active={false} onPress={saveHead} />
            {face ? <Chip label="remove face" active={false} onPress={() => { setFace(null); setAnim(null); setStatus(null); }} /> : null}
          </Row>
        ) : null}
        {isHead && face ? (
          <Row style={{ gap: 8, alignItems: 'center' }}>
            <Text fontSize={11} color={DIM} style={{ width: 84 }}>animate</Text>
            {(['talk', 'chew', 'cry', 'yell'] as HedAnimation[]).map((a) => (
              <Chip key={a} label={anim === a ? `${a} ■` : a} active={anim === a} color={GOOD} onPress={() => setAnim((cur) => (cur === a ? null : a))} />
            ))}
          </Row>
        ) : null}
        <Row style={{ gap: 8, alignItems: 'center' }}>
          <Chip label="generate" active={false} color={GOOD} onPress={generateCharacter} />
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
        <Col style={{ gap: 6, paddingTop: 4 }}>
          <Row style={{ gap: 8, alignItems: 'center' }}>
            <Text fontSize={11} color={DIM} style={{ width: 84 }}>region shape</Text>
            <Chip label="reset" active={false} onPress={resetRegions} />
          </Row>
          {SHAPE_REGIONS[selPart].map((region) => (
            <RegionSlider
              key={`${selPart}.${region.id}`}
              keyBase={`headlab.${selPart}.${region.id}`}
              label={region.label}
              value={regionValues[selPart]?.[region.id] ?? 0}
              onCommit={(value) => setRegionValue(selPart, region.id, value)}
            />
          ))}
        </Col>
      </Col>
      </ScrollView>

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
          <PartMeshes view={view} selPart={selPart} parts={partRender} assembly={assembly} anatomy={anatomy} clothing={clothingMeshes} hitboxes={hitboxes} anchors={anchors} showHitboxes={showHitboxes} />
          {view === 'figure' ? <HeldGameItem item={heldItem} assembly={assembly} /> : null}
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
      {PART_IDS.filter((id) => id !== 'head').map((id) => (
        <StaticSurface key={`skin-${id}`} staticKey={skinTexKey(id)} style={surfaceStyle}>
          <SkinUnwrapContent skin={skin} part={id} clothing={clothing} bottoms={bottoms} bodyShape={bodyShape} />
        </StaticSurface>
      ))}
      <ClothingSkinCaptures />
      {heldItemNeedsTextures ? <MemoGameItemTextureSources tvTick={heldItemId === 'tv' ? scriptFrame * 2 + rigFrame : 0} itemId={heldItemId} /> : null}
    </Row>
  );
}
