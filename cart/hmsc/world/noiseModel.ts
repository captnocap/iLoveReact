import type { TileKind } from '../design';

export type SurfaceNoiseMaterial =
  | 'carpet'
  | 'grass'
  | 'dirt'
  | 'concrete'
  | 'woodFloor'
  | 'gravel'
  | 'metalGrate'
  | 'brokenGlassTrash'
  | 'waterShallow';

export type SurfaceNoiseProfile = {
  material: SurfaceNoiseMaterial;
  label: string;
  multiplier: number;
};

export const SURFACE_NOISE_PROFILES: Record<SurfaceNoiseMaterial, SurfaceNoiseProfile> = {
  carpet: { material: 'carpet', label: 'Carpet', multiplier: 0.35 },
  grass: { material: 'grass', label: 'Grass', multiplier: 0.55 },
  dirt: { material: 'dirt', label: 'Dirt', multiplier: 0.7 },
  concrete: { material: 'concrete', label: 'Concrete', multiplier: 1 },
  woodFloor: { material: 'woodFloor', label: 'Wood floor', multiplier: 1.25 },
  gravel: { material: 'gravel', label: 'Gravel', multiplier: 1.6 },
  metalGrate: { material: 'metalGrate', label: 'Metal grate', multiplier: 1.8 },
  brokenGlassTrash: { material: 'brokenGlassTrash', label: 'Broken glass/trash', multiplier: 2.2 },
  waterShallow: { material: 'waterShallow', label: 'Water shallow', multiplier: 2.5 },
};

export type ContinuousMovementNoiseMode = {
  mode: 'creepWalk' | 'jog' | 'sprint';
  label: string;
  kind: 'continuous';
  multiplierMin: number;
  multiplierMax: number;
};

export type BurstMovementNoiseMode = {
  mode: 'jumpLand' | 'mantleClimb';
  label: string;
  kind: 'burst' | 'shortBurst';
  materialDependent: true;
};

export type MovementNoiseMode = ContinuousMovementNoiseMode | BurstMovementNoiseMode;

export const MOVEMENT_NOISE_MODES: Record<MovementNoiseMode['mode'], MovementNoiseMode> = {
  creepWalk: {
    mode: 'creepWalk',
    label: 'Creep/walk',
    kind: 'continuous',
    multiplierMin: 0.25,
    multiplierMax: 0.4,
  },
  jog: {
    mode: 'jog',
    label: 'Jog',
    kind: 'continuous',
    multiplierMin: 1,
    multiplierMax: 1,
  },
  sprint: {
    mode: 'sprint',
    label: 'Sprint',
    kind: 'continuous',
    multiplierMin: 2.25,
    multiplierMax: 3,
  },
  jumpLand: {
    mode: 'jumpLand',
    label: 'Jump/land',
    kind: 'burst',
    materialDependent: true,
  },
  mantleClimb: {
    mode: 'mantleClimb',
    label: 'Mantle/climb',
    kind: 'shortBurst',
    materialDependent: true,
  },
};

export const TILE_KIND_NOISE_MATERIALS: Record<TileKind, SurfaceNoiseMaterial> = {
  water: 'waterShallow',
  road: 'concrete',
  asphalt: 'concrete',
  sidewalk: 'concrete',
  mud: 'dirt',
  sand: 'dirt',
  wall: 'concrete',
  door: 'woodFloor',
  bush: 'dirt',
  marker: 'concrete',
  spawn: 'concrete',
  save: 'concrete',
  laneNorth: 'concrete',
  laneSouth: 'concrete',
  laneEast: 'concrete',
  laneWest: 'concrete',
  junction: 'concrete',
};

export type ContinuousNoiseRange = {
  min: number;
  max: number;
};

export function surfaceNoiseMultiplier(material: SurfaceNoiseMaterial): number {
  return SURFACE_NOISE_PROFILES[material].multiplier;
}

export function tileKindNoiseMultiplier(kind: TileKind): number {
  return surfaceNoiseMultiplier(TILE_KIND_NOISE_MATERIALS[kind]);
}

export function continuousMovementNoiseRange(
  material: SurfaceNoiseMaterial,
  movementMode: MovementNoiseMode['mode'],
): ContinuousNoiseRange | null {
  const movement = MOVEMENT_NOISE_MODES[movementMode];
  if (movement.kind !== 'continuous') return null;
  const materialMultiplier = surfaceNoiseMultiplier(material);
  return {
    min: movement.multiplierMin * materialMultiplier,
    max: movement.multiplierMax * materialMultiplier,
  };
}

export function surfaceNoiseProfilesForConsole(): string[] {
  return Object.values(SURFACE_NOISE_PROFILES).map((profile) => `${profile.label.padEnd(20)} x${profile.multiplier.toFixed(2)}`);
}

export function movementNoiseModesForConsole(): string[] {
  return Object.values(MOVEMENT_NOISE_MODES).map((mode) => {
    if (mode.kind === 'continuous') {
      const range = mode.multiplierMin === mode.multiplierMax
        ? `x${mode.multiplierMin.toFixed(2)}`
        : `x${mode.multiplierMin.toFixed(2)}-x${mode.multiplierMax.toFixed(2)}`;
      return `${mode.label.padEnd(16)} continuous ${range}`;
    }
    return `${mode.label.padEnd(16)} ${mode.kind}, material-dependent`;
  });
}
