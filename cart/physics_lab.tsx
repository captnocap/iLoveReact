// physics_lab - world physics layer probe over the 3D lab stack.
//
// Ship: ./scripts/ship physics_lab

import { useEffect, useRef, useState } from 'react';
import { Box, Row, Col, Text, Pressable, Scene3D } from '@reactjit/primitives';
import { busOn } from '@reactjit/hooks/useIFTTT';
import * as Geometry from '@reactjit/geometries';
import { mesh, normalize, type GeometryData, type Vec3 as GeoVec3 } from '@reactjit/geometries';

type Vec3 = [number, number, number];
type Backend = 'js' | 'host';

type Ball = {
  id: string;
  itemIndex: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  wx: number;
  wy: number;
  wz: number;
  r: number;
  m: number;
  cog: Vec3;
  color: string;
};

type Player = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  onGround: boolean;
  moving: boolean;
  jumpHold: number;
  jumpWasDown: boolean;
};

type Block = {
  id: string;
  x: number;
  z: number;
  hx: number;
  hz: number;
  h: number;
  color: string;
};

const PAGE = '#070a10';
const BAR = '#111724';
const FRAME = '#263245';
const INK = '#eaf1f8';
const DIM = '#94a3b8';
const ACCENT = '#ffbe55';
const CYAN = '#5ad7e8';
const FLOOR = '#1d2737';
const GRID = '#344156';
const WORLD_HALF = 6.2;
const GRAVITY = 13.5;
const BALL_RESTITUTION = 0.82;
const WALL_RESTITUTION = 0.74;
const PLAYER_RADIUS = 0.36;
const PLAYER_HEIGHT = 1.65;
const PLAYER_SPEED = 3.1;
const PLAYER_RUN_SPEED = 5.2;
const JUMP_SPEED = 5.65;
const JUMP_HOLD_ACCEL = 19.5;
const JUMP_HOLD_SECONDS = 0.18;
const MAX_DT = 0.05;

const SCAN_A = 4;
const SCAN_D = 7;
const SCAN_S = 22;
const SCAN_W = 26;
const SCAN_SPACE = 44;
const SCAN_LSHIFT = 225;

type ModelCtx = { origin: Vec3; rotation: Vec3; scale: number; active: boolean };
type ItemModel = (ctx: ModelCtx) => any;
type PhysicsItem = {
  id: string;
  label: string;
  tone: string;
  radius: number;
  mass: number;
  cog: Vec3;
  model: ItemModel;
};

const blocks: Block[] = [
  { id: 'bank-left', x: -2.75, z: -0.75, hx: 0.72, hz: 1.15, h: 0.62, color: '#41506a' },
  { id: 'bank-right', x: 2.55, z: 0.85, hx: 0.9, hz: 0.75, h: 0.9, color: '#3a5564' },
  { id: 'low-step', x: 0, z: 2.95, hx: 1.45, hz: 0.28, h: 0.36, color: '#5c4935' },
];

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const rad = (deg: number) => deg * Math.PI / 180;
const deg = (r: number) => r * 180 / Math.PI;
const len3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);
const PI = Math.PI;

function def<P>(id: string, defaults: P, generate: (params: P) => GeometryData) {
  return { id, defaults, generate };
}

function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function nrm(a: Vec3, b: Vec3, c: Vec3): GeoVec3 {
  const n = cross(sub(b, a), sub(c, a));
  return normalize(n[0], n[1], n[2]);
}
function tri(g: ReturnType<typeof mesh>, a: Vec3, b: Vec3, c: Vec3): void {
  const n = nrm(a, b, c);
  g.tri(a, n, [0, 0], b, n, [1, 0], c, n, [0.5, 1]);
}
function quad(g: ReturnType<typeof mesh>, a: Vec3, b: Vec3, c: Vec3, d: Vec3): void {
  const n = nrm(a, b, c);
  g.tri(a, n, [0, 0], b, n, [1, 0], c, n, [1, 1]);
  g.tri(a, n, [0, 0], c, n, [1, 1], d, n, [0, 1]);
}

const Blade = def('physics-lab/blade-v1', { length: 1, width: 0.22, thickness: 0.04 }, (p) => {
  const g = mesh();
  const z = p.thickness * 0.5;
  const b = -p.length * 0.45;
  const t = p.length * 0.58;
  const w = p.width * 0.5;
  const a: Vec3 = [b, -w, z], c: Vec3 = [b, w, z], tip: Vec3 = [t, 0, z];
  const ab: Vec3 = [b, -w, -z], cb: Vec3 = [b, w, -z], tipb: Vec3 = [t, 0, -z];
  tri(g, a, tip, c);
  tri(g, cb, tipb, ab);
  quad(g, a, ab, tipb, tip);
  quad(g, tip, tipb, cb, c);
  quad(g, c, cb, ab, a);
  return g.build();
});

const Sail = def('physics-lab/sail-v1', { width: 0.85, height: 1.25, thickness: 0.02 }, (p) => {
  const g = mesh();
  const z = p.thickness * 0.5;
  const a: Vec3 = [-p.width * 0.15, 0, z];
  const b: Vec3 = [p.width * 0.72, 0.1, z];
  const c: Vec3 = [-p.width * 0.12, p.height, z];
  const ar: Vec3 = [a[0], a[1], -z], br: Vec3 = [b[0], b[1], -z], cr: Vec3 = [c[0], c[1], -z];
  tri(g, a, b, c);
  tri(g, cr, br, ar);
  quad(g, a, ar, br, b);
  quad(g, b, br, cr, c);
  quad(g, c, cr, ar, a);
  return g.build();
});

const BoatHull = def('physics-lab/boat-hull-v1', { length: 1.4, width: 0.62, height: 0.36 }, (p) => {
  const g = mesh();
  const lx = p.length * 0.5;
  const wz = p.width * 0.5;
  const topA: Vec3 = [-lx, 0, -wz], topB: Vec3 = [lx, 0, -wz], topC: Vec3 = [lx, 0, wz], topD: Vec3 = [-lx, 0, wz];
  const keelA: Vec3 = [-lx * 0.74, -p.height, 0], keelB: Vec3 = [lx * 0.74, -p.height, 0];
  quad(g, topD, topC, topB, topA);
  tri(g, topA, topB, keelB);
  tri(g, topA, keelB, keelA);
  tri(g, topC, topD, keelA);
  tri(g, topC, keelA, keelB);
  tri(g, topB, topC, keelB);
  tri(g, topD, topA, keelA);
  return g.build();
});

const Surfboard = def('physics-lab/surfboard-v1', { length: 1.55, width: 0.42, thickness: 0.07, segments: 24 }, (p) => {
  const g = mesh();
  const top = p.thickness * 0.5;
  const bottom = -top;
  const pts: Vec3[] = [];
  for (let i = 0; i < p.segments; i++) {
    const a = (i / p.segments) * PI * 2;
    pts.push([Math.cos(a) * p.length * 0.5, 0, Math.sin(a) * p.width * 0.5]);
  }
  const ct: Vec3 = [0, top, 0], cb: Vec3 = [0, bottom, 0];
  for (let i = 0; i < p.segments; i++) {
    const j = (i + 1) % p.segments;
    const ti: Vec3 = [pts[i][0], top, pts[i][2]];
    const tj: Vec3 = [pts[j][0], top, pts[j][2]];
    const bi: Vec3 = [pts[i][0], bottom, pts[i][2]];
    const bj: Vec3 = [pts[j][0], bottom, pts[j][2]];
    tri(g, ct, tj, ti);
    tri(g, cb, bi, bj);
    quad(g, ti, tj, bj, bi);
  }
  return g.build();
});

