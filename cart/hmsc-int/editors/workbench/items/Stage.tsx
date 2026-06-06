// editors/workbench/items/Stage.tsx -- ITEM source demonstration surfaces.
//
// Lenses:
//   ITEM   -- the sculpted prop in 3D
//   SCULPT -- the depth paint canvas plus 3D prop
//   VOXEL  -- the blockout builder that feeds Import Voxels

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Effect, Paintable, Pressable, Row, Scene3D, Text } from '@reactjit/primitives';
import { usePaintable } from '@reactjit/runtime/hooks/usePaintable';
import * as Geometry from '@reactjit/geometries';
import { GAME_CAMERA, GAME_CHROME, GAME_NATIVE_CAMERA, type Solved } from '../../../game';
import { PAINT } from '../../paint';
import { useSculptCamera } from '../../sculptCamera';
import { cloudBounds } from '../../sculptFraming';
import {
  DEPTH_OVERLAY_WGSL, PAINT_EDITOR_TUNING, bytesFromGrid, gridFromBytes, reliefBytesFromGrid, sculptModeValue,
} from '../../characters/paintKit';
import {
  GRAB_GRID_TEXTURE_KEY, GRAB_TUNING, applyGrabStamp, buildGrabClouds, grabDragAxis, grabPointWorld,
  gridDeltaFor, gridOverlayParams, pickGrab, screenAxisFor, stampRadiusUv, stampWorldRadius,
  type GrabCloud, type GrabHit, type GrabInstance, type ScreenAxis,
} from '../../characters/grabKit';
import { GrabGridCapture, GrabMarker, type GrabMarkerInfo } from '../../characters/preview';
import {
  VOXEL_KINDS, VOXEL_PALETTE, addFace, detectVoxelFaceGroups, inVoxelBounds,
  type ItemLens, type ItemStore, type VoxelFace, type VoxelFaceGroup, type WorkbenchVoxelBlock,
} from './store';

const { LabEnvironment } = GAME_CHROME;
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
const VOXEL_VIEW = { fov: 48, yawPerPixel: 0.4, pitchPerPixel: 0.3, minPitch: 7, maxPitch: 84, minDistance: 6, maxDistance: 34, zoomStep: 1.1, boot: { yaw: 38, pitch: 31, distance: 14 } } as const;

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

