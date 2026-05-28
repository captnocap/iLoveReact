// hmsc_massive_map_lab - procedural city-scale chunking lab for HMSC.
//
// Ship: ./scripts/ship hmsc_massive_map_lab

import { useEffect, useMemo, useRef, useState } from 'react';
import { busOn } from '@reactjit/runtime/hooks/useIFTTT';
import { useTelemetry } from '@reactjit/runtime/hooks/useTelemetry';
import { set as setClipboard } from '@reactjit/runtime/hooks/clipboard';
import { Box, Col, Row, Text, Pressable, Scene3D } from '@reactjit/runtime/primitives';
import * as Geometry from '@reactjit/geometries';
import { PlayerFigure } from './hmsc/render3d/PlayerFigure';
import { HMSC_SCALE } from './hmsc/world/scale';

type Vec3 = [number, number, number];
type CameraState = {
  targetX: number;
  targetZ: number;
  mapYaw: number;
  mapPitch: number;
  mapDistance: number;
  gameplayYawDegrees: number;
  gameplayPitchRadians: number;
  mode: 'gameplay' | 'map';
  playerYawDegrees: number;
};
type Building = {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  color: string;
};
type Chunk = {
  key: string;
  cx: number;
  cz: number;
  centerX: number;
  centerZ: number;
  kind: 'water' | 'downtown' | 'urban' | 'suburb' | 'industrial';
  buildings: Building[];
};
type FrameStats = {
  fps: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  samples: number;
};
type CameraDiagnostics = {
  input: string;
  updates: number;
  immediate: number;
  scheduled: number;
  coalesced: number;
  flushes: number;
  lastUpdateMs: number;
  lastFlushDelayMs: number;
  lastDragDx: number;
  lastDragDy: number;
  lastYawDelta: number;
  lastPitchDelta: number;
  lastMoveMeters: number;
};
type InstanceBatch = {
  data: number[];
  count: number;
  center: Vec3;
  boundsRadius: number;
};

const MAP_WIDTH_METERS = 12_800;
const MAP_DEPTH_METERS = 8_000;
const CHUNK_METERS = 160;
const ROAD_WIDTH_METERS = 12;
const AVENUE_WIDTH_METERS = 18;
const MAP_CAMERA_DRAG_SPEED = 0.006;
const GAMEPLAY_CAMERA_YAW_RADIANS_PER_PIXEL = 0.0032;
const GAMEPLAY_CAMERA_PITCH_RADIANS_PER_PIXEL = 0.0024;
const GAMEPLAY_CAMERA_DISTANCE_METERS = 15;
const GAMEPLAY_CAMERA_HEIGHT_METERS = 4.4;
const GAMEPLAY_LOOK_AHEAD_METERS = 44;
const PAN_STEP_METERS = 80;

const MAP_CHUNKS_X = Math.floor(MAP_WIDTH_METERS / CHUNK_METERS);
const MAP_CHUNKS_Z = Math.floor(MAP_DEPTH_METERS / CHUNK_METERS);
const TOTAL_CHUNKS = MAP_CHUNKS_X * MAP_CHUNKS_Z;

