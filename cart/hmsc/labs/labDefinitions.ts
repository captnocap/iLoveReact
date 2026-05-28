import type { Vec3 } from '../design';

export type HmscLabName = 'scale' | 'textures' | 'aim';

export type HmscLabDefinition = {
  name: HmscLabName;
  label: string;
  sceneStep: string;
  spawnPosition: Vec3;
  spawnYawDegrees: number;
  exitPosition: Vec3;
  exitYawDegrees: number;
};

export const HMSC_LAB_DEFINITIONS: Record<HmscLabName, HmscLabDefinition> = {
  scale: {
    name: 'scale',
    label: 'Scale and player rig lab',
    sceneStep: 'lab.scale',
    spawnPosition: { x: 0.5, y: 0, z: 0.5 },
    spawnYawDegrees: 180,
    exitPosition: { x: -425.5, y: 0, z: -242.5 },
    exitYawDegrees: 180,
  },
  textures: {
    name: 'textures',
    label: 'Tile texture material lab',
    sceneStep: 'lab.textures',
    spawnPosition: { x: 0.5, y: 0, z: 0.5 },
    spawnYawDegrees: 180,
    exitPosition: { x: 69.5, y: 0, z: 78.5 },
    exitYawDegrees: 180,
  },
  aim: {
    name: 'aim',
    label: 'Aim and target lab',
    sceneStep: 'lab.aim',
    spawnPosition: { x: 0, y: 0, z: 0 },
    spawnYawDegrees: 180,
    exitPosition: { x: 394.5, y: 0, z: -327.5 },
    exitYawDegrees: 180,
  },
};

export function isHmscLabName(value: string): value is HmscLabName {
  return Object.prototype.hasOwnProperty.call(HMSC_LAB_DEFINITIONS, value);
}

export function hmscLabNamesForConsole(): string {
  return Object.keys(HMSC_LAB_DEFINITIONS).join(', ');
}

export function hmscLabForSceneStep(sceneStep: string): HmscLabDefinition | null {
  return Object.values(HMSC_LAB_DEFINITIONS).find((lab) => lab.sceneStep === sceneStep) ?? null;
}
