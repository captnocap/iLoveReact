// The meshed world. The STATIC geometry (ground, buildings, props, terraces) is
// baked once by the entity tree (world/atlas.tsx → WORLD.frags) and dropped into
// the single <Scene3D> as a flat fragment list. Only the DYNAMIC bits live here:
// doors (open/close), floorboards (pry state), storefront awnings.

import { Fragment } from 'react';
import { Scene3D } from '@reactjit/runtime/primitives';
import { frags, kindAt, features } from '../world/atlas';
import { heightAt } from '../world/terrain';
import { T } from '../world/citymap';
import type { Door } from '../systems/doors';
import type { Ent } from '../state/world';
import { DOOR_LEAF, DOOR_FRAME, signNeon } from './palette3d';

// Door leaf oriented to the wall it sits in; open = swung ~80°.
function DoorLeaf({ door }: { door: Door }) {
  const { x, y, open } = door;
  const ewWall = kindAt(x - 1, y) === T.Wall || kindAt(x + 1, y) === T.Wall;
  const cx = x + 0.5;
  const cz = y + 0.5;
  const swing = open ? 1.4 : 0;
  const yaw = ewWall ? swing : Math.PI / 2 + swing;
  return (
    <Scene3D.Mesh key={`${door.id}-leaf`} geometry="box" material={open ? DOOR_FRAME : DOOR_LEAF}
      position={[cx, heightAt(cx, cz) + 0.85, cz]} rotation={[0, yaw, 0]}
      sizeX={0.92} sizeY={1.7} sizeZ={0.14} />
  );
}

function Doors({ doors }: { doors: Door[] }) {
  return <>{doors.map((d) => <DoorLeaf key={d.id} door={d} />)}</>;
}

// Floorboards read their cache.opened live (mutated by the 'pry' action) — intact
// boards sit flush; a pried board tilts up beside a dark gap in the floor.
function Floorboards() {
  return (
    <>
      {features.filter((f) => f.kind === 'floorboard').map((f) => {
        const cx = f.x + 0.5;
        const cz = f.y + 0.5;
        const by = heightAt(cx, cz);
        if (f.cache.opened) {
          return (
            <Fragment key={f.path}>
              <Scene3D.Mesh geometry="box" material="#08080c" position={[cx, by + 0.02, cz]} sizeX={0.86} sizeY={0.06} sizeZ={0.86} />
              <Scene3D.Mesh geometry="box" material="#2a2018" position={[cx - 0.28, by + 0.34, cz]} rotation={[0, 0, 1.0]} sizeX={0.9} sizeY={0.06} sizeZ={0.84} />
            </Fragment>
          );
        }
        return (
          <Scene3D.Mesh key={f.path} geometry="box" material="#241c14"
            position={[cx, by + 0.07, cz]} sizeX={0.94} sizeY={0.06} sizeZ={0.94} />
        );
      })}
    </>
  );
}

function Storefronts({ entities }: { entities: Ent[] }) {
  return (
    <>
      {entities.filter((e) => e.kind === 'storefront').map((e, i) => (
        <Scene3D.Mesh key={`store-${i}`} geometry="box" material={signNeon(e.tint)}
          position={[e.x, heightAt(e.x, e.y) + 1.0, e.y]} sizeX={1.2} sizeY={0.18} sizeZ={1.0} />
      ))}
    </>
  );
}

export function City3D({ doors, entities }: { doors: Door[]; entities: Ent[] }) {
  return (
    <>
      {frags}
      <Doors doors={doors} />
      <Floorboards />
      <Storefronts entities={entities} />
    </>
  );
}