function nowMs() {
  const host: any = globalThis;
  return host.performance?.now ? host.performance.now() : Date.now();
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function hash2(a: number, b: number) {
  let x = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b ^ 0xc2b2ae35, 0x27d4eb2d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12;
  return (x >>> 0) / 0xffffffff;
}

function randRange(cx: number, cz: number, salt: number, min: number, max: number) {
  return min + hash2(cx * 31 + salt * 101, cz * 37 - salt * 59) * (max - min);
}

function cameraPosition(camera: CameraState): Vec3 {
  if (camera.mode === 'gameplay') {
    const yawRadians = camera.gameplayYawDegrees * Math.PI / 180;
    return [
      camera.targetX - Math.sin(yawRadians) * GAMEPLAY_CAMERA_DISTANCE_METERS,
      GAMEPLAY_CAMERA_HEIGHT_METERS,
      camera.targetZ - Math.cos(yawRadians) * GAMEPLAY_CAMERA_DISTANCE_METERS,
    ];
  }
  const cp = Math.cos(camera.mapPitch);
  return [
    camera.targetX + Math.sin(camera.mapYaw) * cp * camera.mapDistance,
    Math.sin(camera.mapPitch) * camera.mapDistance,
    camera.targetZ + Math.cos(camera.mapYaw) * cp * camera.mapDistance,
  ];
}

function cameraTarget(camera: CameraState): Vec3 {
  if (camera.mode === 'gameplay') {
    const yawRadians = camera.gameplayYawDegrees * Math.PI / 180;
    return [
      camera.targetX + Math.sin(yawRadians) * GAMEPLAY_LOOK_AHEAD_METERS,
      1.35 + Math.sin(camera.gameplayPitchRadians) * 18,
      camera.targetZ + Math.cos(yawRadians) * GAMEPLAY_LOOK_AHEAD_METERS,
    ];
  }
  return [camera.targetX, 0, camera.targetZ];
}

function chunkKind(cx: number, cz: number): Chunk['kind'] {
  const worldX = cx * CHUNK_METERS;
  const worldZ = cz * CHUNK_METERS;
  if (worldX > MAP_WIDTH_METERS * 0.34) return 'water';
  const downtown = Math.hypot(worldX - MAP_WIDTH_METERS * 0.18, worldZ + MAP_DEPTH_METERS * 0.04);
  if (downtown < 900) return 'downtown';
  if (Math.abs(worldZ) < 1450 || Math.abs(worldX + 850) < 900) return 'urban';
  if (worldX < -MAP_WIDTH_METERS * 0.32 || worldZ > MAP_DEPTH_METERS * 0.34) return 'industrial';
  return 'suburb';
}

function colorForHeight(height: number, kind: Chunk['kind']) {
  if (kind === 'downtown') {
    if (height > 95) return '#8cc8ff';
    if (height > 45) return '#a5b4fc';
    return '#6b7280';
  }
  if (kind === 'industrial') return height > 18 ? '#737373' : '#4b5563';
  if (kind === 'suburb') return '#c08457';
  return height > 28 ? '#94a3b8' : '#64748b';
}

function rgb01(hex: string): [number, number, number] {
  const s = hex.startsWith('#') ? hex.slice(1) : hex;
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
  if (!Number.isFinite(n)) return [0.8, 0.8, 0.8];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function pushBoxInstance(out: number[], x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string) {
  const [r, g, b] = rgb01(color);
  out.push(x, y, z, sx, sy, sz, r, g, b);
}

function buildCityBatch(chunks: Chunk[], radius: number, targetX: number, targetZ: number): InstanceBatch {
  const data: number[] = [];
  for (const chunk of chunks) {
    const ground = chunk.kind === 'water' ? '#0b4264' : chunk.kind === 'suburb' ? '#1f3425' : '#192233';
    pushBoxInstance(data, chunk.centerX, -0.04, chunk.centerZ, CHUNK_METERS - 1, 0.08, CHUNK_METERS - 1, ground);
    pushBoxInstance(data, chunk.centerX, 0.015, chunk.centerZ - CHUNK_METERS / 2, CHUNK_METERS, 0.025, 1.2, '#334155');
    pushBoxInstance(data, chunk.centerX - CHUNK_METERS / 2, 0.017, chunk.centerZ, 1.2, 0.025, CHUNK_METERS, '#334155');
    if (chunk.kind !== 'water') {
      pushBoxInstance(data, chunk.centerX, 0.045, chunk.centerZ, CHUNK_METERS, 0.035, ROAD_WIDTH_METERS, '#151a22');
      pushBoxInstance(data, chunk.centerX, 0.047, chunk.centerZ, AVENUE_WIDTH_METERS, 0.035, CHUNK_METERS, '#151a22');
      pushBoxInstance(data, chunk.centerX, 0.071, chunk.centerZ, CHUNK_METERS, 0.01, 0.6, '#f8fafc');
    }
    for (const b of chunk.buildings) {
      pushBoxInstance(data, b.x, b.height / 2, b.z, b.width, b.height, b.depth, b.color);
    }
  }
  return {
    data,
    count: data.length / 9,
    center: [targetX, 0, targetZ],
    boundsRadius: Math.sqrt(2) * (radius + 1) * CHUNK_METERS + 220,
  };
}

function generateBuildings(cx: number, cz: number, kind: Chunk['kind'], density: number): Building[] {
  if (kind === 'water') return [];
  const buildings: Building[] = [];
  const blocksPerChunk = 2;
  const blockMeters = CHUNK_METERS / blocksPerChunk;
  const maxLots = kind === 'downtown' ? 7 : kind === 'urban' ? 5 : kind === 'industrial' ? 3 : 4;
  for (let bz = 0; bz < blocksPerChunk; bz += 1) {
    for (let bx = 0; bx < blocksPerChunk; bx += 1) {
      const lotSeed = bx + bz * 7;
      const lots = Math.max(1, Math.floor(maxLots * density));
      for (let i = 0; i < lots; i += 1) {
        if (hash2(cx * 13 + i + bx * 3, cz * 17 + bz * 5) > density + 0.12) continue;
        const localBaseX = -CHUNK_METERS / 2 + bx * blockMeters + blockMeters / 2;
        const localBaseZ = -CHUNK_METERS / 2 + bz * blockMeters + blockMeters / 2;
        const spread = blockMeters * 0.28;
        const x = cx * CHUNK_METERS + localBaseX + randRange(cx, cz, lotSeed + i * 11, -spread, spread);
        const z = cz * CHUNK_METERS + localBaseZ + randRange(cx, cz, lotSeed + i * 13, -spread, spread);
        const width = randRange(cx, cz, lotSeed + i * 19, 14, kind === 'downtown' ? 38 : 30);
        const depth = randRange(cx, cz, lotSeed + i * 23, 14, kind === 'downtown' ? 42 : 32);
        const height = kind === 'downtown'
          ? randRange(cx, cz, lotSeed + i * 29, 18, 155)
          : kind === 'urban'
            ? randRange(cx, cz, lotSeed + i * 29, 8, 48)
            : kind === 'industrial'
              ? randRange(cx, cz, lotSeed + i * 29, 7, 24)
              : randRange(cx, cz, lotSeed + i * 29, 4, 14);
        buildings.push({
          id: `${cx}:${cz}:${bx}:${bz}:${i}`,
          x,
          z,
          width,
          depth,
          height,
          color: colorForHeight(height, kind),
        });
      }
    }
  }
  return buildings;
}

function generateChunk(cx: number, cz: number, density: number): Chunk {
  const kind = chunkKind(cx, cz);
  return {
    key: `${cx},${cz}`,
    cx,
    cz,
    centerX: cx * CHUNK_METERS,
    centerZ: cz * CHUNK_METERS,
    kind,
    buildings: generateBuildings(cx, cz, kind, density),
  };
}

function visibleChunks(camera: CameraState, radius: number, density: number): Chunk[] {
  const centerCx = Math.round(camera.targetX / CHUNK_METERS);
  const centerCz = Math.round(camera.targetZ / CHUNK_METERS);
  const chunks: Chunk[] = [];
  for (let dz = -radius; dz <= radius; dz += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const cx = centerCx + dx;
      const cz = centerCz + dz;
      const worldX = cx * CHUNK_METERS;
      const worldZ = cz * CHUNK_METERS;
      if (Math.abs(worldX) > MAP_WIDTH_METERS / 2 || Math.abs(worldZ) > MAP_DEPTH_METERS / 2) continue;
      chunks.push(generateChunk(cx, cz, density));
    }
  }
  return chunks;
}

function Button(props: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={props.onPress}
      style={{
        paddingLeft: 10,
        paddingRight: 10,
        paddingTop: 7,
        paddingBottom: 7,
        borderRadius: 5,
        borderWidth: 1,
        borderColor: '#334155',
        backgroundColor: '#0f172a',
      }}
    >
      <Text fontSize={12} color="#e5eefc" style={{ fontWeight: 800 }}>{props.label}</Text>
    </Pressable>
  );
}

