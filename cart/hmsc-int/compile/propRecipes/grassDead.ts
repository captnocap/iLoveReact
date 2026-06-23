import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const grassDeadDef: PropKindDefinition = {
  kind: 'grassDead',
  label: 'Dead Grass',
  solid: false,
  footprintRadiusMeters: 0.9,
  heightMeters: 0.35,
  tileKind: 'bush',
  trafficControl: 'none',
  coverClass: 'none',
};

const COLORS = {
  straw: recipeColor('#a89a6a'),
  brown: recipeColor('#8a7a52'),
} satisfies Record<string, Color>;

export function grassDeadRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [];
  for (let i = 0; i < 28; i++) {
    const x = (Math.random() - 0.5) * 1.5;
    const z = (Math.random() - 0.5) * 1.5;
    const h = 0.2 + Math.random() * 0.15;
    parts.push({
      id: `tuft${i}`,
      shape: 'box',
      position: { x, y: h / 2, z },
      size: { width: 0.03, height: h, depth: 0.03 },
      color: i % 4 === 0 ? COLORS.brown : COLORS.straw,
      rotation: { pitch: (Math.random() - 0.5) * 15, yaw: Math.random() * 360, roll: (Math.random() - 0.5) * 15 },
    });
  }
  return { id: 'grassDead', parts };
}

export function grassDeadParts(): PropPartSpec[] {
  return lowerPropRecipe(grassDeadRecipe());
}