function rotateEuler(p: Vec3, r: Vec3): Vec3 {
  let [x, y, z] = p;
  const cx = Math.cos(r[0]), sx = Math.sin(r[0]);
  const cy = Math.cos(r[1]), sy = Math.sin(r[1]);
  const cz = Math.cos(r[2]), sz = Math.sin(r[2]);
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  [x, y] = [x * cz - y * sz, x * sz + y * cz];
  return [x, y, z];
}

function local(ctx: ModelCtx, p: Vec3): Vec3 {
  const q = rotateEuler([p[0] * ctx.scale, p[1] * ctx.scale, p[2] * ctx.scale], ctx.rotation);
  return [ctx.origin[0] + q[0], ctx.origin[1] + q[1], ctx.origin[2] + q[2]];
}
function scl(ctx: ModelCtx, s: Vec3 | number): Vec3 {
  if (typeof s === 'number') return [s * ctx.scale, s * ctx.scale, s * ctx.scale];
  return [s[0] * ctx.scale, s[1] * ctx.scale, s[2] * ctx.scale];
}
function rot(ctx: ModelCtx, r: Vec3 = [0, 0, 0]): Vec3 {
  return [ctx.rotation[0] + r[0], ctx.rotation[1] + r[1], ctx.rotation[2] + r[2]];
}
function Part({ ctx, geometry, params, material, p = [0, 0, 0], r = [0, 0, 0], s = 1 }: {
  ctx: ModelCtx;
  geometry: any;
  params?: any;
  material: string;
  p?: Vec3;
  r?: Vec3;
  s?: Vec3 | number;
}) {
  return <Scene3D.Mesh geometry={geometry} params={params} material={material} position={local(ctx, p)} rotation={rot(ctx, r)} scale={scl(ctx, s)} />;
}

const box = Geometry.Box;
const cyl = Geometry.Cylinder;
const cone = Geometry.Cone;
const sphere = Geometry.Sphere;
const torus = Geometry.Torus;
const box1 = { width: 1, height: 1, depth: 1 };
const cyl12 = { radius: 0.5, height: 1, segments: 12 };
const cyl18 = { radius: 0.5, height: 1, segments: 18 };
const cone12 = { radius: 0.5, height: 1, segments: 12 };
const sphere12 = { radius: 0.5, segments: 16, rings: 10 };

