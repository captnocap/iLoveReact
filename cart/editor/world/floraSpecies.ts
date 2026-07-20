import type { FloraLane } from './floraKinds';

/** A model package exported into the flora painter rather than the build bar. */
export type AuthoredFloraSpecies = {
  /** Stable brush identity; world recipes reference this, never a display name. */
  id: string;
  modelId: string;
  pkgId: string;
  label: string;
  lane: FloraLane;
  hex: string;
};

export function authoredFloraIdFor(modelId: string): string {
  return `custom-flora:${modelId}`;
}

export function authoredFloraFor(
  species: readonly AuthoredFloraSpecies[] | null | undefined,
  id: string,
): AuthoredFloraSpecies | null {
  return species?.find((entry) => entry.id === id) ?? null;
}
