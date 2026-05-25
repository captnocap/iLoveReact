// The meshed city — built from the SAME authored data the 2D map used
// (citymap.ts RECTS / BLDGS / PROPS), so the 3D world is the 2D world extruded.
//
// Fidelity pass: facades carry a procedural lit-window-grid texture, the plaza
// gets a neon checker, roads get asphalt+lane dashes, and every building wears a
// neon rim cage (the crisp edge outline the 2D shader had). Ground is thin BOXES
// not planes (the framework plane is single-sided facing -Y and gets culled by a
// top-down camera). No spheres anywhere — stays deep under the vertex budget.

import { Scene3D } from '@reactjit/runtime/primitives';
import {
  BLDGS, RECTS, PROPS, HEIGHTS, T, CITY_W, CITY_H, cityTileAt,
} from '../world/citymap';
import type { Door } from '../systems/doors';
import type { Ent } from '../state/world';
import {
  ZONE_HEX, buildingFacade, buildingRoof, windowGlow, neonRim,
  PALM_TRUNK, PALM_FROND, DUMPSTER, DUMPSTER_LID, SIGN_POLE, signNeon,
  DOOR_LEAF, DOOR_FRAME, PLAZA_A, PLAZA_B, ROAD_LINE,
} from './palette3d';
import { checkerTex, asphaltTex, facadeTex } from './textures';

const GROUND_Y = 0;
const WHITE = '#ffffff';
// scape3d has its OWN citymap, so the 3D extrusion isn't bound by the 2D shader's
// height-march cap — extrude the authored tiers into a real towering skyline.
const HEIGHT_SCALE = 3.2;

// Textures are built once at module load and cached by content hash in the host,
// so all buildings of a style share one GPU texture. Tall towers want many floors,
// so the window grid runs deep.
const FACADE_TEX = [0, 1, 2, 3].map((s) => facadeTex(buildingFacade(s), windowGlow(s), 6, 16));
const PLAZA_TEX = checkerTex(20, 16, 4, PLAZA_A, PLAZA_B);
const ROAD_TEX = asphaltTex(ZONE_HEX.road, ROAD_LINE);

function zoneHex(t: T): string {
  switch (t) {
    case T.Road: return ZONE_HEX.road;
    case T.Plaza: return ZONE_HEX.plaza;
    case T.Water: return ZONE_HEX.water;
    case T.Sand: return ZONE_HEX.sand;
    case T.Grime: return ZONE_HEX.grime;
    default: return ZONE_HEX.sidewalk;
  }
}

function Ground() {
  return (
    <>
      <Scene3D.Mesh
        geometry="box" material={ZONE_HEX.sidewalk}
        position={[CITY_W / 2, GROUND_Y - 0.06, CITY_H / 2]}
        sizeX={CITY_W + 4} sizeY={0.12} sizeZ={CITY_H + 4}
      />
      {RECTS.map((r, i) => {
        const w = r.x1 - r.x0 + 1;
        const d = r.y1 - r.y0 + 1;
        const textured = r.t === T.Plaza ? PLAZA_TEX : r.t === T.Road ? ROAD_TEX : null;
        return (
          <Scene3D.Mesh
            key={`zone-${i}`}
            geometry="box" material={textured ? WHITE : zoneHex(r.t)}
            texture={textured ?? undefined}
            position={[r.x0 + w / 2, GROUND_Y + 0.01 + i * 0.004, r.y0 + d / 2]}
            sizeX={w} sizeY={0.08} sizeZ={d}
          />
        );
      })}
    </>
  );
}

// Crisp dashed lane lines as real geometry down each road's centerline — a
// painted texture stretched along a long road just smears, and one texture can't
// orient to both the east-west boulevards and the north-south avenues.
function RoadLines() {
  const dashes: any[] = [];
  const DASH = 1.4;
  const STEP = 3.0;
  const Y = 0.12; // just above the road box top
  RECTS.filter((r) => r.t === T.Road).forEach((r, ri) => {
    const w = r.x1 - r.x0 + 1;
    const d = r.y1 - r.y0 + 1;
    const horizontal = w >= d;
    const len = horizontal ? w : d;
    const cx = r.x0 + w / 2;
    const cz = r.y0 + d / 2;
    const n = Math.floor(len / STEP);
    for (let k = 0; k < n; k++) {
      const off = -len / 2 + STEP / 2 + k * STEP;
      dashes.push(
        <Scene3D.Mesh
          key={`lane-${ri}-${k}`}
          geometry="box"
          material={ROAD_LINE}
          position={horizontal ? [cx + off, Y, cz] : [cx, Y, cz + off]}
          sizeX={horizontal ? DASH : 0.16}
          sizeY={0.05}
          sizeZ={horizontal ? 0.16 : DASH}
        />,
      );
    }
  });
  return <>{dashes}</>;
}

