// pathing_lab — AI walking/driving on hmsc tiles, pathfinding in the host.
//
// The capability under test: framework/v8_bindings_pathing.zig (__path_*).
// The cart publishes its tile world ONCE — a grid of hmsc tile-kind indices
// plus two cost profiles derived from the REAL hmsc tileKinds definitions
// (walkCost/vehicleCost × movementCost, allowedModes gating) — and from then
// on the host owns A*, waypoint simplification, and the lane offset that
// keeps drivers on their side of the road and walkers on one edge of the
// sidewalk.
//
// Pre-calculated until disrupted: every agent computes its path once and
// follows it. Click the ground to drop/remove a barrier — that patches the
// host grid (one __path_fill_rect), bumps the generation, and ONLY agents
// whose remaining waypoints pass near the change re-ask (pathDisrupted's
// rect-vs-remaining-segments test). Watch the repath counter.
//
// And because this rides everything already built: pedestrians are full
// head_lab figures, cars are the ragdoll_lab sedan — and a car that clips a
// pedestrian hands the body to the verlet ragdoll, which settles, gets back
// up, and asks the host for a fresh path home.
//
// NOTE: __path_* is a Zig binding — the dev host must be REBUILT once after
// this lands (the lab shows a banner if the binding is missing).
//
// Ship: ./scripts/ship pathing_lab      Dev: ./scripts/dev pathing_lab

import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Col, Row, Pressable, Text, Scene3D } from '@reactjit/runtime/primitives';
import * as Geometry from '@reactjit/geometries';
import { OrbitCamera, Orbit, solveCamera, unprojectGround } from '@reactjit/cameras';
import { buildRigFrameFromBones, buildSkeleton, type BoneId, type SkeletonBone } from '../head_lab/parts';
import {
  createRagdoll, stepRagdoll, ragdollImpulse, ragdollMaxMotion, ragdollCenter, bonesFromRagdoll,
  offsetBones, placeBones, blendBones,
  type JointId, type Ragdoll, type V3,
} from '../head_lab/ragdoll';
import { generateFace, hedDepthGrid } from '../head_lab/hed';
import { buildPartRender, CharacterCaptures, FigureMeshes, type PartRender } from '../head_lab/figureRender';
import { CarMeshes } from '../ragdoll_lab/car';
import { TILE_KINDS, tileKindDefinition, type TileKind } from '../hmsc/world/tileKinds';
import { TRAFFIC_SIGNAL_CYCLE, trafficClockSeconds } from '../hmsc/world/traffic';
import {
  publishPathGrid, setPathProfile, findPath, fillPathRect, pathDisrupted, pathGeneration,
  type Path, type PathPoint,
} from '@reactjit/runtime/pathing';
import type { PartId } from '../head_lab/parts';

const BG = '#0b1018';
const INK = '#e8eef8';
const DIM = '#7f93b1';
const GOOD = '#34d399';
const WARN = '#f59e0b';
const BAD = '#ef4444';

const COLS = 44;
const ROWS = 44;
const CELL = 1;
const ORIGIN_X = -22;
const ORIGIN_Z = -22;
const ARENA_HALF = 21.5;

const PED_PROFILE = 0;
const VEH_PROFILE = 1;
const PED_SPEED = 1.5;
const RECOVER_SECONDS = 0.8;

const KIND_INDEX = Object.fromEntries(TILE_KINDS.map((k, i) => [k, i])) as Record<TileKind, number>;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const wrap180 = (d: number) => ((d + 180) % 360 + 360) % 360 - 180;
const cellCenter = (cx: number, cz: number): PathPoint => [ORIGIN_X + (cx + 0.5) * CELL, ORIGIN_Z + (cz + 0.5) * CELL];

function pathHostCompiled(): boolean {
  return typeof (globalThis as any).__path_set_grid === 'function';
}

// ── the world — a small city block authored straight in hmsc tile kinds ─────

// road bands (2 cells wide) + buildings; sidewalks derive as the ring of
// ground cells touching a road, exactly how hmsc streets read.
const ROAD_BANDS = [10, 32]; // band start; covers start..start+1, both axes
const WALL_RECTS: [number, number, number, number][] = [
  [3, 3, 4, 4], [16, 4, 5, 4], [25, 5, 4, 4], [37, 3, 4, 4],
  [4, 17, 4, 5], [18, 16, 7, 3], [26, 20, 4, 6], [37, 17, 4, 4],
  [3, 37, 5, 4], [16, 36, 4, 5], [25, 37, 5, 4], [37, 37, 4, 4],
  [18, 25, 4, 4],
];

// ── junctions + signals — hmsc's traffic clock, the lab's junction boxes ────
// The four places the road bands cross. Lights run hmsc's TRAFFIC_SIGNAL_CYCLE
// off the same steady clock the hmsc lamps glow on: axis 0 (N-S travel) and
// axis 1 (E-W) alternate by a half period, exactly like world/traffic.ts'
// signalPhaseOffsetSeconds.
type Junction = { x0: number; z0: number; x1: number; z1: number };
const JUNCTIONS: Junction[] = ROAD_BANDS.flatMap((bx) => ROAD_BANDS.map((bz) => ({
  x0: ORIGIN_X + bx * CELL,
  z0: ORIGIN_Z + bz * CELL,
  x1: ORIGIN_X + (bx + 2) * CELL,
  z1: ORIGIN_Z + (bz + 2) * CELL,
})));

