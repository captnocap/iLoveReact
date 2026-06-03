import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { WorldProp } from '../../design';
import { propKindDefinition } from '../../world/propKinds';
import { at, type V3 } from './place';

// A squat boulder: a few overlapping flattened spheres in two greys so it reads
// as faceted stone, not a ball. Sized to its kind's footprint radius and height
// so the mesh and the collision square agree. Solid — the player bumps it.

const STONE = '#6b7079';
const STONE_DARK = '#52565d';
const STONE_LIGHT = '#82868d';

type Boulder = { local: V3; radius: number; squash: number; material: string };

export function Rock(props: { prop: WorldProp }) {
  const def = propKindDefinition(props.prop.kind);
  const r = def.footprintRadiusMeters;
  // Boulders are placed within the footprint and scaled so the cluster tops out
  // near the kind's height. squash flattens each sphere into a stone, not a ball.
  const boulders: Boulder[] = [
    { local: [0, def.heightMeters * 0.42, 0], radius: r * 0.95, squash: 0.78, material: STONE },
    { local: [r * 0.5, def.heightMeters * 0.3, -r * 0.35], radius: r * 0.62, squash: 0.72, material: STONE_DARK },
    { local: [-r * 0.48, def.heightMeters * 0.26, r * 0.4], radius: r * 0.58, squash: 0.7, material: STONE_LIGHT },
    { local: [-r * 0.1, def.heightMeters * 0.5, -r * 0.5], radius: r * 0.5, squash: 0.66, material: STONE_DARK },
  ];
  return (
    <>
      {boulders.map((boulder, index) => (
        <Scene3D.Mesh
          key={index}
          geometry={Geometry.Sphere}
          params={{ radius: boulder.radius, segments: 12, rings: 8 }}
          scale={[1, boulder.squash, 1]}
          material={boulder.material}
          position={at(props.prop, boulder.local)}
        />
      ))}
    </>
  );
}