function rayBlockFace(o: Vec3, d: Vec3, block: WorkbenchVoxelBlock): { t: number; face: VoxelFace } | null {
  const c: Vec3 = [block.x, block.y, block.z];
  let tmin = -Infinity;
  let tmax = Infinity;
  let enter = faceByDelta(0, 1, 0);
  let exit = faceByDelta(0, -1, 0);
  for (let a = 0; a < 3; a++) {
    const lo = c[a] - 0.5;
    const hi = c[a] + 0.5;
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

function pickBlockFace(sx: number, sy: number, rect: Rect, cam: { pos: Vec3; target: Vec3; fov: number }, blocks: WorkbenchVoxelBlock[]): { block: WorkbenchVoxelBlock; face: VoxelFace } | null {
  const { origin: o, dir: d } = GAME_CAMERA.screenRay(sx, sy, rect, cam);
  let best: { block: WorkbenchVoxelBlock; face: VoxelFace; t: number } | null = null;
  for (const block of blocks) {
    const hit = rayBlockFace(o, d, block);
    if (hit && hit.t > 0 && (!best || hit.t < best.t)) best = { block, face: hit.face, t: hit.t };
  }
  return best ? { block: best.block, face: best.face } : null;
}

function FaceHandle(props: { selected: WorkbenchVoxelBlock; face: VoxelFace; active: boolean; color: string; mine: boolean }) {
  const f = props.face;
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      params={{ width: f.dx !== 0 ? 0.08 : 0.44, height: f.dy !== 0 ? 0.08 : 0.44, depth: f.dz !== 0 ? 0.08 : 0.44 }}
      material={{ color: props.active ? (props.mine ? '#ff355e' : props.color) : '#f8fafc', opacity: props.active ? 0.72 : 0.18 }}
      position={[props.selected.x + f.dx * 0.56, props.selected.y + f.dy * 0.56, props.selected.z + f.dz * 0.56]}
    />
  );
}

function GroupFaceOverlay(props: { group: VoxelFaceGroup }) {
  const f = props.group.face;
  return (
    <>
      {props.group.cells.map((cell, i) => (
        <Scene3D.Mesh
          key={`${props.group.id}_${i}`}
          geometry={Geometry.Box}
          params={{ width: f.dx !== 0 ? 0.045 : 0.86, height: f.dy !== 0 ? 0.045 : 0.86, depth: f.dz !== 0 ? 0.045 : 0.86 }}
          material={{ color: '#facc15', opacity: 0.34 }}
          position={[cell.x + f.dx * 0.515, cell.y + f.dy * 0.515, cell.z + f.dz * 0.515]}
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
  const lookRef = useRef({ yaw: VOXEL_VIEW.boot.yaw, pitch: VOXEL_VIEW.boot.pitch });
  const distRef = useRef(VOXEL_VIEW.boot.distance);
  const cameraRef = useRef<any>(null);
  const cameraCtlRef = useRef<ReturnType<typeof GAME_NATIVE_CAMERA.forNode> | null>(null);
  const rectRef = useRef<Rect>({ x: 0, y: 0, width: 1000, height: 700 });
  const dragRef = useRef<{ x: number; y: number; dist: number } | null>(null);
  const target: Vec3 = [(s.voxelDims.w - 1) / 2, clamp(s.voxelDims.h / 2, 1.2, 5), (s.voxelDims.d - 1) / 2];
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
    ctl.setOrbit({ target, yaw: lookRef.current.yaw, pitch: lookRef.current.pitch, distance: distRef.current, fov: VOXEL_VIEW.fov, zoom: 1 });
    ctl.setMode('orbit');
    return () => { cameraCtlRef.current = null; ctl.disable(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { sendOrbit(target); }, [target[0], target[1], target[2]]);
  const batches = useMemo(() => VOXEL_PALETTE.map((kind) => {
    const d = VOXEL_KINDS[kind];
    const [r, g, b] = hexRgb(d.color);
    const data: number[] = [];
    for (const block of blocks) {
      if (block.kind === kind) data.push(block.x, block.y, block.z, 1, 1, 1, r, g, b);
    }
    return { kind, data, count: data.length / 9 };
  }).filter((b) => b.count > 0), [blocks]);
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
    const hit = pickBlockFace(Number(e?.x ?? 0) - r.x, Number(e?.y ?? 0) - r.y, r, shadowCamRef.current, blocks);
    if (hit) s.onVoxelFace(hit.block, hit.face);
    else s.setStatus('Miss');
  };
  const onWheel = (e: any) => {
    const dy = Number(e?.deltaY ?? e?.dy ?? 0);
    distRef.current = clamp(distRef.current + (dy > 0 ? 1 : -1) * VOXEL_VIEW.zoomStep, VOXEL_VIEW.minDistance, VOXEL_VIEW.maxDistance);
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
        <Scene3D.Mesh geometry={Geometry.Box} params={{ width: s.voxelDims.w + 0.1, height: 0.04, depth: s.voxelDims.d + 0.1 }} material="#182231" position={[(s.voxelDims.w - 1) / 2, -0.54, (s.voxelDims.d - 1) / 2]} />
        {batches.map((batch) => <Scene3D.Instances key={batch.kind} geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} data={batch.data} count={batch.count} stride={9} center={[0, 0, 0]} boundsRadius={80} />)}
        <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1.08, height: 1.08, depth: 1.08 }} material={{ color: s.view.voxelTool === 'mine' ? '#ff355e' : '#f8fafc', opacity: 0.18 }} position={[selected.x, selected.y, selected.z]} />
        {Object.values({
          xp: { key: 'xp', label: '+X', dx: 1, dy: 0, dz: 0 },
          xn: { key: 'xn', label: '-X', dx: -1, dy: 0, dz: 0 },
          yp: { key: 'yp', label: '+Y', dx: 0, dy: 1, dz: 0 },
          yn: { key: 'yn', label: '-Y', dx: 0, dy: -1, dz: 0 },
          zp: { key: 'zp', label: '+Z', dx: 0, dy: 0, dz: 1 },
          zn: { key: 'zn', label: '-Z', dx: 0, dy: 0, dz: -1 },
        }).map((face) => <FaceHandle key={face.key} selected={selected} face={face} active={face.key === s.view.activeFace.key} color={def.color} mine={s.view.voxelTool === 'mine'} />)}
        {activeGroup ? <GroupFaceOverlay group={activeGroup} /> : null}
        {s.view.voxelTool === 'build' ? <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 0.96, height: 0.96, depth: 0.96 }} material={{ color: previewOk ? def.color : '#ff355e', opacity: previewOk ? 0.38 : 0.24 }} position={[preview.x, preview.y, preview.z]} /> : null}
      </Scene3D>
      <Box style={{ position: 'absolute', left: 12, bottom: 12, paddingLeft: 10, paddingRight: 10, paddingTop: 8, paddingBottom: 8, borderRadius: 6, backgroundColor: '#0b1320dd', borderWidth: 1, borderColor: '#27364a' }}>
        <Text fontSize={10} color="#94a3b8" style={{ fontFamily: 'monospace' }}>selected #{selected.id} · {selected.x},{selected.y},{selected.z} · {s.view.activeFace.label} {'>'} {preview.x},{preview.y},{preview.z}</Text>
      </Box>
    </Pressable>
  );
}

