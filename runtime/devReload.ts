import { callHost } from './ffi';

export type DevReloadPolicy = 'automatic' | 'ask' | 'off';

const POLICY_CODE: Record<DevReloadPolicy, number> = {
  automatic: 0,
  ask: 1,
  off: 2,
};

export function setDevReloadPolicy(policy: DevReloadPolicy): boolean {
  return callHost<number>('__dev_reload_set_policy', 0, POLICY_CODE[policy]) > 0;
}

export function devReloadWaiting(): boolean {
  return callHost<number>('__dev_reload_waiting', 0) > 0;
}

export function applyDevReload(): boolean {
  return callHost<number>('__dev_reload_apply', 0) > 0;
}

export function devReloadRevision(): number {
  return callHost<number>('__dev_reload_revision', 0);
}

export function installDevReloadCheckpoint(checkpoint: () => void): () => void {
  (globalThis as any).__beforeDevReload = checkpoint;
  return () => {
    if ((globalThis as any).__beforeDevReload === checkpoint) delete (globalThis as any).__beforeDevReload;
  };
}
