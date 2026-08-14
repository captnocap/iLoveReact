import type { FloraKind, FloraLane } from './floraKinds';
import { FLORA_KIND_DEFINITIONS } from './floraKinds';
import { modelPackageMeshData, packageMeshDoc } from '../data/assetCatalog';
import { modelPackageById } from '../data/content';
import { authoredMeshData } from './authoredMesh';
import { authoredPieceFrom, type AuthoredBuildPiece } from './authoredRegistry';
import type { PlacedPiece } from './pieces';
import type { AuthoredFloraSpecies } from './floraSpecies';
import type { MeshRef, ResidentMesh } from './meshProps';
import type { ModelFacePurpose } from '../data/types';
import { normalizeModelFacePurpose } from '../model/modelTextureSlotAuthoring';

export const SURFACE_FLORA_TUNING = Object.freeze({
  maxPatchesPerPiece: 2_048,
  maxWorldPatches: 8_192,
  maxRenderedInstances: 24_000,
  minimumUpwardNormal: 0.2,
  surfaceOffsetM: 0.025,
  sampleKeyMeters: 0.2,
  maxInstancesPerDab: { grass: 12, tree: 2, bush: 6 } satisfies Readonly<Record<FloraLane, number>>,
});

export function builtinFloraSpeciesId(kind: FloraKind): string {
  return `builtin-flora:${kind}`;
}

export function builtinFloraKindFromId(id: string): FloraKind | null {
  return id.startsWith('builtin-flora:') ? id.slice('builtin-flora:'.length) as FloraKind : null;
}

/** A compact source recipe attached to its parent piece. Geometry is derived. */
export type SurfaceFloraPatch = {
  id: string;
  speciesId: string;
  role: string;
  triangle: number;
  lx: number;
  ly: number;
  lz: number;
  density: number;
  radiusM: number;
  seed: number;
};

/** Custom flora painted on terrain. Built-ins remain in the native RMAP. */
export type WorldFloraPatch = {
  id: string;
  speciesId: string;
  x: number;
  y: number;
  z: number;
  density: number;
  radiusM: number;
  seed: number;
};

export type FloraSurfaceSample = {
  kind: 'surface';
  pieceId: string;
  role: string;
  triangle: number;
  lx: number;
  ly: number;
  lz: number;
};

export type FloraGroundSample = { kind: 'ground'; x: number; y: number; z: number };
export type FloraPaintSample = FloraSurfaceSample | FloraGroundSample;

export type WorldFloraBrush = {
  speciesId: string;
  mode: 'paint' | 'erase';
  density: number;
  radiusM: number;
};

type Vec3 = { x: number; y: number; z: number };

type RiggedTriangle = {
  triangle: number;
  role: string;
  purpose: ModelFacePurpose;
  a: Vec3;
  b: Vec3;
  c: Vec3;
  nx: number;
  ny: number;
  nz: number;
};

type RiggedTriangleCache = {
  vertices: Float32Array;
  faceMaterials: Uint32Array;
  slotSignature: string;
  all: readonly RiggedTriangle[];
  byPurpose: Readonly<Record<ModelFacePurpose, readonly RiggedTriangle[]>>;
};

const riggedTriangleCache = new Map<string, RiggedTriangleCache>();

