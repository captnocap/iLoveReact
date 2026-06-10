// editors/workbench/items/Stage.tsx -- ITEM source demonstration surfaces.
//
// Lenses:
//   ITEM   -- the sculpted prop in 3D
//   SCULPT -- the depth paint canvas plus 3D prop
//   VOXEL  -- the blockout builder that auto-feeds the sculpt base

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Col, Effect, Paintable, Pressable, Row, Scene3D, ScrollView, Text } from '@reactjit/primitives';
import { usePaintable, type PaintableHandle } from '@reactjit/runtime/hooks/usePaintable';
import * as Geometry from '@reactjit/geometries';
import { GAME_CAMERA, GAME_CHROME, GAME_NATIVE_CAMERA, type Solved } from '../../../game';
import { PAINT } from '../../paint';
import { useSculptCamera } from '../../sculptCamera';
import { cloudBounds } from '../../sculptFraming';
import {
  DEPTH_OVERLAY_WGSL, GREATER_POINTS, PAINT_EDITOR_TUNING, SCULPT_CANVAS, bytesFromGrid, depthOverlayData, gridFromBytes,
  gridNodeAt, gridNodeFromSurfaceHit, reliefBytesFromGrid, sculptDabSnap, sculptEngineBrushPx, sculptModeValue, withNodeValue,
  type GridNode,
} from '../../characters/paintKit';
import {
  GRAB_GRID_TEXTURE_KEY, GRAB_TUNING, applyGrabStamp, buildGrabClouds, grabDragAxis, grabPointWorld,
  gridDeltaFor, gridOverlayParams, pickGrab, screenAxisFor, stampRadiusUv, stampWorldRadius,
  type GrabCloud, type GrabHit, type GrabInstance, type ScreenAxis,
} from '../../characters/grabKit';
import { GrabGridCapture, GrabMarker, type GrabMarkerInfo } from '../../characters/preview';
import { IconTile, LinearRailSlider, RailDivider, SectionLabel } from '../../cutout/ToolRail';
import { useRouteTwigState } from '../../twigs';
import { SMOOTH_TUNING, gridRoughness, relaxGrid, relaxStamp } from '../../characters/smoothKit';
import {
  VOXEL_KINDS, VOXEL_PALETTE, addFace, detectVoxelFaceGroups, inVoxelBounds,
  type ItemLens, type ItemStore, type VoxelFace, type VoxelFaceGroup, type WorkbenchVoxelBlock,
} from './store';
import { ITEM_GEOMETRIES, type ItemDefinition, type ItemPart } from '../../../game/items';

const { Chip, Knob, LabEnvironment } = GAME_CHROME;
const T = GAME_CHROME.tokens.color;
const TUNE = PAINT_EDITOR_TUNING;
const EDITOR_W = TUNE.editor.width;
const EDITOR_H = TUNE.editor.height;
const PAINT_W = TUNE.paint.width;
const PAINT_H = TUNE.paint.height;
const GRID_W = TUNE.grid.width;
const GRID_H = TUNE.grid.height;
const NEUTRAL = TUNE.neutral;
const ITEM_PLACEMENT: [number, number, number] = [0, 1.2, 0];
const VOXEL_VIEW = { fov: 48, yawPerPixel: 0.4, pitchPerPixel: 0.3, minPitch: 7, maxPitch: 84, minDistance: 0.35, maxDistance: 34, boot: { yaw: 38, pitch: 31, distance: 14 } } as const;
const SCULPT_SPLIT = { default: 0.55, min: 0.3, max: 0.75, meshMinPx: 220, rowMinPx: 240, toolColPx: 200 };