function Knife(ctx: ModelCtx) {
  return <>
    <Part ctx={ctx} geometry={Blade} params={{ length: 1.1, width: 0.28, thickness: 0.055 }} material="#cbd5df" p={[0.15, 0.18, 0]} r={[0, 0, -0.18]} />
    <Part ctx={ctx} geometry={box} params={box1} material="#3a261b" p={[-0.47, 0.14, 0]} r={[0, 0, -0.18]} s={[0.5, 0.16, 0.16]} />
  </>;
}
function Pistol(ctx: ModelCtx) {
  return <>
    <Part ctx={ctx} geometry={box} params={box1} material="#20242d" p={[0, 0.42, 0]} s={[0.9, 0.23, 0.2]} />
    <Part ctx={ctx} geometry={box} params={box1} material="#2e333c" p={[-0.25, 0.2, 0]} r={[0, 0, -0.45]} s={[0.22, 0.56, 0.2]} />
  </>;
}
function Pitchfork(ctx: ModelCtx) {
  return <>
    <Part ctx={ctx} geometry={cyl} params={cyl12} material="#725238" p={[0, 0.45, 0]} r={[0, 0, 0.1]} s={[0.055, 1.35, 0.055]} />
    <Part ctx={ctx} geometry={box} params={box1} material="#3f4650" p={[0, 1.16, 0]} s={[0.68, 0.08, 0.08]} />
    {[-0.24, -0.08, 0.08, 0.24].map((x, i) => <Part key={i} ctx={ctx} geometry={cone} params={cone12} material="#aeb8c2" p={[x, 1.5, 0]} s={[0.055, 0.7, 0.055]} />)}
  </>;
}
function Bat(ctx: ModelCtx) {
  return <>
    <Part ctx={ctx} geometry={cyl} params={cyl18} material="#b77a42" p={[0, 0.62, 0]} r={[0, 0, -0.34]} s={[0.16, 1.6, 0.16]} />
    <Part ctx={ctx} geometry={cyl} params={cyl18} material="#6a3f22" p={[-0.25, -0.02, 0]} r={[0, 0, -0.34]} s={[0.09, 0.5, 0.09]} />
  </>;
}
function Cash(ctx: ModelCtx) {
  return <>
    <Part ctx={ctx} geometry={box} params={box1} material="#5fb86b" p={[0, 0.13, 0]} s={[1.0, 0.16, 0.5]} />
    <Part ctx={ctx} geometry={box} params={box1} material="#d8f2bd" p={[0.03, 0.23, -0.02]} r={[0, 0.08, 0]} s={[0.96, 0.04, 0.48]} />
  </>;
}
function Vehicle(ctx: ModelCtx) {
  return <>
    <Part ctx={ctx} geometry={box} params={box1} material="#c34c42" p={[0, 0.34, 0]} s={[1.25, 0.36, 0.66]} />
    <Part ctx={ctx} geometry={box} params={box1} material="#f08a6b" p={[-0.12, 0.64, 0]} s={[0.62, 0.34, 0.54]} />
    {[[-0.52, 0.08, 0.37], [0.52, 0.08, 0.37]].map((p, i) => <Part key={i} ctx={ctx} geometry={cyl} params={cyl18} material="#111111" p={p as Vec3} r={[PI / 2, 0, 0]} s={[0.23, 0.16, 0.23]} />)}
  </>;
}
function SailBoat(ctx: ModelCtx) {
  return <>
    <Part ctx={ctx} geometry={BoatHull} params={{ length: 1.35, width: 0.62, height: 0.32 }} material="#865236" p={[0, 0.24, 0]} />
    <Part ctx={ctx} geometry={cyl} params={cyl12} material="#6b4a2d" p={[0.02, 0.82, 0]} s={[0.04, 1.15, 0.04]} />
    <Part ctx={ctx} geometry={Sail} params={{ width: 0.78, height: 1.08, thickness: 0.025 }} material="#f3ead4" p={[0.15, 0.52, 0.02]} />
  </>;
}
function Surf(ctx: ModelCtx) {
  return <>
    <Part ctx={ctx} geometry={Surfboard} params={{ length: 1.6, width: 0.44, thickness: 0.075, segments: 24 }} material="#f3e36f" p={[0, 0.25, 0]} r={[0, 0, 0.18]} />
    <Part ctx={ctx} geometry={box} params={box1} material="#3c8fd2" p={[0, 0.305, 0]} r={[0, 0, 0.18]} s={[1.05, 0.018, 0.055]} />
  </>;
}
function Football(ctx: ModelCtx) {
  return <Scene3D.Mesh geometry={sphere} params={sphere12} material="#9f542b" position={local(ctx, [0, 0.42, 0])} rotation={rot(ctx)} scale={scl(ctx, [0.82, 0.46, 0.46])} />;
}
function Basketball(ctx: ModelCtx) {
  return <Scene3D.Mesh geometry={sphere} params={{ radius: 0.5, segments: 24, rings: 14 }} material="#da7627" position={local(ctx, [0, 0.48, 0])} rotation={rot(ctx)} scale={scl(ctx, [0.75, 0.75, 0.75])} />;
}
function PillBottle(ctx: ModelCtx) {
  return <>
    <Part ctx={ctx} geometry={cyl} params={cyl18} material="#d98238" p={[0, 0.42, 0]} s={[0.32, 0.72, 0.32]} />
    <Part ctx={ctx} geometry={cyl} params={cyl18} material="#f7f1df" p={[0, 0.84, 0]} s={[0.34, 0.14, 0.34]} />
  </>;
}
function BeerBottle(ctx: ModelCtx) {
  return <>
    <Part ctx={ctx} geometry={cyl} params={cyl18} material="#24472f" p={[0, 0.42, 0]} s={[0.22, 0.62, 0.22]} />
    <Part ctx={ctx} geometry={cyl} params={cyl18} material="#24472f" p={[0, 0.88, 0]} s={[0.11, 0.42, 0.11]} />
    <Part ctx={ctx} geometry={cyl} params={cyl18} material="#d7b46a" p={[0, 1.11, 0]} s={[0.13, 0.05, 0.13]} />
  </>;
}
function LiquorBottle(ctx: ModelCtx) {
  return <>
    <Part ctx={ctx} geometry={box} params={box1} material="#7b58ad" p={[0, 0.46, 0]} s={[0.42, 0.7, 0.28]} />
    <Part ctx={ctx} geometry={cyl} params={cyl18} material="#3b2763" p={[0, 0.96, 0]} s={[0.12, 0.38, 0.12]} />
  </>;
}
function Pills(ctx: ModelCtx) {
  return <>
    {[{ p: [-0.34, 0.18, -0.12], c: '#f7f4e8', r: 0.2 }, { p: [0.04, 0.19, 0.05], c: '#e65353', r: -0.4 }, { p: [0.36, 0.17, -0.03], c: '#70a8f0', r: 0.7 }].map((d, i) => (
      <Part key={i} ctx={ctx} geometry={cyl} params={cyl18} material={d.c} p={d.p as Vec3} r={[PI / 2, 0, d.r]} s={[0.13, 0.38, 0.13]} />
    ))}
  </>;
}
function Weed(ctx: ModelCtx) {
  return <>
    {[[-0.18, 0.3, 0.02], [0.02, 0.36, -0.02], [0.22, 0.28, 0.04], [-0.02, 0.18, 0.14]].map((p, i) => (
      <Part key={i} ctx={ctx} geometry={sphere} params={sphere12} material={['#2f7d37', '#3f9a43', '#2d7135', '#5fb858'][i]} p={p as Vec3} s={[0.24, 0.22, 0.2]} />
    ))}
  </>;
}
function Cigarettes(ctx: ModelCtx) {
  return <>
    <Part ctx={ctx} geometry={box} params={box1} material="#d9362e" p={[-0.28, 0.33, 0]} s={[0.42, 0.62, 0.18]} />
    {[-0.42, -0.28, -0.14].map((x, i) => <Part key={i} ctx={ctx} geometry={cyl} params={cyl12} material="#f4f0df" p={[x, 0.82 + i * 0.03, 0.02]} s={[0.045, 0.42, 0.045]} />)}
  </>;
}
function Backpack(ctx: ModelCtx) {
  return <>
    <Part ctx={ctx} geometry={box} params={box1} material="#315c8f" p={[0, 0.55, 0]} s={[0.62, 0.82, 0.34]} />
    <Part ctx={ctx} geometry={box} params={box1} material="#244a78" p={[0, 0.72, 0.22]} s={[0.52, 0.18, 0.15]} />
    <Part ctx={ctx} geometry={torus} params={{ radius: 0.45, tube: 0.035, segments: 18, sides: 8 }} material="#1e3352" p={[-0.2, 0.48, -0.22]} r={[0, PI / 2, 0]} s={[0.48, 0.8, 0.48]} />
  </>;
}
function MedKit(ctx: ModelCtx) {
  return <>
    <Part ctx={ctx} geometry={box} params={box1} material="#f1f4f4" p={[0, 0.38, 0]} s={[0.82, 0.52, 0.32]} />
    <Part ctx={ctx} geometry={cyl} params={cyl12} material="#c8ccd0" p={[0, 0.71, 0]} r={[0, 0, PI / 2]} s={[0.055, 0.44, 0.055]} />
  </>;
}
function Tv(ctx: ModelCtx) {
  return <>
    <Part ctx={ctx} geometry={box} params={box1} material="#242a34" p={[0, 0.55, 0]} s={[1.15, 0.78, 0.32]} />
    <Part ctx={ctx} geometry={box} params={box1} material="#8cc8ff" p={[-0.13, 0.58, 0.174]} s={[0.68, 0.42, 0.018]} />
    <Part ctx={ctx} geometry={box} params={box1} material="#151922" p={[-0.34, 0.1, 0]} s={[0.16, 0.2, 0.18]} />
    <Part ctx={ctx} geometry={box} params={box1} material="#151922" p={[0.34, 0.1, 0]} s={[0.16, 0.2, 0.18]} />
  </>;
}

const ITEM_CATALOG: PhysicsItem[] = [
  { id: 'knife', label: 'Knife', tone: '#cbd5df', radius: 0.62, mass: 0.42, cog: [-0.18, 0.08, 0.02], model: Knife },
  { id: 'pistol', label: 'Pistol', tone: '#9aa4b2', radius: 0.66, mass: 0.88, cog: [-0.18, 0.2, 0.01], model: Pistol },
  { id: 'pitchfork', label: 'Pitchfork', tone: '#aeb8c2', radius: 0.86, mass: 0.58, cog: [0, 0.43, 0.02], model: Pitchfork },
  { id: 'bat', label: 'Bat', tone: '#d09a5d', radius: 0.75, mass: 0.64, cog: [0.08, 0.31, 0], model: Bat },
  { id: 'cash', label: 'Cash', tone: '#7ac77d', radius: 0.56, mass: 0.24, cog: [0.12, 0.05, -0.04], model: Cash },
  { id: 'vehicle', label: 'Vehicle', tone: '#f08a6b', radius: 0.78, mass: 1.25, cog: [-0.1, 0.2, 0.07], model: Vehicle },
  { id: 'sailboat', label: 'Sail boat', tone: '#f3ead4', radius: 0.82, mass: 0.48, cog: [0.02, 0.62, 0.02], model: SailBoat },
  { id: 'surfboard', label: 'Surfboard', tone: '#f3e36f', radius: 0.66, mass: 0.34, cog: [-0.16, 0.04, 0.03], model: Surf },
  { id: 'football', label: 'Football', tone: '#c9793c', radius: 0.45, mass: 0.45, cog: [0.08, 0, 0], model: Football },
  { id: 'basketball', label: 'Basketball', tone: '#da7627', radius: 0.46, mass: 0.42, cog: [0, 0, 0], model: Basketball },
  { id: 'pillbottle', label: 'Pill bottle', tone: '#d98238', radius: 0.5, mass: 0.4, cog: [0.02, 0.28, -0.02], model: PillBottle },
  { id: 'beer', label: 'Beer bottle', tone: '#2f593a', radius: 0.55, mass: 0.75, cog: [0, 0.36, 0.03], model: BeerBottle },
  { id: 'liquor', label: 'Liquor bottle', tone: '#7b58ad', radius: 0.58, mass: 0.95, cog: [0.04, 0.31, 0.02], model: LiquorBottle },
  { id: 'pills', label: 'Pills', tone: '#e65353', radius: 0.42, mass: 0.16, cog: [-0.06, 0.02, 0.05], model: Pills },
  { id: 'weed', label: 'Weed', tone: '#5fc25b', radius: 0.42, mass: 0.18, cog: [0.03, 0.08, -0.05], model: Weed },
  { id: 'cigarettes', label: 'Cigarettes', tone: '#d73e36', radius: 0.58, mass: 0.26, cog: [-0.16, 0.22, 0], model: Cigarettes },
  { id: 'backpack', label: 'Backpack', tone: '#315c8f', radius: 0.64, mass: 0.82, cog: [0.01, 0.34, -0.14], model: Backpack },
  { id: 'medkit', label: 'Med kit', tone: '#f1f4f4', radius: 0.58, mass: 0.92, cog: [0, 0.2, 0.02], model: MedKit },
  { id: 'tv', label: 'TV', tone: '#8cc8ff', radius: 0.76, mass: 1.55, cog: [-0.04, 0.32, 0.08], model: Tv },
];


