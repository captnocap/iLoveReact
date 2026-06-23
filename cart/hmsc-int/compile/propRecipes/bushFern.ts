import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const bushFernDef: PropKindDefinition = {
  kind: 'bushFern',
  label: 'Fern Bush',
  solid: false,
  footprintRadiusMeters: 0.3,
  heightMeters: 0.45,
  tileKind: 'bush',
  trafficControl: 'none',
};

const COLORS = {
  leaf: recipeColor('#4a7d3a'),
  leafDark: recipeColor('#375d2b'),
} satisfies Record<string, Color>;

export function bushFernRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'clumpA', shape: 'sphere', position: { x: 0, y: 0.203, z: 0 }, size: { width: 0.420, height: 0.450, depth: 0.420 }, color: COLORS.leaf },
    { id: 'clumpB', shape: 'sphere', position: { x: 0.105, y: 0.158, z: 0.060 }, size: { width: 0.300, height: 0.315, depth: 0.300 }, color: COLORS.leafDark },
    { id: 'clumpC', shape: 'sphere', position: { x: -0.090, y: 0.135, z: -0.075 }, size: { width: 0.270, height: 0.293, depth: 0.270 }, color: COLORS.leafDark },
  ];
  return { id: 'bushFern', parts };
}

export function bushFernParts(): PropPartSpec[] {
  return lowerPropRecipe(bushFernRecipe());
}
