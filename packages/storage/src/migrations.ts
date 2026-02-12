/**
 * Migration system for storage data.
 *
 * Tracks schema versions via a _version field on each record.
 * When autoMigrate is enabled, records are automatically migrated
 * on read. Migrations run sequentially (v1 -> v2 -> v3).
 *
 * Usage:
 *   const migrations = {
 *     1: (data) => ({ ...data, email: data.email || '' }),
 *     2: (data) => { const { username, ...rest } = data; return { ...rest, name: username }; },
 *   };
 *
 *   useCRUD('users', UserSchema, { migrations, autoMigrate: true });
 */

import type { MigrationFn, StorageAdapter } from './types';
import type { Schema } from './schema';

export interface MigrationOptions {
  migrations: Record<number, MigrationFn>;
  autoMigrate: boolean;
  adapter: StorageAdapter;
  collection: string;
}

/** Get the latest version number from a migrations config. */
export function getLatestVersion(migrations: Record<number, MigrationFn>): number {
  const versions = Object.keys(migrations).map(Number).filter(n => !isNaN(n));
  return versions.length > 0 ? Math.max(...versions) : 0;
}

/** Run migrations on a single record, returning the migrated data. */
export function migrateRecord(
  data: any,
  migrations: Record<number, MigrationFn>,
  autoMigrate: boolean,
): any {
  if (!autoMigrate) return data;

  const currentVersion = data?._version ?? 0;
  const latestVersion = getLatestVersion(migrations);

  if (currentVersion >= latestVersion) return data;

  let migrated = { ...data };
  for (let v = currentVersion + 1; v <= latestVersion; v++) {
    const fn = migrations[v];
    if (fn) {
      migrated = fn(migrated);
    }
  }
  migrated._version = latestVersion;

  return migrated;
}

/** Stamp a record with the current schema version before writing. */
export function stampVersion(
  data: any,
  migrations: Record<number, MigrationFn>,
): any {
  const latestVersion = getLatestVersion(migrations);
  if (latestVersion === 0) return data;
  return { ...data, _version: latestVersion };
}

/**
 * Create a migrating adapter wrapper.
 * Wraps get/list to automatically migrate records on read,
 * and set to stamp version on write.
 */
export function createMigratingAdapter(
  adapter: StorageAdapter,
  migrations: Record<number, MigrationFn>,
  autoMigrate: boolean,
): StorageAdapter {
  if (Object.keys(migrations).length === 0) return adapter;

  return {
    ...adapter,

    async get(collection: string, id: string) {
      const data = await adapter.get(collection, id);
      if (!data) return null;

      const migrated = migrateRecord(data, migrations, autoMigrate);

      // If data was migrated, write it back
      if (autoMigrate && migrated._version !== data._version) {
        await adapter.set(collection, id, migrated);
      }

      return migrated;
    },

    async set(collection: string, id: string, data: any) {
      const stamped = stampVersion(data, migrations);
      return adapter.set(collection, id, stamped);
    },

    async list(collection: string, query?: any) {
      const items = await adapter.list(collection, query);
      const migrated = items.map(item => migrateRecord(item, migrations, autoMigrate));

      // Write back migrated items (if auto-migrating)
      if (autoMigrate) {
        for (let i = 0; i < items.length; i++) {
          if (migrated[i]._version !== items[i]._version) {
            await adapter.set(collection, migrated[i].id, migrated[i]);
          }
        }
      }

      return migrated;
    },

    async delete(collection: string, id: string) {
      return adapter.delete(collection, id);
    },
  };
}
