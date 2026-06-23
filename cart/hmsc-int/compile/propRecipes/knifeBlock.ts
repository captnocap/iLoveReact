import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const knifeBlockDef: PropKindDefinition = {
  kind: 'knifeBlock',
  label: 'Knife Block',
  solid: true,
  footprintRadiusMeters: 0.1,
  heightMeters: 0.22,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

const COLORS = {
  body: recipeColor('#6b4a2e'),
  accent: recipeColor('#503722'),
  detail: recipeColor('#805837'),
} satisfies Record<string, Color>;

export function knifeBlockRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.099, z: 0 }, size: { width: 0.140, height: 0.154, depth: 0.100 }, color: COLORS.body },
    { id: 'accent', shape: 'box', position: { x: 0, y: 0.176, z: 0 }, size: { width: 0.100, height: 0.033, depth: 0.080 }, color: COLORS.accent },
    { id: 'detail', shape: 'cylinder8', position: { x: 0.050, y: 0.110, z: 0 }, radius: 0.012, height: 0.088, color: COLORS.detail },
  ];
  return { id: 'knifeBlock', parts };
}

export function knifeBlockParts(): PropPartSpec[] {
  return lowerPropRecipe(knifeBlockRecipe());
}
