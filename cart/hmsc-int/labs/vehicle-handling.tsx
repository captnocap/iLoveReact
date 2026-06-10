// labs/vehicle-handling.tsx — the FIRST driving lab: a tunable car you DRIVE.
//
// The ground floor arrives through '@game' (V17 — the only door; labs import
// game/ ONLY). This lab drives GAME_DRIVING (the first driving model, born in
// game/driving/) with a GAME_VEHICLE body, GAME_INPUT keys, the GAME_LOOP
// frame clock, and the V23 native camera (GAME_NATIVE_CAMERA — V26 bans JS
// viewport cameras on lab surfaces in hmsc-int). The knobs on the left ARE the
// product: a handling lab is for dialing feel. Notes/contract: the paired
// vehicle-handling.notes.md.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GAME_DRIVING, GAME_VEHICLE, GAME_INPUT, GAME_LOOP, GAME_NATIVE_CAMERA,
  type CarState, type CarTuning, type VehicleDoc, type VehicleStyleId,
} from '@game';
import { Box, Col, Row, Text, Pressable, Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';

const BG = '#0b1320';
const INK = '#e8eef8';
const DIM = '#7e93b4';
const ACCENT = '#38bdf8';
const BOX = { width: 1, height: 1, depth: 1 };
const GROUND = 240; // a wide pad so there is room to actually open it up
const RAD = 180 / Math.PI;
const ORBIT_SPEED = 0.4; // degrees of camera peek per pixel of drag
const REST_PITCH = 18; // the chase cam's resting elevation
const RECENTER_RATE = 1.7; // how fast the peek offset eases back behind the car (1/s)

const STYLE = GAME_VEHICLE.tables.styles;

// The styles offered in the lab + the role that paints each one right.
const DRIVABLE: ReadonlyArray<{ style: VehicleStyleId; role: VehicleDoc['role']; label: string }> = [
  { style: 'sedan', role: 'civilian', label: 'sedan' },
  { style: 'sports', role: 'civilian', label: 'sports' },
  { style: 'pickup', role: 'civilian', label: 'pickup' },
  { style: 'van', role: 'civilian', label: 'van' },
  { style: 'police_car', role: 'police', label: 'police' },
  { style: 'fire_truck', role: 'fire', label: 'fire truck' },
];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function docForStyle(style: VehicleStyleId, role: VehicleDoc['role']): VehicleDoc {
  // Seed off the style so each pick is stable; override style/role to force the
  // exact body the lab asked for (make() otherwise randomizes both).
  const base = GAME_VEHICLE.make(0x5eed ^ style.length * 131);
  return { ...base, style, role, damage: {} };
}

/** wheelbase ≈ 58% of overall length — feeds the bicycle model's turn radius. */
const wheelBaseOf = (style: VehicleStyleId) => STYLE[style].length * 0.58;

function geometryFor(kind: 'box' | 'cylinder' | 'sphere') {
  return kind === 'cylinder' ? Geometry.Cylinder : kind === 'sphere' ? Geometry.Sphere : Geometry.Box;
}

// Cone slalom + corner pads: static reference so speed and turning READ. The
// grid alone is too uniform to judge a slide against.
const CONES: Array<[number, number]> = [
  [0, 14], [3, 24], [-3, 34], [3, 44], [-3, 54], [0, 64],
  [14, 0], [-14, 0], [22, 22], [-22, 22], [22, -22], [-22, -22],
];

export default function VehicleHandling() {
  const [pick, setPick] = useState(0);
  const sel = DRIVABLE[pick];
  const doc = useMemo(() => docForStyle(sel.style, sel.role), [sel.style, sel.role]);
  const build = useMemo(() => GAME_VEHICLE.build(doc), [doc]);

  const [tuning, setTuning] = useState<CarTuning>(() => GAME_DRIVING.defaultTuning(wheelBaseOf(sel.style)));
  // When the body changes, keep the dialed feel but adopt the new wheelbase.
  useEffect(() => {
    setTuning((t) => ({ ...t, wheelBase: wheelBaseOf(sel.style) }));
  }, [sel.style]);

  // The live driving state + frame readout. The car/tuning live in refs the
  // frame loop reads; React state carries only what the scene/HUD render.
  const carRef = useRef<CarState>(GAME_DRIVING.makeState(0, 0, 0));
  const tuningRef = useRef(tuning);
  tuningRef.current = tuning;
  const camDistRef = useRef(9);
  // Auto-centering chase cam (GTA-style): the camera trails BEHIND the car's
  // heading (base yaw = heading; orbitalEye sits the eye on -Z at yaw 0 and the
  // car drives +Z at heading 0, so "behind" = heading). Drag only adds a peek
  // OFFSET that eases back to zero, so you always end up oriented behind the
  // car instead of disoriented mid-turn.
  const offsetRef = useRef({ yaw: 0, pitch: 0 });
  const draggingRef = useRef(false);
  const cameraRef = useRef<any>(null);
  const camCtlRef = useRef<ReturnType<typeof GAME_NATIVE_CAMERA.forNode> | null>(null);
  const [frame, setFrame] = useState<{ car: CarState; speed: number; slip: number; gear: 'D' | 'R' | 'N' }>(() => ({ car: carRef.current, speed: 0, slip: 0, gear: 'N' }));

  const resetCar = () => {
    carRef.current = GAME_DRIVING.makeState(0, 0, 0);
    offsetRef.current = { yaw: 0, pitch: 0 }; // snap the camera back behind the car
    setFrame({ car: carRef.current, speed: 0, slip: 0, gear: 'N' });
  };

  // Drag anywhere on the pad to PEEK around — it adds to the look offset, which
  // the frame loop eases back to center. Host-global cursor deltas (no per-node
  // move handler → no capture gaps); a no-op unless a press is active.
  useEffect(() => GAME_INPUT.onCursorMove((e) => {
    if (!draggingRef.current) return;
    const o = offsetRef.current;
    o.yaw = clamp(o.yaw - Number(e?.dx ?? 0) * ORBIT_SPEED, -150, 150);
    o.pitch = clamp(o.pitch - Number(e?.dy ?? 0) * ORBIT_SPEED, -14, 62);
  }), []);

  useEffect(() => {
    const keys = GAME_INPUT.createKeyState();
    let last = GAME_LOOP.now();
    let handle: unknown;
    const tick = () => {
      const t = GAME_LOOP.now();
      const dt = (t - last) / 1000;
      last = t;

      const input = {
        throttle: keys.isDown('w') || keys.isDown('up') ? 1 : 0,
        brake: keys.isDown('s') || keys.isDown('down') ? 1 : 0,
        // A/← steers left on screen, D/→ right (the model's heading-increase is
        // screen-left under this camera, so left keys send positive steer).
        steer: (keys.isDown('a') || keys.isDown('left') ? 1 : 0) + (keys.isDown('d') || keys.isDown('right') ? -1 : 0),
        handbrake: keys.isDown('space'),
        footBrake: keys.shift(), // Shift = firm brake to a stop (no reverse)
      };
      const telem = GAME_DRIVING.step(carRef.current, input, tuningRef.current, dt);

      // V23 native orbit cam: send rig params (target follows the car, yaw/pitch
      // are user-dragged), host owns the per-frame solve + smoothing. Bind
      // lazily once the camera node has an id (ModelViewer pattern).
      if (!camCtlRef.current) {
        const nodeId = Number(cameraRef.current?.id ?? 0);
        if (nodeId) {
          const ctl = GAME_NATIVE_CAMERA.forNode(nodeId);
          ctl.setMode('orbit');
          camCtlRef.current = ctl;
        }
      }
      const car = carRef.current;
      // Ease the peek offset back to center, then trail behind the heading.
      const decay = Math.exp(-RECENTER_RATE * Math.min(dt, 0.05));
      const o = offsetRef.current;
      o.yaw *= decay;
      o.pitch *= decay;
      camCtlRef.current?.setOrbit({
        target: [car.x, 0.8, car.z],
        yaw: car.heading * RAD + o.yaw,
        pitch: clamp(REST_PITCH + o.pitch, 4, 82),
        distance: camDistRef.current,
        fov: 52,
      });

      setFrame({ car: { ...car }, speed: telem.speed, slip: telem.slip, gear: telem.gear });
      handle = GAME_LOOP.scheduleFrame(tick);
    };
    handle = GAME_LOOP.scheduleFrame(tick);
    return () => {
      GAME_LOOP.cancelFrame(handle);
      keys.dispose();
      camCtlRef.current?.disable();
    };
  }, []);

  // World-place every body mesh by the car's pose. The build's nose sits at
  // local -Z, so the assembly yaw is heading + 180°. Front wheels add the
  // steer angle; all wheels add a roll from the odometer (the spokes show it).
  const meshes = useMemo(() => {
    const car = frame.car;
    const phi = car.heading + Math.PI;
    const c = Math.cos(phi), s = Math.sin(phi);
    const phiDeg = phi * RAD;
    const steerDeg = car.steer * RAD;
    const rollDeg = (car.odometer / STYLE[sel.style].wheelR) * RAD;
    return build.meshes.map((m, i) => {
      const [lx, ly, lz] = m.position;
      const [rx, ry, rz] = m.rotation ?? [0, 0, 0];
      const isWheel = m.id.includes('wheel');
      const isFront = m.id === 'front_left_wheel' || m.id === 'front_right_wheel';
      return {
        key: `${m.id}.${i}`,
        geometry: geometryFor(m.kind),
        params: m.params,
        position: [lx * c + lz * s + car.x, ly, -lx * s + lz * c + car.z] as [number, number, number],
        rotation: [rx + (isWheel ? rollDeg : 0), ry + phiDeg + (isFront ? steerDeg : 0), rz] as [number, number, number],
        scale: m.scale,
        material: m.material,
      };
    });
  }, [build, frame.car, sel.style]);

  const speedKmh = Math.abs(frame.speed) * 3.6;

  return (
    <Row style={{ width: '100%', height: '100%', backgroundColor: BG }}>
      {/* ── left: the tuning bench ─────────────────────────────────────────── */}
      <Col style={{ width: 244, height: '100%', backgroundColor: '#0a1120', padding: 12 }}>
        <Text style={{ color: INK, fontSize: 15, marginBottom: 2 }}>vehicle handling</Text>
        <Text style={{ color: DIM, fontSize: 10, marginBottom: 10 }}>first driving model · GAME_DRIVING</Text>

        <Text style={{ color: DIM, fontSize: 10, marginBottom: 4 }}>BODY</Text>
        <Box style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 }}>
          {DRIVABLE.map((d, i) => (
            <Pressable key={d.style} onPress={() => setPick(i)}>
              <Box style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 5, paddingBottom: 5, marginRight: 4, marginBottom: 4, borderRadius: 5, backgroundColor: i === pick ? '#16345a' : '#10203a' }}>
                <Text style={{ color: i === pick ? ACCENT : DIM, fontSize: 11 }}>{d.label}</Text>
              </Box>
            </Pressable>
          ))}
        </Box>

        <Text style={{ color: DIM, fontSize: 10, marginBottom: 4 }}>FEEL</Text>
        <Knob label="engine" value={tuning.enginePower} step={1} min={2} max={40} onSet={(v) => setTuning((t) => ({ ...t, enginePower: v }))} />
        <Knob label="top speed" value={tuning.topSpeed} step={2} min={6} max={90} onSet={(v) => setTuning((t) => ({ ...t, topSpeed: v }))} unit="m/s" />
        <Knob label="brake" value={tuning.brakePower} step={1} min={4} max={50} onSet={(v) => setTuning((t) => ({ ...t, brakePower: v }))} />
        <Knob label="grip" value={tuning.grip} step={0.5} min={0.5} max={16} onSet={(v) => setTuning((t) => ({ ...t, grip: v }))} />
        <Knob label="cornering" value={tuning.corneringDrag} step={0.1} min={0} max={3} onSet={(v) => setTuning((t) => ({ ...t, corneringDrag: v }))} />
        <Knob label="steer" value={tuning.maxSteer} step={0.04} min={0.15} max={1} onSet={(v) => setTuning((t) => ({ ...t, maxSteer: v }))} unit="rad" />
        <Knob label="drag" value={tuning.drag} step={0.0005} min={0} max={0.02} onSet={(v) => setTuning((t) => ({ ...t, drag: v }))} digits={4} />
        <Knob label="cam dist" value={camDistRef.current} step={0.5} min={4} max={20} onSet={(v) => { camDistRef.current = clamp(v, 4, 20); }} />

        <Box style={{ flexGrow: 1 }} />
        <Pressable onPress={resetCar}>
          <Box style={{ padding: 8, borderRadius: 6, backgroundColor: '#16345a', alignItems: 'center', marginBottom: 8 }}>
            <Text style={{ color: ACCENT, fontSize: 12 }}>reset car</Text>
          </Box>
        </Pressable>
        <Text style={{ color: DIM, fontSize: 10 }}>W/↑ throttle · S/↓ brake+reverse</Text>
        <Text style={{ color: DIM, fontSize: 10 }}>Shift brake (stop) · Space handbrake (drift)</Text>
        <Text style={{ color: DIM, fontSize: 10 }}>A/D steer · drag to look · scroll to zoom</Text>
      </Col>

      {/* ── right: the test pad ────────────────────────────────────────────── */}
      <Box style={{ flexGrow: 1, height: '100%', position: 'relative' }}>
        <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={BG} showGrid showAxes={false}>
          <Scene3D.Camera nativeCamera ref={cameraRef} position={[0, 6, -10]} target={[0, 0.8, 0]} fov={52} />
          <Scene3D.AmbientLight color="#b8c9e6" intensity={0.6} />
          <Scene3D.DirectionalLight direction={[0.5, 0.92, 0.3]} color="#fff1c7" intensity={0.95} />
          <Scene3D.PointLight position={[-8, 6, -6]} color="#77caff" intensity={0.32} />
          {/* ground: a thin box (a plane back-face-culls under this camera) */}
          <Scene3D.Mesh geometry={Geometry.Box} params={BOX} material="#10202f" position={[0, -0.05, 0]} scale={[GROUND, 0.1, GROUND]} />
          {CONES.map(([x, z], i) => (
            <Scene3D.Mesh key={`cone-${i}`} geometry={Geometry.Cylinder} params={{ radius: 0.5, height: 1, segments: 14 }} position={[x, 0.4, z]} scale={[0.5, 0.8, 0.5]} material="#f59e0b" />
          ))}
          {meshes.map((m) => (
            <Scene3D.Mesh key={m.key} geometry={m.geometry} params={m.params} position={m.position} rotation={m.rotation} scale={m.scale} material={m.material} />
          ))}
        </Scene3D>

        {/* Transparent input layer: drag orbits the camera, scroll dollies it.
            Below the HUD so the readout stays visible (ModelViewer pattern). */}
        <Pressable
          onMouseDown={() => { draggingRef.current = true; }}
          onMouseUp={() => { draggingRef.current = false; }}
          onScroll={(p: any) => {
            const dz = Number(p?.deltaY ?? 0);
            if (dz) camDistRef.current = clamp(camDistRef.current * (dz > 0 ? 0.9 : 1.111), 4, 20);
          }}
          style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000000' }}
        />

        {/* HUD: the driving readout */}
        <Box style={{ position: 'absolute', left: 16, bottom: 16, flexDirection: 'row', alignItems: 'flex-end' }}>
          <Box style={{ minWidth: 96, padding: 10, borderRadius: 8, backgroundColor: 'rgba(8,14,24,0.78)', marginRight: 10 }}>
            <Text style={{ color: INK, fontSize: 28, fontFamily: 'monospace' }}>{speedKmh.toFixed(0)}</Text>
            <Text style={{ color: DIM, fontSize: 10 }}>km/h</Text>
          </Box>
          <Box style={{ padding: 10, borderRadius: 8, backgroundColor: 'rgba(8,14,24,0.78)' }}>
            <Text style={{ color: frame.gear === 'R' ? '#f87171' : ACCENT, fontSize: 16, fontFamily: 'monospace' }}>{`gear ${frame.gear}`}</Text>
            <Text style={{ color: Math.abs(frame.slip) > 0.35 ? '#fbbf24' : DIM, fontSize: 11, fontFamily: 'monospace' }}>{`slip ${(frame.slip * RAD).toFixed(0)}°`}</Text>
          </Box>
        </Box>
      </Box>
    </Row>
  );
}

