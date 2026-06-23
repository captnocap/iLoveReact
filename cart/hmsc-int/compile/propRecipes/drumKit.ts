import { box, cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const drumKitDef: PropKindDefinition = {
  kind: 'drumKit',
  label: 'Drum Kit',
  solid: true,
  footprintRadiusMeters: 0.85,
  heightMeters: 1.5,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'soft',
};

export function drumKitParts(): PropPartSpec[] {
  const red = hx('#b3221c');
  const white = hx('#eef0f2');
  const chrome = hx('#9aa1ab');
  const brass = hx('#d4a83a');
  return [
    // kick drum
    cylinder8([0, 0.25, 0], 0.28, 0.5, red),
    cylinder8([0, 0.25, -0.14], 0.22, 0.04, white),
    // snare
    cylinder8([-0.35, 0.55, 0.2], 0.16, 0.18, red),
    cylinder8([-0.35, 0.55, 0.29], 0.13, 0.02, white),
    // floor tom
    cylinder8([0.42, 0.35, 0.25], 0.2, 0.32, red),
    cylinder8([0.42, 0.35, 0.34], 0.16, 0.02, white),
    box([0.42, 0.18, 0.25], [0.02, 0.36, 0.02], chrome),
    box([0.35, 0.12, 0.18], [0.02, 0.24, 0.02], chrome),
    box([0.49, 0.12, 0.18], [0.02, 0.24, 0.02], chrome),
    box([0.35, 0.12, 0.32], [0.02, 0.24, 0.02], chrome),
    box([0.49, 0.12, 0.32], [0.02, 0.24, 0.02], chrome),
    // hi-hat
    cylinder8([0.35, 0.7, 0.15], 0.14, 0.02, white),
    cylinder8([0.35, 0.65, 0.15], 0.14, 0.02, white),
    box([0.35, 0.5, 0.15], [0.02, 0.4, 0.02], chrome),
    // crash/ride cymbal left
    cylinder8([-0.55, 1.05, -0.15], 0.2, 0.01, brass),
    box([-0.55, 0.85, -0.15], [0.02, 0.42, 0.02], chrome),
    box([-0.55, 0.12, -0.15], [0.02, 0.04, 0.02], chrome),
    // ride cymbal right
    cylinder8([0.55, 1.15, -0.1], 0.22, 0.01, brass),
    box([0.55, 0.95, -0.1], [0.02, 0.42, 0.02], chrome),
    box([0.55, 0.12, -0.1], [0.02, 0.04, 0.02], chrome),
    // central cymbal
    cylinder8([0, 1.2, -0.35], 0.22, 0.01, brass),
    box([0, 0.95, -0.35], [0.02, 0.52, 0.02], chrome),
    box([0, 0.12, -0.35], [0.02, 0.04, 0.02], chrome),
    // snare stand
    box([-0.35, 0.35, 0.2], [0.02, 0.45, 0.02], chrome),
    box([-0.35, 0.12, 0.2], [0.02, 0.04, 0.02], chrome),
  ];
}
