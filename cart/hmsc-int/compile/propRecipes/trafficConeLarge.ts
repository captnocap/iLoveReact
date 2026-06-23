import { box, cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const trafficConeLargeDef: PropKindDefinition = {
  kind: 'trafficConeLarge',
  label: 'Large Traffic Cone',
  solid: true,
  footprintRadiusMeters: 0.18,
  heightMeters: 0.75,
  tileKind: 'wall',
  trafficControl: 'none',
};

const ORANGE = hx('#e8702a');
const ORANGE_DARK = hx('#c4551c');
const STRIPE = hx('#d8dde4');
const BASE = hx('#111215');

export function trafficConeLargeParts(): PropPartSpec[] {
  return [
    // wide weighted base
    cylinder8([0, 0.03, 0], 0.28, 0.06, BASE),
    box([0, 0.06, 0], [0.56, 0.02, 0.56], BASE),

    // tapered cone body: four stacked cylinders shrinking toward the top
    cylinder8([0, 0.14, 0], 0.245, 0.16, ORANGE_DARK),
    cylinder8([0, 0.28, 0], 0.195, 0.16, ORANGE),
    cylinder8([0, 0.42, 0], 0.145, 0.16, ORANGE),
    cylinder8([0, 0.55, 0], 0.095, 0.14, ORANGE_DARK),
    cylinder8([0, 0.67, 0], 0.05, 0.12, ORANGE),

    // two reflective silver bands
    cylinder8([0, 0.30, 0], 0.2, 0.06, STRIPE),
    cylinder8([0, 0.46, 0], 0.125, 0.06, STRIPE),
  ];
}
