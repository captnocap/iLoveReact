import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const vaseDef: PropKindDefinition = {
  kind: 'vase',
  label: 'Vase',
  solid: true,
  footprintRadiusMeters: 0.2,
  heightMeters: 0.45,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

const COLORS = {
  body: recipeColor('#8a4a32'),
  stem: recipeColor('#6b4a2e'),
  flower: recipeColor('#7d3b4a'),
} satisfies Record<string, Color>;

export function vaseRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.06, z: 0 }, size: { width: 0.18, height: 0.12, depth: 0.18 }, color: COLORS.body },
    { id: 'neck', shape: 'box', position: { x: 0, y: 0.22, z: 0 }, size: { width: 0.1, height: 0.12, depth: 0.1 }, color: COLORS.body },
    { id: 'rim', shape: 'box', position: { x: 0, y: 0.3, z: 0 }, size: { width: 0.16, height: 0.04, depth: 0.16 }, color: COLORS.body },
    { id: 'stem1', shape: 'box', position: { x: 0.02, y: 0.42, z: 0 }, size: { width: 0.02, height: 0.24, depth: 0.02 }, color: COLORS.stem, rotation: { pitch: 0, yaw: 0, roll: 8 } },
    { id: 'stem2', shape: 'box', position: { x: -0.02, y: 0.44, z: 0.02 }, size: { width: 0.02, height: 0.24, depth: 0.02 }, color: COLORS.stem, rotation: { pitch: 5, yaw: 0, roll: -6 } },
    { id: 'flower', shape: 'box', position: { x: 0.04, y: 0.55, z: 0 }, size: { width: 0.1, height: 0.06, depth: 0.06 }, color: COLORS.flower },
  ];
  return { id: 'vase', parts };
}

export function vaseParts(): PropPartSpec[] {
  return lowerPropRecipe(vaseRecipe());
}