function hostNumber(name: string, fallback: number, ...args: unknown[]) {
  const fn = (globalThis as any)[name];
  if (typeof fn !== 'function') return fallback;
  const v = Number(fn(...args));
  return Number.isFinite(v) ? v : fallback;
}

function hostString(name: string, fallback: string, ...args: unknown[]) {
  const fn = (globalThis as any)[name];
  if (typeof fn !== 'function') return fallback;
  const v = fn(...args);
  return typeof v === 'string' ? v : fallback;
}

function hostValue<T>(name: string, fallback: T, ...args: unknown[]) {
  const fn = (globalThis as any)[name];
  if (typeof fn !== 'function') return fallback;
  const v = fn(...args);
  return v == null ? fallback : v as T;
}

function hostVoid(name: string, ...args: unknown[]) {
  const fn = (globalThis as any)[name];
  if (typeof fn === 'function') fn(...args);
}

function hasHostPhysics() {
  const host = globalThis as any;
  return typeof host.__physics_lab_step_buffer === 'function' || typeof host.__physics_lab_step === 'function';
}

function nowUs() {
  const hostNow = hostNumber('__bench_now_us', NaN);
  if (Number.isFinite(hostNow)) return hostNow;
  const perfNow = (globalThis as any).performance?.now?.();
  return (Number.isFinite(perfNow) ? perfNow : Date.now()) * 1000;
}

function makeBalls(): Ball[] {
  return [
    makeBody(0, -3.8, 3.2, -2.1, 2.7, 0.4, 1.15, 0),
    makeBody(5, -1.35, 2.15, 1.45, 1.2, 0.1, -2.45, 1),
    makeBody(8, 1.8, 3.7, -2.75, -2.2, -0.5, 1.75, 2),
    makeBody(11, 3.55, 1.85, 2.2, -1.8, 0.15, -1.5, 3),
    makeBody(17, 0.15, 4.9, -0.15, 1.65, -0.3, 0.8, 4),
  ];
}

function makePlayer(): Player {
  return {
    x: 0,
    y: 0,
    z: 0.55,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: Math.PI,
    onGround: true,
    moving: false,
    jumpHold: 0,
    jumpWasDown: false,
  };
}

function makeBody(itemIndex: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, seq: number): Ball {
  const item = ITEM_CATALOG[itemIndex % ITEM_CATALOG.length];
  return {
    id: `${item.id}-${seq}`,
    itemIndex: itemIndex % ITEM_CATALOG.length,
    x, y, z,
    vx, vy, vz,
    rx: (seq * 0.41) % (Math.PI * 2),
    ry: (seq * 0.67) % (Math.PI * 2),
    rz: (seq * 0.29) % (Math.PI * 2),
    wx: Math.sin(seq * 1.7) * 1.4,
    wy: Math.cos(seq * 1.3) * 1.2,
    wz: Math.sin(seq * 1.1) * 1.6,
    r: item.radius,
    m: item.mass,
    cog: item.cog,
    color: item.tone,
  };
}

function addBall(balls: Ball[], t: number) {
  const i = balls.length;
  balls.push(makeBody(
    i % ITEM_CATALOG.length,
    Math.sin(t * 1.7) * 3.8,
    4.2 + (i % 3) * 0.55,
    Math.cos(t * 1.3) * 3.2,
    Math.cos(t * 2.1) * 2.7,
    0.4,
    Math.sin(t * 1.9) * 2.7,
    i,
  ));
}

function applyHostSnapshot(s: {
  t: number;
  contacts: number;
  peakContacts: number;
  hostUs: number;
  hostTotalUs: number;
  hostBridgeUs: number;
  player: Player;
  balls: Ball[];
}, raw: string) {
  if (!raw) return false;
  let at = 0;
  const next = () => {
    while (at < raw.length && raw.charCodeAt(at) === 44) at++;
    let sign = 1;
    if (raw.charCodeAt(at) === 45) {
      sign = -1;
      at++;
    }
    let value = 0;
    let seen = false;
    while (at < raw.length) {
      const c = raw.charCodeAt(at);
      if (c < 48 || c > 57) break;
      value = value * 10 + c - 48;
      at++;
      seen = true;
    }
    if (raw.charCodeAt(at) === 46) {
      at++;
      let scale = 0.1;
      while (at < raw.length) {
        const c = raw.charCodeAt(at);
        if (c < 48 || c > 57) break;
        value += (c - 48) * scale;
        scale *= 0.1;
        at++;
        seen = true;
      }
    }
    while (at < raw.length && raw.charCodeAt(at) !== 44) at++;
    if (at < raw.length && raw.charCodeAt(at) === 44) at++;
    return seen ? value * sign : NaN;
  };

  const t = next();
  if (!Number.isFinite(t)) return false;
  s.t = t;
  s.contacts = next() || 0;
  s.peakContacts = next() || 0;
  s.player.x = next() || 0;
  s.player.y = next() || 0;
  s.player.z = next() || 0;
  s.player.vy = next() || 0;
  s.player.yaw = next() || 0;
  s.player.onGround = (next() || 0) > 0;
  s.player.moving = (next() || 0) > 0;
  const count = Math.max(0, Math.min(512, Math.floor(next() || 0)));
  s.hostUs = next() || 0;

  const balls = s.balls;
  if (balls.length > count) balls.length = count;
  for (let i = 0; i < count; i++) {
    const x = next() || 0;
    const y = next();
    const z = next() || 0;
    const r = next() || 0.3;
    const itemIndex = Math.max(0, Math.floor(next() || 0)) % ITEM_CATALOG.length;
    const item = ITEM_CATALOG[itemIndex];
    let ball = balls[i];
    if (!ball) {
      ball = makeBody(itemIndex, x, Number.isFinite(y) ? y : r, z, 0, 0, 0, i);
      ball.id = `host-${i}`;
      balls[i] = ball;
    }
    ball.itemIndex = itemIndex;
    ball.x = x;
    ball.y = Number.isFinite(y) ? y : r;
    ball.z = z;
    ball.vx = 0;
    ball.vy = 0;
    ball.vz = 0;
    ball.rx = next() || 0;
    ball.ry = next() || 0;
    ball.rz = next() || 0;
    const spin = next() || 0;
    ball.wx = spin;
    ball.wy = 0;
    ball.wz = 0;
    ball.r = r;
    ball.m = item.mass;
    ball.cog = item.cog;
    ball.color = item.tone;
  }
  return true;
}

