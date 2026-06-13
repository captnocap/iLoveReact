import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const fireHydrantDef: PropKindDefinition = {
  kind: 'fireHydrant',
  label: 'Fire Hydrant',
  solid: true,
  footprintRadiusMeters: 0.27,
  // PROPSCALE-0611: real 0.75m × 1.15 (presence law)
  heightMeters: 0.86,
  tileKind: 'wall',
  trafficControl: 'none',
};

const FIRE_HYDRANT_COLORS = {
  red: recipeColor('#c2362f'),
  redDark: recipeColor('#9c2a25'),
  cap: recipeColor('#c9ccd1'),
} satisfies Record<string, Color>;

export function fireHydrantRecipe(heightMeters: number): PropRecipe {
  // Mirrors the live model (hmsc/render3d/props/FireHydrant.tsx): base
  // flange, barrel, squashed-sphere dome, bonnet + cap nut, front pumper
  // nozzle, and two side outlets. Prop yaw rides propRotation.
  const s = heightMeters / 0.78;
  const parts: PropRecipePart[] = [
    {
      id: 'baseFlange',
      shape: 'cylinder16',
      position: { x: 0, y: 0.03 * s, z: 0 },
      radius: 0.2 * s,
      height: 0.06 * s,
      color: FIRE_HYDRANT_COLORS.redDark,
    },
    {
      id: 'barrel',
      shape: 'cylinder16',
      position: { x: 0, y: 0.31 * s, z: 0 },
      radius: 0.13 * s,
      height: 0.46 * s,
      color: FIRE_HYDRANT_COLORS.red,
    },
    {
      id: 'dome',
      shape: 'sphere',
      position: { x: 0, y: 0.56 * s, z: 0 },
      size: { width: 0.31 * s, height: 0.217 * s, depth: 0.31 * s },
      color: FIRE_HYDRANT_COLORS.red,
    },
    {
      id: 'bonnet',
      shape: 'cylinder8',
      position: { x: 0, y: 0.67 * s, z: 0 },
      radius: 0.075 * s,
      height: 0.1 * s,
      color: FIRE_HYDRANT_COLORS.redDark,
    },
    {
      id: 'capNut',
      shape: 'cylinder8',
      position: { x: 0, y: 0.75 * s, z: 0 },
      radius: 0.07 * s,
      height: 0.08 * s,
      color: FIRE_HYDRANT_COLORS.cap,
    },
    {
      id: 'frontPumperNozzle',
      shape: 'cylinder8',
      position: { x: 0, y: 0.42 * s, z: -0.15 * s },
      radius: 0.055 * s,
      height: 0.14 * s,
      color: FIRE_HYDRANT_COLORS.cap,
      rotation: { pitch: 90, yaw: 0, roll: 0 },
    },
    {
      id: 'rightSideOutlet',
      shape: 'cylinder8',
      position: { x: 0.15 * s, y: 0.46 * s, z: 0 },
      radius: 0.05 * s,
      height: 0.12 * s,
      color: FIRE_HYDRANT_COLORS.cap,
      rotation: { pitch: 0, yaw: 0, roll: 90 },
    },
    {
      id: 'leftSideOutlet',
      shape: 'cylinder8',
      position: { x: -0.15 * s, y: 0.46 * s, z: 0 },
      radius: 0.05 * s,
      height: 0.12 * s,
      color: FIRE_HYDRANT_COLORS.cap,
      rotation: { pitch: 0, yaw: 0, roll: 90 },
    },
  ];
  return { id: 'fireHydrant', parts };
}

export function fireHydrantParts(heightMeters: number): PropPartSpec[] {
  return lowerPropRecipe(fireHydrantRecipe(heightMeters));
}
