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
import { skinGridCols, skinGridFloors } from '../buildingSkins';
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
      // An image panel samples its texture on its broad faces at a 1×1 grid —
      // one whole image per face (an album cover, not a tiled facade). Every
      // OTHER part (the chassis boxes/cylinders) is textureable too now
      // (req_0757): the texture WRAPS the whole mesh (no texturedFaces limit)
      // and tiles by the part's footprint, like a building skin.
      texturedFaces: image ? ['front', 'back'] : undefined,
      tex: image ? { cols: 1, floors: 1 } : { cols: skinGridCols(Math.max(spec.size[0], spec.size[2])), floors: skinGridFloors(spec.size[1]) },
      textureable: true,
    };
  });
}

export function DataProp(props: { prop: WorldProp }) {
  return <TexturedParts parts={dataPropParts(props.prop)} textures={props.prop.partTextures} />;
}
