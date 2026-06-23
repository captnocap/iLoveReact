import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const grassMossDef: PropKindDefinition = {
  kind: 'grassMoss',
  label: 'Moss Patch',
  solid: false,
  footprintRadiusMeters: 0.7,
  heightMeters: 0.12,
  tileKind: 'bush',
  trafficControl: 'none',
  coverClass: 'none',
};

const COLORS = {
  moss: recipeColor('#4a7a42'),
  light: recipeColor('#5a9a52'),
} satisfies Record<string, Color>;

export function grassMossRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [];
  for (let i = 0; i < 16; i++) {
    const x = (Math.random() - 0.5) * 1.0;
    const z = (Math.random() - 0.5) * 1.0;
    const r = 0.06 + Math.random() * 0.04;
    parts.push({
      id: `clump${i}`,
      shape: 'box',
      position: { x, y: 0.04, z },
      size: { width: r * 2, height: 0.08, depth: r * 2 },
      color: i % 3 === 0 ? COLORS.light : COLORS.moss,
      rotation: { pitch: 0, yaw: Math.random() * 360, roll: 0 },
    });
  }
  return { id: 'grassMoss', parts };
}

export function grassMossParts(): PropPartSpec[] {
  return lowerPropRecipe(grassMossRecipe());
}
