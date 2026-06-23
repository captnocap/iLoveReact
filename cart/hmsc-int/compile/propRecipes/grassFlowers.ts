import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const grassFlowersDef: PropKindDefinition = {
  kind: 'grassFlowers',
  label: 'Flower Patch',
  solid: false,
  footprintRadiusMeters: 0.75,
  heightMeters: 0.45,
  tileKind: 'bush',
  trafficControl: 'none',
  coverClass: 'none',
};

const COLORS = {
  stem: recipeColor('#4a8a3a'),
  petal: recipeColor('#c94a6a'),
  petalYellow: recipeColor('#d4a83a'),
} satisfies Record<string, Color>;

export function grassFlowersRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [];
  for (let i = 0; i < 20; i++) {
    const x = (Math.random() - 0.5) * 1.2;
    const z = (Math.random() - 0.5) * 1.2;
    const h = 0.25 + Math.random() * 0.15;
    parts.push({
      id: `stem${i}`,
      shape: 'box',
      position: { x, y: h / 2, z },
      size: { width: 0.02, height: h, depth: 0.02 },
      color: COLORS.stem,
      rotation: { pitch: (Math.random() - 0.5) * 8, yaw: Math.random() * 360, roll: (Math.random() - 0.5) * 8 },
    });
    parts.push({
      id: `flower${i}`,
      shape: 'box',
      position: { x, y: h + 0.03, z },
      size: { width: 0.06, height: 0.06, depth: 0.06 },
      color: i % 2 === 0 ? COLORS.petal : COLORS.petalYellow,
    });
  }
  return { id: 'grassFlowers', parts };
}

export function grassFlowersParts(): PropPartSpec[] {
  return lowerPropRecipe(grassFlowersRecipe());
}
