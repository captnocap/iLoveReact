import { useEffect, useState } from 'react';

// What's playing on each drive-in screen, keyed by building id. A tiny reactive
// singleton (no game-state coupling): the projector-booth interaction
// (state/useBuildingInteract) writes a picked movie path here, and the screen
// capture host (render3d/driveInScreen) reads it to feed the <Video> whose
// frames it captures to the screen's live texture. Transient by design — a
// picked movie is a session thing, not part of the saved .tsx world.
//
// src === null  → no movie picked yet (the screen shows its NO SIGNAL card).

const sources = new Map<string, string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function getDriveInSource(buildingId: string): string | null {
  return sources.get(buildingId) ?? null;
}

export function setDriveInSource(buildingId: string, src: string | null): void {
  if (src) sources.set(buildingId, src);
  else sources.delete(buildingId);
  emit();
}

export function subscribeDriveInSources(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// Re-render hook for screen consumers: returns a version that bumps whenever any
// drive-in source changes, so a component reading getDriveInSource() refreshes.
export function useDriveInSources(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => subscribeDriveInSources(() => setVersion((v) => v + 1)), []);
  return version;
}
