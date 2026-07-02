// WorldViewport — the editor's OWN iso world viewport (req_2486: the LoaderIsoView
// cross-import dies here). A THIN pane over host doors, nothing else:
//
//   render   — the native WorldLoader primitive (world_loader.zig) draws the baked
//              world + the live map-paint layer; JS never touches a mesh.
//   camera   — the cloned IsoStage solves the Sims-style pose; ONLY the 8-float
//              pose crosses per interaction (__compiled_world_set_camera).
//   place    — clicks grid-snap the armed piece, the HOST validates
//              (__game_build_validate via runtime/game/build.ts), and the placed
//              list re-packs into the live overlay (__compiled_world_set_live_pieces).
//   paint    — while the Map Paint tool is armed, the host claims the pointer
//              (__compiled_world_set_paint_mode) — zero JS per dab.
//   floors   — the ACTIVE LEVEL is a prop; the workspace action bar is the one
//              control (req_2485 — the floating Ground chip died with the old pane).
//
// Deliberately NOT here (they die with hmsc-int or arrive by door): the TS build
// brain (host-ported, req_2349), prefab stamping, skins, cooked-asset residency,
// selection/move — each returns as a door-driven slice when the palette needs it.
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { Box, Graph, Pressable } from '@reactjit/primitives';
import { IsoStage, METERS_PER_LEVEL, type Rect } from './isoStage';
import { pieceRows, resolvePlacement, PIECE_LOOKS, type ArmedPiece, type PlacedPiece } from './pieces';

const g: any = globalThis;

type Snap = { x: number; y: number; z: number; pieceId: string };

/** Project a box's 12 edges into pane-space polyline segments (the ghost). */
function boxSegments(stage: IsoStage, rect: Rect, cx: number, baseY: number, cz: number, w: number, h: number, d: number): number[] {
  const hw = w / 2;
  const hd = d / 2;
  const corners: [number, number][] = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  const bot = corners.map(([lx, lz]) => stage.project(cx + lx, baseY, cz + lz, rect));
  const top = corners.map(([lx, lz]) => stage.project(cx + lx, baseY + h, cz + lz, rect));
  const segs: number[] = [];
  const edge = (a: { x: number; y: number } | null, b: { x: number; y: number } | null) => {
    if (a && b) segs.push(a.x, a.y, b.x, b.y);
  };
  for (let i = 0; i < 4; i += 1) {
    edge(bot[i]!, bot[(i + 1) % 4]!);
    edge(top[i]!, top[(i + 1) % 4]!);
    edge(bot[i]!, top[i]!);
  }
  return segs;
}