function applyHostSnapshotBuffer(s: {
  t: number;
  contacts: number;
  peakContacts: number;
  hostUs: number;
  hostTotalUs: number;
  hostBridgeUs: number;
  player: Player;
  balls: Ball[];
}, p: Float32Array) {
  if (!p || p.length < 12) return false;
  const count = Math.max(0, Math.min(512, Math.floor(p[10] || 0)));
  if (p.length < 12 + count * 9) return false;

  s.t = p[0] || 0;
  s.contacts = p[1] || 0;
  s.peakContacts = p[2] || 0;
  s.player.x = p[3] || 0;
  s.player.y = p[4] || 0;
  s.player.z = p[5] || 0;
  s.player.vy = p[6] || 0;
  s.player.yaw = p[7] || 0;
  s.player.onGround = (p[8] || 0) > 0;
  s.player.moving = (p[9] || 0) > 0;
  s.hostUs = p[11] || 0;

  const balls = s.balls;
  if (balls.length > count) balls.length = count;
  let at = 12;
  for (let i = 0; i < count; i++) {
    const x = p[at++] || 0;
    const y = p[at++];
    const z = p[at++] || 0;
    const r = p[at++] || 0.3;
    const itemIndex = Math.max(0, Math.floor(p[at++] || 0)) % ITEM_CATALOG.length;
    const item = ITEM_CATALOG[itemIndex];
    let ball = balls[i];
    if (!ball) {
      ball = makeBody(itemIndex, x, Number.isFinite(y) ? y : r, z, 0, 0, 0, i);
      ball.id = `host-${i}`;
      balls[i] = ball;
    }
    ball.itemIndex = itemIndex;
    ball.x = x;
    ball.y = Number.isFinite(y) ? y : r;
    ball.z = z;
    ball.vx = 0;
    ball.vy = 0;
    ball.vz = 0;
    ball.rx = p[at++] || 0;
    ball.ry = p[at++] || 0;
    ball.rz = p[at++] || 0;
    const spin = p[at++] || 0;
    ball.wx = spin;
    ball.wy = 0;
    ball.wz = 0;
    ball.r = r;
    ball.m = item.mass;
    ball.cog = item.cog;
    ball.color = item.tone;
  }
  return true;
}

function inputDown(keys: Record<string, boolean>, key: string, scan: number) {
  return !!keys[key] || hostNumber('isKeyDown', 0, scan) > 0;
}

function kickSpin(body: Ball, nx: number, ny: number, nz: number, strength: number) {
  const c = rotateEuler(body.cog, [body.rx, body.ry, body.rz]);
  const tx = c[1] * nz - c[2] * ny;
  const ty = c[2] * nx - c[0] * nz;
  const tz = c[0] * ny - c[1] * nx;
  const inv = 1 / Math.max(0.16, body.m);
  body.wx += tx * strength * inv;
  body.wy += ty * strength * inv;
  body.wz += tz * strength * inv;
}

function collideCircleBlock(p: Player, block: Block) {
  const closestX = clamp(p.x, block.x - block.hx, block.x + block.hx);
  const closestZ = clamp(p.z, block.z - block.hz, block.z + block.hz);
  let dx = p.x - closestX;
  let dz = p.z - closestZ;
  let d = Math.hypot(dx, dz);
  if (d >= PLAYER_RADIUS || p.y > block.h + 0.02) return false;
  if (d < 0.0001) {
    const sideX = block.hx - Math.abs(p.x - block.x);
    const sideZ = block.hz - Math.abs(p.z - block.z);
    if (sideX < sideZ) {
      dx = p.x < block.x ? -1 : 1;
      dz = 0;
    } else {
      dx = 0;
      dz = p.z < block.z ? -1 : 1;
    }
    d = 1;
  }
  const nx = dx / d;
  const nz = dz / d;
  const push = PLAYER_RADIUS - d;
  p.x += nx * push;
  p.z += nz * push;
  const into = p.vx * nx + p.vz * nz;
  if (into < 0) {
    p.vx -= into * nx;
    p.vz -= into * nz;
  }
  return true;
}

function collideSphereBlock(ball: Ball, block: Block) {
  const minX = block.x - block.hx;
  const maxX = block.x + block.hx;
  const minY = 0;
  const maxY = block.h;
  const minZ = block.z - block.hz;
  const maxZ = block.z + block.hz;
  const cx = clamp(ball.x, minX, maxX);
  const cy = clamp(ball.y, minY, maxY);
  const cz = clamp(ball.z, minZ, maxZ);
  let dx = ball.x - cx;
  let dy = ball.y - cy;
  let dz = ball.z - cz;
  let d = len3(dx, dy, dz);
  if (d >= ball.r) return false;
  if (d < 0.0001) {
    const faces = [
      { d: Math.abs(ball.x - minX), n: [-1, 0, 0] as Vec3 },
      { d: Math.abs(maxX - ball.x), n: [1, 0, 0] as Vec3 },
      { d: Math.abs(maxY - ball.y), n: [0, 1, 0] as Vec3 },
      { d: Math.abs(ball.z - minZ), n: [0, 0, -1] as Vec3 },
      { d: Math.abs(maxZ - ball.z), n: [0, 0, 1] as Vec3 },
    ].sort((a, b) => a.d - b.d);
    dx = faces[0].n[0];
    dy = faces[0].n[1];
    dz = faces[0].n[2];
    d = 1;
  }
  const nx = dx / d;
  const ny = dy / d;
  const nz = dz / d;
  const push = ball.r - d;
  ball.x += nx * push;
  ball.y += ny * push;
  ball.z += nz * push;
  const vn = ball.vx * nx + ball.vy * ny + ball.vz * nz;
  if (vn < 0) {
    ball.vx -= (1 + WALL_RESTITUTION) * vn * nx;
    ball.vy -= (1 + WALL_RESTITUTION) * vn * ny;
    ball.vz -= (1 + WALL_RESTITUTION) * vn * nz;
    kickSpin(ball, nx, ny, nz, Math.min(18, Math.abs(vn) * 5.5));
  }
  return true;
}

function resolveBallPair(a: Ball, b: Ball) {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let dz = b.z - a.z;
  let d = len3(dx, dy, dz);
  const minD = a.r + b.r;
  if (d >= minD) return false;
  if (d < 0.0001) {
    dx = 1;
    dy = 0;
    dz = 0;
    d = 1;
  }
  const nx = dx / d;
  const ny = dy / d;
  const nz = dz / d;
  const invA = 1 / a.m;
  const invB = 1 / b.m;
  const push = (minD - d) / (invA + invB);
  a.x -= nx * push * invA;
  a.y -= ny * push * invA;
  a.z -= nz * push * invA;
  b.x += nx * push * invB;
  b.y += ny * push * invB;
  b.z += nz * push * invB;

  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const rvz = b.vz - a.vz;
  const velAlong = rvx * nx + rvy * ny + rvz * nz;
  if (velAlong > 0) return true;
  const j = -(1 + BALL_RESTITUTION) * velAlong / (invA + invB);
  a.vx -= j * invA * nx;
  a.vy -= j * invA * ny;
  a.vz -= j * invA * nz;
  b.vx += j * invB * nx;
  b.vy += j * invB * ny;
  b.vz += j * invB * nz;
  kickSpin(a, -nx, -ny, -nz, Math.min(16, Math.abs(j) * 2.5));
  kickSpin(b, nx, ny, nz, Math.min(16, Math.abs(j) * 2.5));
  return true;
}