type Vec3 = [number, number, number];
type Rect = { x: number; y: number; width: number; height: number };
type ItemSlot = 'item';

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function hexRgb(hex: string): [number, number, number] {
  const s = hex.startsWith('#') ? hex.slice(1) : hex;
  const n = parseInt(s, 16);
  if (!Number.isFinite(n)) return [0.8, 0.8, 0.8];
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

function partScale(sc: ItemPart['scale']): [number, number, number] {
  if (typeof sc === 'number') return [sc, sc, sc];
  if (!sc) return [1, 1, 1];
  return [sc[0], sc[1], sc[2]];
}

function RegistryItemStage(props: { item: ItemDefinition }) {
  const item = props.item;
  return (
    <Box style={{ flexGrow: 1, height: '100%', position: 'relative', overflow: 'hidden', backgroundColor: T.panelSolid }}>
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={T.panelSolid} showGrid={false} showAxes={false}>
        <Scene3D.Camera position={[0, 1.05, 4.2]} target={[0, 0.62, 0]} fov={44} far={80} />
        <LabEnvironment preset="studio" ground={false} />
        {item.parts.map((part, i) => (
          <Scene3D.Mesh
            key={`${item.id}-${i}`}
            geometry={ITEM_GEOMETRIES[part.geometry]}
            params={part.params}
            material={part.material}
            textureKey={part.textureKey}
            position={part.position}
            rotation={part.rotation ?? [0, 0, 0]}
            scale={partScale(part.scale)}
          />
        ))}
      </Scene3D>
      <Box style={{ position: 'absolute', left: 12, bottom: 12, paddingLeft: 10, paddingRight: 10, paddingTop: 8, paddingBottom: 8, borderRadius: 6, backgroundColor: '#0b1320dd', borderWidth: 1, borderColor: '#27364a' }}>
        <Text fontSize={10} color={T.dim}>{item.label} · GAME_ITEMS · {item.scaleStatus} scale</Text>
      </Box>
    </Box>
  );
}

function faceByDelta(dx: number, dy: number, dz: number): VoxelFace {
  return Object.values({
    xp: { key: 'xp', label: '+X', dx: 1, dy: 0, dz: 0 },
    xn: { key: 'xn', label: '-X', dx: -1, dy: 0, dz: 0 },
    yp: { key: 'yp', label: '+Y', dx: 0, dy: 1, dz: 0 },
    yn: { key: 'yn', label: '-Y', dx: 0, dy: -1, dz: 0 },
    zp: { key: 'zp', label: '+Z', dx: 0, dy: 0, dz: 1 },
    zn: { key: 'zn', label: '-Z', dx: 0, dy: 0, dz: -1 },
  }).find((f) => f.dx === dx && f.dy === dy && f.dz === dz)!;
}

function voxelCenter(block: Pick<WorkbenchVoxelBlock, 'x' | 'y' | 'z'>, cellSize: number): Vec3 {
  return [block.x * cellSize, block.y * cellSize, block.z * cellSize];
}

function rayBlockFace(o: Vec3, d: Vec3, block: WorkbenchVoxelBlock, cellSize: number): { t: number; face: VoxelFace } | null {
  const c = voxelCenter(block, cellSize);
  const half = cellSize / 2;
  let tmin = -Infinity;
  let tmax = Infinity;
  let enter = faceByDelta(0, 1, 0);
  let exit = faceByDelta(0, -1, 0);
  for (let a = 0; a < 3; a++) {
    const lo = c[a] - half;
    const hi = c[a] + half;
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < lo || o[a] > hi) return null;
      continue;
    }
    const axisFace = (sign: number): VoxelFace => {
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

function pickBlockFace(sx: number, sy: number, rect: Rect, cam: { pos: Vec3; target: Vec3; fov: number }, blocks: WorkbenchVoxelBlock[], cellSize: number): { block: WorkbenchVoxelBlock; face: VoxelFace } | null {
  const { origin: o, dir: d } = GAME_CAMERA.screenRay(sx, sy, rect, cam);
  let best: { block: WorkbenchVoxelBlock; face: VoxelFace; t: number } | null = null;
  for (const block of blocks) {
    const hit = rayBlockFace(o, d, block, cellSize);
    if (hit && hit.t > 0 && (!best || hit.t < best.t)) best = { block, face: hit.face, t: hit.t };
  }
  return best ? { block: best.block, face: best.face } : null;
}

function FaceHandle(props: { selected: WorkbenchVoxelBlock; face: VoxelFace; active: boolean; color: string; mine: boolean; cellSize: number }) {
  const f = props.face;
  const c = props.cellSize;
  const center = voxelCenter(props.selected, c);
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      params={{ width: (f.dx !== 0 ? 0.08 : 0.44) * c, height: (f.dy !== 0 ? 0.08 : 0.44) * c, depth: (f.dz !== 0 ? 0.08 : 0.44) * c }}
      material={{ color: props.active ? (props.mine ? '#ff355e' : props.color) : '#f8fafc', opacity: props.active ? 0.72 : 0.18 }}
      position={[center[0] + f.dx * 0.56 * c, center[1] + f.dy * 0.56 * c, center[2] + f.dz * 0.56 * c]}
    />
  );
}

function GroupFaceOverlay(props: { group: VoxelFaceGroup; cellSize: number }) {
  const f = props.group.face;
  const c = props.cellSize;
  return (
    <>
      {props.group.cells.map((cell, i) => (
        <Scene3D.Mesh
          key={`${props.group.id}_${i}`}
          geometry={Geometry.Box}
          params={{ width: (f.dx !== 0 ? 0.045 : 0.86) * c, height: (f.dy !== 0 ? 0.045 : 0.86) * c, depth: (f.dz !== 0 ? 0.045 : 0.86) * c }}
          material={{ color: '#facc15', opacity: 0.34 }}
          position={[cell.x * c + f.dx * 0.515 * c, cell.y * c + f.dy * 0.515 * c, cell.z * c + f.dz * 0.515 * c]}
        />
      ))}
    </>
  );
}

function VoxelStage(props: { store: ItemStore }) {
  const s = props.store;
  const blocks = s.voxelBlocks();
  const selected = s.selectedVoxel();
  const activeGroup = s.selectedGroup();
  const preview = s.voxelPreview();
  const previewOk = s.voxelPreviewOk();
  const def = VOXEL_KINDS[s.view.voxelKind];
  const cellSize = s.voxelCellSizeMeters;
  const worldW = s.voxelDims.w * cellSize;
  const worldD = s.voxelDims.d * cellSize;
  const worldH = s.voxelDims.h * cellSize;
  const fitDistance = () => clamp(Math.max(worldW, worldD, worldH, cellSize) * 2.8, VOXEL_VIEW.minDistance, VOXEL_VIEW.maxDistance);
  const lookRef = useRef({ yaw: VOXEL_VIEW.boot.yaw, pitch: VOXEL_VIEW.boot.pitch });
  const distRef = useRef(fitDistance());
  const cameraRef = useRef<any>(null);
  const cameraCtlRef = useRef<ReturnType<typeof GAME_NATIVE_CAMERA.forNode> | null>(null);
  const rectRef = useRef<Rect>({ x: 0, y: 0, width: 1000, height: 700 });
  const dragRef = useRef<{ x: number; y: number; dist: number } | null>(null);
  const target: Vec3 = [((s.voxelDims.w - 1) * cellSize) / 2, Math.max(worldH / 2, cellSize), ((s.voxelDims.d - 1) * cellSize) / 2];
  const solveShadow = (t: Vec3, look = lookRef.current, distance = distRef.current) =>
    GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, { target: t, yaw: look.yaw, pitch: look.pitch, dist: distance, zoom: 1, fov: VOXEL_VIEW.fov });
  const shadowCamRef = useRef(solveShadow(target));
  const [bootCam] = useState(() => shadowCamRef.current);
  const sendOrbit = (t: Vec3, look = lookRef.current, distance = distRef.current) => {
    shadowCamRef.current = solveShadow(t, look, distance);
    cameraCtlRef.current?.setOrbit({ target: t, yaw: look.yaw, pitch: look.pitch, distance, fov: VOXEL_VIEW.fov, zoom: 1 });
  };
  useEffect(() => {
    const nodeId = Number(cameraRef.current?.id ?? 0);
    if (!nodeId) return;
    const ctl = GAME_NATIVE_CAMERA.forNode(nodeId);
    cameraCtlRef.current = ctl;
    distRef.current = fitDistance();
    ctl.setOrbit({ target, yaw: lookRef.current.yaw, pitch: lookRef.current.pitch, distance: distRef.current, fov: VOXEL_VIEW.fov, zoom: 1 });
    ctl.setMode('orbit');
    return () => { cameraCtlRef.current = null; ctl.disable(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { distRef.current = fitDistance(); sendOrbit(target); }, [target[0], target[1], target[2], cellSize]);
  const batches = useMemo(() => VOXEL_PALETTE.map((kind) => {
    const d = VOXEL_KINDS[kind];
    const [r, g, b] = hexRgb(d.color);
    const data: number[] = [];
    for (const block of blocks) {
      if (block.kind === kind) data.push(block.x * cellSize, block.y * cellSize, block.z * cellSize, cellSize, cellSize, cellSize, r, g, b);
    }
    return { kind, data, count: data.length / 9 };
  }).filter((b) => b.count > 0), [blocks, cellSize]);
  const onDown = (e: any) => { dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0), dist: 0 }; };
  const onMove = (e: any) => {
    const d = dragRef.current;
    if (!d) return;
    const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
    const dx = nx - d.x, dy = ny - d.y;
    d.dist += Math.abs(dx) + Math.abs(dy);
    d.x = nx; d.y = ny;
    const l = lookRef.current;
    const nextYaw = l.yaw - dx * VOXEL_VIEW.yawPerPixel;
    const nextPitch = clamp(l.pitch - dy * VOXEL_VIEW.pitchPerPixel, VOXEL_VIEW.minPitch, VOXEL_VIEW.maxPitch);
    cameraCtlRef.current?.setInputDeltas(nextYaw - l.yaw, nextPitch - l.pitch);
    l.yaw = nextYaw; l.pitch = nextPitch;
    shadowCamRef.current = solveShadow(target);
  };
  const onUp = (e: any) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.dist >= 6) return;
    const r = rectRef.current;
    const hit = pickBlockFace(Number(e?.x ?? 0) - r.x, Number(e?.y ?? 0) - r.y, r, shadowCamRef.current, blocks, cellSize);
    if (hit) s.onVoxelFace(hit.block, hit.face);
    else s.setStatus('Miss');
  };
  const onWheel = (e: any) => {
    const dy = Number(e?.deltaY ?? e?.dy ?? 0);
    const step = Math.max(cellSize, distRef.current * 0.12);
    distRef.current = clamp(distRef.current + (dy > 0 ? 1 : -1) * step, VOXEL_VIEW.minDistance, VOXEL_VIEW.maxDistance);
    sendOrbit(target);
  };
  return (
    <Pressable
      onLayout={(lr: any) => { rectRef.current = { x: Number(lr.x ?? 0), y: Number(lr.y ?? 0), width: Number(lr.width ?? 1000), height: Number(lr.height ?? 700) }; }}
      onMouseDown={onDown}
      onMouseMove={onMove}
      onMouseUp={onUp}
      onWheel={onWheel}
      style={{ flexGrow: 1, height: '100%', position: 'relative', overflow: 'hidden' }}
    >
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#0a1018" showGrid={false} showAxes={false}>
        <Scene3D.Camera nativeCamera ref={cameraRef} position={bootCam.pos} target={bootCam.target} fov={bootCam.fov} far={120} />
        <Scene3D.Fog enabled={false} />
        <Scene3D.AmbientLight color="#d8e2ff" intensity={0.48} />
        <Scene3D.DirectionalLight direction={[0.45, 0.9, 0.36]} color="#ffe3a8" intensity={0.9} />
        <Scene3D.Mesh geometry={Geometry.Box} params={{ width: worldW + 0.1 * cellSize, height: 0.04 * cellSize, depth: worldD + 0.1 * cellSize }} material="#182231" position={[((s.voxelDims.w - 1) * cellSize) / 2, -0.54 * cellSize, ((s.voxelDims.d - 1) * cellSize) / 2]} />
        {batches.map((batch) => <Scene3D.Instances key={batch.kind} geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} data={batch.data} count={batch.count} stride={9} center={[0, 0, 0]} boundsRadius={80} />)}
        <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1.08 * cellSize, height: 1.08 * cellSize, depth: 1.08 * cellSize }} material={{ color: s.view.voxelTool === 'mine' ? '#ff355e' : '#f8fafc', opacity: 0.18 }} position={voxelCenter(selected, cellSize)} />
        {Object.values({
          xp: { key: 'xp', label: '+X', dx: 1, dy: 0, dz: 0 },
          xn: { key: 'xn', label: '-X', dx: -1, dy: 0, dz: 0 },
          yp: { key: 'yp', label: '+Y', dx: 0, dy: 1, dz: 0 },
          yn: { key: 'yn', label: '-Y', dx: 0, dy: -1, dz: 0 },
          zp: { key: 'zp', label: '+Z', dx: 0, dy: 0, dz: 1 },
          zn: { key: 'zn', label: '-Z', dx: 0, dy: 0, dz: -1 },
        }).map((face) => <FaceHandle key={face.key} selected={selected} face={face} active={face.key === s.view.activeFace.key} color={def.color} mine={s.view.voxelTool === 'mine'} cellSize={cellSize} />)}
        {activeGroup ? <GroupFaceOverlay group={activeGroup} cellSize={cellSize} /> : null}
        {s.view.voxelTool === 'build' ? <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 0.96 * cellSize, height: 0.96 * cellSize, depth: 0.96 * cellSize }} material={{ color: previewOk ? def.color : '#ff355e', opacity: previewOk ? 0.38 : 0.24 }} position={voxelCenter(preview, cellSize)} /> : null}
      </Scene3D>
      <Box style={{ position: 'absolute', left: 12, bottom: 12, paddingLeft: 10, paddingRight: 10, paddingTop: 8, paddingBottom: 8, borderRadius: 6, backgroundColor: '#0b1320dd', borderWidth: 1, borderColor: '#27364a' }}>
        <Text fontSize={10} color="#94a3b8" style={{ fontFamily: 'monospace' }}>cell {cellSize.toFixed(2)}m · selected #{selected.id} · {selected.x},{selected.y},{selected.z} · {s.view.activeFace.label} {'>'} {preview.x},{preview.y},{preview.z}</Text>
      </Box>
    </Pressable>
  );
}

