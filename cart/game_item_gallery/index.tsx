import { useEffect, useRef, useState } from 'react';
import { Box, Col, Pressable, Row, Scene3D, ScrollView, Text } from '@reactjit/runtime/primitives';
import * as Geometry from '@reactjit/geometries';
import { mesh, normalize, type GeometryData, type Vec3 } from '@reactjit/geometries';
import { OrbitCamera } from '@reactjit/cameras';

type V3 = [number, number, number];
type ModelCtx = { origin: V3; yaw: number; scale: number; active: boolean };
type ModelFn = (ctx: ModelCtx) => any;

const PI = Math.PI;

function def<P>(id: string, defaults: P, generate: (params: P) => GeometryData) {
  return { id, defaults, generate };
}

function sub(a: V3, b: V3): V3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function nrm(a: V3, b: V3, c: V3): Vec3 {
  const n = cross(sub(b, a), sub(c, a));
  return normalize(n[0], n[1], n[2]);
}
function tri(g: ReturnType<typeof mesh>, a: V3, b: V3, c: V3): void {
  const n = nrm(a, b, c);
  g.tri(a, n, [0, 0], b, n, [1, 0], c, n, [0.5, 1]);
}
function quad(g: ReturnType<typeof mesh>, a: V3, b: V3, c: V3, d: V3): void {
  const n = nrm(a, b, c);
  g.tri(a, n, [0, 0], b, n, [1, 0], c, n, [1, 1]);
  g.tri(a, n, [0, 0], c, n, [1, 1], d, n, [0, 1]);
}

const Blade = def('game-gallery/blade-v1', { length: 1, width: 0.22, thickness: 0.04 }, (p) => {
  const g = mesh();
  const z = p.thickness * 0.5;
  const b = -p.length * 0.45;
  const t = p.length * 0.58;
  const w = p.width * 0.5;
  const a: V3 = [b, -w, z], c: V3 = [b, w, z], tip: V3 = [t, 0, z];
  const ab: V3 = [b, -w, -z], cb: V3 = [b, w, -z], tipb: V3 = [t, 0, -z];
  tri(g, a, tip, c);
  tri(g, cb, tipb, ab);
  quad(g, a, ab, tipb, tip);
  quad(g, tip, tipb, cb, c);
  quad(g, c, cb, ab, a);
  return g.build();
});

const Sail = def('game-gallery/sail-v1', { width: 0.85, height: 1.25, thickness: 0.02 }, (p) => {
  const g = mesh();
  const z = p.thickness * 0.5;
  const a: V3 = [-p.width * 0.15, 0, z];
  const b: V3 = [p.width * 0.72, 0.1, z];
  const c: V3 = [-p.width * 0.12, p.height, z];
  const ar: V3 = [a[0], a[1], -z], br: V3 = [b[0], b[1], -z], cr: V3 = [c[0], c[1], -z];
  tri(g, a, b, c);
  tri(g, cr, br, ar);
  quad(g, a, ar, br, b);
  quad(g, b, br, cr, c);
  quad(g, c, cr, ar, a);
  return g.build();
});

const BoatHull = def('game-gallery/boat-hull-v1', { length: 1.4, width: 0.62, height: 0.36 }, (p) => {
  const g = mesh();
  const lx = p.length * 0.5;
  const wz = p.width * 0.5;
  const h = p.height;
  const topA: V3 = [-lx, 0, -wz], topB: V3 = [lx, 0, -wz], topC: V3 = [lx, 0, wz], topD: V3 = [-lx, 0, wz];
  const keelA: V3 = [-lx * 0.74, -h, 0], keelB: V3 = [lx * 0.74, -h, 0];
  quad(g, topD, topC, topB, topA);
  tri(g, topA, topB, keelB);
  tri(g, topA, keelB, keelA);
  tri(g, topC, topD, keelA);
  tri(g, topC, keelA, keelB);
  tri(g, topB, topC, keelB);
  tri(g, topD, topA, keelA);
  return g.build();
});

