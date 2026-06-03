import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { WorldProp } from '../../design';
import { propKindDefinition } from '../../world/propKinds';
import { at, type V3 } from './place';

// A Fortnite-style bush: solid from outside, see-through from inside, flat on the
// ground, with a knobbly leafy surface (not a smooth dome).
//
// Two tricks combine:
//  • See-through dome — back-face culling hides every face of a sphere that
//    ENCLOSES the camera, so standing inside the bush vanishes it and you see
//    out, while from outside the same faces are a solid green wall. The rule: a
//    blob's offset from centre stays SMALLER than its radius, so the spot you
//    hide in is inside it. The knobs obey this too — their offset is just under
//    their radius — so they bulge the silhouette without breaking the see-out.
//  • Flat bottom — the big blobs are anchored low so their rounded undersides
//    sink below the ground, which the opaque floor clips to a flat base.
//
// The clumpy look comes from a ring of knobs at irregular heights poking past the
// main dome (main radius < knob reach), so the surface reads as foliage tufts,
// not a balloon. Still non-solid — you walk straight in. One scaled unit sphere
// per blob, so all bushes share one geometry and instance cheaply.

const LEAF_DARK = '#1f4a20';
const LEAF_MID = '#2f6b2f';
const LEAF_LIGHT = '#43883a';
const PALETTE = [LEAF_DARK, LEAF_MID, LEAF_LIGHT];

// Each blob: centre cx/cz as a fraction of canopy radius, cy as a fraction of
// height; rh = horizontal semi-axis (× radius), rv = vertical semi-axis
// (× height).
type Blob = { cx: number; cy: number; cz: number; rh: number; rv: number; tint: number };

const MID_RING_KNOBS = 9;
const UPPER_RING_KNOBS = 6;

function buildBlobs(): Blob[] {
  const blobs: Blob[] = [
    // Main dome — kept a touch narrow (rh 0.86) so the knobs clearly poke past
    // it; top reaches heightMeters, bottom (−0.7h) is clipped flat by the ground.
    { cx: 0, cy: 0.18, cz: 0, rh: 0.86, rv: 0.82, tint: 1 },
    // Low skirt blobs fattening the base (sink below ground for the flat bottom).
    { cx: 0.4, cy: 0.1, cz: 0.04, rh: 0.62, rv: 0.52, tint: 0 },
    { cx: -0.38, cy: 0.12, cz: 0.12, rh: 0.64, rv: 0.52, tint: 2 },
    { cx: 0.08, cy: 0.08, cz: -0.42, rh: 0.6, rv: 0.5, tint: 2 },
    { cx: -0.14, cy: 0.1, cz: 0.4, rh: 0.62, rv: 0.5, tint: 0 },
    // Crown tufts.
    { cx: 0.12, cy: 0.62, cz: 0.08, rh: 0.4, rv: 0.36, tint: 2 },
    { cx: -0.16, cy: 0.66, cz: -0.06, rh: 0.36, rv: 0.34, tint: 0 },
  ];
  // Mid ring: pronounced knobs at alternating heights, offset just under radius
  // so each still encloses the centre. Irregular size/height kills the smoothness.
  for (let i = 0; i < MID_RING_KNOBS; i += 1) {
    const a = (i / MID_RING_KNOBS) * Math.PI * 2;
    const rh = 0.6 + (i % 3) * 0.05;
    blobs.push({
      cx: Math.cos(a) * (rh - 0.04),
      cz: Math.sin(a) * (rh - 0.04),
      cy: 0.26 + (i % 2) * 0.14,
      rh,
      rv: 0.46,
      tint: i % 3,
    });
  }
  // Upper ring: smaller tufts nearer the crown.
  for (let i = 0; i < UPPER_RING_KNOBS; i += 1) {
    const a = (i / UPPER_RING_KNOBS) * Math.PI * 2 + 0.4;
    const rh = 0.42 + (i % 2) * 0.05;
    blobs.push({
      cx: Math.cos(a) * (rh - 0.06),
      cz: Math.sin(a) * (rh - 0.06),
      cy: 0.5 + (i % 2) * 0.1,
      rh,
      rv: 0.4,
      tint: (i % 2) === 0 ? 2 : 0,
    });
  }
  return blobs;
}

const BLOBS = buildBlobs();

export function Bush(props: { prop: WorldProp }) {
  const def = propKindDefinition(props.prop.kind);
  const radius = def.footprintRadiusMeters;
  const height = def.heightMeters;
  return (
    <>
      {BLOBS.map((blob, index) => {
        const center: V3 = [blob.cx * radius, blob.cy * height, blob.cz * radius];
        return (
          <Scene3D.Mesh
            key={index}
            geometry={Geometry.Sphere}
            params={{ radius: 1, segments: 12, rings: 8 }}
            scale={[blob.rh * radius, blob.rv * height, blob.rh * radius]}
            material={PALETTE[blob.tint]}
            position={at(props.prop, center)}
          />
        );
      })}
    </>
  );
}