function riggedTrianglesFor(
  packageId: string,
  vertices: Float32Array,
  faceMaterials: Uint32Array,
  slots: readonly { id: string; purpose?: unknown }[],
): RiggedTriangleCache {
  const slotSignature = slots.map((slot) => `${slot.id}:${normalizeModelFacePurpose(slot.purpose)}`).join('|');
  const prior = riggedTriangleCache.get(packageId);
  if (prior?.vertices === vertices && prior.faceMaterials === faceMaterials && prior.slotSignature === slotSignature) return prior;
  const byPurpose: Record<ModelFacePurpose, RiggedTriangle[]> = { material: [], screen: [], flora: [] };
  const all: RiggedTriangle[] = [];
  const triangleCount = Math.min(faceMaterials.length, Math.floor(vertices.length / 24));
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const slot = slots[faceMaterials[triangle]!];
    if (!slot) continue;
    const at = triangle * 24;
    const a = { x: vertices[at]!, y: vertices[at + 1]!, z: vertices[at + 2]! };
    const b = { x: vertices[at + 8]!, y: vertices[at + 9]!, z: vertices[at + 10]! };
    const c = { x: vertices[at + 16]!, y: vertices[at + 17]!, z: vertices[at + 18]! };
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z;
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const length = Math.hypot(nx, ny, nz);
    if (length <= 1e-8) continue;
    nx /= length; ny /= length; nz /= length;
    const purpose = normalizeModelFacePurpose(slot.purpose);
    const row = { triangle, role: slot.id, purpose, a, b, c, nx, ny, nz };
    all.push(row);
    byPurpose[purpose].push(row);
  }
  const next = { vertices, faceMaterials, slotSignature, all, byPurpose };
  riggedTriangleCache.set(packageId, next);
  return next;
}

export type FloraSurfaceHit = FloraSurfaceSample & {
  t: number;
  nx: number;
  ny: number;
  nz: number;
};

export type RiggedModelSurfaceHit = FloraSurfaceHit & { purpose: ModelFacePurpose };

/** Möller–Trumbore ray/triangle boundary, exported for focused geometry tests. */
export function rayTriangleIntersection(
  origin: Vec3,
  direction: Vec3,
  a: Vec3,
  b: Vec3,
  c: Vec3,
  maxDistance: number,
): { t: number; u: number; v: number } | null {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z;
  const px = direction.y * acz - direction.z * acy;
  const py = direction.z * acx - direction.x * acz;
  const pz = direction.x * acy - direction.y * acx;
  const determinant = abx * px + aby * py + abz * pz;
  if (Math.abs(determinant) < 1e-8) return null;
  const inverse = 1 / determinant;
  const tx = origin.x - a.x, ty = origin.y - a.y, tz = origin.z - a.z;
  const u = (tx * px + ty * py + tz * pz) * inverse;
  if (u < 0 || u > 1) return null;
  const qx = ty * abz - tz * aby;
  const qy = tz * abx - tx * abz;
  const qz = tx * aby - ty * abx;
  const v = (direction.x * qx + direction.y * qy + direction.z * qz) * inverse;
  if (v < 0 || u + v > 1) return null;
  const t = (acx * qx + acy * qy + acz * qz) * inverse;
  return t >= 0 && t <= maxDistance ? { t, u, v } : null;
}

/** Exact authored-triangle hit on a named Rig face role. */
export function pickRiggedModelSurface(
  ray: { origin: Vec3; dir: Vec3 },
  pieces: readonly PlacedPiece[],
  authoredPieces: readonly AuthoredBuildPiece[],
  maxDistance = 1_000,
  purpose?: ModelFacePurpose,
): RiggedModelSurfaceHit | null {
  let best: RiggedModelSurfaceHit | null = null;
  for (const piece of pieces) {
    const authored = authoredPieceFrom(authoredPieces, piece.pieceId);
    if (!authored) continue;
    const pkg = modelPackageById(authored.pkgId);
    const slots = pkg?.textureSlots ?? authored.textureSlots ?? [];
    if (purpose && !slots.some((slot) => normalizeModelFacePurpose(slot.purpose) === purpose)) continue;
    const doc = pkg ? packageMeshDoc(pkg) : null;
    const vertices = authoredMeshData(authored.modelId, authored.pkgId);
    if (!vertices || !doc?.faceMaterials) continue;
    const cache = riggedTrianglesFor(authored.pkgId, vertices, doc.faceMaterials, slots);
    const triangles = purpose ? cache.byPurpose[purpose] : cache.all;
    const yaw = piece.yawDegrees * Math.PI / 180;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const ox = ray.origin.x - piece.x, oy = ray.origin.y - piece.y, oz = ray.origin.z - piece.z;
    // Renderer local→world yaw is [x*c + z*s, -x*s + z*c]. Apply its
    // transpose here so exact Rig-face picking follows the visible mesh.
    const localOrigin = { x: ox * cos - oz * sin, y: oy, z: ox * sin + oz * cos };
    const localDirection = { x: ray.dir.x * cos - ray.dir.z * sin, y: ray.dir.y, z: ray.dir.x * sin + ray.dir.z * cos };
    for (const triangle of triangles) {
      const hit = rayTriangleIntersection(localOrigin, localDirection, triangle.a, triangle.b, triangle.c, best?.t ?? maxDistance);
      if (!hit) continue;
      if (triangle.purpose === 'flora' && triangle.ny < SURFACE_FLORA_TUNING.minimumUpwardNormal) continue;
      const w = 1 - hit.u - hit.v;
      best = {
        kind: 'surface',
        pieceId: piece.id,
        role: triangle.role,
        triangle: triangle.triangle,
        lx: triangle.a.x * w + triangle.b.x * hit.u + triangle.c.x * hit.v,
        ly: triangle.a.y * w + triangle.b.y * hit.u + triangle.c.y * hit.v,
        lz: triangle.a.z * w + triangle.b.z * hit.u + triangle.c.z * hit.v,
        t: hit.t,
        nx: triangle.nx,
        ny: triangle.ny,
        nz: triangle.nz,
        purpose: triangle.purpose,
      };
    }
  }
  return best;
}