// Neon rim cage: top frame (4 bars) + vertical corner posts (4) in the style's
// neon — restores the crisp lit-edge silhouette of the 2D buildings.
function NeonCage({ id, cx, cz, w, d, h, color }: {
  id: string; cx: number; cz: number; w: number; d: number; h: number; color: string;
}) {
  const t = 0.12; // bar thickness
  return (
    <>
      {/* top frame */}
      <Scene3D.Mesh key={`${id}-rt-n`} geometry="box" material={color}
        position={[cx, h, cz - d / 2]} sizeX={w + t} sizeY={t} sizeZ={t} />
      <Scene3D.Mesh key={`${id}-rt-s`} geometry="box" material={color}
        position={[cx, h, cz + d / 2]} sizeX={w + t} sizeY={t} sizeZ={t} />
      <Scene3D.Mesh key={`${id}-rt-w`} geometry="box" material={color}
        position={[cx - w / 2, h, cz]} sizeX={t} sizeY={t} sizeZ={d + t} />
      <Scene3D.Mesh key={`${id}-rt-e`} geometry="box" material={color}
        position={[cx + w / 2, h, cz]} sizeX={t} sizeY={t} sizeZ={d + t} />
      {/* vertical corner posts */}
      {[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz], k) => (
        <Scene3D.Mesh key={`${id}-post-${k}`} geometry="box" material={color}
          position={[cx + (sx * w) / 2, h / 2, cz + (sz * d) / 2]} sizeX={t} sizeY={h} sizeZ={t} />
      ))}
    </>
  );
}

function Building({ b, id }: { b: typeof BLDGS[number]; id: string }) {
  const w = b.x1 - b.x0 + 1;
  const d = b.y1 - b.y0 + 1;
  const h = HEIGHTS[b.h] * HEIGHT_SCALE;
  const cx = b.x0 + w / 2;
  const cz = b.y0 + d / 2;
  return (
    <>
      {/* facade with lit window-grid texture */}
      <Scene3D.Mesh key={`${id}-box`} geometry="box" material={WHITE} texture={FACADE_TEX[b.style]}
        position={[cx, h / 2, cz]} sizeX={w} sizeY={h} sizeZ={d} />
      {/* roof cap — kept to the footprint so it doesn't hide the neon rim */}
      <Scene3D.Mesh key={`${id}-roof`} geometry="box" material={buildingRoof(b.style)}
        position={[cx, h + 0.05, cz]} sizeX={w - 0.04} sizeY={0.14} sizeZ={d - 0.04} />
      <NeonCage id={id} cx={cx} cz={cz} w={w} d={d} h={h + 0.05} color={neonRim(b.style)} />
    </>
  );
}

function Buildings() {
  return <>{BLDGS.map((b, i) => <Building key={`bldg-${i}`} id={`bldg-${i}`} b={b} />)}</>;
}

// Fuller palm: trunk + a drooping star of fronds in two tiers + a crown nub.
function Palm({ id, x, z }: { id: string; x: number; z: number }) {
  const ring = (tier: number, n: number, len: number, droop: number, y: number, reach: number) =>
    Array.from({ length: n }, (_, k) => {
      const a = (k / n) * Math.PI * 2 + tier * 0.4;
      return (
        <Scene3D.Mesh key={`${id}-f${tier}-${k}`} geometry="box" material={PALM_FROND}
          position={[x + Math.cos(a) * reach, y, z + Math.sin(a) * reach]}
          rotation={[droop, -a, 0]} sizeX={len} sizeY={0.05} sizeZ={0.22} />
      );
    });
  return (
    <>
      <Scene3D.Mesh key={`${id}-trunk`} geometry="cylinder" material={PALM_TRUNK}
        position={[x, 1.1, z]} radius={0.12} sizeY={2.2} />
      <Scene3D.Mesh key={`${id}-crown`} geometry="box" material={PALM_FROND}
        position={[x, 2.3, z]} sizeX={0.3} sizeY={0.18} sizeZ={0.3} />
      {ring(0, 5, 1.0, 0.35, 2.32, 0.55)}
      {ring(1, 4, 0.7, 0.8, 2.18, 0.42)}
    </>
  );
}

