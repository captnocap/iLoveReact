// world/livePush.ts — the ONE seam that feeds an embedded WorldLoader node the
// editor's live world (GLOBALS req_2770 lifted this out of WorldViewport so the
// playtest tab shows the SAME world the iso viewport authors — one push, two
// consumers, no drift).
//
//   pushLiveWorld      — placed pieces as instance rows + face-skin materials +
//                        authored mesh-prop refs (the req_1798/1843/1812 doors).
//   pushResidentMeshes — the authored-mesh catalog a placement references
//                        (req_2577); returns false until the loader node exists.
import { pieceInstanceRows, type PlacedPiece } from './pieces';
import { pieceSkinBoxes } from './pieceSkins';
import { encodeResidentMeshes, encodeMeshRefs, type ResidentMesh, type MeshRef } from './meshProps';
import { isAuthoredPiece, authoredModelIdOf, type AuthoredBuildPiece } from './authoredRegistry';
import { authoredMeshData } from './authoredMesh';

const g: any = globalThis;

/** Push the placed-piece world onto a mounted loader node: box instances, face
 *  skins, and authored mesh-prop refs. No-ops (loudly, when pieces exist) until
 *  the node id and the doors are live. */
export function pushLiveWorld(nodeId: number, pieces: readonly PlacedPiece[]): void {
  if (!nodeId || typeof g.__compiled_world_set_live_pieces !== 'function') {
    if (pieces.length) console.warn(`[place] live push SKIPPED — node=${nodeId} door=${typeof g.__compiled_world_set_live_pieces}`);
    return;
  }
  g.__compiled_world_set_live_pieces(nodeId, pieceInstanceRows(pieces));
  // Real textures (req_2575 Stage B): faces wearing an assigned material push
  // their WGSL shader once, then a skin box per face so the loader samples it
  // over the flat live box. Unskinned faces stay flat. Doors gated behind their
  // presence so an older host without them still renders the flat geometry.
  const skin = pieceSkinBoxes(pieces);
  if (typeof g.__compiled_world_set_live_material === 'function') {
    for (const m of skin.materials) g.__compiled_world_set_live_material(nodeId, m.hash, 0, m.wgsl, new Float32Array(m.data), m.opacity);
  }
  if (typeof g.__compiled_world_set_live_skin_boxes === 'function') {
    g.__compiled_world_set_live_skin_boxes(nodeId, skin.boxes);
  }
  // Authored (mesh) pieces render via the live MESH-PROP path (req_2577): one
  // ref per placement pointing at its resident mesh by key. Real geometry.
  if (typeof g.__compiled_world_set_live_mesh_props === 'function') {
    const refs: MeshRef[] = [];
    for (const piece of pieces) {
      if (!isAuthoredPiece(piece.pieceId)) continue;
      refs.push({ key: authoredModelIdOf(piece.pieceId), x: piece.x, y: piece.y, z: piece.z, yaw: piece.yawDegrees });
    }
    g.__compiled_world_set_live_mesh_props(nodeId, encodeMeshRefs(refs));
  }
  console.warn(`[place] live push: ${pieces.length} pieces (decomposed) + ${skin.materials.length} materials -> loader node ${nodeId}`);
}

/** Keep the authored meshes RESIDENT so their placements can draw (req_2577).
 *  Returns false while the loader node / door isn't up yet — callers retry. */
export function pushResidentMeshes(nodeId: number, authoredPieces: readonly AuthoredBuildPiece[]): boolean {
  if (!nodeId || typeof g.__compiled_world_set_resident_meshes !== 'function') return false;
  const meshes: ResidentMesh[] = [];
  for (const ap of authoredPieces) {
    const verts = authoredMeshData(ap.modelId, ap.pkgId);
    if (verts && verts.length >= 8) meshes.push({ key: ap.modelId, vertices: verts });
    else console.warn(`[authored] no mesh data for '${ap.modelId}' (${ap.label}) — not resident (re-open + re-export the model)`);
  }
  g.__compiled_world_set_resident_meshes(nodeId, encodeResidentMeshes(meshes));
  console.warn(`[authored] resident catalog: ${meshes.length} authored mesh(es) -> loader node ${nodeId}`);
  return true;
}
