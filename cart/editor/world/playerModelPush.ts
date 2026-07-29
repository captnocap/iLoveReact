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
import { type PackageMeshDoc, type MeshDocPartMeta } from '../data/meshDoc';
import { buildBodyClips, encodeAnimationPayload, type AnimNode } from './playerAnimation';
import { poseMarkerKindForBone } from './poseMarkers';
import { playerRigSlices } from './playerRigSlices';
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
export function playerModelPayload(
  doc: PackageMeshDoc,
  meta: MeshDocPartMeta[],
  skeleton?: ModelPackage['skeleton'],
): { verts: Float32Array; table: Float32Array; nodes: AnimNode[]; recoveredRig: boolean } {
  const slices = playerRigSlices(doc, meta, skeleton);
  const { centers, buckets, names } = slices;
  const totalRows = buckets.reduce((sum, b) => sum + b.length, 0);
  const verts = new Float32Array(totalRows * 8);
  const rows: number[] = [];
  const nodes: AnimNode[] = [];
  let vertStart = 0;
  buckets.forEach((bucket, rank) => {
    if (bucket.length === 0) return;
    const center = centers[rank] ?? [0, 0, 0];
    const [r, gg, b] = hexRgb(meta[rank]?.color);
    let at = vertStart * 8;
    for (const row of bucket) {
      const src = row * 8;
      verts[at] = doc.vertices[src]! - center[0];
      verts[at + 1] = doc.vertices[src + 1]! - center[1];
      verts[at + 2] = doc.vertices[src + 2]! - center[2];
      verts[at + 3] = doc.vertices[src + 3]!;
      verts[at + 4] = doc.vertices[src + 4]!;
      verts[at + 5] = doc.vertices[src + 5]!;
      verts[at + 6] = doc.vertices[src + 6]!;
      verts[at + 7] = doc.vertices[src + 7]!;
      at += 8;
    }
    rows.push(vertStart, bucket.length, center[0], center[1], center[2], r, gg, b);
    nodes.push({ name: names[rank] ?? `part ${rank + 1}`, center: [center[0], center[1], center[2]] });
    vertStart += bucket.length;
  });
  return { verts, table: new Float32Array(rows), nodes, recoveredRig: slices.recovered };
}

/** The SKINNED payload (SKIN-3499): the same part slicing, but ONE model-space
 *  mesh — vertices are NOT re-based, and every vertex carries its part's bone
 *  index with a rigid weight. Wire: stride-16 rows [pos3, normal3, uv2,
 *  j0..j3, w0..w3]; bone rows [cx, cy, cz, r, g, b, 0, 0] in emit order
 *  (== joint indices == the clip generator's node order). Rigid weights make
 *  the skinned draw reproduce the per-part path exactly; the auto-weight
 *  solver (phase 2) will soften seams into the same wire format. */
