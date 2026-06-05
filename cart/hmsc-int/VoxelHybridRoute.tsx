import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Col, Pressable, Row, Scene3D, Text } from '@reactjit/primitives';
import { Icon } from '@reactjit/icons/Icon';
import * as Geometry from '@reactjit/geometries';
import { mkdir, writeFile } from '@reactjit/hooks/fs';
import { GAME_CAMERA, GAME_NATIVE_CAMERA } from './game';

type Vec3 = [number, number, number];
type Rect = { x: number; y: number; width: number; height: number };
type Kind = 'floor' | 'wall' | 'glass' | 'trim';
type Tool = 'build' | 'mine';

type Dims = {
  w: number;
  d: number;
  h: number;
};

type Block = {
  id: number;
  x: number;
  y: number;
  z: number;
  kind: Kind;
  locked?: boolean;
};

type FaceGroup = {
  id: string;
  face: Face;
  kind: Kind;
  plane: number;
  cells: { x: number; y: number; z: number; u: number; v: number }[];
  bounds: { u0: number; v0: number; u1: number; v1: number };
};

type Face = {
  key: string;
  label: string;
  dx: number;
  dy: number;
  dz: number;
};

const KINDS: Record<Kind, { label: string; color: string; opacity?: number }> = {
  floor: { label: 'Floor', color: '#6f6652' },
  wall: { label: 'Wall', color: '#9ca3af' },
  glass: { label: 'Glass', color: '#4fc3df', opacity: 0.48 },
  trim: { label: 'Trim', color: '#d8b56a' },
};