function ItemMeshStage(props: {
  store: ItemStore;
  sculpt?: boolean;
  selectedNode?: GridNode | null;
  onSelectNode?: (node: GridNode) => void;
  uploadGrid?: (grid: number[]) => void;
}) {
  const s = props.store;
  const params = useMemo(() => s.itemParams, [s.draft.radius, s.draft.amount, s.draft.grid]);
  const voxelParams = useMemo(() => s.itemVoxelMeshParams, [s.draft.voxelShape, s.draft.amount, s.draft.grid]);
  const voxelMode = s.draft.representation !== 'globe' && !!voxelParams;
  const dynKey = `wbitem.main~${s.seq}.${s.draft.amount.toFixed(2)}.${s.draft.radius.toFixed(2)}`;
  const voxelDynKey = `wbitem.${s.draft.representation}~${s.seq}.${s.draft.amount.toFixed(2)}`;
  const instances: GrabInstance<ItemSlot>[] = useMemo(() => [{ part: 'item', position: ITEM_PLACEMENT, scale: [1, 1, 1] }], []);
  const viewRect = useRef({ x: 0, y: 0, width: 1, height: 1 });
  const grabCloudsRef = useRef<{ sig: unknown; clouds: GrabCloud<ItemSlot>[] } | null>(null);
  const grabClouds = () => {
    const cached = grabCloudsRef.current;
    if (cached && cached.sig === params) return cached.clouds;
    const clouds = buildGrabClouds<ItemSlot>(instances, () => params);
    grabCloudsRef.current = { sig: params, clouds };
    return clouds;
  };
  const camera = useSculptCamera({
    route: '/workbench/items',
    center: ITEM_PLACEMENT,
    viewRect,
    pickWorld: (sx, sy, cam) => {
      const r = viewRect.current;
      return (pickGrab<ItemSlot>(sx - r.x, sy - r.y, { x: 0, y: 0, width: r.width, height: r.height }, cam, grabClouds())?.world as [number, number, number] | undefined) ?? null;
    },
    subjectBounds: () => cloudBounds(grabClouds()),
    focusKey: `item:${s.installRev}`,
    zoom: TUNE.itemCamera.zoom,
    defaults: { dist: 0.65, look: { yaw: 20, pitch: 12 }, flyPose: { pos: [0, 1.25, -0.9], yaw: 0, pitch: -4 }, mode: 'fly' },
  });
  const pickAt = (sx: number, sy: number) => {
    const r = viewRect.current;
    return pickGrab<ItemSlot>(sx - r.x, sy - r.y, { x: 0, y: 0, width: r.width, height: r.height }, camera.solvedCam(), grabClouds());
  };
  const [grabHover, setGrabHover] = useState<{ gx: number; gy: number; cu: number; cv: number; grabRadius: number; state: 'hover' | 'raise' | 'carve' | 'smooth' } | null>(null);
  const grabRef = useRef<null | { hit: GrabHit<ItemSlot>; baseGrid: number[]; axis: ScreenAxis; startX: number; startY: number; delta: number; rx: number; ry: number; lastSync: number; timer: ReturnType<typeof setTimeout> | null; applied: boolean }>(null);
  const startGrab = (hit: GrabHit<ItemSlot>, e: any) => {
    props.onSelectNode?.(gridNodeFromSurfaceHit(hit));
    const r = viewRect.current;
    const axisWorld = grabDragAxis(hit, params, instances[0]);
    const axis = screenAxisFor(hit.world, axisWorld, { x: 0, y: 0, width: r.width, height: r.height }, camera.solvedCam());
    const { rx, ry } = stampRadiusUv(s.view.brush, PAINT_W);
    grabRef.current = { hit, baseGrid: s.draft.grid.slice(), axis, startX: Number(e?.x ?? 0), startY: Number(e?.y ?? 0), delta: 0, rx, ry, lastSync: 0, timer: null, applied: false };
    setGrabHover({ gx: hit.gx, gy: hit.gy, cu: hit.cu, cv: hit.cv, grabRadius: hit.grabRadius, state: s.view.sculptMode === 'smooth' ? 'smooth' : 'raise' });
  };
  const smoothDose = (delta: number) => Math.min(1, Math.abs(delta) * SMOOTH_TUNING.dragDoseFactor);
  const grabbedGrid = (g: NonNullable<typeof grabRef.current>) =>
    s.view.sculptMode === 'smooth'
      ? relaxStamp(g.baseGrid, g.hit.cu, g.hit.cv, g.rx, g.ry, smoothDose(g.delta), SMOOTH_TUNING.drag.iterations, s.view.mirror)
      : applyGrabStamp(g.baseGrid, g.hit.cu, g.hit.cv, g.rx, g.ry, g.delta, s.view.mirror);
  const applyGrabLive = () => {
    const g = grabRef.current;
    if (!g) return;
    g.lastSync = Date.now();
    g.applied = true;
    const next = grabbedGrid(g);
    s.setGrid(next);
    props.uploadGrid?.(next);
    setGrabHover((cur) => (cur ? { ...cur, state: s.view.sculptMode === 'smooth' ? 'smooth' : g.delta < 0 ? 'carve' : 'raise' } : cur));
  };
  const grabMove = (e: any) => {
    const g = grabRef.current;
    if (!g) return;
    g.delta = gridDeltaFor(Number(e?.x ?? 0) - g.startX, Number(e?.y ?? 0) - g.startY, g.axis);
    const since = Date.now() - g.lastSync;
    if (since >= GRAB_TUNING.liveSyncMs) applyGrabLive();
    else if (!g.timer) g.timer = setTimeout(() => { if (grabRef.current === g) { g.timer = null; applyGrabLive(); } }, GRAB_TUNING.liveSyncMs - since);
  };
  const endGrab = () => {
    const g = grabRef.current;
    if (!g) return;
    grabRef.current = null;
    if (g.timer) clearTimeout(g.timer);
    if (Math.abs(g.delta) < 0.01) {
      if (g.applied) {
        s.setGrid(g.baseGrid);
        props.uploadGrid?.(g.baseGrid);
      }
    } else {
      const final = grabbedGrid(g);
      const note = s.view.sculptMode === 'smooth'
        ? `smooth drag · item · cell ${g.hit.gx},${g.hit.gy} · dose ${smoothDose(g.delta).toFixed(2)}`
        : `grab drag · item · cell ${g.hit.gx},${g.hit.gy} · ${g.delta > 0 ? 'raise' : 'carve'} ${Math.abs(g.delta).toFixed(2)}`;
      s.commitGrid(g.baseGrid, final, note);
      props.uploadGrid?.(final);
    }
    setGrabHover((cur) => (cur ? { ...cur, state: 'hover' } : cur));
  };
  const previewDown = (e: any) => {
    if (props.sculpt && !voxelMode) {
      const hit = pickAt(Number(e?.x ?? 0), Number(e?.y ?? 0));
      if (hit) { startGrab(hit, e); return; }
    }
    camera.orbitDown(e);
  };
  const previewMove = (e: any) => {
    if (grabRef.current) { grabMove(e); return; }
    if (camera.dragging()) { camera.orbitMove(e); return; }
    if (!props.sculpt || voxelMode) return;
    const hit = pickAt(Number(e?.x ?? 0), Number(e?.y ?? 0));
    setGrabHover(hit ? { gx: hit.gx, gy: hit.gy, cu: hit.cu, cv: hit.cv, grabRadius: hit.grabRadius, state: 'hover' } : null);
  };
  const previewUp = () => { if (grabRef.current) endGrab(); else camera.orbitUp(); };
  const grabMarker: GrabMarkerInfo | null = useMemo(() => {
    if (!grabHover) return null;
    return {
      world: grabPointWorld(params, instances[0], grabHover.cu, grabHover.cv) as [number, number, number],
      grabRadius: grabHover.grabRadius,
      stampWorldRadius: stampWorldRadius(params, instances[0], grabHover.cu, grabHover.cv, stampRadiusUv(s.view.brush, PAINT_W).rx),
      state: grabHover.state,
    };
  }, [grabHover, params, instances, s.view.brush]);
  const shellParams = useMemo(() => gridOverlayParams(params), [params]);
  const flagWorld = (u: number, v: number): [number, number, number] =>
    grabPointWorld(params, instances[0], u, v) as [number, number, number];
  const sculptFlags = props.sculpt && !voxelMode ? (
    <>
      {GREATER_POINTS.map((p) => (
        <Scene3D.Mesh
          key={`gp-${p.u}`}
          geometry={Geometry.Sphere}
          params={{ radius: 1, segments: 12, rings: 8 }}
          material={p.color}
          position={flagWorld(p.u, p.v)}
          scale={0.045}
        />
      ))}
      {props.selectedNode ? (
        <Scene3D.Mesh
          geometry={Geometry.Sphere}
          params={{ radius: 1, segments: 12, rings: 8 }}
          material="#33e6ff"
          position={flagWorld(props.selectedNode.u, props.selectedNode.v)}
          scale={0.055}
        />
      ) : null}
    </>
  ) : null;
  return (
    <Pressable
      onLayout={(lr: any) => { viewRect.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
      onMouseDown={previewDown}
      onMouseMove={previewMove}
      onMouseUp={previewUp}
      onScroll={camera.onWheel}
      style={{ flexGrow: 1, height: '100%', position: 'relative', overflow: 'hidden' }}
    >
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={T.panelSolid} showGrid={false} showAxes={false}>
        <Scene3D.Camera nativeCamera ref={camera.cameraRef} position={camera.bootCam.pos} target={camera.bootCam.target} fov={camera.bootCam.fov} near={TUNE.itemCamera.near} far={80} />
        <LabEnvironment preset="studio" ground={false} />
        {voxelMode ? (
          <Scene3D.Mesh geometry={Geometry.VoxelMesh} params={voxelParams as any} dynamicKey={voxelDynKey} material={s.draft.color} position={ITEM_PLACEMENT} />
        ) : (
          <Scene3D.Mesh geometry={Geometry.Globe} params={params as any} dynamicKey={dynKey} material={s.draft.color} position={ITEM_PLACEMENT} />
        )}
        {!voxelMode && s.view.showGrabGrid ? <Scene3D.Mesh geometry={Geometry.Globe} params={shellParams as any} dynamicKey={dynKey.replace('~', '.grid~')} material={{ color: GRAB_TUNING.grid.color, opacity: GRAB_TUNING.grid.opacity }} textureKey={GRAB_GRID_TEXTURE_KEY} position={ITEM_PLACEMENT} /> : null}
        {!voxelMode ? <GrabMarker marker={grabMarker} /> : null}
        {sculptFlags}
      </Scene3D>
      <Row style={{ position: 'absolute', left: 14, top: 14, right: 14, flexWrap: 'wrap', gap: 8, rowGap: 6, alignItems: 'center' }}>
        <Chip label="grid" active={s.view.showGrabGrid} color="cyan" onPress={() => s.setShowGrabGrid(!s.view.showGrabGrid)} />
        <Chip label="fly" active={camera.camMode === 'fly'} color="good" onPress={() => camera.setCamMode(camera.camMode === 'fly' ? 'orbit' : 'fly')} />
        <Chip label="undo" onPress={s.undo} />
        <Chip label="redo" onPress={s.redo} />
        <Box style={{ flexGrow: 1 }} />
        <Text fontSize={9} color={T.dim} style={{ fontWeight: 800, letterSpacing: 1 }}>{props.sculpt ? `LIVE 3D · ${s.draft.representation}` : `ITEM PREVIEW · ${s.draft.representation}`}</Text>
      </Row>
      {camera.camMode === 'fly' ? (
        <Text fontSize={10} color={T.dim} style={{ position: 'absolute', right: 14, bottom: 14 }}>
          wasd move · q/e down/up · drag look · wheel dolly · F refocus
        </Text>
      ) : (
        <Box style={{ position: 'absolute', right: 14, bottom: 14 }}>
          <Knob label="zoom" value={camera.zoomReflect - camera.dist} spec={camera.zoomSpec} onChange={(x: number) => camera.zoomTo(camera.zoomReflect - x)} />
        </Box>
      )}
      {!voxelMode ? <GrabGridCapture hover={grabHover} selected={props.selectedNode} mirror={s.view.mirror} /> : null}
    </Pressable>
  );
}

function SculptCanvas(props: {
  store: ItemStore;
  paint: PaintableHandle;
  relief: PaintableHandle;
  selectedNode: GridNode | null;
  nodesMode: boolean;
  onSelectNode: (node: GridNode | null) => void;
  uploadGrid: (grid: number[]) => void;
}) {
  const s = props.store;
  const paintingRef = useRef(false);
  const strokeEngineRef = useRef<ReturnType<typeof PAINT.createStrokeEngine> | null>(null);
  const smoothStrokeRef = useRef<null | { base: number[]; work: number[]; lastSync: number }>(null);
  const paintBaseRef = useRef<number[] | null>(null);
  const [brushHover, setBrushHover] = useState<{ u: number; v: number } | null>(null);
  const canvasRect = useRef({ x: 0, y: 0, width: EDITOR_W, height: EDITOR_H });
  useEffect(() => {
    props.uploadGrid(s.draft.grid);
    props.relief.paint.upload(reliefBytesFromGrid(s.draft.grid));
  }, [s.installRev]);
  useEffect(() => { props.relief.paint.upload(reliefBytesFromGrid(s.draft.grid)); }, [s.draft.grid]);
  const uvAt = (sx: number, sy: number) => {
    const r = canvasRect.current;
    return {
      u: clamp((sx - r.x) / r.width, 0, 0.9999),
      v: clamp((sy - r.y) / r.height, 0, 0.9999),
    };
  };
  const updateBrushHover = (sx: number, sy: number) => {
    const r = canvasRect.current;
    if (sx < r.x || sx > r.x + r.width || sy < r.y || sy > r.y + r.height) {
      setBrushHover(null);
      return;
    }
    const p = uvAt(sx, sy);
    setBrushHover((cur) => (cur && Math.abs(cur.u - p.u) < 0.002 && Math.abs(cur.v - p.v) < 0.004 ? cur : p));
  };
  const dab = (sx: number, sy: number, pressure?: number) => {
    const engine = strokeEngineRef.current;
    if (!engine) return;
    const r = canvasRect.current;
    const p = sculptDabSnap(s.view.brush, ((sx - r.x) / r.width) * PAINT_W, ((sy - r.y) / r.height) * PAINT_H);
    const value = sculptModeValue(s.view.sculptMode, s.view.strength);
    for (const d of engine.move(p.x, p.y, pressure)) props.paint.paint.circle(d.x, d.y, d.radius, value);
  };
  const syncGrid = () => {
    const bytes = props.paint.paint.readback();
    if (!bytes || bytes.length < PAINT_W * PAINT_H) return;
    const base = paintBaseRef.current ?? s.draft.grid;
    paintBaseRef.current = null;
    const next = gridFromBytes(bytes);
    s.commitGrid(base, next, `sculpt stroke · ${s.view.sculptMode} · ${s.view.brush}px`);
  };
  const smoothDab = (sx: number, sy: number) => {
    const st = smoothStrokeRef.current;
    if (!st) return;
    const p = uvAt(sx, sy);
    const { rx, ry } = stampRadiusUv(s.view.brush, PAINT_W);
    st.work = relaxStamp(st.work, p.u, p.v, rx, ry, s.view.strength, 1, s.view.mirror);
    if (Date.now() - st.lastSync >= GRAB_TUNING.liveSyncMs) {
      st.lastSync = Date.now();
      s.setGrid(st.work);
      props.uploadGrid(st.work);
    }
  };
  const onPaintDown = (e: any) => {
    const sx = Number(e?.x ?? 0);
    const sy = Number(e?.y ?? 0);
    if (props.nodesMode) {
      props.onSelectNode(gridNodeAt(uvAt(sx, sy).u, uvAt(sx, sy).v));
      return;
    }
    paintingRef.current = true;
    paintBaseRef.current = s.draft.grid.slice();
    if (s.view.sculptMode === 'smooth') {
      smoothStrokeRef.current = { base: s.draft.grid.slice(), work: s.draft.grid.slice(), lastSync: 0 };
      smoothDab(sx, sy);
      return;
    }
    strokeEngineRef.current = PAINT.createStrokeEngine({ brushPx: sculptEngineBrushPx(s.view.brush), mirrorAxisX: s.view.mirror ? PAINT_W / 2 : null });
    strokeEngineRef.current.begin();
    dab(sx, sy, Number(e?.pressure) || undefined);
  };
  const onPaintMove = (e: any) => {
    const sx = Number(e?.x ?? 0);
    const sy = Number(e?.y ?? 0);
    updateBrushHover(sx, sy);
    if (!paintingRef.current) return;
    if (s.view.sculptMode === 'smooth') { smoothDab(sx, sy); return; }
    dab(sx, sy, Number(e?.pressure) || undefined);
  };
  const onPaintUp = () => {
    if (!paintingRef.current) return;
    paintingRef.current = false;
    const smooth = smoothStrokeRef.current;
    if (smooth) {
      smoothStrokeRef.current = null;
      s.commitGrid(smooth.base, smooth.work, `smooth stroke · item · ${s.view.brush}px`);
      props.uploadGrid(smooth.work);
      return;
    }
    strokeEngineRef.current?.end();
    strokeEngineRef.current = null;
    syncGrid();
  };
  return (
    <Pressable
      onLayout={(lr: any) => { canvasRect.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
      onMouseDown={onPaintDown}
      onMouseMove={onPaintMove}
      onMouseUp={onPaintUp}
      style={{ width: EDITOR_W, height: EDITOR_H, borderWidth: 1, borderColor: T.frame, position: 'relative', flexShrink: 0, backgroundColor: SCULPT_CANVAS.base }}
    >
      <Box style={{ width: EDITOR_W, height: EDITOR_H, backgroundColor: SCULPT_CANVAS.base }} />
      <Effect
        shader={DEPTH_OVERLAY_WGSL}
        data={depthOverlayData({
          hover: brushHover,
          brushPx: s.view.brush,
          mode: s.view.sculptMode,
          mirror: s.view.mirror,
          selected: props.selectedNode ? { u: props.selectedNode.u, v: props.selectedNode.v } : null,
        })}
        textures={[props.paint.id, props.relief.id]}
        style={{ position: 'absolute', left: 0, top: 0, width: EDITOR_W, height: EDITOR_H }}
      />
    </Pressable>
  );
}

function SculptStage(props: { store: ItemStore }) {
  const s = props.store;
  const paint = usePaintable({ id: 'wbitem-sculpt', w: PAINT_W, h: PAINT_H });
  const relief = usePaintable({ id: 'wbitem-relief', w: GRID_W, h: GRID_H });
  const [nodesMode, setNodesMode] = useRouteTwigState<boolean>('/workbench/items', 'nodesMode', false);
  const [selNode, setSelNode] = useRouteTwigState<GridNode | null>('/workbench/items', 'selectedNode', null);
  const [sculptSplit, setSculptSplit] = useRouteTwigState<number>('/workbench/items', 'sculptSplitY', SCULPT_SPLIT.default);
  const [splitDragging, setSplitDragging] = useState(false);
  const nodeGestureRef = useRef(false);
  const nodeBaseRef = useRef<number[] | null>(null);
  const stageRect = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const uploadGrid = (grid: number[]) => paint.paint.upload(bytesFromGrid(grid));
  const resizeSplit = (screenY: number) => {
    const r = stageRect.current;
    if (r.height <= 0) return;
    setSculptSplit(clamp((screenY - r.y) / r.height, SCULPT_SPLIT.min, SCULPT_SPLIT.max));
  };
  const selectNode = (node: GridNode | null) => {
    setSelNode(node);
    nodeGestureRef.current = false;
    nodeBaseRef.current = null;
  };
  const setNodeValue = (value: number) => {
    if (!selNode) return;
    const g = withNodeValue(s.draft.grid, selNode.idx, value);
    if (!nodeGestureRef.current) {
      nodeGestureRef.current = true;
      nodeBaseRef.current = s.draft.grid.slice();
      s.commitGrid(nodeBaseRef.current, g, `node edit · ${selNode.gx},${selNode.gy} · item`);
    } else {
      s.setGrid(g);
    }
    uploadGrid(g);
  };
  const fillAll = () => {
    const value = sculptModeValue(s.view.sculptMode, s.view.strength);
    const g = new Array(GRID_W * GRID_H).fill((value - NEUTRAL) * 2);
    s.commitGrid(s.draft.grid, g, `fill · item · ${s.view.sculptMode}`);
    uploadGrid(g);
  };
  const soften = () => {
    const src = paint.paint.readback();
    if (!src || src.length < PAINT_W * PAINT_H) return;
    const out = PAINT.soften3x3(src, PAINT_W, PAINT_H);
    const g = gridFromBytes(out);
    s.commitGrid(s.draft.grid, g, 'soften · item');
    paint.paint.upload(out);
  };
  const smoothPart = () => {
    const before = gridRoughness(s.draft.grid);
    const g = relaxGrid(s.draft.grid, s.view.strength, s.view.smoothIterations);
    s.commitGrid(s.draft.grid, g, `smooth part · item · s${s.view.strength.toFixed(1)} ×${s.view.smoothIterations}`);
    uploadGrid(g);
    s.setStatus(`item smoothed — roughness ${before.mean.toFixed(3)} → ${gridRoughness(g).mean.toFixed(3)} (ctrl+z undoes)`);
  };
  const clearStrokes = () => {
    s.clearSculpt();
    setTimeout(() => uploadGrid(s.draft.grid), 0);
  };
  const fmtPx = (n: number) => `${n}px`;
  const sculptRail = (
    <ScrollView style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}>
      <Col style={{ padding: 8, gap: 9, alignItems: 'center' }}>
        <SectionLabel>MODE</SectionLabel>
        <Row style={{ gap: 6, justifyContent: 'center' }}>
          <IconTile icon="ArrowBigUp" label="Raise — blue pushes out" active={s.view.sculptMode === 'raise'} color="#3da8ff" onPress={() => s.setSculptMode('raise')} />
          <IconTile icon="ArrowBigDown" label="Carve in — orange digs" active={s.view.sculptMode === 'lower'} color="#ff9445" onPress={() => s.setSculptMode('lower')} />
          <IconTile icon="Minus" label="Flatten toward the base" active={s.view.sculptMode === 'flatten'} color="#94a3b8" onPress={() => s.setSculptMode('flatten')} />
          <IconTile icon="Waves" label="Smooth — relax the surface (paint or grab-drag)" active={s.view.sculptMode === 'smooth'} color="#34d399" onPress={() => s.setSculptMode('smooth')} />
        </Row>
        <SectionLabel>ACTIONS</SectionLabel>
        <Row style={{ gap: 6, justifyContent: 'center' }}>
          <IconTile icon="PaintBucket" label="Fill the item at the current mode/strength" active={false} color={T.accent} onPress={fillAll} />
          <IconTile icon="Droplets" label="Soften — 3×3 blur over the sculpt" active={false} color={T.accent} onPress={soften} />
          <IconTile icon="Sparkles" label="Smooth item — relax everything (strength × passes)" active={false} color="#34d399" onPress={smoothPart} />
          <IconTile icon="X" label="Clear sculpt strokes" active={false} color={T.bad} onPress={clearStrokes} />
        </Row>
        <SectionLabel>TOGGLES</SectionLabel>
        <Row style={{ gap: 6, justifyContent: 'center' }}>
          <IconTile icon="FlipHorizontal" label="Mirror painting across the front meridian" active={s.view.mirror} color="#22d3ee" onPress={() => s.setMirror(!s.view.mirror)} />
          <IconTile icon="Grid3x3" label="Nodes — click a grid point, fine-tune its depth" active={nodesMode} color="#22d3ee" onPress={() => setNodesMode(!nodesMode)} />
        </Row>
        <RailDivider />
        <SectionLabel>BRUSH</SectionLabel>
        <LinearRailSlider value={s.view.brush} min={TUNE.knobs.brush.min} max={TUNE.knobs.brush.max} step={TUNE.knobs.brush.step} onChange={s.setBrush} format={fmtPx} tooltip={`brush diameter — the floor (${TUNE.knobs.brush.min}px) is exactly one cell`} />
        <SectionLabel>STRENGTH</SectionLabel>
        <LinearRailSlider value={s.view.strength} min={TUNE.knobs.strength.min} max={TUNE.knobs.strength.max} step={TUNE.knobs.strength.step} onChange={s.setStrength} format={(n) => n.toFixed(1)} />
        <SectionLabel>PASSES</SectionLabel>
        <LinearRailSlider value={s.view.smoothIterations} min={SMOOTH_TUNING.knobs.iterations.min} max={SMOOTH_TUNING.knobs.iterations.max} step={SMOOTH_TUNING.knobs.iterations.step} onChange={s.setSmoothIterations} format={(n) => `×${Math.round(n)}`} tooltip="smooth passes — how many relax iterations per smooth-item" />
        {nodesMode ? (
          <>
            <RailDivider />
            <SectionLabel>{selNode ? `NODE ${selNode.gx},${selNode.gy}` : 'NODES'}</SectionLabel>
            {selNode ? (
              <Row style={{ gap: 6, alignItems: 'center' }}>
                <LinearRailSlider value={s.draft.grid[selNode.idx]} min={-1} max={1} step={0.02} onChange={setNodeValue} format={(n) => n.toFixed(2)} tooltip="this point's depth — minus carves, plus raises" />
                <IconTile icon="X" label="Deselect the node" active={false} color={T.bad} onPress={() => selectNode(null)} />
              </Row>
            ) : (
              <Text fontSize={9} color={T.dim}>click a grid point…</Text>
            )}
          </>
        ) : null}
      </Col>
    </ScrollView>
  );
  return (
    <Col
      onLayout={(lr: any) => { stageRect.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
      style={{ flexGrow: 1, minWidth: 0, height: '100%', minHeight: 0, position: 'relative', backgroundColor: T.panelSolid }}
    >
      <Box style={{ flexGrow: Math.round(sculptSplit * 100), flexBasis: 0, minHeight: SCULPT_SPLIT.meshMinPx, flexDirection: 'row', minWidth: 0 }}>
        <ItemMeshStage store={s} sculpt selectedNode={selNode} onSelectNode={selectNode} uploadGrid={uploadGrid} />
      </Box>
      <Pressable
        onMouseDown={(p: any) => { setSplitDragging(true); resizeSplit(Number(p?.y ?? 0)); }}
        onMouseMove={(p: any) => { if (splitDragging) resizeSplit(Number(p?.y ?? 0)); }}
        onMouseUp={() => setSplitDragging(false)}
        style={{ height: 10, alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderBottomWidth: 1, borderColor: T.frame }}
      >
        <Box style={{ width: 48, height: 2, borderRadius: 1, backgroundColor: T.dim }} />
      </Pressable>
      <Row style={{ flexGrow: 100 - Math.round(sculptSplit * 100), flexBasis: 0, minHeight: SCULPT_SPLIT.rowMinPx, minWidth: 0 }}>
        <Box style={{ flexGrow: 1, minWidth: 0, height: '100%', alignItems: 'center', justifyContent: 'center' }}>
          <SculptCanvas store={s} paint={paint} relief={relief} selectedNode={selNode} nodesMode={nodesMode} onSelectNode={selectNode} uploadGrid={uploadGrid} />
        </Box>
        <Col style={{ width: SCULPT_SPLIT.toolColPx, height: '100%', minHeight: 0, backgroundColor: T.panelSolid, borderLeftWidth: 1, borderColor: T.frame }}>
          {sculptRail}
        </Col>
      </Row>
      {splitDragging ? (
        <Pressable
          style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000001', zIndex: 50 }}
          onMouseMove={(p: any) => resizeSplit(Number(p?.y ?? 0))}
          onMouseUp={() => setSplitDragging(false)}
        />
      ) : null}
      <Box style={{ position: 'absolute', left: -99999, top: 0, width: 1, height: 1 }}>
        <Paintable id={paint.id} w={PAINT_W} h={PAINT_H} />
        <Paintable id={relief.id} w={GRID_W} h={GRID_H} />
      </Box>
    </Col>
  );
}

export function ItemStage(props: { store: ItemStore; lens: ItemLens }) {
  const s = props.store;
  const [, setTick] = useState(0);
  useEffect(() => s.subscribe(() => setTick((t) => t + 1)), [s]);
  const registry = s.selectedRegistryItem();
  if (registry) return <RegistryItemStage item={registry} />;
  if (props.lens === 'voxel') return <VoxelStage store={s} />;
  if (props.lens === 'sculpt') return <SculptStage store={s} />;
  return <ItemMeshStage store={s} />;
}
