// camera_lab — the @reactjit/cameras showcase.
//
// ONE scene (a character sculpted from the @reactjit/geometries registry — boxes,
// spheres, cylinders, cones, a torus belt: deliberately *beyond rectangles* — plus
// palms and a building on a ground slab) viewed through every drop-in camera rig.
// Click a rig button and the whole camera swaps in one line; the scene never
// changes. Drag to orbit/aim, WASD to fly (FreeFly), click the ground to drop a
// marker — the marker lands under the cursor under EVERY rig, proving picking
// inverts the active camera with zero per-rig code (the load-bearing point).
//
// Perf note: the scene is memoized (stable element) so swapping/animating the
// camera never re-ships mesh vertices across the bridge, and the animation clock
// only ticks for rigs that actually move (Follow / Cinematic / FreeFly / sway).
// Static rigs (Orbit / Iso / TopDown / FirstPerson) re-render on drag alone.
//
// Ship: ./scripts/ship camera_lab

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Row, Col, Text, Pressable, Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import {
  OrbitCamera, FollowCamera, TopDownCamera, IsometricCamera,
  FirstPersonCamera, FreeFlyCamera, CinematicCamera,
  CAMERAS, solveCamera, unprojectGround, sway,
  type Vec3,
} from '@reactjit/cameras';
import { busOn } from '@reactjit/hooks/useIFTTT';

// ── palette ──────────────────────────────────────────────────────────────────
const PAGE = '#06080f';
const BAR = '#0e1320';
const FRAME = '#1c2435';
const INK = '#e7ecf6';
const DIM = '#8a93a8';
const ACCENT = '#ff9d3d';
const SCENE_BG = '#141d2e';

// character materials
const SKIN = '#caa07a'; const SHIRT = '#c23b8e'; const PANTS = '#272238';
const SHOE = '#15121f'; const HAT = '#e8c14a'; const EYE = '#0a0a12';

// ── procedural test texture for the Humanoid atlas ────────────────────────────
// Targets the Geometry.HUMANOID_ATLAS layout: a 32×32 image split into four
// quadrants — head (top-left) with painted eyes + mouth, arms (top-right) =
// shirt sleeve, torso (bottom-left) = shirt, legs (bottom-right) = pants.
// Each pixel is 8 hex chars (RRGGBBAA); the framework parses the continuous
// string straight onto the GPU. v=0 is the image TOP — crown of head sits at
// y=0 inside the head quadrant; hip sits at y=H-1 inside the torso quadrant.
// The eyes are what move the figure from "smooth pink blob" to "character."
function buildHumanoidAtlasTexture(): { width: number; height: number; hex: string } {
  // 64×64 — quadruples the previous resolution. Bilinear filtering across a
  // 200-screen-pixel head means each texture pixel covers ~3 screen pixels;
  // at 32×32 it was ~6 and any "1-px" mark smeared to a Slender Man blot.
  // The head quadrant is now 32×32 — enough room for crisp 2-px eyes, brows,
  // a small mouth, and a hairline along the crown.
  const W = 64, H = 64;
  const px = (rgb: string, a = 255) => rgb.replace('#', '') + a.toString(16).padStart(2, '0');
  const SKIN_PX = px(SKIN);
  const SHIRT_PX = px(SHIRT);
  const PANTS_PX = px(PANTS);
  const EYE_PX = px(EYE);
  const HAIR_PX = px('#241a18');         // dark band along the crown
  const BROW_PX = px('#3a1f15');         // a touch warmer than the eye, brows over eyes
  const LIP_PX = px('#7a2a3a');
  const COLLAR_PX = px('#8d2a6a');
  const NOSE_PX = px('#a67855');         // tiny nose shadow tick

  // HEAD quadrant: image-x ∈ [0, W/2=32], image-y ∈ [0, H/2=32].
  // With ringVerts starting at -π/2, the SEAM is at -Z (back) → image-x=0 and
  // image-x=W/2-1; the FACE (+Z front) is at image-x = W/4 = 16. v0=0.5,
  // v1=0 for the head rect, so image-y=0 = CROWN, image-y=H/2=32 = NECK.
  const faceCx = W * 0.25;               // ≈ 16
  const eyeY = Math.floor(H * 0.22);     // ~14 — face ring is ~y=16
  const eyeDX = W * 0.07;                // ≈ 4.5 px on each side of face center
  const browY = eyeY - 2;
  const noseY = eyeY + 2;
  const mouthY = eyeY + 5;
  const hairTop = 2;
  const hairBot = 6;
  let hex = '';
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const left = x < W / 2;
      const top = y < H / 2;
      let c: string;
      if (top && left) {
        c = SKIN_PX;
        // hair band — only across the front of the head (skip the back/seam
        // strip so the hairline reads as a fringe, not a wrap-around helmet)
        if (y >= hairTop && y <= hairBot && x >= 6 && x <= 26) c = HAIR_PX;
        // eyes: 2×2 dots
        if (y >= eyeY && y <= eyeY + 1) {
          const eL = faceCx - eyeDX, eR = faceCx + eyeDX;
          if (x >= eL && x <= eL + 1) c = EYE_PX;
          if (x >= eR && x <= eR + 1) c = EYE_PX;
        }
        // brows: short 3-px dashes above each eye
        if (y === browY) {
          const eL = faceCx - eyeDX, eR = faceCx + eyeDX;
          if (x >= eL - 1 && x <= eL + 1) c = BROW_PX;
          if (x >= eR - 1 && x <= eR + 1) c = BROW_PX;
        }
        // tiny nose shadow (1 px) right below center
        if (y === noseY && x === Math.round(faceCx)) c = NOSE_PX;
        // mouth: a neutral 3-px line, not a horror slash
        if (y === mouthY && x >= faceCx - 2 && x <= faceCx + 2) c = LIP_PX;
      } else if (top && !left) {
        c = SHIRT_PX; // ARMS = sleeves
      } else if (!top && left) {
        c = SHIRT_PX;
        // collar line where shirt meets the neck (top edge of torso rect)
        if (y >= H / 2 && y <= H / 2 + 1) c = COLLAR_PX;
      } else {
        c = PANTS_PX; // LEGS
      }
      hex += c;
    }
  }
  return { width: W, height: H, hex };
}

