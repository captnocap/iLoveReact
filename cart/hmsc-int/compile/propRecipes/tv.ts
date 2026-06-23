import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const tvDef: PropKindDefinition = {
  kind: 'tv',
  label: 'Television',
  solid: true,
  footprintRadiusMeters: 0.5,
  footprintDepthMeters: 0.35,
  heightMeters: 0.75,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

const COLORS = {
  shell: recipeColor('#1a1c1e'),
  screen: recipeColor('#2c4a66'),
  stand: recipeColor('#4a4a4a'),
} satisfies Record<string, Color>;

export function tvRecipe(): PropRecipe {
  const w = 1.0;
  const h = 0.62;
  const d = 0.08;
  const parts: PropRecipePart[] = [
    { id: 'screen', shape: 'box', position: { x: 0, y: 0.5, z: -d * 0.55 }, size: { width: w * 0.92, height: h * 0.88, depth: 0.01 }, color: COLORS.screen },
    { id: 'bezel', shape: 'box', position: { x: 0, y: 0.5, z: -d / 2 }, size: { width: w, height: h, depth: d }, color: COLORS.shell },
    { id: 'standNeck', shape: 'box', position: { x: 0, y: 0.12, z: 0.02 }, size: { width: 0.14, height: 0.16, depth: 0.1 }, color: COLORS.stand },
    { id: 'standFoot', shape: 'box', position: { x: 0, y: 0.04, z: 0.02 }, size: { width: 0.45, height: 0.04, depth: 0.28 }, color: COLORS.stand },
  ];
  return { id: 'tv', parts };
}

export function tvParts(): PropPartSpec[] {
  return lowerPropRecipe(tvRecipe());
}