function ItemMeshStage(props: { store: ItemStore; sculpt?: boolean }) {
  const s = props.store;
  const params = useMemo(() => s.itemParams, [s.draft.radius, s.draft.amount, s.draft.grid]);
  const dynKey = `wbitem.main~${s.seq}.${s.draft.amount.toFixed(2)}.${s.draft.radius.toFixed(2)}`;
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
    defaults: { dist: 3.4, look: { yaw: 20, pitch: 12 }, flyPose: { pos: [0, 1.4, -3.0], yaw: 0, pitch: -4 }, mode: 'orbit' },
  });
  const pickAt = (sx: number, sy: number) => {
    const r = viewRect.current;
    return pickGrab<ItemSlot>(sx - r.x, sy - r.y, { x: 0, y: 0, width: r.width, height: r.height }, camera.solvedCam(), grabClouds());
  };
  const [grabHover, setGrabHover] = useState<{ gx: number; gy: number; cu: number; cv: number; grabRadius: number; state: 'hover' | 'raise' | 'carve' } | null>(null);
  const grabRef = useRef<null | { hit: GrabHit<ItemSlot>; baseGrid: number[]; axis: ScreenAxis; startX: number; startY: number; delta: number; rx: number; ry: number; lastSync: number; timer: ReturnType<typeof setTimeout> | null; applied: boolean }>(null);
  const startGrab = (hit: GrabHit<ItemSlot>, e: any) => {
    const r = viewRect.current;
    const axisWorld = grabDragAxis(hit, params, instances[0]);
    const axis = screenAxisFor(hit.world, axisWorld, { x: 0, y: 0, width: r.width, height: r.height }, camera.solvedCam());
    const { rx, ry } = stampRadiusUv(s.view.brush, PAINT_W);
    grabRef.current = { hit, baseGrid: s.draft.grid.slice(), axis, startX: Number(e?.x ?? 0), startY: Number(e?.y ?? 0), delta: 0, rx, ry, lastSync: 0, timer: null, applied: false };
    setGrabHover({ gx: hit.gx, gy: hit.gy, cu: hit.cu, cv: hit.cv, grabRadius: hit.grabRadius, state: 'raise' });
  };
  const applyGrabLive = () => {
    const g = grabRef.current;
    if (!g) return;
    g.lastSync = Date.now();
    g.applied = true;
    s.setGrid(applyGrabStamp(g.baseGrid, g.hit.cu, g.hit.cv, g.rx, g.ry, g.delta, s.view.mirror));
    setGrabHover((cur) => (cur ? { ...cur, state: g.delta < 0 ? 'carve' : 'raise' } : cur));
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
      if (g.applied) s.setGrid(g.baseGrid);
    } else {
      s.setGrid(applyGrabStamp(g.baseGrid, g.hit.cu, g.hit.cv, g.rx, g.ry, g.delta, s.view.mirror), { history: true, note: `grab drag · ${g.delta > 0 ? 'raise' : 'carve'}` });
    }
    setGrabHover((cur) => (cur ? { ...cur, state: 'hover' } : cur));
  };
  const previewDown = (e: any) => {
    if (props.sculpt) {
      const hit = pickAt(Number(e?.x ?? 0), Number(e?.y ?? 0));
      if (hit) { startGrab(hit, e); return; }
    }
    camera.orbitDown(e);
  };
  const previewMove = (e: any) => {
    if (grabRef.current) { grabMove(e); return; }
    if (camera.dragging()) { camera.orbitMove(e); return; }
    if (!props.sculpt) return;
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
        <Scene3D.Camera nativeCamera ref={camera.cameraRef} position={camera.bootCam.pos} target={camera.bootCam.target} fov={camera.bootCam.fov} />
        <LabEnvironment preset="studio" ground={false} />
        <Scene3D.Mesh geometry={Geometry.Globe} params={params as any} dynamicKey={dynKey} material={s.draft.color} position={ITEM_PLACEMENT} />
        {s.view.showGrabGrid ? <Scene3D.Mesh geometry={Geometry.Globe} params={shellParams as any} dynamicKey={dynKey.replace('~', '.grid~')} material={{ color: GRAB_TUNING.grid.color, opacity: GRAB_TUNING.grid.opacity }} textureKey={GRAB_GRID_TEXTURE_KEY} position={ITEM_PLACEMENT} /> : null}
        <GrabMarker marker={grabMarker} />
      </Scene3D>
      <Box style={{ position: 'absolute', right: 12, bottom: 12, paddingLeft: 10, paddingRight: 10, paddingTop: 8, paddingBottom: 8, borderRadius: 6, backgroundColor: '#0b1320dd', borderWidth: 1, borderColor: '#27364a' }}>
        <Text fontSize={10} color={T.dim}>{props.sculpt ? 'drag the mesh to pull · wheel zoom · panel edits parameters' : 'orbit/zoom preview · switch to SCULPT to pull the surface'}</Text>
      </Box>
      <GrabGridCapture hover={grabHover} mirror={s.view.mirror} />
    </Pressable>
  );
}

