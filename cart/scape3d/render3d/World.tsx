// The meshed world dropped into the single <Scene3D>. STATIC geometry (ground,
// buildings, props, furniture) is baked once by the entity tree (world/atlas.tsx →
// frags). Only the DYNAMIC thingymajiggers live here: doors (open/close), floorboards
// (pry state), storefront awnings — read from live game state and resolved through the
// SAME registry as the static ones, so no world object's mesh lives in two places.

import { Fragment } from 'react';
import { frags, kindAt, features } from '../world/atlas';
import { heightAt } from '../world/terrain';
import { T } from '../world/citymap';
import { THINGYMAJIGGERS } from '../thingymajiggers';
import { itemModule } from '../registries/items';
import type { Door } from '../systems/doors';
import type { Ent, WorldItem3D } from '../state/world';

export function World({ doors, entities, worldItems }: { doors: Door[]; entities: Ent[]; worldItems: WorldItem3D[] }) {
  return (
    <>
      {frags}
      {worldItems.map((wi) => {
        const model = itemModule(wi.typeKey)?.world.model;
        return model ? (
          <Fragment key={wi.id}>{model({ x: wi.x, z: wi.y, baseY: heightAt(wi.x, wi.y) })}</Fragment>
        ) : null;
      })}
      {doors.map((d) => {
        const ewWall = kindAt(d.x - 1, d.y) === T.Wall || kindAt(d.x + 1, d.y) === T.Wall;
        return (
          <Fragment key={d.id}>
            {THINGYMAJIGGERS.door.Mesh({ x: d.x, z: d.y, baseY: heightAt(d.x + 0.5, d.y + 0.5), open: d.open, ewWall })}
          </Fragment>
        );
      })}
      {features.filter((f) => f.kind === 'floorboard').map((f) => (
        <Fragment key={f.path}>
          {THINGYMAJIGGERS.floorboard.Mesh({ x: f.x, z: f.y, baseY: heightAt(f.x + 0.5, f.y + 0.5), opened: f.cache.opened })}
        </Fragment>
      ))}
      {entities.filter((e) => e.kind === 'storefront').map((e, i) => (
        <Fragment key={`store-${i}`}>
          {THINGYMAJIGGERS.storefront.Mesh({ x: e.x, z: e.y, baseY: heightAt(e.x, e.y), tint: e.tint })}
        </Fragment>
      ))}
    </>
  );
}