function StatText(props: { label: string; value: string; color?: string }) {
  return (
    <Text fontSize={11} color={props.color ?? '#dbeafe'}>
      {props.label} <Text fontSize={11} color="#f8fafc" style={{ fontWeight: 800 }}>{props.value}</Text>
    </Text>
  );
}

function compactJson(value: any): string {
  if (!value) return 'null';
  try {
    const json = JSON.stringify(value);
    return json.length > 150 ? `${json.slice(0, 150)}...` : json;
  } catch {
    return String(value);
  }
}

function copyText(value: string): boolean {
  try {
    setClipboard(value);
    return true;
  } catch {
    return false;
  }
}

function ChunkGround(props: { chunk: Chunk }) {
  const material = props.chunk.kind === 'water' ? '#0b4264' : props.chunk.kind === 'suburb' ? '#1f3425' : '#192233';
  return (
    <>
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 1, height: 1, depth: 1 }}
        scale={[CHUNK_METERS - 1, 0.08, CHUNK_METERS - 1]}
        material={material}
        position={[props.chunk.centerX, -0.04, props.chunk.centerZ]}
      />
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 1, height: 1, depth: 1 }}
        scale={[CHUNK_METERS, 0.025, 1.2]}
        material="#334155"
        position={[props.chunk.centerX, 0.015, props.chunk.centerZ - CHUNK_METERS / 2]}
      />
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 1, height: 1, depth: 1 }}
        scale={[1.2, 0.025, CHUNK_METERS]}
        material="#334155"
        position={[props.chunk.centerX - CHUNK_METERS / 2, 0.017, props.chunk.centerZ]}
      />
    </>
  );
}