function SculptCanvas(props: { store: ItemStore }) {
  const s = props.store;
  const paint = usePaintable({ id: 'wbitem-sculpt', w: PAINT_W, h: PAINT_H });
  const relief = usePaintable({ id: 'wbitem-relief', w: GRID_W, h: GRID_H });
  const paintingRef = useRef(false);
  const strokeEngineRef = useRef<ReturnType<typeof PAINT.createStrokeEngine> | null>(null);
  const canvasRect = useRef({ x: 0, y: 0, width: EDITOR_W, height: EDITOR_H });
  useEffect(() => { paint.paint.clear(NEUTRAL); }, []);
  useEffect(() => { paint.paint.upload(bytesFromGrid(s.draft.grid)); relief.paint.upload(reliefBytesFromGrid(s.draft.grid)); }, [s.installRev]);
  useEffect(() => { relief.paint.upload(reliefBytesFromGrid(s.draft.grid)); }, [s.draft.grid]);
  const dab = (sx: number, sy: number, pressure?: number) => {
    const engine = strokeEngineRef.current;
    if (!engine) return;
    const r = canvasRect.current;
    const tx = ((sx - r.x) / r.width) * PAINT_W;
    const ty = ((sy - r.y) / r.height) * PAINT_H;
    const value = sculptModeValue(s.view.sculptMode, s.view.strength);
    for (const d of engine.move(tx, ty, pressure)) paint.paint.circle(d.x, d.y, d.radius, value);
  };
  const syncGrid = () => {
    const bytes = paint.paint.readback();
    if (!bytes || bytes.length < PAINT_W * PAINT_H) return;
    s.setGrid(gridFromBytes(bytes), { history: true, note: `sculpt stroke · ${s.view.sculptMode}` });
  };
  const onPaintDown = (e: any) => {
    paintingRef.current = true;
    strokeEngineRef.current = PAINT.createStrokeEngine({ brushPx: s.view.brush, mirrorAxisX: s.view.mirror ? PAINT_W / 2 : null });
    strokeEngineRef.current.begin();
    dab(Number(e?.x ?? 0), Number(e?.y ?? 0), Number(e?.pressure) || undefined);
  };
  const onPaintMove = (e: any) => { if (paintingRef.current) dab(Number(e?.x ?? 0), Number(e?.y ?? 0), Number(e?.pressure) || undefined); };
  const onPaintUp = () => {
    if (!paintingRef.current) return;
    paintingRef.current = false;
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
      style={{ width: EDITOR_W, height: EDITOR_H, borderWidth: 1, borderColor: T.frame, position: 'relative', flexShrink: 0 }}
    >
      <Box style={{ width: EDITOR_W, height: EDITOR_H, backgroundColor: s.draft.color }} />
      <Effect
        shader={DEPTH_OVERLAY_WGSL}
        data={[0]}
        textures={[paint.id, relief.id]}
        style={{ position: 'absolute', left: 0, top: 0, width: EDITOR_W, height: EDITOR_H }}
      />
      <Box style={{ position: 'absolute', left: -99999, top: 0, width: 1, height: 1 }}>
        <Paintable id={paint.id} w={PAINT_W} h={PAINT_H} />
        <Paintable id={relief.id} w={GRID_W} h={GRID_H} />
      </Box>
    </Pressable>
  );
}

function SculptStage(props: { store: ItemStore }) {
  return (
    <Row style={{ flexGrow: 1, minHeight: 0, height: '100%', backgroundColor: T.panelSolid }}>
      <Box style={{ width: EDITOR_W + 24, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }}>
        <SculptCanvas store={props.store} />
      </Box>
      <ItemMeshStage store={props.store} sculpt />
    </Row>
  );
}

export function ItemStage(props: { store: ItemStore; lens: ItemLens }) {
  const s = props.store;
  const [, setTick] = useState(0);
  useEffect(() => s.subscribe(() => setTick((t) => t + 1)), [s]);
  if (props.lens === 'voxel') return <VoxelStage store={s} />;
  if (props.lens === 'sculpt') return <SculptStage store={s} />;
  return <ItemMeshStage store={s} />;
}
