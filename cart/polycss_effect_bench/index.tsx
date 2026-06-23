import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Row, Col, Text, Pressable, Effect, Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import { solveCamera, CAMERAS, type Vec3 } from '@reactjit/cameras';

type Kind = 'grass' | 'dirt' | 'stone' | 'wood' | 'leaf' | 'brick' | 'glass';
type Block = { x: number; y: number; z: number; kind: Kind };
type Face = { verts: Vec3[]; normal: Vec3; color: string };

const W = 596;
const H = 612;
const ASPECT = W / H;
const FACE_STRIDE = 20;
const HEADER = 16;
const MAX_SHADER_FACES = 4096;

type Mode = 'effect' | 'scene3d';
type Profile = { label: string; radius: number };

const PROFILES: Profile[] = [
  { label: '1k-ish', radius: 12 },
  { label: '2k-ish', radius: 18 },
  { label: '4k+', radius: 26 },
];

const KIND: Record<Kind, string> = {
  grass: '#4aaa43',
  dirt: '#8a5a34',
  stone: '#81878b',
  wood: '#9a6731',
  leaf: '#3ca85a',
  brick: '#b64d3f',
  glass: '#82dcff',
};

const SHADER = `
@group(0) @binding(1) var<storage, read> ys: array<f32>;

fn rot(p: vec3f, yaw: f32, pitch: f32) -> vec3f {
  let cy = cos(yaw);
  let sy = sin(yaw);
  let cp = cos(pitch);
  let sp = sin(pitch);
  let x = p.x * cy - p.z * sy;
  let z = p.x * sy + p.z * cy;
  let y = p.y * cp - z * sp;
  let zz = p.y * sp + z * cp;
  return vec3f(x, y, zz);
}

fn edge(a: vec2f, b: vec2f, p: vec2f) -> f32 {
  return (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
}

fn inside_tri(p: vec2f, a: vec2f, b: vec2f, c: vec2f) -> bool {
  let e0 = edge(a, b, p);
  let e1 = edge(b, c, p);
  let e2 = edge(c, a, p);
  return (e0 >= 0.0 && e1 >= 0.0 && e2 >= 0.0) || (e0 <= 0.0 && e1 <= 0.0 && e2 <= 0.0);
}

fn inside_quad(p: vec2f, a: vec2f, b: vec2f, c: vec2f, d: vec2f) -> bool {
  return inside_tri(p, a, b, c) || inside_tri(p, a, c, d);
}

fn grid_bg(p: vec2f) -> vec3f {
  let g = abs(fract(p.x * 8.0) - 0.5) + abs(fract(p.y * 8.0) - 0.5);
  let line = 1.0 - smoothstep(0.90, 0.98, g);
  return mix(vec3f(0.055, 0.075, 0.065), vec3f(0.085, 0.105, 0.090), line * 0.22);
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let face_count = u32(ys[0]);
  let yaw = ys[1];
  let pitch = ys[2];
  let zoom = ys[3];
  let aspect = ys[4];
  let center = vec3f(ys[5], ys[6], ys[7]);
  let light = normalize(vec3f(-0.35, 0.82, 0.45));

  let p = vec2f((in.uv.x - 0.5) * 2.0 * aspect, (0.5 - in.uv.y) * 2.0);
  var best_z = -999999.0;
  var best_rgb = grid_bg(p);
  var hit = false;

  for (var i: u32 = 0u; i < ${MAX_SHADER_FACES}u; i = i + 1u) {
    if (i >= face_count) { break; }
    let base = ${HEADER}u + i * ${FACE_STRIDE}u;

    let v0 = rot(vec3f(ys[base + 0u], ys[base + 1u], ys[base + 2u]) - center, yaw, pitch);
    let v1 = rot(vec3f(ys[base + 3u], ys[base + 4u], ys[base + 5u]) - center, yaw, pitch);
    let v2 = rot(vec3f(ys[base + 6u], ys[base + 7u], ys[base + 8u]) - center, yaw, pitch);
    let v3 = rot(vec3f(ys[base + 9u], ys[base + 10u], ys[base + 11u]) - center, yaw, pitch);
    let n = normalize(rot(vec3f(ys[base + 15u], ys[base + 16u], ys[base + 17u]), yaw, pitch));

    if (n.z < 0.015) { continue; }

    let s0 = vec2f(v0.x * zoom, v0.y * zoom);
    let s1 = vec2f(v1.x * zoom, v1.y * zoom);
    let s2 = vec2f(v2.x * zoom, v2.y * zoom);
    let s3 = vec2f(v3.x * zoom, v3.y * zoom);
    if (!inside_quad(p, s0, s1, s2, s3)) { continue; }

    let z = (v0.z + v1.z + v2.z + v3.z) * 0.25;
    if (z <= best_z) { continue; }
    best_z = z;
    hit = true;

    let base_rgb = vec3f(ys[base + 12u], ys[base + 13u], ys[base + 14u]);
    let shade = 0.36 + 0.62 * max(dot(n, light), 0.0);
    let rim = 0.08 * smoothstep(0.0, 0.28, abs(n.z));
    best_rgb = base_rgb * shade + vec3f(rim);
  }

  if (!hit) {
    let glow = 0.22 * smoothstep(0.9, -0.35, p.y);
    return vec4f(best_rgb + vec3f(0.02, 0.04, 0.07) * glow, 1.0);
  }
  return vec4f(best_rgb, 1.0);
}
`;

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function h(x: number, z: number): number {
  return Math.round(Math.sin(x * 0.65) * 0.8 + Math.cos(z * 0.56) * 0.7 + Math.sin((x - z) * 0.35) * 0.35);
}

