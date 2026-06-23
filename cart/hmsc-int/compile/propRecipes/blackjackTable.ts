import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const blackjackTableDef: PropKindDefinition = {
  kind: 'blackjackTable',
  label: 'Blackjack Table',
  solid: true,
  footprintRadiusMeters: 0.85,
  heightMeters: 0.82,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  top: recipeColor('#6b4a2e'),
  leg: recipeColor('#45301d'),
} satisfies Record<string, Color>;

export function blackjackTableRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'top', shape: 'box', position: { x: 0, y: 0.800, z: 0 }, size: { width: 1.530, height: 0.04, depth: 1.020 }, color: COLORS.top },
    { id: 'legFL', shape: 'box', position: { x: -0.735, y: 0.410, z: 0.480 }, size: { width: 0.04, height: 0.820, depth: 0.04 }, color: COLORS.leg },
    { id: 'legFR', shape: 'box', position: { x: 0.735, y: 0.410, z: 0.480 }, size: { width: 0.04, height: 0.820, depth: 0.04 }, color: COLORS.leg },
    { id: 'legBL', shape: 'box', position: { x: -0.735, y: 0.410, z: -0.480 }, size: { width: 0.04, height: 0.820, depth: 0.04 }, color: COLORS.leg },
    { id: 'legBR', shape: 'box', position: { x: 0.735, y: 0.410, z: -0.480 }, size: { width: 0.04, height: 0.820, depth: 0.04 }, color: COLORS.leg },
  ];
  return { id: 'blackjackTable', parts };
}

export function blackjackTableParts(): PropPartSpec[] {
  return lowerPropRecipe(blackjackTableRecipe());
}
