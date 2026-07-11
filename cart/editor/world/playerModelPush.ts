// world/playerModelPush.ts — feed the EXPORTED player model to the loader (req_2780).
//
// The playtest tab's embodied player wore the loader's stand-in figure (seven
// cubes + a visor, world_loader.zig fallbackPlayerModel) because the blank
// editor world has no player-model lump and nothing consumed the character
// export. This module closes that loop: resolve the ONE package declared
// { as: 'character', role: 'player' } (manifest truth, req_2718/req_2771),
// slice its meshdoc into per-part groups, and stage them through the
// __compiled_world_set_player_model door — which the loader consumes at
// construct in place of the stand-in. Call BEFORE the WorldLoader node mounts
// (the door is process-global; PlaytestSurface pushes during its first render).
//
// Groups are per OUTLINER PART: vertices re-based to each part's measured
// bounds center so a future baked animation can pose the parts; colors come
// from the rank-paired parts.json rows (the outliner tints).
import { MODEL_PACKAGES } from '../data/catalog';
import { packageMeshDoc, packageMeshDocParts } from '../data/assetCatalog';
import { meshDocRangeCenters, type PackageMeshDoc, type MeshDocPartMeta } from '../data/meshDoc';
import { buildBodyClips, encodeAnimationPayload, type AnimNode } from './playerAnimation';
import type { ModelPackage } from '../data/types';

const g: any = globalThis;

/** The package currently declared as THE played model (roster scan — session
 *  exports land in the roster via upsertSavedPackage, disk loads at boot). */
export function playerCharacterPackage(): ModelPackage | null {
  return MODEL_PACKAGES.find((m) => m.placeable?.as === 'character' && m.placeable.role === 'player') ?? null;
}

function hexRgb(hex: string | undefined): [number, number, number] {
  const h = (hex ?? '').replace('#', '');
  if (h.length < 6) return [0.85, 0.69, 0.55]; // the starter skin tone
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

/** Slice a meshdoc into the door payload: one group per part range, vertices
 *  LOCAL to the range's measured bounds center, color from the rank-paired
 *  parts row. Table rows: [vertStart, vertCount, cx, cy, cz, r, g, b].
 *  `nodes` mirrors the emitted groups one-for-one (name + center, rank order)
 *  — the clip generator MUST see the exact node order the loader will animate. */
export function playerModelPayload(doc: PackageMeshDoc, meta: MeshDocPartMeta[]): { verts: Float32Array; table: Float32Array; nodes: AnimNode[] } {
  const triCount = Math.floor(doc.vertices.length / 24);
  const centers = meshDocRangeCenters(doc);
  const buckets: number[][] = doc.ranges.map(() => []);
  for (let tri = 0; tri < triCount; tri += 1) {
    const group = doc.faceGroups ? doc.faceGroups[tri]! : tri;
    const rank = doc.ranges.findIndex((r) => group >= r.lo && group < r.hi);
    if (rank < 0) continue;
    const center = centers[rank] ?? [0, 0, 0];
    const bucket = buckets[rank]!;
    for (let corner = 0; corner < 3; corner += 1) {
      const at = (tri * 3 + corner) * 8;
      bucket.push(
        doc.vertices[at]! - center[0],
        doc.vertices[at + 1]! - center[1],
        doc.vertices[at + 2]! - center[2],
        doc.vertices[at + 3]!, doc.vertices[at + 4]!, doc.vertices[at + 5]!,
        doc.vertices[at + 6]!, doc.vertices[at + 7]!,
      );
    }
  }
  const totalFloats = buckets.reduce((sum, b) => sum + b.length, 0);
  const verts = new Float32Array(totalFloats);
  const rows: number[] = [];
  const nodes: AnimNode[] = [];
  let vertStart = 0;
  buckets.forEach((bucket, rank) => {
    if (bucket.length === 0) return;
    verts.set(bucket, vertStart * 8);
    const center = centers[rank] ?? [0, 0, 0];
    const [r, gg, b] = hexRgb(meta[rank]?.color);
    rows.push(vertStart, bucket.length / 8, center[0], center[1], center[2], r, gg, b);
    nodes.push({ name: meta[rank]?.name ?? `part ${rank + 1}`, center: [center[0], center[1], center[2]] });
    vertStart += bucket.length / 8;
  });
  return { verts, table: new Float32Array(rows), nodes };
}

export type PlayerModelPush = { name: string; groups: number; animated: boolean; nodes: AnimNode[] };

/** Resolve → slice → stage, model AND clips. Returns what was staged (the
 *  playtest readout), or null when there is no player-role export / no door /
 *  no readable meshdoc — in every null case the staging is CLEARED so the
 *  loader honestly falls back to the stand-in instead of wearing a stale body. */
export function pushPlayerModel(): PlayerModelPush | null {
  if (typeof g.__compiled_world_set_player_model !== 'function') return null;
  const clear = () => {
    g.__compiled_world_set_player_model(new Float32Array(0), new Float32Array(0));
    g.__compiled_world_set_player_animation?.(new Float32Array(0));
  };
  const pkg = playerCharacterPackage();
  if (!pkg) { clear(); return null; }
  const doc = packageMeshDoc(pkg);
  if (!doc || doc.vertices.length < 24) {
    console.warn(`[playtest] player model "${pkg.name}" has no readable meshdoc — stand-in figure`);
    clear();
    return null;
  }
  const meta = packageMeshDocParts(pkg) ?? [];
  const payload = playerModelPayload(doc, meta);
  if (payload.table.length === 0) { clear(); return null; }
  g.__compiled_world_set_player_model(payload.verts, payload.table);
  // The basic animation shapes (req_2781), generated for THIS body's exact
  // node order — clips only engage when node_count matches the groups.
  let animated = false;
  if (typeof g.__compiled_world_set_player_animation === 'function') {
    const clips = buildBodyClips(payload.nodes);
    g.__compiled_world_set_player_animation(encodeAnimationPayload(payload.nodes.length, clips));
    animated = true;
  }
  return { name: pkg.name, groups: payload.table.length / 8, animated, nodes: payload.nodes };
}