const HUMANOID_TEXTURE = buildHumanoidAtlasTexture();
const BELT = '#2b2638'; const NOSE = '#b8906a';

// ── the character — a parts array, mirroring the thingymajigger/PalmTree shape ─
// (self-contained here; it does NOT import runtime/thingymajigger.tsx). Every
// part picks the geometry that fits: cylinders for limbs, spheres for joints/head,
// a box torso, a torus belt, cones for nose + cap. That's the "sculpting beyond
// rectangles" range the new geometry registry unlocks.
type PartRow = { shape: any; params: any; material: string; offset: Vec3; rotation?: Vec3 };

const HUMANOID: PartRow[] = [
  { shape: Geometry.Cylinder, params: { radius: 0.13, height: 0.9 }, material: PANTS, offset: [-0.16, 0.45, 0] },
  { shape: Geometry.Cylinder, params: { radius: 0.13, height: 0.9 }, material: PANTS, offset: [0.16, 0.45, 0] },
  { shape: Geometry.Sphere, params: { radius: 0.16 }, material: SHOE, offset: [-0.16, 0.07, 0.05] },
  { shape: Geometry.Sphere, params: { radius: 0.16 }, material: SHOE, offset: [0.16, 0.07, 0.05] },
  { shape: Geometry.Box, params: { width: 0.6, height: 0.72, depth: 0.34 }, material: SHIRT, offset: [0, 1.22, 0] },
  { shape: Geometry.Torus, params: { radius: 0.33, tube: 0.07 }, material: BELT, offset: [0, 0.9, 0] },
  { shape: Geometry.Sphere, params: { radius: 0.13 }, material: SHIRT, offset: [-0.36, 1.52, 0] },
  { shape: Geometry.Sphere, params: { radius: 0.13 }, material: SHIRT, offset: [0.36, 1.52, 0] },
  { shape: Geometry.Cylinder, params: { radius: 0.09, height: 0.62 }, material: SHIRT, offset: [-0.44, 1.2, 0] },
  { shape: Geometry.Cylinder, params: { radius: 0.09, height: 0.62 }, material: SHIRT, offset: [0.44, 1.2, 0] },
  { shape: Geometry.Sphere, params: { radius: 0.1 }, material: SKIN, offset: [-0.44, 0.85, 0.02] },
  { shape: Geometry.Sphere, params: { radius: 0.1 }, material: SKIN, offset: [0.44, 0.85, 0.02] },
  { shape: Geometry.Cylinder, params: { radius: 0.08, height: 0.12 }, material: SKIN, offset: [0, 1.64, 0] },
  { shape: Geometry.Sphere, params: { radius: 0.2 }, material: SKIN, offset: [0, 1.84, 0] },
  { shape: Geometry.Box, params: { width: 0.06, height: 0.06, depth: 0.04 }, material: EYE, offset: [-0.08, 1.88, 0.18] },
  { shape: Geometry.Box, params: { width: 0.06, height: 0.06, depth: 0.04 }, material: EYE, offset: [0.08, 1.88, 0.18] },
  { shape: Geometry.Cone, params: { radius: 0.05, height: 0.13 }, material: NOSE, offset: [0, 1.82, 0.2], rotation: [90, 0, 0] },
  { shape: Geometry.Cone, params: { radius: 0.23, height: 0.34 }, material: HAT, offset: [0, 2.12, 0] },
];

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

