import { box, GRASS_DRY, GRASS_LIGHT, GRASS_MID, type Color, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition, type PropKind } from '../../game/kinds/props';

// A tuft is two crossed thin boxes — the PSX foliage cross, flat-shaded.
function tuft(x: number, z: number, w: number, h: number, color: Color): PropPartSpec[] {
  return [
    box([x, h / 2, z], [w, h, 0.02], color, [0, 45, 0]),
    box([x, h / 2, z], [w, h, 0.02], color, [0, -45, 0]),
  ];
}

// The shared grass field — five tufts laid out by the kind's footprint, reused by
// every grass prop (grassPatch, grassTall). Each grass prop is its own file; this
// is the one field generator they share.
export function grassField(kind: PropKind): PropPartSpec[] {
  const def = propKindDefinition(kind);
  const r = def.footprintRadiusMeters;
  const h = def.heightMeters;
  const spots: [number, number, number, Color][] = [
    [0, 0, 1, GRASS_MID],
    [r * 0.55, r * 0.2, 0.8, GRASS_LIGHT],
    [-r * 0.5, -r * 0.3, 0.85, GRASS_MID],
    [r * 0.15, -r * 0.55, 0.7, GRASS_DRY],
    [-r * 0.3, r * 0.5, 0.75, GRASS_LIGHT],
  ];
  return spots.flatMap(([x, z, t, color]) => tuft(x, z, r * 0.55, h * t, color));
}

export function grassPatchParts(): PropPartSpec[] {
  return grassField('grassPatch');
}