function ChunkRoads(props: { chunk: Chunk }) {
  if (props.chunk.kind === 'water') return null;
  return (
    <>
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 1, height: 1, depth: 1 }}
        scale={[CHUNK_METERS, 0.035, ROAD_WIDTH_METERS]}
        material="#151a22"
        position={[props.chunk.centerX, 0.045, props.chunk.centerZ]}
      />
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 1, height: 1, depth: 1 }}
        scale={[AVENUE_WIDTH_METERS, 0.035, CHUNK_METERS]}
        material="#151a22"
        position={[props.chunk.centerX, 0.047, props.chunk.centerZ]}
      />
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 1, height: 1, depth: 1 }}
        scale={[CHUNK_METERS, 0.01, 0.6]}
        material="#f8fafc"
        position={[props.chunk.centerX, 0.071, props.chunk.centerZ]}
      />
    </>
  );
}

function BuildingMesh(props: { building: Building }) {
  const b = props.building;
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      params={{ width: 1, height: 1, depth: 1 }}
      scale={[b.width, b.height, b.depth]}
      material={b.color}
      position={[b.x, b.height / 2, b.z]}
    />
  );
}

const INITIAL_CAMERA: CameraState = {
  targetX: 0,
  targetZ: 0,
  mapYaw: 0.72,
  mapPitch: 0.72,
  mapDistance: 1300,
  gameplayYawDegrees: 0,
  gameplayPitchRadians: 0.05,
  mode: 'gameplay',
  playerYawDegrees: 180,
};

