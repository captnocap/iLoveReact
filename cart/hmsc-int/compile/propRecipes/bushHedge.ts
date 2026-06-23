import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const bushHedgeDef: PropKindDefinition = {
  kind: 'bushHedge',
  label: 'Hedge Bush',
  solid: false,
  footprintRadiusMeters: 0.5,
  heightMeters: 0.8,
  tileKind: 'bush',
  trafficControl: 'none',
};

const COLORS = {
  leaf: recipeColor('#3a5a2a'),
  leafDark: recipeColor('#2b431f'),
} satisfies Record<string, Color>;

export function bushHedgeRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'clumpA', shape: 'sphere', position: { x: 0, y: 0.360, z: 0 }, size: { width: 0.700, height: 0.800, depth: 0.700 }, color: COLORS.leaf },
    { id: 'clumpB', shape: 'sphere', position: { x: 0.175, y: 0.280, z: 0.100 }, size: { width: 0.500, height: 0.560, depth: 0.500 }, color: COLORS.leafDark },
    { id: 'clumpC', shape: 'sphere', position: { x: -0.150, y: 0.240, z: -0.125 }, size: { width: 0.450, height: 0.520, depth: 0.450 }, color: COLORS.leafDark },
  ];
  return { id: 'bushHedge', parts };
}

export function bushHedgeParts(): PropPartSpec[] {
  return lowerPropRecipe(bushHedgeRecipe());
}
