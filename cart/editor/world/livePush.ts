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
import { liveMaterialFor, pieceSkinBoxes, type LiveMaterial } from './pieceSkins';
import { encodeResidentMeshes, encodeMeshRefs, encodeMeshRefsV2, encodeMeshRefsV3, type ResidentMesh, type MeshRef } from './meshProps';
import { isAuthoredPiece, authoredPieceFrom, authoredResidentKeyOf, skinnedPieceId, type AuthoredBuildPiece } from './authoredRegistry';
import { authoredMeshData, groundRebase } from './authoredMesh';
import { exists, readFile, readFileBase64, stat } from '../../../runtime/hooks/fs';
import { base64ToBytes } from '../../../runtime/workspace';
import { modelPackageById } from '../data/content';
import { resolvePackageDir } from '../data/modelPackageStore';
import { bindPaintSkinToCurrentMesh, listPaintSkins, PAINT_MESH_VERTEX_BYTES, PAINT_MESH_VERTEX_FLOATS } from '../data/paintVariants';
import { runtimeCompiledPaintAtlas } from '../data/paintAtlasCompiler';
import { packageMeshDoc, packageMeshDocParts } from '../data/assetCatalog';
import { compileDoorMesh, DOOR_EXPORT_TUNING, resolveDoorHinge, resolveDoorLeafPart } from '../model/doorModel';
import { liveFacadeRefs, liveFacadeResidentMeshes } from './facadeBake';
import { liveArchitectureCollideRows, liveArchitectureRefs, liveArchitectureResidentMeshes } from './architectureBake';
import { compileOutlinerCollision } from '../model/meshCollision';
import type { ModelPackage } from '../data/types';
import { compileTextureSlotMesh } from '../model/modelTextureSlots';
import { encodeLiveLights, normalizeModelLights, placeModelLight, type WorldLight } from '../model/modelLights';
import type { AuthoredFloraSpecies } from './floraSpecies';
import type { WorldFloraPatch } from './surfaceFlora';
import { builtinSurfaceFloraResidentMeshes, customFloraResidentAdapters, surfaceFloraMeshRefs } from './surfaceFlora';
import { buildRegionData } from '../render3d/regionFormula';
import { ensureRegionFormula } from '../render3d/liveRegions';

const g: any = globalThis;

function readPathBytes(path: string): Uint8Array | undefined {
  if (!exists(path)) return undefined;
  const b64 = readFileBase64(path);
  if (!b64) return undefined;
  try { return base64ToBytes(b64); } catch { return undefined; }
}

function readPackageBytes(dir: string, rel: string): Uint8Array | undefined {
  return readPathBytes(`${dir}/${rel}`);
}

type PaintedForm = { vertices: Float32Array; png: Uint8Array };

function readPaintedVertices(dir: string, blobRel: string): Float32Array | null {
  const blob = readPackageBytes(dir, blobRel);
  if (!blob) return null;
  const vertCount = Math.floor(blob.length / PAINT_MESH_VERTEX_BYTES);
  if (vertCount < 3 || blob.length !== vertCount * PAINT_MESH_VERTEX_BYTES) return null;
  const buf = blob.buffer.slice(blob.byteOffset, blob.byteOffset + vertCount * PAINT_MESH_VERTEX_BYTES);
  return new Float32Array(buf, 0, vertCount * PAINT_MESH_VERTEX_FLOATS);
}

/** Read a paint-space mesh blob + atlas png. The atlas maps through the blob's
 *  island-space UV channels — pairing it with source UVs scrambles the painting
 *  (req_2833). Callers rebind those UVs to current model geometry. */
function readPaintedForm(dir: string, blobRel: string, pngRel: string): PaintedForm | null {
  const vertices = readPaintedVertices(dir, blobRel);
  if (!vertices) return null;
  const png = readPackageBytes(dir, pngRel);
  if (!png) return null;
  return { vertices, png };
}