type SignalPhase = 'go' | 'caution' | 'stop';
function axisPhase(axis: 0 | 1, t: number): SignalPhase {
  const c = TRAFFIC_SIGNAL_CYCLE;
  const tt = (((t + (axis * c.periodSeconds) / 2) % c.periodSeconds) + c.periodSeconds) % c.periodSeconds;
  if (tt < c.goSeconds) return 'go';
  if (tt < c.goSeconds + c.cautionSeconds) return 'caution';
  return 'stop';
}

const LAMP_COLOR: Record<SignalPhase, string> = { go: '#22c55e', caution: '#f59e0b', stop: '#ef4444' };
const LAMP_OFF = '#1d222b';
const LAMP_PARAMS = { width: 0.2, height: 0.18, depth: 0.2 };
const HOUSING_PARAMS = { width: 0.26, height: 0.72, depth: 0.26 };
const POLE_PARAMS = { radius: 0.06, height: 2.3, segments: 8 };

// One pole per junction carrying two 3-lamp heads — one per axis. The lamps
// are live phase readouts, the same value the cars' yield check reads.
function TrafficLights(props: { clock: number }) {
  const phases: [SignalPhase, SignalPhase] = [axisPhase(0, props.clock), axisPhase(1, props.clock)];
  return (
    <>
      {JUNCTIONS.map((j, i) => {
        const px = j.x1 + 0.55;
        const pz = j.z1 + 0.55;
        return (
          <Fragment key={`tl${i}`}>
            <Scene3D.Mesh geometry={Geometry.Cylinder} params={POLE_PARAMS} material="#2a2f3a" position={[px, 1.15, pz]} />
            {([0, 1] as const).map((axis) => {
              const ph = phases[axis];
              const ox = axis === 1 ? -0.3 : 0;
              const oz = axis === 0 ? -0.3 : 0;
              return (
                <Fragment key={`h${axis}`}>
                  <Scene3D.Mesh geometry={Geometry.Box} params={HOUSING_PARAMS} material="#171b22" position={[px + ox, 2.0, pz + oz]} />
                  <Scene3D.Mesh geometry={Geometry.Box} params={LAMP_PARAMS} material={ph === 'stop' ? LAMP_COLOR.stop : LAMP_OFF} position={[px + ox, 2.22, pz + oz]} />
                  <Scene3D.Mesh geometry={Geometry.Box} params={LAMP_PARAMS} material={ph === 'caution' ? LAMP_COLOR.caution : LAMP_OFF} position={[px + ox, 2.0, pz + oz]} />
                  <Scene3D.Mesh geometry={Geometry.Box} params={LAMP_PARAMS} material={ph === 'go' ? LAMP_COLOR.go : LAMP_OFF} position={[px + ox, 1.78, pz + oz]} />
                </Fragment>
              );
            })}
          </Fragment>
        );
      })}
    </>
  );
}

