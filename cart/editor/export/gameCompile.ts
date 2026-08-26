import { mkdir, readFileBase64, writeFile, writeFileBytesAtomic } from '../../../runtime/hooks/fs';
import { base64ToBytes, encodeBinaryRleGrid, MAP_LUMP, textBytes, writeLumpContainer } from '../../../runtime/workspace/lumps';
import { encodeGrid } from '../../../runtime/workspace/rle';
import { writeGameFile } from '../../../runtime/workspace/gamefile';
import { mapChunkList, mapGroundFormula, mapReadFloor, mapReadGroundData } from '../../../runtime/game/map';
import { modelPackageById } from '../data/content';
import { packageMeshDoc, packageMeshDocParts } from '../data/assetCatalog';
import { resolvePackageDir } from '../data/modelPackageStore';
import type { WorldSave } from '../data/worldStore';
import { meshSemanticBlueprint } from '../model/meshSemantics';
import { authoredPieceFor, isAuthoredPiece } from '../world/authoredRegistry';
import { liveArchitectureCollideRows, liveArchitectureRefs, liveArchitectureResidentMeshes, setLiveArchitecture } from '../world/architectureBake';
import { pieceInstanceRows, pieceScaleOf, type PlacedPiece } from '../world/pieces';
import { validateRaceMarkers } from '../world/worldMarkers';
import { buildFartRacerAudioExport } from './fartRacerAudio';
import { encodeFartRacerLogic, validateDriveThruBlueprints, type BakedBlueprint } from './fartRacerWire';
import { loadFartRacerTarget, validateVehicleRatingDistribution } from './fartRacerTarget';
import { encodeFormulaHeightfields, GROUND_FLOOR_RES, GROUND_FLOOR_SAMPLES, type FormulaHeightfield } from './heightfieldExport';
import { isFartRacerVehicleVisual, partitionFartRacerVehicleMesh, type VehiclePartSlot } from './fartRacerVehicleVisual';

export const FART_RACER_EXPORT_ROOT = 'zig-out/game/fart-racer.data';
export const FART_RACER_GAMEFILE = `${FART_RACER_EXPORT_ROOT}/game.gamefile`;
export const FART_RACER_EXPORT_MANIFEST = `${FART_RACER_EXPORT_ROOT}/export.json`;
export const FART_RACER_AUDIO_MANIFEST = `${FART_RACER_EXPORT_ROOT}/audio.json`;
export const FART_RACER_GENERATED_ENTRY = 'zig-out/game/.generated/fart-racer/index.tsx';
export const FART_RACER_OUTPUT = 'zig-out/game/fart-racer';

export type GameCompileResult = Readonly<{
  gameFile: string;
  manifest: string;
  generatedEntry: string;
  instanceRows: number;
  terrainChunks: number;
  blueprintPackages: number;
  audioClips: number;
}>;

function encodeInstances(rows: Float32Array, pieceRows: number): Uint8Array {
  const stride = 12;
  if (rows.length % stride !== 0) throw new Error('export instance rows are not stride-12');
  const count = rows.length / stride;
  const out = new Uint8Array(12 + rows.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, count, true);
  view.setUint32(4, stride, true);
  view.setUint32(8, Math.min(pieceRows, count), true);
  out.set(new Uint8Array(rows.buffer, rows.byteOffset, rows.byteLength), 12);
  return out;
}

export function encodeHeightfields(color: readonly [number, number, number], walkableSlopeDegrees: number): { bytes: Uint8Array; chunks: number } {
  const formula = mapGroundFormula();
  if (!formula) throw new Error('Fart Racer export requires the native ground formula');
  const fields = mapChunkList().chunks.map(({ cx, cz }) => ({
    cx,
    cz,
    heights: mapReadFloor(cx, cz),
    groundData: mapReadGroundData(cx, cz),
  }));
  for (const field of fields) {
    if (field.heights?.length !== GROUND_FLOOR_SAMPLES) {
      throw new Error(`map chunk ${field.cx},${field.cz} is missing its ${GROUND_FLOOR_RES}x${GROUND_FLOOR_RES} rendered floor mirror`);
    }
    if (!field.groundData?.length) throw new Error(`map chunk ${field.cx},${field.cz} is missing its native ground/road stream`);
  }
  return {
    bytes: encodeFormulaHeightfields(textBytes(formula), fields as FormulaHeightfield[], color, walkableSlopeDegrees),
    chunks: fields.length,
  };
}

function hexColor(value: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(value);
  const packed = match ? Number.parseInt(match[1]!, 16) : 0x999999;
  return [((packed >>> 16) & 255) / 255, ((packed >>> 8) & 255) / 255, (packed & 255) / 255];
}

