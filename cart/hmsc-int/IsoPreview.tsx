// The 3D preview pane: a live, free-fly ("no-clip") view of the painted world,
// drawn by the game's own renderer. Paint in the 2D top-down map (left); this
// mirrors it in 3D — fly around at ground level to inspect.
//
// Camera: a FreeFly rig you drive yourself — drag to look (yaw/pitch), WASD to fly
// along the look direction, Q/E (or Space/Shift) for world up/down. Movement only
// applies while the pointer is over THIS pane, so typing elsewhere (notes) never
// moves the camera. Fog is OFF and the far clip is pushed way out, so the ground
// reads as solid ground instead of fading into the sky.
//
// Floors: ONE slab mesh per focused chunk, textured by a STABLE per-chunk capture
// (keyed by chunk coord) of that chunk's per-cell tile field — the SAME shader the
// 2D canvas uses. Stable keys matter: the earlier per-rectangle captures churned
// their bind groups every paint and crashed wgpu mid-draw. Painting now just
// re-bakes a chunk's texture in place.

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Effect, Pressable, Scene3D, Text, StaticSurface } from '@reactjit/primitives';
import { Heightfield } from '@reactjit/geometries';
import { busOn } from '@reactjit/hooks/useIFTTT';
import type { GameState } from '../hmsc/design';
import { WorldStatics } from '../hmsc/render3d/GameWorld3D';
import { floorTextureKey } from '../hmsc/render3d/tileSurface';
import { TILE_FIELD_WGSL } from './tileField.wgsl';
import { chunkFloorId, type ChunkFloor } from './chunkFloor';
import { CHUNK_TILES } from './chunks';

type Vec3 = [number, number, number];

const FLY_SPEED = 45; // metres / second (a chunk is 120m across)
const FAR_CLIP = 4000; // metres — push the cull plane far past the world so nothing clips
const FOV = 65;

// Capture resolution per chunk: ~4px per 1m tile over a 120-tile chunk. Well under
// any window framebuffer (a capture can't exceed it — see tileSurface).
const CAP_PX = 480;

// One chunk's floor texture: its per-cell tile field captured offscreen, keyed by
// chunk so the texture (and its bind group) persists across paints — only the
// contents re-bake. Identities stabilized so an unrelated re-render does not commit
// an Effect UPDATE that would re-bake every frame.
const ChunkFloorCapture = memo(function ChunkFloorCapture(props: { cx: number; cz: number; tileData: number[] }) {
  const surfaceStyle = useMemo(() => ({ position: 'absolute' as const, left: -99999, top: 0, width: CAP_PX, height: CAP_PX }), []);
  const effectStyle = useMemo(() => ({ width: CAP_PX, height: CAP_PX }), []);
  return (
    <StaticSurface staticKey={floorTextureKey(chunkFloorId(props.cx, props.cz))} style={surfaceStyle}>
      <Effect shader={TILE_FIELD_WGSL} data={props.tileData} style={effectStyle} />
    </StaticSurface>
  );
});

// The 2D offscreen textures (one per focused chunk). Memoized on tileData so a
// height-only stroke (tileData unchanged) never re-bakes the texture.
const ChunkFloorCaptures = memo(function ChunkFloorCaptures(props: { floors: ChunkFloor[] }) {
  return (
    <>
      {props.floors.map((f) => (
        <ChunkFloorCapture key={chunkFloorId(f.cx, f.cz)} cx={f.cx} cz={f.cz} tileData={f.tileData} />
      ))}
    </>
  );
});

// One displaced floor mesh per focused chunk: a Heightfield slab displaced by the
// chunk's height samples, textured by its tile capture. params is memoized on the
// heights identity (stable from the painter's cache) so a tile-only stroke never
// regenerates the mesh.
const ChunkFloorMesh = memo(function ChunkFloorMesh(props: { cx: number; cz: number; heights: number[]; hcols: number; hrows: number; hver: number }) {
  const params = useMemo(
    () => ({ heights: props.heights, cols: props.hcols, rows: props.hrows, width: CHUNK_TILES, depth: CHUNK_TILES, base: 0.3 }),
    [props.heights, props.hcols, props.hrows],
  );
  const position = useMemo<Vec3>(
    () => [props.cx * CHUNK_TILES + CHUNK_TILES / 2, 0, props.cz * CHUNK_TILES + CHUNK_TILES / 2],
    [props.cx, props.cz],
  );
  // Live geometry: a stable per-chunk slot id + a version that bumps each edit, so
  // the host overwrites one reused vertex slot instead of leaking a new one.
  return (
    <Scene3D.Mesh
      geometry={Heightfield}
      params={params}
      dynamicKey={`${chunkFloorId(props.cx, props.cz)}~${props.hver}`}
      material="#ffffff"
      textureKey={floorTextureKey(chunkFloorId(props.cx, props.cz))}
      position={position}
    />
  );
});

const ChunkFloorMeshes = memo(function ChunkFloorMeshes(props: { floors: ChunkFloor[] }) {
  return (
    <>
      {props.floors.map((f) => (
        <ChunkFloorMesh key={chunkFloorId(f.cx, f.cz)} cx={f.cx} cz={f.cz} heights={f.heights} hcols={f.hcols} hrows={f.hrows} hver={f.hver} />
      ))}
    </>
  );
});

