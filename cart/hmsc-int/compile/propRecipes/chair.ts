import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';

const COLORS = {
  red: recipeColor('#b03a2e'),
  blue: recipeColor('#2e6fb0'),
  green: recipeColor('#3a8f4f'),
  wood: recipeColor('#8a6240'),
  woodDark: recipeColor('#6b4a2e'),
  metal: recipeColor('#3a3f46'),
} satisfies Record<string, Color>;

const PAINTS: Record<string, Color> = {
  chairRed: COLORS.red,
  chairBlue: COLORS.blue,
  chairGreen: COLORS.green,
};

export function chairRecipe(kind: string): PropRecipe {
  // Painted variants share the chair body; wood keeps wood legs, painted
  // chairs get dark metal legs (mirrors render3d/props/Furniture.tsx).
  const body = PAINTS[kind] ?? COLORS.wood;
  const legs = PAINTS[kind] ? COLORS.metal : COLORS.woodDark;
  const parts: PropRecipePart[] = [
    {
      id: 'frontRightLeg',
      shape: 'box',
      position: { x: 0.2, y: 0.225, z: 0.2 },
      size: { width: 0.05, height: 0.45, depth: 0.05 },
      color: legs,
    },
    {
      id: 'frontLeftLeg',
      shape: 'box',
      position: { x: -0.2, y: 0.225, z: 0.2 },
      size: { width: 0.05, height: 0.45, depth: 0.05 },
      color: legs,
    },
    {
      id: 'rearRightLeg',
      shape: 'box',
      position: { x: 0.2, y: 0.225, z: -0.2 },
      size: { width: 0.05, height: 0.45, depth: 0.05 },
      color: legs,
    },
    {
      id: 'rearLeftLeg',
      shape: 'box',
      position: { x: -0.2, y: 0.225, z: -0.2 },
      size: { width: 0.05, height: 0.45, depth: 0.05 },
      color: legs,
    },
    {
      id: 'seat',
      shape: 'box',
      position: { x: 0, y: 0.45, z: 0 },
      size: { width: 0.5, height: 0.06, depth: 0.5 },
      color: body,
    },
    {
      id: 'back',
      shape: 'box',
      position: { x: 0, y: 0.72, z: 0.23 },
      size: { width: 0.5, height: 0.5, depth: 0.05 },
      color: body,
      rotation: { pitch: -6, yaw: 0, roll: 0 },
    },
  ];
  return { id: kind, parts };
}

export function chairParts(kind: string): PropPartSpec[] {
  return lowerPropRecipe(chairRecipe(kind));
}
