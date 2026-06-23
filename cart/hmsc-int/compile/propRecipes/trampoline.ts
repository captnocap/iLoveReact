import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const trampolineDef: PropKindDefinition = {
  kind: 'trampoline',
  label: 'Trampoline',
  solid: true,
  footprintRadiusMeters: 1.2,
  heightMeters: 0.7,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'soft',
};

const COLORS = {
  frame: recipeColor('#22262b'),
  leg: recipeColor('#9aa1ab'),
  mat: recipeColor('#3a7d80'),
  spring: recipeColor('#6c727b'),
} satisfies Record<string, Color>;

export function trampolineRecipe(): PropRecipe {
  const r = 1.2;
  const h = 0.7;
  const parts: PropRecipePart[] = [];
  // legs at four corners
  for (const [lx, lz] of [[-r * 0.6, -r * 0.6], [r * 0.6, -r * 0.6], [-r * 0.6, r * 0.6], [r * 0.6, r * 0.6]] as const) {
    parts.push({ id: `leg${parts.length}`, shape: 'cylinder8', position: { x: lx, y: h / 2, z: lz }, radius: 0.04, height: h, color: COLORS.leg });
  }
  // frame ring
  const ringSegments = 12;
  for (let i = 0; i < ringSegments; i++) {
    const angle = (i / ringSegments) * Math.PI * 2;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const yaw = (angle * 180) / Math.PI + 90;
    parts.push({
      id: `frame${i}`,
      shape: 'cylinder8',
      position: { x, y: h, z },
      radius: 0.04,
      height: (Math.PI * 2 * r) / ringSegments,
      color: COLORS.frame,
      rotation: { pitch: 90, yaw, roll: 0 },
    });
  }
  // mat
  parts.push({ id: 'mat', shape: 'cylinder8', position: { x: 0, y: h - 0.03, z: 0 }, radius: r * 0.85, height: 0.04, color: COLORS.mat });
  // springs between frame and mat
  const springCount = 8;
  for (let i = 0; i < springCount; i++) {
    const angle = (i / springCount) * Math.PI * 2;
    const xInner = Math.cos(angle) * r * 0.88;
    const zInner = Math.sin(angle) * r * 0.88;
    const xOuter = Math.cos(angle) * r * 0.96;
    const zOuter = Math.sin(angle) * r * 0.96;
    const midX = (xInner + xOuter) / 2;
    const midZ = (zInner + zOuter) / 2;
    const yaw = (angle * 180) / Math.PI;
    parts.push({
      id: `spring${i}`,
      shape: 'cylinder8',
      position: { x: midX, y: h - 0.02, z: midZ },
      radius: 0.012,
      height: r * 0.08,
      color: COLORS.spring,
      rotation: { pitch: 90, yaw, roll: 0 },
    });
  }
  return { id: 'trampoline', parts };
}

export function trampolineParts(): PropPartSpec[] {
  return lowerPropRecipe(trampolineRecipe());
}
