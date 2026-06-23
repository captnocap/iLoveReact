import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const grassReedsDef: PropKindDefinition = {
  kind: 'grassReeds',
  label: 'Tall Reeds',
  solid: false,
  footprintRadiusMeters: 0.85,
  heightMeters: 1.4,
  tileKind: 'bush',
  trafficControl: 'none',
  coverClass: 'soft',
};

const COLORS = {
  stalk: recipeColor('#7a9a5a'),
  head: recipeColor('#b8a86a'),
} satisfies Record<string, Color>;

export function grassReedsRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [];
  for (let i = 0; i < 18; i++) {
    const x = (Math.random() - 0.5) * 1.3;
    const z = (Math.random() - 0.5) * 1.3;
    const h = 0.9 + Math.random() * 0.4;
    parts.push({
      id: `reed${i}`,
      shape: 'box',
      position: { x, y: h / 2, z },
      size: { width: 0.025, height: h, depth: 0.025 },
      color: COLORS.stalk,
      rotation: { pitch: (Math.random() - 0.5) * 8, yaw: Math.random() * 360, roll: (Math.random() - 0.5) * 8 },
    });
    parts.push({
      id: `head${i}`,
      shape: 'box',
      position: { x, y: h + 0.04, z },
      size: { width: 0.04, height: 0.1, depth: 0.04 },
      color: COLORS.head,
      rotation: { pitch: 0, yaw: Math.random() * 360, roll: 0 },
    });
  }
  return { id: 'grassReeds', parts };
}

export function grassReedsParts(): PropPartSpec[] {
  return lowerPropRecipe(grassReedsRecipe());
}
