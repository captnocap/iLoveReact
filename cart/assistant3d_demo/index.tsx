// assistant3d_demo — a hot 3D surface driven by the assistant.
//
// The loop this cart demonstrates:
//
//   1. You type a prompt into the chat on the left.
//   2. useAssistant (backend: 'claude_code') runs a real claude subprocess
//      in the repo cwd. It is instructed to WRITE the whole scene as JSON to
//      one fixed file — cart/assistant3d_demo/scene.json — and nothing else.
//   3. useFileWatch sees the file change, fs.readFile + JSON.parse rebuilds
//      the scene, and the center <Scene3D> surface hot-reloads it. No cart
//      rebuild, no bridge across the JS boundary for the geometry.
//   4. You click any mesh in the scene. A camera-ray pick (the inverse of the
//      active OrbitCamera, ray-vs-bounding-sphere) selects the nearest mesh,
//      and the right panel inspects its raw JSON, inspector-style.
//
// So the assistant authors the file; the hot surface captures it; you inspect
// the pieces. The scene file is the single source of truth — edit it by hand
// and the surface reloads just the same.
//
// ship: ./scripts/ship assistant3d_demo

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Row, Col, Text, Pressable, ScrollView, TextInput, Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import {
  OrbitCamera, solveCamera, CAMERAS,
  type Vec3, type Solved, type Rect,
} from '@reactjit/cameras';
import { useAssistant, type WorkerEvent } from '@reactjit/hooks/useAssistant';
import { useFileWatch, fs } from '@reactjit/hooks';
import { callHost, hasHost } from '@reactjit/ffi';

// ── palette ──────────────────────────────────────────────────────────────────
const PAGE = '#06080f';
const BAR = '#0e1320';
const FRAME = '#1c2435';
const PANEL = '#0b101b';
const INK = '#e7ecf6';
const DIM = '#8a93a8';
const ACCENT = '#ff9d3d';
const GOOD = '#7fdc8a';
const BAD = '#ff6b6b';

const MODEL = 'claude-opus-4-7';

// ── where the assistant writes, and where the surface reads ───────────────────
function processCwd(): string {
  if (hasHost('__cwd')) {
    try {
      const v = callHost<string>('__cwd', '');
      if (typeof v === 'string' && v.length > 0) return v;
    } catch { /* ignore */ }
  }
  return '/home/siah/creative/reactjit';
}

// ── scene model ───────────────────────────────────────────────────────────────
interface MeshSpec {
  id: string;
  geometry: string;                 // 'Box' | 'Sphere' | 'Cylinder' | 'Cone' | 'Torus' | 'Plane'
  params: Record<string, number>;
  material: string;                 // hex
  position: Vec3;
  rotation?: Vec3;                  // degrees
  scale?: number;
}
interface SceneSpec {
  background: string;
  meshes: MeshSpec[];
}

const EMPTY_SCENE: SceneSpec = { background: '#10131c', meshes: [] };

function parseScene(text: string): SceneSpec | null {
  try {
    const j = JSON.parse(text);
    if (!j || !Array.isArray(j.meshes)) return null;
    const meshes: MeshSpec[] = j.meshes
      .filter((m: any) => m && typeof m.geometry === 'string' && Geometry.GEOMETRIES[m.geometry])
      .map((m: any, i: number) => ({
        id: typeof m.id === 'string' && m.id ? m.id : `mesh-${i}`,
        geometry: m.geometry,
        params: (m.params && typeof m.params === 'object') ? m.params : {},
        material: typeof m.material === 'string' ? m.material : '#cccccc',
        position: Array.isArray(m.position) ? [Number(m.position[0]) || 0, Number(m.position[1]) || 0, Number(m.position[2]) || 0] : [0, 0, 0],
        rotation: Array.isArray(m.rotation) ? [Number(m.rotation[0]) || 0, Number(m.rotation[1]) || 0, Number(m.rotation[2]) || 0] : [0, 0, 0],
        scale: Number.isFinite(m.scale) ? Number(m.scale) : 1,
      }));
    return { background: typeof j.background === 'string' ? j.background : '#10131c', meshes };
  } catch {
    return null;
  }
}

