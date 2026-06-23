import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const bathtubDef: PropKindDefinition = {
  kind: 'bathtub',
  label: 'Bathtub',
  solid: true,
  footprintRadiusMeters: 0.95,
  footprintDepthMeters: 0.75,
  heightMeters: 0.6,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'lay', seatHeightMeters: 0.25, capacity: 1 },
  coverClass: 'soft',
};

const COLORS = {
  porcelain: recipeColor('#eef0f2'),
  faucet: recipeColor('#9aa1ab'),
} satisfies Record<string, Color>;

export function bathtubRecipe(): PropRecipe {
  const w = 1.9;
  const d = 0.75;
  const h = 0.6;
  const parts: PropRecipePart[] = [
    { id: 'tub', shape: 'box', position: { x: 0, y: h / 2, z: 0 }, size: { width: w, height: h, depth: d }, color: COLORS.porcelain },
    { id: 'interior', shape: 'box', position: { x: 0, y: h * 0.55, z: 0 }, size: { width: w * 0.82, height: h * 0.55, depth: d * 0.72 }, color: COLORS.porcelain },
    { id: 'rim', shape: 'box', position: { x: 0, y: h, z: 0 }, size: { width: w, height: 0.04, depth: d }, color: COLORS.porcelain },
    { id: 'faucet', shape: 'box', position: { x: -w * 0.42, y: h * 0.75, z: 0 }, size: { width: 0.04, height: 0.18, depth: 0.04 }, color: COLORS.faucet },
    { id: 'spout', shape: 'box', position: { x: -w * 0.38, y: h * 0.78, z: 0 }, size: { width: 0.1, height: 0.04, depth: 0.04 }, color: COLORS.faucet },
  ];
  return { id: 'bathtub', parts };
}

export function bathtubParts(): PropPartSpec[] {
  return lowerPropRecipe(bathtubRecipe());
}
