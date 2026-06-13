import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';

const COLORS = {
  wood: recipeColor('#6e5d4b'),
  barkDark: recipeColor('#4a3826'),
} satisfies Record<string, Color>;

export function treeDeadRecipe(heightMeters: number, footprintRadiusMeters: number): PropRecipe {
  const h = heightMeters;
  const r = footprintRadiusMeters;
  const parts: PropRecipePart[] = [
    {
      id: 'trunk',
      shape: 'cylinder8',
      position: { x: 0, y: h * 0.46, z: 0 },
      radius: r,
      height: h * 0.92,
      color: COLORS.wood,
    },
  ];
  const branches: [string, number, number, number, number][] = [
    ['lowerBranch', h * 0.55, 20, 55, h * 0.4],
    ['leftBranch', h * 0.68, 150, 48, h * 0.34],
    ['rearBranch', h * 0.78, 265, 40, h * 0.3],
    ['topBranch', h * 0.88, 80, 25, h * 0.24],
  ];
  branches.forEach(([id, y, angle, tilt, length], index) => {
    const rad = angle * Math.PI / 180;
    const tiltRad = tilt * Math.PI / 180;
    const reach = (length / 2) * Math.sin(tiltRad);
    parts.push({
      id,
      shape: 'cylinder8',
      position: {
        x: Math.cos(rad) * reach,
        y: y + (length / 2) * Math.cos(tiltRad),
        z: Math.sin(rad) * reach,
      },
      radius: r * 0.32,
      height: length,
      color: index % 2 === 0 ? COLORS.wood : COLORS.barkDark,
      rotation: { pitch: Math.sin(rad) * tilt, yaw: 0, roll: -Math.cos(rad) * tilt },
    });
  });
  return { id: 'treeDead', parts };
}

export function treeDeadParts(heightMeters: number, footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(treeDeadRecipe(heightMeters, footprintRadiusMeters));
}
