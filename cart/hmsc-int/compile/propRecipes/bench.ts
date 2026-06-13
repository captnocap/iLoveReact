import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';

const COLORS = {
  wood: recipeColor('#8a6240'),
  woodDark: recipeColor('#6b4a2e'),
  metal: recipeColor('#3a3f46'),
} satisfies Record<string, Color>;

export function benchRecipe(footprintRadiusMeters: number): PropRecipe {
  const w = footprintRadiusMeters * 2;
  const parts: PropRecipePart[] = [
    {
      id: 'leftSupport',
      shape: 'box',
      position: { x: -w * 0.44, y: 0.225, z: 0 },
      size: { width: 0.06, height: 0.45, depth: 0.5 },
      color: COLORS.metal,
    },
    {
      id: 'rightSupport',
      shape: 'box',
      position: { x: w * 0.44, y: 0.225, z: 0 },
      size: { width: 0.06, height: 0.45, depth: 0.5 },
      color: COLORS.metal,
    },
    {
      id: 'rearSeatSlat',
      shape: 'box',
      position: { x: 0, y: 0.45, z: -0.14 },
      size: { width: w, height: 0.04, depth: 0.13 },
      color: COLORS.wood,
    },
    {
      id: 'middleSeatSlat',
      shape: 'box',
      position: { x: 0, y: 0.45, z: 0.02 },
      size: { width: w, height: 0.04, depth: 0.13 },
      color: COLORS.woodDark,
    },
    {
      id: 'frontSeatSlat',
      shape: 'box',
      position: { x: 0, y: 0.45, z: 0.18 },
      size: { width: w, height: 0.04, depth: 0.13 },
      color: COLORS.wood,
    },
    {
      id: 'lowerBackSlat',
      shape: 'box',
      position: { x: 0, y: 0.78, z: 0.26 },
      size: { width: w, height: 0.12, depth: 0.04 },
      color: COLORS.wood,
      rotation: { pitch: -12, yaw: 0, roll: 0 },
    },
    {
      id: 'upperBackSlat',
      shape: 'box',
      position: { x: 0, y: 0.92, z: 0.29 },
      size: { width: w, height: 0.12, depth: 0.04 },
      color: COLORS.woodDark,
      rotation: { pitch: -12, yaw: 0, roll: 0 },
    },
  ];
  return { id: 'bench', parts };
}

export function benchParts(footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(benchRecipe(footprintRadiusMeters));
}
