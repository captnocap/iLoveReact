// render3d/TrafficVehicles — the world-render layer for the ambient traffic
// seed (GAME_TRAFFIC). Each agent's VehicleBuild is sculpted in LOCAL space
// (forward = +Z, local y=0 = the wheel-contact plane — buildVehicle's
// `groundY = wheelR + clearance` convention). To drive one we place every local
// mesh into world space at the agent's sampled pose: the XZ offset is rotated
// about the agent by its travel heading and the part keeps its own Y-rotation
// PLUS the heading — the exact pairing the box buildings use (buildingTransform
// yawAboutCenter + rotation={[0, yaw, 0]}), so geometry and layout agree at any
// angle. Vertical lift is simply the terrain top under the agent (local y=0 is
// already the contact plane).
//
// SELF-CONTAINED FRAME LOOP. The play route only re-renders when the PLAYER
// moves (the idle-storm discipline — hmsc_idle_physics_rerender_storm). Traffic
// moves every frame, so it owns its OWN GAME_LOOP subscription and re-renders
// only THIS subtree via useRerender — the parent route is never touched. The sim
// is rebuilt when the nav grid republishes (a new generation); VehicleBuild is
// cached per doc, so a frame costs only the world-transform of pre-built meshes.

import { memo, useEffect, useMemo, useRef } from 'react';
import { useRerender } from '@reactjit/runtime/hooks';
import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import { GAME_LOOP, GAME_TRAFFIC, GAME_VEHICLE } from '@game';
import type { TrafficPose, TrafficSim, VehicleBuild, VehicleDoc, VehicleMeshKind } from '@game';
import type { NavPublishResult } from '../game/world/navPublish';

function geometryFor(kind: VehicleMeshKind) {
  return kind === 'cylinder' ? Geometry.Cylinder : kind === 'sphere' ? Geometry.Sphere : Geometry.Box;
}

// Local→world XZ rotation about the agent, matching buildingTransform.yawAboutCenter
// (and props' place.ts rotateYaw) so a part placed here + rotation [0, heading, 0]
// lands oriented correctly.
function rotateYawXZ(lx: number, lz: number, deg: number): [number, number] {
  if (deg === 0) return [lx, lz];
  const r = deg * Math.PI / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [lx * c + lz * s, -lx * s + lz * c];
}

// One build per doc — docs are stable across frames, so this never re-runs in the
// hot path; the per-frame cost is only the world-transform below.
const BUILD_CACHE = new WeakMap<VehicleDoc, VehicleBuild>();
function buildFor(doc: VehicleDoc): VehicleBuild {
  let build = BUILD_CACHE.get(doc);
  if (!build) {
    build = GAME_VEHICLE.build(doc);
    BUILD_CACHE.set(doc, build);
  }
  return build;
}

const VehicleAtPose = memo(function VehicleAtPose(props: { pose: TrafficPose; groundY: number }) {
  const { pose, groundY } = props;
  const build = buildFor(pose.doc);
  const heading = pose.headingDeg;
  return (
    <>
      {build.meshes.map((m, i) => {
        const [ox, oz] = rotateYawXZ(m.position[0], m.position[2], heading);
        const rot = m.rotation ?? [0, 0, 0];
        return (
          <Scene3D.Mesh
            key={`${pose.id}.${m.id}.${i}`}
            geometry={geometryFor(m.kind)}
            params={m.params}
            position={[pose.x + ox, groundY + m.position[1], pose.z + oz]}
            rotation={[rot[0], rot[1] + heading, rot[2]]}
            scale={m.scale}
            material={m.material}
          />
        );
      })}
    </>
  );
});

/**
 * The live ambient-traffic layer. Populates `count` vehicles on the road cells
 * of the published nav grid and drives them on deterministic host-A* routes,
 * re-rendering only itself each frame. `nav` is the live publishNavGrid result
 * (its grid + generation); a new generation rebuilds the sim. `groundTop(x,z)`
 * lifts each vehicle onto the terrain under it.
 */
export const TrafficLayer = memo(function TrafficLayer(props: {
  nav: NavPublishResult | null;
  groundTop: (x: number, z: number) => number;
  vehicleProfile: number;
  count: number;
  seed: number;
  garage?: readonly VehicleDoc[];
}) {
  const rerender = useRerender();
  const simRef = useRef<TrafficSim | null>(null);
  const posesRef = useRef<readonly TrafficPose[]>([]);

  // (Re)build the sim whenever the nav grid republishes — a new generation means
  // the road pool (and the windowed extent) changed under the agents.
  const generation = props.nav?.generation ?? 0;
  const grid = props.nav?.grid ?? null;
  useEffect(() => {
    if (!grid || generation === 0 || props.count <= 0) {
      simRef.current = null;
      posesRef.current = [];
      return;
    }
    simRef.current = GAME_TRAFFIC.createTrafficSim({
      grid,
      count: props.count,
      seed: props.seed,
      vehicleProfile: props.vehicleProfile,
      garage: props.garage,
    });
  }, [grid, generation, props.count, props.seed, props.vehicleProfile, props.garage]);

  // The self-contained frame loop: advance the deterministic sim and re-read
  // poses, then re-render THIS subtree only. Motion plans are in seconds.
  useEffect(() => {
    let alive = true;
    let handle: ReturnType<typeof GAME_LOOP.scheduleFrame> | null = null;
    const loop = () => {
      if (!alive) return;
      const sim = simRef.current;
      if (sim) {
        const now = GAME_LOOP.now() / 1000;
        sim.advance(now);
        posesRef.current = sim.poses(now);
        if (posesRef.current.length) rerender();
      }
      handle = GAME_LOOP.scheduleFrame(loop);
    };
    handle = GAME_LOOP.scheduleFrame(loop);
    return () => {
      alive = false;
      if (handle != null) GAME_LOOP.cancelFrame(handle);
    };
  }, [rerender]);

  const poses = posesRef.current;
  // groundTop is cheap (a grid column lookup); resolve per pose each frame so a
  // vehicle crossing a hill rides the terrain.
  const grounded = useMemo(
    () => poses.map((pose) => ({ pose, groundY: props.groundTop(pose.x, pose.z) })),
    [poses, props.groundTop],
  );
  return (
    <>
      {grounded.map(({ pose, groundY }) => (
        <VehicleAtPose key={pose.id} pose={pose} groundY={groundY} />
      ))}
    </>
  );
});
