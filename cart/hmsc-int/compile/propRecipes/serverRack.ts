import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const serverRackDef: PropKindDefinition = {
  kind: 'serverRack',
  label: 'Server Rack',
  solid: true,
  footprintRadiusMeters: 0.45,
  footprintDepthMeters: 0.8,
  heightMeters: 2.0,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'office', capacity: 4, spawnFillChance: 0.5, searchSeconds: 3, access: 'locked' },
  coverClass: 'hard',
};

const COLORS = {
  body: recipeColor('#2a2d33'),
  vent: recipeColor('#1a1c1e'),
  led: recipeColor('#3a7d80'),
} satisfies Record<string, Color>;

export function serverRackRecipe(): PropRecipe {
  const w = 0.9;
  const d = 0.8;
  const h = 2.0;
  const parts: PropRecipePart[] = [
    { id: 'frame', shape: 'box', position: { x: 0, y: h / 2, z: 0 }, size: { width: w, height: h, depth: d }, color: COLORS.body },
    { id: 'frontDoor', shape: 'box', position: { x: 0, y: h / 2, z: -d / 2 + 0.01 }, size: { width: w * 0.9, height: h * 0.92, depth: 0.02 }, color: COLORS.vent },
    { id: 'vent1', shape: 'box', position: { x: 0, y: h * 0.75, z: -d / 2 - 0.005 }, size: { width: w * 0.8, height: 0.04, depth: 0.01 }, color: COLORS.led },
    { id: 'vent2', shape: 'box', position: { x: 0, y: h * 0.55, z: -d / 2 - 0.005 }, size: { width: w * 0.8, height: 0.04, depth: 0.01 }, color: COLORS.led },
    { id: 'vent3', shape: 'box', position: { x: 0, y: h * 0.35, z: -d / 2 - 0.005 }, size: { width: w * 0.8, height: 0.04, depth: 0.01 }, color: COLORS.led },
  ];
  return { id: 'serverRack', parts };
}

export function serverRackParts(): PropPartSpec[] {
  return lowerPropRecipe(serverRackRecipe());
}
