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
import { isAuthoredPiece, authoredResidentKeyOf, skinnedPieceId, type AuthoredBuildPiece } from './authoredRegistry';
import { authoredMeshData } from './authoredMesh';
import { exists, readFileBase64 } from '../../../runtime/hooks/fs';
import { base64ToBytes } from '../../../runtime/workspace';
import { modelPackageById } from '../data/content';
import { resolvePackageDir } from '../data/modelPackageStore';
import { bindPaintSkinToCurrentMesh, listPaintSkins, PAINT_MESH_VERTEX_BYTES, PAINT_MESH_VERTEX_FLOATS } from '../data/paintVariants';
import { packageMeshDoc, packageMeshDocParts } from '../data/assetCatalog';
import { compileDoorMesh, DOOR_EXPORT_TUNING } from '../model/doorModel';
import { compileOutlinerCollisionBoxes } from '../model/meshCollision';
import type { ModelPackage } from '../data/types';

const g: any = globalThis;

function readPackageBytes(dir: string, rel: string): Uint8Array | undefined {
  const path = `${dir}/${rel}`;
  if (!exists(path)) return undefined;
  const b64 = readFileBase64(path);
  if (!b64) return undefined;
  try { return base64ToBytes(b64); } catch { return undefined; }
}

type PaintedForm = { vertices: Float32Array; png: Uint8Array };

/** Read a paint-space mesh blob + atlas png. The atlas maps through the blob's
 *  island-space UV channels — pairing it with source UVs scrambles the painting
 *  (req_2833). Callers rebind those UVs to current model geometry. */
function readPaintedForm(dir: string, blobRel: string, pngRel: string): PaintedForm | null {
  const blob = readPackageBytes(dir, blobRel);
  if (!blob) return null;
  const vertCount = Math.floor(blob.length / PAINT_MESH_VERTEX_BYTES);
  if (vertCount < 3) return null;
  const png = readPackageBytes(dir, pngRel);
  if (!png) return null;
  const buf = blob.buffer.slice(blob.byteOffset, blob.byteOffset + vertCount * PAINT_MESH_VERTEX_BYTES);
  return { vertices: new Float32Array(buf, 0, vertCount * PAINT_MESH_VERTEX_FLOATS), png };
}

/** The model's CURRENT painted form (mesh/painted.blob + atlases/base.png — the
 *  look last saved in the mesh editor). Null for a package saved before the
 *  writer existed → the mesh honestly draws flat until its next save. */
function packagePaintedForm(dir: string): PaintedForm | null {
  return readPaintedForm(dir, 'mesh/painted.blob', 'atlases/base.png');
}

/** Apply the semantic export declaration to one visual vertex form. Door meshes
 *  compile into body-first + a trailing named leaf slot; ordinary pieces pass
 *  through untouched. A broken door contract is rejected loudly, never flattened
 *  into an apparently valid solid wall. */
function residentMeshFor(
  ap: AuthoredBuildPiece,
  pkg: ModelPackage | null,
  key: string,
  vertices: Float32Array,
  png?: Uint8Array,
): ResidentMesh | null {
  if (ap.edit !== 'door' && ap.edit !== 'garageDoor') {
    const doc = pkg ? packageMeshDoc(pkg) : null;
    const parts = pkg ? packageMeshDocParts(pkg) : null;
    const collisionBoxes = compileOutlinerCollisionBoxes(vertices, doc, parts);
    return { key, vertices, png, ...(collisionBoxes.length > 0 ? { collisionBoxes } : {}) };
  }
  if (!pkg) {
    console.warn(`[authored-door] '${ap.label}' has no model package; resident door skipped`);
    return null;
  }
  const doc = packageMeshDoc(pkg);
  const parts = packageMeshDocParts(pkg);
  if (!doc || !parts) {
    console.warn(`[authored-door] '${ap.label}' has no saved meshdoc/Outliner metadata; Save Model, then export Door Wall again`);
    return null;
  }
  const compiled = compileDoorMesh(vertices, doc, parts);
  if (!compiled.ok) {
    console.warn(`[authored-door] '${ap.label}' rejected: ${compiled.error}`);
    return null;
  }
  const tuning = ap.edit === 'garageDoor' ? DOOR_EXPORT_TUNING.garage : DOOR_EXPORT_TUNING.walk;
  const slots = compiled.mesh.leafGlass
    ? [
      { start: compiled.mesh.leaf.start, count: compiled.mesh.leafGlass.start - compiled.mesh.leaf.start },
      compiled.mesh.leafGlass,
    ]
    : [compiled.mesh.leaf];
  return {
    key,
    vertices: compiled.mesh.vertices,
    png,
    // Slot 0 is opaque leaf; an optional trailing slot is the Studio glass run.
    // The live host swings every slot from leafSlot onward and routes the glass
    // tail through its depth-write-off transparent pass.
    slots,
    door: { leafSlot: 0, reachMeters: tuning.reachMeters, vehicle: tuning.vehicle, startOpen: false },
    collisionBoxes: compiled.mesh.collisionBoxes,
  };
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
      refs.push({ key: authoredResidentKeyOf(piece.pieceId), x: piece.x, y: piece.y, z: piece.z, yaw: piece.yawDegrees });
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
    const currentGeometry = authoredMeshData(ap.modelId, ap.pkgId);
    // Geometry comes from the CURRENT model resolver; the paint-space blob
    // contributes its UV layout only (req_2832/2833). This keeps the rendered
    // resident mesh and placement bounds on one model revision.
    const paintedForm = dir ? packagePaintedForm(dir) : null;
    const currentPaintedVertices = currentGeometry && paintedForm
      ? bindPaintSkinToCurrentMesh(currentGeometry, paintedForm.vertices)
      : paintedForm?.vertices ?? null;
    const verts = currentPaintedVertices ?? currentGeometry;
    if (verts && verts.length >= 8) {
      if (currentPaintedVertices && paintedForm) painted += 1;
      const resident = residentMeshFor(ap, pkg, ap.id, verts, currentPaintedVertices ? paintedForm?.png : undefined);
      if (resident) meshes.push(resident);
    } else console.warn(`[authored] no mesh data for '${ap.modelId}' (${ap.label}) — not resident (re-open + re-export the model)`);
    // Every stored paint SKIN is its own resident mesh (req_2834): key
    // `<modelId>#p<skinId>` — the same key a skinned placeable id resolves to,
    // so skinned ghosts/placements/colliders draw that painting. Its saved blob
    // owns UVs, not historical positions: bind it onto currentGeometry.
    if (pkg && dir) {
      for (const skin of listPaintSkins(pkg)) {
        const form = readPaintedForm(dir, `paints/paint_${skin.id}.blob`, `paints/paint_${skin.id}.png`);
        if (!form) continue;
        const skinVertices = currentGeometry
          ? bindPaintSkinToCurrentMesh(currentGeometry, form.vertices)
          : form.vertices;
        if (!skinVertices) {
          console.warn(`[authored] paint skin '${skin.id}' no longer fits '${ap.modelId}' — load + save the painting against the current topology`);
          continue;
        }
        const resident = residentMeshFor(ap, pkg, skinnedPieceId(ap.id, skin.id), skinVertices, form.png);
        if (!resident) continue;
        meshes.push(resident);
        skins += 1;
      }
    }
  }
  g.__compiled_world_set_resident_meshes(nodeId, encodeResidentMeshes(meshes));
  console.warn(`[authored] resident catalog: ${meshes.length} mesh(es) — ${painted} painted, ${skins} paint skin(s) -> loader node ${nodeId}`);
  return true;
}
