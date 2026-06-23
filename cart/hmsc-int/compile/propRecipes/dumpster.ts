import { dumpsterBodyMeters } from '../../game/kinds/props';
import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropBoxRecipePart,
  type PropPartSpec,
  type PropRecipe,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const dumpsterDef: PropKindDefinition = {
  kind: 'dumpster',
  label: 'Dumpster',
  solid: true,
  footprintRadiusMeters: 0.9,
  heightMeters: 1.57,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'junk', capacity: 6, spawnFillChance: 0.7, searchSeconds: 4, access: 'open' },
};

const DUMPSTER_COLORS = {
  frameDark: recipeColor('#3a4a30'),
  body: recipeColor('#4a5d3f'),
  lidFront: recipeColor('#556649'),
  lidRear: recipeColor('#45553a'),
  rustyCornerPost: recipeColor('#7a5c3a'),
} satisfies Record<string, Color>;

export function dumpsterRecipe(): PropRecipe {
  // Body box + scale from the registry's ONE definition (req_0623) --
  // host physics and the live model consume the same numbers.
  const { scale: s, widthMeters: w, depthMeters: d } = dumpsterBodyMeters();
  const fullWidth = w;
  const fullDepth = d;
  const frameWidth = w + 0.02 * s;
  const frameDepth = d + 0.02 * s;
  const rimWidth = w + 0.04 * s;
  const rimDepth = d + 0.04 * s;
  const lidWidth = w + 0.02 * s;
  const lidDepth = d * 0.55;
  const parts: PropBoxRecipePart[] = [
    {
      id: 'baseSkid',
      shape: 'box',
      position: { x: 0, y: 0.03 * s, z: 0 },
      size: { width: w * 0.85, height: 0.06 * s, depth: d * 0.8 },
      color: DUMPSTER_COLORS.frameDark,
    },
    {
      id: 'bodyTub',
      shape: 'box',
      position: { x: 0, y: 0.45 * s, z: 0 },
      size: { width: fullWidth, height: 0.78 * s, depth: fullDepth },
      color: DUMPSTER_COLORS.body,
    },
    {
      id: 'topRim',
      shape: 'box',
      position: { x: 0, y: 0.87 * s, z: 0 },
      size: { width: rimWidth, height: 0.06 * s, depth: rimDepth },
      color: DUMPSTER_COLORS.frameDark,
    },
    {
      id: 'frontLid',
      shape: 'box',
      position: { x: 0, y: 0.96 * s, z: d * 0.22 },
      size: { width: lidWidth, height: 0.08 * s, depth: lidDepth },
      color: DUMPSTER_COLORS.lidFront,
      rotation: { pitch: 18, yaw: 0, roll: 0 },
    },
    {
      id: 'rearLid',
      shape: 'box',
      position: { x: 0, y: 0.96 * s, z: -d * 0.22 },
      size: { width: lidWidth, height: 0.08 * s, depth: lidDepth },
      color: DUMPSTER_COLORS.lidRear,
      rotation: { pitch: -18, yaw: 0, roll: 0 },
    },
    {
      id: 'middleRib',
      shape: 'box',
      position: { x: 0, y: 0.62 * s, z: 0 },
      size: { width: frameWidth, height: 0.04 * s, depth: frameDepth },
      color: DUMPSTER_COLORS.frameDark,
    },
    {
      id: 'lowerRib',
      shape: 'box',
      position: { x: 0, y: 0.32 * s, z: 0 },
      size: { width: frameWidth, height: 0.04 * s, depth: frameDepth },
      color: DUMPSTER_COLORS.frameDark,
    },
    {
      id: 'rustyCornerPost',
      shape: 'box',
      position: { x: w * 0.46, y: 0.5 * s, z: d * 0.46 },
      size: { width: 0.06 * s, height: 0.5 * s, depth: 0.06 * s },
      color: DUMPSTER_COLORS.rustyCornerPost,
    },
  ];
  return { id: 'dumpster', parts };
}

export function dumpsterParts(): PropPartSpec[] {
  return lowerPropRecipe(dumpsterRecipe());
}