// ── picking: invert the active camera, ray-vs-bounding-sphere ─────────────────
// boundingRadius mirrors the geometry generators closely enough to give a tight
// enclosing sphere — picking is click-rate, so it only needs to be the right
// order of selection, not pixel-exact.
function boundingRadius(geometry: string, p: Record<string, number>): number {
  switch (geometry) {
    case 'Sphere': return p.radius ?? 0.5;
    case 'Box': return 0.5 * Math.hypot(p.width ?? 1, p.height ?? 1, p.depth ?? 1);
    case 'Cylinder':
    case 'Cone': return Math.hypot(p.radius ?? 0.5, (p.height ?? 1) / 2);
    case 'Torus': return (p.radius ?? 0.5) + (p.tube ?? 0.2);
    case 'Plane': return 0.5 * Math.hypot(p.width ?? 1, p.height ?? 1);
    default: return 0.6;
  }
}

// Reconstructs the exact view basis framework m4lookAt builds (same math as
// @reactjit/cameras unprojectGround) and returns the world-space pick ray.
function screenRay(sx: number, sy: number, rect: Rect, cam: Solved): { o: Vec3; d: Vec3 } {
  const { pos, target, fov } = cam;
  let fx = pos[0] - target[0], fy = pos[1] - target[1], fz = pos[2] - target[2];
  const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
  let sxv = fz, syv = 0, szv = -fx;            // s = up × f, up = (0,1,0)
  const sl = Math.hypot(sxv, syv, szv) || 1; sxv /= sl; syv /= sl; szv /= sl;
  const ux = fy * szv - fz * syv;              // u = f × s
  const uy = fz * sxv - fx * szv;
  const uz = fx * syv - fy * sxv;
  const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
  const tanHalf = Math.tan((fov * Math.PI) / 180 / 2);
  const ndcX = (sx / w) * 2 - 1, ndcY = 1 - (sy / h) * 2;
  const vx = ndcX * tanHalf * (w / h), vy = ndcY * tanHalf, vz = -1;
  let dx = vx * sxv + vy * ux + vz * fx;
  let dy = vx * syv + vy * uy + vz * fy;
  let dz = vx * szv + vy * uz + vz * fz;
  const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
  return { o: pos, d: [dx, dy, dz] };
}

function pickMesh(sx: number, sy: number, rect: Rect, cam: Solved, meshes: MeshSpec[]): number {
  const { o, d } = screenRay(sx, sy, rect, cam);
  let best = -1, bestT = Infinity;
  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    const sc = m.scale ?? 1;
    const R = boundingRadius(m.geometry, m.params) * sc;
    const ox = o[0] - m.position[0], oy = o[1] - m.position[1], oz = o[2] - m.position[2];
    const b = ox * d[0] + oy * d[1] + oz * d[2];
    const c = ox * ox + oy * oy + oz * oz - R * R;
    const disc = b * b - c;
    if (disc < 0) continue;
    const root = Math.sqrt(disc);
    const t0 = -b - root, t1 = -b + root;
    const t = t0 > 0 ? t0 : (t1 > 0 ? t1 : -1);
    if (t > 0 && t < bestT) { bestT = t; best = i; }
  }
  return best;
}

// ── assistant directive ───────────────────────────────────────────────────────
// claude_code has no system-prompt opt, so we hand the model the contract in the
// first turn. The session persists, so later turns only carry the request plus a
// one-line reminder of where to write.
function buildPreamble(scenePath: string): string {
  return [
    'You drive a live, hot-reloaded 3D viewer by writing ONE file.',
    `Whenever I ask for a scene or an edit, OVERWRITE this exact file with the full scene as JSON (use your Write tool, replace the entire file): ${scenePath}`,
    '',
    'Schema:',
    '{',
    '  "background": "#rrggbb",',
    '  "meshes": [',
    '    { "id": "short-lowercase-name", "geometry": "Box|Sphere|Cylinder|Cone|Torus|Plane",',
    '      "params": { ... }, "material": "#rrggbb",',
    '      "position": [x, y, z], "rotation": [degX, degY, degZ] }',
    '  ]',
    '}',
    '',
    'Params by geometry:',
    '  Box: {width,height,depth}   Sphere: {radius}   Cylinder/Cone: {radius,height}',
    '  Torus: {radius,tube}        Plane: {width,height}',
    '',
    'Rules: +Y is up, 1 unit = 1 meter. The first mesh is always a thin Box ground slab.',
    'Keep objects within a ~20x20 ground area, resting on or above y=0. Use 5-25 meshes so',
    'the result is recognizable. Give every mesh a unique descriptive id and a tasteful hex',
    'color. Do NOT print the JSON in chat — just write the file and end with a one-line summary.',
  ].join('\n');
}

