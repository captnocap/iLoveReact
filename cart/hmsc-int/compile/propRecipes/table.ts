import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const tableDef: PropKindDefinition = {
  kind: 'table',
  label: 'Table',
  solid: true,
  footprintRadiusMeters: 0.6,
  heightMeters: 0.78,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'soft',
};

const COLORS = {
  wood: recipeColor('#8a6240'),
  woodDark: recipeColor('#6b4a2e'),
} satisfies Record<string, Color>;

export function tableRecipe(heightMeters: number, footprintRadiusMeters: number): PropRecipe {
  const half = footprintRadiusMeters - 0.08;
  const topY = heightMeters - 0.04;
  const parts: PropRecipePart[] = [
    {
      id: 'frontRightLeg',
      shape: 'box',
      position: { x: half, y: topY / 2, z: half },
      size: { width: 0.07, height: topY, depth: 0.07 },
      color: COLORS.woodDark,
    },
    {
      id: 'frontLeftLeg',
      shape: 'box',
      position: { x: -half, y: topY / 2, z: half },
      size: { width: 0.07, height: topY, depth: 0.07 },
      color: COLORS.woodDark,
    },
    {
      id: 'rearRightLeg',
      shape: 'box',
      position: { x: half, y: topY / 2, z: -half },
      size: { width: 0.07, height: topY, depth: 0.07 },
      color: COLORS.woodDark,
    },
    {
      id: 'rearLeftLeg',
      shape: 'box',
      position: { x: -half, y: topY / 2, z: -half },
      size: { width: 0.07, height: topY, depth: 0.07 },
      color: COLORS.woodDark,
    },
    {
      id: 'top',
      shape: 'box',
      position: { x: 0, y: topY + 0.02, z: 0 },
      size: { width: footprintRadiusMeters * 2, height: 0.06, depth: footprintRadiusMeters * 2 },
      color: COLORS.wood,
    },
  ];
  return { id: 'table', parts };
}

export function tableParts(heightMeters: number, footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(tableRecipe(heightMeters, footprintRadiusMeters));
}