/** The model's CURRENT painted form (mesh/painted.blob + atlases/base.png — the
 *  look last saved in the mesh editor). Null for a package saved before the
 *  writer existed → the mesh honestly draws flat until its next save. */
function packagePaintedForm(dir: string): PaintedForm | null {
  return readPaintedForm(dir, 'mesh/painted.blob', 'atlases/base.png');
}

/** req_3133: does the saved painted form belong to the meshdoc on disk RIGHT NOW?
 *  writeModelArtifacts stamps painted.json with the doc revision it wrote beside;
 *  a matching stamp means a count-mismatched painted.blob is the DISPLAYED
 *  quality-DECIMATED mesh the user painted (the doc keeps the full-res source by
 *  design) — the intended exported look, not stale paint. Absent/mismatched
 *  stamp keeps the req_2832 stale-paint rule: drop the painting, draw the doc. */
function paintedFormIsCurrent(dir: string): boolean {
  const text = readFile(`${dir}/mesh/painted.json`);
  if (!text) return false;
  try {
    const meta = JSON.parse(text) as { docStamp?: unknown } | null;
    const doc = stat(`${dir}/mesh/doc.blob`);
    return !!doc && typeof meta?.docStamp === 'string' && meta.docStamp === `${doc.size}:${doc.mtimeMs}`;
  } catch {
    return false;
  }
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
  /** req_3133: when the RENDER geometry is the decimated displayed form, the
   *  full-res doc still owns collision — Outliner bands index source faces. */
  collisionVertices?: Float32Array,
): ResidentMesh | null {
  if (ap.edit !== 'door' && ap.edit !== 'garageDoor') {
    const doc = pkg ? packageMeshDoc(pkg) : null;
    const parts = pkg ? packageMeshDocParts(pkg) : null;
    const collision = compileOutlinerCollision(collisionVertices ?? vertices, doc, parts);
    const textureSlots = pkg?.textureSlots ?? ap.textureSlots ?? [];
    if (textureSlots.length > 0) {
      try {
        const compiled = compileTextureSlotMesh(vertices, doc?.faceMaterials, doc?.faceGroups, textureSlots);
        return {
          key,
          vertices: compiled.vertices,
          ...(compiled.materialUvs ? { materialUvs: compiled.materialUvs } : {}),
          png,
          slots: compiled.slots,
          ...(collision.boxes.length > 0 ? { collisionBoxes: collision.boxes } : {}),
          ...(collision.triangles.length > 0 ? { collisionTriangles: collision.triangles } : {}),
        };
      } catch (error) {
        console.warn(`[authored-slots] '${ap.label}' rejected: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    }
    // Studio glass (req_4707/req_4714: "the glass doesnt do glass" / the
    // industrial window's opaque panes): the doc's trailing glass run becomes
    // its own wire slot and the host routes it through the transparent pass —
    // the exact mechanism flat glass doors already use. This applies to
    // TEXTURED models too: a saved atlas is not a reliable glass carrier
    // (industrial_double_window's package holds zero translucent texels while
    // its doc names every pane), so the doc run is the authority and the host
    // falls back to the flat glass alpha when the atlas carries no
    // translucency. The split only applies when the render geometry IS the
    // doc geometry (same vertex order); a decimated displayed form keeps the
    // plain route — its glass boundary is unknowable.
    const glassFirstVertex = doc?.glassFirstVertex ?? null;
    const vertexCount = vertices.length / 8;
    if (glassFirstVertex !== null && glassFirstVertex > 0 && glassFirstVertex < vertexCount
      && doc && doc.vertices.length === vertices.length) {
      return {
        key,
        vertices,
        png,
        slots: [
          { start: 0, count: glassFirstVertex },
          { start: glassFirstVertex, count: vertexCount - glassFirstVertex },
        ],
        glassSlot: 1,
        ...(collision.boxes.length > 0 ? { collisionBoxes: collision.boxes } : {}),
        ...(collision.triangles.length > 0 ? { collisionTriangles: collision.triangles } : {}),
      };
    }
    return {
      key,
      vertices,
      png,
      ...(collision.boxes.length > 0 ? { collisionBoxes: collision.boxes } : {}),
      ...(collision.triangles.length > 0 ? { collisionTriangles: collision.triangles } : {}),
    };
  }
  if (!pkg) {
    console.warn(`[authored-door] '${ap.label}' has no model package; resident door skipped`);
    return null;
  }
  if ((pkg.textureSlots ?? ap.textureSlots ?? []).length > 0) {
    console.warn(`[authored-slots] '${ap.label}' is an animated door: face texture roles cannot share the door-leaf partition yet; the door keeps its painted atlas`);
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
  // The named knob decides the hinge side (req_4537): knob side is never the
  // hinge. No knob named → the historic min-X hinge stands, and the warn says
  // how to change it.
  const leafPart = resolveDoorLeafPart(parts);
  const hinge = leafPart.ok
    ? resolveDoorHinge(doc, leafPart.index)
    : { hingeMaxX: false as const, inferred: false as const, reason: 'no resolvable Door Leaf part' };
  if (hinge.inferred) {
    console.warn(`[authored-door] '${ap.label}' hinge inferred from the '${hinge.knobRegion}' region: ${hinge.hingeMaxX ? 'max-X edge (knob on the min side)' : 'min-X edge (knob on the max side)'}`);
  } else {
    console.warn(`[authored-door] '${ap.label}' hinge defaults to the min-X edge — ${hinge.reason}; Name Selection a 'knob' region to steer it`);
  }
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
    door: { leafSlot: 0, reachMeters: tuning.reachMeters, vehicle: tuning.vehicle, startOpen: false, ...(hinge.hingeMaxX ? { hingeMaxX: true } : {}) },
    collisionBoxes: compiled.mesh.collisionBoxes,
  };
}

/** Push the placed-piece world onto a mounted loader node: box instances, face
 *  skins, and authored mesh-prop refs. No-ops (loudly, when pieces exist) until
 *  the node id and the doors are live. */
export function pushLiveWorld(
  nodeId: number,
  pieces: readonly PlacedPiece[],
  authoredPieces?: readonly AuthoredBuildPiece[],
  worldFlora: readonly WorldFloraPatch[] = [],
  floraSpecies: readonly AuthoredFloraSpecies[] = [],
): boolean {
  if (!nodeId || typeof g.__compiled_world_set_live_pieces !== 'function') {
    if (pieces.length) console.warn(`[place] live push SKIPPED — node=${nodeId} door=${typeof g.__compiled_world_set_live_pieces}`);
    return false;
  }
  // Semantic wall collision (req_4473): engine-derived oriented collide-only
  // rows (r < 0) ride the same instance stream as piece boxes.
  const pieceRows = pieceInstanceRows(pieces);
  const wallRows = liveArchitectureCollideRows();
  let instanceRows = pieceRows;
  if (wallRows.length) {
    instanceRows = new Float32Array(pieceRows.length + wallRows.length);
    instanceRows.set(pieceRows, 0);
    instanceRows.set(wallRows, pieceRows.length);
  }
  g.__compiled_world_set_live_pieces(nodeId, instanceRows);
  if (typeof g.__compiled_world_set_live_lights === 'function') {
    const lights: WorldLight[] = [];
    for (const piece of pieces) {
      const authored = authoredPieceFrom(authoredPieces, piece.pieceId);
      if (!authored) continue;
      const pkg = modelPackageById(authored.pkgId);
      for (const light of normalizeModelLights(pkg?.lights)) {
        lights.push(placeModelLight(light, piece));
      }
    }
    g.__compiled_world_set_live_lights(nodeId, encodeLiveLights(lights));
  }
  // Real textures (req_2575 Stage B): faces wearing an assigned material push
  // their WGSL shader once, then a skin box per face so the loader samples it
  // over the flat live box. Unskinned faces stay flat. Doors gated behind their
  // presence so an older host without them still renders the flat geometry.
  const skin = pieceSkinBoxes(pieces);
  const liveMaterials = new Map<number, LiveMaterial>(skin.materials.map((material) => [material.hash, material]));
  if (typeof g.__compiled_world_set_live_skin_boxes === 'function') {
    g.__compiled_world_set_live_skin_boxes(nodeId, skin.boxes);
  }
  // Authored (mesh) pieces render via the live MESH-PROP path (req_2577): one
  // ref per placement pointing at its resident mesh by key. Real geometry.
  if (typeof g.__compiled_world_set_live_mesh_props === 'function') {
    const refs: MeshRef[] = [];
    for (const piece of pieces) {
      if (!isAuthoredPiece(piece.pieceId)) continue;
      const authored = authoredPieceFrom(authoredPieces, piece.pieceId);
      const authoredPackage = authored ? modelPackageById(authored.pkgId) : null;
      const slotDefs = authoredPackage?.textureSlots ?? authored?.textureSlots ?? [];
      const roleMaterials = slotDefs.map((slot) => {
        const ref = piece.slots?.[slot.id];
        if (!ref) return 0;
        const material = liveMaterialFor(ref);
        if (!material) return 0;
        liveMaterials.set(material.hash, material);
        return material.hash;
      });
      // A slot wearing a liveMaterial NEEDS the loader's per-slot split even
      // with no skins assigned (req_3425): the region binds to the ':slot-N'
      // node, and the host only splits when the ref carries a materials array
      // (runtime_live_scene line ~220). Zero hashes = the baked atlas look.
      const needsSlotSplit = roleMaterials.some((hash) => hash !== 0) || slotDefs.some((slot) => slot.liveMaterial);
      refs.push({
        key: authoredResidentKeyOf(piece.pieceId),
        x: piece.x, y: piece.y, z: piece.z, yaw: piece.yawDegrees,
        ...(piece.spinDegPerSec ? { spin: piece.spinDegPerSec } : {}),
        ...(piece.scale && piece.scale !== 1 ? { scale: piece.scale } : {}),
        ...(needsSlotSplit ? { materials: roleMaterials } : {}),
      });
    }
    // Graffiti facades (req_3057): baked paint quads ride the same ref stream —
    // world-space meshes, so the ref is identity.
    refs.push(...liveFacadeRefs());
    // Semantic walls (req_4473): engine-compiled render bands, identity refs.
    refs.push(...liveArchitectureRefs());
    refs.push(...surfaceFloraMeshRefs(pieces, worldFlora, floraSpecies));
    // Newest wire door first, presence-gated: v3 carries spin + uniform scale
    // (req_3367), v2 spin only (SPINPROP req_3128), v1 the bare transform. An
    // older host still draws everything — the missing fields just drop.
    if (typeof g.__compiled_world_set_live_mesh_props3 === 'function') {
      g.__compiled_world_set_live_mesh_props3(nodeId, encodeMeshRefsV3(refs));
    } else if (typeof g.__compiled_world_set_live_mesh_props2 === 'function') {
      if (refs.some((r) => r.scale && r.scale !== 1)) console.warn('[place] this host predates scaled props — rebuild the dev host to see their real size');
      g.__compiled_world_set_live_mesh_props2(nodeId, encodeMeshRefsV2(refs));
    } else {
      if (refs.some((r) => r.spin)) console.warn('[place] this host predates spinning props — rebuild the dev host to see them turn');
      g.__compiled_world_set_live_mesh_props(nodeId, encodeMeshRefs(refs));
    }
  }
  if (typeof g.__compiled_world_set_live_material === 'function') {
    for (const material of liveMaterials.values()) {
      g.__compiled_world_set_live_material(nodeId, material.hash, 0, material.wgsl, new Float32Array(material.data), material.opacity);
    }
  }
  pushLiveMaterialRegions(pieces, authoredPieces);
  return true;
}

/** Live material regions on placed props (req_3402/req_3423): a texture slot
 *  wearing a liveMaterial binds a region against the loader's per-slot geometry
 *  key — runtime_live_scene draws every slot as its own node keyed
 *  `<residentKey>:slot-N`, and that node's interned geometry IS the slot's
 *  triangle bucket (compileTextureSlotMesh), so the binding is simply every
 *  face of that node ([0..bucketTris)). The placed prop then renders the same
 *  object-space animated field the studio shows, host-side, per frame.
 *  Instances share the resident key, so one bind covers every placement of the
 *  same model (the region pool holds bindings per KEY, drawn per instance). */
function pushLiveMaterialRegions(pieces: readonly PlacedPiece[], authoredPieces?: readonly AuthoredBuildPiece[]): void {
  if (typeof g.__model_region_set !== 'function') return;
  const boundKeys = new Set<string>();
  const wantFns: string[] = [];
  const binds: { key: string; regionId: number; faces: Uint32Array; data: Float32Array }[] = [];
  for (const piece of pieces) {
    if (!isAuthoredPiece(piece.pieceId)) continue;
    const residentKey = authoredResidentKeyOf(piece.pieceId);
    if (boundKeys.has(residentKey)) continue;
    const authored = authoredPieceFrom(authoredPieces, piece.pieceId);
    const pkg = authored ? modelPackageById(authored.pkgId) : null;
    const slots = pkg?.textureSlots ?? authored?.textureSlots ?? [];
    if (!slots.some((slot) => slot.liveMaterial)) continue;
    boundKeys.add(residentKey);
    const mats = pkg ? packageMeshDoc(pkg)?.faceMaterials : null;
    if (!mats) continue; // no durable face-role table — nothing to scope a region to
    slots.forEach((slot, index) => {
      if (!slot.liveMaterial) return;
      let bucketTris = 0;
      for (let t = 0; t < mats.length; t += 1) if (mats[t] === index) bucketTris += 1;
      if (bucketTris === 0) return;
      const data = buildRegionData(slot.liveMaterial);
      if (!data) return; // unknown material fn — already loud
      const faces = new Uint32Array(bucketTris);
      for (let t = 0; t < bucketTris; t += 1) faces[t] = t;
      wantFns.push(slot.liveMaterial.fn);
      binds.push({ key: `${residentKey}:slot-${index}`, regionId: index, faces, data });
    });
  }
  if (binds.length === 0) return;
  // ONE formula shared with the studio pusher — union, never clobber.
  if (!ensureRegionFormula(wantFns)) return;
  let landed = 0;
  for (const bind of binds) {
    if (g.__model_region_set(bind.key, bind.regionId, bind.faces, bind.data) === 1) landed += 1;
    else console.error(`[live-regions] host REFUSED region bind '${bind.key}' (#${bind.regionId}, ${bind.faces.length} face(s))`);
  }
  // Every world push re-binds; only a CHANGED bind set is news (req_3566).
  const signature = `${landed}/${binds.length} ${binds.map((b) => `${b.key}#${b.regionId}x${b.faces.length}:${b.data.join(',')}`).join(' ')}`;
  if (signature === lastRegionBindSignature) return;
  lastRegionBindSignature = signature;
  console.warn(`[live-regions] ${landed}/${binds.length} placed-prop region(s) bound: ${binds.map((b) => b.key).join(', ')}`);
}

let lastRegionBindSignature = '';

/** Keep the authored meshes RESIDENT so their placements can draw (req_2577).
 *  Returns false while the loader node / door isn't up yet — callers retry. */
export function pushResidentMeshes(
  nodeId: number,
  authoredPieces: readonly AuthoredBuildPiece[],
  floraSpecies: readonly AuthoredFloraSpecies[] = [],
  builtinFloraSpeciesIds?: readonly string[],
): boolean {
  if (!nodeId || typeof g.__compiled_world_set_resident_meshes !== 'function') return false;
  const meshes: ResidentMesh[] = [];
  let painted = 0;
  let skins = 0;
  for (const ap of [...authoredPieces, ...customFloraResidentAdapters(floraSpecies)]) {
    const pkg = modelPackageById(ap.pkgId);
    const dir = pkg ? resolvePackageDir(pkg.kind, pkg.id) : null;
    const currentGeometry = authoredMeshData(ap.modelId, ap.pkgId);
    // An explicit paint-atlas compile rewrites only UV copies and keeps every
    // editable source file. All still-current compiled looks share this exact
    // Uint8Array, so the live catalog reads ONE package PNG for the whole model.
    const compiledPaint = pkg ? runtimeCompiledPaintAtlas(pkg) : null;
    const compiledPng = compiledPaint ? readPathBytes(compiledPaint.atlasPath) : undefined;
    // Geometry comes from the CURRENT model resolver; the paint-space blob
    // contributes its UV layout only (req_2832/2833). This keeps the rendered
    // resident mesh and placement bounds on one model revision.
    const compiledBaseVertices = dir && compiledPng && compiledPaint?.base
      ? readPaintedVertices(dir, compiledPaint.base.compiledMesh)
      : null;
    const paintedForm = compiledBaseVertices && compiledPng
      ? { vertices: compiledBaseVertices, png: compiledPng }
      : dir ? packagePaintedForm(dir) : null;
    const bound = currentGeometry && paintedForm
      ? bindPaintSkinToCurrentMesh(currentGeometry, paintedForm.vertices)
      : null;
    // req_3133: a painted form that CANNOT bind (vertex count ≠ doc) but whose
    // stamp matches the doc on disk is the DISPLAYED quality-decimated mesh the
    // user painted — the intended exported look. It becomes the render geometry
    // (ground-rebased like every placeable); the full-res doc keeps collision.
    // A mismatched/absent stamp stays the req_2832 rule: stale paint drops.
    const displayedForm = !bound && paintedForm && dir && ap.edit !== 'door' && ap.edit !== 'garageDoor' && paintedFormIsCurrent(dir)
      ? groundRebase(paintedForm.vertices)
      : null;
    const paintedVertices = bound ?? displayedForm ?? (currentGeometry ? null : paintedForm?.vertices ?? null);
    const verts = paintedVertices ?? currentGeometry;
    if (verts && verts.length >= 8) {
      if (paintedVertices && paintedForm) painted += 1;
      const resident = residentMeshFor(
        ap, pkg, ap.id, verts,
        paintedVertices ? paintedForm?.png : undefined,
        displayedForm && currentGeometry ? currentGeometry : undefined,
      );
      if (resident) meshes.push(resident);
    } else console.warn(`[authored] no mesh data for '${ap.modelId}' (${ap.label}) — not resident (re-open + re-export the model)`);
    // Every stored paint SKIN is its own resident mesh (req_2834): key
    // `<modelId>#p<skinId>` — the same key a skinned placeable id resolves to,
    // so skinned ghosts/placements/colliders draw that painting. Its saved blob
    // owns UVs, not historical positions: bind it onto currentGeometry.
    if (pkg && dir) {
      for (const skin of listPaintSkins(pkg)) {
        const compiledEntry = compiledPaint?.variants.get(skin.id);
        const compiledVertices = compiledPng && compiledEntry
          ? readPaintedVertices(dir, compiledEntry.compiledMesh)
          : null;
        const form = compiledVertices && compiledPng
          ? { vertices: compiledVertices, png: compiledPng }
          : readPaintedForm(dir, `paints/paint_${skin.id}.blob`, `paints/paint_${skin.id}.png`);
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
  meshes.push(...builtinSurfaceFloraResidentMeshes(
    builtinFloraSpeciesIds ? new Set(builtinFloraSpeciesIds) : undefined,
  ));
  meshes.push(...liveFacadeResidentMeshes()); // graffiti facade quads (req_3057)
  meshes.push(...liveArchitectureResidentMeshes()); // semantic wall bands (req_4473)
  g.__compiled_world_set_resident_meshes(nodeId, encodeResidentMeshes(meshes));
  console.warn(`[authored] resident catalog: ${meshes.length} mesh(es) — ${painted} painted, ${skins} paint skin(s) -> loader node ${nodeId}`);
  return true;
}
