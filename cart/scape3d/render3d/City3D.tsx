// The meshed city — built from the SAME authored data the 2D map used
// (citymap.ts RECTS / BLDGS / PROPS), so the 3D world is the 2D world extruded.
//
// Ground: one base sidewalk plane + a plane per zone rect. Buildings: extruded
// boxes per BLDG with a brighter roof cap and a lit window band. Props: palms
// (cylinder trunk + box fronds), dumpsters, neon signs. Doors: a leaf that swings
// open, oriented to the wall it sits in. All boxes/planes/cylinders — no spheres,
// to stay deep under the vertex budget.

import { Scene3D } from '@reactjit/runtime/primitives';
import {
  BLDGS, RECTS, PROPS, HEIGHTS, T, CITY_W, CITY_H, cityTileAt,
} from '../world/citymap';
import type { Door } from '../systems/doors';
import type { Ent } from '../state/world';
import {
  ZONE_HEX, buildingFacade, buildingRoof, windowGlow,
  PALM_TRUNK, PALM_FROND, DUMPSTER, DUMPSTER_LID, SIGN_POLE, signNeon,
  DOOR_LEAF, DOOR_FRAME,
} from './palette3d';

const GROUND_Y = 0;

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
      {/* Ground is built from thin BOXES, not planes: the framework's plane is
          single-sided with its CCW front facing -Y, so a top-down camera culls it.
          A box's top face is always there to catch the light. */}
      <Scene3D.Mesh
        geometry="box" material={ZONE_HEX.sidewalk}
        position={[CITY_W / 2, GROUND_Y - 0.06, CITY_H / 2]}
        sizeX={CITY_W + 4} sizeY={0.12} sizeZ={CITY_H + 4}
      />
      {RECTS.map((r, i) => {
        const w = r.x1 - r.x0 + 1;
        const d = r.y1 - r.y0 + 1;
        return (
          <Scene3D.Mesh
            key={`zone-${i}`}
            geometry="box" material={zoneHex(r.t)}
            position={[r.x0 + w / 2, GROUND_Y + 0.01 + i * 0.004, r.y0 + d / 2]}
            sizeX={w} sizeY={0.08} sizeZ={d}
          />
        );
      })}
    </>
  );
}

function Building({ b, id }: { b: typeof BLDGS[number]; id: string }) {
  const w = b.x1 - b.x0 + 1;
  const d = b.y1 - b.y0 + 1;
  const h = HEIGHTS[b.h];
  const cx = b.x0 + w / 2;
  const cz = b.y0 + d / 2;
  return (
    <>
      <Scene3D.Mesh key={`${id}-box`} geometry="box" material={buildingFacade(b.style)}
        position={[cx, h / 2, cz]} sizeX={w} sizeY={h} sizeZ={d} />
      {/* roof cap */}
      <Scene3D.Mesh key={`${id}-roof`} geometry="box" material={buildingRoof(b.style)}
        position={[cx, h + 0.06, cz]} sizeX={w + 0.1} sizeY={0.16} sizeZ={d + 0.1} />
      {/* lit window band ~60% up */}
      <Scene3D.Mesh key={`${id}-win`} geometry="box" material={windowGlow(b.style)}
        position={[cx, h * 0.62, cz]} sizeX={w + 0.04} sizeY={0.28} sizeZ={d + 0.04} />
    </>
  );
}

function Buildings() {
  return <>{BLDGS.map((b, i) => <Building key={`bldg-${i}`} id={`bldg-${i}`} b={b} />)}</>;
}

function Palm({ id, x, z }: { id: string; x: number; z: number }) {
  const fronds = [0, 1, 2, 3, 4];
  return (
    <>
      <Scene3D.Mesh key={`${id}-trunk`} geometry="cylinder" material={PALM_TRUNK}
        position={[x, 1.1, z]} radius={0.12} sizeY={2.2} />
      {fronds.map((k) => {
        const a = (k / fronds.length) * Math.PI * 2;
        return (
          <Scene3D.Mesh key={`${id}-frond-${k}`} geometry="box" material={PALM_FROND}
            position={[x + Math.cos(a) * 0.5, 2.25, z + Math.sin(a) * 0.5]}
            rotation={[0.5, -a, 0]} sizeX={0.9} sizeY={0.06} sizeZ={0.26} />
        );
      })}
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
// Open = swung 80° about its hinge edge.
function DoorLeaf({ door }: { door: Door }) {
  const { x, y, open } = door;
  const ewWall = cityTileAt(x - 1, y) === T.Wall || cityTileAt(x + 1, y) === T.Wall;
  const cx = x + 0.5;
  const cz = y + 0.5;
  const swing = open ? 1.4 : 0;
  // hinge at one edge; approximate the swing with a yaw + offset toward the jamb
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
      <Buildings />
      <Props />
      <Doors doors={doors} />
      <Storefronts entities={entities} />
    </>
  );
}
