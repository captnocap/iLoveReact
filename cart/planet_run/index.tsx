// planet_run — a tiny "the world rolls under your feet" coin-rush demo game.
//
// The funky planet effect: the character NEVER moves. They walk in place at
// the north pole of a small planet whose center sits at [0, -R, 0], and the
// whole planet — one Effect-baked textured Globe plus every tree, rock and
// coin pinned to it in planet-local unit directions — rolls underneath via an
// accumulated quaternion. Walking forward with heading f spins the planet
// about the axis (-fz, 0, fx) by dist/R, so the surface flows backward under
// the feet and whatever lies ahead on the sphere crests the horizon toward
// you. Curvature does the rest of the "as big as the planet" feeling.
//
// Systems reused (per the labs):
//   - character model + walk gait + DSL animations: cart/head_lab (buildRigFrame,
//     generateFace/hedDepthGrid face → Globe displacement, animDsl timelines —
//     fist pump on collect, dance on win, defeated sit on loss)
//   - input + frame loop: hmsc's pattern (busOn '__keydown'/'__keyup' bus +
//     rAF-or-setTimeout tick — the cart host has no requestAnimationFrame)
//   - camera: @reactjit/cameras Follow rig (chase cam behind the heading)
//   - planet surface: ONE Effect WGSL bake (fbm continents/oceans/ice caps)
//     on a StaticSurface → Globe textureKey (the 2D-on-3D-faces pipeline)
//   - geometry: @reactjit/geometries registry only (no framework shape names)
//
// Rotation math matches framework/gpu/3d.zig makeInstance: model = T·Ry·Rx·Rz·S
// with degrees, so the quaternion → euler extraction below is the YXZ order.
//
// Controls: W/S walk · A/D turn · SHIFT run · SPACE hop · ENTER/R restart.
// Ship: ./scripts/ship planet_run      Dev: ./scripts/dev planet_run

import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Col, Row, Effect, Pressable, Text, Scene3D, StaticSurface } from '@reactjit/runtime/primitives';
import { busOn } from '@reactjit/runtime/hooks/useIFTTT';
import * as Geometry from '@reactjit/geometries';
import { FollowCamera } from '@reactjit/cameras';
import {
  buildRigFrame, PART_IDS, PART_PRESETS, defaultProfile,
  type BodyPoseId, type BodyRigFrame, type ClothingInstance, type PartId,
} from '../head_lab/parts';
import { parseAnimationDsl, sampleAnimationTimeline } from '../head_lab/animDsl';
import { generateFace, hedDepthGrid, HED_GRID_W, HED_GRID_H, type HedDocument, type HedLayer } from '../head_lab/hed';

// ── tuning ───────────────────────────────────────────────────────────────────

const PLANET_R = 7.5;       // small enough that the horizon curves hard
const COIN_COUNT = 10;
const ROUND_SECONDS = 60;
const WALK_SPEED = 2.8;     // m/s along the surface
const RUN_SPEED = 5.4;
const TURN_DEG_PER_S = 160;
const COLLECT_METERS = 1.35;
const HOP_VELOCITY = 5.4;
const HOP_GRAVITY = 13.5;

const BG = '#04060e';
const INK = '#e8eef8';
const DIM = '#7f93b1';
const GOLD = '#f7c948';
const GOOD = '#34d399';
const BAD = '#f87171';

// ── quaternion / matrix helpers (host euler order: Ry·Rx·Rz, degrees) ───────

type V3 = [number, number, number];
type Quat = [number, number, number, number]; // [w, x, y, z]
type M3 = number[]; // 9 floats, row-major, column-vector convention

const QUAT_IDENTITY: Quat = [1, 0, 0, 0];
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

function quatAxisAngle(axis: V3, angle: number): Quat {
  const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const half = angle / 2;
  const s = Math.sin(half) / len;
  return [Math.cos(half), axis[0] * s, axis[1] * s, axis[2] * s];
}

