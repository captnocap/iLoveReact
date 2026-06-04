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
import { buildVehicle, geometryFor, makeVehicle, VEHICLE_STYLES, type VehicleDoc } from '../vehicle_lab/index';
import type { SampledAction } from '../animationDsl';
import { measurePath, planMotion, sampleMotion, slicePoints, type MotionPlan, type MotionProfile } from '@reactjit/runtime/motion';
import { TILE_KINDS, tileKindDefinition, type TileKind } from '../hmsc/world/tileKinds';
import { TRAFFIC_SIGNAL_CYCLE, trafficClockSeconds } from '../hmsc/world/traffic';
import {
  publishPathGrid, setPathProfile, setPathFlows, PATH_FLOW, findPath, fillPathRect, pathDisrupted, pathGeneration,
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

// road bands SIX cells wide — 3 tiles per direction lane. The sedan is 1.8m
// on 1m cells: a 1-tile lane couldn't fit ONE car, so oncoming traffic shared
// a corridor and froze nose-to-nose (the citywide gridlock). Three tiles per
// lane gives each direction its own half with clearance. Sidewalks still
// derive as the ring of ground cells touching road.
const ROAD_W = 6;
const ROAD_BANDS = [8, 30]; // band start; covers start..start+ROAD_W-1, both axes
const WALL_RECTS: [number, number, number, number][] = [
  [2, 2, 4, 4], [16, 2, 5, 4], [24, 3, 4, 4], [38, 2, 4, 4],
  [2, 17, 4, 5], [17, 16, 6, 3], [25, 21, 4, 5], [38, 17, 4, 4],
  [2, 38, 5, 4], [16, 37, 4, 5], [25, 38, 4, 4], [38, 38, 4, 4],
  [17, 24, 4, 3],
];

// ── junctions + signals — hmsc's traffic clock, junction TILES as the boxes ─
// Junction boxes are no longer hardcoded geometry: buildWorld paints
// 'junction' tiles where lanes meet and clusters them into boxes — the grid
// itself knows where intersections are. Lights run hmsc's
// TRAFFIC_SIGNAL_CYCLE off the same steady clock the hmsc lamps glow on:
// axis 0 (N-S travel) and axis 1 (E-W) alternate by a half period, exactly
// like world/traffic.ts' signalPhaseOffsetSeconds.
type Junction = { x0: number; z0: number; x1: number; z1: number };

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
function TrafficLights(props: { clock: number; junctions: Junction[] }) {
  const phases: [SignalPhase, SignalPhase] = [axisPhase(0, props.clock), axisPhase(1, props.clock)];
  return (
    <>
      {props.junctions.map((j, i) => {
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

// ── intersection discipline ──────────────────────────────────────────────────
// A* through a flow-neutral junction box is a staircase, and every monotone
// staircase has EQUAL cost — so the heap's tie-break happily cuts the near
// corner, dragging a left turn across the oncoming half ("right lane into
// the left lane"). Real turn geometry is the intersection of the two LANE
// LINES: replace the in-box waypoints with the single apex
// (exit lane's column, entry lane's row) — early for a right turn, deep past
// the center for a left turn, exactly where right-hand traffic belongs.
// Straight passes just drop the stair dust and stay straight.
function straightenJunctions(points: [number, number][], junctions: Junction[]): [number, number][] {
  if (points.length < 3) return points;
  const insideBox = (p: [number, number], j: Junction) =>
    p[0] > j.x0 - 1e-4 && p[0] < j.x1 + 1e-4 && p[1] > j.z0 - 1e-4 && p[1] < j.z1 + 1e-4;
  const out: [number, number][] = [points[0]];
  let i = 1;
  while (i < points.length) {
    const p = points[i];
    const j = junctions.find((jj) => insideBox(p, jj));
    if (!j) {
      out.push(p);
      i++;
      continue;
    }
    let k = i;
    while (k < points.length && insideBox(points[k], j)) k++;
    if (k >= points.length) {
      while (i < k) out.push(points[i++]); // route ends inside the box — keep as-is
      continue;
    }
    const prev = out[out.length - 1];
    const next = points[k];
    const horizontalEntry = Math.abs(points[i][0] - prev[0]) > Math.abs(points[i][1] - prev[1]);
    const straight = horizontalEntry ? Math.abs(next[1] - prev[1]) < 0.6 : Math.abs(next[0] - prev[0]) < 0.6;
    if (!straight) out.push(horizontalEntry ? [next[0], prev[1]] : [prev[0], next[1]]);
    i = k;
  }
  return out;
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

  // Each 6-wide band is TWO 3-tile lane trios [shoulder, lane, shoulder] —
  // the center tile carries the flow direction in its KIND. Right-hand
  // traffic picks the sides (right = forward x up): horizontal roads run
  // westbound on the low-z half / eastbound high-z; vertical run southbound
  // (+Z) low-x / northbound high-x. Crossings get flow-neutral 'junction'
  // tiles — the grid itself knows where intersections are.
  const H_TRIOS: TileKind[] = ['road', 'laneWest', 'road', 'road', 'laneEast', 'road'];
  const V_TRIOS: TileKind[] = ['road', 'laneSouth', 'road', 'road', 'laneNorth', 'road'];
  for (const band of ROAD_BANDS) {
    for (let i = 0; i < COLS; i++) {
      for (let o = 0; o < ROAD_W; o++) set(i, band + o, H_TRIOS[o]);
    }
  }
  for (const band of ROAD_BANDS) {
    for (let i = 0; i < ROWS; i++) {
      for (let o = 0; o < ROAD_W; o++) set(band + o, i, V_TRIOS[o]);
    }
  }
  for (const bx of ROAD_BANDS) {
    for (const bz of ROAD_BANDS) {
      for (let z = 0; z < ROAD_W; z++) for (let x = 0; x < ROAD_W; x++) set(bx + x, bz + z, 'junction');
    }
  }
  for (const [x0, z0, w, h] of WALL_RECTS) {
    for (let z = z0; z < z0 + h; z++) for (let x = x0; x < x0 + w; x++) set(x, z, 'wall');
  }
  // sidewalks: every mud cell that touches the road family becomes pavement
  const ROAD_FAMILY = new Set(
    (['road', 'laneNorth', 'laneSouth', 'laneEast', 'laneWest', 'junction'] as TileKind[]).map((k) => KIND_INDEX[k]),
  );
  const mud = KIND_INDEX.mud;
  const sidewalkAt: boolean[] = new Array(COLS * ROWS).fill(false);
  for (let z = 0; z < ROWS; z++) {
    for (let x = 0; x < COLS; x++) {
      if (at(x, z) !== mud) continue;
      const near = (x > 0 && ROAD_FAMILY.has(at(x - 1, z))) || (x < COLS - 1 && ROAD_FAMILY.has(at(x + 1, z)))
        || (z > 0 && ROAD_FAMILY.has(at(x, z - 1))) || (z < ROWS - 1 && ROAD_FAMILY.has(at(x, z + 1)));
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
  const laneCells: { x: number; z: number; kind: TileKind }[] = [];
  const laneXY: [number, number][] = [];
  const walkCells: [number, number][] = [];
  const wallCells: [number, number][] = [];
  const strips: Strip[] = [];
  const LANE_KINDS = new Set<TileKind>(['laneNorth', 'laneSouth', 'laneEast', 'laneWest']);
  for (let z = 0; z < ROWS; z++) {
    let x = 0;
    while (x < COLS) {
      const k = at(x, z);
      let len = 1;
      while (x + len < COLS && at(x + len, z) === k) len++;
      const kind = TILE_KINDS[k];
      if (kind !== 'wall') strips.push({ x0: x, z, len, kind });
      for (let i = 0; i < len; i++) {
        if (LANE_KINDS.has(kind)) {
          laneCells.push({ x: x + i, z, kind });
          laneXY.push([x + i, z]);
        } else if (kind === 'sidewalk') walkCells.push([x + i, z]);
        else if (kind === 'wall') wallCells.push([x + i, z]);
      }
      x += len;
    }
  }

  // intersections resolve from the GRID: cluster painted junction tiles into
  // boxes (works for any map shape, not just these two bands)
  const junctions: Junction[] = [];
  const seen = new Uint8Array(COLS * ROWS);
  const jk = KIND_INDEX.junction;
  for (let z = 0; z < ROWS; z++) {
    for (let x = 0; x < COLS; x++) {
      const i0 = z * COLS + x;
      if (kinds[i0] !== jk || seen[i0]) continue;
      let minX = x, maxX = x, minZ = z, maxZ = z;
      const stack = [i0];
      seen[i0] = 1;
      while (stack.length > 0) {
        const i = stack.pop()!;
        const cx = i % COLS, cz = (i / COLS) | 0;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cz < minZ) minZ = cz;
        if (cz > maxZ) maxZ = cz;
        for (const [nx, nz] of [[cx + 1, cz], [cx - 1, cz], [cx, cz + 1], [cx, cz - 1]] as const) {
          if (nx < 0 || nz < 0 || nx >= COLS || nz >= ROWS) continue;
          const ni = nz * COLS + nx;
          if (kinds[ni] === jk && !seen[ni]) { seen[ni] = 1; stack.push(ni); }
        }
      }
      junctions.push({
        x0: ORIGIN_X + minX * CELL,
        z0: ORIGIN_Z + minZ * CELL,
        x1: ORIGIN_X + (maxX + 1) * CELL,
        z1: ORIGIN_Z + (maxZ + 1) * CELL,
      });
    }
  }

  return { kinds, strips, bushes, laneCells, laneXY, walkCells, wallCells, junctions };
}

// Behavioral shaping on top of raw tile legality. hmsc's tile costs answer
// "CAN this agent cross this tile" — and by those numbers a pedestrian
// finds the road CHEAPER than the sidewalk (0.97 vs 1.08) and a car may
// legally mount the pavement at 1.8x. Legal, but dumb. These multipliers
// answer "would a sane one": x0 = hard block, <1 = preferred, >1 = only
// when it's worth it (a short perpendicular road CROSSING stays cheap for
// a walker; strolling the centerline does not). This is the FLOW-HINT
// slice hmsc's world/pathing.ts reserves for itself.
const PROFILE_TUNING: Record<'walk' | 'drive', Partial<Record<TileKind, number>>> = {
  walk: {
    sidewalk: 0.45, mud: 1.4, sand: 1.6,
    road: 3.5, asphalt: 3.5, laneNorth: 3.5, laneSouth: 3.5, laneEast: 3.5, laneWest: 3.5, junction: 3.2,
  },
  // drivers live on the lane-center tiles; the shoulder is passable but
  // costly (overtakes/recovery only); everything off-road is a hard block
  drive: {
    laneNorth: 1, laneSouth: 1, laneEast: 1, laneWest: 1, junction: 1,
    road: 1.6, asphalt: 1.4,
    sidewalk: 0, mud: 0, sand: 0, bush: 0,
  },
};

// Cost-per-kind for the host profile — the SAME formula as hmsc's JS
// movementCostForCell (world/pathing.ts), evaluated once per kind here
// instead of once per A* node there, then shaped by PROFILE_TUNING.
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
    const tune = PROFILE_TUNING[mode][kind];
    if (tune === 0) return -1;
    if (tune != null) cost *= tune;
    return cost;
  });
}

// ── static world meshes, memo'd hard (they never change after mount) ────────

const DASH_H_PARAMS = { width: 0.55, height: 0.02, depth: 0.09 };
const DASH_V_PARAMS = { width: 0.09, height: 0.02, depth: 0.55 };

const WorldMeshes = memo(function WorldMeshes(props: {
  strips: Strip[];
  bushes: [number, number][];
  wallCells: [number, number][];
  laneCells: { x: number; z: number; kind: TileKind }[];
}) {
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
      {/* the |x| markings — dashed paint along every lane-center tile */}
      {props.laneCells.map((lc, i) => {
        if ((lc.x + lc.z) % 2 !== 0) return null;
        const horizontal = lc.kind === 'laneEast' || lc.kind === 'laneWest';
        return (
          <Scene3D.Mesh key={`lm${i}`} geometry={Geometry.Box} params={horizontal ? DASH_H_PARAMS : DASH_V_PARAMS}
            material="#aab3c2" position={[ORIGIN_X + (lc.x + 0.5) * CELL, 0.095, ORIGIN_Z + (lc.z + 0.5) * CELL]} />
        );
      })}
    </>
  );
});

// A vehicle_lab build placed in the world. The lab's local frame has the
// hood at -Z while our heading convention faces +Z, so the mesh yaw adds
// 180 (the same convention as the head_lab figure). Wheel spin comes from
// the ODOMETER (distance / circumference — deterministic), steering from
// the tangent error, the brake nose-dip from the plan's current accel.
function PlacedVehicle(props: { car: Car; showHitboxes: boolean }) {
  const { car } = props;
  const actions: SampledAction[] = [
    { target: 'wheels', action: 'spin_loop', phase: ((car.odometer / car.wheelCirc) * 0.5) % 1, weight: 1, args: [] },
    { target: 'front_wheels', action: 'steer_loop', phase: Math.asin(Math.max(-1, Math.min(1, car.steerDeg / 24))) / (Math.PI * 2), weight: 1, args: [] },
    { target: 'vehicle', action: 'brake', phase: 1, weight: car.accelNow < -0.4 ? Math.min(1, -car.accelNow / 6.5) : 0, args: [] },
  ];
  const build = buildVehicle(car.doc, actions);
  const meshYaw = car.yawDeg + 180;
  const rad = meshYaw * RAD;
  const c = Math.cos(rad);
  const sn = Math.sin(rad);
  const place = (p: V3): V3 => [car.x + p[0] * c + p[2] * sn, p[1], car.z - p[0] * sn + p[2] * c];
  const turn = (r?: V3): V3 => [r?.[0] ?? 0, (r?.[1] ?? 0) + meshYaw, r?.[2] ?? 0];
  return (
    <>
      {build.meshes.map((mm, i) => (
        <Scene3D.Mesh key={`${mm.id}.${i}`} geometry={geometryFor(mm.kind)} params={mm.params}
          position={place(mm.position)} rotation={turn(mm.rotation)} scale={mm.scale} material={mm.material} />
      ))}
      {props.showHitboxes ? build.hitboxes.map((h, i) => (
        <Scene3D.Mesh key={`hb${h.id}.${i}`} geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }}
          position={place(h.position)} rotation={turn(h.rotation)} scale={h.size}
          material={{ color: h.critical ? '#fb7185' : '#38bdf8', opacity: 0.15 }} />
      )) : null}
    </>
  );
}

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

// A car is a vehicle_lab build (semantic panels + per-part hitboxes) driven
// by a DETERMINISTIC motion plan: the route comes from host pathing, the
// speed/distance schedule from runtime/motion.ts, and position, speed and
// odometer are pure functions of time — until a yield reason (red light,
// pedestrian, queue) INTERRUPTS and the plan re-anchors at the sampled
// state. Between interruptions a car's motion costs zero per-tick math.
type Car = {
  doc: VehicleDoc;
  halfLen: number;
  wheelCirc: number;
  profile: MotionProfile;
  // rendered state — yaw eases toward the path tangent; steer/brake feed
  // the vehicle build's wheel-steer and nose-dip channels
  x: number; z: number; yawDeg: number; steerDeg: number;
  speed: number; accelNow: number; odometer: number;
  // route (host path) + the current deterministic plan over a slice of it
  path: Path | null; goal: PathPoint | null; pathDirty: boolean;
  route: [number, number][]; routeCum: number[]; routeTotal: number;
  plan: MotionPlan | null;
  baseS: number; // route arc consumed by earlier plans of this route
  planEndS: number; // route arc where the current plan halts
  crumbIdx: number; // route waypoint index at current progress (viz + disrupt test)
  interruptions: number;
};

type Barrier = { cx: number; cz: number; prevKind: number };
const PED_OUTFITS: [string, string, string[], string][] = [
  ['tee', 'plain', ['cap'], 'jeans'],
  ['hoodie', 'plain', [], 'jeans'],
  ['suit', 'plain', ['shades'], 'slacks'],
  ['tee', 'plain', ['beanie'], 'shorts'],
  ['dress', 'plain', [], 'briefs'],
];

const MAX_CARS = 8; // vehicle_lab builds are ~45 meshes each — 8 is the budget
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
  const [carCount, setCarCount] = useState(6);
  const [pedCount, setPedCount] = useState(3);
  const [showPaths, setShowPaths] = useState(true);
  const [paused, setPaused] = useState(false);
  const [reckless, setReckless] = useState(false);
  const [showHitboxes, setShowHitboxes] = useState(false);

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
    // the flow table is what makes lane tile NAMES directional in the host
    const flows = new Uint8Array(TILE_KINDS.length);
    flows[KIND_INDEX.laneEast] = PATH_FLOW.posX;
    flows[KIND_INDEX.laneWest] = PATH_FLOW.negX;
    flows[KIND_INDEX.laneSouth] = PATH_FLOW.posZ;
    flows[KIND_INDEX.laneNorth] = PATH_FLOW.negZ;
    setPathFlows(flows);
    setPathProfile(PED_PROFILE, { costs: profileCosts('walk'), laneOffset: 0.18 });
    // No laneOffset: the lane-CENTER tile is the lane line, so the A* route
    // is already in lane. Direction comes from the flow table — driving
    // against a lane's flow costs 30x and CROSSING the centerline costs the
    // same (at 4x a mid-block U-turn was CHEAPER than going around the
    // block — rational asshole behavior). Direction changes happen in
    // flow-neutral junction tiles, where they belong.
    setPathProfile(VEH_PROFILE, { costs: profileCosts('drive'), laneOffset: 0, againstFlow: 30, crossFlow: 30 });
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

    // Traffic goals are AHEAD-ONLY: a destination behind the bumper is how
    // you get U-turn assholes. Cars arrive, pick the next goal in front of
    // their nose, and just keep circulating — dense fixed flow, no flips.
    const pickGoalAhead = (pool: [number, number][], fromX: number, fromZ: number, fx: number, fz: number): PathPoint => {
      for (let attempt = 0; attempt < 18; attempt++) {
        const [cx, cz] = pool[Math.floor(rand() * pool.length)];
        const p = cellCenter(cx, cz);
        const dx = p[0] - fromX;
        const dz = p[1] - fromZ;
        const d = Math.hypot(dx, dz);
        if (d < 12) continue;
        if ((dx * fx + dz * fz) / d < 0.25) continue;
        return p;
      }
      return pickGoal(pool, fromX, fromZ);
    };

    const logLine = (s: Sim, line: string) => { s.log = [line, ...s.log].slice(0, 6); };

    const tick = () => {
      const now = host.performance?.now?.() ?? Date.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - lastNow) / 1000));
      lastNow = now;
      const s = simRef.current;
      const ui = uiRef.current;

      // population control
      while (s.cars.length < ui.carCount) {
        // spawn ON a lane tile, already facing its flow, as a generated
        // vehicle_lab car (style/color/gas-tank per seed)
        const lc = world.laneCells[Math.floor(rand() * world.laneCells.length)];
        const [x, z] = cellCenter(lc.x, lc.z);
        const yawDeg = lc.kind === 'laneEast' ? 90 : lc.kind === 'laneWest' ? -90 : lc.kind === 'laneNorth' ? 180 : 0;
        const doc = makeVehicle(Math.floor(rand() * 0x7fffffff));
        const dims = VEHICLE_STYLES[doc.style];
        s.cars.push({
          doc,
          halfLen: dims.length / 2,
          wheelCirc: 2 * Math.PI * dims.wheelR,
          profile: { maxSpeed: 5 + rand() * 2.5, accel: 2.3 + rand() * 0.9, decel: 6.5, minCornerSpeed: 1.5 },
          x, z, yawDeg, steerDeg: 0, speed: 0, accelNow: 0, odometer: 0,
          path: null, goal: null, pathDirty: false,
          route: [], routeCum: [], routeTotal: 0,
          plan: null, baseS: 0, planEndS: 0, crumbIdx: 1, interruptions: 0,
        });
      }
      if (s.cars.length > ui.carCount) s.cars.length = ui.carCount;
      while (s.peds.length < ui.pedCount) {
        const [cx, cz] = world.walkCells[Math.floor(rand() * world.walkCells.length)];
        const [x, z] = cellCenter(cx, cz);
        s.peds.push({ x, z, yawDeg: 0, gait: rand(), path: null, nextIdx: 0, goal: null, mode: 'walk', ragdoll: null, settleTicks: 0, recoverStart: 0, recoverFrom: null, recoverTarget: null, charIdx: s.peds.length % characters.length });
      }
      if (s.peds.length > ui.pedCount) s.peds.length = ui.pedCount;

      if (!ui.paused && pathHostCompiled()) {
        // the sim clock IS the motion plans' time base — advancing it only
        // while unpaused freezes every deterministic schedule in place
        s.animSeconds += dt;
        // disruption sweep: only when the host generation actually moved
        const gen = pathGeneration();
        if (gen !== s.lastGen) {
          s.lastGen = gen;
          for (const ped of s.peds) {
            if (!ped.path || !ped.goal) continue;
            if (pathDisrupted(ped.path, ped.nextIdx)) {
              ped.path = findPath(PED_PROFILE, [ped.x, ped.z], ped.goal);
              ped.nextIdx = 1;
              s.repaths += 1;
            }
          }
          for (const car of s.cars) {
            if (!car.path || !car.goal) continue;
            if (pathDisrupted(car.path, car.crumbIdx)) {
              car.pathDirty = true; // reroute + replan next tick, same goal
              s.repaths += 1;
            }
          }
          if (s.repaths > 0) logLine(s, `gen ${gen} — ${s.repaths} repaths total`);
        }

        // ── cars: deterministic plans, replanned ONLY on interruption ─────
        // Position/speed/odometer come from sampleMotion(plan, now) — exact,
        // frame-rate independent, zero integration. The yield monitor below
        // only CHECKS the world; it touches the plan when a reason to stop
        // appears, tightens, or clears.
        const clock = trafficClockSeconds();
        const now = s.animSeconds;
        for (let ci = 0; ci < s.cars.length; ci++) {
          const car = s.cars[ci];

          // (re)route: fresh spawn, arrival (goal null), or barrier repath
          if (!car.plan || car.pathDirty) {
            if (!car.goal) {
              car.goal = pickGoalAhead(world.laneXY, car.x, car.z, Math.sin(car.yawDeg * RAD), Math.cos(car.yawDeg * RAD));
            }
            const found = findPath(VEH_PROFILE, [car.x, car.z], car.goal);
            car.pathDirty = false;
            if (!found || found.points.length < 2) { car.goal = null; car.plan = null; continue; }
            car.path = found;
            // proper turn apexes through every junction the route crosses
            car.route = straightenJunctions([[car.x, car.z], ...found.points.slice(1)], world.junctions);
            const mp = measurePath(car.route);
            car.routeCum = mp.cum;
            car.routeTotal = mp.total;
            car.baseS = 0;
            car.crumbIdx = 1;
            car.plan = planMotion(car.route, { startTime: now, profile: car.profile, startSpeed: car.speed });
            car.planEndS = car.routeTotal;
          }

          // THE deterministic read
          const m = sampleMotion(car.plan, now);
          car.odometer += Math.hypot(m.x - car.x, m.z - car.z);
          car.x = m.x;
          car.z = m.z;
          car.speed = m.speed;
          car.accelNow = m.accel;
          const yawErr = wrap180(m.headingDeg - car.yawDeg);
          if (m.speed > 0.15) car.yawDeg += Math.max(-460 * dt, Math.min(460 * dt, yawErr));
          car.steerDeg = Math.max(-24, Math.min(24, yawErr * 1.4));
          const progress = car.baseS + m.s;
          while (car.crumbIdx < car.routeCum.length - 1 && car.routeCum[car.crumbIdx] < progress) car.crumbIdx++;
          const fx = Math.sin(m.headingDeg * RAD);
          const fz = Math.cos(m.headingDeg * RAD);

          // ── yield monitor: the nearest reason to stop, as meters ahead ──
          let stopD = Infinity;
          if (!ui.reckless) {
            for (const ped of s.peds) {
              if (ped.mode === 'ragdoll') continue;
              const rx = ped.x - car.x;
              const rz = ped.z - car.z;
              const ahead = rx * fx + rz * fz;
              const lateral = Math.abs(rx * fz - rz * fx);
              if (ahead > 0 && ahead < 8 && lateral < 1.4) stopD = Math.min(stopD, ahead - (car.halfLen + 1.1));
            }
          }
          for (let oi = 0; oi < s.cars.length; oi++) {
            const other = s.cars[oi];
            if (other === car) continue;
            const ofx = Math.sin(other.yawDeg * RAD);
            const ofz = Math.cos(other.yawDeg * RAD);
            if (ofx * fx + ofz * fz < -0.3) continue; // oncoming, not our queue
            const rx = other.x - car.x;
            const rz = other.z - car.z;
            const ahead = rx * fx + rz * fz;
            const lateral = Math.abs(rx * fz - rz * fx);
            if (ahead <= 0 || ahead >= 10 || lateral >= 1.4) continue;
            if (other.speed < 0.5 && car.speed < 0.5 && ci < oi) continue; // crossing tie-break
            stopD = Math.min(stopD, ahead - (car.halfLen + other.halfLen + 0.8));
          }
          const axis: 0 | 1 = Math.abs(fx) > Math.abs(fz) ? 1 : 0;
          const phase = axisPhase(axis, clock);
          if (phase !== 'go') {
            for (const j of world.junctions) {
              const inside = car.x > j.x0 - 0.3 && car.x < j.x1 + 0.3 && car.z > j.z0 - 0.3 && car.z < j.z1 + 0.3;
              if (inside) continue;
              let enter: number | null = null;
              if (axis === 1) {
                const dir = fx > 0 ? 1 : -1;
                const dd = ((dir > 0 ? j.x0 : j.x1) - car.x) * dir;
                if (dd >= -0.1 && dd < 10 && car.z > j.z0 - 0.7 && car.z < j.z1 + 0.7) enter = dd;
              } else {
                const dir = fz > 0 ? 1 : -1;
                const dd = ((dir > 0 ? j.z0 : j.z1) - car.z) * dir;
                if (dd >= -0.1 && dd < 10 && car.x > j.x0 - 0.7 && car.x < j.x1 + 0.7) enter = dd;
              }
              if (enter == null) continue;
              if (phase === 'caution' && enter < car.halfLen + 1.6) continue; // too late — roll through
              stopD = Math.min(stopD, enter - (car.halfLen + 0.35));
            }
          }
          if (stopD !== Infinity) stopD = Math.max(0, stopD);

          // ── interruption rules — the ONLY writes to the plan ────────────
          const targetEndS = stopD === Infinity ? car.routeTotal : Math.min(car.routeTotal, progress + stopD);
          const freeRun = car.planEndS >= car.routeTotal - 0.3;
          const tighter = stopD !== Infinity && targetEndS < car.planEndS - 0.5; // new/closer obstacle
          const cleared = stopD === Infinity && !freeRun; // light went green / ped moved on
          const creep = stopD !== Infinity && !freeRun && targetEndS > car.planEndS + 0.8 && m.speed < 0.6; // queue advanced
          if (tighter || cleared || creep) {
            const pts = slicePoints(car.route, car.routeCum, progress, targetEndS);
            car.plan = planMotion(pts, { startTime: now, profile: car.profile, startSpeed: m.speed });
            car.baseS = progress;
            car.planEndS = targetEndS;
            car.interruptions += 1;
          } else if (m.done && freeRun && progress >= car.routeTotal - 0.5) {
            car.plan = null; // arrived — next tick picks an ahead goal, plans fresh
            car.goal = null;
          }

          // clip a pedestrian → hand the body to the ragdoll. Speed-gated:
          // a stopped bumper nudges nobody into orbit.
          if (car.speed > 2.5) {
            for (const ped of s.peds) {
              if (ped.mode !== 'walk') continue;
              if (Math.hypot(ped.x - car.x, ped.z - car.z) > car.halfLen + 0.6) continue;
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
          {[2, 4, 6, 8].map((n) => (
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
          <Pressable onPress={() => setShowHitboxes((v) => !v)} style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 5, borderWidth: 1, borderColor: showHitboxes ? '#38bdf8' : '#22324a', backgroundColor: '#101a2a' }}>
            <Text fontSize={12} color={showHitboxes ? '#38bdf8' : DIM}>hitboxes</Text>
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
        <Text fontSize={11} color={INK}>{`motion interruptions ${s.cars.reduce((n, c) => n + c.interruptions, 0)} · pedestrians clipped ${s.hits}`}</Text>
        <Box style={{ height: 6 }} />
        <Text fontSize={11} color={DIM} style={{ fontWeight: 800 }}>EVENTS</Text>
        {s.log.length === 0 ? (
          <Text fontSize={11} color={DIM}>drop a barrier on a busy road…</Text>
        ) : (
          s.log.map((line, i) => <Text key={`${i}.${line}`} fontSize={11} color={i === 0 ? INK : DIM}>{line}</Text>)
        )}
        <Box style={{ flexGrow: 1 }} />
        <Text fontSize={10} color={DIM}>profiles: walkCost/vehicleCost straight from hmsc tileKinds</Text>
        <Text fontSize={10} color={DIM}>lane TILES carry direction: laneEast/West/North/South centers + flow-neutral junction tiles — right-hand traffic is in the paint</Text>
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

          <WorldMeshes strips={world.strips} bushes={world.bushes} wallCells={world.wallCells} laneCells={world.laneCells} />

          {/* stop lights — hmsc's signal clock, boxes from the junction tiles */}
          <TrafficLights clock={trafficClockSeconds()} junctions={world.junctions} />

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
            const isCar = 'doc' in agent;
            // cars drive the straightened ROUTE (turn apexes), not raw path points
            const pts = isCar ? (agent as Car).route : agent.path.points;
            const startIdx = Math.max(0, (isCar ? (agent as Car).crumbIdx : (agent as Ped).nextIdx) - 1);
            return pts.slice(startIdx, startIdx + 15).map(([px, pz], i) => (
              <Scene3D.Mesh key={`p${ai}.${i}`} geometry={Geometry.Box} params={{ width: 0.16, height: 0.03, depth: 0.16 }}
                material={isCar ? '#35d0ff' : '#f7c948'} position={[px, 0.14, pz]} />
            ));
          }) : null}

          {s.cars.map((car, i) => (
            <PlacedVehicle key={`car${i}`} car={car} showHitboxes={showHitboxes} />
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
