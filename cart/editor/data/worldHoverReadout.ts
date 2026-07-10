import { useSyncExternalStore } from 'react';

export type WorldHoverReadout = {
  x: number;
  y: number;
  z: number;
};

let readout: WorldHoverReadout | null = null;
const listeners = new Set<() => void>();

function roundCoord(value: number): number {
  const rounded = Math.round(value);
  return Object.is(rounded, -0) ? 0 : rounded;
}

function sameReadout(a: WorldHoverReadout | null, b: WorldHoverReadout | null): boolean {
  return a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getSnapshot(): WorldHoverReadout | null {
  return readout;
}

export function publishWorldHoverReadout(point: WorldHoverReadout | null): void {
  const next = point ? { x: roundCoord(point.x), y: roundCoord(point.y), z: roundCoord(point.z) } : null;
  if (sameReadout(readout, next)) return;
  readout = next;
  for (const listener of listeners) listener();
}

export function useWorldHoverReadout(): WorldHoverReadout | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
