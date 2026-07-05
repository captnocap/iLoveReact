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
//   select   — off the Place tool, a click host-raycasts the catalog pieces
//              (pickBuildPieceHostHit) and slab-tests authored (model:) pieces in
//              JS (pickAuthoredPlacement — the static catalog can't index them);
//              nearest hit wins. The viewport is MODAL — the armed tool owns the
//              click (req_2550).
//
// Deliberately NOT here (they die with hmsc-int or arrive by door): the TS build
// brain (host-ported, req_2349), prefab stamping, skins, cooked-asset residency,
// piece MOVE (the drag slice lands next) — each returns as a door-driven slice.
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { Box, Graph, Pressable } from '@reactjit/primitives';
import { IsoStage, METERS_PER_LEVEL, type Rect } from './isoStage';
import { pieceInstanceRows, resolvePlacement, pieceLook, pickAuthoredPlacement, type ArmedPiece, type PlacedPiece } from './pieces';
import { pieceSkinBoxes } from './pieceSkins';
import { encodeResidentMeshes, encodeMeshRefs, encodeMeshGhost, type ResidentMesh, type MeshRef } from './meshProps';
import { isAuthoredPiece, type AuthoredBuildPiece } from './authoredRegistry';
import { authoredMeshData } from './authoredMesh';
import { pickBuildPieceHostHit } from '../../../runtime/game/build';
import { ensureMapSeeded } from '../stage/mapPaint';
import { useModifiers } from '@reactjit/runtime/hooks/useModifiers';
import type { WorldTool } from './worldTool';

/** `model:<modelId>` → the stored model id (the resident-mesh + ref key). */
function modelIdOf(pieceId: string): string {
  return pieceId.slice('model:'.length);
}

// WASD camera pan. Distance-scaled so a keypress crosses the same fraction of the view whether
// you're surveying a district or detailing a wall (matches the drag-pan feel). Per ~16ms tick.
const WASD_KEYS = new Set(['w', 'a', 's', 'd']);
const WASD_PAN_PER_TICK = 0.02; // × eye→target distance, metres/tick

const g: any = globalThis;

type Snap = { x: number; y: number; z: number; pieceId: string; yaw: number };

/** Project a box's 12 edges into pane-space polyline segments (the ghost),
 *  rotated by yawDeg about its centre so an edge-snapped wall's ghost lays along
 *  the edge exactly as the placed piece will (req_2569). */
