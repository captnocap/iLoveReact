import { box, cylinder16, hx, panel, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const tombstoneDef: PropKindDefinition = {
  kind: 'tombstone',
  label: 'Tombstone',
  solid: true,
  footprintRadiusMeters: 0.2,
  heightMeters: 0.9,
  tileKind: 'wall',
  trafficControl: 'none',
};

const STONE = hx('#8a8a8a');
const STONE_DARK = hx('#6e6e6e');
const MOSS = hx('#5a7a3f');

export function tombstoneParts(): PropPartSpec[] {
  return [
    // base slab
    box([0, 0.06, 0], [0.4, 0.1, 0.3], STONE_DARK),
    // main upright slab
    box([0, 0.48, 0], [0.32, 0.68, 0.12], STONE),
    // rounded top
    cylinder16([0, 0.84, 0], 0.16, 0.12, STONE, [0, 0, 90]),
    // engraved plaque (image target)
    panel('epitaph', [0, 0.55, 0.07], [0.2, 0.25, 0.01], STONE_DARK),
    // moss patch at base
    box([0.1, 0.12, 0.1], [0.1, 0.04, 0.08], MOSS, [0, 10, 0]),
  ];
}