function stepPhysics(
  player: Player,
  balls: Ball[],
  keys: Record<string, boolean>,
  cameraYaw: number,
  dt: number,
) {
  let contacts = 0;
  const shift = !!keys.__shift || hostNumber('isKeyDown', 0, SCAN_LSHIFT) > 0;
  const jumpDown = inputDown(keys, ' ', SCAN_SPACE) || inputDown(keys, 'space', SCAN_SPACE);
  const forwardX = -Math.sin(cameraYaw);
  const forwardZ = -Math.cos(cameraYaw);
  const rightX = Math.cos(cameraYaw);
  const rightZ = -Math.sin(cameraYaw);
  let ix = 0;
  let iz = 0;
  if (inputDown(keys, 'w', SCAN_W) || keys.arrowup) {
    ix += forwardX;
    iz += forwardZ;
  }
  if (inputDown(keys, 's', SCAN_S) || keys.arrowdown) {
    ix -= forwardX;
    iz -= forwardZ;
  }
  if (inputDown(keys, 'd', SCAN_D) || keys.arrowright) {
    ix += rightX;
    iz += rightZ;
  }
  if (inputDown(keys, 'a', SCAN_A) || keys.arrowleft) {
    ix -= rightX;
    iz -= rightZ;
  }

  const ilen = Math.hypot(ix, iz);
  const speed = shift ? PLAYER_RUN_SPEED : PLAYER_SPEED;
  player.moving = ilen > 0.001;
  if (player.moving) {
    ix /= ilen;
    iz /= ilen;
    player.vx += (ix * speed - player.vx) * Math.min(1, dt * 18);
    player.vz += (iz * speed - player.vz) * Math.min(1, dt * 18);
    player.yaw += Math.atan2(Math.sin(Math.atan2(-ix, -iz) - player.yaw), Math.cos(Math.atan2(-ix, -iz) - player.yaw)) * Math.min(1, dt * 14);
  } else {
    player.vx *= Math.pow(0.001, dt);
    player.vz *= Math.pow(0.001, dt);
  }

  if (jumpDown && !player.jumpWasDown && player.onGround) {
    player.vy = JUMP_SPEED;
    player.onGround = false;
    player.jumpHold = 0;
  }
  if (jumpDown && !player.onGround && player.vy > 0 && player.jumpHold < JUMP_HOLD_SECONDS) {
    player.vy += JUMP_HOLD_ACCEL * dt;
    player.jumpHold += dt;
  }
  player.jumpWasDown = jumpDown;

  player.vy -= GRAVITY * dt;
  player.x += player.vx * dt;
  player.y += player.vy * dt;
  player.z += player.vz * dt;

  if (player.y <= 0) {
    if (!player.onGround && player.vy < -1.2) contacts++;
    player.y = 0;
    player.vy = 0;
    player.onGround = true;
    player.jumpHold = 0;
  } else {
    player.onGround = false;
  }

  if (player.x < -WORLD_HALF + PLAYER_RADIUS) {
    player.x = -WORLD_HALF + PLAYER_RADIUS;
    player.vx = Math.max(0, player.vx);
    contacts++;
  }
  if (player.x > WORLD_HALF - PLAYER_RADIUS) {
    player.x = WORLD_HALF - PLAYER_RADIUS;
    player.vx = Math.min(0, player.vx);
    contacts++;
  }
  if (player.z < -WORLD_HALF + PLAYER_RADIUS) {
    player.z = -WORLD_HALF + PLAYER_RADIUS;
    player.vz = Math.max(0, player.vz);
    contacts++;
  }
  if (player.z > WORLD_HALF - PLAYER_RADIUS) {
    player.z = WORLD_HALF - PLAYER_RADIUS;
    player.vz = Math.min(0, player.vz);
    contacts++;
  }
  for (const block of blocks) {
    if (collideCircleBlock(player, block)) contacts++;
  }

  for (const ball of balls) {
    ball.vy -= GRAVITY * dt;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.z += ball.vz * dt;
    ball.rx += ball.wx * dt;
    ball.ry += ball.wy * dt;
    ball.rz += ball.wz * dt;
    const angularDrag = Math.pow(0.28, dt);
    ball.wx *= angularDrag;
    ball.wy *= angularDrag;
    ball.wz *= angularDrag;

    if (ball.y - ball.r < 0) {
      ball.y = ball.r;
      if (ball.vy < 0) {
        ball.vy = -ball.vy * BALL_RESTITUTION;
        ball.vx *= 0.985;
        ball.vz *= 0.985;
        kickSpin(ball, 0, 1, 0, Math.min(22, Math.abs(ball.vy) * 4 + Math.hypot(ball.vx, ball.vz) * 2));
        contacts++;
      }
    }
    if (ball.x - ball.r < -WORLD_HALF) {
      ball.x = -WORLD_HALF + ball.r;
      ball.vx = Math.abs(ball.vx) * WALL_RESTITUTION;
      kickSpin(ball, 1, 0, 0, Math.min(18, Math.abs(ball.vx) * 4));
      contacts++;
    }
    if (ball.x + ball.r > WORLD_HALF) {
      ball.x = WORLD_HALF - ball.r;
      ball.vx = -Math.abs(ball.vx) * WALL_RESTITUTION;
      kickSpin(ball, -1, 0, 0, Math.min(18, Math.abs(ball.vx) * 4));
      contacts++;
    }
    if (ball.z - ball.r < -WORLD_HALF) {
      ball.z = -WORLD_HALF + ball.r;
      ball.vz = Math.abs(ball.vz) * WALL_RESTITUTION;
      kickSpin(ball, 0, 0, 1, Math.min(18, Math.abs(ball.vz) * 4));
      contacts++;
    }
    if (ball.z + ball.r > WORLD_HALF) {
      ball.z = WORLD_HALF - ball.r;
      ball.vz = -Math.abs(ball.vz) * WALL_RESTITUTION;
      kickSpin(ball, 0, 0, -1, Math.min(18, Math.abs(ball.vz) * 4));
      contacts++;
    }
    for (const block of blocks) {
      if (collideSphereBlock(ball, block)) contacts++;
    }

    const verticalOverlap = ball.y > player.y + 0.12 && ball.y < player.y + PLAYER_HEIGHT;
    const dx = ball.x - player.x;
    const dz = ball.z - player.z;
    let d = Math.hypot(dx, dz);
    const minD = ball.r + PLAYER_RADIUS;
    if (verticalOverlap && d < minD) {
      let nx = 1;
      let nz = 0;
      if (d >= 0.0001) {
        nx = dx / d;
        nz = dz / d;
      } else {
        d = 0;
      }
      const push = minD - d;
      ball.x += nx * push * 0.7;
      ball.z += nz * push * 0.7;
      player.x -= nx * push * 0.3;
      player.z -= nz * push * 0.3;
      const hit = Math.max(0, player.vx * nx + player.vz * nz) + 1.2;
      ball.vx += nx * hit;
      ball.vz += nz * hit;
      kickSpin(ball, nx, 0, nz, hit * 6);
      contacts++;
    }
  }

  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      if (resolveBallPair(balls[i], balls[j])) contacts++;
    }
  }

  return contacts;
}