function boxSegments(stage: IsoStage, rect: Rect, cx: number, baseY: number, cz: number, w: number, h: number, d: number, yawDeg = 0): number[] {
  const hw = w / 2;
  const hd = d / 2;
  const a = (yawDeg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const rot = (lx: number, lz: number): [number, number] => [lx * ca - lz * sa, lx * sa + lz * ca];
  const corners: [number, number][] = ([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as [number, number][]).map(([lx, lz]) => rot(lx, lz));
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
  /** the authored (mesh) pieces to keep RESIDENT so their placements can draw. */
  authoredPieces: readonly AuthoredBuildPiece[];
  armed: ArmedPiece;
  /** the modal tool that owns a click: place / select / move / focus (req_2550) */
  tool: WorldTool;
  /** the currently selected placed piece (highlighted), or null */
  selectedId: string | null;
  /** report the piece a Select/Move/Focus click hit (null = clicked empty ground) */
  onSelect: (id: string | null) => void;
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
  // Bumped on every camera move (zoom/rotate/pan) to force the overlays to RE-PROJECT. The
  // placement ghost re-renders for free via setSnap, but the selection box has no such trigger
  // when the tool isn't armed — without this it freezes at its last projection while the world
  // zooms/rotates under it (req_2555).
  const [, bumpCam] = useState(0);
  const reprojectOverlays = useCallback(() => bumpCam((v) => v + 1), []);

  const armedRef = useRef(props.armed);
  armedRef.current = props.armed;
  // Live refs so the once-created pointer callbacks read the current tool / piece list / selection
  // sink without being torn down and rebuilt every render.
  const toolRef = useRef(props.tool);
  toolRef.current = props.tool;
  const piecesRef = useRef(props.pieces);
  piecesRef.current = props.pieces;
  const onSelectRef = useRef(props.onSelect);
  onSelectRef.current = props.onSelect;

  // Push the JS-solved iso pose to the native loader. Cheap (8 floats) — the only
  // per-interaction bridge traffic; the host re-applies it every embedded frame.
  // Returns whether it landed (the node exists + the door is live).
  const pushCamera = useCallback((): boolean => {
    const nodeId = Number(loaderRef.current?.id ?? 0);
    if (!nodeId || typeof g.__compiled_world_set_camera !== 'function') return false;
    const s: any = stage.solve();
    g.__compiled_world_set_camera(nodeId, s.pos[0], s.pos[1], s.pos[2], s.target[0], s.target[1], s.target[2], s.fov);
    return true;
  }, [stage]);

  // Boot: aim the camera as soon as the loader node exists. The node id lands a
  // few frames after mount (host-side create), so retry until the push takes —
  // a single delayed shot missed and left the loader's own default framing
  // (the "zoomed out into nothing" boot, req_2492).
  useEffect(() => {
    if (pushCamera()) return;
    let tries = 0;
    const t = setInterval(() => {
      tries += 1;
      if (pushCamera() || tries > 120) clearInterval(t);
    }, 32);
    return () => clearInterval(t);
  }, [pushCamera]);

  // Boot ground (req_2651 gap XX): seed the map layer as soon as the host map
  // doors are live. Before this, no chunk existed until the user armed Map
  // Paint (the only mapGrowChunk call site), so a fresh editor booted into a
  // VOID — pure skybox, placed floors floating in nothing. The host paint
  // mirror renders any seeded chunk as a real ground slab, so load-or-seed at
  // mount gives boot-time ground + orientation for free. Same retry pattern as
  // the camera boot push above — the doors land a few frames after mount.
  useEffect(() => {
    if (ensureMapSeeded()) return;
    let tries = 0;
    const t = setInterval(() => {
      tries += 1;
      if (ensureMapSeeded() || tries > 120) clearInterval(t);
    }, 32);
    return () => clearInterval(t);
  }, []);

  // The active floor lifts the camera target + the pick plane (Sims storeys).
  useEffect(() => {
    stage.setLevel(props.floor);
    pushCamera();
    setSnap(null);
  }, [props.floor, stage, pushCamera]);

  // WASD camera panning (req_2558) — it worked before the world surface moved to this viewport
  // and never got re-wired. Held keys slide the iso centre along the view's own forward/right
  // axes (stage.nudge), so W is always "into the screen" no matter the facing. A single self-
  // terminating tick loop runs only while a key is held (no idle timer). The engine routes keys
  // to focused inputs first, so this never fights text fields.
  const heldRef = useRef<Set<string>>(new Set());
  const panTimerRef = useRef<any>(null);
  const panStep = useCallback(() => {
    const h = heldRef.current;
    let forward = 0, strafe = 0;
    if (h.has('w')) forward += 1;
    if (h.has('s')) forward -= 1;
    if (h.has('d')) strafe += 1;
    if (h.has('a')) strafe -= 1;
    if (forward || strafe) {
      const step = stage.distance() * WASD_PAN_PER_TICK;
      stage.nudge(forward * step, strafe * step);
      pushCamera();
      reprojectOverlays();
    }
    panTimerRef.current = h.size ? setTimeout(panStep, 16) : null;
  }, [stage, pushCamera, reprojectOverlays]);
  const { onKeyDown: onPanKeyDown, onKeyUp: onPanKeyUp } = useModifiers();
  useEffect(() => {
    const offDown = onPanKeyDown((key) => {
      if (!WASD_KEYS.has(key)) return;
      heldRef.current.add(key);
      if (!panTimerRef.current) panTimerRef.current = setTimeout(panStep, 0);
    });
    const offUp = onPanKeyUp((key) => { heldRef.current.delete(key); });
    return () => {
      offDown(); offUp();
      if (panTimerRef.current) { clearTimeout(panTimerRef.current); panTimerRef.current = null; }
      heldRef.current.clear();
    };
    // Subscribe ONCE on mount: onPanKeyDown/onPanKeyUp just wrap the module key bus and panStep is
    // stable, so re-subscribing per render is both unnecessary and harmful — it would clear the
    // held-key set mid-pan on any unrelated re-render and stall the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (!nodeId || typeof g.__compiled_world_set_live_pieces !== 'function') {
      if (props.pieces.length) console.warn(`[place] live push SKIPPED — node=${nodeId} door=${typeof g.__compiled_world_set_live_pieces}`);
      return;
    }
    g.__compiled_world_set_live_pieces(nodeId, pieceInstanceRows(props.pieces));
    // Real textures (req_2575 Stage B): faces wearing an assigned material push
    // their WGSL shader once, then a skin box per face so the loader samples it
    // over the flat live box. Unskinned faces stay flat. Doors gated behind their
    // presence so an older host without them still renders the flat geometry.
    const skin = pieceSkinBoxes(props.pieces);
    if (typeof g.__compiled_world_set_live_material === 'function') {
      for (const m of skin.materials) g.__compiled_world_set_live_material(nodeId, m.hash, 0, m.wgsl, new Float32Array(m.data), m.opacity);
    }
    if (typeof g.__compiled_world_set_live_skin_boxes === 'function') {
      g.__compiled_world_set_live_skin_boxes(nodeId, skin.boxes);
    }
    // Authored (mesh) pieces render via the live MESH-PROP path (req_2577): one
    // ref per placement pointing at its resident mesh by key. Real geometry.
    if (typeof g.__compiled_world_set_live_mesh_props === 'function') {
      const refs: MeshRef[] = [];
      for (const piece of props.pieces) {
        if (!isAuthoredPiece(piece.pieceId)) continue;
        refs.push({ key: modelIdOf(piece.pieceId), x: piece.x, y: piece.y, z: piece.z, yaw: piece.yawDegrees });
      }
      g.__compiled_world_set_live_mesh_props(nodeId, encodeMeshRefs(refs));
    }
    console.warn(`[place] live push: ${props.pieces.length} pieces (decomposed) + ${skin.materials.length} materials -> loader node ${nodeId}`);
  }, [props.pieces]);

  // Keep the authored meshes RESIDENT so their placements can draw (req_2577).
  // Rebuilds + pushes the MESH_PROPS catalog whenever the authored list changes;
  // retries until the loader node exists (it lands a few frames after mount).
  useEffect(() => {
    const push = (): boolean => {
      const nodeId = Number(loaderRef.current?.id ?? 0);
      if (!nodeId || typeof g.__compiled_world_set_resident_meshes !== 'function') return false;
      const meshes: ResidentMesh[] = [];
      for (const ap of props.authoredPieces) {
        const verts = authoredMeshData(ap.modelId, ap.pkgId);
        if (verts && verts.length >= 8) meshes.push({ key: ap.modelId, vertices: verts });
        else console.warn(`[authored] no mesh data for '${ap.modelId}' (${ap.label}) — not resident (re-open + re-export the model)`);
      }
      g.__compiled_world_set_resident_meshes(nodeId, encodeResidentMeshes(meshes));
      console.warn(`[authored] resident catalog: ${meshes.length} authored mesh(es) -> loader node ${nodeId}`);
      return true;
    };
    if (push()) return;
    let tries = 0;
    const t = setInterval(() => { tries += 1; if (push() || tries > 120) clearInterval(t); }, 32);
    return () => clearInterval(t);
  }, [props.authoredPieces]);

  // Mesh GHOST: while an authored piece is armed in Place mode, preview its real
  // mesh translucently at the snapped cell (the box-outline ghost can't show a
  // mesh). Cleared otherwise. (Catalog pieces keep the projected box ghost.)
  useEffect(() => {
    const nodeId = Number(loaderRef.current?.id ?? 0);
    if (!nodeId) return;
    const armed = props.armed;
    const show = armed && isAuthoredPiece(armed.pieceId) && props.tool === 'place' && snap;
    if (show && typeof g.__compiled_world_set_live_mesh_ghost === 'function') {
      g.__compiled_world_set_live_mesh_ghost(nodeId, encodeMeshGhost({ key: modelIdOf(armed.pieceId), x: snap!.x, y: snap!.y, z: snap!.z, yaw: snap!.yaw }));
    } else if (typeof g.__compiled_world_clear_live_mesh_ghost === 'function') {
      g.__compiled_world_clear_live_mesh_ghost(nodeId);
    }
  }, [snap, props.armed, props.tool]);

  // Unmount: drop the loader runtime + its pending camera.
  useEffect(() => () => {
    const nodeId = Number(loaderRef.current?.id ?? 0);
    if (!nodeId) return;
    if (typeof g.__compiled_world_clear_camera === 'function') g.__compiled_world_clear_camera(nodeId);
    if (typeof g.__compiled_world_unmount === 'function') g.__compiled_world_unmount(nodeId);
  }, []);

  const levelY = props.floor > 0 ? props.floor * METERS_PER_LEVEL : 0;

  // The ground under a pane-local cursor, TERRAIN-AWARE (req_2666): ask the host
  // door first — __compiled_world_ground_hit raycasts the painted heightfield on
  // the brush beam's exact code path (paintGroundHitAt), so a placement lands ON
  // the sculpted mesa the brush just raised instead of burying at the flat y=0
  // plane. The door takes WINDOW coords (getMouseX's space); pane-local px/py
  // convert via the live rect. Falls back to the analytic flat plane
  // (stage.groundPoint, terrainY 0) when the door is absent or the ray misses
  // every painted chunk (off-map) — flat placement behaves exactly as before.
  const groundUnder = useCallback((px: number, py: number): { x: number; z: number; terrainY: number } | null => {
    const r = rectRef.current;
    const nodeId = Number(loaderRef.current?.id ?? 0);
    if (nodeId && typeof g.__compiled_world_ground_hit === 'function') {
      const buf = g.__compiled_world_ground_hit(nodeId, r.x + px, r.y + py);
      if (buf) {
        const hit = new Float32Array(buf);
        if (hit.length >= 3) return { x: hit[0]!, z: hit[2]!, terrainY: hit[1]! };
      }
    }
    const gp = stage.groundPoint(px, py, r);
    return gp ? { x: gp.x, z: gp.z, terrainY: 0 } : null;
  }, [stage]);

  const resolveSnap = useCallback((px: number, py: number): Snap | null => {
    const armed = armedRef.current;
    if (!armed) return null;
    const gp = groundUnder(px, py);
    if (!gp) return null;
    const placed = resolvePlacement(armed.pieceId, gp.x, gp.z, levelY, gp.terrainY);
    return placed ? { x: placed.x, y: placed.y, z: placed.z, pieceId: placed.pieceId, yaw: placed.yawDegrees } : null;
  }, [groundUnder, levelY]);

  // Free-hover ghost tracking (req_2651 gap VV): the framework delivers
  // onMouseMove ONLY under pointer capture (capture starts at mousedown —
  // nodeWantsPointerCapture, framework/engine.zig), so with no button held the
  // armed ghost froze at its last projection until the camera moved. The host's
  // paint brush beam is immune because it polls SDL mouse state per frame
  // (world_loader.zig) — same pattern here: while the Place tool is armed, a
  // self-terminating ~16ms tick (the panStep shape — setTimeout chain, no idle
  // timer when disarmed) reads the global mouse, and re-snaps only while the
  // pointer is inside the pane rect (the ghost clears when it leaves). setSnap
  // is skipped when the resolved snap is unchanged, so an idle pointer causes
  // zero re-renders. The onMove path stays — it is still correct during drags.
  const hoverTimerRef = useRef<any>(null);
  const armedHover = props.tool === 'place' && !!props.armed;
  useEffect(() => {
    if (!armedHover) return;
    const sameSnap = (a: Snap | null, b: Snap | null): boolean =>
      a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z && a.yaw === b.yaw && a.pieceId === b.pieceId);
    const step = () => {
      const r = rectRef.current;
      const mx = Number(g.getMouseX?.() ?? NaN);
      const my = Number(g.getMouseY?.() ?? NaN);
      if (Number.isFinite(mx) && Number.isFinite(my)) {
        const inside = mx >= r.x && mx < r.x + r.width && my >= r.y && my < r.y + r.height;
        const next = inside ? resolveSnap(mx - r.x, my - r.y) : null;
        setSnap((cur) => (sameSnap(cur, next) ? cur : next));
      }
      hoverTimerRef.current = setTimeout(step, 16);
    };
    hoverTimerRef.current = setTimeout(step, 0);
    return () => {
      if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
    };
    // armedHover collapses props.armed (a fresh object every parent render) to a boolean, so the
    // loop tears down only on real disarm/tool change — not on every unrelated re-render.
  }, [armedHover, resolveSnap]);

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
      // Armed → setSnap re-renders (ghost follows). Not armed → force a re-project so the
      // selection box stays glued to its piece as the camera rotates/pans (req_2555).
      if (armedRef.current) setSnap(resolveSnap(p.x, p.y));
      else reprojectOverlays();
      return;
    }
    if (armedRef.current) setSnap(resolveSnap(p.x, p.y));
  }, [local, stage, pushCamera, resolveSnap, reprojectOverlays]);

  const onUp = useCallback((e: any) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) { console.warn('[place] up with no down — click dropped'); return; }
    // req_2548 diagnostic — every way a click can silently place nothing.
    if (d.turned) {
      const p = local(e);
      console.warn(`[place] click ate as DRAG (travel ${Math.abs(p.x - d.x0).toFixed(0)}+${Math.abs(p.y - d.y0).toFixed(0)}px from down)`);
      return;
    }
    // Modal click routing (req_2550): OFF the Place tool a click PICKS the piece under it via the
    // host raycast and highlights it — Select/Move/Focus all just select for now — and never places.
    // This is what makes turning on Focus (etc.) stop dropping pieces. (Focus does NOT pan the
    // camera on the pick: that shifted the JS pose the overlay projects through while the native
    // frame lagged, so the outline landed a tile off, req_2554. Camera-frame is a deferred slice
    // done through a re-render-safe path.)
    const tool = toolRef.current;
    if (tool !== 'place') {
      const ray = stage.worldRay(d.x0, d.y0, rectRef.current);
      // Two pickers, nearest wins: the host raycast covers catalog pieces; authored
      // (model:) placements never reach it — the static catalog can't index them —
      // so they slab-test in JS against their mesh AABB (req_2601).
      const hostHit = ray ? pickBuildPieceHostHit(ray, piecesRef.current, 1000) : null;
      const authoredHit = ray ? pickAuthoredPlacement(ray, piecesRef.current, 1000) : null;
      const host = hostHit ?? null; // undefined = host binding missing → JS pick only
      const best = host && authoredHit ? (host.t <= authoredHit.t ? host : authoredHit) : (host ?? authoredHit);
      onSelectRef.current(best ? best.piece.id : null);
      return;
    }
    if (!armedRef.current) { console.warn('[place] click with nothing armed'); return; }
    // Terrain-aware ground check (req_2666): the same door-first resolve the snap
    // path uses, so the click and its ghost agree about where the ground is.
    const gp = groundUnder(d.x0, d.y0);
    if (!gp) { console.warn(`[place] GROUND MISS at (${d.x0.toFixed(0)},${d.y0.toFixed(0)}) rect=(${rectRef.current.x},${rectRef.current.y} ${rectRef.current.width}x${rectRef.current.height})`); return; }
    const target = resolveSnap(d.x0, d.y0);
    if (!target) { console.warn(`[place] VALIDATOR rejected cell at world (${gp.x.toFixed(1)},${gp.z.toFixed(1)})`); return; }
    console.warn(`[place] click -> place ${target.pieceId} at (${target.x},${target.y},${target.z}) yaw ${target.yaw}`);
    props.onPlace({ id: '', pieceId: target.pieceId, x: target.x, y: target.y, z: target.z, yawDegrees: target.yaw });
  }, [resolveSnap, groundUnder, props.onPlace, local, stage]);

  const onScroll = useCallback((e: any) => {
    const dy = Number(e?.deltaY ?? 0);
    if (!dy) return;
    const r = rectRef.current;
    const mx = Number(g.getMouseX?.() ?? (r.x + r.width / 2));
    const my = Number(g.getMouseY?.() ?? (r.y + r.height / 2));
    stage.zoomToCursor(mx - r.x, my - r.y, dy > 0 ? 1.15 : 1 / 1.15, r);
    pushCamera();
    // The ghost outline is a render-time projection through this stage. Rotate
    // and pan refresh it via onMove's setSnap, but a wheel zoom moves the camera
    // with no render — the loader repaints with the new solve while the overlay
    // keeps the old one (req_2541). Re-snap at the cursor so it reprojects.
    if (armedRef.current) setSnap(resolveSnap(mx - r.x, my - r.y));
    else reprojectOverlays(); // keep the selection box glued through a wheel zoom (req_2555)
  }, [stage, pushCamera, resolveSnap, reprojectOverlays]);

  // The armed ghost: the piece's box edges projected through the same solve the
  // loader renders with (2D overlay, no second 3D surface).
  const rect = rectRef.current;
  const ghostSegs: number[] = [];
  // Only the Place tool shows the placement ghost — otherwise the last snap would linger as a
  // stale outline after switching to Select/Focus/Move (armed is null in those modes).
  if (snap && props.tool === 'place') {
    const look = pieceLook(snap.pieceId);
    if (look) ghostSegs.push(...boxSegments(stage, rect, snap.x, snap.y, snap.z, look.w, look.h, look.d, snap.yaw));
  }
  // The selection highlight: the same projected box around the selected piece (req_2550), so a
  // Select/Move/Focus click shows what it grabbed. Same overlay technique as the ghost. NOT shown
  // in Place mode — there the green placement ghost owns the overlay, and a lingering cyan
  // selection from an earlier pick just reads as a confusing second outline (req_2554).
  const selectedSegs: number[] = [];
  if (props.selectedId && props.tool !== 'place') {
    const sel = props.pieces.find((p) => p.id === props.selectedId);
    const look = sel ? pieceLook(sel.pieceId) : null;
    if (sel && look) selectedSegs.push(...boxSegments(stage, rect, sel.x, sel.y, sel.z, look.w, look.h, look.d, sel.yawDegrees));
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

      {/* Selection highlight — the box around the picked piece (Select/Move/Focus). */}
      {selectedSegs.length ? (
        <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, pointerEvents: 'none', overflow: 'visible' }}>
          <Graph style={{ width: rect.width, height: rect.height }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
            <Graph.Polyline segments points={selectedSegs} stroke="#42d9e8" strokeWidth={2.2} />
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