function Figure({ position, parts }: { position: Vec3; parts: PartRow[] }) {
  return (
    <>
      {parts.map((p, i) => (
        <Scene3D.Mesh
          key={i}
          geometry={p.shape}
          params={p.params}
          material={p.material}
          position={add(position, p.offset)}
          rotation={p.rotation ?? [0, 0, 0]}
        />
      ))}
    </>
  );
}

function PalmTree({ position }: { position: Vec3 }) {
  return (
    <>
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.18, height: 3.2 }} material="#6b4f2a" position={add(position, [0, 1.6, 0])} />
      <Scene3D.Mesh geometry={Geometry.Cone} params={{ radius: 1.1, height: 1.4 }} material="#3f8a4a" position={add(position, [0, 3.6, 0])} />
    </>
  );
}

// ── rigs ───────────────────────────────────────────────────────────────────
const RIGS = ['Orbit', 'Follow', 'TopDown', 'Isometric', 'FirstPerson', 'FreeFly', 'Cinematic'] as const;
type RigName = typeof RIGS[number];

// rigs that move on their own (the clock only ticks for these, + sway)
const ANIMATED: Record<RigName, boolean> = {
  Orbit: false, Follow: true, TopDown: false, Isometric: false,
  FirstPerson: false, FreeFly: true, Cinematic: true,
};
// rigs whose drag aims a free LOOK (yaw+pitch); the rest orbit a target
const LOOK_RIG: Record<RigName, boolean> = {
  Orbit: false, Follow: false, TopDown: false, Isometric: false,
  FirstPerson: true, FreeFly: true, Cinematic: false,
};

const BLURB: Record<RigName, string> = {
  Orbit: 'Third-person orbit — drag to turn (yaw) and tilt (pitch). GTA / RuneScape.',
  Follow: 'Chase cam — trails the subject heading; auto-circles here. No manual yaw.',
  TopDown: 'Tactical overhead, tilted just off vertical. Drag to spin north. Hitman / Schedule-1.',
  Isometric: 'Fixed-angle ARPG view — long lens flattens perspective. Drag spins it.',
  FirstPerson: 'Eye-level, looking at the figure. Drag to aim on BOTH axes.',
  FreeFly: 'Spectator cam — drag to look. WASD flies along the look direction (look up + W = up). Space/Shift (or E/Q) for world up/down.',
  Cinematic: 'Director — hard-cuts between film-grammar shots (hero / over-shoulder / profile / hip / worm / wide / close). Hands-off.',
};

const TARGET: Vec3 = [0, 1, 0]; // the figure's chest — what the orbit rigs look at

