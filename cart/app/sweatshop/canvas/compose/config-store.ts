// File-side persistence for IF/THEN configs.
//
// A config is saved TWO ways: a DB row (entity `if-then-config`, bucket
// `user-sweatshop`, written via useCRUD in the page) and a JSON file on disk
// (this module). Disk is the durable copy — the embedded DB is treated as
// throwaway/derivable, so the file is what actually survives and travels.
// One pretty-printed JSON file per config under the user's sweatshop dir.

import { writeFile, mkdir, readFile, remove } from '@reactjit/runtime/hooks/fs';
import { callHost, hasHost } from '@reactjit/runtime/ffi';
import type { IfThenConfig } from './types';

function homeDir(): string {
  try {
    if (hasHost('__env')) return callHost<string>('__env', '', 'HOME') || '';
  } catch {
    /* ignore */
  }
  return '';
}

/** ~/.reactjit/sweatshop/configs — or ./.sweatshop-configs if HOME is unknown. */
export function configDir(): string {
  const home = homeDir();
  return home ? `${home}/.reactjit/sweatshop/configs` : '.sweatshop-configs';
}

export function configFilePath(id: string): string {
  return `${configDir()}/${id}.json`;
}

// mkdir each level — the host's __fs_mkdir is not guaranteed recursive.
function ensureDir(): void {
  const home = homeDir();
  if (home) {
    mkdir(`${home}/.reactjit`);
    mkdir(`${home}/.reactjit/sweatshop`);
  }
  mkdir(configDir());
}

/** Write the config to disk as pretty JSON. Returns true on success. */
export function saveConfigFile(config: IfThenConfig): boolean {
  ensureDir();
  return writeFile(configFilePath(config.id), JSON.stringify(config, null, 2));
}

export function deleteConfigFile(id: string): boolean {
  return remove(configFilePath(id));
}

/** Read one config back — for later index hydration off disk. */
export function readConfigFile(id: string): IfThenConfig | null {
  const raw = readFile(configFilePath(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as IfThenConfig;
  } catch {
    return null;
  }
}
