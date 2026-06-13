import {
  lowerPropRecipe,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const trafficLightDef: PropKindDefinition = {
  kind: 'trafficLight',
  label: 'Traffic Light',
  solid: true,
  footprintRadiusMeters: 0.18,
  footprintDepthMeters: 0.46,
  // PROPSCALE-0611: real mast-arm head top ~5.5m × 1.15
  heightMeters: 6.3,
  tileKind: 'wall',
  trafficControl: 'signal',
};

const COLORS = {
  base: [0.14, 0.15, 0.17],
  pole: [0.2, 0.22, 0.24],
  head: [0.1, 0.11, 0.12],
  redLamp: [1, 0.23, 0.19],
  yellowLamp: [1, 0.82, 0.23],
  greenLamp: [0.21, 0.84, 0.36],
} satisfies Record<string, Color>;

export function trafficLightRecipe(heightMeters: number): PropRecipe {
  // TRAFFIC-HEAD-0610: the arm cantilevers sideways (+X) and the head faces -Z
  // at yaw 0, matching the lane gate direction in world/traffic.ts.
  const poleHeight = heightMeters - 0.34;
  const headX = 1.4;
  const parts: PropRecipePart[] = [
    {
      id: 'base',
      shape: 'cylinder16',
      position: { x: 0, y: 0.17, z: 0 },
      radius: 0.24,
      height: 0.34,
      color: COLORS.base,
    },
    {
      id: 'pole',
      shape: 'cylinder16',
      position: { x: 0, y: poleHeight / 2 + 0.34, z: 0 },
      radius: 0.1,
      height: poleHeight,
      color: COLORS.pole,
    },
    {
      id: 'sideArm',
      shape: 'cylinder8',
      position: { x: 0.7, y: heightMeters - 0.25, z: 0 },
      radius: 0.06,
      height: 1.4,
      color: COLORS.pole,
      rotation: { pitch: 0, yaw: 0, roll: 90 },
    },
    {
      id: 'signalHead',
      shape: 'box',
      position: { x: headX, y: heightMeters - 0.85, z: 0 },
      size: { width: 0.36, height: 1.12, depth: 0.3 },
      color: COLORS.head,
    },
    {
      id: 'redLamp',
      shape: 'cylinder16',
      position: { x: headX, y: heightMeters - 0.5, z: -0.17 },
      radius: 0.13,
      height: 0.07,
      color: COLORS.redLamp,
      rotation: { pitch: 90, yaw: 0, roll: 0 },
    },
    {
      id: 'yellowLamp',
      shape: 'cylinder16',
      position: { x: headX, y: heightMeters - 0.85, z: -0.17 },
      radius: 0.13,
      height: 0.07,
      color: COLORS.yellowLamp,
      rotation: { pitch: 90, yaw: 0, roll: 0 },
    },
    {
      id: 'greenLamp',
      shape: 'cylinder16',
      position: { x: headX, y: heightMeters - 1.2, z: -0.17 },
      radius: 0.13,
      height: 0.07,
      color: COLORS.greenLamp,
      rotation: { pitch: 90, yaw: 0, roll: 0 },
    },
  ];
  return { id: 'trafficLight', parts };
}

export function trafficLightParts(heightMeters: number): PropPartSpec[] {
  return lowerPropRecipe(trafficLightRecipe(heightMeters));
}