const PALETTE: Kind[] = ['wall', 'glass', 'trim', 'floor'];
const VIEW = {
  yawPerPixel: 0.4,
  pitchPerPixel: 0.3,
  minPitch: 7,
  maxPitch: 84,
  fov: 48,
  minDistance: 6,
  maxDistance: 34,
  zoomStep: 1.1,
  boot: { yaw: 38, pitch: 31, distance: 14 },
} as const;
const FACES: Face[] = [
  { key: 'xp', label: '+X', dx: 1, dy: 0, dz: 0 },
  { key: 'xn', label: '-X', dx: -1, dy: 0, dz: 0 },
  { key: 'yp', label: '+Y', dx: 0, dy: 1, dz: 0 },
  { key: 'yn', label: '-Y', dx: 0, dy: -1, dz: 0 },
  { key: 'zp', label: '+Z', dx: 0, dy: 0, dz: 1 },
  { key: 'zn', label: '-Z', dx: 0, dy: 0, dz: -1 },
];

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function coordKey(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`;
}

function hexRgb(hex: string): [number, number, number] {
  const s = hex.startsWith('#') ? hex.slice(1) : hex;
  const n = parseInt(s, 16);
  if (!Number.isFinite(n)) return [0.8, 0.8, 0.8];
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

function faceByDelta(dx: number, dy: number, dz: number): Face {
  return FACES.find((f) => f.dx === dx && f.dy === dy && f.dz === dz) ?? FACES[2];
}

function addFace(b: Block, f: Face): { x: number; y: number; z: number } {
  return { x: b.x + f.dx, y: b.y + f.dy, z: b.z + f.dz };
}

function inBounds(p: { x: number; y: number; z: number }, dims: Dims): boolean {
  return p.x >= 0 && p.x < dims.w && p.z >= 0 && p.z < dims.d && p.y >= 0 && p.y <= dims.h;
}

function makeFloor(dims: Dims): Block[] {
  const blocks: Block[] = [];
  let id = 1;
  for (let z = 0; z < dims.d; z++) {
    for (let x = 0; x < dims.w; x++) blocks.push({ id: id++, x, y: 0, z, kind: 'floor', locked: true });
  }
  return blocks;
}

function fitBlocks(blocks: Block[], dims: Dims): Block[] {
  return blocks.filter((b) => b.locked || inBounds(b, dims));
}

function facePlane(block: Block, face: Face): number {
  if (face.dx > 0) return block.x + 1;
  if (face.dx < 0) return block.x;
  if (face.dy > 0) return block.y + 1;
  if (face.dy < 0) return block.y;
  if (face.dz > 0) return block.z + 1;
  return block.z;
}

function faceUv(block: Block, face: Face): { u: number; v: number } {
  if (face.dx !== 0) return { u: block.z, v: block.y };
  if (face.dy !== 0) return { u: block.x, v: block.z };
  return { u: block.x, v: block.y };
}

function detectFaceGroups(blocks: Block[]): FaceGroup[] {
  const occupied = new Set(blocks.map((b) => coordKey(b.x, b.y, b.z)));
  const buckets = new Map<string, { block: Block; face: Face; u: number; v: number; plane: number }[]>();
  for (const block of blocks) {
    for (const face of FACES) {
      if (occupied.has(coordKey(block.x + face.dx, block.y + face.dy, block.z + face.dz))) continue;
      const plane = facePlane(block, face);
      const { u, v } = faceUv(block, face);
      const key = `${face.key}:${block.kind}:${plane}`;
      const arr = buckets.get(key) ?? [];
      arr.push({ block, face, u, v, plane });
      buckets.set(key, arr);
    }
  }

  const groups: FaceGroup[] = [];
  for (const [, items] of buckets) {
    const pending = new Map(items.map((it) => [`${it.u}:${it.v}`, it]));
    while (pending.size) {
      const firstKey = pending.keys().next().value as string;
      const first = pending.get(firstKey)!;
      pending.delete(firstKey);
      const stack = [first];
      const cells: FaceGroup['cells'] = [];
      let u0 = first.u, u1 = first.u, v0 = first.v, v1 = first.v;
      while (stack.length) {
        const cur = stack.pop()!;
        cells.push({ x: cur.block.x, y: cur.block.y, z: cur.block.z, u: cur.u, v: cur.v });
        u0 = Math.min(u0, cur.u); u1 = Math.max(u1, cur.u);
        v0 = Math.min(v0, cur.v); v1 = Math.max(v1, cur.v);
        for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nk = `${cur.u + du}:${cur.v + dv}`;
          const next = pending.get(nk);
          if (!next) continue;
          pending.delete(nk);
          stack.push(next);
        }
      }
      const id = `${first.face.key}_${first.block.kind}_${first.plane}_${groups.length}`;
      groups.push({ id, face: first.face, kind: first.block.kind, plane: first.plane, cells, bounds: { u0, v0, u1: u1 + 1, v1: v1 + 1 } });
    }
  }
  return groups.sort((a, b) => b.cells.length - a.cells.length || a.id.localeCompare(b.id));
}

function rayBlockFace(o: Vec3, d: Vec3, block: Block): { t: number; face: Face } | null {
  const c: Vec3 = [block.x, block.y, block.z];
  let tmin = -Infinity;
  let tmax = Infinity;
  let enter: Face = FACES[2];
  let exit: Face = FACES[3];
  for (let a = 0; a < 3; a++) {
    const lo = c[a] - 0.5;
    const hi = c[a] + 0.5;
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < lo || o[a] > hi) return null;
      continue;
    }
    const axisFace = (sign: number): Face => {
      if (a === 0) return faceByDelta(sign, 0, 0);
      if (a === 1) return faceByDelta(0, sign, 0);
      return faceByDelta(0, 0, sign);
    };
    const near = d[a] > 0 ? { t: (lo - o[a]) / d[a], face: axisFace(-1) } : { t: (hi - o[a]) / d[a], face: axisFace(1) };
    const far = d[a] > 0 ? { t: (hi - o[a]) / d[a], face: axisFace(1) } : { t: (lo - o[a]) / d[a], face: axisFace(-1) };
    if (near.t > tmin) { tmin = near.t; enter = near.face; }
    if (far.t < tmax) { tmax = far.t; exit = far.face; }
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return tmin > 0 ? { t: tmin, face: enter } : { t: tmax, face: exit };
}

function pickBlockFace(sx: number, sy: number, rect: Rect, cam: { pos: Vec3; target: Vec3; fov: number }, blocks: Block[]): { block: Block; face: Face } | null {
  // the registry's pixel->ray inverse (R7) — this file carried its own copy before
  const { origin: o, dir: d } = GAME_CAMERA.screenRay(sx, sy, rect, cam);
  let best: { block: Block; face: Face; t: number } | null = null;
  for (const block of blocks) {
    const hit = rayBlockFace(o, d, block);
    if (hit && hit.t > 0 && (!best || hit.t < best.t)) best = { block, face: hit.face, t: hit.t };
  }
  return best ? { block: best.block, face: best.face } : null;
}

function Stepper(props: { label: string; value: number; min: number; max: number; onValue: (v: number) => void }) {
  return (
    <Row style={{ alignItems: 'center', gap: 6 }}>
      <Text fontSize={10} color="#64748b" style={{ width: 16, fontFamily: 'monospace', fontWeight: 900 }}>{props.label}</Text>
      <Pressable onPress={() => props.onValue(clamp(props.value - 1, props.min, props.max))} style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 5, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f1a2e' }}>
        <Icon name="Minus" size={12} color="#cbd5e1" />
      </Pressable>
      <Box style={{ width: 36, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 5, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f1a2e' }}>
        <Text fontSize={11} color="#e2e8f0" style={{ fontFamily: 'monospace', fontWeight: 900 }}>{props.value}</Text>
      </Box>
      <Pressable onPress={() => props.onValue(clamp(props.value + 1, props.min, props.max))} style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 5, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f1a2e' }}>
        <Icon name="Plus" size={12} color="#cbd5e1" />
      </Pressable>
    </Row>
  );
}

function ToolButton(props: { label: string; icon: string; active?: boolean; danger?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={{ flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 8, paddingBottom: 8, borderRadius: 6, borderWidth: 1, borderColor: props.active ? '#dbeafe' : (props.danger ? '#5f2d2d' : '#334155'), backgroundColor: props.active ? '#1d3347' : (props.danger ? '#2a1212' : '#0f1a2e') }}>
      <Icon name={props.icon} size={14} color={props.danger ? '#fca5a5' : (props.active ? '#bae6fd' : '#cbd5e1')} />
      <Text fontSize={11} color={props.danger ? '#fecaca' : (props.active ? '#f8fafc' : '#cbd5e1')} style={{ fontWeight: 900 }}>{props.label}</Text>
    </Pressable>
  );
}

function FaceHandle(props: { selected: Block; face: Face; active: boolean; color: string; tool: Tool }) {
  const f = props.face;
  const pos: Vec3 = [props.selected.x + f.dx * 0.56, props.selected.y + f.dy * 0.56, props.selected.z + f.dz * 0.56];
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      params={{ width: f.dx !== 0 ? 0.08 : 0.44, height: f.dy !== 0 ? 0.08 : 0.44, depth: f.dz !== 0 ? 0.08 : 0.44 }}
      material={{ color: props.active ? (props.tool === 'mine' ? '#ff355e' : props.color) : '#f8fafc', opacity: props.active ? 0.72 : 0.18 }}
      position={pos}
    />
  );
}

function GroupFaceOverlay(props: { group: FaceGroup }) {
  const f = props.group.face;
  return (
    <>
      {props.group.cells.map((cell, i) => {
        const pos: Vec3 = [
          cell.x + f.dx * 0.515,
          cell.y + f.dy * 0.515,
          cell.z + f.dz * 0.515,
        ];
        return (
          <Scene3D.Mesh
            key={`${props.group.id}_${i}`}
            geometry={Geometry.Box}
            params={{ width: f.dx !== 0 ? 0.045 : 0.86, height: f.dy !== 0 ? 0.045 : 0.86, depth: f.dz !== 0 ? 0.045 : 0.86 }}
            material={{ color: '#facc15', opacity: 0.34 }}
            position={pos}
          />
        );
      })}
    </>
  );
}

function VoxelScene(props: {
  dims: Dims;
  blocks: Block[];
  selected: Block;
  activeKind: Kind;
  activeFace: Face;
  activeGroup?: FaceGroup | null;
  tool: Tool;
  onFaceClick: (block: Block, face: Face) => void;
  onMiss: () => void;
}) {
  const lookRef = useRef({ yaw: VIEW.boot.yaw, pitch: VIEW.boot.pitch });
  const distRef = useRef(VIEW.boot.distance);
  const cameraRef = useRef<any>(null);
  const cameraCtlRef = useRef<ReturnType<typeof GAME_NATIVE_CAMERA.forNode> | null>(null);
  const rectRef = useRef<Rect>({ x: 0, y: 0, width: 1000, height: 700 });
  const dragRef = useRef<{ x: number; y: number; dist: number } | null>(null);

  const target: Vec3 = [(props.dims.w - 1) / 2, clamp(props.dims.h / 2, 1.2, 5), (props.dims.d - 1) / 2];
  const solveShadow = (t: Vec3, look = lookRef.current, distance = distRef.current) =>
    GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, { target: t, yaw: look.yaw, pitch: look.pitch, dist: distance, zoom: 1, fov: VIEW.fov });
  const shadowCamRef = useRef(solveShadow(target));
  const [bootCam] = useState(() => shadowCamRef.current);
  const sendOrbit = (t: Vec3, look = lookRef.current, distance = distRef.current) => {
    shadowCamRef.current = solveShadow(t, look, distance);
    cameraCtlRef.current?.setOrbit({ target: t, yaw: look.yaw, pitch: look.pitch, distance, fov: VIEW.fov, zoom: 1 });
  };
  useEffect(() => {
    const nodeId = Number(cameraRef.current?.id ?? 0);
    if (!nodeId) {
      console.warn('[voxels] native camera not engaged — camera node id unavailable');
      return;
    }
    const ctl = GAME_NATIVE_CAMERA.forNode(nodeId);
    cameraCtlRef.current = ctl;
    ctl.setOrbit({ target, yaw: lookRef.current.yaw, pitch: lookRef.current.pitch, distance: distRef.current, fov: VIEW.fov, zoom: 1 });
    ctl.setMode('orbit');
    return () => {
      cameraCtlRef.current = null;
      ctl.disable();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- engage once; target changes ride the effect below
  }, []);
  useEffect(() => { sendOrbit(target); }, [target[0], target[1], target[2]]);
  const occupied = new Set(props.blocks.map((b) => coordKey(b.x, b.y, b.z)));
  const previewPos = addFace(props.selected, props.activeFace);
  const previewOk = inBounds(previewPos, props.dims) && !occupied.has(coordKey(previewPos.x, previewPos.y, previewPos.z));
  const def = KINDS[props.activeKind];
  const batches = useMemo(() => PALETTE.map((kind) => {
    const d = KINDS[kind];
    const [r, g, b] = hexRgb(d.color);
    const data: number[] = [];
    for (const block of props.blocks) {
      if (block.kind === kind) data.push(block.x, block.y, block.z, 1, 1, 1, r, g, b);
    }
    return { kind, data, count: data.length / 9 };
  }).filter((b) => b.count > 0), [props.blocks]);

  const onDown = (e: any) => { dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0), dist: 0 }; };
  const onMove = (e: any) => {
    const d = dragRef.current;
    if (!d) return;
    const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
    const dx = nx - d.x, dy = ny - d.y;
    d.dist += Math.abs(dx) + Math.abs(dy);
    d.x = nx; d.y = ny;
    const l = lookRef.current;
    const nextYaw = l.yaw - dx * VIEW.yawPerPixel;
    const nextPitch = clamp(l.pitch - dy * VIEW.pitchPerPixel, VIEW.minPitch, VIEW.maxPitch);
    cameraCtlRef.current?.setInputDeltas(nextYaw - l.yaw, nextPitch - l.pitch);
    l.yaw = nextYaw;
    l.pitch = nextPitch;
    shadowCamRef.current = solveShadow(target);
  };
  const onUp = (e: any) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.dist >= 6) return;
    const r = rectRef.current;
    const sx = Number(e?.x ?? 0) - r.x;
    const sy = Number(e?.y ?? 0) - r.y;
    const hit = pickBlockFace(sx, sy, r, shadowCamRef.current, props.blocks);
    if (hit) props.onFaceClick(hit.block, hit.face);
    else props.onMiss();
  };
  const onWheel = (e: any) => {
    const dy = Number(e?.deltaY ?? e?.dy ?? 0);
    distRef.current = clamp(distRef.current + (dy > 0 ? 1 : -1) * VIEW.zoomStep, VIEW.minDistance, VIEW.maxDistance);
    sendOrbit(target);
  };

  return (
    <Pressable
      onLayout={(lr: any) => { rectRef.current = { x: Number(lr.x ?? 0), y: Number(lr.y ?? 0), width: Number(lr.width ?? 1000), height: Number(lr.height ?? 700) }; }}
      onMouseDown={onDown}
      onMouseMove={onMove}
      onMouseUp={onUp}
      onWheel={onWheel}
      style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}
    >
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#0a1018" showGrid={false} showAxes={false}>
        <Scene3D.Camera nativeCamera ref={cameraRef} position={bootCam.pos} target={bootCam.target} fov={bootCam.fov} far={120} />
        <Scene3D.Fog enabled={false} />
        <Scene3D.AmbientLight color="#d8e2ff" intensity={0.48} />
        <Scene3D.DirectionalLight direction={[0.45, 0.9, 0.36]} color="#ffe3a8" intensity={0.9} />
        <Scene3D.PointLight position={[0, props.dims.h + 4, 6]} color="#58d6ff" intensity={0.18} />
        <Scene3D.Mesh geometry={Geometry.Box} params={{ width: props.dims.w + 0.1, height: 0.04, depth: props.dims.d + 0.1 }} material="#182231" position={[(props.dims.w - 1) / 2, -0.54, (props.dims.d - 1) / 2]} />

        {batches.map((batch) => (
          <Scene3D.Instances key={batch.kind} geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} data={batch.data} count={batch.count} stride={9} center={[0, 0, 0]} boundsRadius={80} />
        ))}
        <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1.08, height: 1.08, depth: 1.08 }} material={{ color: props.tool === 'mine' ? '#ff355e' : '#f8fafc', opacity: 0.18 }} position={[props.selected.x, props.selected.y, props.selected.z]} />
        {FACES.map((face) => <FaceHandle key={face.key} selected={props.selected} face={face} active={face.key === props.activeFace.key} color={def.color} tool={props.tool} />)}
        {props.activeGroup ? <GroupFaceOverlay group={props.activeGroup} /> : null}
        {props.tool === 'build' ? <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 0.96, height: 0.96, depth: 0.96 }} material={{ color: previewOk ? def.color : '#ff355e', opacity: previewOk ? 0.38 : 0.24 }} position={[previewPos.x, previewPos.y, previewPos.z]} /> : null}
      </Scene3D>
    </Pressable>
  );
}

export function VoxelHybridRoute(props: { onExit: () => void }) {
  const [dims, setDims] = useState<Dims>({ w: 5, d: 6, h: 7 });
  const [custom, setCustom] = useState<Block[]>([]);
  const [selectedId, setSelectedId] = useState(1);
  const [activeKind, setActiveKind] = useState<Kind>('wall');
  const [activeFace, setActiveFace] = useState(FACES[2]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('build');
  const [status, setStatus] = useState('Click a floor top face to add a block');

  const floor = useMemo(() => makeFloor(dims), [dims]);
  const blocks = useMemo(() => [...floor, ...custom], [floor, custom]);
  const selected = blocks.find((b) => b.id === selectedId) ?? blocks[0];
  const occupied = useMemo(() => new Set(blocks.map((b) => coordKey(b.x, b.y, b.z))), [blocks]);
  const faceGroups = useMemo(() => detectFaceGroups(blocks), [blocks]);
  const selectedGroup = faceGroups.find((g) => g.id === selectedGroupId) ?? faceGroups[0] ?? null;
  const preview = selected ? addFace(selected, activeFace) : { x: 0, y: 1, z: 0 };
  const previewOk = selected ? inBounds(preview, dims) && !occupied.has(coordKey(preview.x, preview.y, preview.z)) : false;

  function updateDims(patch: Partial<Dims>) {
    const next = { ...dims, ...patch };
    setDims(next);
    setCustom((old) => fitBlocks(old, next));
    setSelectedId(1);
    setStatus('Resized');
  }

  function onFaceClick(block: Block, face: Face) {
    setSelectedId(block.id);
    setActiveFace(face);
    if (tool === 'mine') {
      if (block.locked) {
        setStatus('Floor is locked');
        return;
      }
      setCustom((old) => old.filter((b) => b.id !== block.id));
      setSelectedId(1);
      setStatus('Removed block');
      return;
    }

    const nextPos = addFace(block, face);
    const key = coordKey(nextPos.x, nextPos.y, nextPos.z);
    if (!inBounds(nextPos, dims)) {
      setStatus('Outside declared space');
      return;
    }
    if (occupied.has(key)) {
      const hit = blocks.find((b) => coordKey(b.x, b.y, b.z) === key);
      if (hit) setSelectedId(hit.id);
      setStatus('Occupied');
      return;
    }
    const nextId = Math.max(1000, ...custom.map((b) => b.id)) + 1;
    const nextBlock: Block = { id: nextId, ...nextPos, kind: activeKind };
    setCustom((old) => [...old, nextBlock]);
    setSelectedId(nextId);
    setStatus(`Added ${KINDS[activeKind].label}`);
  }

  function addPreview() {
    if (!selected || !previewOk) {
      setStatus(previewOk ? 'No selected block' : 'Preview blocked');
      return;
    }
    onFaceClick(selected, activeFace);
  }

  function clearCustom() {
    setCustom([]);
    setSelectedId(1);
    setActiveFace(FACES[2]);
    setTool('build');
    setStatus('Cleared');
  }

  function exportBlockout() {
    mkdir('cart/hmsc-int/exports');
    const payload = {
      schema: 'hmsc-int.voxel-blockout.v1',
      exportedAt: new Date().toISOString(),
      dims,
      blocks: custom.map((b) => ({ x: b.x, y: b.y, z: b.z, kind: b.kind })),
      artificialFloor: { y: 0, width: dims.w, depth: dims.d },
      faceGroups: faceGroups.map((g) => ({
        id: g.id,
        face: g.face.key,
        normal: { x: g.face.dx, y: g.face.dy, z: g.face.dz },
        kind: g.kind,
        plane: g.plane,
        bounds: g.bounds,
        cells: g.cells,
        textureKey: `${g.kind}/${g.face.key}/${g.id}`,
      })),
    };
    writeFile('cart/hmsc-int/exports/voxel-blockout.json', JSON.stringify(payload, null, 2));
    setStatus(`Exported ${faceGroups.length} face groups`);
  }

  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#070b12' }}>
      {selected ? <VoxelScene dims={dims} blocks={blocks} selected={selected} activeKind={activeKind} activeFace={activeFace} activeGroup={selectedGroup} tool={tool} onFaceClick={onFaceClick} onMiss={() => setStatus('Miss')} /> : null}

      <Col style={{ position: 'absolute', left: 12, top: 12, width: 326, gap: 10, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#27364a', backgroundColor: '#0b1320ee' }}>
        <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Text fontSize={17} color="#f8fafc" style={{ fontWeight: 900 }}>Voxel blockout</Text>
          <Text fontSize={10} color="#94a3b8" style={{ fontFamily: 'monospace' }}>{status}</Text>
        </Row>
        <Text fontSize={10} color="#94a3b8">Same interaction model as voxel_stack_demo: click a block face to build next to it.</Text>
        <Row style={{ gap: 8 }}>
          <Stepper label="W" value={dims.w} min={1} max={20} onValue={(w) => updateDims({ w })} />
          <Stepper label="D" value={dims.d} min={1} max={20} onValue={(d) => updateDims({ d })} />
        </Row>
        <Stepper label="H" value={dims.h} min={1} max={20} onValue={(h) => updateDims({ h })} />
        <Row style={{ gap: 6 }}>
          <ToolButton label="Build" icon="Plus" active={tool === 'build'} onPress={() => setTool('build')} />
          <ToolButton label="Mine" icon="Pickaxe" active={tool === 'mine'} onPress={() => setTool('mine')} />
          <ToolButton label="Clear" icon="Trash2" danger onPress={clearCustom} />
        </Row>
        <Row style={{ gap: 6, flexWrap: 'wrap' }}>
          {PALETTE.map((kind) => {
            const def = KINDS[kind];
            return (
              <Pressable key={kind} onPress={() => { setActiveKind(kind); setTool('build'); }} style={{ width: 68, height: 46, gap: 3, alignItems: 'center', justifyContent: 'center', borderRadius: 6, borderWidth: 1, borderColor: activeKind === kind ? '#f8fafc' : '#334155', backgroundColor: activeKind === kind ? '#1e293b' : '#0f1a2e' }}>
                <Box style={{ width: 18, height: 14, borderRadius: 3, backgroundColor: def.color, opacity: def.opacity ?? 1 }} />
                <Text fontSize={9} color="#cbd5e1" style={{ fontWeight: 800 }}>{def.label}</Text>
              </Pressable>
            );
          })}
        </Row>
        <ToolButton label="Add preview block" icon="Plus" active={previewOk} onPress={addPreview} />
      </Col>

      <Col style={{ position: 'absolute', right: 12, top: 12, width: 224, gap: 8, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#27364a', backgroundColor: '#0b1320ee' }}>
        <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Text fontSize={12} color="#f8fafc" style={{ fontWeight: 900 }}>Blocks</Text>
          <Text fontSize={11} color="#94a3b8" style={{ fontFamily: 'monospace' }}>{custom.length} custom</Text>
        </Row>
        <ToolButton label="Export JSON" icon="Download" active={false} onPress={exportBlockout} />
        {custom.slice().reverse().slice(0, 12).map((b) => (
          <Pressable key={b.id} onPress={() => { setSelectedId(b.id); setStatus(`Selected #${b.id}`); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, height: 30, paddingLeft: 7, paddingRight: 8, borderRadius: 5, borderWidth: 1, borderColor: selectedId === b.id ? '#e2e8f0' : '#334155', backgroundColor: selectedId === b.id ? '#1e293b' : '#0f1a2e' }}>
            <Box style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: KINDS[b.kind].color, opacity: KINDS[b.kind].opacity ?? 1 }} />
            <Text fontSize={10} color="#cbd5e1" style={{ fontFamily: 'monospace' }}>#{b.id}</Text>
            <Text fontSize={10} color="#94a3b8" style={{ flexGrow: 1 }}>{b.x},{b.y},{b.z}</Text>
          </Pressable>
        ))}
        <Box style={{ height: 1, backgroundColor: '#27364a', marginTop: 2, marginBottom: 2 }} />
        <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Text fontSize={12} color="#f8fafc" style={{ fontWeight: 900 }}>Face groups</Text>
          <Text fontSize={11} color="#94a3b8" style={{ fontFamily: 'monospace' }}>{faceGroups.length}</Text>
        </Row>
        {faceGroups.slice(0, 12).map((g) => (
          <Pressable key={g.id} onPress={() => { setSelectedGroupId(g.id); setStatus(`Face ${g.face.label} ${g.kind} x${g.cells.length}`); }} style={{ gap: 2, paddingLeft: 7, paddingRight: 8, paddingTop: 5, paddingBottom: 5, borderRadius: 5, borderWidth: 1, borderColor: selectedGroup?.id === g.id ? '#facc15' : '#334155', backgroundColor: selectedGroup?.id === g.id ? '#332b12' : '#0f1a2e' }}>
            <Row style={{ alignItems: 'center', gap: 6 }}>
              <Box style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: KINDS[g.kind].color, opacity: KINDS[g.kind].opacity ?? 1 }} />
              <Text fontSize={10} color="#e2e8f0" style={{ fontFamily: 'monospace', fontWeight: 900 }}>{g.face.label}</Text>
              <Text fontSize={10} color="#94a3b8" style={{ flexGrow: 1 }}>{g.kind}</Text>
              <Text fontSize={10} color="#facc15" style={{ fontFamily: 'monospace' }}>{g.cells.length}</Text>
            </Row>
            <Text fontSize={8} color="#64748b" style={{ fontFamily: 'monospace' }}>plane {g.plane} · u {g.bounds.u0}-{g.bounds.u1} · v {g.bounds.v0}-{g.bounds.v1}</Text>
          </Pressable>
        ))}
      </Col>

      <Row style={{ position: 'absolute', left: 12, bottom: 12, alignItems: 'center', gap: 8, paddingLeft: 10, paddingRight: 10, height: 38, borderRadius: 8, borderWidth: 1, borderColor: '#27364a', backgroundColor: '#0b1320ee' }}>
        <Pressable onPress={props.onExit} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 8, paddingRight: 8, paddingTop: 5, paddingBottom: 5, borderRadius: 5, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f1a2e' }}>
          <Icon name="ArrowLeft" size={14} color="#cbd5e1" />
          <Text fontSize={11} color="#cbd5e1" style={{ fontWeight: 900 }}>Back</Text>
        </Pressable>
        <Text fontSize={10} color="#94a3b8" style={{ fontFamily: 'monospace' }}>selected #{selected?.id ?? '-'} · {selected ? `${selected.x},${selected.y},${selected.z}` : '-'} · {activeFace.label} {'>'} {preview.x},{preview.y},{preview.z}</Text>
      </Row>
    </Box>
  );
}
