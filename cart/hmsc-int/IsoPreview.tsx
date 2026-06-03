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

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Pressable, Scene3D, Text } from '@reactjit/primitives';
import { Heightfield } from '@reactjit/geometries';
import { busOn } from '@reactjit/hooks/useIFTTT';
import type { GameState } from '../hmsc/design';
import { WorldStatics } from '../hmsc/render3d/GameWorld3D';
import { LandformSurfaceCaptures } from '../hmsc/render3d/Landform';
import { useChurn } from './perfLog';

type Vec3 = [number, number, number];

const FLY_SPEED = 45; // metres / second (a chunk is 120m across)
const FAR_CLIP = 4000; // metres — push the cull plane far past the world so nothing clips
const FOV = 65;

// Terrain is no longer drawn by a bespoke editor mesh — the cart folds the painted
// chunks into the preview world as REAL heightfield landforms (floorsToLandforms +
// index.tsx previewWorld), so WorldStatics draws them through the game's own
// landform path and LandformSurfaceCaptures bakes their painted tile textures. The
// preview now renders terrain exactly as the booted game will (preview == game),
// and a building/prop sits on the hill under it. This pane just draws the world.

export interface PreviewCamera {
  pos: Vec3;
  yaw: number;
  pitch: number;
}

export interface PreviewCameraApi {
  get: () => PreviewCamera;
}

export const IsoPreview = memo(function IsoPreview(props: {
  state: GameState;
  // WASD-fly focus is owned by the cart (shared with the 2D canvas, which also uses
  // WASD). true = this pane drives the camera; onWasdFocus fires on a click here to
  // claim it. Click-to-focus, never hover — so the cursor passing over the other
  // quad mid-fly can't steal the keys.
  wasdFocused?: boolean;
  onWasdFocus?: () => void;
  // Camera persistence seam (the cart saves it per map). initialCamera seeds the
  // free-fly pose on mount; cameraApiRef exposes the live pose for serialize;
  // onCameraSettle fires ~500ms after motion stops so the cart can autosave it
  // without writing every frame. The cart remounts this pane (key = map) on open,
  // so initialCamera only reads on the first render of each mount.
  initialCamera?: PreviewCamera | null;
  cameraApiRef?: { current: PreviewCameraApi | null };
  onCameraSettle?: () => void;
}) {
  const { state } = props;
  const world = state.world;
  // Churn probe: `state` is the cart's previewWorld. If it changes per stroke, the
  // preview rebuilds + re-bakes landform captures every sync — the choke's far end.
  // (bumpTick/look churn here too, but those are camera-fly, not paint.)
  useChurn('IsoPreview', { state, world, wasdFocused: props.wasdFocused });

  // ── Free-fly camera ─────────────────────────────────────────────────────────
  // Look (yaw/pitch) is state so a drag re-renders; position is a ref the movement
  // loop integrates, with a tick to re-render on motion. Seed from the opened map's
  // saved pose, else start above + south of the seed chunk, looking down -Z at it.
  const [look, setLook] = useState(() => props.initialCamera ? { yaw: props.initialCamera.yaw, pitch: props.initialCamera.pitch } : { yaw: 180, pitch: -18 });
  const lookRef = useRef(look); lookRef.current = look;
  const posRef = useRef<Vec3>(props.initialCamera ? [props.initialCamera.pos[0], props.initialCamera.pos[1], props.initialCamera.pos[2]] : [CHUNK_TILES / 2, 48, CHUNK_TILES / 2 + 150]);
  const [, bumpTick] = useState(0);

  // Expose the live pose + a debounced "camera stopped moving" signal so the cart
  // can save the view without writing on every animation frame.
  const onSettleRef = useRef(props.onCameraSettle);
  onSettleRef.current = props.onCameraSettle;
  if (props.cameraApiRef) props.cameraApiRef.current = { get: () => ({ pos: posRef.current, yaw: lookRef.current.yaw, pitch: lookRef.current.pitch }) };
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSettle = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => { onSettleRef.current?.(); }, 500);
  }, []);
  useEffect(() => () => { if (settleTimer.current) clearTimeout(settleTimer.current); }, []);
  const keysRef = useRef<Record<string, boolean>>({});
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const active = !!props.wasdFocused; // this quad owns WASD (claimed by a click)

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
      if (moved) { posRef.current = [x, y, z]; bumpTick((t) => t + 1); scheduleSettle(); }
      sched(loop);
    };
    sched(loop);
    return () => { alive = false; };
  }, [active]);

  // Click = claim WASD focus (so this quad's keys drive the cam, not the canvas's);
  // drag = look. Same node for down+move+up so pointer capture carries the drag
  // across the whole window — you can rotate past the pane edge without it cutting
  // off. NO hover-activation: the cursor wandering in from another quad must not
  // steal the keys mid-fly; only a click claims focus.
  const onDown = (e: any) => { props.onWasdFocus?.(); dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) }; };
  const onMove = (e: any) => {
    const d = dragRef.current; if (!d) return;
    const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
    const dx = nx - d.x, dy = ny - d.y; d.x = nx; d.y = ny;
    setLook((l) => ({ yaw: l.yaw + dx * 0.3, pitch: Math.max(-89, Math.min(89, l.pitch - dy * 0.3)) }));
    scheduleSettle();
  };
  const onUp = () => { dragRef.current = null; scheduleSettle(); };

  // Camera = FreeFly solve: target = eye + look-forward (pitch included).
  const eye = posRef.current;
  const yr = look.yaw * Math.PI / 180, pr = look.pitch * Math.PI / 180, cp = Math.cos(pr);
  const target: Vec3 = [eye[0] - Math.sin(yr) * cp, eye[1] + Math.sin(pr), eye[2] + Math.cos(yr) * cp];

  return (
    <Box style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Painted-tile textures for the heightfield-landform terrain (offscreen
          captures, the game's own path) — siblings of the Scene3D, like the
          captures HmscGameplayRig mounts in the live game. */}
      <LandformSurfaceCaptures landforms={world.landforms ?? []} />
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#0a1018" showGrid={false} showAxes={false}>
        <Scene3D.Camera position={eye} target={target} fov={FOV} far={FAR_CLIP} />
        <Scene3D.Fog enabled={false} />
        {/* WorldStatics draws everything — terrain (the painted chunks as
            heightfield landforms), skybox, lights, and the placements. */}
        <WorldStatics world={world} skyConfig={state.config.sky} />
      </Scene3D>

      {/* Look/fly capture overlay (near-transparent so it's hittable). */}
      <Pressable
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000001' }}
      />
      <Text fontSize={9} color={active ? '#7dd3fc' : '#475569'} style={{ fontFamily: 'monospace', position: 'absolute', left: 8, bottom: 8 }}>
        {active ? 'drag look · WASD fly · Q/E up/down' : 'click to focus · drag look · WASD fly'}
      </Text>
    </Box>
  );
});
