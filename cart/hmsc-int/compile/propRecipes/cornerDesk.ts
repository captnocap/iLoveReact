import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const cornerDeskDef: PropKindDefinition = {
  kind: 'cornerDesk',
  label: 'Corner Desk',
  solid: true,
  footprintRadiusMeters: 0.75,
  heightMeters: 0.78,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  top: recipeColor('#8a6240'),
  leg: recipeColor('#6b4a2e'),
} satisfies Record<string, Color>;

export function cornerDeskRecipe(): PropRecipe {
  const h = 0.78;
  const parts: PropRecipePart[] = [
    {
      id: 'topLeft',
      shape: 'box',
      position: { x: -0.6, y: h - 0.02, z: 0 },
      size: { width: 1.0, height: 0.04, depth: 0.6 },
      color: COLORS.top,
    },
    {
      id: 'topRight',
      shape: 'box',
      position: { x: 0, y: h - 0.02, z: -0.6 },
      size: { width: 0.6, height: 0.04, depth: 1.0 },
      color: COLORS.top,
    },
    {
      id: 'corner',
      shape: 'box',
      position: { x: -0.25, y: h - 0.02, z: -0.25 },
      size: { width: 0.55, height: 0.04, depth: 0.55 },
      color: COLORS.top,
    },
    {
      id: 'leg1',
      shape: 'box',
      position: { x: -0.95, y: h * 0.5, z: 0.25 },
      size: { width: 0.06, height: h, depth: 0.06 },
      color: COLORS.leg,
    },
    {
      id: 'leg2',
      shape: 'box',
      position: { x: 0.25, y: h * 0.5, z: -0.95 },
      size: { width: 0.06, height: h, depth: 0.06 },
      color: COLORS.leg,
    },
    {
      id: 'leg3',
      shape: 'box',
      position: { x: -0.25, y: h * 0.5, z: -0.25 },
      size: { width: 0.06, height: h, depth: 0.06 },
      color: COLORS.leg,
    },
  ];
  return { id: 'cornerDesk', parts };
}

export function cornerDeskParts(): PropPartSpec[] {
  return lowerPropRecipe(cornerDeskRecipe());
}
