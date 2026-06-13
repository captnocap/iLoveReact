// DataProp — the generic renderer for DATA-recipe props (PROPBATCH-0611).
//
// game/kinds/propModels.ts authors a prop's parts once in the compiled
// loader's shape vocabulary; this converts each PropPartSpec into a
// render3d/parts.tsx Part and draws the lot through TexturedParts. That buys
// every recipe the full part pipeline for free: parts with a `partId` (an
// album cover's 'cover', a poster's 'face', the vending machine's 'front')
// are click-to-pick image targets — apply any TEXTURE_REGISTRY id and the
// same id ships in the compiled bake as the part's material (req_0635).
//
// Chassis parts (no partId) are textureable:false — the pick flow offers only
// the faces that were authored to take an image, and part ids stay stable as
// recipes evolve.

import type { WorldProp } from '../../design';
import { propModelParts, propPartId, cssColor, type PropPartSpec } from '../../game/kinds/propModels';
import { type Part, TexturedParts } from '../parts';
import { at } from './place';

function partGeometry(spec: PropPartSpec): { geometry: string; params: Record<string, any>; scale?: [number, number, number] } {
  switch (spec.shape) {
    case 'cylinder8':
      return { geometry: 'Cylinder', params: { radius: spec.size[0] / 2, height: spec.size[1], segments: 8 } };
    case 'cylinder16':
      return { geometry: 'Cylinder', params: { radius: spec.size[0] / 2, height: spec.size[1], segments: 16 } };
    case 'sphere':
      // Unit-diameter sphere scaled to the spec's full extents — the same
      // semantics the compiled instance path gives INSTANCE_SHAPE_SPHERE.
      return { geometry: 'Sphere', params: { radius: 0.5, segments: 10, rings: 7 }, scale: [spec.size[0], spec.size[1], spec.size[2]] };
    case 'box':
    default:
      return { geometry: 'Box', params: { width: spec.size[0], height: spec.size[1], depth: spec.size[2] } };
  }
}

/** The Part[] for a data-recipe prop — [] when the kind has a bespoke model. */
export function dataPropParts(prop: WorldProp): Part[] {
  const specs = propModelParts(prop.kind);
  if (!specs) return [];
  return specs.map((spec, index): Part => {
    const g = partGeometry(spec);
    const image = spec.partId !== undefined;
    return {
      id: propPartId(spec, index),
      label: spec.partId ?? `Part ${index + 1}`,
      geometry: g.geometry,
      params: g.params,
      position: at(prop, [spec.local[0], spec.local[1], spec.local[2]]),
      rotation: [spec.rotation?.[0] ?? 0, prop.yawDegrees + (spec.rotation?.[1] ?? 0), spec.rotation?.[2] ?? 0],
      scale: g.scale,
      material: cssColor(spec.color),
      // ONE WHOLE IMAGE per part, always (PARTSCALE-0772). An image panel puts it
      // on its broad faces; every other part (chassis boxes/cylinders) wraps it on
      // all faces. Both bake at a 1×1 grid — the SAME thing the compiled game does
      // (worldGeometry interns the material by id with NO grid → one image per
      // face). The earlier size-derived tiling made the editor repeat the image
      // small while the game showed it whole — an editor↔compiled scale mismatch.
      texturedFaces: image ? ['front', 'back'] : undefined,
      tex: { cols: 1, floors: 1 },
      textureable: true,
    };
  });
}

export function DataProp(props: { prop: WorldProp }) {
  return <TexturedParts parts={dataPropParts(props.prop)} textures={props.prop.partTextures} />;
}