export function playerSkinPayload(
  doc: PackageMeshDoc,
  meta: MeshDocPartMeta[],
  poseMarkers = false,
  skeleton?: ModelPackage['skeleton'],
): { verts: Float32Array; bones: Float32Array; nodes: AnimNode[]; recoveredRig: boolean; trackedJoints: number } {
  const slices = playerRigSlices(doc, meta, skeleton);
  const { centers, buckets, names } = slices;
  const totalRows = buckets.reduce((sum, b) => sum + b.length, 0);
  const verts = new Float32Array(totalRows * 16);
  const boneRows: number[] = [];
  const nodes: AnimNode[] = [];
  let at = 0;
  buckets.forEach((bucket, rank) => {
    if (bucket.length === 0) return;
    const bone = nodes.length;
    const center = centers[rank] ?? [0, 0, 0];
    const [r, gg, b] = hexRgb(meta[rank]?.color);
    for (const row of bucket) {
      const src = row * 8;
      verts[at] = doc.vertices[src]!;
      verts[at + 1] = doc.vertices[src + 1]!;
      verts[at + 2] = doc.vertices[src + 2]!;
      verts[at + 3] = doc.vertices[src + 3]!;
      verts[at + 4] = doc.vertices[src + 4]!;
      verts[at + 5] = doc.vertices[src + 5]!;
      verts[at + 6] = doc.vertices[src + 6]!;
      verts[at + 7] = doc.vertices[src + 7]!;
      verts[at + 8] = bone;
      verts[at + 12] = 1; // rigid: 100% the part's bone (j1..j3/w1..w3 stay 0)
      at += 16;
    }
    const name = names[rank] ?? `part ${rank + 1}`;
    boneRows.push(center[0], center[1], center[2], r, gg, b, poseMarkers ? poseMarkerKindForBone(name) : 0, 0);
    nodes.push({ name, center: [center[0], center[1], center[2]] });
  });
  return {
    verts,
    bones: new Float32Array(boneRows),
    nodes,
    recoveredRig: slices.recovered,
    trackedJoints: nodes.filter((node) => poseMarkerKindForBone(node.name) !== 0).length,
  };
}

export type PlayerModelPush = {
  name: string;
  groups: number;
  animated: boolean;
  nodes: AnimNode[];
  recoveredRig: boolean;
  trackedJoints: number;
};

/** Resolve → slice → stage, model AND clips. Returns what was staged (the
 *  playtest readout), or null when there is no player-role export / no door /
 *  no readable meshdoc — in every null case the staging is CLEARED so the
 *  loader honestly falls back to the stand-in instead of wearing a stale body. */
export function pushPlayerModel(options: { poseMarkers?: boolean } = {}): PlayerModelPush | null {
  if (typeof g.__compiled_world_set_player_model !== 'function') return null;
  const skinDoor = typeof g.__compiled_world_set_player_skin === 'function';
  const clear = () => {
    g.__compiled_world_set_player_model(new Float32Array(0), new Float32Array(0));
    g.__compiled_world_set_player_skin?.(new Float32Array(0), new Float32Array(0));
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
  let nodes: AnimNode[];
  let groups: number;
  let recoveredRig = false;
  let trackedJoints = 0;
  if (skinDoor) {
    // SKIN-3499: hosts with the skin door get ONE palette-blended figure.
    // The per-part staging is cleared so a stale body can't win at construct.
    const payload = playerSkinPayload(doc, meta, options.poseMarkers === true, pkg.skeleton);
    if (payload.nodes.length === 0) { clear(); return null; }
    g.__compiled_world_set_player_skin(payload.verts, payload.bones);
    g.__compiled_world_set_player_model(new Float32Array(0), new Float32Array(0));
    nodes = payload.nodes;
    groups = payload.nodes.length;
    recoveredRig = payload.recoveredRig;
    trackedJoints = payload.trackedJoints;
  } else {
    const payload = playerModelPayload(doc, meta, pkg.skeleton);
    if (payload.table.length === 0) { clear(); return null; }
    g.__compiled_world_set_player_model(payload.verts, payload.table);
    nodes = payload.nodes;
    groups = payload.table.length / 8;
    recoveredRig = payload.recoveredRig;
    trackedJoints = payload.nodes.filter((node) => poseMarkerKindForBone(node.name) !== 0).length;
  }
  if (recoveredRig) {
    console.warn(`[playtest] recovered ${groups}-bone player rig from exported skeleton + exact mesh connectivity runs`);
  }
  // The basic animation shapes (req_2781), generated for THIS body's exact
  // node order — clips only engage when node_count matches the groups/bones.
  let animated = false;
  if (typeof g.__compiled_world_set_player_animation === 'function') {
    const clips = buildBodyClips(nodes);
    g.__compiled_world_set_player_animation(encodeAnimationPayload(nodes.length, clips));
    animated = true;
  }
  return { name: pkg.name, groups, animated, nodes, recoveredRig, trackedJoints };
}
