// DataProp — the generic renderer for EVERY prop (PROPSINGLE-0782).
//
// A prop's geometry lives in exactly ONE place: resolvePropParts(prop) (the
// shared recipe resolver also used by the compile bake — render==bake by
// construction). This converts each PropPartSpec into a render3d/parts.tsx Part
// and draws the lot through TexturedParts, so EVERY prop — data-recipe kinds AND
// the formerly-bespoke ones (payphone, dumpster, trees, furniture…) — gets the
// full click-to-skin part pipeline for free: each part is a texture target, the
// id ships in the bake as that part's material. No per-prop render code anywhere.

import type { WorldProp } from '../../design';
import { propPartId, cssColor, type PropPartSpec } from '../../game/kinds/propModels';
import { resolvePropParts } from '../../compile/propRecipes/resolve';
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

// [propgone] probe (req_1632) — one line per distinct kind→part-count so an
// invisible recipe prop shows whether resolvePropParts returned NO geometry.
const _dataSeen = new Set<string>();
function dataGone(msg: string): void {
  if (_dataSeen.has(msg)) return;
  _dataSeen.add(msg);
  console.warn(`[propgone] DataProp ${msg}`);
}

/** The Part[] for ANY prop — resolved from the one shared recipe source. */
export function dataPropParts(prop: WorldProp): Part[] {
  const specs = resolvePropParts(prop);
  dataGone(`kind=${prop.kind} parts=${specs.length}${specs.length === 0 ? ' (resolvePropParts EMPTY → no mesh)' : ''}`);
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
      // a glass part (opacity < 1) draws translucent until a skin overrides it.
      opacity: spec.opacity,
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