const Surfboard = def('game-gallery/surfboard-v1', { length: 1.55, width: 0.42, thickness: 0.07, segments: 24 }, (p) => {
  const g = mesh();
  const top = p.thickness * 0.5;
  const bottom = -top;
  const pts: V3[] = [];
  for (let i = 0; i < p.segments; i++) {
    const a = (i / p.segments) * PI * 2;
    pts.push([Math.cos(a) * p.length * 0.5, 0, Math.sin(a) * p.width * 0.5]);
  }
  const ct: V3 = [0, top, 0], cb: V3 = [0, bottom, 0];
  for (let i = 0; i < p.segments; i++) {
    const j = (i + 1) % p.segments;
    const ti: V3 = [pts[i][0], top, pts[i][2]];
    const tj: V3 = [pts[j][0], top, pts[j][2]];
    const bi: V3 = [pts[i][0], bottom, pts[i][2]];
    const bj: V3 = [pts[j][0], bottom, pts[j][2]];
    tri(g, ct, tj, ti);
    tri(g, cb, bi, bj);
    quad(g, ti, tj, bj, bi);
  }
  return g.build();
});

function local(ctx: ModelCtx, p: V3): V3 {
  const c = Math.cos(ctx.yaw), s = Math.sin(ctx.yaw);
  const x = p[0] * ctx.scale;
  const y = p[1] * ctx.scale;
  const z = p[2] * ctx.scale;
  return [ctx.origin[0] + x * c - z * s, ctx.origin[1] + y, ctx.origin[2] + x * s + z * c];
}
function scl(ctx: ModelCtx, s: V3 | number): V3 {
  if (typeof s === 'number') return [s * ctx.scale, s * ctx.scale, s * ctx.scale];
  return [s[0] * ctx.scale, s[1] * ctx.scale, s[2] * ctx.scale];
}
function rot(ctx: ModelCtx, r: V3 = [0, 0, 0]): V3 {
  return [r[0], r[1] + ctx.yaw, r[2]];
}
function Part({ ctx, geometry, params, material, p = [0, 0, 0], r = [0, 0, 0], s = 1 }: {
  ctx: ModelCtx;
  geometry: any;
  params?: any;
  material: string;
  p?: V3;
  r?: V3;
  s?: V3 | number;
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
const torus16 = { radius: 0.5, tube: 0.1, segments: 18, sides: 8 };

function Knife(ctx: ModelCtx) {
  return <>
    <Part ctx={ctx} geometry={Blade} params={{ length: 1.1, width: 0.28, thickness: 0.055 }} material="#cbd5df" p={[0.15, 0.18, 0]} r={[0, 0, -0.18]} />
    <Part ctx={ctx} geometry={box} params={box1} material="#3a261b" p={[-0.47, 0.14, 0]} r={[0, 0, -0.18]} s={[0.5, 0.16, 0.16]} />
    <Part ctx={ctx} geometry={box} params={box1} material="#20242c" p={[-0.18, 0.14, 0]} r={[0, 0, -0.18]} s={[0.08, 0.24, 0.18]} />
  </>;
}

function Pistol(ctx: ModelCtx) {
  return <>
    <Part ctx={ctx} geometry={box} params={box1} material="#20242d" p={[0, 0.42, 0]} s={[0.9, 0.23, 0.2]} />
    <Part ctx={ctx} geometry={cyl} params={cyl12} material="#11151c" p={[0.57, 0.46, 0]} r={[0, 0, PI / 2]} s={[0.09, 0.62, 0.09]} />
    <Part ctx={ctx} geometry={box} params={box1} material="#2e333c" p={[-0.25, 0.2, 0]} r={[0, 0, -0.45]} s={[0.22, 0.56, 0.2]} />
    <Part ctx={ctx} geometry={torus} params={torus16} material="#151922" p={[0.05, 0.18, 0]} r={[PI / 2, 0, 0]} s={[0.25, 0.25, 0.12]} />
    <Part ctx={ctx} geometry={box} params={box1} material="#c0a062" p={[0.15, 0.33, 0]} s={[0.09, 0.16, 0.04]} />
  </>;
}

function Pitchfork(ctx: ModelCtx) {
  const prongs = [-0.24, -0.08, 0.08, 0.24];
  return <>
    <Part ctx={ctx} geometry={cyl} params={cyl12} material="#725238" p={[0, 0.45, 0]} r={[0, 0, 0.1]} s={[0.055, 1.35, 0.055]} />
    <Part ctx={ctx} geometry={box} params={box1} material="#3f4650" p={[0, 1.16, 0]} s={[0.68, 0.08, 0.08]} />
    {prongs.map((x, i) => <Part key={i} ctx={ctx} geometry={cone} params={cone12} material="#aeb8c2" p={[x, 1.5, 0]} s={[0.055, 0.7, 0.055]} />)}
  </>;
}

function Bat(ctx: ModelCtx) {
  return <>
    <Part ctx={ctx} geometry={cyl} params={cyl18} material="#b77a42" p={[0.08, 0.62, 0]} r={[0, 0, -0.38]} s={[0.17, 1.55, 0.17]} />
    <Part ctx={ctx} geometry={cyl} params={cyl18} material="#5b371f" p={[-0.25, -0.03, 0]} r={[0, 0, -0.38]} s={[0.08, 0.52, 0.08]} />
    <Part ctx={ctx} geometry={sphere} params={sphere12} material="#d09a5d" p={[0.39, 1.2, 0]} s={[0.22, 0.22, 0.22]} />
  </>;
}

function Cash(ctx: ModelCtx) {
  return <>
    {[0, 1, 2].map((i) => <Part key={`bill-${i}`} ctx={ctx} geometry={box} params={box1} material={i === 1 ? '#7ac77d' : '#63b66a'} p={[0, 0.08 + i * 0.05, 0]} r={[0, 0.18 * i, 0]} s={[0.9, 0.035, 0.45]} />)}
    <Part ctx={ctx} geometry={box} params={box1} material="#e2efdf" p={[0, 0.27, 0]} s={[0.38, 0.025, 0.16]} />
    <Part ctx={ctx} geometry={box} params={box1} material="#2d8646" p={[-0.26, 0.3, 0]} s={[0.08, 0.035, 0.2]} />
  </>;
}

function Vehicle(ctx: ModelCtx) {
  const wheels: V3[] = [[-0.52, 0.07, -0.34], [0.52, 0.07, -0.34], [-0.52, 0.07, 0.34], [0.52, 0.07, 0.34]];
  return <>
    <Part ctx={ctx} geometry={box} params={box1} material="#c34c42" p={[0, 0.34, 0]} s={[1.25, 0.36, 0.66]} />
    <Part ctx={ctx} geometry={box} params={box1} material="#f08a6b" p={[-0.12, 0.64, 0]} s={[0.62, 0.34, 0.54]} />
    <Part ctx={ctx} geometry={box} params={box1} material="#91c8e8" p={[-0.14, 0.72, 0.28]} s={[0.34, 0.16, 0.035]} />
    {wheels.map((p, i) => <Part key={i} ctx={ctx} geometry={cyl} params={cyl18} material="#111111" p={p} r={[PI / 2, 0, 0]} s={[0.19, 0.14, 0.19]} />)}
  </>;
}

function SailBoat(ctx: ModelCtx) {
  return <>
    <Part ctx={ctx} geometry={BoatHull} params={{ length: 1.35, width: 0.62, height: 0.32 }} material="#865236" p={[0, 0.24, 0]} />
    <Part ctx={ctx} geometry={cyl} params={cyl12} material="#6b4a2d" p={[0.02, 0.82, 0]} s={[0.04, 1.15, 0.04]} />
    <Part ctx={ctx} geometry={Sail} params={{ width: 0.78, height: 1.08, thickness: 0.025 }} material="#f3ead4" p={[0.15, 0.52, 0.02]} />
    <Part ctx={ctx} geometry={Sail} params={{ width: 0.55, height: 0.78, thickness: 0.02 }} material="#dbe8f2" p={[-0.34, 0.6, -0.025]} r={[0, PI, 0]} />
  </>;
}

function Surf(ctx: ModelCtx) {
  return <>
    <Part ctx={ctx} geometry={Surfboard} params={{ length: 1.6, width: 0.44, thickness: 0.075, segments: 24 }} material="#f3e36f" p={[0, 0.25, 0]} r={[0, 0, 0.18]} />
    <Part ctx={ctx} geometry={box} params={box1} material="#3c8fd2" p={[0, 0.305, 0]} r={[0, 0, 0.18]} s={[1.05, 0.018, 0.055]} />
    <Part ctx={ctx} geometry={box} params={box1} material="#f06452" p={[-0.38, 0.315, 0]} r={[0, 0, 0.18]} s={[0.12, 0.025, 0.24]} />
  </>;
}

function Football(ctx: ModelCtx) {
  return <>
    <Part ctx={ctx} geometry={sphere} params={sphere12} material="#8a4e2b" p={[0, 0.42, 0]} s={[0.82, 0.46, 0.46]} />
    <Part ctx={ctx} geometry={box} params={box1} material="#f2ead8" p={[0, 0.43, 0.48]} s={[0.54, 0.04, 0.025]} />
    {[-0.16, 0, 0.16].map((x, i) => <Part key={i} ctx={ctx} geometry={box} params={box1} material="#f2ead8" p={[x, 0.47, 0.505]} s={[0.035, 0.12, 0.025]} />)}
  </>;
}

function Basketball(ctx: ModelCtx) {
  return <>
    <Part ctx={ctx} geometry={sphere} params={{ radius: 0.5, segments: 24, rings: 14 }} material="#da7627" p={[0, 0.48, 0]} s={[0.75, 0.75, 0.75]} />
    <Part ctx={ctx} geometry={torus} params={{ radius: 0.51, tube: 0.018, segments: 32, sides: 6 }} material="#1e2025" p={[0, 0.48, 0]} r={[PI / 2, 0, 0]} s={[0.75, 0.75, 0.75]} />
    <Part ctx={ctx} geometry={torus} params={{ radius: 0.51, tube: 0.018, segments: 32, sides: 6 }} material="#1e2025" p={[0, 0.48, 0]} r={[0, PI / 2, 0]} s={[0.75, 0.75, 0.75]} />
  </>;
}

function PillBottle(ctx: ModelCtx) {
  return <>
    <Part ctx={ctx} geometry={cyl} params={cyl18} material="#d98238" p={[0, 0.42, 0]} s={[0.32, 0.72, 0.32]} />
    <Part ctx={ctx} geometry={cyl} params={cyl18} material="#f7f1df" p={[0, 0.84, 0]} s={[0.36, 0.16, 0.36]} />
    <Part ctx={ctx} geometry={box} params={box1} material="#f7f7f0" p={[0, 0.44, 0.325]} s={[0.36, 0.22, 0.025]} />
  </>;
}

function BeerBottle(ctx: ModelCtx) {
  return <>
    <Part ctx={ctx} geometry={cyl} params={cyl18} material="#2f593a" p={[0, 0.42, 0]} s={[0.22, 0.62, 0.22]} />
    <Part ctx={ctx} geometry={cyl} params={cyl18} material="#24472f" p={[0, 0.88, 0]} s={[0.11, 0.44, 0.11]} />
    <Part ctx={ctx} geometry={cyl} params={cyl18} material="#d7b46a" p={[0, 1.12, 0]} s={[0.13, 0.06, 0.13]} />
    <Part ctx={ctx} geometry={box} params={box1} material="#efe2b2" p={[0, 0.45, 0.225]} s={[0.28, 0.2, 0.025]} />
  </>;
}

function LiquorBottle(ctx: ModelCtx) {
  return <>
    <Part ctx={ctx} geometry={box} params={box1} material="#5d3a8d" p={[0, 0.46, 0]} s={[0.42, 0.7, 0.28]} />
    <Part ctx={ctx} geometry={cyl} params={cyl18} material="#3b2763" p={[0, 0.96, 0]} s={[0.12, 0.38, 0.12]} />
    <Part ctx={ctx} geometry={box} params={box1} material="#f2d58e" p={[0, 0.46, 0.292]} s={[0.28, 0.26, 0.025]} />
  </>;
}

function Pills(ctx: ModelCtx) {
  const pillData = [
    { p: [-0.34, 0.18, -0.12] as V3, c: '#f7f4e8', r: 0.2 },
    { p: [0.08, 0.2, 0.05] as V3, c: '#e65353', r: -0.4 },
    { p: [0.38, 0.17, -0.03] as V3, c: '#70a8f0', r: 0.7 },
  ];
  return <>
    {pillData.map((d, i) => <Part key={`pill-${i}`} ctx={ctx} geometry={cyl} params={cyl18} material={d.c} p={d.p} r={[PI / 2, 0, d.r]} s={[0.13, 0.36, 0.13]} />)}
    {pillData.map((d, i) => <Part key={`pill-cap-${i}`} ctx={ctx} geometry={sphere} params={sphere12} material={i === 1 ? '#fff3f3' : d.c} p={[d.p[0] + Math.cos(d.r) * 0.18, d.p[1], d.p[2] + Math.sin(d.r) * 0.18]} s={[0.13, 0.13, 0.13]} />)}
  </>;
}

function Weed(ctx: ModelCtx) {
  return <>
    {[-0.28, -0.1, 0.08, 0.24].map((x, i) => <Part key={`bud-${i}`} ctx={ctx} geometry={cone} params={cone12} material={i % 2 ? '#4a9c43' : '#337a38'} p={[x, 0.28 + i * 0.035, (i - 1.5) * 0.08]} r={[0.4, i * 0.7, 0.2]} s={[0.18, 0.5, 0.18]} />)}
    {[0, 1, 2].map((i) => <Part key={`leaf-${i}`} ctx={ctx} geometry={Surfboard} params={{ length: 0.55, width: 0.13, thickness: 0.02, segments: 12 }} material="#5fc25b" p={[(i - 1) * 0.2, 0.32, 0.12]} r={[0, i * 0.8, PI / 2]} />)}
  </>;
}

function Cigarettes(ctx: ModelCtx) {
  return <>
    <Part ctx={ctx} geometry={box} params={box1} material="#d73e36" p={[-0.28, 0.33, 0]} s={[0.42, 0.62, 0.18]} />
    <Part ctx={ctx} geometry={box} params={box1} material="#f7f3e7" p={[-0.28, 0.57, 0.19]} s={[0.36, 0.16, 0.025]} />
    {[0, 1, 2].map((i) => <Part key={`cig-${i}`} ctx={ctx} geometry={cyl} params={cyl12} material="#f4f0df" p={[0.24 + i * 0.11, 0.28 + i * 0.04, 0.06]} r={[PI / 2, 0, -0.6]} s={[0.045, 0.68, 0.045]} />)}
    {[0, 1, 2].map((i) => <Part key={`filter-${i}`} ctx={ctx} geometry={cyl} params={cyl12} material="#d49a55" p={[0.43 + i * 0.11, 0.17 + i * 0.04, 0.06]} r={[PI / 2, 0, -0.6]} s={[0.047, 0.16, 0.047]} />)}
  </>;
}

function Backpack(ctx: ModelCtx) {
  return <>
    <Part ctx={ctx} geometry={box} params={box1} material="#315c8f" p={[0, 0.55, 0]} s={[0.62, 0.82, 0.34]} />
    <Part ctx={ctx} geometry={box} params={box1} material="#244a78" p={[0, 0.72, 0.22]} s={[0.52, 0.18, 0.15]} />
    <Part ctx={ctx} geometry={torus} params={{ radius: 0.45, tube: 0.035, segments: 18, sides: 8 }} material="#1e3352" p={[-0.2, 0.48, -0.22]} r={[0, PI / 2, 0]} s={[0.48, 0.8, 0.48]} />
    <Part ctx={ctx} geometry={torus} params={{ radius: 0.45, tube: 0.035, segments: 18, sides: 8 }} material="#1e3352" p={[0.2, 0.48, -0.22]} r={[0, PI / 2, 0]} s={[0.48, 0.8, 0.48]} />
    <Part ctx={ctx} geometry={cyl} params={cyl12} material="#d6b46c" p={[0.25, 0.64, 0.39]} r={[PI / 2, 0, 0]} s={[0.035, 0.16, 0.035]} />
  </>;
}

function MedKit(ctx: ModelCtx) {
  return <>
    <Part ctx={ctx} geometry={box} params={box1} material="#f1f4f4" p={[0, 0.38, 0]} s={[0.82, 0.52, 0.32]} />
    <Part ctx={ctx} geometry={box} params={box1} material="#cc3232" p={[0, 0.39, 0.335]} s={[0.16, 0.38, 0.035]} />
    <Part ctx={ctx} geometry={box} params={box1} material="#cc3232" p={[0, 0.39, 0.34]} s={[0.42, 0.13, 0.04]} />
    <Part ctx={ctx} geometry={cyl} params={cyl12} material="#c8ccd0" p={[0, 0.71, 0]} r={[0, 0, PI / 2]} s={[0.055, 0.44, 0.055]} />
  </>;
}

type Item = { id: string; label: string; tone: string; note: string; model: ModelFn };

const ITEMS: Item[] = [
  { id: 'knife', label: 'Knife', tone: '#cbd5df', note: 'wedge blade, riveted grip', model: Knife },
  { id: 'pistol', label: 'Pistol', tone: '#9aa4b2', note: 'blocky sidearm silhouette', model: Pistol },
  { id: 'pitchfork', label: 'Pitchfork', tone: '#aeb8c2', note: 'wood shaft and four tines', model: Pitchfork },
  { id: 'bat', label: 'Baseball bat', tone: '#d09a5d', note: 'tapered wood club', model: Bat },
  { id: 'cash', label: 'Cash', tone: '#7ac77d', note: 'stacked loose bills', model: Cash },
  { id: 'vehicle', label: 'Vehicle', tone: '#f08a6b', note: 'compact low-poly car', model: Vehicle },
  { id: 'sailboat', label: 'Sail boat', tone: '#f3ead4', note: 'hull, mast, twin sails', model: SailBoat },
  { id: 'surfboard', label: 'Surfboard', tone: '#f3e36f', note: 'custom oval board mesh', model: Surf },
  { id: 'football', label: 'Football', tone: '#c9793c', note: 'squashed ball and laces', model: Football },
  { id: 'basketball', label: 'Basketball', tone: '#da7627', note: 'sphere with seam bands', model: Basketball },
  { id: 'pillbottle', label: 'Pill bottle', tone: '#d98238', note: 'amber bottle and label', model: PillBottle },
  { id: 'beer', label: 'Beer bottle', tone: '#2f593a', note: 'green glass and paper label', model: BeerBottle },
  { id: 'liquor', label: 'Liquor bottle', tone: '#7b58ad', note: 'square bottle, long neck', model: LiquorBottle },
  { id: 'pills', label: 'Pills', tone: '#e65353', note: 'loose capsule scatter', model: Pills },
  { id: 'weed', label: 'Weed', tone: '#5fc25b', note: 'leafy low-poly pickup', model: Weed },
  { id: 'cigarettes', label: 'Cigarettes', tone: '#d73e36', note: 'pack and loose smokes', model: Cigarettes },
  { id: 'backpack', label: 'Backpack', tone: '#315c8f', note: 'straps, pouch, zipper pull', model: Backpack },
  { id: 'medkit', label: 'Med kit', tone: '#f1f4f4', note: 'bonus utility prop', model: MedKit },
];

function Pedestal({ ctx, item }: { ctx: ModelCtx; item: Item }) {
  return <>
    <Part ctx={{ ...ctx, yaw: 0, scale: 1 }} geometry={box} params={box1} material={ctx.active ? item.tone : '#202735'} p={[0, -0.035, 0]} s={[2.1, 0.1, 1.78]} />
    <Part ctx={{ ...ctx, yaw: 0, scale: 1 }} geometry={box} params={box1} material={ctx.active ? '#f5d17b' : '#3a4252'} p={[0, 0.04, 0]} s={[1.78, 0.045, 1.46]} />
  </>;
}

function GalleryScene({ item, spin, yaw, pitch }: { item: Item; spin: number; yaw: number; pitch: number }) {
  const ctx: ModelCtx = { origin: [0, 0.18, 0], yaw: spin, scale: 1.95, active: true };
  return (
    <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#111827">
      <OrbitCamera target={[0, 0.72, 0]} yaw={yaw} pitch={pitch} dist={4.6} zoom={1} fov={38} />
      <Scene3D.Skybox
        zenith="#1b2a43"
        horizon="#657792"
        ground="#090c12"
        sunDir={[0.45, 0.7, 0.25]}
        sunColor="#ffe0a8"
        sunSize={0.015}
        sunGlow={0.22}
        haze={0.16}
        cloud={0.04}
        night={0}
      />
      <Scene3D.AmbientLight color="#c9d8f4" intensity={0.58} />
      <Scene3D.DirectionalLight direction={[0.45, 0.88, 0.32]} color="#ffe0b0" intensity={0.95} />
      <Scene3D.PointLight position={[-2.2, 2.6, 3.2]} color="#8cc8ff" intensity={0.82} />
      <Scene3D.PointLight position={[2.4, 2.0, -2.6]} color="#ffb380" intensity={0.45} />
      <Scene3D.Mesh geometry={box} params={box1} material="#0d131f" position={[0, -0.17, 0]} scale={[8.5, 0.08, 6.2]} />
      <Pedestal ctx={{ ...ctx, yaw: 0, scale: 1.18 }} item={item} />
      {item.model(ctx)}
    </Scene3D>
  );
}

function ItemButton({ item, active, onPress }: { item: Item; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Box style={{
        paddingTop: 9,
        paddingBottom: 9,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: 7,
        borderWidth: 1,
        borderColor: active ? item.tone : '#293344',
        backgroundColor: active ? '#172130' : '#101722',
        gap: 4,
      }}>
        <Row style={{ alignItems: 'center', gap: 8 }}>
          <Box style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: item.tone }} />
          <Text style={{ color: '#eef4ff', fontSize: 14, fontWeight: active ? 'bold' : 'normal' }}>{item.label}</Text>
        </Row>
        <Text style={{ color: active ? '#cbd7e7' : '#7f8ca3', fontSize: 11 }}>{item.note}</Text>
      </Box>
    </Pressable>
  );
}

