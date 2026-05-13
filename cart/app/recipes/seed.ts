// Seed the `recipe` table from the on-disk corpus. Runs once after the
// generic JSONB-blob tables are created during bootstrap (see
// cart/app/db/bootstrap.ts). Idempotent — uses ON CONFLICT DO NOTHING
// so:
//
//   - First boot: every disk recipe is inserted.
//   - Subsequent boots: existing rows are left alone; new disk recipes
//     (added since the last boot) are inserted; user edits made through
//     useCRUD survive every boot because we never overwrite.
//
// If you want a disk version to ever WIN over the DB (e.g. shipping a
// fixed version of a canonical recipe), flip the ON CONFLICT clause to
// DO UPDATE on a per-recipe basis behind a customized flag in `data`.
// Until that decision lands, conservative-default is to never clobber.

import { exec } from '../db/connections';
import { tableName, ident, lit, jsonb } from '../db/sql';
import { ALL_RECIPES } from './index';

let seeded = false;

export function seedRecipes(): void {
  if (seeded) return;
  const t = tableName('recipe');
  for (const r of ALL_RECIPES) {
    const sql = `
      INSERT INTO ${ident(t)} (id, data, created_at, updated_at)
      VALUES (${lit(r.slug)}, ${jsonb(r)}, now(), now())
      ON CONFLICT (id) DO NOTHING
    `;
    exec('user-sweatshop', sql);
  }
  seeded = true;
}