type MeshRow = Readonly<{
  key: string;
  vertices: Float32Array;
  color: readonly [number, number, number];
  png: Uint8Array | null;
  slots: readonly VehiclePartSlot[];
  solid: boolean;
  /** Whether the mesh declares its own conservative collision box. The city's
   *  wall meshes already collide through their oriented rows in the INSTANCES
   *  lump; a second, city-sized box around all of them would brick the map. */
  collisionBox: boolean;
}>;

type MeshInstanceRow = Readonly<{ mesh: number; x: number; y: number; z: number; yawDegrees: number }>;

function scaledMesh(vertices: Float32Array, scale: number): Float32Array {
  if (scale === 1) return vertices;
  const out = vertices.slice();
  for (let index = 0; index + 7 < out.length; index += 8) {
    out[index] *= scale;
    out[index + 1] *= scale;
    out[index + 2] *= scale;
  }
  return out;
}

function meshBounds(vertices: Float32Array): { radius: number; width: number; depth: number; height: number; box: readonly number[] } {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let index = 0; index + 7 < vertices.length; index += 8) {
    minX = Math.min(minX, vertices[index]); maxX = Math.max(maxX, vertices[index]);
    minY = Math.min(minY, vertices[index + 1]); maxY = Math.max(maxY, vertices[index + 1]);
    minZ = Math.min(minZ, vertices[index + 2]); maxZ = Math.max(maxZ, vertices[index + 2]);
  }
  if (!Number.isFinite(minX)) return { radius: 0, width: 0, depth: 0, height: 0, box: [0, 0, 0, 0, 0, 0] };
  const radius = Math.max(Math.hypot(minX, minY, minZ), Math.hypot(maxX, maxY, maxZ));
  return { radius, width: maxX - minX, depth: maxZ - minZ, height: maxY - minY, box: [minX, minY, minZ, maxX, maxY, maxZ] };
}

/** MESH_PROPS v8: enough of the production append-only wire to carry Studio
 * meshes, their atlas, authored placement transforms, and conservative bounds. */