function seededRandom(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

type Strip = { x0: number; z: number; len: number; kind: TileKind };

function buildWorld() {
  const kinds = new Uint16Array(COLS * ROWS).fill(KIND_INDEX.mud);
  const at = (x: number, z: number) => kinds[z * COLS + x];
  const set = (x: number, z: number, k: TileKind) => { kinds[z * COLS + x] = KIND_INDEX[k]; };

  for (const band of ROAD_BANDS) {
    for (let i = 0; i < COLS; i++) {
      for (const o of [0, 1]) {
        set(i, band + o, 'road');
        set(band + o, i, 'road');
      }
    }
  }
  for (const [x0, z0, w, h] of WALL_RECTS) {
    for (let z = z0; z < z0 + h; z++) for (let x = x0; x < x0 + w; x++) set(x, z, 'wall');
  }
  // sidewalks: every mud cell that touches road becomes pavement
  const road = KIND_INDEX.road;
  const mud = KIND_INDEX.mud;
  const sidewalkAt: boolean[] = new Array(COLS * ROWS).fill(false);
  for (let z = 0; z < ROWS; z++) {
    for (let x = 0; x < COLS; x++) {
      if (at(x, z) !== mud) continue;
      const near = (x > 0 && at(x - 1, z) === road) || (x < COLS - 1 && at(x + 1, z) === road)
        || (z > 0 && at(x, z - 1) === road) || (z < ROWS - 1 && at(x, z + 1) === road);
      if (near) sidewalkAt[z * COLS + x] = true;
    }
  }
  for (let i = 0; i < kinds.length; i++) if (sidewalkAt[i]) kinds[i] = KIND_INDEX.sidewalk;

  // bushes scattered on open ground
  const rand = seededRandom(909);
  const bushes: [number, number][] = [];
  let tries = 0;
  while (bushes.length < 16 && tries++ < 400) {
    const x = 1 + Math.floor(rand() * (COLS - 2));
    const z = 1 + Math.floor(rand() * (ROWS - 2));
    if (at(x, z) !== mud) continue;
    set(x, z, 'bush');
    bushes.push([x, z]);
  }

  // goal pools + render strips (run-length merged rows; walls drawn tall)
  const roadCells: [number, number][] = [];
  const walkCells: [number, number][] = [];
  const wallCells: [number, number][] = [];
  const strips: Strip[] = [];
  for (let z = 0; z < ROWS; z++) {
    let x = 0;
    while (x < COLS) {
      const k = at(x, z);
      let len = 1;
      while (x + len < COLS && at(x + len, z) === k) len++;
      const kind = TILE_KINDS[k];
      if (kind !== 'wall') strips.push({ x0: x, z, len, kind });
      for (let i = 0; i < len; i++) {
        if (kind === 'road') roadCells.push([x + i, z]);
        else if (kind === 'sidewalk') walkCells.push([x + i, z]);
        else if (kind === 'wall') wallCells.push([x + i, z]);
      }
      x += len;
    }
  }
  return { kinds, strips, bushes, roadCells, walkCells, wallCells };
}

// Cost-per-kind for the host profile — the SAME formula as hmsc's JS
// movementCostForCell (world/pathing.ts), evaluated once per kind here
// instead of once per A* node there.
function profileCosts(mode: 'walk' | 'drive'): number[] {
  return TILE_KINDS.map((kind) => {
    const def = tileKindDefinition(kind);
    if (!def.pathing.walkable || !def.npc.traversable) return -1;
    if (!def.traversal.allowedModes.includes(mode)) return -1;
    const base = mode === 'drive' ? def.npc.vehicleCost : def.npc.walkCost;
    if (!Number.isFinite(base) || !Number.isFinite(def.pathing.movementCost)) return -1;
    let cost = base * def.pathing.movementCost;
    if (def.door.isDoor) cost += def.door.openCost;
    if (def.traversal.width === 'narrow') cost += 0.22;
    return cost;
  });
}

// ── static world meshes, memo'd hard (they never change after mount) ────────

const WorldMeshes = memo(function WorldMeshes(props: { strips: Strip[]; bushes: [number, number][]; wallCells: [number, number][] }) {
  return (
    <>
      {props.strips.map((st, i) => {
        const def = tileKindDefinition(st.kind);
        const h = Math.max(0.02, def.render.heightMeters);
        const isBush = st.kind === 'bush';
        return (
          <Scene3D.Mesh
            key={`s${i}`}
            geometry={Geometry.Box}
            params={{ width: st.len * CELL, height: isBush ? 0.05 : h, depth: CELL }}
            material={isBush ? '#3b4a33' : def.render.color}
            position={[ORIGIN_X + (st.x0 + st.len / 2) * CELL, (isBush ? 0.05 : h) / 2, ORIGIN_Z + (st.z + 0.5) * CELL]}
          />
        );
      })}
      {props.wallCells.map(([x, z], i) => (
        <Scene3D.Mesh key={`w${i}`} geometry={Geometry.Box} params={{ width: CELL, height: 1.7, depth: CELL }}
          material={(x + z) % 2 === 0 ? '#8b93a3' : '#7e8696'}
          position={[ORIGIN_X + (x + 0.5) * CELL, 0.85, ORIGIN_Z + (z + 0.5) * CELL]} />
      ))}
      {props.bushes.map(([x, z], i) => (
        <Scene3D.Mesh key={`b${i}`} geometry={Geometry.Cone} params={{ radius: 0.34, height: 0.7, segments: 8 }}
          material="#2f6b35" position={[ORIGIN_X + (x + 0.5) * CELL, 0.38, ORIGIN_Z + (z + 0.5) * CELL]} />
      ))}
    </>
  );
});

// ── agents ───────────────────────────────────────────────────────────────────

type PedMode = 'walk' | 'ragdoll' | 'recover';

type Ped = {
  x: number; z: number; yawDeg: number; gait: number;
  path: Path | null; nextIdx: number; goal: PathPoint | null;
  mode: PedMode;
  ragdoll: Ragdoll | null; settleTicks: number;
  recoverStart: number;
  recoverFrom: Record<BoneId, SkeletonBone> | null;
  recoverTarget: Record<BoneId, SkeletonBone> | null;
  charIdx: number;
};

type Car = {
  x: number; z: number; yawDeg: number; cruise: number; tone: string;
  speed: number; // live, eased toward the current limit (yields brake it)
  path: Path | null; nextIdx: number; goal: PathPoint | null;
};

type Barrier = { cx: number; cz: number; prevKind: number };

const CAR_TONES = ['#b3382f', '#2f6bb3', '#caa12f', '#3f9e63', '#7a4fb3', '#b3662f'];
const PED_OUTFITS: [string, string, string[], string][] = [
  ['tee', 'plain', ['cap'], 'jeans'],
  ['hoodie', 'plain', [], 'jeans'],
  ['suit', 'plain', ['shades'], 'slacks'],
  ['tee', 'plain', ['beanie'], 'shorts'],
  ['dress', 'plain', [], 'briefs'],
];

const MAX_CARS = 6;
const MAX_PEDS = 4;

type Sim = {
  cars: Car[];
  peds: Ped[];
  barriers: Barrier[];
  lastGen: number;
  repaths: number;
  hits: number;
  animSeconds: number;
  log: string[];
};

// ── the lab ──────────────────────────────────────────────────────────────────

export default function PathingLab() {
  const [, setTick] = useState(0);
  const [yaw, setYaw] = useState(34);
  const [pitch, setPitch] = useState(42);
  const [dist, setDist] = useState(30);
  const [carCount, setCarCount] = useState(4);
  const [pedCount, setPedCount] = useState(3);
  const [showPaths, setShowPaths] = useState(true);
  const [paused, setPaused] = useState(false);
  const [reckless, setReckless] = useState(false);

  const world = useMemo(() => buildWorld(), []);
  const characters = useMemo(() => {
    return [101, 202, 303, 404].map((seed) => {
      const doc = generateFace(seed, { style: seed % 2 === 0 ? 'feminine' : 'masculine' });
      return { doc, parts: buildPartRender(doc, hedDepthGrid(doc), 'pathlab', seed) };
    });
  }, []);

  const simRef = useRef<Sim>({ cars: [], peds: [], barriers: [], lastGen: 0, repaths: 0, hits: 0, animSeconds: 0, log: [] });
  const uiRef = useRef({ carCount, pedCount, paused, reckless });
  useEffect(() => { uiRef.current = { carCount, pedCount, paused, reckless }; }, [carCount, pedCount, paused, reckless]);
  const orbitRef = useRef<{ x: number; y: number; moved: number } | null>(null);
  const sceneRect = useRef({ x: 0, y: 0, width: 1, height: 1 });
  const camRef = useRef({ yaw, pitch, dist });
  useEffect(() => { camRef.current = { yaw, pitch, dist }; }, [yaw, pitch, dist]);

  const hostReady = pathHostCompiled();

  // publish the world to the host once
  useEffect(() => {
    if (!hostReady) return;
    publishPathGrid({ origin: [ORIGIN_X, ORIGIN_Z], cellSize: CELL, cols: COLS, rows: ROWS, kinds: world.kinds });
    setPathProfile(PED_PROFILE, { costs: profileCosts('walk'), laneOffset: 0.18 });
    setPathProfile(VEH_PROFILE, { costs: profileCosts('drive'), laneOffset: 0.3 });
    simRef.current.lastGen = pathGeneration();
  }, [world, hostReady]);

  // ── the loop ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const host: any = globalThis;
    const schedule = host.requestAnimationFrame ? host.requestAnimationFrame.bind(host) : (fn: any) => setTimeout(fn, 16);
    const cancel = host.cancelAnimationFrame ? host.cancelAnimationFrame.bind(host) : clearTimeout;
    let handle: any = 0;
    let lastNow = host.performance?.now?.() ?? Date.now();
    const rand = seededRandom(7711);

    const pickGoal = (pool: [number, number][], fromX: number, fromZ: number): PathPoint => {
      for (let attempt = 0; attempt < 12; attempt++) {
        const [cx, cz] = pool[Math.floor(rand() * pool.length)];
        const p = cellCenter(cx, cz);
        if (Math.hypot(p[0] - fromX, p[1] - fromZ) > 9) return p;
      }
      const [cx, cz] = pool[Math.floor(rand() * pool.length)];
      return cellCenter(cx, cz);
    };

    const logLine = (s: Sim, line: string) => { s.log = [line, ...s.log].slice(0, 6); };

    const tick = () => {
      const now = host.performance?.now?.() ?? Date.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - lastNow) / 1000));
      lastNow = now;
      const s = simRef.current;
      const ui = uiRef.current;
      s.animSeconds += dt;

      // population control
      while (s.cars.length < ui.carCount) {
        const [cx, cz] = world.roadCells[Math.floor(rand() * world.roadCells.length)];
        const [x, z] = cellCenter(cx, cz);
        s.cars.push({ x, z, yawDeg: Math.floor(rand() * 4) * 90, cruise: 5 + rand() * 2.5, speed: 0, tone: CAR_TONES[s.cars.length % CAR_TONES.length], path: null, nextIdx: 0, goal: null });
      }
      if (s.cars.length > ui.carCount) s.cars.length = ui.carCount;
      while (s.peds.length < ui.pedCount) {
        const [cx, cz] = world.walkCells[Math.floor(rand() * world.walkCells.length)];
        const [x, z] = cellCenter(cx, cz);
        s.peds.push({ x, z, yawDeg: 0, gait: rand(), path: null, nextIdx: 0, goal: null, mode: 'walk', ragdoll: null, settleTicks: 0, recoverStart: 0, recoverFrom: null, recoverTarget: null, charIdx: s.peds.length % characters.length });
      }
      if (s.peds.length > ui.pedCount) s.peds.length = ui.pedCount;

      if (!ui.paused && pathHostCompiled()) {
        // disruption sweep: only when the host generation actually moved
        const gen = pathGeneration();
        if (gen !== s.lastGen) {
          s.lastGen = gen;
          for (const agent of [...s.cars, ...s.peds] as (Car | Ped)[]) {
            if (!agent.path || !agent.goal) continue;
            if (pathDisrupted(agent.path, agent.nextIdx)) {
              const profile = (agent as Ped).mode !== undefined ? PED_PROFILE : VEH_PROFILE;
              agent.path = findPath(profile, [agent.x, agent.z], agent.goal);
              agent.nextIdx = 1;
              s.repaths += 1;
            }
          }
          if (s.repaths > 0) logLine(s, `gen ${gen} — ${s.repaths} repaths total`);
        }

        // cars
        const clock = trafficClockSeconds();
        for (const car of s.cars) {
          if (!car.path) {
            car.goal = pickGoal(world.roadCells, car.x, car.z);
            car.path = findPath(VEH_PROFILE, [car.x, car.z], car.goal);
            car.nextIdx = 1;
            if (!car.path || car.path.points.length < 2) { car.path = null; continue; }
          }
          const pts = car.path.points;
          if (car.nextIdx >= pts.length) { car.path = null; continue; }
          const tgt = pts[car.nextIdx];
          const dx = tgt[0] - car.x;
          const dz = tgt[1] - car.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.55) { car.nextIdx += 1; continue; }
          const desired = Math.atan2(dx, dz) * DEG;
          const err = wrap180(desired - car.yawDeg);
          car.yawDeg += Math.max(-240 * dt, Math.min(240 * dt, err));
          const fx = Math.sin(car.yawDeg * RAD);
          const fz = Math.cos(car.yawDeg * RAD);

          // ── the driver: speed limit = min of every yield reason ─────────
          let limit = car.cruise * (Math.abs(err) > 35 ? 0.38 : 1);

          // pedestrians in the corridor ahead → brake to a stop short of them
          if (!ui.reckless) {
            for (const ped of s.peds) {
              if (ped.mode === 'ragdoll') continue;
              const rx = ped.x - car.x;
              const rz = ped.z - car.z;
              const ahead = rx * fx + rz * fz;
              const lateral = Math.abs(rx * fz - rz * fx);
              if (ahead > 0 && ahead < 4.6 && lateral < 1.35) {
                limit = Math.min(limit, Math.max(0, (ahead - 1.5) * 1.8));
              }
            }
          }
          // car ahead in lane → follow, don't rear-end the red-light queue
          for (const other of s.cars) {
            if (other === car) continue;
            const rx = other.x - car.x;
            const rz = other.z - car.z;
            const ahead = rx * fx + rz * fz;
            const lateral = Math.abs(rx * fz - rz * fx);
            if (ahead > 0 && ahead < 4.6 && lateral < 1.2) {
              limit = Math.min(limit, Math.max(0, (ahead - 2.9) * 2.0));
            }
          }
          // signals: approaching a junction box on a non-go phase → stop at
          // the line; already inside → commit and clear the box
          const axis: 0 | 1 = Math.abs(fx) > Math.abs(fz) ? 1 : 0;
          const phase = axisPhase(axis, clock);
          if (phase !== 'go') {
            for (const j of JUNCTIONS) {
              const inside = car.x > j.x0 - 0.3 && car.x < j.x1 + 0.3 && car.z > j.z0 - 0.3 && car.z < j.z1 + 0.3;
              if (inside) continue;
              let enter: number | null = null;
              if (axis === 1) {
                const dir = fx > 0 ? 1 : -1;
                const dd = ((dir > 0 ? j.x0 : j.x1) - car.x) * dir;
                if (dd >= -0.1 && dd < 3.6 && car.z > j.z0 - 0.7 && car.z < j.z1 + 0.7) enter = dd;
              } else {
                const dir = fz > 0 ? 1 : -1;
                const dd = ((dir > 0 ? j.z0 : j.z1) - car.z) * dir;
                if (dd >= -0.1 && dd < 3.6 && car.x > j.x0 - 0.7 && car.x < j.x1 + 0.7) enter = dd;
              }
              if (enter == null) continue;
              if (phase === 'caution' && enter < 1.2) continue; // too late — roll through
              limit = Math.min(limit, Math.max(0, (enter - 0.9) * 2.2));
            }
          }

          // ease toward the limit: gentle throttle, hard brakes
          const rate = limit > car.speed ? 3.2 : 9.5;
          car.speed += Math.max(-rate * dt, Math.min(rate * dt, limit - car.speed));
          car.x += fx * car.speed * dt;
          car.z += fz * car.speed * dt;

          // clip a pedestrian → hand the body to the ragdoll. Speed-gated:
          // a stopped bumper nudges nobody into orbit.
          if (car.speed > 2.5) {
            for (const ped of s.peds) {
              if (ped.mode !== 'walk') continue;
              if (Math.hypot(ped.x - car.x, ped.z - car.z) > 1.25) continue;
              const local = buildSkeleton('neutral', 'walk', ped.gait % 1);
              const bones = placeBones(local, ped.yawDeg + 180, ped.x, ped.z);
              ped.ragdoll = createRagdoll(bones);
              ped.mode = 'ragdoll';
              ped.settleTicks = 0;
              ped.path = null;
              const kick: JointId[] = ['pelvis', 'chest', 'head', 'lHip', 'rHip'];
              for (const j of kick) {
                ragdollImpulse(ped.ragdoll, j, [
                  fx * car.speed * (1.1 + rand() * 0.4),
                  2.4 + car.speed * 0.25 * (0.6 + rand() * 0.5),
                  fz * car.speed * (1.1 + rand() * 0.4),
                ], dt);
              }
              s.hits += 1;
              logLine(s, `pedestrian clipped at ${Math.round(car.speed * 3.6)} km/h — ragdoll`);
            }
          }
        }

        // pedestrians
        for (const ped of s.peds) {
          if (ped.mode === 'ragdoll' && ped.ragdoll) {
            stepRagdoll(ped.ragdoll, dt, ARENA_HALF);
            if (ragdollMaxMotion(ped.ragdoll) < 0.0025) {
              ped.settleTicks += 1;
              if (ped.settleTicks > 45) {
                const c = ragdollCenter(ped.ragdoll);
                ped.x = c[0];
                ped.z = c[2];
                ped.recoverFrom = bonesFromRagdoll(ped.ragdoll);
                ped.recoverTarget = offsetBones(buildSkeleton('neutral', 'stand'), [ped.x, 0, ped.z]);
                ped.recoverStart = s.animSeconds;
                ped.mode = 'recover';
                ped.ragdoll = null;
                ped.path = null;
              }
            } else {
              ped.settleTicks = 0;
            }
            continue;
          }
          if (ped.mode === 'recover') {
            if (s.animSeconds - ped.recoverStart >= RECOVER_SECONDS) ped.mode = 'walk';
            continue;
          }
          if (!ped.path) {
            ped.goal = pickGoal(world.walkCells, ped.x, ped.z);
            ped.path = findPath(PED_PROFILE, [ped.x, ped.z], ped.goal);
            ped.nextIdx = 1;
            if (!ped.path || ped.path.points.length < 2) { ped.path = null; continue; }
          }
          const pts = ped.path.points;
          if (ped.nextIdx >= pts.length) { ped.path = null; continue; }
          const tgt = pts[ped.nextIdx];
          const dx = tgt[0] - ped.x;
          const dz = tgt[1] - ped.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.3) { ped.nextIdx += 1; continue; }
          const desired = Math.atan2(dx, dz) * DEG;
          ped.yawDeg += Math.max(-360 * dt, Math.min(360 * dt, wrap180(desired - ped.yawDeg)));
          ped.x += Math.sin(ped.yawDeg * RAD) * PED_SPEED * dt;
          ped.z += Math.cos(ped.yawDeg * RAD) * PED_SPEED * dt;
          ped.gait += dt * 1.45;
        }
      }

      setTick((t) => t + 1);
      handle = schedule(tick);
    };

    handle = schedule(tick);
    return () => cancel(handle);
  }, [world, characters]);

  // ── click: drop / remove a barrier (host grid patch → disruption) ─────────
  const toggleBarrierAt = (sx: number, sy: number) => {
    if (!pathHostCompiled()) return;
    const s = simRef.current;
    const cam = solveCamera(Orbit, { target: [0, 0, 0], yaw: camRef.current.yaw, pitch: camRef.current.pitch, dist: camRef.current.dist, fov: 50 });
    const hit = unprojectGround(sx - sceneRect.current.x, sy - sceneRect.current.y, sceneRect.current, cam);
    const cx = Math.floor((hit.x - ORIGIN_X) / CELL);
    const cz = Math.floor((hit.y - ORIGIN_Z) / CELL);
    if (cx < 0 || cz < 0 || cx >= COLS || cz >= ROWS) return;
    const existing = s.barriers.findIndex((b) => b.cx === cx && b.cz === cz);
    if (existing >= 0) {
      const b = s.barriers[existing];
      fillPathRect(b.cx, b.cz, 1, 1, b.prevKind);
      s.barriers.splice(existing, 1);
      return;
    }
    const kind = world.kinds[cz * COLS + cx];
    const name = TILE_KINDS[kind];
    if (name !== 'road' && name !== 'sidewalk' && name !== 'mud' && name !== 'sand') return;
    s.barriers.push({ cx, cz, prevKind: kind });
    fillPathRect(cx, cz, 1, 1, KIND_INDEX.wall);
  };

  // orbit drag vs click: a press that barely moves is a barrier toggle
  const onDown = (e: any) => { orbitRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0), moved: 0 }; };
  const onMove = (e: any) => {
    const d = orbitRef.current;
    if (!d) return;
    const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
    d.moved += Math.abs(nx - d.x) + Math.abs(ny - d.y);
    setYaw((v) => v + (nx - d.x) * 0.35);
    setPitch((v) => Math.max(12, Math.min(84, v - (ny - d.y) * 0.25)));
    d.x = nx; d.y = ny;
  };
  const onUp = (e: any) => {
    const d = orbitRef.current;
    orbitRef.current = null;
    if (d && d.moved < 6) toggleBarrierAt(Number(e?.x ?? d.x), Number(e?.y ?? d.y));
  };

  // ── per-frame render derivation ───────────────────────────────────────────
  const s = simRef.current;
  const pedRigs = s.peds.map((ped) => {
    let bones: Record<BoneId, SkeletonBone>;
    if (ped.mode === 'ragdoll' && ped.ragdoll) {
      bones = bonesFromRagdoll(ped.ragdoll);
    } else if (ped.mode === 'recover' && ped.recoverFrom && ped.recoverTarget) {
      const t = Math.min(1, (s.animSeconds - ped.recoverStart) / RECOVER_SECONDS);
      bones = blendBones(ped.recoverFrom, ped.recoverTarget, t * t * (3 - 2 * t));
    } else {
      bones = placeBones(buildSkeleton('neutral', ped.path ? 'walk' : 'stand', ped.gait % 1), ped.yawDeg + 180, ped.x, ped.z);
    }
    const [top, skin, acc, bottom] = PED_OUTFITS[ped.charIdx % PED_OUTFITS.length];
    return buildRigFrameFromBones(bones, 'neutral', top as any, skin as any, acc as any, bottom as any);
  });

  return (
    <Row style={{ width: '100%', height: '100%', backgroundColor: BG }}>
      {/* ── left: lab panel ── */}
      <Col style={{ width: 272, padding: 14, gap: 10 }}>
        <Text fontSize={15} color={INK} style={{ fontWeight: 900 }}>PATHING LAB</Text>
        <Text fontSize={11} color={DIM}>
          {hostReady
            ? 'host A* over hmsc tiles — click the ground to drop a barrier'
            : 'host pathing NOT in this binary — rebuild the dev host (__path_* missing)'}
        </Text>
        {!hostReady ? (
          <Box style={{ padding: 8, borderRadius: 6, borderWidth: 1, borderColor: BAD, backgroundColor: '#2a0f12' }}>
            <Text fontSize={11} color={BAD}>framework changed: run a fresh ./scripts/dev pathing_lab (rebuild)</Text>
          </Box>
        ) : null}
        <Row style={{ gap: 6, alignItems: 'center' }}>
          <Text fontSize={11} color={DIM} style={{ width: 44 }}>cars</Text>
          {[1, 2, 4, 6].map((n) => (
            <Pressable key={n} onPress={() => setCarCount(Math.min(MAX_CARS, n))} style={{ paddingLeft: 9, paddingRight: 9, paddingTop: 5, paddingBottom: 5, borderRadius: 5, borderWidth: 1, borderColor: carCount === n ? GOOD : '#22324a', backgroundColor: '#101a2a' }}>
              <Text fontSize={12} color={carCount === n ? GOOD : DIM}>{String(n)}</Text>
            </Pressable>
          ))}
        </Row>
        <Row style={{ gap: 6, alignItems: 'center' }}>
          <Text fontSize={11} color={DIM} style={{ width: 44 }}>peds</Text>
          {[1, 2, 3, 4].map((n) => (
            <Pressable key={n} onPress={() => setPedCount(Math.min(MAX_PEDS, n))} style={{ paddingLeft: 9, paddingRight: 9, paddingTop: 5, paddingBottom: 5, borderRadius: 5, borderWidth: 1, borderColor: pedCount === n ? GOOD : '#22324a', backgroundColor: '#101a2a' }}>
              <Text fontSize={12} color={pedCount === n ? GOOD : DIM}>{String(n)}</Text>
            </Pressable>
          ))}
        </Row>
        <Row style={{ gap: 6, flexWrap: 'wrap' }}>
          <Pressable onPress={() => setShowPaths((v) => !v)} style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 5, borderWidth: 1, borderColor: showPaths ? '#35d0ff' : '#22324a', backgroundColor: '#101a2a' }}>
            <Text fontSize={12} color={showPaths ? '#35d0ff' : DIM}>show paths</Text>
          </Pressable>
          <Pressable onPress={() => setPaused((v) => !v)} style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 5, borderWidth: 1, borderColor: paused ? WARN : '#22324a', backgroundColor: '#101a2a' }}>
            <Text fontSize={12} color={paused ? WARN : DIM}>{paused ? 'paused' : 'pause'}</Text>
          </Pressable>
          <Pressable onPress={() => setReckless((v) => !v)} style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 5, borderWidth: 1, borderColor: reckless ? BAD : '#22324a', backgroundColor: reckless ? '#2a0f12' : '#101a2a' }}>
            <Text fontSize={12} color={reckless ? BAD : DIM}>reckless drivers</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              const sim = simRef.current;
              for (const b of sim.barriers) fillPathRect(b.cx, b.cz, 1, 1, b.prevKind);
              sim.barriers = [];
            }}
            style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 5, borderWidth: 1, borderColor: '#22324a', backgroundColor: '#101a2a' }}
          >
            <Text fontSize={12} color={DIM}>clear barriers</Text>
          </Pressable>
        </Row>
        <Box style={{ height: 6 }} />
        <Text fontSize={11} color={DIM} style={{ fontWeight: 800 }}>HOST PATHING</Text>
        <Text fontSize={11} color={INK}>{`generation ${s.lastGen} · repaths ${s.repaths} · barriers ${s.barriers.length}`}</Text>
        <Text fontSize={11} color={INK}>{`pedestrians clipped: ${s.hits}`}</Text>
        <Box style={{ height: 6 }} />
        <Text fontSize={11} color={DIM} style={{ fontWeight: 800 }}>EVENTS</Text>
        {s.log.length === 0 ? (
          <Text fontSize={11} color={DIM}>drop a barrier on a busy road…</Text>
        ) : (
          s.log.map((line, i) => <Text key={`${i}.${line}`} fontSize={11} color={i === 0 ? INK : DIM}>{line}</Text>)
        )}
        <Box style={{ flexGrow: 1 }} />
        <Text fontSize={10} color={DIM}>profiles: walkCost/vehicleCost straight from hmsc tileKinds</Text>
        <Text fontSize={10} color={DIM}>lane offset: drivers keep travel-right, walkers hug the edge</Text>
        <Text fontSize={10} color={DIM}>drivers brake for walkers, queue behind cars, stop on red (hmsc signal clock) — toggle reckless for the old chaos</Text>
      </Col>

      {/* ── right: the world ── */}
      <Pressable
        onLayout={(lr: any) => { sceneRect.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        style={{ flexGrow: 1, height: '100%', position: 'relative', overflow: 'hidden' }}
      >
        <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#0e1523">
          <OrbitCamera target={[0, 0, 0]} yaw={yaw} pitch={pitch} dist={dist} fov={50} />
          <Scene3D.Fog enabled={false} />
          <Scene3D.Skybox zenith="#15233c" horizon="#41526f" ground="#0c0f15" sunDir={[0.4, 0.55, 0.3]} sunColor="#ffe7b0" haze={0.22} cloud={0.15} night={0} />
          <Scene3D.AmbientLight color="#9aa8c4" intensity={0.6} />
          <Scene3D.DirectionalLight direction={[0.45, 0.85, 0.3]} color="#fff2d8" intensity={0.85} />

          <WorldMeshes strips={world.strips} bushes={world.bushes} wallCells={world.wallCells} />

          {/* stop lights — hmsc's signal clock, live phase per axis */}
          <TrafficLights clock={trafficClockSeconds()} />

          {/* barriers — orange roadworks blocks at patched cells */}
          {s.barriers.map((b, i) => {
            const [bx, bz] = cellCenter(b.cx, b.cz);
            return (
              <Scene3D.Mesh key={`bar${i}`} geometry={Geometry.Box} params={{ width: 0.85, height: 0.6, depth: 0.85 }}
                material="#e8762f" position={[bx, 0.32, bz]} rotation={[0, 12, 0]} />
            );
          })}

          {/* live paths — flat crumbs along each agent's remaining waypoints */}
          {showPaths ? ([...s.cars, ...s.peds] as (Car | Ped)[]).map((agent, ai) => {
            if (!agent.path) return null;
            const isCar = (agent as Car).cruise !== undefined;
            return agent.path.points.slice(Math.max(0, agent.nextIdx - 1), agent.nextIdx + 14).map(([px, pz], i) => (
              <Scene3D.Mesh key={`p${ai}.${i}`} geometry={Geometry.Box} params={{ width: 0.16, height: 0.03, depth: 0.16 }}
                material={isCar ? '#35d0ff' : '#f7c948'} position={[px, 0.14, pz]} />
            ));
          }) : null}

          {s.cars.map((car, i) => (
            <CarMeshes key={`car${i}`} x={car.x} z={car.z} yawDeg={car.yawDeg} tone={car.tone} />
          ))}
          {s.peds.map((ped, i) => (
            <FigureMeshes key={`ped${i}`} rig={pedRigs[i]} parts={characters[ped.charIdx].parts} />
          ))}
        </Scene3D>

        <Box style={{ position: 'absolute', right: 14, bottom: 14 }}>
          <Row style={{ gap: 6, alignItems: 'center' }}>
            <Pressable onPress={() => setDist((v) => Math.max(10, v - 3))} style={{ width: 26, height: 26, borderRadius: 6, borderWidth: 1, borderColor: '#22324a', backgroundColor: '#101a2acc', alignItems: 'center', justifyContent: 'center' }}>
              <Text fontSize={13} color={INK}>+</Text>
            </Pressable>
            <Pressable onPress={() => setDist((v) => Math.min(54, v + 3))} style={{ width: 26, height: 26, borderRadius: 6, borderWidth: 1, borderColor: '#22324a', backgroundColor: '#101a2acc', alignItems: 'center', justifyContent: 'center' }}>
              <Text fontSize={13} color={INK}>-</Text>
            </Pressable>
          </Row>
        </Box>
        <Box style={{ position: 'absolute', left: 14, bottom: 14 }}>
          <Text fontSize={11} color={DIM}>drag to orbit · click a tile to toggle a barrier</Text>
        </Box>
      </Pressable>

      {/* offscreen: every pedestrian character's face/skin bakes */}
      {characters.map((c, i) => (
        <CharacterCaptures
          key={`cap${i}`}
          headTexKey={c.parts.head.texKey}
          skinTexKey={c.parts.torso.texKey}
          skin={c.doc.skin}
          layers={c.doc.layers}
        />
      ))}
    </Row>
  );
}
