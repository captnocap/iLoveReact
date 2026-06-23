import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const chainLinkFenceSectionDef: PropKindDefinition = {
  kind: 'chainLinkFenceSection',
  label: 'Chain Link Fence Section',
  solid: true,
  footprintRadiusMeters: 0.6,
  heightMeters: 1.2,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'hard',
};

const COLORS = {
  main: recipeColor('#9aa1ab'),
  rust: recipeColor('#5c6066'),
  dark: recipeColor('#3d4044'),
} satisfies Record<string, Color>;

export function chainLinkFenceSectionRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'chunkA', shape: 'box', position: { x: -0.120, y: 0.420, z: 0.060 }, size: { width: 0.720, height: 0.600, depth: 0.540 }, color: COLORS.main, rotation: { pitch: 8, yaw: 12, roll: 0 } },
    { id: 'chunkB', shape: 'box', position: { x: 0.150, y: 0.660, z: -0.090 }, size: { width: 0.540, height: 0.480, depth: 0.660 }, color: COLORS.rust, rotation: { pitch: -5, yaw: -10, roll: 4 } },
    { id: 'chunkC', shape: 'box', position: { x: 0, y: 0.180, z: 0 }, size: { width: 0.840, height: 0.300, depth: 0.780 }, color: COLORS.dark },
  ];
  return { id: 'chainLinkFenceSection', parts };
}

export function chainLinkFenceSectionParts(): PropPartSpec[] {
  return lowerPropRecipe(chainLinkFenceSectionRecipe());
}