function encodeAuthoredMeshes(pieces: readonly PlacedPiece[], visualVehiclePackageId: string | null): Uint8Array | null {
  const meshes: MeshRow[] = [];
  const meshIndex = new Map<string, number>();
  const instances: MeshInstanceRow[] = [];
  for (const piece of pieces) {
    if (!isAuthoredPiece(piece.pieceId)) continue;
    const authored = authoredPieceFor(piece.pieceId);
    const pkg = authored ? modelPackageById(authored.pkgId) : null;
    const doc = pkg ? packageMeshDoc(pkg) : null;
    const parts = pkg ? packageMeshDocParts(pkg) : null;
    if (!authored || !pkg || !doc?.vertices.length) continue;
    const scale = pieceScaleOf(piece);
    const key = `${authored.pkgId}@${scale}`;
    let index = meshIndex.get(key);
    if (index === undefined) {
      const packageDir = resolvePackageDir(pkg.kind, pkg.id);
      const atlas = packageDir ? readFileBase64(`${packageDir}/atlases/base.png`) : null;
      index = meshes.length;
      meshIndex.set(key, index);
      const visualVehicle = authored.pkgId === visualVehiclePackageId;
      const partitioned = visualVehicle ? partitionFartRacerVehicleMesh(doc, parts) : null;
      meshes.push({
        key,
        vertices: scaledMesh(partitioned?.vertices ?? doc.vertices, scale),
        color: hexColor(pkg.color),
        png: atlas ? base64ToBytes(atlas) : null,
        slots: partitioned?.slots ?? [],
        solid: !visualVehicle,
        collisionBox: true,
      });
    }
    instances.push({ mesh: index, x: piece.x, y: piece.y, z: piece.z, yawDegrees: piece.yawDegrees });
  }

  // The authored city. Its wall shells are architecture, not placed pieces, and
  // the live bake already resolved them to world-space meshes — the same ones
  // the editor draws. Without this the exported game inherits their colliders
  // from the INSTANCES lump and renders nothing: invisible buildings you crash
  // into. Collision stays with those rows; these meshes are look only.
  const architecture = liveArchitectureResidentMeshes();
  const architectureRefs = liveArchitectureRefs();
  for (const ref of architectureRefs) {
    const mesh = architecture.find((row) => row.key === ref.key);
    if (!mesh?.vertices.length) continue;
    let index = meshIndex.get(mesh.key);
    if (index === undefined) {
      index = meshes.length;
      meshIndex.set(mesh.key, index);
      meshes.push({
        key: mesh.key,
        vertices: mesh.vertices,
        color: mesh.color ?? [0.74, 0.73, 0.7],
        png: mesh.png ?? null,
        slots: [],
        solid: false,
        collisionBox: false,
      });
    }
    instances.push({ mesh: index, x: ref.x, y: ref.y, z: ref.z, yawDegrees: ref.yaw });
  }

  if (meshes.length === 0) return null;
  const keys = meshes.map((mesh) => textBytes(mesh.key));
  const bounds = meshes.map((mesh) => meshBounds(mesh.vertices));
  let byteLength = 12;
  meshes.forEach((mesh, index) => {
    byteLength += 4 + keys[index]!.byteLength + 36 + mesh.vertices.byteLength + 4 + (mesh.png?.byteLength ?? 0) + 4 + mesh.slots.length * 8 + 4 + 4 + (mesh.collisionBox ? 24 : 0);
  });
  instances.forEach(({ mesh }) => { byteLength += 24 + meshes[mesh]!.slots.length * 4; });
  const out = new Uint8Array(byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, 8, true);
  view.setUint32(4, meshes.length, true);
  view.setUint32(8, instances.length, true);
  let at = 12;
  meshes.forEach((mesh, index) => {
    const key = keys[index]!;
    const bound = bounds[index]!;
    view.setUint32(at, key.byteLength, true); at += 4;
    out.set(key, at); at += key.byteLength;
    mesh.color.forEach((value, channel) => view.setFloat32(at + channel * 4, value, true));
    view.setFloat32(at + 12, bound.radius, true);
    view.setFloat32(at + 16, bound.width, true);
    view.setFloat32(at + 20, bound.depth, true);
    view.setFloat32(at + 24, bound.height, true);
    view.setUint32(at + 28, mesh.solid ? 1 : 0, true);
    view.setUint32(at + 32, mesh.vertices.length / 8, true);
    at += 36;
    out.set(new Uint8Array(mesh.vertices.buffer, mesh.vertices.byteOffset, mesh.vertices.byteLength), at); at += mesh.vertices.byteLength;
    view.setUint32(at, mesh.png?.byteLength ?? 0, true); at += 4;
    if (mesh.png) { out.set(mesh.png, at); at += mesh.png.byteLength; }
    view.setUint32(at, mesh.slots.length, true); at += 4;
    mesh.slots.forEach((slot) => {
      view.setUint32(at, slot.start, true);
      view.setUint32(at + 4, slot.count, true);
      at += 8;
    });
    view.setUint32(at, 0, true); at += 4; // door
    // v7 authored collider boxes: a COUNT and then that many boxes. Writing a
    // box behind a zero count desyncs every mesh after it (error.BadMeshProps).
    view.setUint32(at, mesh.collisionBox ? 1 : 0, true); at += 4;
    if (mesh.collisionBox) {
      bound.box.forEach((value, offset) => view.setFloat32(at + offset * 4, value, true));
      at += 24;
    }
  });
  instances.forEach(({ mesh, x, y, z, yawDegrees }) => {
    view.setUint32(at, mesh, true);
    view.setFloat32(at + 4, x, true);
    view.setFloat32(at + 8, y, true);
    view.setFloat32(at + 12, z, true);
    view.setFloat32(at + 16, yawDegrees, true);
    view.setUint32(at + 20, 0, true);
    at += 24;
    meshes[mesh]!.slots.forEach(() => { view.setUint32(at, 0, true); at += 4; });
  });
  return out;
}

/** The placed package whose mesh is the car you SEE. The game target NAMES it;
 *  falling back to "the first placed piece that happens to satisfy the schema"
 *  makes the shipped car depend on placement order. */
function fartRacerVisualPackageId(pieces: readonly PlacedPiece[], declared: string | null): string | null {
  let fallback: string | null = null;
  for (const piece of pieces) {
    const authored = authoredPieceFor(piece.pieceId);
    const pkg = authored ? modelPackageById(authored.pkgId) : null;
    const doc = pkg ? packageMeshDoc(pkg) : null;
    const parts = pkg ? packageMeshDocParts(pkg) : null;
    if (!authored || !isFartRacerVehicleVisual(doc, parts)) continue;
    if (authored.pkgId === declared) return authored.pkgId;
    fallback ??= authored.pkgId;
  }
  if (declared) {
    throw new Error(fallback
      ? `the game target's visual vehicle ${declared} is not placed in this world; ${fallback} is`
      : `the game target's visual vehicle ${declared} is not placed in this world, and nothing placed satisfies the vehicle schema`);
  }
  return fallback;
}