export default function CameraLab() {
  const [rig, setRig] = useState<RigName>('Orbit');
  // orbit rigs: azimuth + elevation
  const [orbitYaw, setOrbitYaw] = useState(35);
  const [orbitPitch, setOrbitPitch] = useState(34); // elevation 6..85
  // look rigs (FP/FreeFly): free aim
  const [lookYaw, setLookYaw] = useState(180); // 180 ⇒ faces -Z, toward the figure
  const [lookPitch, setLookPitch] = useState(-6); // up(+) / down(-), -80..80
  const [swayOn, setSwayOn] = useState(false);
  const [marker, setMarker] = useState<{ x: number; y: number } | null>(null);
  const [clock, setClock] = useState(0);

  const rectRef = useRef({ x: 0, y: 0, width: 1000, height: 700 });
  const dragRef = useRef<{ x: number; y: number; dist: number } | null>(null);
  const keysRef = useRef<Record<string, boolean>>({});
  const freeRef = useRef<Vec3>([0, 5, 16]); // FreeFly eye

  // mirror live state into refs so the animation loop never reads stale values
  const rigRef = useRef(rig); rigRef.current = rig;
  const lookYawRef = useRef(lookYaw); lookYawRef.current = lookYaw;
  const lookPitchRef = useRef(lookPitch); lookPitchRef.current = lookPitch;

  // params per rig (degrees everywhere)
  const paramsFor = (name: RigName): any => {
    switch (name) {
      case 'Orbit': return { target: TARGET, yaw: orbitYaw, pitch: orbitPitch, dist: 7, zoom: 1, fov: 55 };
      case 'Follow': return { target: TARGET, heading: clock * 38, distance: 6, height: 3, lookHeight: 1.1, fov: 55 };
      case 'TopDown': return { target: TARGET, height: 13, tilt: 12, heading: orbitYaw, fov: 50 };
      case 'Isometric': return { target: TARGET, yaw: orbitYaw, dist: 17, fov: 26 };
      case 'FirstPerson': return { position: [0, 0, 5.5], eyeHeight: 1.7, facing: lookYaw, pitch: lookPitch, fov: 72 };
      case 'FreeFly': return { position: freeRef.current, yaw: lookYaw, pitch: lookPitch, fov: 62 };
      case 'Cinematic': return { subject: { pos: [0, 0, 0], facing: 0 }, t: clock };
      default: return {};
    }
  };
  const mods = () => (swayOn ? [sway(1, clock)] : []);

  // ── animation + input loop — ONLY runs for animated rigs / sway ──────────────
  useEffect(() => {
    const needsClock = ANIMATED[rig] || swayOn;
    // always listen for keys (cheap); only spin the clock when something moves
    // Shift/Ctrl/Alt never come through as a `key` name in the bus payload —
    // the runtime decoder (runtime/hooks/useIFTTT.ts decodeKey) routes them to
    // `sdl:<scancode>` because they're not in SDL_KEY_NAMES. The MODIFIER flags
    // on every event (shiftKey/ctrlKey/altKey) are how you actually detect a
    // held modifier — including on the modifier's own keydown/keyup. Track
    // them as `__shift`/`__ctrl`/`__alt` so callers can read them by intent.
    const setk = (e: any, v: boolean) => {
      const k = String(e?.key ?? '').toLowerCase();
      if (k) keysRef.current[k] = v;
      if (typeof e?.shiftKey === 'boolean') keysRef.current['__shift'] = e.shiftKey;
      if (typeof e?.ctrlKey === 'boolean')  keysRef.current['__ctrl']  = e.ctrlKey;
      if (typeof e?.altKey === 'boolean')   keysRef.current['__alt']   = e.altKey;
    };
    const offD = busOn('__keydown', (e: any) => setk(e, true));
    const offU = busOn('__keyup', (e: any) => setk(e, false));
    if (!needsClock) return () => { offD(); offU(); };

    const g: any = globalThis;
    const sched = g.requestAnimationFrame ? g.requestAnimationFrame.bind(g) : (fn: any) => setTimeout(fn, 16);
    let alive = true;
    let last = g.performance?.now?.() ?? Date.now();
    const loop = () => {
      if (!alive) return;
      const now = g.performance?.now?.() ?? Date.now();
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (rigRef.current === 'FreeFly') {
        const k = keysRef.current; const sp = 11 * dt;
        // Match the FPS yaw convention used by the lookForward rig: forward
        // includes pitch so W flies along the actual look direction (look up,
        // W goes up); strafe stays horizontal so A/D never make you sink.
        const yr = lookYawRef.current * Math.PI / 180;
        const pr = lookPitchRef.current * Math.PI / 180;
        const cp = Math.cos(pr);
        const fx = -Math.sin(yr) * cp;
        const fy = Math.sin(pr);
        const fz = Math.cos(yr) * cp;
        const rx = -Math.cos(yr); // camera-right (horizontal): up × (eye-target)
        const rz = -Math.sin(yr);
        let [x, y, z] = freeRef.current;
        if (k['w']) { x += fx * sp; y += fy * sp; z += fz * sp; }
        if (k['s']) { x -= fx * sp; y -= fy * sp; z -= fz * sp; }
        if (k['d']) { x += rx * sp; z += rz * sp; }
        if (k['a']) { x -= rx * sp; z -= rz * sp; }
        // world-Y override — Q/E (Unity/Unreal scene-cam) AND Space/Shift (FPS
        // creative fly). Shift comes through as a modifier flag (__shift), not
        // a 'shift' key name — the runtime decoder routes non-ASCII keys to
        // sdl:<scancode>. Same reason space is 'space', never ' '.
        if (k['e'] || k['space']) y += sp;
        if (k['q'] || k['__shift']) y -= sp;
        freeRef.current = [x, y, z];
      }
      setClock((c) => c + dt);
      sched(loop);
    };
    sched(loop);
    return () => { alive = false; offD(); offU(); };
  }, [rig, swayOn]);

  // ── drag = orbit/aim ; tap (no drag) = ground pick ──────────────────────────
  const onDown = (e: any) => { dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0), dist: 0 }; };
  const onMove = (e: any) => {
    const d = dragRef.current; if (!d) return;
    const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
    const dx = nx - d.x, dy = ny - d.y;
    d.dist += Math.abs(dx) + Math.abs(dy);
    d.x = nx; d.y = ny;
    if (LOOK_RIG[rig]) {
      setLookYaw((v) => v + dx * 0.4);
      setLookPitch((v) => Math.max(-80, Math.min(80, v - dy * 0.3)));
    } else {
      setOrbitYaw((v) => v + dx * 0.4);
      setOrbitPitch((v) => Math.max(6, Math.min(85, v - dy * 0.3)));
    }
  };
  const onUp = (e: any) => {
    const d = dragRef.current; dragRef.current = null;
    if (d && d.dist < 6) {
      // a tap, not a drag → pick the ground under the cursor using the SAME
      // Solved the active <*Camera> rendered. Works for every rig unchanged.
      const r = rectRef.current;
      const sx = Number(e?.x ?? 0) - r.x;
      const sy = Number(e?.y ?? 0) - r.y;
      const solved = solveCamera(CAMERAS[rig], paramsFor(rig), mods());
      setMarker(unprojectGround(sx, sy, r, solved));
    }
  };

  const camera = () => {
    const p = { ...paramsFor(rig), modifiers: mods() };
    switch (rig) {
      case 'Orbit': return <OrbitCamera {...p} />;
      case 'Follow': return <FollowCamera {...p} />;
      case 'TopDown': return <TopDownCamera {...p} />;
      case 'Isometric': return <IsometricCamera {...p} />;
      case 'FirstPerson': return <FirstPersonCamera {...p} />;
      case 'FreeFly': return <FreeFlyCamera {...p} />;
      case 'Cinematic': return <CinematicCamera {...p} />;
      default: return null;
    }
  };

  // ── the static scene — memoized to a STABLE element so camera changes never
  // re-ship its mesh vertices across the bridge (the source of the orbit lag).
  const scene = useMemo(() => (
    <>
      <Scene3D.AmbientLight color="#5b6488" intensity={0.7} />
      <Scene3D.DirectionalLight direction={[0.5, 0.9, 0.35]} color="#ffd9a8" intensity={0.85} />
      <Scene3D.PointLight position={[6, 6, 6]} color="#ff5fae" intensity={0.45} />
      <Scene3D.PointLight position={[-7, 5, -4]} color="#39d6ff" intensity={0.35} />
      {/* ground slab (thin box, not a plane — a plane back-face-culls top-down) */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 44, height: 0.2, depth: 44 }} material="#222a40" position={[0, -0.1, 0]} />
      {/* LEFT: the parts-based figure (18 separate primitives — see the seams). */}
      <Figure position={[-1.5, 0, 0]} parts={HUMANOID} />
      {/* RIGHT: the same character as ONE authored low-poly mesh — N64/PS1
          register. Same registry path as Box/Sphere/etc., just a hand-shaped
          generator instead of a math solid. No internal surfaces, no seams. */}
      <Scene3D.Mesh
        geometry={Geometry.Humanoid}
        params={{ height: 2.0, shoulderWidth: 0.72, hipWidth: 0.46, headSize: 0.24, limbThickness: 1.0, sides: 10, smoothShading: true }}
        material="#ffffff"
        texture={HUMANOID_TEXTURE}
        position={[1.5, 0, 0]}
      />
      <PalmTree position={[5, 0, -3]} />
      <PalmTree position={[-6, 0, -5]} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 3, height: 4.5, depth: 3 }} material="#3a4668" position={[-7.5, 2.25, 5]} />
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 1.4, height: 2.6 }} material="#684a72" position={[7, 1.3, 5.5]} />
    </>
  ), []);

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: PAGE, flexDirection: 'column' }}>
      {/* control bar */}
      <Col style={{ backgroundColor: BAR, borderColor: FRAME, borderBottomWidth: 1, padding: 12, gap: 8 }}>
        <Row style={{ gap: 10, alignItems: 'baseline' }}>
          <Text fontSize={15} color={INK} style={{ fontWeight: 'bold', letterSpacing: 0.6 }}>CAMERA LAB</Text>
          <Text fontSize={11} color={DIM}>@reactjit/cameras — one scene, every drop-in rig</Text>
        </Row>
        <Row style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {RIGS.map((name) => {
            const on = name === rig;
            return (
              <Pressable
                key={name}
                onPress={() => { setRig(name); setMarker(null); }}
                style={{
                  paddingTop: 5, paddingBottom: 5, paddingLeft: 11, paddingRight: 11,
                  borderRadius: 6, borderWidth: 1,
                  borderColor: on ? ACCENT : FRAME,
                  backgroundColor: on ? '#2a1d10' : '#141a28',
                }}
              >
                <Text fontSize={12} color={on ? ACCENT : INK} style={{ fontWeight: on ? 'bold' : 'normal' }}>{name}</Text>
              </Pressable>
            );
          })}
          <Box style={{ width: 14 }} />
          <Pressable
            onPress={() => setSwayOn((v) => !v)}
            style={{
              paddingTop: 5, paddingBottom: 5, paddingLeft: 11, paddingRight: 11,
              borderRadius: 6, borderWidth: 1,
              borderColor: swayOn ? '#3fc4c0' : FRAME,
              backgroundColor: swayOn ? '#0e2422' : '#141a28',
            }}
          >
            <Text fontSize={12} color={swayOn ? '#3fc4c0' : DIM}>sway {swayOn ? 'on' : 'off'}</Text>
          </Pressable>
          <Pressable
            onPress={() => { setOrbitYaw(35); setOrbitPitch(34); setLookYaw(180); setLookPitch(-6); freeRef.current = [0, 5, 16]; setMarker(null); }}
            style={{ paddingTop: 5, paddingBottom: 5, paddingLeft: 11, paddingRight: 11, borderRadius: 6, borderWidth: 1, borderColor: FRAME, backgroundColor: '#141a28' }}
          >
            <Text fontSize={12} color={DIM}>reset</Text>
          </Pressable>
        </Row>
        <Text fontSize={11} color={DIM}>{BLURB[rig]} · tap the ground to drop a marker (picking inverts the active camera)</Text>
      </Col>

      {/* the scene — Pressable captures layout rect + drag/tap for picking */}
      <Pressable
        onLayout={(lr: any) => { rectRef.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        style={{ flexGrow: 1, position: 'relative', overflow: 'hidden' }}
      >
        <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={SCENE_BG} showGrid={false} showAxes={false}>
          {camera()}
          {scene}
          {marker ? (
            <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.45, height: 0.1 }} material={ACCENT} position={[marker.x, 0.06, marker.y]} />
          ) : null}
        </Scene3D>
      </Pressable>
    </Box>
  );
}