function PlayerRig({ player, t }: { player: Player; t: number }) {
  const bob = player.moving && player.onGround ? Math.abs(Math.sin(t * 10)) * 0.035 : 0;
  const y = player.y + bob;
  const yawDeg = deg(player.yaw);
  return (
    <>
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.42, height: 0.025 }} material="#000000" position={[player.x, 0.018, player.z]} scale={[1, 1, 0.72]} />
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.12, height: 0.72 }} material="#273149" position={[player.x - 0.16, y + 0.38, player.z]} />
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.12, height: 0.72 }} material="#273149" position={[player.x + 0.16, y + 0.38, player.z]} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 0.62, height: 0.72, depth: 0.34 }} material="#d94d86" position={[player.x, y + 1.03, player.z]} rotation={[0, yawDeg, 0]} />
      <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: 0.2 }} material="#c9a07c" position={[player.x, y + 1.56, player.z]} />
      <Scene3D.Mesh geometry={Geometry.Cone} params={{ radius: 0.07, height: 0.22 }} material={ACCENT} position={[player.x - Math.sin(player.yaw) * 0.24, y + 1.52, player.z - Math.cos(player.yaw) * 0.24]} rotation={[-90, yawDeg, 0]} />
    </>
  );
}

function BallMesh({ ball }: { ball: Ball }) {
  const item = ITEM_CATALOG[ball.itemIndex % ITEM_CATALOG.length] ?? ITEM_CATALOG[0];
  const rotation: Vec3 = [ball.rx, ball.ry, ball.rz];
  const cog = rotateEuler(ball.cog, rotation);
  const origin: Vec3 = [
    ball.x - cog[0] - 0.0,
    ball.y - cog[1] - ball.r * 0.72,
    ball.z - cog[2],
  ];
  const ctx: ModelCtx = { origin, rotation, scale: Math.max(0.38, ball.r * 1.12), active: true };
  return (
    <>
      <Scene3D.Mesh
        geometry={Geometry.Cylinder}
        params={{ radius: ball.r * 0.9, height: 0.018 }}
        material="#05070c"
        position={[ball.x, 0.026, ball.z]}
        scale={[1, 1, Math.max(0.45, 1 - ball.y * 0.08)]}
      />
      {item.model(ctx)}
      <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: 0.045 }} material={ACCENT} position={[ball.x, ball.y, ball.z]} />
    </>
  );
}

function Meter({ label, value }: { label: string; value: string }) {
  return (
    <Col style={{ gap: 2, minWidth: 82 }}>
      <Text style={{ color: DIM, fontSize: 10 }}>{label}</Text>
      <Text style={{ color: INK, fontSize: 13, fontWeight: 'bold' }}>{value}</Text>
    </Col>
  );
}

function Btn({ label, onPress, active = false }: { label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 12,
        paddingRight: 12,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: active ? ACCENT : FRAME,
        backgroundColor: active ? '#302313' : '#151d2b',
      }}
    >
      <Text style={{ color: active ? ACCENT : INK, fontSize: 12, fontWeight: active ? 'bold' : 'normal' }}>{label}</Text>
    </Pressable>
  );
}

