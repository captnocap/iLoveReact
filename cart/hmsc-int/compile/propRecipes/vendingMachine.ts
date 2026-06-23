import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const vendingMachineDef: PropKindDefinition = {
  kind: 'vendingMachine',
  label: 'Vending Machine',
  solid: true,
  footprintRadiusMeters: 0.5,
  heightMeters: 2.1,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'kitchen', capacity: 3, spawnFillChance: 0.5, searchSeconds: 3, access: 'locked' },
  coverClass: 'hard',
};

const COLORS = {
  shell: recipeColor('#c2362f'),
  glass: recipeColor('#bcd3dd'),
  trim: recipeColor('#1a1c1e'),
  button: recipeColor('#e8b84a'),
} satisfies Record<string, Color>;

export function vendingMachineRecipe(): PropRecipe {
  const h = 2.1;
  const parts: PropRecipePart[] = [
    {
      id: 'case',
      shape: 'box',
      position: { x: 0, y: h * 0.5, z: 0 },
      size: { width: 0.84, height: h, depth: 0.58 },
      color: COLORS.shell,
    },
    {
      id: 'glass',
      shape: 'box',
      position: { x: 0, y: h * 0.58, z: -0.28 },
      size: { width: 0.64, height: h * 0.55, depth: 0.04 },
      color: COLORS.glass,
    },
    {
      id: 'productRow1',
      shape: 'box',
      position: { x: 0, y: h * 0.75, z: -0.3 },
      size: { width: 0.5, height: 0.04, depth: 0.02 },
      color: COLORS.trim,
    },
    {
      id: 'productRow2',
      shape: 'box',
      position: { x: 0, y: h * 0.6, z: -0.3 },
      size: { width: 0.5, height: 0.04, depth: 0.02 },
      color: COLORS.trim,
    },
    {
      id: 'productRow3',
      shape: 'box',
      position: { x: 0, y: h * 0.45, z: -0.3 },
      size: { width: 0.5, height: 0.04, depth: 0.02 },
      color: COLORS.trim,
    },
    {
      id: 'buttonPanel',
      shape: 'box',
      position: { x: 0.28, y: h * 0.32, z: -0.28 },
      size: { width: 0.16, height: h * 0.15, depth: 0.04 },
      color: COLORS.trim,
    },
    {
      id: 'button',
      shape: 'box',
      position: { x: 0.28, y: h * 0.35, z: -0.3 },
      size: { width: 0.06, height: 0.06, depth: 0.02 },
      color: COLORS.button,
    },
    {
      id: 'dispense',
      shape: 'box',
      position: { x: -0.15, y: h * 0.18, z: -0.3 },
      size: { width: 0.3, height: 0.1, depth: 0.04 },
      color: COLORS.trim,
    },
  ];
  return { id: 'vendingMachine', parts };
}

export function vendingMachineParts(): PropPartSpec[] {
  return lowerPropRecipe(vendingMachineRecipe());
}
