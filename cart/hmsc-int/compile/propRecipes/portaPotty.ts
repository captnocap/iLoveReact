import { box, cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const portaPottyDef: PropKindDefinition = {
  kind: 'portaPotty',
  label: 'Porta Potty',
  solid: true,
  footprintRadiusMeters: 0.55,
  footprintDepthMeters: 0.55,
  heightMeters: 2.3,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'soft',
};

export function portaPottyParts(): PropPartSpec[] {
  const shell = hx('#3a7d80');
  const door = hx('#2d6a4f');
  const dark = hx('#22262b');
  const metal = hx('#9aa1ab');
  const w = 1.1;
  const d = 1.1;
  const h = 2.2;
  return [
    box([0, h / 2, 0], [w, h, d], shell),
    box([0, h / 2, -d / 2 + 0.02], [w * 0.85, h * 0.85, 0.04], door),
    // occupancy indicator
    box([0, h * 0.85, -d / 2 - 0.005], [w * 0.6, 0.08, 0.02], dark),
    // door handle
    box([-w * 0.25, h * 0.5, -d / 2 - 0.005], [0.04, 0.5, 0.02], metal),
    box([-w * 0.25, h * 0.55, -d / 2 - 0.01], [0.06, 0.03, 0.03], metal),
    // roof vent pipe
    cylinder8([0.3, h + 0.08, 0.2], 0.06, 0.16, shell),
    cylinder8([0.3, h + 0.17, 0.2], 0.07, 0.02, dark),
    // roof cap / light
    box([0, h + 0.02, 0], [w * 0.9, 0.04, d * 0.8], dark),
    cylinder8([0.35, h + 0.05, -0.25], 0.04, 0.04, metal),
    // base skids
    box([0, 0.06, 0], [w * 1.05, 0.08, d * 1.05], dark),
  ];
}
