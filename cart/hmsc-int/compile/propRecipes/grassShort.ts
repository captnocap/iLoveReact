import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const grassShortDef: PropKindDefinition = {
  kind: 'grassShort',
  label: 'Short Grass',
  solid: false,
  footprintRadiusMeters: 0.8,
  heightMeters: 0.15,
  tileKind: 'bush',
  trafficControl: 'none',
  coverClass: 'none',
};

const COLORS = {
  blade: recipeColor('#4a8a3a'),
  tip: recipeColor('#6aa84f'),
} satisfies Record<string, Color>;

export function grassShortRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [];
  for (let i = 0; i < 24; i++) {
    const x = (Math.random() - 0.5) * 1.4;
    const z = (Math.random() - 0.5) * 1.4;
    const h = 0.08 + Math.random() * 0.07;
    parts.push({
      id: `blade${i}`,
      shape: 'box',
      position: { x, y: h / 2, z },
      size: { width: 0.02, height: h, depth: 0.02 },
      color: i % 3 === 0 ? COLORS.tip : COLORS.blade,
      rotation: { pitch: (Math.random() - 0.5) * 10, yaw: Math.random() * 360, roll: (Math.random() - 0.5) * 10 },
    });
  }
  return { id: 'grassShort', parts };
}

export function grassShortParts(): PropPartSpec[] {
  return lowerPropRecipe(grassShortRecipe());
}
