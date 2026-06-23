import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const hoseDef: PropKindDefinition = {
  kind: 'hose',
  label: 'Garden Hose',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 0.12,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

const COLORS = {
  hose: recipeColor('#2d6a4f'),
  nozzle: recipeColor('#9aa1ab'),
  brass: recipeColor('#b8a86a'),
} satisfies Record<string, Color>;

export function hoseRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [];
  const R = 0.18;
  const segments = 8;
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const x = Math.cos(angle) * R;
    const z = Math.sin(angle) * R;
    const yaw = (angle * 180) / Math.PI + 90;
    parts.push({
      id: `coil${i}`,
      shape: 'cylinder8',
      position: { x, y: 0.04, z },
      radius: 0.025,
      height: 0.14,
      color: COLORS.hose,
      rotation: { pitch: 90, yaw, roll: 0 },
    });
  }
  parts.push(
    { id: 'faucet', shape: 'cylinder8', position: { x: -R, y: 0.08, z: 0 }, radius: 0.03, height: 0.16, color: COLORS.nozzle, rotation: { pitch: 90, yaw: 0, roll: 0 } },
    { id: 'coupler', shape: 'cylinder8', position: { x: -R - 0.08, y: 0.08, z: 0 }, radius: 0.04, height: 0.08, color: COLORS.brass, rotation: { pitch: 90, yaw: 0, roll: 0 } },
    { id: 'nozzleTip', shape: 'cylinder8', position: { x: R + 0.06, y: 0.06, z: 0 }, radius: 0.02, height: 0.12, color: COLORS.nozzle, rotation: { pitch: 80, yaw: 0, roll: 0 } },
    { id: 'nozzleEnd', shape: 'box', position: { x: R + 0.12, y: 0.04, z: 0 }, size: { width: 0.06, height: 0.03, depth: 0.03 }, color: COLORS.brass },
  );
  return { id: 'hose', parts };
}

export function hoseParts(): PropPartSpec[] {
  return lowerPropRecipe(hoseRecipe());
}