export default function GameItemGallery() {
  const [selected, setSelected] = useState('knife');
  const [spin, setSpin] = useState(0);
  const [orbitYaw, setOrbitYaw] = useState(35);
  const [orbitPitch, setOrbitPitch] = useState(28);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const current = ITEMS.find((item) => item.id === selected) ?? ITEMS[0];

  useEffect(() => {
    let handle: any = 0;
    const tick = () => {
      setSpin((v) => (v + 0.018) % (PI * 2));
      handle = setTimeout(tick, 33);
    };
    handle = setTimeout(tick, 33);
    return () => clearTimeout(handle);
  }, []);

  const onDown = (e: any) => {
    dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) };
  };
  const onMove = (e: any) => {
    const d = dragRef.current;
    if (!d) return;
    const nx = Number(e?.x ?? 0);
    const ny = Number(e?.y ?? 0);
    const dx = nx - d.x;
    const dy = ny - d.y;
    d.x = nx;
    d.y = ny;
    setOrbitYaw((v) => v + dx * 0.38);
    setOrbitPitch((v) => Math.max(8, Math.min(70, v - dy * 0.28)));
  };
  const onUp = () => { dragRef.current = null; };

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#070a10' }}>
      <Pressable
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        style={{ width: '100%', height: '100%' }}
      >
        <GalleryScene item={current} spin={spin} yaw={orbitYaw} pitch={orbitPitch} />
      </Pressable>

      <Col style={{ position: 'absolute', left: 18, top: 16, gap: 6 }}>
        <Text style={{ color: '#f3f7ff', fontSize: 26, fontWeight: 'bold' }}>Game Item Gallery</Text>
        <Text style={{ color: '#96a4b8', fontSize: 13 }}>single-item close view · drag the scene to orbit</Text>
      </Col>

      <Col style={{
        position: 'absolute',
        right: 16,
        top: 16,
        width: 310,
        height: '95%',
        backgroundColor: '#0b1019dd',
        borderWidth: 1,
        borderColor: '#263145',
        borderRadius: 8,
        padding: 12,
        gap: 10,
      }}>
        <Box style={{ gap: 4, paddingBottom: 4 }}>
          <Text style={{ color: current.tone, fontSize: 18, fontWeight: 'bold' }}>{current.label}</Text>
          <Text style={{ color: '#aab6c8', fontSize: 12 }}>{current.note}</Text>
        </Box>
        <ScrollView style={{ height: '88%', gap: 8 }} showScrollbar>
          <Col style={{ gap: 8 }}>
            {ITEMS.map((item) => (
              <ItemButton key={item.id} item={item} active={item.id === selected} onPress={() => setSelected(item.id)} />
            ))}
          </Col>
        </ScrollView>
      </Col>
    </Box>
  );
}