function Knob(props: { label: string; value: number; step: number; min: number; max: number; onSet: (v: number) => void; unit?: string; digits?: number }) {
  const fmt = (n: number) => n.toFixed(props.digits ?? (props.step < 1 ? 2 : 0));
  const set = (delta: number) => props.onSet(Math.max(props.min, Math.min(props.max, props.value + delta)));
  return (
    <Row style={{ alignItems: 'center', marginBottom: 6 }}>
      <Text style={{ color: DIM, fontSize: 11, width: 78 }}>{props.label}</Text>
      <Pressable onPress={() => set(-props.step)}>
        <Box style={{ width: 22, height: 22, borderRadius: 4, backgroundColor: '#13243d', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: INK, fontSize: 13 }}>−</Text>
        </Box>
      </Pressable>
      <Box style={{ width: 56, alignItems: 'center' }}>
        <Text style={{ color: INK, fontSize: 11, fontFamily: 'monospace' }}>{fmt(props.value)}</Text>
      </Box>
      <Pressable onPress={() => set(props.step)}>
        <Box style={{ width: 22, height: 22, borderRadius: 4, backgroundColor: '#13243d', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: INK, fontSize: 13 }}>+</Text>
        </Box>
      </Pressable>
      {props.unit ? <Text style={{ color: '#4a5d7e', fontSize: 9, marginLeft: 4 }}>{props.unit}</Text> : null}
    </Row>
  );
}
