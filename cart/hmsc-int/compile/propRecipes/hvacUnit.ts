import { box, cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const hvacUnitDef: PropKindDefinition = {
  kind: 'hvacUnit',
  label: 'HVAC Unit',
  solid: true,
  footprintRadiusMeters: 0.55,
  footprintDepthMeters: 0.55,
  heightMeters: 0.9,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'hard',
};

export function hvacUnitParts(): PropPartSpec[] {
  const body = hx('#d6d9dc');
  const trim = hx('#aab0b6');
  const metal = hx('#6c727b');
  const dark = hx('#22262b');
  const parts: PropPartSpec[] = [
    box([0, 0.45, 0], [1.1, 0.9, 1.1], body),
    box([0, 0.88, 0], [1.0, 0.04, 0.9], trim),
    // fan housings
    cylinder8([-0.42, 0.6, 0.42], 0.08, 0.25, metal),
    cylinder8([0.42, 0.6, 0.42], 0.08, 0.25, metal),
    // fan grilles
    cylinder8([-0.42, 0.6, 0.55], 0.06, 0.02, dark),
    cylinder8([0.42, 0.6, 0.55], 0.06, 0.02, dark),
    // front vent slats
    box([0, 0.5, 0.56], [0.7, 0.4, 0.02], metal),
  ];
  // vent slats
  for (let i = 0; i < 5; i++) {
    const y = 0.32 + i * 0.09;
    parts.push(box([0, y, 0.57], [0.65, 0.02, 0.02], dark));
  }
  // feet
  parts.push(box([-0.48, 0.04, -0.48], [0.08, 0.06, 0.08], metal));
  parts.push(box([0.48, 0.04, -0.48], [0.08, 0.06, 0.08], metal));
  parts.push(box([-0.48, 0.04, 0.48], [0.08, 0.06, 0.08], metal));
  parts.push(box([0.48, 0.04, 0.48], [0.08, 0.06, 0.08], metal));
  return parts;
}
