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
import { isAuthoredPiece, authoredModelIdOf, skinnedPieceId, type AuthoredBuildPiece } from './authoredRegistry';
import { authoredMeshData } from './authoredMesh';
import { exists, readFileBase64 } from '../../../runtime/hooks/fs';
import { base64ToBytes } from '../../../runtime/workspace';
import { modelPackageById } from '../data/content';
import { resolvePackageDir } from '../data/modelPackageStore';
import { listPaintSkins } from '../data/paintVariants';

const g: any = globalThis;

function readPackageBytes(dir: string, rel: string): Uint8Array | undefined {
  const path = `${dir}/${rel}`;
  if (!exists(path)) return undefined;
  const b64 = readFileBase64(path);
  if (!b64) return undefined;
  try { return base64ToBytes(b64); } catch { return undefined; }
}

type PaintedForm = { vertices: Float32Array; png: Uint8Array };

/** A paint-space mesh blob + its atlas png as one resident-mesh payload. The atlas
 *  maps ONLY onto the blob's island-space verts — pairing it with the source-UV doc
 *  verts scrambles the painting (req_2833) — so both halves or nothing. */
function readPaintedForm(dir: string, blobRel: string, pngRel: string): PaintedForm | null {
  const blob = readPackageBytes(dir, blobRel);
  if (!blob) return null;
  const vertCount = Math.floor(blob.length / 32);
  if (vertCount < 3) return null;
  const png = readPackageBytes(dir, pngRel);
  if (!png) return null;
  const buf = blob.buffer.slice(blob.byteOffset, blob.byteOffset + vertCount * 32);
  return { vertices: new Float32Array(buf, 0, vertCount * 8), png };
}

/** The model's CURRENT painted form (mesh/painted.blob + atlases/base.png — the
 *  look last saved in the mesh editor). Null for a package saved before the
 *  writer existed → the mesh honestly draws flat until its next save. */
function packagePaintedForm(dir: string): PaintedForm | null {
  return readPaintedForm(dir, 'mesh/painted.blob', 'atlases/base.png');
}

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
  let painted = 0;
  let skins = 0;
  for (const ap of authoredPieces) {
    const pkg = modelPackageById(ap.pkgId);
    const dir = pkg ? resolvePackageDir(pkg.kind, pkg.id) : null;
    // The painted form rides the lump (req_2832/2833: a placed export lost its
    // paintings): paint-space verts + atlas PNG together, or the doc mesh flat.
    const paintedForm = dir ? packagePaintedForm(dir) : null;
    const verts = paintedForm?.vertices ?? authoredMeshData(ap.modelId, ap.pkgId);
    if (verts && verts.length >= 8) {
      if (paintedForm) painted += 1;
      meshes.push({ key: ap.modelId, vertices: verts, png: paintedForm?.png });
    } else console.warn(`[authored] no mesh data for '${ap.modelId}' (${ap.label}) — not resident (re-open + re-export the model)`);
    // Every stored paint SKIN is its own resident mesh (req_2834): key
    // `<modelId>#p<skinId>` — the same key a skinned placeable id resolves to,
    // so skinned ghosts/placements/colliders draw that painting.
    if (pkg && dir) {
      for (const skin of listPaintSkins(pkg)) {
        const form = readPaintedForm(dir, `paints/paint_${skin.id}.blob`, `paints/paint_${skin.id}.png`);
        if (!form) continue;
        meshes.push({ key: skinnedPieceId(ap.modelId, skin.id), vertices: form.vertices, png: form.png });
        skins += 1;
      }
    }
  }
  g.__compiled_world_set_resident_meshes(nodeId, encodeResidentMeshes(meshes));
  console.warn(`[authored] resident catalog: ${meshes.length} mesh(es) — ${painted} painted, ${skins} paint skin(s) -> loader node ${nodeId}`);
  return true;
}