function quatMul(a: Quat, b: Quat): Quat {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

function quatNormalize(q: Quat): Quat {
  const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

function quatRotate(q: Quat, v: V3): V3 {
  // v' = v + 2w(q×v) + 2(q×(q×v))
  const [w, x, y, z] = q;
  const cx = y * v[2] - z * v[1];
  const cy = z * v[0] - x * v[2];
  const cz = x * v[1] - y * v[0];
  return [
    v[0] + 2 * (w * cx + y * cz - z * cy),
    v[1] + 2 * (w * cy + z * cx - x * cz),
    v[2] + 2 * (w * cz + x * cy - y * cx),
  ];
}

function m3FromQuat(q: Quat): M3 {
  const [w, x, y, z] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

function m3RotX(a: number): M3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}
function m3RotY(a: number): M3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}
function m3RotZ(a: number): M3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

function m3Mul(a: M3, b: M3): M3 {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return o;
}

// Decompose M = Ry(y)·Rx(x)·Rz(z) — the exact order 3d.zig composes mesh
// rotations in — back to degrees for the rotation prop.
function eulerYXZ(m: M3): V3 {
  const sx = -m[5]; // -m[1][2] = sin(x)
  if (Math.abs(sx) > 0.9999) {
    return [Math.asin(Math.max(-1, Math.min(1, sx))) * DEG, Math.atan2(-m[6], m[0]) * DEG, 0];
  }
  return [
    Math.asin(Math.max(-1, Math.min(1, sx))) * DEG,
    Math.atan2(m[2], m[8]) * DEG,
    Math.atan2(m[3], m[4]) * DEG,
  ];
}

/** Euler degrees that point a mesh's local +Y along world direction d. */
function alignRotation(d: V3): V3 {
  return [Math.acos(Math.max(-1, Math.min(1, d[1]))) * DEG, Math.atan2(d[0], d[2]) * DEG, 0];
}

/** An upright coin standing on the surface at d, spun around the surface
 *  normal: M = align(d) · Ry(spin) · Rz(90°) (cylinder axis tipped sideways). */
function coinRotation(d: V3, spinDeg: number): V3 {
  const pitch = Math.acos(Math.max(-1, Math.min(1, d[1])));
  const yaw = Math.atan2(d[0], d[2]);
  const m = m3Mul(m3Mul(m3Mul(m3RotY(yaw), m3RotX(pitch)), m3RotY(spinDeg * RAD)), m3RotZ(Math.PI / 2));
  return eulerYXZ(m);
}

function rotYVec(p: V3, rad: number): V3 {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
}

// ── the planet surface — one WGSL bake, equirect like the Globe unwrap ──────

const PLANET_TEX_W = 512;
const PLANET_TEX_H = 256;
const PLANET_TEX_KEY = 'planetrun.surface';

// fbm continents over a seamless cylinder mapping (cos/sin of longitude feed
// the noise, so u=0 and u=1 sample identical fields — no seam down the back).
// Mirrored EXACTLY by terrainAt() below so trees/rocks only spawn on land.
//
// Helpers wear a pr_ prefix: the effect pipeline prepends its shared WGSL math
// library (framework/gpu/effect_math.wgsl — fbm/snoise/voronoi/...), and a
// bare "fn fbm" here is a redefinition that hard-crashes shader creation.
// We keep our own [0,1] value-noise pair so the JS mirror stays exact.
const PLANET_WGSL = `
const TAU: f32 = 6.28318530718;
@group(0) @binding(1) var<storage, read> ys: array<f32>;

fn pr_hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}
fn pr_vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = pr_hash(i);
  let b = pr_hash(i + vec2f(1.0, 0.0));
  let c = pr_hash(i + vec2f(0.0, 1.0));
  let d = pr_hash(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn pr_fbm(p: vec2f) -> f32 {
  var v = 0.0;
  var amp = 0.5;
  var q = p;
  for (var i = 0; i < 4; i = i + 1) {
    v = v + amp * pr_vnoise(q);
    q = q * 2.03 + vec2f(13.7, 7.1);
    amp = amp * 0.5;
  }
  return v;
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let u = in.uv.x;
  let v = in.uv.y;
  let ang = u * TAU;
  let n = pr_fbm(vec2f(cos(ang) * 1.15 + 5.2, v * 3.1)) * 0.55
        + pr_fbm(vec2f(sin(ang) * 1.15 - 2.7, v * 3.3 + 9.4)) * 0.45;

  let ocean_deep = vec3f(0.06, 0.20, 0.40);
  let ocean = vec3f(0.10, 0.34, 0.58);
  let sand = vec3f(0.80, 0.72, 0.46);
  let grass = vec3f(0.32, 0.60, 0.28);
  let forest = vec3f(0.15, 0.40, 0.20);

  var col = mix(ocean_deep, ocean, smoothstep(0.30, 0.50, n));
  let land = mix(sand, mix(grass, forest, smoothstep(0.56, 0.74, n)), smoothstep(0.53, 0.57, n));
  col = mix(col, land, smoothstep(0.50, 0.53, n));

  // polar ice caps
  let pol = max(smoothstep(0.87, 0.97, v), 1.0 - smoothstep(0.03, 0.13, v));
  col = mix(col, vec3f(0.88, 0.93, 0.97), pol);

  // faint latitude banding for the toy-globe look
  col = col * (0.965 + 0.035 * sin(v * 28.0));
  return vec4f(col, 1.0);
}
`;

// JS mirror of the shader's pr_* land test so props spawn on continents.
function prHash(px: number, py: number): number {
  const s = Math.sin(px * 127.1 + py * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function prVnoise(px: number, py: number): number {
  const ix = Math.floor(px), iy = Math.floor(py);
  const fx = px - ix, fy = py - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = prHash(ix, iy), b = prHash(ix + 1, iy), c = prHash(ix, iy + 1), d = prHash(ix + 1, iy + 1);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}
function prFbm(px: number, py: number): number {
  let v = 0, amp = 0.5, qx = px, qy = py;
  for (let i = 0; i < 4; i++) {
    v += amp * prVnoise(qx, qy);
    qx = qx * 2.03 + 13.7;
    qy = qy * 2.03 + 7.1;
    amp *= 0.5;
  }
  return v;
}
/** Terrain height value at a planet-local unit direction (matches the bake). */
function terrainAt(d: V3): number {
  // Globe unwrap inverse: phi = π/2 − 2πu, v = θ/π
  const v = Math.acos(Math.max(-1, Math.min(1, d[1]))) / Math.PI;
  const phi = Math.atan2(d[2], d[0]);
  const ang = Math.PI / 2 - phi; // = u·2π
  return prFbm(Math.cos(ang) * 1.15 + 5.2, v * 3.1) * 0.55
    + prFbm(Math.sin(ang) * 1.15 - 2.7, v * 3.3 + 9.4) * 0.45;
}

const PlanetSurfaceCapture = memo(function PlanetSurfaceCapture() {
  const surfaceStyle = useMemo(
    () => ({ position: 'absolute' as const, left: -99999, top: 0, width: PLANET_TEX_W, height: PLANET_TEX_H }),
    [],
  );
  const effectStyle = useMemo(() => ({ width: PLANET_TEX_W, height: PLANET_TEX_H }), []);
  const data = useMemo(() => [0], []);
  return (
    <StaticSurface staticKey={PLANET_TEX_KEY} style={surfaceStyle}>
      <Effect shader={PLANET_WGSL} data={data} style={effectStyle} />
    </StaticSurface>
  );
});

// ── character textures — head_lab's unwrap-composition pattern ──────────────
// The generated .hed face layers painted as absolute boxes over the skin base
// (the compact twin of head_lab's HedLayerPaint/UnwrapContent, photo-less).

const UNWRAP_W = 512;
const UNWRAP_H = 256;

function FaceLayerPaint(props: { layers: HedLayer[] }) {
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

const CharacterCaptures = memo(function CharacterCaptures(props: {
  headTexKey: string;
  skinTexKey: string;
  skin: string;
  layers: HedLayer[];
}) {
  const surfaceStyle = useMemo(
    () => ({ position: 'absolute' as const, left: -99999, top: 0, width: UNWRAP_W, height: UNWRAP_H }),
    [],
  );
  return (
    <>
      <StaticSurface staticKey={props.headTexKey} style={surfaceStyle}>
        <Box style={{ width: UNWRAP_W, height: UNWRAP_H, backgroundColor: props.skin, position: 'relative', overflow: 'hidden' }}>
          <FaceLayerPaint layers={props.layers} />
        </Box>
      </StaticSurface>
      <StaticSurface staticKey={props.skinTexKey} style={surfaceStyle}>
        <Box style={{ width: UNWRAP_W, height: UNWRAP_H, backgroundColor: props.skin }} />
      </StaticSurface>
    </>
  );
});

// ── the figure — head_lab parts placed at the pole, yawed to the heading ────

const PART_LOD: Record<PartId, { segments: number; rings: number }> = {
  head: { segments: 40, rings: 20 },
  torso: { segments: 24, rings: 12 },
  pipe: { segments: 16, rings: 9 },
  hand: { segments: 16, rings: 8 },
  foot: { segments: 14, rings: 8 },
  finger: { segments: 10, rings: 7 },
};

type PartRender = { params: any; dynKey: string; texKey: string };

function buildPartRender(doc: HedDocument, faceDepth: number[], seed: number): Record<PartId, PartRender> {
  const out = {} as Record<PartId, PartRender>;
  const skinTexKey = `planetrun.skin.${doc.skin}`;
  for (const id of PART_IDS) {
    const preset = PART_PRESETS[id];
    const lod = PART_LOD[id];
    out[id] = {
      params: {
        radius: 1, segments: lod.segments, rings: lod.rings,
        displace: id === 'head' ? faceDepth : undefined,
        dCols: HED_GRID_W, dRows: HED_GRID_H,
        amount: id === 'head' ? doc.amount : 0,
        profile: id === 'head' ? preset.profile : defaultProfile(id),
        scaleX: preset.scaleX,
        scaleY: id === 'head' ? doc.scaleY : preset.scaleY,
        scaleZ: preset.scaleZ,
      },
      // Dyn-key contract (3d.zig dynSlotLocate): "<slotId>~<version>" — the
      // '~' is REQUIRED. Without it the slot lookup returns null and the host
      // silently skips the mesh (invisible body, visible clothing).
      dynKey: `planetrun.${id}~${seed}`,
      texKey: id === 'head' ? `planetrun.head.${seed}` : skinTexKey,
    };
  }
  return out;
}

const clothingGeometry = (kind: ClothingInstance['geometry']) =>
  kind === 'sphere' ? Geometry.Sphere : kind === 'cone' ? Geometry.Cone : kind === 'cylinder' ? Geometry.Cylinder : Geometry.Box;

// The assembled head_lab figure, rotated to face the heading and lifted by the
// hop. World yaw W prepends cleanly: positions rotate around Y, and because
// the host composes Ry·Rx·Rz, adding W to each instance's ry IS Ry(W)·R.
function Figure(props: { rig: BodyRigFrame; yawDeg: number; hopY: number; parts: Record<PartId, PartRender> }) {
  const rad = props.yawDeg * RAD;
  const place = (p: V3): V3 => {
    const r = rotYVec(p, rad);
    return [r[0], r[1] + props.hopY, r[2]];
  };
  const turn = (r?: V3): V3 => [r?.[0] ?? 0, (r?.[1] ?? 0) + props.yawDeg, r?.[2] ?? 0];
  return (
    <>
      {props.rig.assembly.map((inst, i) => {
        const p = props.parts[inst.part];
        return (
          <Scene3D.Mesh
            key={`a${i}`}
            geometry={Geometry.Globe}
            params={p.params}
            dynamicKey={p.dynKey}
            material="#ffffff"
            textureKey={p.texKey}
            position={place(inst.position)}
            rotation={turn(inst.rotation)}
            scale={inst.thickness != null ? [inst.scale * inst.thickness, inst.scale, inst.scale * inst.thickness] : inst.scale}
          />
        );
      })}
      {props.rig.anatomy.map((inst, i) => {
        const p = props.parts[inst.part];
        return (
          <Scene3D.Mesh
            key={`n${i}`}
            geometry={Geometry.Globe}
            params={p.params}
            dynamicKey={p.dynKey}
            material="#ffffff"
            textureKey={p.texKey}
            position={place(inst.position)}
            rotation={turn(inst.rotation)}
            scale={inst.thickness != null ? [inst.scale * inst.thickness, inst.scale, inst.scale * inst.thickness] : inst.scale}
          />
        );
      })}
      {props.rig.clothing.map((inst, i) => (
        <Scene3D.Mesh
          key={`c${i}`}
          geometry={clothingGeometry(inst.geometry)}
          params={inst.params}
          material={inst.textureKey ? '#ffffff' : inst.color}
          textureKey={inst.textureKey}
          position={place(inst.position)}
          rotation={turn(inst.rotation)}
          scale={inst.scale ?? 1}
        />
      ))}
    </>
  );
}

// ── world generation — coins + land-only props, all in planet-local dirs ────

type SurfaceProp = { dir: V3; size: number; tone: string };

function seededRandom(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function randomDir(rand: () => number): V3 {
  const y = rand() * 2 - 1;
  const ang = rand() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  return [r * Math.cos(ang), y, r * Math.sin(ang)];
}

const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const TREE_TONES = ['#1d6b35', '#2c7d3f', '#1a5c40'];
const ROCK_TONES = ['#7b8494', '#646c7c', '#8d93a1'];

function generateWorld(seed: number) {
  const rand = seededRandom(seed);
  const doc = generateFace(seed, { style: rand() < 0.4 ? 'feminine' : 'masculine' });
  const faceDepth = hedDepthGrid(doc);

  const coins: V3[] = [];
  let guard = 0;
  while (coins.length < COIN_COUNT && guard++ < 500) {
    const d = randomDir(rand);
    if (d[1] > 0.93) continue; // not under the spawn pole
    if (coins.some((c) => dot3(c, d) > 0.9)) continue; // spread out
    coins.push(d);
  }

  const onLand = (d: V3, bar: number) => terrainAt(d) > bar;
  const scatter = (count: number, bar: number, sizeLo: number, sizeHi: number, tones: string[]): SurfaceProp[] => {
    const out: SurfaceProp[] = [];
    let tries = 0;
    while (out.length < count && tries++ < 900) {
      const d = randomDir(rand);
      if (d[1] > 0.9) continue;
      if (!onLand(d, bar)) continue;
      if (coins.some((c) => dot3(c, d) > 0.985)) continue; // keep coins reachable
      out.push({ dir: d, size: sizeLo + rand() * (sizeHi - sizeLo), tone: tones[Math.floor(rand() * tones.length)] });
    }
    return out;
  };

  return {
    doc,
    faceDepth,
    parts: buildPartRender(doc, faceDepth, seed),
    coins,
    trees: scatter(8, 0.56, 0.8, 1.35, TREE_TONES),
    rocks: scatter(9, 0.52, 0.5, 1.1, ROCK_TONES),
    tufts: scatter(12, 0.56, 0.4, 0.8, ['#3f9e4e', '#57b05a']),
  };
}

// ── animation timelines (head_lab DSL) ───────────────────────────────────────

const PUMP_TIMELINE = parseAnimationDsl('[0.5,right_arm,lift_and_bend;0.5,right_fist,clench]');
const DANCE_TIMELINE = parseAnimationDsl('[1,both_arms,swing_loop;1,both_feet,tap_loop;1,body,bounce_loop;1,head,nod_loop]');
const DEFEAT_TIMELINE = parseAnimationDsl('[1.4,body,sit]');

// ── the game ─────────────────────────────────────────────────────────────────

type GamePhase = 'ready' | 'playing' | 'won' | 'lost';

type Sim = {
  q: Quat;
  headingDeg: number;
  hopY: number;
  hopVy: number;
  grounded: boolean;
  animSeconds: number;
  gaitPhase: number;
  moving: boolean;
  running: boolean;
  timeLeft: number;
  collected: boolean[];
  collectedCount: number;
  pumpStart: number;
  endStart: number;
};

function makeSim(): Sim {
  return {
    q: QUAT_IDENTITY,
    headingDeg: 0,
    hopY: 0,
    hopVy: 0,
    grounded: true,
    animSeconds: 0,
    gaitPhase: 0,
    moving: false,
    running: false,
    timeLeft: ROUND_SECONDS,
    collected: new Array(COIN_COUNT).fill(false),
    collectedCount: 0,
    pumpStart: -99,
    endStart: 0,
  };
}

const COIN_PARAMS = { radius: 0.34, height: 0.07, segments: 22 };
const TRUNK_PARAMS = { radius: 0.09, height: 0.8, segments: 8 };
const CANOPY_PARAMS = { radius: 0.5, height: 1.15, segments: 10 };
const ROCK_PARAMS = { radius: 0.3, segments: 10, rings: 7 };
const TUFT_PARAMS = { radius: 0.16, height: 0.3, segments: 6 };
const MOON_PARAMS = { radius: 1.1, segments: 24, rings: 14 };
const SHADOW_PARAMS = { radius: 0.42, height: 0.02, segments: 18 };
const COMPASS_PARAMS = { radius: 0.14, height: 0.42, segments: 8 };
const PLANET_PARAMS = { radius: PLANET_R, segments: 56, rings: 32 };

export default function PlanetRun() {
  const [seed, setSeed] = useState(20260603);
  const [phase, setPhase] = useState<GamePhase>('ready');
  const [, setTick] = useState(0);
  const simRef = useRef<Sim>(makeSim());
  const phaseRef = useRef<GamePhase>('ready');
  const keysRef = useRef<Record<string, boolean>>({});

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const world = useMemo(() => generateWorld(seed), [seed]);

  const beginRound = (newSeed?: number) => {
    if (newSeed != null) setSeed(newSeed);
    simRef.current = makeSim();
    setPhase('playing');
  };
  const beginRoundRef = useRef(beginRound);
  beginRoundRef.current = beginRound;

  // keyboard — the hmsc '__keydown'/'__keyup' bus pattern
  useEffect(() => {
    const setKey = (event: any, down: boolean) => {
      const key = String(event?.key ?? '').toLowerCase();
      if (key) keysRef.current[key] = down;
      if (typeof event?.shiftKey === 'boolean') keysRef.current.__shift = event.shiftKey;
    };
    const offDown = busOn('__keydown', (event: any) => {
      setKey(event, true);
      const key = String(event?.key ?? '').toLowerCase();
      if (key === 'r') beginRoundRef.current(Date.now() & 0x7fffffff);
      else if (key === 'enter' && phaseRef.current !== 'playing') {
        beginRoundRef.current(phaseRef.current === 'ready' ? undefined : Date.now() & 0x7fffffff);
      }
    });
    const offUp = busOn('__keyup', (event: any) => setKey(event, false));
    return () => { offDown(); offUp(); };
  }, []);

  // the game loop — rAF if the host ever grows one, setTimeout(16) today
  useEffect(() => {
    const host: any = globalThis;
    const schedule = host.requestAnimationFrame ? host.requestAnimationFrame.bind(host) : (fn: any) => setTimeout(fn, 16);
    const cancel = host.cancelAnimationFrame ? host.cancelAnimationFrame.bind(host) : clearTimeout;
    let handle: any = 0;
    let lastNow = host.performance?.now?.() ?? Date.now();

    const tick = () => {
      const now = host.performance?.now?.() ?? Date.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - lastNow) / 1000));
      lastNow = now;
      const s = simRef.current;
      const keys = keysRef.current;
      s.animSeconds += dt;

      if (phaseRef.current === 'playing') {
        // turn (A/D) — heading; forward = [sin h, 0, cos h], camera trails it
        let turn = 0;
        if (keys.a || keys.left) turn += 1;
        if (keys.d || keys.right) turn -= 1;
        s.headingDeg += turn * TURN_DEG_PER_S * dt;

        // walk (W/S) — roll the planet under the feet, never move the player
        let fwd = 0;
        if (keys.w || keys.up) fwd += 1;
        if (keys.s || keys.down) fwd -= 1;
        const running = !!keys.__shift;
        s.running = running && fwd !== 0;
        s.moving = fwd !== 0;
        if (fwd !== 0) {
          const speed = running ? RUN_SPEED : WALK_SPEED;
          const dist = fwd * speed * dt;
          const h = s.headingDeg * RAD;
          const fx = Math.sin(h), fz = Math.cos(h);
          // surface must flow backward (-f) under the pole → axis (-fz, 0, fx)
          s.q = quatNormalize(quatMul(quatAxisAngle([-fz, 0, fx], dist / PLANET_R), s.q));
          s.gaitPhase += (running ? 2.3 : 1.55) * dt;
        }

        // hop
        if ((keys[' '] || keys.space || keys.spacebar) && s.grounded) {
          s.grounded = false;
          s.hopVy = HOP_VELOCITY;
        }
        if (!s.grounded) {
          s.hopVy -= HOP_GRAVITY * dt;
          s.hopY += s.hopVy * dt;
          if (s.hopY <= 0) { s.hopY = 0; s.hopVy = 0; s.grounded = true; }
        }

        // coins — angular proximity to the pole the player stands on
        for (let i = 0; i < world.coins.length; i++) {
          if (s.collected[i]) continue;
          const w = quatRotate(s.q, world.coins[i]);
          const ang = Math.acos(Math.max(-1, Math.min(1, w[1])));
          if (ang * PLANET_R < COLLECT_METERS && s.hopY < 1.2) {
            s.collected[i] = true;
            s.collectedCount += 1;
            s.pumpStart = s.animSeconds;
            if (s.collectedCount >= world.coins.length) {
              s.endStart = s.animSeconds;
              setPhase('won');
            }
          }
        }

        s.timeLeft -= dt;
        if (s.timeLeft <= 0 && phaseRef.current === 'playing') {
          s.timeLeft = 0;
          s.endStart = s.animSeconds;
          s.moving = false;
          setPhase('lost');
        }
      } else if (phaseRef.current === 'ready') {
        // attract mode: the planet idles around a lazy tilted axis
        s.q = quatNormalize(quatMul(quatAxisAngle([0.25, 1, 0.18], 0.12 * dt), s.q));
      }

      setTick((t) => t + 1);
      handle = schedule(tick);
    };

    handle = schedule(tick);
    return () => cancel(handle);
  }, [world]);

  // ── per-frame derivation (the tick re-renders us) ──────────────────────────
  const s = simRef.current;
  const planetEuler = eulerYXZ(m3FromQuat(s.q));
  const t = s.animSeconds;

  // figure pose + DSL actions: walk gait while moving, fist pump riding a
  // collect, dance loop on win, defeated sit on loss
  let pose: BodyPoseId = 'stand';
  let rigPhase = 0;
  let actions = [] as ReturnType<typeof sampleAnimationTimeline>;
  if (phase === 'won') {
    actions = sampleAnimationTimeline(DANCE_TIMELINE, t - s.endStart);
  } else if (phase === 'lost') {
    actions = sampleAnimationTimeline(DEFEAT_TIMELINE, t - s.endStart);
  } else {
    if (s.moving) { pose = 'walk'; rigPhase = s.gaitPhase % 1; }
    if (t - s.pumpStart < PUMP_TIMELINE.total) {
      actions = sampleAnimationTimeline(PUMP_TIMELINE, t - s.pumpStart);
    }
  }
  const rig = buildRigFrame('neutral', pose, rigPhase, actions, 'armor', 'plain', [], 'slacks');
  const figureYaw = s.headingDeg + 180; // parts face -Z at yaw 0

  // nearest uncollected coin → HUD distance + the little compass cone
  let nearestDist = Infinity;
  let nearestBearing = 0;
  for (let i = 0; i < world.coins.length; i++) {
    if (s.collected[i]) continue;
    const w = quatRotate(s.q, world.coins[i]);
    const d = Math.acos(Math.max(-1, Math.min(1, w[1]))) * PLANET_R;
    if (d < nearestDist) { nearestDist = d; nearestBearing = Math.atan2(w[0], w[2]) * DEG; }
  }
  const hasTarget = Number.isFinite(nearestDist);

  const moonAng = t * 0.07;
  const moonPos: V3 = [Math.cos(moonAng) * 26, 7 + Math.sin(moonAng * 0.7) * 3, Math.sin(moonAng) * 26];

  const timeColor = s.timeLeft > 20 ? INK : s.timeLeft > 10 ? GOLD : BAD;
  const headTexKey = world.parts.head.texKey;
  const skinTexKey = world.parts.torso.texKey;

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: BG, position: 'relative' }}>
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={BG}>
        <FollowCamera target={[0, s.hopY * 0.5, 0]} heading={s.headingDeg} distance={5.8} height={2.9} lookHeight={1.1} fov={55} />
        <Scene3D.Fog enabled={false} />
        <Scene3D.Skybox
          zenith="#03040a" horizon="#0d1830" ground="#03040a"
          sunDir={[0.5, 0.25, 0.4]} sunColor="#cfe2ff" sunSize={0.004} sunGlow={0.1}
          haze={0.05} cloud={0} night={1}
        />
        <Scene3D.AmbientLight color="#5e6f93" intensity={0.55} />
        <Scene3D.DirectionalLight direction={[0.45, 0.85, 0.3]} color="#fff2d8" intensity={0.95} />
        <Scene3D.PointLight position={[0, 2.2, 0]} color="#ffd9a0" intensity={0.5} />

        {/* the planet — one textured Globe rolling via the quaternion */}
        <Scene3D.Mesh
          geometry={Geometry.Globe}
          params={PLANET_PARAMS}
          material="#ffffff"
          textureKey={PLANET_TEX_KEY}
          position={[0, -PLANET_R, 0]}
          rotation={planetEuler}
        />

        {/* surface props pinned to the planet frame — the rolling cue */}
        {world.trees.map((tr, i) => {
          const w = quatRotate(s.q, tr.dir);
          const rot = alignRotation(w);
          const trunkR = PLANET_R + 0.36 * tr.size;
          const canopyR = PLANET_R + (0.72 + 0.5) * tr.size;
          {/* Fragment, not a Box: the 3D pass reads meshes off the scene's
              DIRECT children — a wrapper View would hide both meshes. */}
          return (
            <Fragment key={`tree${i}`}>
              <Scene3D.Mesh geometry={Geometry.Cylinder} params={TRUNK_PARAMS} material="#6b4a2e"
                position={[w[0] * trunkR, w[1] * trunkR - PLANET_R, w[2] * trunkR]} rotation={rot} scale={tr.size} />
              <Scene3D.Mesh geometry={Geometry.Cone} params={CANOPY_PARAMS} material={tr.tone}
                position={[w[0] * canopyR, w[1] * canopyR - PLANET_R, w[2] * canopyR]} rotation={rot} scale={tr.size} />
            </Fragment>
          );
        })}
        {world.rocks.map((rk, i) => {
          const w = quatRotate(s.q, rk.dir);
          const r = PLANET_R + 0.1 * rk.size;
          return (
            <Scene3D.Mesh key={`rock${i}`} geometry={Geometry.Sphere} params={ROCK_PARAMS} material={rk.tone}
              position={[w[0] * r, w[1] * r - PLANET_R, w[2] * r]} rotation={alignRotation(w)}
              scale={[rk.size, rk.size * 0.6, rk.size * 0.8]} />
          );
        })}
        {world.tufts.map((tf, i) => {
          const w = quatRotate(s.q, tf.dir);
          const r = PLANET_R + 0.12 * tf.size;
          return (
            <Scene3D.Mesh key={`tuft${i}`} geometry={Geometry.Cone} params={TUFT_PARAMS} material={tf.tone}
              position={[w[0] * r, w[1] * r - PLANET_R, w[2] * r]} rotation={alignRotation(w)} scale={tf.size} />
          );
        })}

        {/* coins — upright discs spinning on their surface normal, bobbing */}
        {world.coins.map((dir, i) => {
          if (s.collected[i]) return null;
          const w = quatRotate(s.q, dir);
          const hover = PLANET_R + 0.5 + Math.sin(t * 2.6 + i * 1.7) * 0.08;
          return (
            <Scene3D.Mesh
              key={`coin${i}`}
              geometry={Geometry.Cylinder}
              params={COIN_PARAMS}
              material={GOLD}
              position={[w[0] * hover, w[1] * hover - PLANET_R, w[2] * hover]}
              rotation={coinRotation(w, t * 170 + i * 36)}
            />
          );
        })}

        {/* moon, for scale and loneliness */}
        <Scene3D.Mesh geometry={Geometry.Sphere} params={MOON_PARAMS} material="#b9c2d4" position={moonPos} rotation={[0, t * 8, 0]} />

        {/* contact shadow under the figure */}
        <Scene3D.Mesh geometry={Geometry.Cylinder} params={SHADOW_PARAMS} material={{ color: '#000000', opacity: 0.32 }} position={[0, 0.02, 0]} />

        {/* the player — head_lab's whole rig, walking in place at the pole */}
        <Figure rig={rig} yawDeg={figureYaw} hopY={s.hopY} parts={world.parts} />

        {/* coin compass — a little golden cone orbiting the player's head,
            pointing along the surface bearing of the nearest coin */}
        {phase === 'playing' && hasTarget ? (
          <Scene3D.Mesh
            geometry={Geometry.Cone}
            params={COMPASS_PARAMS}
            material={GOLD}
            position={[Math.sin(nearestBearing * RAD) * 0.85, 2.5 + s.hopY + Math.sin(t * 3) * 0.06, Math.cos(nearestBearing * RAD) * 0.85]}
            rotation={[90, nearestBearing, 0]}
          />
        ) : null}
      </Scene3D>

      {/* ── HUD ── */}
      <Row style={{ position: 'absolute', left: 0, right: 0, top: 14, paddingLeft: 18, paddingRight: 18, alignItems: 'center', justifyContent: 'space-between' }}>
        <Box style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 7, paddingBottom: 7, borderRadius: 8, borderWidth: 1, borderColor: '#22324a', backgroundColor: '#020617cc' }}>
          <Text fontSize={15} color={GOLD} style={{ fontWeight: 900 }}>{`COINS ${s.collectedCount}/${world.coins.length}`}</Text>
        </Box>
        <Box style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 7, paddingBottom: 7, borderRadius: 8, borderWidth: 1, borderColor: '#22324a', backgroundColor: '#020617cc' }}>
          <Text fontSize={20} color={timeColor} style={{ fontWeight: 900 }}>{`${Math.ceil(s.timeLeft)}s`}</Text>
        </Box>
        <Box style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 7, paddingBottom: 7, borderRadius: 8, borderWidth: 1, borderColor: '#22324a', backgroundColor: '#020617cc' }}>
          <Text fontSize={12} color={hasTarget ? INK : DIM}>
            {hasTarget ? `nearest coin ${nearestDist.toFixed(1)}m` : 'all coins collected'}
          </Text>
        </Box>
      </Row>
      <Box style={{ position: 'absolute', left: 18, bottom: 14 }}>
        <Text fontSize={11} color={DIM}>W/S walk · A/D turn · SHIFT run · SPACE hop · R new planet</Text>
      </Box>

      {/* phase overlays — root's last children so they hit-test on top */}
      {phase !== 'playing' ? (
        <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#02061788' }}>
          <Col style={{ alignItems: 'center', gap: 14, paddingLeft: 34, paddingRight: 34, paddingTop: 26, paddingBottom: 26, borderRadius: 14, borderWidth: 1, borderColor: '#22324a', backgroundColor: '#060b18ee' }}>
            {phase === 'ready' ? (
              <>
                <Text fontSize={30} color={INK} style={{ fontWeight: 900 }}>PLANET RUN</Text>
                <Text fontSize={13} color={DIM}>the planet rolls under your feet — grab every coin before time runs out</Text>
                <Text fontSize={12} color={DIM}>W/S walk · A/D turn · SHIFT run · SPACE hop</Text>
              </>
            ) : phase === 'won' ? (
              <>
                <Text fontSize={30} color={GOOD} style={{ fontWeight: 900 }}>PLANET CLEARED</Text>
                <Text fontSize={14} color={INK}>{`all ${world.coins.length} coins with ${Math.ceil(s.timeLeft)}s to spare`}</Text>
              </>
            ) : (
              <>
                <Text fontSize={30} color={BAD} style={{ fontWeight: 900 }}>TIME UP</Text>
                <Text fontSize={14} color={INK}>{`${s.collectedCount} of ${world.coins.length} coins — the planet keeps the rest`}</Text>
              </>
            )}
            <Pressable
              onPress={() => beginRoundRef.current(phase === 'ready' ? undefined : Date.now() & 0x7fffffff)}
              style={{ paddingLeft: 26, paddingRight: 26, paddingTop: 10, paddingBottom: 10, borderRadius: 8, borderWidth: 1, borderColor: GOOD, backgroundColor: '#0c2a1e' }}
            >
              <Text fontSize={15} color={GOOD} style={{ fontWeight: 800 }}>{phase === 'ready' ? 'START (enter)' : 'NEW PLANET (enter)'}</Text>
            </Pressable>
          </Col>
        </Box>
      ) : null}

      {/* offscreen texture bakes: the planet surface + the character's face/skin */}
      <PlanetSurfaceCapture />
      <CharacterCaptures headTexKey={headTexKey} skinTexKey={skinTexKey} skin={world.doc.skin} layers={world.doc.layers} />
    </Box>
  );
}