// ── compact transcript line ───────────────────────────────────────────────────
function eventLine(ev: WorkerEvent): { tag: string; text: string; color: string } | null {
  if (ev.kind === 'user_message') return { tag: 'you', text: ev.text ?? '', color: INK };
  if (ev.kind === 'assistant_message') return { tag: 'claude', text: ev.text ?? '', color: '#bcd0ff' };
  if (ev.kind === 'tool_call') return { tag: 'tool', text: ev.text || ev.status_text || 'writing scene…', color: ACCENT };
  if (ev.kind === 'error_') return { tag: 'error', text: ev.text || ev.status_text || 'error', color: BAD };
  if (ev.kind === 'completion') return { tag: 'done', text: '— turn complete —', color: DIM };
  return null;
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

// ── the cart ──────────────────────────────────────────────────────────────────
export default function Assistant3DDemo() {
  const cwd = useMemo(processCwd, []);
  const scenePath = useMemo(() => `${cwd}/cart/assistant3d_demo/scene.json`, [cwd]);

  // ── 3D scene state (hot-loaded from disk) ──
  const [scene, setScene] = useState<SceneSpec>(EMPTY_SCENE);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  const loadScene = () => {
    const text = fs.readFile(scenePath);
    if (text == null) { setLoadErr('scene.json not found'); return; }
    const parsed = parseScene(text);
    if (!parsed) { setLoadErr('scene.json failed to parse (mid-write?)'); return; }
    setLoadErr(null);
    setScene(parsed);
    setReloads((n) => n + 1);
    setSelected((cur) => (cur != null && cur < parsed.meshes.length ? cur : null));
  };

  // initial load + watch the file the assistant writes
  useEffect(() => { loadScene(); /* eslint-disable-line */ }, [scenePath]);
  useFileWatch(scenePath, (e) => { if (e.type !== 'deleted') loadScene(); });

  // ── camera (orbit; drag to turn, tap to pick) ──
  const [yaw, setYaw] = useState(38);
  const [pitch, setPitch] = useState(28);
  const [dist, setDist] = useState(12);
  const orbitParams = useMemo(() => ({ target: [0, 1, 0] as Vec3, yaw, pitch, dist, zoom: 1, fov: 52 }), [yaw, pitch, dist]);

  const rectRef = useRef<Rect>({ x: 0, y: 0, width: 800, height: 700 });
  const dragRef = useRef<{ x: number; y: number; dist: number } | null>(null);

  // ── selection ──
  const [selected, setSelected] = useState<number | null>(null);
  const selMesh = selected != null ? scene.meshes[selected] : null;

  const onDown = (e: any) => { dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0), dist: 0 }; };
  const onMove = (e: any) => {
    const d = dragRef.current; if (!d) return;
    const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
    const dx = nx - d.x, dy = ny - d.y;
    d.dist += Math.abs(dx) + Math.abs(dy); d.x = nx; d.y = ny;
    setYaw((v) => v + dx * 0.4);
    setPitch((v) => Math.max(6, Math.min(85, v - dy * 0.3)));
  };
  const onUp = (e: any) => {
    const d = dragRef.current; dragRef.current = null;
    if (!d || d.dist >= 6) return;                       // a drag, not a tap
    const r = rectRef.current;
    const sx = Number(e?.x ?? 0) - r.x, sy = Number(e?.y ?? 0) - r.y;
    const solved = solveCamera(CAMERAS.Orbit, orbitParams);
    const hit = pickMesh(sx, sy, r, solved, scene.meshes);
    setSelected(hit >= 0 ? hit : null);
  };
  const onWheel = (e: any) => {
    const dy = Number(e?.deltaY ?? e?.dy ?? 0);
    setDist((v) => Math.max(3, Math.min(40, v + (dy > 0 ? 1 : -1) * 1.1)));
  };

  // ── assistant (real claude, writes scenePath) ──
  const assistant = useAssistant({ backend: 'claude_code', cwd, model: MODEL, persistAcrossUnmount: true });
  const sentPreambleRef = useRef(false);
  const [input, setInput] = useState('');
  const inputRef = useRef(''); inputRef.current = input;

  const submit = () => {
    const text = inputRef.current.trim();
    if (!text) return;
    const msg = sentPreambleRef.current
      ? `${text}\n\n(Overwrite the whole scene file at ${scenePath}.)`
      : `${buildPreamble(scenePath)}\n\nRequest: ${text}`;
    if (!assistant.ask(msg)) return;
    sentPreambleRef.current = true;
    setInput('');
  };

  const transcript = useMemo(
    () => assistant.events.map(eventLine).filter(Boolean) as { tag: string; text: string; color: string }[],
    [assistant.events],
  );
  const transcriptRef = useRef<any>(null);
  useEffect(() => { try { transcriptRef.current?.scrollToEnd?.(); } catch { /* ignore */ } }, [transcript.length]);

  const phaseColor = assistant.error ? BAD
    : assistant.phase === 'streaming' ? ACCENT
    : assistant.phase === 'idle' ? GOOD : DIM;

  // ── base scene meshes — memoized on `scene` so orbiting the camera never
  //    re-ships vertices across the bridge (camera_lab's lesson). ──
  const sceneMeshes = useMemo(() => scene.meshes.map((m, i) => (
    <Scene3D.Mesh
      key={m.id + '#' + i}
      geometry={Geometry.GEOMETRIES[m.geometry]}
      params={m.params}
      material={m.material}
      position={m.position}
      rotation={m.rotation ?? [0, 0, 0]}
      scale={m.scale ?? 1}
    />
  )), [scene]);

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: PAGE, flexDirection: 'column' }}>
      {/* header */}
      <Row style={{ backgroundColor: BAR, borderColor: FRAME, borderBottomWidth: 1, paddingTop: 10, paddingBottom: 10, paddingLeft: 14, paddingRight: 14, gap: 12, alignItems: 'baseline' }}>
        <Text fontSize={15} color={INK} style={{ fontWeight: 'bold', letterSpacing: 0.6 }}>ASSISTANT 3D</Text>
        <Text fontSize={11} color={DIM}>prompt → assistant writes scene.json → hot surface reloads → click any piece to inspect</Text>
        <Box style={{ flexGrow: 1 }} />
        <Text fontSize={11} color={loadErr ? BAD : GOOD} style={{ fontFamily: 'mono' }}>
          {loadErr ? `⚠ ${loadErr}` : `● ${scene.meshes.length} meshes · reload #${reloads}`}
        </Text>
      </Row>

      <Row style={{ flexGrow: 1, minHeight: 0 }}>
        {/* ── LEFT: chat ───────────────────────────────────────────────── */}
        <Col style={{ width: 320, backgroundColor: PANEL, borderColor: FRAME, borderRightWidth: 1, minHeight: 0 }}>
          <Row style={{ paddingTop: 8, paddingBottom: 8, paddingLeft: 12, paddingRight: 12, borderColor: FRAME, borderBottomWidth: 1, gap: 8, alignItems: 'baseline' }}>
            <Text fontSize={12} color={INK} style={{ fontWeight: 'bold' }}>assistant</Text>
            <Text fontSize={10} color={phaseColor} style={{ fontFamily: 'mono' }}>{assistant.phase}</Text>
            <Box style={{ flexGrow: 1 }} />
            <Text fontSize={10} color={DIM} style={{ fontFamily: 'mono' }}>{MODEL}</Text>
          </Row>

          <ScrollView ref={transcriptRef} style={{ flexGrow: 1, minHeight: 0, paddingTop: 8, paddingBottom: 8, paddingLeft: 12, paddingRight: 12 }}>
            {transcript.length === 0 ? (
              <Col style={{ gap: 6 }}>
                <Text fontSize={12} color={DIM}>Ask for a 3D scene. Examples:</Text>
                {['a small wooden cabin with a red roof', 'a snowman next to a pine tree', 'a tiny rocket on a launch pad', 'a park bench under a lamppost'].map((ex) => (
                  <Pressable key={ex} onPress={() => setInput(ex)} style={{ paddingTop: 5, paddingBottom: 5, paddingLeft: 8, paddingRight: 8, borderRadius: 6, borderWidth: 1, borderColor: FRAME, backgroundColor: '#121a2a' }}>
                    <Text fontSize={11} color={'#bcd0ff'}>{ex}</Text>
                  </Pressable>
                ))}
              </Col>
            ) : (
              <Col style={{ gap: 8 }}>
                {transcript.map((l, i) => (
                  <Col key={i} style={{ gap: 2 }}>
                    <Text fontSize={9} color={l.color} style={{ fontFamily: 'mono', letterSpacing: 0.5 }}>{l.tag.toUpperCase()}</Text>
                    <Text fontSize={11} color={l.tag === 'you' ? INK : DIM}>{l.text}</Text>
                  </Col>
                ))}
              </Col>
            )}
          </ScrollView>

          <Col style={{ padding: 10, gap: 8, borderColor: FRAME, borderTopWidth: 1 }}>
            <Box style={{ backgroundColor: '#0e1116', borderColor: FRAME, borderWidth: 1, borderRadius: 6, paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 6 }}>
              <TextInput
                value={input}
                onChangeText={setInput}
                onSubmitEditing={submit}
                placeholder="describe a 3D scene…"
                style={{ color: INK, fontSize: 12 }}
              />
            </Box>
            <Pressable onPress={submit} style={{ paddingTop: 7, paddingBottom: 7, borderRadius: 6, alignItems: 'center', backgroundColor: assistant.phase === 'streaming' ? '#2a1d10' : '#16263c', borderWidth: 1, borderColor: assistant.phase === 'streaming' ? ACCENT : FRAME }}>
              <Text fontSize={12} color={assistant.phase === 'streaming' ? ACCENT : INK} style={{ fontWeight: 'bold' }}>
                {assistant.phase === 'streaming' ? 'generating…' : 'generate scene'}
              </Text>
            </Pressable>
            {assistant.error ? <Text fontSize={10} color={BAD}>{assistant.error}</Text> : null}
          </Col>
        </Col>

        {/* ── CENTER: hot 3D surface ───────────────────────────────────── */}
        <Pressable
          onLayout={(lr: any) => { rectRef.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onWheel={onWheel}
          style={{ flexGrow: 1, position: 'relative', overflow: 'hidden' }}
        >
          <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={scene.background} showGrid={true} showAxes={false}>
            <OrbitCamera {...orbitParams} />
            <Scene3D.AmbientLight color="#5b6488" intensity={0.7} />
            <Scene3D.DirectionalLight direction={[0.5, 0.9, 0.35]} color="#ffd9a8" intensity={0.9} />
            <Scene3D.PointLight position={[-7, 6, -4]} color="#39d6ff" intensity={0.3} />
            {sceneMeshes}
            {/* selection highlight — a translucent oversize copy, rendered OUTSIDE
                the memo so picking never invalidates the base scene's vertices */}
            {selMesh ? (
              <Scene3D.Mesh
                geometry={Geometry.GEOMETRIES[selMesh.geometry]}
                params={selMesh.params}
                material={{ color: ACCENT, opacity: 0.28 }}
                position={selMesh.position}
                rotation={selMesh.rotation ?? [0, 0, 0]}
                scale={(selMesh.scale ?? 1) * 1.12}
              />
            ) : null}
          </Scene3D>

          {/* surface hint */}
          <Box style={{ position: 'absolute', left: 12, bottom: 10 }}>
            <Text fontSize={10} color={DIM} style={{ fontFamily: 'mono' }}>drag orbit · wheel zoom · click a mesh to inspect</Text>
          </Box>
        </Pressable>

        {/* ── RIGHT: inspector ─────────────────────────────────────────── */}
        <Col style={{ width: 280, backgroundColor: PANEL, borderColor: FRAME, borderLeftWidth: 1, minHeight: 0 }}>
          <Row style={{ paddingTop: 8, paddingBottom: 8, paddingLeft: 12, paddingRight: 12, borderColor: FRAME, borderBottomWidth: 1, alignItems: 'baseline', gap: 8 }}>
            <Text fontSize={12} color={INK} style={{ fontWeight: 'bold' }}>inspector</Text>
            <Box style={{ flexGrow: 1 }} />
            <Text fontSize={10} color={DIM} style={{ fontFamily: 'mono' }}>{selMesh ? `#${selected}` : '—'}</Text>
          </Row>

          <ScrollView style={{ flexGrow: 1, minHeight: 0, paddingTop: 10, paddingBottom: 10, paddingLeft: 12, paddingRight: 12 }}>
            {!selMesh ? (
              <Text fontSize={11} color={DIM}>Click a mesh in the scene to inspect its geometry, material, and transform.</Text>
            ) : (
              <Col style={{ gap: 12 }}>
                <Row style={{ gap: 8, alignItems: 'center' }}>
                  <Box style={{ width: 18, height: 18, borderRadius: 4, backgroundColor: selMesh.material, borderWidth: 1, borderColor: FRAME }} />
                  <Text fontSize={14} color={INK} style={{ fontWeight: 'bold' }}>{selMesh.id}</Text>
                </Row>
                <InspectRow label="geometry" value={selMesh.geometry} />
                <InspectRow label="material" value={selMesh.material} mono />
                <InspectRow label="position" value={`[${selMesh.position.map((n) => round(n)).join(', ')}]`} mono />
                {selMesh.rotation && (selMesh.rotation[0] || selMesh.rotation[1] || selMesh.rotation[2])
                  ? <InspectRow label="rotation°" value={`[${selMesh.rotation.map((n) => round(n)).join(', ')}]`} mono /> : null}
                {selMesh.scale && selMesh.scale !== 1 ? <InspectRow label="scale" value={String(round(selMesh.scale))} mono /> : null}
                <Col style={{ gap: 4 }}>
                  <Text fontSize={9} color={DIM} style={{ fontFamily: 'mono', letterSpacing: 0.5 }}>PARAMS</Text>
                  {Object.keys(selMesh.params).length === 0
                    ? <Text fontSize={11} color={DIM}>(defaults)</Text>
                    : Object.entries(selMesh.params).map(([k, v]) => <InspectRow key={k} label={k} value={String(round(Number(v)))} mono />)}
                </Col>
                <Box style={{ height: 1, backgroundColor: FRAME }} />
                <Text fontSize={9} color={DIM} style={{ fontFamily: 'mono' }}>raw</Text>
                <Box style={{ backgroundColor: '#0a0d14', borderRadius: 6, borderWidth: 1, borderColor: FRAME, padding: 8 }}>
                  <Text fontSize={10} color={'#9fb3d6'} style={{ fontFamily: 'mono' }}>{JSON.stringify(selMesh, null, 2)}</Text>
                </Box>
              </Col>
            )}
          </ScrollView>

          <Col style={{ padding: 10, gap: 4, borderColor: FRAME, borderTopWidth: 1 }}>
            <Text fontSize={9} color={DIM} style={{ fontFamily: 'mono' }}>watching</Text>
            <Text fontSize={9} color={DIM} style={{ fontFamily: 'mono' }}>cart/assistant3d_demo/scene.json</Text>
          </Col>
        </Col>
      </Row>
    </Box>
  );
}

function round(n: number): number { return Math.round(n * 1000) / 1000; }

function InspectRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
      <Text fontSize={11} color={DIM}>{label}</Text>
      <Text fontSize={11} color={INK} style={mono ? { fontFamily: 'mono' } : undefined}>{value}</Text>
    </Row>
  );
}