export const IsoPreview = memo(function IsoPreview(props: { state: GameState; floors: ChunkFloor[] }) {
  const { state, floors } = props;
  const world = state.world;

  // ── Free-fly camera ─────────────────────────────────────────────────────────
  // Look (yaw/pitch) is state so a drag re-renders; position is a ref the movement
  // loop integrates, with a tick to re-render on motion. Start above + south of the
  // seed chunk, looking down the -Z axis at it.
  const [look, setLook] = useState({ yaw: 180, pitch: -18 });
  const lookRef = useRef(look); lookRef.current = look;
  const posRef = useRef<Vec3>([CHUNK_TILES / 2, 48, CHUNK_TILES / 2 + 150]);
  const [, bumpTick] = useState(0);
  const keysRef = useRef<Record<string, boolean>>({});
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [active, setActive] = useState(false); // pointer over this pane → keyboard drives the cam
  const activeRef = useRef(active); activeRef.current = active;

  // Key bus (always listening; cheap). Shift arrives as a modifier flag, not a key.
  useEffect(() => {
    const setk = (e: any, v: boolean) => {
      const k = String(e?.key ?? '').toLowerCase();
      if (k) keysRef.current[k] = v;
      if (typeof e?.shiftKey === 'boolean') keysRef.current['__shift'] = e.shiftKey;
    };
    const offD = busOn('__keydown', (e: any) => setk(e, true));
    const offU = busOn('__keyup', (e: any) => setk(e, false));
    return () => { offD(); offU(); };
  }, []);

  // Movement loop — only while the pane is active. Forward includes pitch (W flies
  // along the look direction); strafe stays horizontal so A/D never sink.
  useEffect(() => {
    if (!active) return;
    const g: any = globalThis;
    const sched = g.requestAnimationFrame ? g.requestAnimationFrame.bind(g) : (fn: any) => setTimeout(fn, 16);
    let alive = true;
    let last = g.performance?.now?.() ?? 0;
    const loop = () => {
      if (!alive) return;
      const now = g.performance?.now?.() ?? (last + 16);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const k = keysRef.current;
      const sp = FLY_SPEED * dt;
      const yr = lookRef.current.yaw * Math.PI / 180;
      const pr = lookRef.current.pitch * Math.PI / 180;
      const cp = Math.cos(pr);
      const fx = -Math.sin(yr) * cp, fy = Math.sin(pr), fz = Math.cos(yr) * cp;
      const rx = -Math.cos(yr), rz = -Math.sin(yr);
      let [x, y, z] = posRef.current; let moved = false;
      if (k['w']) { x += fx * sp; y += fy * sp; z += fz * sp; moved = true; }
      if (k['s']) { x -= fx * sp; y -= fy * sp; z -= fz * sp; moved = true; }
      if (k['d']) { x += rx * sp; z += rz * sp; moved = true; }
      if (k['a']) { x -= rx * sp; z -= rz * sp; moved = true; }
      if (k['e'] || k['space']) { y += sp; moved = true; }
      if (k['q'] || k['__shift']) { y -= sp; moved = true; }
      if (moved) { posRef.current = [x, y, z]; bumpTick((t) => t + 1); }
      sched(loop);
    };
    sched(loop);
    return () => { alive = false; };
  }, [active]);

  // Drag = look; hovering the pane = active (so WASD flies). Same node for down+move
  // so pointer capture carries the drag.
  const onDown = (e: any) => { dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) }; setActive(true); };
  const onMove = (e: any) => {
    if (!activeRef.current) setActive(true);
    const d = dragRef.current; if (!d) return;
    const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
    const dx = nx - d.x, dy = ny - d.y; d.x = nx; d.y = ny;
    setLook((l) => ({ yaw: l.yaw + dx * 0.3, pitch: Math.max(-89, Math.min(89, l.pitch - dy * 0.3)) }));
  };
  const onUp = () => { dragRef.current = null; };
  const onLeave = () => { dragRef.current = null; keysRef.current = {}; setActive(false); };

  // Camera = FreeFly solve: target = eye + look-forward (pitch included).
  const eye = posRef.current;
  const yr = look.yaw * Math.PI / 180, pr = look.pitch * Math.PI / 180, cp = Math.cos(pr);
  const target: Vec3 = [eye[0] - Math.sin(yr) * cp, eye[1] + Math.sin(pr), eye[2] + Math.cos(yr) * cp];

  return (
    <Box style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ChunkFloorCaptures floors={floors} />
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#0a1018" showGrid={false} showAxes={false}>
        <Scene3D.Camera position={eye} target={target} fov={FOV} far={FAR_CLIP} />
        <Scene3D.Fog enabled={false} />
        {/* Floors are our displaced per-chunk meshes; WorldStatics draws the rest
            (skybox, lights, and the placements applied as buildings/props). */}
        <ChunkFloorMeshes floors={floors} />
        <WorldStatics world={world} skyConfig={state.config.sky} />
      </Scene3D>

      {/* Look/fly capture overlay (near-transparent so it's hittable). */}
      <Pressable
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onLeave}
        style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000001' }}
      />
      <Text fontSize={9} color="#475569" style={{ fontFamily: 'monospace', position: 'absolute', left: 8, bottom: 8 }}>
        drag look · WASD fly · Q/E up/down
      </Text>
    </Box>
  );
});