function buildBlocks(size: number): Block[] {
  const out: Block[] = [];
  const put = (x: number, y: number, z: number, kind: Kind) => out.push({ x, y, z, kind });
  for (let x = -size; x <= size; x++) {
    for (let z = -size; z <= size; z++) {
      const hh = h(x, z);
      put(x, -2, z, 'stone');
      put(x, -1, z, hh < 0 ? 'stone' : 'dirt');
      if (hh >= 0) put(x, 0, z, hh === 0 ? 'grass' : 'dirt');
      if (hh >= 1) put(x, 1, z, 'grass');
    }
  }
  const tree = (x: number, z: number) => {
    const y0 = h(x, z) + 1;
    put(x, y0, z, 'wood'); put(x, y0 + 1, z, 'wood'); put(x, y0 + 2, z, 'wood');
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) put(x + dx, y0 + 3, z + dz, 'leaf');
    put(x, y0 + 4, z, 'leaf');
  };
  tree(-size + 2, 2);
  tree(size - 2, -2);
  for (let i = 0; i < size - 1; i++) put(-1 + i, h(-1 + i, -size + 1) + 1, -size + 1, i % 2 ? 'brick' : 'glass');
  return out;
}

const FACE_DEFS: { n: Vec3; v: Vec3[] }[] = [
  { n: [1, 0, 0], v: [[0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5]] },
  { n: [-1, 0, 0], v: [[-0.5, -0.5, 0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [-0.5, 0.5, 0.5]] },
  { n: [0, 1, 0], v: [[-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
  { n: [0, -1, 0], v: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [-0.5, -0.5, -0.5]] },
  { n: [0, 0, 1], v: [[0.5, -0.5, 0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5]] },
  { n: [0, 0, -1], v: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]] },
];

function exposedFaces(blocks: Block[]): Face[] {
  const occupied = new Set(blocks.map((b) => `${b.x}:${b.y}:${b.z}`));
  const faces: Face[] = [];
  for (const b of blocks) {
    for (const f of FACE_DEFS) {
      const nx = b.x + f.n[0], ny = b.y + f.n[1], nz = b.z + f.n[2];
      if (occupied.has(`${nx}:${ny}:${nz}`)) continue;
      const verts = f.v.map((v) => [b.x + v[0], b.y + v[1], b.z + v[2]] as Vec3);
      faces.push({ verts, normal: f.n, color: KIND[b.kind] });
    }
  }
  return faces;
}

function center(blocks: Block[]): Vec3 {
  let sx = 0, sy = 0, sz = 0;
  for (const b of blocks) { sx += b.x; sy += b.y; sz += b.z; }
  const n = Math.max(1, blocks.length);
  return [sx / n, sy / n, sz / n];
}

function packEffectData(faces: Face[], yaw: number, pitch: number, zoom: number, c: Vec3): number[] {
  const data = new Array(HEADER + faces.length * FACE_STRIDE).fill(0);
  data[0] = faces.length;
  data[1] = yaw;
  data[2] = pitch;
  data[3] = zoom;
  data[4] = ASPECT;
  data[5] = c[0]; data[6] = c[1]; data[7] = c[2];
  for (let i = 0; i < faces.length; i++) {
    const base = HEADER + i * FACE_STRIDE;
    const f = faces[i];
    for (let v = 0; v < 4; v++) {
      data[base + v * 3 + 0] = f.verts[v][0];
      data[base + v * 3 + 1] = f.verts[v][1];
      data[base + v * 3 + 2] = f.verts[v][2];
    }
    const rgb = hexRgb(f.color);
    data[base + 12] = rgb[0]; data[base + 13] = rgb[1]; data[base + 14] = rgb[2];
    data[base + 15] = f.normal[0]; data[base + 16] = f.normal[1]; data[base + 17] = f.normal[2];
  }
  return data;
}

function instanceBatches(blocks: Block[]) {
  const kinds = Object.keys(KIND) as Kind[];
  return kinds.map((kind) => {
    const rgb = hexRgb(KIND[kind]);
    const data: number[] = [];
    for (const b of blocks) {
      if (b.kind !== kind) continue;
      data.push(b.x, b.y, b.z, 1, 1, 1, rgb[0], rgb[1], rgb[2]);
    }
    return { kind, data, count: data.length / 9 };
  }).filter((b) => b.count > 0);
}

function Button(props: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress}>
      <Box style={{
        height: 32,
        minWidth: 68,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: 6,
        backgroundColor: props.active ? '#e8ece8' : '#171a1d',
        borderWidth: 1,
        borderColor: props.active ? '#f8f7f2' : '#33383d',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <Text style={{ fontSize: 12, color: props.active ? '#111315' : '#dbe2de', fontWeight: props.active ? 'bold' : 'normal' }}>{props.label}</Text>
      </Box>
    </Pressable>
  );
}

function useFrameStats(key: string, running: boolean) {
  const [tick, setTick] = useState(0);
  const [stats, setStats] = useState({ fps: 0, ms: 0, frames: 0 });
  const ref = useRef({ last: 0, reportAt: 0, sum: 0, frames: 0, total: 0 });

  useEffect(() => {
    ref.current = { last: 0, reportAt: 0, sum: 0, frames: 0, total: 0 };
    setStats({ fps: 0, ms: 0, frames: 0 });
  }, [key]);

  useEffect(() => {
    if (!running) return;
    const g: any = globalThis;
    const useRaf = typeof g.requestAnimationFrame === 'function';
    const schedule = useRaf
      ? (fn: () => void) => g.requestAnimationFrame(fn)
      : (fn: () => void) => setTimeout(fn, 0);
    const cancel = useRaf
      ? (id: any) => g.cancelAnimationFrame?.(id)
      : (id: any) => clearTimeout(id);
    let alive = true;
    let handle: any = 0;
    const step = () => {
      if (!alive) return;
      const now = (globalThis as any).performance?.now?.() ?? Date.now();
      const r = ref.current;
      if (r.last > 0) {
        const dt = now - r.last;
        r.sum += dt;
        r.frames += 1;
        r.total += 1;
        if (r.reportAt === 0) r.reportAt = now;
        if (now - r.reportAt >= 600 && r.frames > 0) {
          setStats({
            fps: r.frames * 1000 / Math.max(1, now - r.reportAt),
            ms: r.sum / r.frames,
            frames: r.total,
          });
          r.sum = 0;
          r.frames = 0;
          r.reportAt = now;
        }
      }
      r.last = now;
      setTick((t) => t + 1);
      handle = schedule(step);
    };
    handle = schedule(step);
    return () => { alive = false; cancel(handle); };
  }, [running, key]);

  return { tick, stats };
}

function Scene3DCompare(props: { blocks: Block[]; yaw: number; pitch: number; dist: number; center: Vec3 }) {
  const solved = useMemo(() => solveCamera(CAMERAS.Orbit, {
    target: props.center,
    yaw: props.yaw * 180 / Math.PI,
    pitch: props.pitch * 180 / Math.PI,
    dist: props.dist,
    zoom: 1,
    fov: 48,
  }), [props.yaw, props.pitch, props.dist, props.center[0], props.center[1], props.center[2]]);
  const batches = useMemo(() => instanceBatches(props.blocks), [props.blocks]);
  return (
    <Scene3D style={{ width: W, height: H }} backgroundColor="#0e1412" showGrid={false} showAxes={false}>
      <Scene3D.Camera position={solved.pos} target={solved.target} fov={solved.fov} far={80} />
      <Scene3D.Skybox zenith="#274967" horizon="#b9cabd" ground="#101612" sunDir={[0.5, 0.8, 0.3]} sunColor="#fff0bd" haze={0.24} cloud={0.1} night={0} />
      <Scene3D.AmbientLight color="#d8e2d8" intensity={0.5} />
      <Scene3D.DirectionalLight direction={[0.45, 0.9, 0.35]} color="#ffe2aa" intensity={0.9} />
      {batches.map((batch) => (
        <Scene3D.Instances
          key={batch.kind}
          geometry={Geometry.Box}
          params={{ width: 1, height: 1, depth: 1 }}
          data={batch.data}
          count={batch.count}
          stride={9}
          center={[0, 0, 0]}
          boundsRadius={40}
        />
      ))}
    </Scene3D>
  );
}

function Metric(props: { label: string; value: string; sub?: string }) {
  return (
    <Col style={{
      width: 150,
      height: 58,
      gap: 3,
      padding: 9,
      borderRadius: 7,
      backgroundColor: '#101311',
      borderWidth: 1,
      borderColor: '#29302b',
      justifyContent: 'center',
    }}>
      <Text style={{ fontSize: 10, color: '#7f8d84', fontWeight: 'bold' }}>{props.label}</Text>
      <Text style={{ fontSize: 16, color: '#f3f7f2', fontWeight: 'bold' }}>{props.value}</Text>
      {props.sub ? <Text style={{ fontSize: 10, color: '#9aa79f' }}>{props.sub}</Text> : null}
    </Col>
  );
}

export default function PolycssEffectBench() {
  const [profile, setProfile] = useState<Profile>(PROFILES[1]);
  const [mode, setMode] = useState<Mode>('effect');
  const [running, setRunning] = useState(true);
  const statKey = `${mode}:${profile.radius}`;
  const { tick, stats } = useFrameStats(statKey, running);

  const blocks = useMemo(() => buildBlocks(profile.radius), [profile.radius]);
  const facesAll = useMemo(() => exposedFaces(blocks), [blocks]);
  const effectFaces = useMemo(() => facesAll.slice(0, MAX_SHADER_FACES), [facesAll]);
  const c = useMemo(() => center(blocks), [blocks]);
  const yaw = running ? tick * 0.014 : 0.9;
  const pitch = 0.62;
  const zoom = profile.radius <= 12 ? 0.058 : profile.radius <= 18 ? 0.040 : 0.030;
  const dist = profile.radius <= 12 ? 28 : profile.radius <= 18 ? 40 : 56;
  const effectData = useMemo(() => packEffectData(effectFaces, yaw, pitch, zoom, c), [effectFaces, yaw, pitch, zoom, c[0], c[1], c[2]]);
  const sceneBatches = useMemo(() => instanceBatches(blocks), [blocks]);
  const batchCount = sceneBatches.length;
  const visibleFaceRatio = Math.round(effectFaces.length * 100 / Math.max(1, facesAll.length));
  const pixelFaceTests = mode === 'effect' ? Math.round(W * H * effectFaces.length / 1000000) : 0;

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#090c0b', padding: 18, gap: 12 }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Col style={{ gap: 3 }}>
          <Text style={{ fontSize: 22, color: '#f3f7f2', fontWeight: 'bold' }}>PolyCSS-Style Effect Bench</Text>
          <Text style={{ fontSize: 12, color: '#91a096' }}>one active renderer at a time · generated voxel terrain · live host update cadence</Text>
        </Col>
        <Row style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Button label="Effect" active={mode === 'effect'} onPress={() => setMode('effect')} />
          <Button label="Scene3D" active={mode === 'scene3d'} onPress={() => setMode('scene3d')} />
          {PROFILES.map((p) => (
            <Button key={p.label} label={p.label} active={profile.radius === p.radius} onPress={() => setProfile(p)} />
          ))}
          <Button label={running ? 'Pause' : 'Run'} active={running} onPress={() => setRunning((v) => !v)} />
        </Row>
      </Row>

      <Row style={{ gap: 14 }}>
        <Metric label="renderer" value={mode === 'effect' ? 'Effect polygons' : 'Scene3D instances'} />
        <Metric label="update" value={`${stats.fps.toFixed(1)} hz`} sub={`${stats.ms.toFixed(1)} ms`} />
        <Metric label="blocks" value={String(blocks.length)} />
        <Metric label="faces" value={mode === 'effect' ? `${effectFaces.length}/${facesAll.length}` : String(facesAll.length)} sub={mode === 'effect' ? `${visibleFaceRatio}% cap` : 'hardware depth'} />
        <Metric label="work" value={mode === 'effect' ? `${pixelFaceTests}M tests` : `${batchCount} batches`} sub={mode === 'effect' ? 'per frame est.' : `${blocks.length} instances`} />
      </Row>

      <Box style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Col style={{ gap: 8 }}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'center', width: W }}>
            <Text style={{ fontSize: 14, color: '#f3f7f2', fontWeight: 'bold' }}>
              {mode === 'effect' ? 'Effect Polygon Pass' : 'Scene3D Instanced Cubes'}
            </Text>
            <Text style={{ fontSize: 12, color: '#98a49d' }}>
              {mode === 'effect'
                ? `${effectFaces.length} projected quads · one Effect node`
                : `${blocks.length} cubes · ${batchCount} instance batches`}
            </Text>
          </Row>
          <Box style={{ width: W, height: H, borderWidth: 1, borderColor: '#27302b', backgroundColor: '#0e1412' }}>
            {mode === 'effect'
              ? <Effect shader={SHADER} data={effectData} style={{ width: W, height: H }} />
              : <Scene3DCompare blocks={blocks} yaw={yaw} pitch={pitch} dist={dist} center={c} />}
          </Box>
        </Col>
      </Box>

      <Row style={{ gap: 14 }}>
        <Box style={{ flexGrow: 1, height: 46, borderRadius: 7, backgroundColor: '#101311', borderWidth: 1, borderColor: '#29302b', padding: 10 }}>
          <Text style={{ fontSize: 12, color: '#b8c5bd' }}>
            Effect mode is the PolyCSS-like stress case: project flat faces, test each face per pixel, and resolve depth manually in one shader.
          </Text>
        </Box>
        <Box style={{ flexGrow: 1, height: 46, borderRadius: 7, backgroundColor: '#101311', borderWidth: 1, borderColor: '#29302b', padding: 10 }}>
          <Text style={{ fontSize: 12, color: '#b8c5bd' }}>
            Scene3D mode is the native path: block positions are batched into a few instance buffers and visibility is handled by the GPU depth buffer.
          </Text>
        </Box>
      </Row>
    </Box>
  );
}
