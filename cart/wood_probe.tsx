// wood_probe — what the SVG-path → PathTube idea unlocks beyond palms:
//   • an OAK with VISIBLE BRANCHES (each branch is a PathTube swept along an SVG
//     path, splitting off the trunk; broad-frond leaf clumps sit at the tips), and
//   • DRIFTWOOD / STICKS lying on the ground (the same PathTube, laid flat).
// One geometry (PathTube) + the leaf cards do trunks, branches, and beach wood.
// `rjit shot wood_probe`.
//
// instance `data` is plain number[] (a Float32Array serializes to a JSON object
// the host drops — must be an array).
import { useMemo } from 'react';
import { Box, Scene3D } from '@reactjit/runtime/primitives';
import * as Geometry from '@reactjit/geometries';
import { flattenPathD } from './hmsc-int/game/textures/neon';

const STRIDE = 12;
const RAD = Math.PI / 180;

// SVG `d` → spine anchored at its FIRST point (0,0), y flipped up, scaled so the
// longest reach = 1. Right for a limb that grows OUT from where it attaches.
function svgSpine0(d: string): number[] {
  const pts = flattenPathD(d)[0] ?? [];
  if (pts.length < 2) return [];
  const x0 = pts[0]!.x, y0 = pts[0]!.y;
  let maxd = 1e-4;
  for (const p of pts) maxd = Math.max(maxd, Math.hypot(p.x - x0, p.y - y0));
  const out: number[] = [];
  for (const p of pts) out.push((p.x - x0) / maxd, (y0 - p.y) / maxd);
  return out;
}

// A clump of broad leaves at a point — the oak's foliage (reuses the frond cards,
// mostly upright so it reads as a leafy mass, not a palm crown).
function leafClump(x: number, y: number, z: number, count: number, len: number, root: [number, number, number]): number[] {
  const rows: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const yaw = (i * 47) % 360;
    const pitch = 18 + (i % 4) * 16;
    const l = len * (0.7 + 0.3 * (((i * 5) % 4) / 3));
    const w = l * 0.7;
    rows.push(x, y, z, pitch, yaw, 0, w, l, w, root[0], root[1], root[2]);
  }
  return rows;
}

export default function WoodProbe() {
  const build = useMemo(() => {
    // ── OAK: trunk + N branches splitting from the upper trunk, leaf clumps at tips ──
    const OAK = { x: -7, z: 0, attachY: 5.5, branchLen: 4.4 };
    const trunkSpine = svgSpine0('M 50 200 C 54 150, 66 110, 60 60'); // gentle taper-up
    const branchSpine = svgSpine0('M 50 200 C 60 150, 110 120, 160 70'); // up and OUT
    const tipX = branchSpine[branchSpine.length - 2]!;
    const tipY = branchSpine[branchSpine.length - 1]!;
    const NB = 6;
    const branches: { yaw: number; i: number }[] = [];
    const leaves: number[] = [];
    for (let i = 0; i < NB; i += 1) {
      const yaw = (i / NB) * 360 + (i % 2) * 24;
      const th = yaw * RAD;
      // tip world = attach + Ry(yaw)·(tipX·len, tipY·len, 0)
      const tx = OAK.x + tipX * OAK.branchLen * Math.cos(th);
      const tz = OAK.z - tipX * OAK.branchLen * Math.sin(th);
      const ty = OAK.attachY + tipY * OAK.branchLen;
      branches.push({ yaw, i });
      leaves.push(...leafClump(tx, ty, tz, 9, 1.9, [0.17, 0.36, 0.13]));
    }
    leaves.push(...leafClump(OAK.x, OAK.attachY + tipY * OAK.branchLen * 0.7, OAK.z, 14, 2.3, [0.15, 0.33, 0.12]));

    // ── DRIFTWOOD: gnarled PathTube sticks laid flat on the sand ──
    const driftA = svgSpine0('M 10 100 C 40 80, 70 120, 110 95 C 150 75, 180 110, 220 96');
    const driftB = svgSpine0('M 10 100 C 50 110, 90 70, 140 100 C 175 120, 200 85, 230 100');

    return { OAK, trunkSpine, branchSpine, branches, leaves, driftA, driftB };
  }, []);

  const { OAK, trunkSpine, branchSpine, branches, leaves, driftA, driftB } = build;

  return (
    <Box style={{ width: '100%', height: '100%' }}>
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#7fb4e6" showAxes={false}>
        <Scene3D.Camera position={[2, 6, 20]} target={[-3, 4, 0]} fov={60} far={4000} />
        <Scene3D.Fog enabled={false} />
        <Scene3D.AmbientLight color="#ffffff" intensity={0.8} />
        <Scene3D.DirectionalLight direction={[-0.4, -1, -0.3]} color="#fff6e0" intensity={0.7} />
        <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 70, height: 2, depth: 70 }} material="#d8c79a" position={[0, -1, 0]} />

        {/* OAK trunk */}
        <Scene3D.Mesh
          geometry={Geometry.PathTube}
          params={{ spine: trunkSpine, baseRadius: 0.06, tipRadius: 0.03, sides: 10 }}
          position={[OAK.x, 0, OAK.z]}
          scale={[OAK.attachY + 1.2, OAK.attachY + 1.2, OAK.attachY + 1.2]}
          material="#5e4a32"
        />
        {/* OAK branches — each a PathTube swept along the SAME svg branch path, yawed around */}
        {branches.map((b) => (
          <Scene3D.Mesh
            key={b.i}
            geometry={Geometry.PathTube}
            params={{ spine: branchSpine, baseRadius: 0.05, tipRadius: 0.015, sides: 8 }}
            position={[OAK.x, OAK.attachY, OAK.z]}
            rotation={[0, b.yaw, 0]}
            scale={[OAK.branchLen, OAK.branchLen, OAK.branchLen]}
            material="#5e4a32"
          />
        ))}
        {/* OAK leaves — broad-frond clumps at the branch tips + center canopy */}
        <Scene3D.Instances geometry={Geometry.Frond} params={Geometry.BROAD_FROND_DEFAULTS} data={leaves} count={leaves.length / STRIDE} stride={STRIDE} center={[OAK.x, OAK.attachY + 3, OAK.z]} boundsRadius={40} textureKey="~frond~" />

        {/* DRIFTWOOD — PathTube laid flat (rotX -90 lays the x-y path into x-z) */}
        <Scene3D.Mesh geometry={Geometry.PathTube} params={{ spine: driftA, baseRadius: 0.05, tipRadius: 0.03, sides: 8 }} position={[2, 0.18, 4]} rotation={[-90, 25, 0]} scale={[5, 5, 5]} material="#8a7a5c" />
        <Scene3D.Mesh geometry={Geometry.PathTube} params={{ spine: driftB, baseRadius: 0.04, tipRadius: 0.02, sides: 8 }} position={[7, 0.14, 7]} rotation={[-90, -40, 0]} scale={[3.6, 3.6, 3.6]} material="#9c8b6a" />
      </Scene3D>
    </Box>
  );
}