/** Exact authored-triangle hit restricted to faces rigged for flora. */
export function pickRiggedFloraSurface(
  ray: { origin: Vec3; dir: Vec3 },
  pieces: readonly PlacedPiece[],
  authoredPieces: readonly AuthoredBuildPiece[],
  maxDistance = 1_000,
): FloraSurfaceHit | null {
  const hit = pickRiggedModelSurface(ray, pieces, authoredPieces, maxDistance, 'flora');
  if (!hit) return null;
  const { purpose: _purpose, ...flora } = hit;
  return flora;
}

export function floraPaintSampleKey(sample: FloraPaintSample): string {
  const q = (value: number) => Math.round(value / SURFACE_FLORA_TUNING.sampleKeyMeters);
  return sample.kind === 'surface'
    ? `${sample.pieceId}:${sample.role}:${sample.triangle}:${q(sample.lx)}:${q(sample.ly)}:${q(sample.lz)}`
    : `ground:${q(sample.x)}:${q(sample.y)}:${q(sample.z)}`;
}

function clampDensity(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
}

function patchDistanceSquared(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function applyFloraPaintSamples(
  pieces: readonly PlacedPiece[],
  worldFlora: readonly WorldFloraPatch[],
  samples: readonly FloraPaintSample[],
  brush: WorldFloraBrush,
  sequence: number,
): { pieces: PlacedPiece[]; worldFlora: WorldFloraPatch[]; sequence: number; added: number; removed: number } {
  const unique = [...new Map(samples.map((sample) => [floraPaintSampleKey(sample), sample])).values()];
  const surfaceByPiece = new Map<string, FloraSurfaceSample[]>();
  const ground: FloraGroundSample[] = [];
  for (const sample of unique) {
    if (sample.kind === 'ground') ground.push(sample);
    else surfaceByPiece.set(sample.pieceId, [...(surfaceByPiece.get(sample.pieceId) ?? []), sample]);
  }
  let nextSequence = sequence;
  let added = 0;
  let removed = 0;
  const nextPieces = pieces.map((piece) => {
    const targets = surfaceByPiece.get(piece.id);
    if (!targets?.length) return piece;
    if (brush.mode === 'erase') {
      const before = piece.surfaceFlora ?? [];
      const kept = before.filter((patch) => !targets.some((target) => target.role === patch.role
        && patchDistanceSquared({ x: patch.lx, y: patch.ly, z: patch.lz }, { x: target.lx, y: target.ly, z: target.lz }) <= brush.radiusM * brush.radiusM));
      removed += before.length - kept.length;
      return kept.length === before.length ? piece : { ...piece, surfaceFlora: kept.length ? kept : undefined };
    }
    const room = Math.max(0, SURFACE_FLORA_TUNING.maxPatchesPerPiece - (piece.surfaceFlora?.length ?? 0));
    const additions = targets.slice(0, room).map((target): SurfaceFloraPatch => {
      const id = `surface-flora-${nextSequence++}`;
      added += 1;
      return {
        id,
        speciesId: brush.speciesId,
        role: target.role,
        triangle: target.triangle,
        lx: target.lx,
        ly: target.ly,
        lz: target.lz,
        density: clampDensity(brush.density),
        radiusM: brush.radiusM,
        seed: nextSequence * 2654435761 >>> 0,
      };
    });
    return additions.length ? { ...piece, surfaceFlora: [...(piece.surfaceFlora ?? []), ...additions] } : piece;
  });

  let nextWorld = worldFlora.slice();
  if (brush.mode === 'erase') {
    const before = nextWorld.length;
    nextWorld = nextWorld.filter((patch) => !ground.some((target) => {
      const dx = patch.x - target.x, dz = patch.z - target.z;
      return dx * dx + dz * dz <= brush.radiusM * brush.radiusM;
    }));
    removed += before - nextWorld.length;
  } else {
    const room = Math.max(0, SURFACE_FLORA_TUNING.maxWorldPatches - nextWorld.length);
    for (const target of ground.slice(0, room)) {
      const id = `world-flora-${nextSequence++}`;
      nextWorld.push({ id, speciesId: brush.speciesId, x: target.x, y: target.y, z: target.z, density: clampDensity(brush.density), radiusM: brush.radiusM, seed: nextSequence * 2654435761 >>> 0 });
      added += 1;
    }
  }
  return { pieces: nextPieces, worldFlora: nextWorld, sequence: nextSequence, added, removed };
}

export function floraLaneForSpeciesId(id: string, authored: readonly { id: string; lane: FloraLane }[]): FloraLane | null {
  const custom = authored.find((entry) => entry.id === id);
  if (custom) return custom.lane;
  const kind = builtinFloraKindFromId(id);
  return kind ? FLORA_KIND_DEFINITIONS.find((definition) => definition.kind === kind)?.lane ?? null : null;
}

export function surfaceFloraResidentKey(speciesId: string): string {
  return `surface-flora-resident:${speciesId}`;
}

type BuiltinMeshRecipe = {
  packageId: string;
  scale?: readonly [number, number, number];
  translate?: readonly [number, number, number];
};

const BUILTIN_MESH_RECIPES: Readonly<Partial<Record<FloraKind, BuiltinMeshRecipe>>> = {
  grassLush: { packageId: 'flora:grass-blade' },
  grassTall: { packageId: 'flora:grass-blade', scale: [0.72, 2.1, 0.72] },
  grassReeds: { packageId: 'flora:grass-blade', scale: [0.42, 3.2, 0.42] },
  grassFlowers: { packageId: 'flora:flower-head' },
  bush: { packageId: 'flora:bush-clump' },
  bushLow: { packageId: 'flora:bush-clump', scale: [1.35, 0.6, 1.35] },
  bushDense: { packageId: 'flora:bush-clump', scale: [1.15, 1.35, 1.15] },
  pine: { packageId: 'flora:pine' },
  maple: { packageId: 'flora:maple' },
  oak: { packageId: 'flora:oak' },
  cedar: { packageId: 'flora:cedar' },
  spruce: { packageId: 'flora:spruce' },
  hydrangeaMophead: { packageId: 'flora:hydrangea-mophead' },
  hydrangeaPanicle: { packageId: 'flora:hydrangea-panicle' },
  leafyThicket: { packageId: 'flora:leafy-thicket' },
  wildWeedBush: { packageId: 'flora:wild-weed' },
};

function transformedMesh(
  source: Float32Array,
  scale: readonly [number, number, number] = [1, 1, 1],
  translate: readonly [number, number, number] = [0, 0, 0],
  yawDegrees = 0,
): Float32Array {
  const out = new Float32Array(source);
  const yaw = yawDegrees * Math.PI / 180;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  for (let at = 0; at + 7 < out.length; at += 8) {
    const x = source[at]! * scale[0], y = source[at + 1]! * scale[1], z = source[at + 2]! * scale[2];
    out[at] = x * cos - z * sin + translate[0];
    out[at + 1] = y + translate[1];
    out[at + 2] = x * sin + z * cos + translate[2];
    const nx = source[at + 3]! / scale[0], ny = source[at + 4]! / scale[1], nz = source[at + 5]! / scale[2];
    const rx = nx * cos - nz * sin, rz = nx * sin + nz * cos;
    const length = Math.hypot(rx, ny, rz) || 1;
    out[at + 3] = rx / length;
    out[at + 4] = ny / length;
    out[at + 5] = rz / length;
  }
  return out;
}

function packageVertices(packageId: string): Float32Array | null {
  const pkg = modelPackageById(packageId);
  return pkg ? modelPackageMeshData(pkg) : null;
}

function palmMesh(): Float32Array | null {
  const trunk = packageVertices('flora:palm-trunk');
  const frond = packageVertices('flora:palm-frond');
  if (!trunk || !frond) return null;
  const parts = [transformedMesh(trunk, [0.38, 8, 0.38])];
  for (let index = 0; index < 7; index += 1) {
    parts.push(transformedMesh(frond, [3.8, 2.8, 3.8], [0, 8, 0], index * (360 / 7)));
  }
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

/** Derived engine-flora meshes used only by rigged-surface patch refs. */
export function builtinSurfaceFloraResidentMeshes(requiredSpeciesIds?: ReadonlySet<string>): ResidentMesh[] {
  const meshes: ResidentMesh[] = [];
  for (const definition of FLORA_KIND_DEFINITIONS) {
    const speciesId = builtinFloraSpeciesId(definition.kind);
    if (requiredSpeciesIds && !requiredSpeciesIds.has(speciesId)) continue;
    if (definition.kind === 'palmDense') {
      const vertices = palmMesh();
      if (vertices) meshes.push({ key: surfaceFloraResidentKey(speciesId), vertices, color: hexRgb(definition.color) });
      continue;
    }
    const recipe = BUILTIN_MESH_RECIPES[definition.kind];
    if (!recipe) continue;
    const source = packageVertices(recipe.packageId);
    if (!source) continue;
    meshes.push({
      key: surfaceFloraResidentKey(speciesId),
      vertices: transformedMesh(source, recipe.scale, recipe.translate),
      color: hexRgb(definition.color),
    });
  }
  return meshes;
}

function hexRgb(hex: string): [number, number, number] {
  const raw = hex.replace('#', '');
  return [parseInt(raw.slice(0, 2), 16) / 255, parseInt(raw.slice(2, 4), 16) / 255, parseInt(raw.slice(4, 6), 16) / 255];
}

/** Custom species reuse the established authored resident compiler/paint path. */
export function customFloraResidentAdapters(species: readonly AuthoredFloraSpecies[]): AuthoredBuildPiece[] {
  return species.map((entry) => ({
    id: surfaceFloraResidentKey(entry.id),
    modelId: entry.modelId,
    pkgId: entry.pkgId,
    label: entry.label,
    kind: 'prop',
    hex: entry.hex,
  }));
}

function hash32(value: number): number {
  let h = value >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function unit(seed: number): number {
  return (hash32(seed) >>> 8) / 0x1000000;
}

function instanceCount(lane: FloraLane, density: number, seed: number): number {
  const exact = SURFACE_FLORA_TUNING.maxInstancesPerDab[lane] * clampDensity(density);
  const whole = Math.floor(exact);
  return whole + (unit(seed ^ 0x6d2b79f5) < exact - whole ? 1 : 0);
}

function localTriangle(vertices: Float32Array, triangle: number): [Vec3, Vec3, Vec3] | null {
  const at = triangle * 24;
  if (at < 0 || at + 18 >= vertices.length) return null;
  return [
    { x: vertices[at]!, y: vertices[at + 1]!, z: vertices[at + 2]! },
    { x: vertices[at + 8]!, y: vertices[at + 9]!, z: vertices[at + 10]! },
    { x: vertices[at + 16]!, y: vertices[at + 17]!, z: vertices[at + 18]! },
  ];
}

function patchPoint(patch: SurfaceFloraPatch, triangle: [Vec3, Vec3, Vec3], index: number): Vec3 {
  const r1 = unit(patch.seed ^ Math.imul(index + 1, 0x9e3779b9));
  const r2 = unit(patch.seed ^ Math.imul(index + 1, 0x85ebca6b));
  const root = Math.sqrt(r1);
  const wa = 1 - root, wb = root * (1 - r2), wc = root * r2;
  const random = {
    x: triangle[0].x * wa + triangle[1].x * wb + triangle[2].x * wc,
    y: triangle[0].y * wa + triangle[1].y * wb + triangle[2].y * wc,
    z: triangle[0].z * wa + triangle[1].z * wb + triangle[2].z * wc,
  };
  const dx = random.x - patch.lx, dy = random.y - patch.ly, dz = random.z - patch.lz;
  const distance = Math.hypot(dx, dy, dz);
  const amount = distance > patch.radiusM ? patch.radiusM / distance : 1;
  return { x: patch.lx + dx * amount, y: patch.ly + dy * amount, z: patch.lz + dz * amount };
}

function worldPoint(piece: PlacedPiece, local: Vec3): Vec3 {
  const yaw = piece.yawDegrees * Math.PI / 180;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  return {
    x: piece.x + local.x * cos + local.z * sin,
    y: piece.y + local.y + SURFACE_FLORA_TUNING.surfaceOffsetM,
    z: piece.z - local.x * sin + local.z * cos,
  };
}

export function surfaceFloraMeshRefs(
  pieces: readonly PlacedPiece[],
  worldFlora: readonly WorldFloraPatch[],
  authoredSpecies: readonly AuthoredFloraSpecies[],
): MeshRef[] {
  const refs: MeshRef[] = [];
  const append = (speciesId: string, point: Vec3, seed: number) => {
    if (refs.length >= SURFACE_FLORA_TUNING.maxRenderedInstances) return;
    refs.push({ key: surfaceFloraResidentKey(speciesId), x: point.x, y: point.y, z: point.z, yaw: unit(seed) * 360 });
  };
  for (const piece of pieces) {
    if (!piece.surfaceFlora?.length) continue;
    const authored = authoredPieceFrom(null, piece.pieceId);
    const vertices = authored ? authoredMeshData(authored.modelId, authored.pkgId) : null;
    if (!vertices) continue;
    for (const patch of piece.surfaceFlora) {
      const lane = floraLaneForSpeciesId(patch.speciesId, authoredSpecies);
      const triangle = localTriangle(vertices, patch.triangle);
      if (!lane || !triangle) continue;
      const count = instanceCount(lane, patch.density, patch.seed);
      for (let index = 0; index < count; index += 1) {
        append(patch.speciesId, worldPoint(piece, patchPoint(patch, triangle, index)), patch.seed ^ index);
      }
    }
  }
  for (const patch of worldFlora) {
    const lane = floraLaneForSpeciesId(patch.speciesId, authoredSpecies);
    if (!lane) continue;
    const count = instanceCount(lane, patch.density, patch.seed);
    for (let index = 0; index < count; index += 1) {
      const angle = unit(patch.seed ^ Math.imul(index + 1, 0x9e3779b9)) * Math.PI * 2;
      const radius = Math.sqrt(unit(patch.seed ^ Math.imul(index + 1, 0x85ebca6b))) * patch.radiusM;
      append(patch.speciesId, { x: patch.x + Math.cos(angle) * radius, y: patch.y + SURFACE_FLORA_TUNING.surfaceOffsetM, z: patch.z + Math.sin(angle) * radius }, patch.seed ^ index);
    }
  }
  return refs;
}
