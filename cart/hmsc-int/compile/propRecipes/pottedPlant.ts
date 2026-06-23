import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const pottedPlantDef: PropKindDefinition = {
  kind: 'pottedPlant',
  label: 'Potted Plant',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 0.95,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'soft',
};

const COLORS = {
  pot: recipeColor('#8a4a32'),
  soil: recipeColor('#3d3225'),
  stem: recipeColor('#6b4a2e'),
  leaf: recipeColor('#3f7d33'),
} satisfies Record<string, Color>;

export function pottedPlantRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'pot', shape: 'cylinder8', position: { x: 0, y: 0.2, z: 0 }, radius: 0.28, height: 0.35, color: COLORS.pot },
    { id: 'soil', shape: 'cylinder8', position: { x: 0, y: 0.36, z: 0 }, radius: 0.24, height: 0.04, color: COLORS.soil },
    { id: 'stem', shape: 'box', position: { x: 0, y: 0.6, z: 0 }, size: { width: 0.06, height: 0.55, depth: 0.06 }, color: COLORS.stem },
    { id: 'leaf1', shape: 'box', position: { x: 0.18, y: 0.75, z: 0 }, size: { width: 0.35, height: 0.08, depth: 0.16 }, color: COLORS.leaf, rotation: { pitch: 0, yaw: 0, roll: 35 } },
    { id: 'leaf2', shape: 'box', position: { x: -0.18, y: 0.82, z: 0.1 }, size: { width: 0.32, height: 0.08, depth: 0.16 }, color: COLORS.leaf, rotation: { pitch: 0, yaw: 0, roll: -30 } },
    { id: 'leaf3', shape: 'box', position: { x: 0, y: 0.88, z: -0.2 }, size: { width: 0.16, height: 0.08, depth: 0.35 }, color: COLORS.leaf, rotation: { pitch: 35, yaw: 0, roll: 0 } },
  ];
  return { id: 'pottedPlant', parts };
}

export function pottedPlantParts(): PropPartSpec[] {
  return lowerPropRecipe(pottedPlantRecipe());
}
