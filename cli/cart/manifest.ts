// cli/cart/manifest.ts - cart.json reader.

import { fsReadJson } from '../host/fs.ts';

export interface CartManifest {
  name?: string;
  surface?: 'gui' | 'tui';
  icon?: string;
  icons?: { default?: string; linux?: string; macos?: string; windows?: string };
  customChrome?: boolean;
  [key: string]: unknown;
}

export function loadManifest(path: string): CartManifest {
  return fsReadJson<CartManifest>(path);
}

export function manifestField(manifest: CartManifest, dotted: string): unknown {
  let current: unknown = manifest;
  for (const part of dotted.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