export default function HmscMassiveMapLab() {
  const hostFps = useTelemetry({ kind: 'fps', pollMs: 250 }).value;
  const layoutUs = useTelemetry({ kind: 'layoutUs', pollMs: 250 }).value;
  const paintUs = useTelemetry({ kind: 'paintUs', pollMs: 250 }).value;
  const tickUs = useTelemetry({ kind: 'tickUs', pollMs: 250 }).value;
  const nodeCount = useTelemetry({ kind: 'nodeCount', pollMs: 500 }).value;
  const frameTelemetry = useTelemetry<any>({ kind: 'frame', pollMs: 500 }).data;
  const gpuTelemetry = useTelemetry<any>({ kind: 'gpu', pollMs: 500 }).data;
  const nodesTelemetry = useTelemetry<any>({ kind: 'nodes', pollMs: 500 }).data;
  const inputTelemetry = useTelemetry<any>({ kind: 'input', pollMs: 500 }).data;
  const [camera, setCameraState] = useState<CameraState>(INITIAL_CAMERA);
  const [chunkRadius, setChunkRadius] = useState(3);
  const [density, setDensity] = useState(0.72);
  const [copyStatus, setCopyStatus] = useState('copy diagnostics');
  const [frameStats, setFrameStats] = useState<FrameStats>({ fps: 0, avgMs: 0, minMs: 0, maxMs: 0, samples: 0 });
  const [cameraDiagnostics, setCameraDiagnostics] = useState<CameraDiagnostics>({
    input: 'boot',
    updates: 0,
    immediate: 0,
    scheduled: 0,
    coalesced: 0,
    flushes: 0,
    lastUpdateMs: 0,
    lastFlushDelayMs: 0,
    lastDragDx: 0,
    lastDragDy: 0,
    lastYawDelta: 0,
    lastPitchDelta: 0,
    lastMoveMeters: 0,
  });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const cameraRef = useRef<CameraState>(INITIAL_CAMERA);
  const cameraFrameRef = useRef<any>(0);
  const cameraScheduleAtRef = useRef(0);
  const cameraDiagnosticsRef = useRef<CameraDiagnostics>(cameraDiagnostics);
  const copyResetRef = useRef<any>(0);
  const chunkBuild = useMemo(() => {
    const started = nowMs();
    const value = visibleChunks(camera, chunkRadius, density);
    return { chunks: value, ms: nowMs() - started };
  }, [camera.targetX, camera.targetZ, chunkRadius, density]);
  const chunks = chunkBuild.chunks;
  const buildingCount = chunks.reduce((sum, chunk) => sum + chunk.buildings.length, 0);
  const visibleMeshCount = chunks.length * 6 + buildingCount;
  const theoreticalBuildingCount = Math.floor(TOTAL_CHUNKS * 12 * density);
  const cityBatch = useMemo(
    () => buildCityBatch(chunks, chunkRadius, camera.targetX, camera.targetZ),
    [chunks, chunkRadius, camera.targetX, camera.targetZ],
  );

  const flushCamera = () => {
    cameraFrameRef.current = 0;
    cameraDiagnosticsRef.current = {
      ...cameraDiagnosticsRef.current,
      flushes: cameraDiagnosticsRef.current.flushes + 1,
      lastFlushDelayMs: nowMs() - cameraScheduleAtRef.current,
    };
    setCameraDiagnostics(cameraDiagnosticsRef.current);
    setCameraState(cameraRef.current);
  };

  const updateCamera = (updater: (current: CameraState) => CameraState, immediate = false, input = 'camera') => {
    const started = nowMs();
    const before = cameraRef.current;
    const after = updater(before);
    cameraRef.current = after;
    const targetDx = after.targetX - before.targetX;
    const targetDz = after.targetZ - before.targetZ;
    cameraDiagnosticsRef.current = {
      ...cameraDiagnosticsRef.current,
      input,
      updates: cameraDiagnosticsRef.current.updates + 1,
      immediate: cameraDiagnosticsRef.current.immediate + (immediate ? 1 : 0),
      lastUpdateMs: nowMs() - started,
      lastYawDelta: after.gameplayYawDegrees - before.gameplayYawDegrees,
      lastPitchDelta: after.gameplayPitchRadians - before.gameplayPitchRadians,
      lastMoveMeters: Math.hypot(targetDx, targetDz),
    };
    if (immediate) {
      if (cameraFrameRef.current) {
        const host: any = globalThis;
        const cancel = host.cancelAnimationFrame ? host.cancelAnimationFrame.bind(host) : clearTimeout;
        cancel(cameraFrameRef.current);
        cameraFrameRef.current = 0;
      }
      setCameraDiagnostics(cameraDiagnosticsRef.current);
      setCameraState(cameraRef.current);
      return;
    }
    if (cameraFrameRef.current) {
      cameraDiagnosticsRef.current = {
        ...cameraDiagnosticsRef.current,
        coalesced: cameraDiagnosticsRef.current.coalesced + 1,
      };
      return;
    }
    const host: any = globalThis;
    const schedule = host.requestAnimationFrame ? host.requestAnimationFrame.bind(host) : (fn: any) => setTimeout(fn, 16);
    cameraDiagnosticsRef.current = {
      ...cameraDiagnosticsRef.current,
      scheduled: cameraDiagnosticsRef.current.scheduled + 1,
    };
    cameraScheduleAtRef.current = nowMs();
    cameraFrameRef.current = schedule(flushCamera);
  };

  useEffect(() => {
    const off = busOn('__keydown', (event: any) => {
      const key = String(event?.key ?? '').toLowerCase();
      if (key === 'w' || key === 'arrowup') updateCamera((c) => ({ ...c, targetZ: c.targetZ - PAN_STEP_METERS, playerYawDegrees: 180 }), true, `key:${key}`);
      if (key === 's' || key === 'arrowdown') updateCamera((c) => ({ ...c, targetZ: c.targetZ + PAN_STEP_METERS, playerYawDegrees: 0 }), true, `key:${key}`);
      if (key === 'a' || key === 'arrowleft') updateCamera((c) => ({ ...c, targetX: c.targetX - PAN_STEP_METERS, playerYawDegrees: 90 }), true, `key:${key}`);
      if (key === 'd' || key === 'arrowright') updateCamera((c) => ({ ...c, targetX: c.targetX + PAN_STEP_METERS, playerYawDegrees: 270 }), true, `key:${key}`);
      if (key === '+' || key === '=') updateCamera((c) => ({ ...c, mapDistance: clamp(c.mapDistance - 140, 320, 4200) }), true, `key:${key}`);
      if (key === '-' || key === '_') updateCamera((c) => ({ ...c, mapDistance: clamp(c.mapDistance + 140, 320, 4200) }), true, `key:${key}`);
      if (key === '1') updateCamera((c) => ({ ...c, mode: 'gameplay' }), true, 'key:1');
      if (key === '2') updateCamera((c) => ({ ...c, mode: 'map' }), true, 'key:2');
    });
    return () => {
      off();
      if (cameraFrameRef.current) {
        const host: any = globalThis;
        const cancel = host.cancelAnimationFrame ? host.cancelAnimationFrame.bind(host) : clearTimeout;
        cancel(cameraFrameRef.current);
      }
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
    };
  }, []);

  useEffect(() => {
    const host: any = globalThis;
    const schedule = host.requestAnimationFrame ? host.requestAnimationFrame.bind(host) : (fn: any) => setTimeout(fn, 16);
    const cancel = host.cancelAnimationFrame ? host.cancelAnimationFrame.bind(host) : clearTimeout;
    let handle: any = 0;
    let last = nowMs();
    let windowStart = last;
    let frames = 0;
    let total = 0;
    let min = Number.POSITIVE_INFINITY;
    let max = 0;
    const tick = () => {
      const now = nowMs();
      const dt = now - last;
      last = now;
      frames += 1;
      total += dt;
      min = Math.min(min, dt);
      max = Math.max(max, dt);
      if (now - windowStart >= 250) {
        setFrameStats({
          fps: frames * 1000 / Math.max(1, now - windowStart),
          avgMs: total / Math.max(1, frames),
          minMs: min === Number.POSITIVE_INFINITY ? 0 : min,
          maxMs: max,
          samples: frames,
        });
        windowStart = now;
        frames = 0;
        total = 0;
        min = Number.POSITIVE_INFINITY;
        max = 0;
      }
      handle = schedule(tick);
    };
    handle = schedule(tick);
    return () => cancel(handle);
  }, []);

  const beginDrag = (event: any) => {
    dragRef.current = { x: Number(event?.x ?? 0), y: Number(event?.y ?? 0) };
  };
  const moveDrag = (event: any) => {
    const drag = dragRef.current;
    if (!drag) return;
    const x = Number(event?.x ?? drag.x);
    const y = Number(event?.y ?? drag.y);
    const dx = x - drag.x;
    const dy = y - drag.y;
    drag.x = x;
    drag.y = y;
    cameraDiagnosticsRef.current = {
      ...cameraDiagnosticsRef.current,
      lastDragDx: dx,
      lastDragDy: dy,
    };
    updateCamera((c) => {
      if (c.mode === 'gameplay') {
        return {
          ...c,
          gameplayYawDegrees: c.gameplayYawDegrees - dx * GAMEPLAY_CAMERA_YAW_RADIANS_PER_PIXEL * 180 / Math.PI,
          gameplayPitchRadians: clamp(c.gameplayPitchRadians + dy * GAMEPLAY_CAMERA_PITCH_RADIANS_PER_PIXEL, -0.65, 0.85),
        };
      }
      return {
        ...c,
        mapYaw: c.mapYaw - dx * MAP_CAMERA_DRAG_SPEED,
        mapPitch: clamp(c.mapPitch + dy * MAP_CAMERA_DRAG_SPEED, 0.16, 1.26),
      };
    }, false, 'drag');
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  const camPos = cameraPosition(camera);
  const target = cameraTarget(camera);
  const playerPosition = { x: camera.targetX, y: 0, z: camera.targetZ };
  const diagnosticsSnapshot = {
    label: 'hmsc_massive_map_lab',
    capturedAt: new Date().toISOString(),
    world: {
      widthMeters: MAP_WIDTH_METERS,
      depthMeters: MAP_DEPTH_METERS,
      chunkMeters: CHUNK_METERS,
      totalChunks: TOTAL_CHUNKS,
      cityBlockTargetMeters: HMSC_SCALE.cityBlock,
    },
    visible: {
      chunks: chunks.length,
      buildings: buildingCount,
      meshesEstimate: visibleMeshCount,
      meshCap: 8192,
      chunkRadius,
      density,
      chunkBuildMs: chunkBuild.ms,
      theoreticalBuildingCount,
    },
    camera: {
      state: camera,
      position: camPos,
      target,
      fov: camera.mode === 'gameplay' ? 62 : 48,
    },
    frame: {
      hostFps,
      rafFps: frameStats.fps,
      rafAvgMs: frameStats.avgMs,
      rafMinMs: frameStats.minMs,
      rafMaxMs: frameStats.maxMs,
      rafSamples: frameStats.samples,
      tickUs,
      layoutUs,
      paintUs,
      gpuUs: Number(frameTelemetry?.gpu_us ?? 0),
      nodeCount,
      nodeTotal: Number(nodesTelemetry?.total ?? nodeCount),
      nodeIndexCap: 4096,
      },
    input: cameraDiagnostics,
    telemetry: {
      frame: frameTelemetry,
      gpu: gpuTelemetry,
      nodes: nodesTelemetry,
      input: inputTelemetry,
    },
  };
  const copyDiagnostics = () => {
    const ok = copyText(JSON.stringify(diagnosticsSnapshot, null, 2));
    setCopyStatus(ok ? 'copied diagnostics' : 'copy failed');
    if (copyResetRef.current) clearTimeout(copyResetRef.current);
    copyResetRef.current = setTimeout(() => {
      copyResetRef.current = 0;
      setCopyStatus('copy diagnostics');
    }, ok ? 1200 : 1800);
  };

  return (
    <Pressable
      style={{ width: '100%', height: '100%', backgroundColor: '#020617' }}
      onMouseDown={beginDrag}
      onMouseMove={moveDrag}
      onMouseUp={endDrag}
    >
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#07111f" showGrid={false} showAxes={false}>
        <Scene3D.Camera position={camPos} target={target} fov={camera.mode === 'gameplay' ? 62 : 48} />
        <Scene3D.AmbientLight color="#9fb0d6" intensity={0.58} />
        <Scene3D.DirectionalLight direction={[0.45, 0.88, 0.35]} color="#ffe0b0" intensity={0.78} />
        <Scene3D.Instances
          geometry={Geometry.Box}
          params={{ width: 1, height: 1, depth: 1 }}
          data={cityBatch.data}
          count={cityBatch.count}
          stride={9}
          center={cityBatch.center}
          boundsRadius={cityBatch.boundsRadius}
        />
        <PlayerFigure
          position={playerPosition}
          yawDegrees={camera.playerYawDegrees}
          animationSeconds={Date.now() / 1000}
          moving={false}
          running={false}
        />
        {camera.mode === 'map' ? (
          <Scene3D.Mesh
            geometry={Geometry.Cylinder}
            params={{ radius: 12, height: 6, segments: 24 }}
            material="#22d3ee"
            position={[camera.targetX, 3, camera.targetZ]}
          />
        ) : null}
      </Scene3D>

      <Box style={{ position: 'absolute', top: 14, left: 14, width: 560, padding: 12, borderRadius: 6, borderWidth: 1, borderColor: '#1e293b', backgroundColor: '#08111f' }}>
        <Col style={{ gap: 8 }}>
          <Text fontSize={16} color="#f8fafc" style={{ fontWeight: 900 }}>HMSC MASSIVE MAP LAB</Text>
          <Text fontSize={12} color="#93a4b8">Procedural Miami-scale chunk field. WASD pans player/focus, drag orbits, +/- zoom.</Text>
          <Text fontSize={12} color="#dbeafe">world {MAP_WIDTH_METERS / 1000}km x {MAP_DEPTH_METERS / 1000}km</Text>
          <Text fontSize={12} color="#dbeafe">chunk {CHUNK_METERS}m; total chunks {TOTAL_CHUNKS.toLocaleString()}</Text>
          <Text fontSize={12} color="#dbeafe">visible chunks {chunks.length}; visible buildings {buildingCount.toLocaleString()}</Text>
          <Text fontSize={12} color="#dbeafe">estimated world buildings {theoreticalBuildingCount.toLocaleString()}; visible meshes ~{visibleMeshCount.toLocaleString()}</Text>
          <Text fontSize={12} color="#fbbf24">city block target {HMSC_SCALE.cityBlock.minMeters}-{HMSC_SCALE.cityBlock.maxMeters}m; current roads every {CHUNK_METERS / 2}m.</Text>
          <Row style={{ gap: 12, flexWrap: 'wrap' }}>
            <StatText label="host fps" value={hostFps.toFixed(1)} color={hostFps >= 55 ? '#86efac' : hostFps >= 30 ? '#fbbf24' : '#fb7185'} />
            <StatText label="raf fps" value={frameStats.fps.toFixed(1)} color={frameStats.fps >= 55 ? '#86efac' : frameStats.fps >= 30 ? '#fbbf24' : '#fb7185'} />
            <StatText label="frame avg/max" value={`${frameStats.avgMs.toFixed(2)} / ${frameStats.maxMs.toFixed(2)}ms`} />
            <StatText label="samples" value={String(frameStats.samples)} />
          </Row>
          <Row style={{ gap: 12, flexWrap: 'wrap' }}>
            <StatText label="tick" value={`${tickUs.toFixed(0)}us`} />
            <StatText label="layout" value={`${layoutUs.toFixed(0)}us`} />
            <StatText label="paint" value={`${paintUs.toFixed(0)}us`} />
            <StatText label="gpu" value={`${Number(frameTelemetry?.gpu_us ?? 0).toFixed(0)}us`} />
            <StatText label="nodes" value={`${Number(nodesTelemetry?.total ?? nodeCount).toLocaleString()} total / ${nodeCount.toLocaleString()} indexed`} />
          </Row>
          <Row style={{ gap: 12, flexWrap: 'wrap' }}>
            <StatText label="chunk build" value={`${chunkBuild.ms.toFixed(3)}ms`} />
            <StatText label="mesh cap" value={`${visibleMeshCount.toLocaleString()} / 8,192`} />
            <StatText label="chunk radius" value={String(chunkRadius)} />
            <StatText label="density" value={density.toFixed(2)} />
          </Row>
          <Row style={{ gap: 12, flexWrap: 'wrap' }}>
            <StatText label="3d draw" value={`${Number(gpuTelemetry?.scene3d_draw_us ?? 0).toFixed(0)}us`} />
            <StatText label="3d meshes" value={`${Number(gpuTelemetry?.scene3d_meshes_collected ?? 0).toLocaleString()} / ${Number(gpuTelemetry?.scene3d_mesh_children ?? 0).toLocaleString()}`} />
            <StatText label="3d instances" value={Number(gpuTelemetry?.scene3d_instances ?? 0).toLocaleString()} />
            <StatText label="3d draws" value={Number(gpuTelemetry?.scene3d_draw_calls ?? 0).toLocaleString()} />
            <StatText label="3d dropped" value={Number(gpuTelemetry?.scene3d_meshes_dropped ?? 0).toLocaleString()} color={Number(gpuTelemetry?.scene3d_meshes_dropped ?? 0) > 0 ? '#fb7185' : '#86efac'} />
          </Row>
          <Row style={{ gap: 12, flexWrap: 'wrap' }}>
            <StatText label="mode" value={camera.mode} />
            <StatText label="cam pos" value={`${camPos[0].toFixed(1)}, ${camPos[1].toFixed(1)}, ${camPos[2].toFixed(1)}`} />
            <StatText label="target" value={`${target[0].toFixed(1)}, ${target[1].toFixed(1)}, ${target[2].toFixed(1)}`} />
          </Row>
          <Row style={{ gap: 12, flexWrap: 'wrap' }}>
            <StatText label="input" value={cameraDiagnostics.input} />
            <StatText label="drag dx/dy" value={`${cameraDiagnostics.lastDragDx.toFixed(1)}, ${cameraDiagnostics.lastDragDy.toFixed(1)}`} />
            <StatText label="yaw/pitch d" value={`${cameraDiagnostics.lastYawDelta.toFixed(3)}, ${cameraDiagnostics.lastPitchDelta.toFixed(4)}`} />
            <StatText label="move" value={`${cameraDiagnostics.lastMoveMeters.toFixed(1)}m`} />
          </Row>
          <Row style={{ gap: 12, flexWrap: 'wrap' }}>
            <StatText label="camera updates" value={String(cameraDiagnostics.updates)} />
            <StatText label="immediate" value={String(cameraDiagnostics.immediate)} />
            <StatText label="scheduled/coalesced" value={`${cameraDiagnostics.scheduled} / ${cameraDiagnostics.coalesced}`} />
            <StatText label="flush delay" value={`${cameraDiagnostics.lastFlushDelayMs.toFixed(2)}ms`} />
          </Row>
          <Text fontSize={10} color="#8aa0b9">frame {compactJson(frameTelemetry)}</Text>
          <Text fontSize={10} color="#8aa0b9">gpu {compactJson(gpuTelemetry)}</Text>
          <Text fontSize={10} color="#8aa0b9">nodes {compactJson(nodesTelemetry)}</Text>
          <Text fontSize={10} color="#8aa0b9">input {compactJson(inputTelemetry)}</Text>
          <Row style={{ gap: 8 }}>
            <Button label="gameplay 1" onPress={() => updateCamera((c) => ({ ...c, mode: 'gameplay' }), true, 'button:gameplay')} />
            <Button label="map 2" onPress={() => updateCamera((c) => ({ ...c, mode: 'map' }), true, 'button:map')} />
            <Button label={copyStatus} onPress={copyDiagnostics} />
          </Row>
          <Row style={{ gap: 8 }}>
            <Button label="radius -" onPress={() => setChunkRadius((r) => clamp(r - 1, 1, 8))} />
            <Button label={`radius ${chunkRadius}`} onPress={() => setChunkRadius((r) => clamp(r + 1, 1, 8))} />
            <Button label="density -" onPress={() => setDensity((d) => clamp(d - 0.12, 0.2, 1))} />
            <Button label={`density ${density.toFixed(2)}`} onPress={() => setDensity((d) => clamp(d + 0.12, 0.2, 1))} />
          </Row>
          <Row style={{ gap: 8 }}>
            <Button label="downtown" onPress={() => updateCamera((c) => ({ ...c, targetX: MAP_WIDTH_METERS * 0.18, targetZ: -MAP_DEPTH_METERS * 0.04, mapDistance: 1150 }), true, 'button:downtown')} />
            <Button label="coast" onPress={() => updateCamera((c) => ({ ...c, targetX: MAP_WIDTH_METERS * 0.34, targetZ: 0, mapDistance: 1500 }), true, 'button:coast')} />
            <Button label="suburbs" onPress={() => updateCamera((c) => ({ ...c, targetX: -2600, targetZ: 2300, mapDistance: 1600 }), true, 'button:suburbs')} />
          </Row>
        </Col>
      </Box>
    </Pressable>
  );
}
