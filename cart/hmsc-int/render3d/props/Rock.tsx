import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { WorldProp } from '../../design';
import { propKindDefinition } from '../../game/kinds/props';
import { at, type V3 } from './place';

// The rock family: overlapping flattened spheres in greys so each form reads
// as faceted stone, not a ball. Sized to its kind's footprint radius and height
// so the mesh and the collision square agree. Solid — the player bumps them.
//
// Beyond the small/medium/large boulder trio: boulder (a huge climber),
// rockFlat (a low slab), rockSpire (a standing stone), rockMossy (green-capped),
// rockPile (a scatter of small stones).

const STONE = '#6b7079';
const STONE_DARK = '#52565d';
const STONE_LIGHT = '#82868d';
const MOSS = '#3f6b33';
const MOSS_LIGHT = '#558a42';

type Boulder = { local: V3; radius: number; squash: number; material: string };

// Each form is a recipe of blobs in footprint-radius (r) / height (h) space.
function rockBlobs(kind: WorldProp['kind'], r: number, h: number): Boulder[] {
  switch (kind) {
    case 'boulder':
      // One huge mass + shoulder stones; tops out near h so it reads massive.
      return [
        { local: [0, h * 0.45, 0], radius: r * 0.92, squash: 0.92, material: STONE },
        { local: [r * 0.45, h * 0.3, -r * 0.3], radius: r * 0.6, squash: 0.8, material: STONE_DARK },
        { local: [-r * 0.5, h * 0.28, r * 0.35], radius: r * 0.55, squash: 0.75, material: STONE_LIGHT },
        { local: [-r * 0.12, h * 0.68, -r * 0.2], radius: r * 0.5, squash: 0.8, material: STONE_DARK },
        { local: [r * 0.2, h * 0.6, r * 0.4], radius: r * 0.42, squash: 0.72, material: STONE_LIGHT },
      ];
    case 'rockFlat':
      // A low slab: very flattened wide blobs.
      return [
        { local: [0, h * 0.5, 0], radius: r * 0.98, squash: 0.5, material: STONE },
        { local: [r * 0.35, h * 0.55, r * 0.25], radius: r * 0.6, squash: 0.5, material: STONE_LIGHT },
        { local: [-r * 0.4, h * 0.45, -r * 0.2], radius: r * 0.62, squash: 0.48, material: STONE_DARK },
      ];
    case 'rockSpire':
      // A standing stone: stacked blobs narrowing upward, slightly off-axis.
      return [
        { local: [0, h * 0.2, 0], radius: r * 0.95, squash: 1.1, material: STONE_DARK },
        { local: [r * 0.06, h * 0.5, -r * 0.04], radius: r * 0.72, squash: 1.4, material: STONE },
        { local: [-r * 0.05, h * 0.78, r * 0.05], radius: r * 0.48, squash: 1.5, material: STONE_LIGHT },
        { local: [r * 0.03, h * 0.94, 0], radius: r * 0.26, squash: 1.3, material: STONE },
      ];
    case 'rockMossy':
      // The medium boulder with moss caps draped on its sunny side.
      return [
        { local: [0, h * 0.42, 0], radius: r * 0.95, squash: 0.78, material: STONE },
        { local: [r * 0.5, h * 0.3, -r * 0.35], radius: r * 0.62, squash: 0.72, material: STONE_DARK },
        { local: [-r * 0.48, h * 0.26, r * 0.4], radius: r * 0.58, squash: 0.7, material: STONE_LIGHT },
        { local: [0, h * 0.62, 0], radius: r * 0.72, squash: 0.4, material: MOSS },
        { local: [r * 0.42, h * 0.5, -r * 0.28], radius: r * 0.42, squash: 0.36, material: MOSS_LIGHT },
        { local: [-r * 0.35, h * 0.46, r * 0.3], radius: r * 0.38, squash: 0.34, material: MOSS },
      ];
    case 'rockPile':
      // A scatter of small stones at ground level, taller in the middle.
      return [
        { local: [0, h * 0.5, 0], radius: r * 0.5, squash: 0.85, material: STONE },
        { local: [r * 0.55, h * 0.3, r * 0.2], radius: r * 0.38, squash: 0.8, material: STONE_DARK },
        { local: [-r * 0.5, h * 0.32, -r * 0.25], radius: r * 0.4, squash: 0.78, material: STONE_LIGHT },
        { local: [r * 0.2, h * 0.28, -r * 0.55], radius: r * 0.34, squash: 0.75, material: STONE },
        { local: [-r * 0.25, h * 0.26, r * 0.55], radius: r * 0.32, squash: 0.72, material: STONE_DARK },
        { local: [r * 0.6, h * 0.22, -r * 0.35], radius: r * 0.26, squash: 0.7, material: STONE_LIGHT },
        { local: [-r * 0.65, h * 0.2, r * 0.1], radius: r * 0.24, squash: 0.68, material: STONE },
      ];
    // rock / rockLarge / rockSmall: the original squat boulder cluster.
    default:
      return [
        { local: [0, h * 0.42, 0], radius: r * 0.95, squash: 0.78, material: STONE },
        { local: [r * 0.5, h * 0.3, -r * 0.35], radius: r * 0.62, squash: 0.72, material: STONE_DARK },
        { local: [-r * 0.48, h * 0.26, r * 0.4], radius: r * 0.58, squash: 0.7, material: STONE_LIGHT },
        { local: [-r * 0.1, h * 0.5, -r * 0.5], radius: r * 0.5, squash: 0.66, material: STONE_DARK },
      ];
  }
}

export function Rock(props: { prop: WorldProp }) {
  const def = propKindDefinition(props.prop.kind);
  const boulders = rockBlobs(props.prop.kind, def.footprintRadiusMeters, def.heightMeters);
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
