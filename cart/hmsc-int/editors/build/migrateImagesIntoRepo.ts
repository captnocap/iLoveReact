// editors/build/migrateImagesIntoRepo.ts — one-time rescue for image uploads
// that were stored as raw absolute paths (req_1774). Walks every saved decal
// material, copies each external image's bytes into the repo asset folder
// (ingestImageFile), rewrites the node's src to the portable relative ref, and
// re-saves the decal in place. Run it on the machine where the source files
// still live (a renamed/moved/deleted source can't be recovered — it's reported
// in `missing`). After a clean run, commit + push and your textures travel.

import { loadCustomTextures, saveDecalTexture } from '@game/textures/materials';
import type { DecalDoc } from '@game/textures/decal';
import { ingestImageFile, isRepoLocalImageSrc } from './ingestImage';

export type ImageMigrationReport = {
  /** decal materials examined */
  scanned: number;
  /** image nodes copied into the repo this run */
  migrated: number;
  /** image nodes already portable (data: URL or already under the asset dir) */
  alreadyLocal: number;
  /** external images whose source file is gone — list so the user can re-upload */
  missing: { label: string; src: string }[];
};

/** Rewrite a decal doc's external image nodes to repo-local assets. Pure except
 *  for the injected `ingest` (so the walk is unit-testable with a fake). */
export function rewriteDecalImages(
  doc: DecalDoc,
  ingest: (src: string) => string | null,
): { doc: DecalDoc; migrated: number; alreadyLocal: number; missing: string[] } {
  let migrated = 0;
  let alreadyLocal = 0;
  const missing: string[] = [];
  const nodes = doc.nodes.map((n) => {
    if (n.kind !== 'image') return n;
    if (isRepoLocalImageSrc(n.src)) { alreadyLocal += 1; return n; }
    const rel = ingest(n.src);
    if (!rel) { missing.push(n.src); return n; }
    migrated += 1;
    return { ...n, src: rel };
  });
  return { doc: { ...doc, nodes }, migrated, alreadyLocal, missing };
}

/** Scan all saved decal materials and pull every external image into the repo.
 *  Only re-saves a decal when something actually moved (upsert by id = the
 *  re-edit law in saveDecalTexture). Safe to run repeatedly — already-portable
 *  refs are skipped, ingest dedupes by content. */
export function migrateImagesIntoRepo(): ImageMigrationReport {
  const report: ImageMigrationReport = { scanned: 0, migrated: 0, alreadyLocal: 0, missing: [] };
  for (const tex of loadCustomTextures()) {
    if (!tex.decal) continue;
    report.scanned += 1;
    const r = rewriteDecalImages(tex.decal, ingestImageFile);
    report.alreadyLocal += r.alreadyLocal;
    for (const src of r.missing) report.missing.push({ label: tex.label, src });
    if (r.migrated > 0) {
      report.migrated += r.migrated;
      saveDecalTexture(tex.label, r.doc, tex.id);
    }
  }
  return report;
}

/** A one-line human summary of a migration run, for a toast/status line. */
export function summarizeMigration(r: ImageMigrationReport): string {
  const bits = [`${r.migrated} image${r.migrated === 1 ? '' : 's'} pulled into the repo`];
  if (r.alreadyLocal) bits.push(`${r.alreadyLocal} already portable`);
  if (r.missing.length) bits.push(`${r.missing.length} missing (re-upload needed)`);
  return bits.join(' · ');
}