function collectBlueprints(pieces: readonly PlacedPiece[], rosterPackageIds: readonly string[]): BakedBlueprint[] {
  const rows: BakedBlueprint[] = [];
  const seen = new Set<string>();
  const packageIds = [
    ...rosterPackageIds,
    ...pieces.map((piece) => authoredPieceFor(piece.pieceId)?.pkgId).filter((id): id is string => Boolean(id)),
  ];
  for (const packageId of packageIds) {
    if (seen.has(packageId)) continue;
    seen.add(packageId);
    const pkg = modelPackageById(packageId);
    const blueprint = pkg ? meshSemanticBlueprint(packageMeshDoc(pkg)?.semanticTable) : null;
    if (blueprint) rows.push({ packageId, modelId: pkg!.id, blueprint });
  }
  return rows;
}

export function bakeFartRacerExportWithBlueprints(
  world: WorldSave,
  blueprints: readonly BakedBlueprint[],
  openingDepthsU: Readonly<Record<string, number>> = {},
): GameCompileResult {
  const target = loadFartRacerTarget();
  const markerValidation = validateRaceMarkers(world.markers);
  if (!markerValidation.ok) throw new Error(`Fart Racer markers are not exportable: ${markerValidation.reason}`);
  const driveThruValidation = validateDriveThruBlueprints(blueprints, world.markers);
  if (!driveThruValidation.ok) throw new Error(`Fart Racer drive-thrus are not exportable: ${driveThruValidation.reason}`);
  const ratingRows = blueprints.flatMap((entry) => entry.blueprint.stats
    .filter((attachment) => attachment.profile.id === 'rj.profile.vehicle')
    .map((attachment) => ({
      id: entry.packageId,
      topSpeedRating: Number(attachment.topSpeedRating),
      accelerationRating: Number(attachment.accelerationRating),
    })));
  const distribution = validateVehicleRatingDistribution(target, ratingRows);
  if (!distribution.ok) throw new Error(`Fart Racer vehicle distribution is not exportable: ${distribution.reason}`);
  if (!mkdir(FART_RACER_EXPORT_ROOT) || !mkdir('zig-out/game/.generated/fart-racer')) {
    throw new Error('could not create Fart Racer export directories');
  }
  const pieceRows = pieceInstanceRows(world.pieces);
  // Bake the SAVE's walls, not whatever the viewport happened to leave resident.
  // The bake is identity-cached, so an already-current world costs nothing and a
  // map exported without ever being looked at still ships its buildings. What
  // must never happen is shipping wall colliders with no wall geometry — an
  // invisible city you crash into — so a bake that produces nothing is fatal.
  if (world.architecture.walls.edges.length > 0) {
    setLiveArchitecture(world.architecture, openingDepthsU, world.finishes);
    if (liveArchitectureResidentMeshes().length === 0) {
      throw new Error(`the map's ${world.architecture.walls.edges.length} wall edge(s) produced no geometry — the architecture host capability is absent from this build`);
    }
  }
  const architectureRows = new Float32Array(liveArchitectureCollideRows());
  const rows = new Float32Array(pieceRows.length + architectureRows.length);
  rows.set(pieceRows, 0);
  rows.set(architectureRows, pieceRows.length);
  const heightfields = encodeHeightfields(target.world.terrainColor, target.world.walkableSlopeDegrees);
  const visualVehiclePackageId = fartRacerVisualPackageId(world.pieces, target.visualVehiclePackageId);
  const logic = encodeFartRacerLogic(target, blueprints, world.markers, visualVehiclePackageId);
  const audio = buildFartRacerAudioExport(blueprints, world.markers);
  if (!mkdir(`${FART_RACER_EXPORT_ROOT}/audio`)) throw new Error('could not create Fart Racer audio export directory');
  for (const asset of audio.assets) {
    const pkg = modelPackageById(asset.packageId);
    const packageDir = pkg ? resolvePackageDir(pkg.kind, pkg.id) : null;
    const encoded = packageDir ? readFileBase64(`${packageDir}/audio/${asset.slug}.wav`) : null;
    if (!encoded) throw new Error(`${asset.packageId} is missing referenced package WAV audio/${asset.slug}.wav`);
    if (!writeFileBytesAtomic(`${FART_RACER_EXPORT_ROOT}/${asset.outputPath}`, base64ToBytes(encoded))) {
      throw new Error(`failed to export ${asset.packageId} audio/${asset.slug}.wav`);
    }
  }
  if (!writeFile(FART_RACER_AUDIO_MANIFEST, `${JSON.stringify(audio.manifest, null, 2)}\n`)) {
    throw new Error(`failed to write ${FART_RACER_AUDIO_MANIFEST}`);
  }
  const mapLumps = [
    { type: MAP_LUMP.TILES, encoding: 'rle8' as const, data: encodeBinaryRleGrid(encodeGrid([null], 1, 1), 8) },
    { type: MAP_LUMP.INSTANCES, encoding: 'raw' as const, data: encodeInstances(rows, pieceRows.length / 12) },
    { type: MAP_LUMP.HEIGHTFIELDS, encoding: 'raw' as const, data: heightfields.bytes },
  ];
  const meshProps = encodeAuthoredMeshes(world.pieces, visualVehiclePackageId);
  if (meshProps) mapLumps.push({ type: MAP_LUMP.MESH_PROPS, encoding: 'raw', data: meshProps });
  const gameFile = writeGameFile({
    logic: { refs: [], data: logic },
    map: { refs: [], data: writeLumpContainer(mapLumps) },
    skins: { refs: [], data: textBytes(JSON.stringify({ version: 1, blueprints })) },
    assets: [],
  });
  if (!writeFileBytesAtomic(FART_RACER_GAMEFILE, gameFile)) throw new Error(`failed to write ${FART_RACER_GAMEFILE}`);

  const generated = `// Generated by the editor's Fart Racer exporter. Do not edit.\nimport { createElement } from 'react';\nimport { exists } from '../../../../runtime/hooks/fs';\nimport { ExportedGame } from '../../../../runtime/game/exportedGame';\nimport { resolveExportedGameDataPaths } from '../../../../runtime/game/exportedGamePaths';\nexport default function FartRacerExport() {\n  const paths = resolveExportedGameDataPaths('fart-racer', exists);\n  return createElement(ExportedGame, { ...paths, gameId: 'fart-racer' });\n}\n`;
  if (!writeFile(FART_RACER_GENERATED_ENTRY, generated)) throw new Error(`failed to write ${FART_RACER_GENERATED_ENTRY}`);
  const manifest = {
    version: 1,
    id: 'fart-racer',
    name: 'Fart Racer',
    gameFile: FART_RACER_GAMEFILE,
    audioManifest: FART_RACER_AUDIO_MANIFEST,
    dataRoot: FART_RACER_EXPORT_ROOT,
    generatedEntry: FART_RACER_GENERATED_ENTRY,
    output: FART_RACER_OUTPUT,
    nativeInputs: [
      'build.zig',
      'framework/v8_app.zig',
      'framework/v8_bindings_audio.zig',
      'framework/v8_bindings_compiled_world.zig',
      'framework/world_loader.zig',
      'framework/world_loader/runtime.zig',
      'framework/world_loader/runtime_lifecycle.zig',
      'framework/world_loader/runtime_stream.zig',
      'framework/world_loader/scene_build.zig',
      'framework/world_loader/physics.zig',
      'framework/world_loader/fart_racer_runtime.zig',
      'framework/world/constructor.zig',
      'framework/audio/api.zig',
      'framework/audio/types.zig',
      'framework/audio/world_emitters.zig',
      'framework/game/driving.zig',
      'framework/game/physics.zig',
      'framework/games/custom/fart-racer/application_report.zig',
      'framework/games/custom/fart-racer/acceptance.zig',
      'framework/games/custom/fart-racer/sim.zig',
      'framework/games/custom/fart-racer/wire.zig',
      'runtime/game/exportedGame.tsx',
      'runtime/game/exportedGamePaths.ts',
      'runtime/game/fartRacerAudio.ts',
      'cli/commands/game.ts',
      'cli/commands/ship.ts',
    ],
  };
  if (!writeFile(FART_RACER_EXPORT_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)) {
    throw new Error(`failed to write ${FART_RACER_EXPORT_MANIFEST}`);
  }
  return {
    gameFile: FART_RACER_GAMEFILE,
    manifest: FART_RACER_EXPORT_MANIFEST,
    generatedEntry: FART_RACER_GENERATED_ENTRY,
    instanceRows: rows.length / 12,
    terrainChunks: heightfields.chunks,
    blueprintPackages: blueprints.length,
    audioClips: audio.assets.length,
  };
}

export function bakeFartRacerExport(
  world: WorldSave,
  openingDepthsU: Readonly<Record<string, number>> = {},
): GameCompileResult {
  const target = loadFartRacerTarget();
  return bakeFartRacerExportWithBlueprints(world, collectBlueprints(world.pieces, target.vehicleRosterPackageIds), openingDepthsU);
}