export default function PhysicsLab() {
  const [frame, setFrame] = useState(0);
  const [paused, setPaused] = useState(false);
  const [backend, setBackend] = useState<Backend>(() => hasHostPhysics() ? 'host' : 'js');
  const [cam, setCam] = useState({ yaw: 38, pitch: 30 });
  const pausedRef = useRef(false);
  const backendRef = useRef<Backend>(backend);
  const camRef = useRef(cam);
  const keysRef = useRef<Record<string, boolean>>({});
  const drag = useRef<{ x: number; y: number } | null>(null);
  const sim = useRef({
    t: 0,
    contacts: 0,
    peakContacts: 0,
    jsUs: 0,
    hostUs: 0,
    hostTotalUs: 0,
    hostBridgeUs: 0,
    player: makePlayer(),
    balls: makeBalls(),
  });

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    backendRef.current = backend;
    if (backend === 'host') {
      hostVoid('__physics_lab_reset', sim.current.balls.length || 5);
    }
  }, [backend]);

  useEffect(() => {
    camRef.current = cam;
  }, [cam]);

  useEffect(() => {
    const setKey = (event: any, down: boolean) => {
      const key = String(event?.key ?? '').toLowerCase();
      if (key) keysRef.current[key] = down;
      if (typeof event?.shiftKey === 'boolean') keysRef.current.__shift = event.shiftKey;
    };
    const offDown = busOn('__keydown', (event: any) => setKey(event, true));
    const offUp = busOn('__keyup', (event: any) => setKey(event, false));
    const host: any = globalThis;
    const schedule = host.requestAnimationFrame ? host.requestAnimationFrame.bind(host) : (fn: any) => setTimeout(fn, 16);
    const cancel = host.cancelAnimationFrame ? host.cancelAnimationFrame.bind(host) : clearTimeout;
    let handle: any = 0;
    let last = host.performance?.now?.() ?? Date.now();

    const tick = () => {
      const now = host.performance?.now?.() ?? Date.now();
      const dt = Math.max(0.001, Math.min(MAX_DT, (now - last) / 1000));
      last = now;

      const s = sim.current;
      if (backendRef.current === 'host' && hasHostPhysics()) {
        const t0 = nowUs();
        const buffer = hostValue<any>('__physics_lab_step_buffer', null, rad(camRef.current.yaw), pausedRef.current);
        if (buffer && typeof buffer.byteLength === 'number') {
          applyHostSnapshotBuffer(s, new Float32Array(buffer));
        } else {
          const raw = hostString('__physics_lab_step', '', rad(camRef.current.yaw), pausedRef.current);
          applyHostSnapshot(s, raw);
        }
        s.hostTotalUs = Math.max(0, nowUs() - t0);
        s.hostBridgeUs = Math.max(0, s.hostTotalUs - s.hostUs);
      } else if (!pausedRef.current) {
        const t0 = nowUs();
        s.t += dt;
        let contacts = 0;
        const steps = 3;
        for (let i = 0; i < steps; i++) {
          contacts += stepPhysics(s.player, s.balls, keysRef.current, rad(camRef.current.yaw), dt / steps);
        }
        s.contacts = contacts;
        s.peakContacts = Math.max(s.peakContacts * 0.965, contacts);
        s.jsUs = Math.max(0, nowUs() - t0);
      }
      setFrame((n) => (n + 1) & 0xffffff);
      handle = schedule(tick);
    };

    handle = schedule(tick);
    return () => {
      cancel(handle);
      offDown();
      offUp();
    };
  }, []);

  const reset = () => {
    hostVoid('__physics_lab_reset', 5);
    sim.current.player = makePlayer();
    sim.current.balls = makeBalls();
    sim.current.contacts = 0;
    sim.current.peakContacts = 0;
    sim.current.jsUs = 0;
    sim.current.hostUs = 0;
    sim.current.hostTotalUs = 0;
    sim.current.hostBridgeUs = 0;
  };

  const burst = () => {
    const s = sim.current;
    hostVoid('__physics_lab_burst', 4);
    for (let i = 0; i < 4; i++) addBall(s.balls, s.t + i * 0.19);
  };

  const onDown = (e: any) => {
    drag.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) };
  };
  const onMove = (e: any) => {
    const d = drag.current;
    if (!d) return;
    const x = Number(e?.x ?? d.x);
    const y = Number(e?.y ?? d.y);
    const next = {
      yaw: camRef.current.yaw + (x - d.x) * 0.25,
      pitch: clamp(camRef.current.pitch - (y - d.y) * 0.18, 12, 68),
    };
    camRef.current = next;
    setCam(next);
    d.x = x;
    d.y = y;
  };
  const onUp = () => {
    drag.current = null;
  };

  const s = sim.current;
  const player = s.player;
  const hostTotal = s.hostUs + s.hostBridgeUs;
  const activeSim = backend === 'js' ? s.jsUs : s.hostUs;
  const activeTotal = backend === 'js' ? s.jsUs : hostTotal;
  const activeDelta = s.jsUs > 0 && hostTotal > 0 ? s.jsUs - hostTotal : 0;
  const target: Vec3 = [player.x, player.y + 0.95, player.z];
  const distance = 10.2;
  const cp = rad(cam.pitch);
  const cy = rad(cam.yaw);
  const horiz = Math.cos(cp) * distance;
  const camPos: Vec3 = [
    target[0] + Math.sin(cy) * horiz,
    target[1] + Math.sin(cp) * distance,
    target[2] + Math.cos(cy) * horiz,
  ];

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: PAGE, flexDirection: 'column' }}>
      <Col style={{ backgroundColor: BAR, borderBottomWidth: 1, borderBottomColor: FRAME, padding: 12, gap: 9 }}>
        <Row style={{ gap: 10, alignItems: 'baseline' }}>
          <Text style={{ color: INK, fontSize: 15, fontWeight: 'bold' }}>PHYSICS LAB</Text>
          <Text style={{ color: DIM, fontSize: 11 }}>gallery item bodies, off-center mass, restitution, blocking volumes, player body</Text>
        </Row>
        <Row style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Btn label={paused ? 'resume' : 'pause'} active={paused} onPress={() => setPaused((v) => !v)} />
          <Btn label="reset" onPress={reset} />
          <Btn label="+ balls" onPress={burst} />
          <Btn label="JS phys" active={backend === 'js'} onPress={() => setBackend('js')} />
          <Btn label="HOST phys" active={backend === 'host'} onPress={() => { if (hasHostPhysics()) setBackend('host'); }} />
          <Box style={{ width: 8 }} />
          <Meter label="items" value={String(s.balls.length)} />
          <Meter label="contacts" value={`${s.contacts}`} />
          <Meter label="height" value={player.y.toFixed(2)} />
          <Meter label="vertical" value={player.vy.toFixed(2)} />
          <Meter label="active sim" value={activeSim > 0 ? `${activeSim.toFixed(2)}us` : '-'} />
          <Meter label="active total" value={activeTotal > 0 ? `${activeTotal.toFixed(2)}us` : '-'} />
          <Meter label="host sim" value={s.hostUs > 0 ? `${s.hostUs.toFixed(2)}us` : '-'} />
          <Meter label="bridge+view" value={s.hostBridgeUs > 0 ? `${s.hostBridgeUs.toFixed(2)}us` : '-'} />
          <Meter label="JS last" value={s.jsUs > 0 ? `${s.jsUs.toFixed(2)}us` : '-'} />
          <Meter label="delta vs JS" value={activeDelta ? `${activeDelta.toFixed(2)}us` : '-'} />
          <Meter label="frame" value={String(frame)} />
        </Row>
      </Col>

      <Pressable
        style={{ flexGrow: 1, position: 'relative', overflow: 'hidden' }}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
      >
        <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#111b2b" showGrid={false} showAxes={false}>
          <Scene3D.Camera position={camPos} target={target} fov={54} />
          <Scene3D.Skybox zenith="#172a4c" horizon="#5a7895" ground="#0c1118" sunDir={[0.35, 0.75, 0.25]} sunColor="#ffe5ad" sunSize={0.018} sunGlow={0.32} haze={0.2} cloud={0.16} />
          <Scene3D.AmbientLight color="#74839b" intensity={0.68} />
          <Scene3D.DirectionalLight direction={[0.35, 0.85, 0.4]} color="#ffe0ac" intensity={0.95} />
          <Scene3D.PointLight position={[-4.6, 4.8, -3.4]} color="#54d7ff" intensity={0.45} />
          <Scene3D.PointLight position={[4.8, 3.9, 3.6]} color="#ff6e9c" intensity={0.35} />

          <Scene3D.Mesh geometry={Geometry.Box} params={{ width: WORLD_HALF * 2 + 0.4, height: 0.16, depth: WORLD_HALF * 2 + 0.4 }} material={FLOOR} position={[0, -0.08, 0]} />
          {[-6, -4, -2, 0, 2, 4, 6].map((x) => (
            <Scene3D.Mesh key={`gx-${x}`} geometry={Geometry.Box} params={{ width: 0.025, height: 0.018, depth: WORLD_HALF * 2 }} material={GRID} position={[x, 0.016, 0]} />
          ))}
          {[-6, -4, -2, 0, 2, 4, 6].map((z) => (
            <Scene3D.Mesh key={`gz-${z}`} geometry={Geometry.Box} params={{ width: WORLD_HALF * 2, height: 0.018, depth: 0.025 }} material={GRID} position={[0, 0.018, z]} />
          ))}

          <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 0.18, height: 1.05, depth: WORLD_HALF * 2 + 0.28 }} material="#2a364a" position={[-WORLD_HALF - 0.09, 0.52, 0]} />
          <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 0.18, height: 1.05, depth: WORLD_HALF * 2 + 0.28 }} material="#2a364a" position={[WORLD_HALF + 0.09, 0.52, 0]} />
          <Scene3D.Mesh geometry={Geometry.Box} params={{ width: WORLD_HALF * 2 + 0.28, height: 1.05, depth: 0.18 }} material="#2a364a" position={[0, 0.52, -WORLD_HALF - 0.09]} />
          <Scene3D.Mesh geometry={Geometry.Box} params={{ width: WORLD_HALF * 2 + 0.28, height: 1.05, depth: 0.18 }} material="#2a364a" position={[0, 0.52, WORLD_HALF + 0.09]} />

          {blocks.map((block) => (
            <Scene3D.Mesh
              key={block.id}
              geometry={Geometry.Box}
              params={{ width: block.hx * 2, height: block.h, depth: block.hz * 2 }}
              material={block.color}
              position={[block.x, block.h * 0.5, block.z]}
            />
          ))}

          <PlayerRig player={player} t={s.t} />
          {s.balls.map((ball) => <BallMesh key={ball.id} ball={ball} />)}
        </Scene3D>

        <Col style={{ position: 'absolute', left: 16, bottom: 14, gap: 4 }}>
          <Text style={{ color: CYAN, fontSize: 11, fontWeight: 'bold' }}>
            {backend.toUpperCase()} physics / {player.onGround ? 'grounded' : 'airborne'} / gravity {GRAVITY.toFixed(1)}
          </Text>
          <Text style={{ color: DIM, fontSize: 11 }}>
            restitution {BALL_RESTITUTION.toFixed(2)} / peak contacts {s.peakContacts.toFixed(1)} / inactive values are last samples
          </Text>
        </Col>
      </Pressable>
    </Box>
  );
}