export default function WorldViewport(props: {
  gameFile: string;
  storeDir: string;
  pieces: readonly PlacedPiece[];
  armed: ArmedPiece;
  onPlace: (piece: PlacedPiece) => void;
  /** the active storey (0 = Ground) — owned by the action bar's floor control */
  floor: number;
  paintActive: boolean;
}) {
  const loaderRef = useRef<any>(null);
  const rectRef = useRef<Rect>({ x: 0, y: 0, width: 1, height: 1 });
  const stageRef = useRef<IsoStage | null>(null);
  if (!stageRef.current) stageRef.current = new IsoStage({ centerX: 0, centerZ: 0 });
  const stage = stageRef.current;
  const [snap, setSnap] = useState<Snap | null>(null);

  const armedRef = useRef(props.armed);
  armedRef.current = props.armed;

  // Push the JS-solved iso pose to the native loader. Cheap (8 floats) — the only
  // per-interaction bridge traffic; the host re-applies it every embedded frame.
  const pushCamera = useCallback(() => {
    const nodeId = Number(loaderRef.current?.id ?? 0);
    if (!nodeId || typeof g.__compiled_world_set_camera !== 'function') return;
    const s: any = stage.solve();
    g.__compiled_world_set_camera(nodeId, s.pos[0], s.pos[1], s.pos[2], s.target[0], s.target[1], s.target[2], s.fov);
  }, [stage]);

  // Boot: aim the camera once the loader node exists (next tick after mount).
  useEffect(() => {
    const t = setTimeout(pushCamera, 16);
    return () => clearTimeout(t);
  }, [pushCamera]);

  // The active floor lifts the camera target + the pick plane (Sims storeys).
  useEffect(() => {
    stage.setLevel(props.floor);
    pushCamera();
    setSnap(null);
  }, [props.floor, stage, pushCamera]);

  // Arm/disarm in-viewport map painting (host claims the pointer while on).
  useEffect(() => {
    const nodeId = Number(loaderRef.current?.id ?? 0);
    if (!nodeId || typeof g.__compiled_world_set_paint_mode !== 'function') return;
    g.__compiled_world_set_paint_mode(nodeId, props.paintActive ? 1 : 0);
    return () => { g.__compiled_world_set_paint_mode(nodeId, 0); };
  }, [props.paintActive]);

  // Live overlay: placed pieces render as real meshes instantly, no rebake.
  useEffect(() => {
    const nodeId = Number(loaderRef.current?.id ?? 0);
    if (!nodeId || typeof g.__compiled_world_set_live_pieces !== 'function') return;
    g.__compiled_world_set_live_pieces(nodeId, pieceRows(props.pieces));
  }, [props.pieces]);

  // Unmount: drop the loader runtime + its pending camera.
  useEffect(() => () => {
    const nodeId = Number(loaderRef.current?.id ?? 0);
    if (!nodeId) return;
    if (typeof g.__compiled_world_clear_camera === 'function') g.__compiled_world_clear_camera(nodeId);
    if (typeof g.__compiled_world_unmount === 'function') g.__compiled_world_unmount(nodeId);
  }, []);

  const levelY = props.floor > 0 ? props.floor * METERS_PER_LEVEL : 0;

  const resolveSnap = useCallback((px: number, py: number): Snap | null => {
    const armed = armedRef.current;
    if (!armed) return null;
    const gp = stage.groundPoint(px, py, rectRef.current);
    if (!gp) return null;
    const placed = resolvePlacement(armed.pieceId, gp.x, gp.z, levelY);
    return placed ? { x: placed.x, y: placed.y, z: placed.z, pieceId: placed.pieceId } : null;
  }, [stage, levelY]);

  // ── input: left-drag rotates, shift-drag grabs the map, wheel zooms to the
  // cursor, a click (no travel) places the armed piece. Paint clicks never reach
  // here — the host claims them while the paint tool is armed.
  const dragRef = useRef<{ x: number; x0: number; y0: number; turned: boolean; pan: boolean } | null>(null);
  const local = useCallback((e: any) => {
    const r = rectRef.current;
    return { x: Number(e?.x ?? 0) - r.x, y: Number(e?.y ?? 0) - r.y };
  }, []);

  const onDown = useCallback((e: any) => {
    const p = local(e);
    dragRef.current = { x: p.x, x0: p.x, y0: p.y, turned: false, pan: !!e?.shiftKey };
  }, [local]);

  const onMove = useCallback((e: any) => {
    const p = local(e);
    const d = dragRef.current;
    if (d && Math.abs(p.x - d.x0) + Math.abs(p.y - d.y0) > 4) {
      d.turned = true;
      if (d.pan) {
        stage.dragPan(d.x, d.y0, p.x, p.y, rectRef.current);
        d.y0 = p.y;
      } else {
        stage.rotateBy((p.x - d.x) * 0.3);
      }
      d.x = p.x;
      pushCamera();
      if (armedRef.current) setSnap(resolveSnap(p.x, p.y));
      return;
    }
    if (armedRef.current) setSnap(resolveSnap(p.x, p.y));
  }, [local, stage, pushCamera, resolveSnap]);

  const onUp = useCallback((e: any) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.turned) return;
    const target = resolveSnap(d.x0, d.y0);
    if (target && armedRef.current) {
      props.onPlace({ id: '', pieceId: target.pieceId, x: target.x, y: target.y, z: target.z, yawDegrees: 0 });
    }
  }, [resolveSnap, props.onPlace]);

  const onScroll = useCallback((e: any) => {
    const dy = Number(e?.deltaY ?? 0);
    if (!dy) return;
    const r = rectRef.current;
    const mx = Number(g.getMouseX?.() ?? (r.x + r.width / 2));
    const my = Number(g.getMouseY?.() ?? (r.y + r.height / 2));
    stage.zoomToCursor(mx - r.x, my - r.y, dy > 0 ? 1.15 : 1 / 1.15, r);
    pushCamera();
  }, [stage, pushCamera]);

  // The armed ghost: the piece's box edges projected through the same solve the
  // loader renders with (2D overlay, no second 3D surface).
  const rect = rectRef.current;
  const ghostSegs: number[] = [];
  if (snap) {
    const look = PIECE_LOOKS[snap.pieceId];
    if (look) ghostSegs.push(...boxSegments(stage, rect, snap.x, snap.y, snap.z, look.w, look.h, look.d));
  }

  return (
    <Box
      style={{ width: '100%', height: '100%', position: 'relative', backgroundColor: '#0d141f' }}
      onLayout={(lr: any) => { rectRef.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
    >
      {createElement('WorldLoader', {
        ref: loaderRef,
        gameFile: props.gameFile,
        storeDir: props.storeDir,
        testID: 'editor-world-viewport',
        style: { width: '100%', height: '100%' },
      })}

      {/* 2D projected ghost — identity view, never eats input */}
      {ghostSegs.length ? (
        <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, pointerEvents: 'none', overflow: 'visible' }}>
          <Graph style={{ width: rect.width, height: rect.height }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
            <Graph.Polyline segments points={ghostSegs} stroke="#34d399" strokeWidth={1.6} />
          </Graph>
        </Box>
      ) : null}

      {/* pointer capture (near-transparent so it's hittable) */}
      <Pressable
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onScroll={onScroll}
        style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000001' }}
      />
    </Box>
  );
}
