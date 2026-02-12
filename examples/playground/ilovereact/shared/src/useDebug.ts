/**
 * useDebug — Register debug data from a component that the inspector console can read.
 *
 * Any data registered here is accessible from the console via JS eval:
 *   > __debug                        // all registered debug entries
 *   > __debug['PlayerStats']         // specific component's data
 *   > __debug['PlayerStats'].health  // specific field
 *
 * Also works with watch expressions:
 *   :watch __debug['PlayerStats'].health
 *
 * @example
 *   function PlayerHUD({ health, mana, position }) {
 *     useDebug('PlayerHUD', { health, mana, position });
 *     return <Box>...</Box>;
 *   }
 */

import { useEffect, useRef } from 'react';

// Global debug registry — lives on globalThis so the console can eval it
declare global {
  var __debug: Record<string, any>;
}

if (typeof globalThis.__debug === 'undefined') {
  globalThis.__debug = {};
}

/**
 * Register debug data under a key. Data is available on `globalThis.__debug[key]`.
 * Automatically unregisters on unmount.
 *
 * @param key   Unique identifier (usually the component name)
 * @param data  Any serializable data to expose
 */
export function useDebug(key: string, data: any): void {
  const keyRef = useRef(key);
  keyRef.current = key;

  // Update the data every render
  globalThis.__debug[key] = data;

  // Clean up on unmount
  useEffect(() => {
    return () => {
      delete globalThis.__debug[keyRef.current];
    };
  }, []);
}

/**
 * Read all currently registered debug data (non-hook, for tooling).
 */
export function getDebugData(): Record<string, any> {
  return globalThis.__debug;
}

/**
 * Imperatively register debug data outside of React (e.g., from a game loop or service).
 * Returns an unregister function.
 */
export function registerDebug(key: string, data: any): () => void {
  globalThis.__debug[key] = data;
  return () => { delete globalThis.__debug[key]; };
}