function Dumpster({ id, x, z }: { id: string; x: number; z: number }) {
  return (
    <>
      <Scene3D.Mesh key={`${id}-body`} geometry="box" material={DUMPSTER}
        position={[x, 0.42, z]} sizeX={0.82} sizeY={0.78} sizeZ={0.66} />
      <Scene3D.Mesh key={`${id}-lid`} geometry="box" material={DUMPSTER_LID}
        position={[x, 0.84, z]} sizeX={0.9} sizeY={0.12} sizeZ={0.74} />
    </>
  );
}

function Sign({ id, x, z, tint }: { id: string; x: number; z: number; tint: number }) {
  return (
    <>
      <Scene3D.Mesh key={`${id}-pole`} geometry="cylinder" material={SIGN_POLE}
        position={[x, 0.9, z]} radius={0.05} sizeY={1.8} />
      <Scene3D.Mesh key={`${id}-panel`} geometry="box" material={signNeon(tint)}
        position={[x, 1.9, z]} sizeX={0.7} sizeY={0.5} sizeZ={0.08} />
      {/* dark frame behind the lit panel for contrast */}
      <Scene3D.Mesh key={`${id}-back`} geometry="box" material={SIGN_POLE}
        position={[x, 1.9, z - 0.05]} sizeX={0.82} sizeY={0.62} sizeZ={0.04} />
    </>
  );
}

function Props() {
  return (
    <>
      {PROPS.map((p, i) => {
        const id = `prop-${i}`;
        if (p.kind === 'palm') return <Palm key={id} id={id} x={p.x} z={p.y} />;
        if (p.kind === 'dumpster') return <Dumpster key={id} id={id} x={p.x} z={p.y} />;
        return <Sign key={id} id={id} x={p.x} z={p.y} tint={p.tint} />;
      })}
    </>
  );
}

// Door leaf oriented to the wall it sits in: if the wall runs east-west (its
// left/right neighbours are wall), the leaf is wide along X; otherwise along Z.
// Open = swung ~80° about its hinge edge.
function DoorLeaf({ door }: { door: Door }) {
  const { x, y, open } = door;
  const ewWall = cityTileAt(x - 1, y) === T.Wall || cityTileAt(x + 1, y) === T.Wall;
  const cx = x + 0.5;
  const cz = y + 0.5;
  const swing = open ? 1.4 : 0;
  const yaw = ewWall ? swing : Math.PI / 2 + swing;
  const wide = 0.92;
  return (
    <>
      <Scene3D.Mesh key={`${door.id}-leaf`} geometry="box" material={open ? DOOR_FRAME : DOOR_LEAF}
        position={[cx, 0.85, cz]} rotation={[0, yaw, 0]}
        sizeX={wide} sizeY={1.7} sizeZ={0.14} />
    </>
  );
}

function Doors({ doors }: { doors: Door[] }) {
  return <>{doors.map((d) => <DoorLeaf key={d.id} door={d} />)}</>;
}

// Storefront interactables get a little awning so the clickable spot reads.
function Storefronts({ entities }: { entities: Ent[] }) {
  return (
    <>
      {entities.filter((e) => e.kind === 'storefront').map((e, i) => (
        <Scene3D.Mesh key={`store-${i}`} geometry="box" material={signNeon(e.tint)}
          position={[e.x, 1.0, e.y]} sizeX={1.2} sizeY={0.18} sizeZ={1.0} />
      ))}
    </>
  );
}

export function City3D({ doors, entities }: { doors: Door[]; entities: Ent[] }) {
  return (
    <>
      <Ground />
      <RoadLines />
      <Buildings />
      <Props />
      <Doors doors={doors} />
      <Storefronts entities={entities} />
    </>
  );
}
