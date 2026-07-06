// load.ts — Three.js adapter for the compiled hmsc game data.
//
// This intentionally accepts an injected THREE namespace instead of importing
// `three`: the repo has no npm dependency graph, and a browser/import-map host
// or an embedding app can provide whichever Three build it already uses.
//
// Wire ownership stays in ../tsLoader/decode. This file only lowers the decoded
// flat scene into Three objects: instanced primitive meshes, terrain heightfields,
// and metadata for physics/material data a fuller player can consume.

import {
  loadSceneFromGameFile,
  loadSceneFromMapContainer,
  type LoadedScene,
} from '../tsLoader/decode';

const INSTANCE_FLOATS = 12;
const DEG_TO_RAD = Math.PI / 180;

const SHAPE = {
  BOX: 0,
  RAMP: 1,
  CYLINDER8: 2,
  CYLINDER16: 3,
  SPHERE: 4,
  GABLE: 5,
  GRASS: 6,
  BUSH: 7,
  FROND: 8,
  PALMTRUNK: 9,
  FLOWER: 10,
  SCENERY_BOX: 11,
  CORNER_MITER: 12,
  CORNER_MITER_MIRROR: 13,
  BOX_OPEN_RUN_MIN: 14,
  BOX_OPEN_RUN_MAX: 15,
  BOX_OPEN_RUN_BOTH: 16,
} as const;

const SHAPE_LABEL: Record<number, string> = {
  [SHAPE.BOX]: 'box',
  [SHAPE.RAMP]: 'ramp',
  [SHAPE.CYLINDER8]: 'cylinder8',
  [SHAPE.CYLINDER16]: 'cylinder16',
  [SHAPE.SPHERE]: 'sphere',
  [SHAPE.GABLE]: 'gable',
  [SHAPE.GRASS]: 'grass',
  [SHAPE.BUSH]: 'bush',
  [SHAPE.FROND]: 'frond',
  [SHAPE.PALMTRUNK]: 'palmtrunk',
  [SHAPE.FLOWER]: 'flower',
  [SHAPE.SCENERY_BOX]: 'scenery-box',
  [SHAPE.CORNER_MITER]: 'corner-miter',
  [SHAPE.CORNER_MITER_MIRROR]: 'corner-miter-mirror',
  [SHAPE.BOX_OPEN_RUN_MIN]: 'open-run-min',
  [SHAPE.BOX_OPEN_RUN_MAX]: 'open-run-max',
  [SHAPE.BOX_OPEN_RUN_BOTH]: 'open-run-both',
};

export interface ThreeLike {
  Group: new () => any;
  Object3D?: new () => any;
  BufferGeometry: new () => any;
  Float32BufferAttribute?: new (array: ArrayLike<number>, itemSize: number) => any;
  BufferAttribute?: new (array: ArrayLike<number>, itemSize: number) => any;
  BoxGeometry?: new (width?: number, height?: number, depth?: number) => any;
  CylinderGeometry?: new (radiusTop?: number, radiusBottom?: number, height?: number, radialSegments?: number) => any;
  SphereGeometry?: new (radius?: number, widthSegments?: number, heightSegments?: number) => any;
  PlaneGeometry?: new (width?: number, height?: number) => any;
  MeshStandardMaterial?: new (params?: Record<string, unknown>) => any;
  MeshBasicMaterial?: new (params?: Record<string, unknown>) => any;
  Mesh: new (geometry: any, material: any) => any;
  InstancedMesh: new (geometry: any, material: any, count: number) => any;
  Matrix4: new () => any;
  Vector3: new (x?: number, y?: number, z?: number) => any;
  Euler: new (x?: number, y?: number, z?: number, order?: string) => any;
  Quaternion: new () => any;
  Color: new (color?: string | number) => any;
  DoubleSide?: number;
}

export interface HmscThreeOptions {
  /** Name stamped onto the returned group. */
  name?: string;
  /** Keep only first N rows; useful for web demos on very large compiled worlds. */
  instanceLimit?: number;
  /** Draw terrain heightfields. Defaults true. */
  includeHeightfields?: boolean;
  /** Material color for terrain heightfields. */
  terrainColor?: string | number;
}

export interface HmscThreeStats {
  instances: number;
  renderedInstances: number;
  instancedMeshes: number;
  heightfields: number;
  skippedInstances: number;
}

export interface HmscThreeLoadResult {
  group: any;
  scene: LoadedScene;
  stats: HmscThreeStats;
  notes: string[];
}

type Row = {
  index: number;
  base: number;
  shapeId: number;
  materialRef: number;
};

type Bucket = {
  shapeId: number;
  materialRef: number;
  rows: Row[];
};

function shapeLabel(shapeId: number): string {
  return SHAPE_LABEL[shapeId] ?? `shape-${shapeId}`;
}

function attr(THREE: ThreeLike, values: ArrayLike<number>, itemSize: number): any {
  const Ctor = THREE.Float32BufferAttribute ?? THREE.BufferAttribute;
  if (!Ctor) throw new Error('THREE.Float32BufferAttribute or THREE.BufferAttribute is required');
  return new Ctor(values, itemSize);
}

function setPositions(THREE: ThreeLike, geometry: any, values: number[]): void {
  geometry.setAttribute?.('position', attr(THREE, new Float32Array(values), 3));
}

function setIndices(geometry: any, values: number[]): void {
  geometry.setIndex?.(values);
}

function computeNormals(geometry: any): void {
  geometry.computeVertexNormals?.();
}

function boxGeometry(THREE: ThreeLike): any {
  return THREE.BoxGeometry ? new THREE.BoxGeometry(1, 1, 1) : rampGeometry(THREE);
}

function rampGeometry(THREE: ThreeLike): any {
  const g = new THREE.BufferGeometry();
  // Unit triangular prism centered on origin. Scale comes from the instance row.
  setPositions(THREE, g, [
    -0.5, -0.5, -0.5,
     0.5, -0.5, -0.5,
    -0.5, -0.5,  0.5,
     0.5, -0.5,  0.5,
    -0.5,  0.5,  0.5,
     0.5,  0.5,  0.5,
  ]);
  setIndices(g, [
    0, 2, 3, 0, 3, 1, // bottom
    2, 4, 5, 2, 5, 3, // tall end
    0, 1, 5, 0, 5, 4, // slope
    0, 4, 2,          // left side
    1, 3, 5,          // right side
  ]);
  computeNormals(g);
  return g;
}

function planeGeometry(THREE: ThreeLike): any {
  if (THREE.PlaneGeometry) return new THREE.PlaneGeometry(1, 1);
  return boxGeometry(THREE);
}

function geometryForShape(THREE: ThreeLike, shapeId: number): { geometry: any; approximate: boolean } | null {
  switch (shapeId) {
    case SHAPE.BOX:
    case SHAPE.SCENERY_BOX:
      return { geometry: boxGeometry(THREE), approximate: false };
    case SHAPE.RAMP:
      return { geometry: rampGeometry(THREE), approximate: false };
    case SHAPE.CYLINDER8:
      return { geometry: THREE.CylinderGeometry ? new THREE.CylinderGeometry(0.5, 0.5, 1, 8) : boxGeometry(THREE), approximate: !THREE.CylinderGeometry };
    case SHAPE.CYLINDER16:
      return { geometry: THREE.CylinderGeometry ? new THREE.CylinderGeometry(0.5, 0.5, 1, 16) : boxGeometry(THREE), approximate: !THREE.CylinderGeometry };
    case SHAPE.SPHERE:
      return { geometry: THREE.SphereGeometry ? new THREE.SphereGeometry(0.5, 16, 12) : boxGeometry(THREE), approximate: !THREE.SphereGeometry };
    case SHAPE.GRASS:
    case SHAPE.FLOWER:
    case SHAPE.FROND:
      return { geometry: planeGeometry(THREE), approximate: !THREE.PlaneGeometry };
    case SHAPE.BUSH:
      return { geometry: THREE.SphereGeometry ? new THREE.SphereGeometry(0.5, 8, 6) : boxGeometry(THREE), approximate: !THREE.SphereGeometry };
    case SHAPE.PALMTRUNK:
      return { geometry: THREE.CylinderGeometry ? new THREE.CylinderGeometry(0.35, 0.5, 1, 9) : boxGeometry(THREE), approximate: !THREE.CylinderGeometry };
    case SHAPE.GABLE:
    case SHAPE.CORNER_MITER:
    case SHAPE.CORNER_MITER_MIRROR:
    case SHAPE.BOX_OPEN_RUN_MIN:
    case SHAPE.BOX_OPEN_RUN_MAX:
    case SHAPE.BOX_OPEN_RUN_BOTH:
      return { geometry: boxGeometry(THREE), approximate: true };
    default:
      return null;
  }
}

function materialForBucket(THREE: ThreeLike, scene: LoadedScene, materialRef: number, side?: number): any {
  const recipe = materialRef > 0 ? scene.materials[materialRef - 1] : null;
  const opacity = recipe ? Math.max(0, Math.min(1, recipe.opacity)) : 1;
  const params = {
    color: 0xffffff,
    vertexColors: true,
    transparent: opacity < 1,
    opacity,
    side,
  };
  const Material = THREE.MeshStandardMaterial ?? THREE.MeshBasicMaterial;
  if (!Material) throw new Error('THREE.MeshStandardMaterial or THREE.MeshBasicMaterial is required');
  return new Material(params);
}

function setInstanceTransform(THREE: ThreeLike, mesh: any, slot: number, insts: Float32Array, base: number): void {
  const position = new THREE.Vector3(insts[base + 0] ?? 0, insts[base + 1] ?? 0, insts[base + 2] ?? 0);
  const euler = new THREE.Euler(
    (insts[base + 3] ?? 0) * DEG_TO_RAD,
    (insts[base + 4] ?? 0) * DEG_TO_RAD,
    (insts[base + 5] ?? 0) * DEG_TO_RAD,
    'XYZ',
  );
  const quaternion = new THREE.Quaternion();
  quaternion.setFromEuler?.(euler);
  const scale = new THREE.Vector3(insts[base + 6] ?? 1, insts[base + 7] ?? 1, insts[base + 8] ?? 1);
  const matrix = new THREE.Matrix4();
  matrix.compose?.(position, quaternion, scale);
  mesh.setMatrixAt?.(slot, matrix);
}

function setInstanceColor(THREE: ThreeLike, mesh: any, slot: number, insts: Float32Array, base: number): void {
  if (typeof mesh.setColorAt !== 'function') return;
  const color = new THREE.Color();
  color.setRGB?.(
    Math.max(0, Math.min(1, insts[base + 9] ?? 1)),
    Math.max(0, Math.min(1, insts[base + 10] ?? 1)),
    Math.max(0, Math.min(1, insts[base + 11] ?? 1)),
  );
  mesh.setColorAt(slot, color);
}

function bucketRows(scene: LoadedScene, limit: number): { buckets: Bucket[]; skipped: number } {
  const stride = scene.instanceStride || INSTANCE_FLOATS;
  const count = Math.min(scene.instanceCount, limit);
  const groups = new Map<string, Bucket>();
  let skipped = Math.max(0, scene.instanceCount - count);
  for (let index = 0; index < count; index += 1) {
    const base = index * stride;
    const shapeId = stride > INSTANCE_FLOATS ? (scene.instances[base + 12] ?? 0) | 0 : SHAPE.BOX;
    const planRef = scene.materialRefs[index] ?? 0;
    const key = `${shapeId}:${planRef}`;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = { shapeId, materialRef: planRef, rows: [] };
      groups.set(key, bucket);
    }
    bucket.rows.push({ index, base, shapeId, materialRef: planRef });
  }
  return { buckets: [...groups.values()], skipped };
}

function heightfieldGeometry(THREE: ThreeLike, field: LoadedScene['heightfields'][number]): any {
  const g = new THREE.BufferGeometry();
  const positions: number[] = [];
  const indices: number[] = [];
  const yaw = field.yawRadians ?? 0;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const pivotX = field.pivotX ?? field.originX;
  const pivotZ = field.pivotZ ?? field.originZ;
  for (let z = 0; z < field.rows; z += 1) {
    for (let x = 0; x < field.cols; x += 1) {
      const wx = field.originX + x * field.cellSizeMeters;
      const wz = field.originZ + z * field.cellSizeMeters;
      const dx = wx - pivotX;
      const dz = wz - pivotZ;
      const rx = pivotX + dx * c + dz * s;
      const rz = pivotZ - dx * s + dz * c;
      const h = field.heights[z * field.cols + x] ?? 0;
      positions.push(rx, field.baseY + h, rz);
    }
  }
  for (let z = 0; z < field.rows - 1; z += 1) {
    for (let x = 0; x < field.cols - 1; x += 1) {
      const a = z * field.cols + x;
      const b = a + 1;
      const c0 = a + field.cols;
      const d = c0 + 1;
      indices.push(a, c0, b, b, c0, d);
    }
  }
  setPositions(THREE, g, positions);
  setIndices(g, indices);
  computeNormals(g);
  return g;
}

export function buildHmscThreeScene(
  THREE: ThreeLike,
  scene: LoadedScene,
  opts: HmscThreeOptions = {},
): HmscThreeLoadResult {
  const group = new THREE.Group();
  group.name = opts.name ?? 'hmsc-compiled-world';

  const notes: string[] = [];
  const includeHeightfields = opts.includeHeightfields ?? true;
  const limit = opts.instanceLimit ?? scene.instanceCount;
  const grouped = bucketRows(scene, limit);
  const buckets = grouped.buckets;
  let skipped = grouped.skipped;

  let renderedInstances = 0;
  let instancedMeshes = 0;
  for (const bucket of buckets) {
    const plan = geometryForShape(THREE, bucket.shapeId);
    if (!plan) {
      skipped += bucket.rows.length;
      notes.push(`${bucket.rows.length} ${shapeLabel(bucket.shapeId)} row(s) skipped: no Three geometry plan`);
      continue;
    }
    if (plan.approximate) {
      notes.push(`${bucket.rows.length} ${shapeLabel(bucket.shapeId)} row(s) drawn with an approximate Three primitive`);
    }
    const material = materialForBucket(THREE, scene, bucket.materialRef, THREE.DoubleSide);
    const mesh = new THREE.InstancedMesh(plan.geometry, material, bucket.rows.length);
    mesh.name = `hmsc:${shapeLabel(bucket.shapeId)}:${bucket.materialRef}`;
    mesh.userData = {
      ...(mesh.userData ?? {}),
      hmscShapeId: bucket.shapeId,
      hmscMaterialRef: bucket.materialRef,
      hmscRows: bucket.rows.map((row) => row.index),
    };
    for (let i = 0; i < bucket.rows.length; i += 1) {
      const row = bucket.rows[i]!;
      setInstanceTransform(THREE, mesh, i, scene.instances, row.base);
      setInstanceColor(THREE, mesh, i, scene.instances, row.base);
    }
    if (mesh.instanceMatrix) mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
    renderedInstances += bucket.rows.length;
    instancedMeshes += 1;
  }

  let heightfieldCount = 0;
  if (includeHeightfields) {
    for (const field of scene.heightfields) {
      const material = new (THREE.MeshStandardMaterial ?? THREE.MeshBasicMaterial)({
        color: opts.terrainColor ?? '#3a4a3e',
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(heightfieldGeometry(THREE, field), material);
      mesh.name = `hmsc:heightfield:${field.slot}`;
      mesh.userData = {
        ...(mesh.userData ?? {}),
        hmscHeightfieldSlot: field.slot,
        hmscCols: field.cols,
        hmscRows: field.rows,
      };
      group.add(mesh);
      heightfieldCount += 1;
    }
  }

  const stats: HmscThreeStats = {
    instances: scene.instanceCount,
    renderedInstances,
    instancedMeshes,
    heightfields: heightfieldCount,
    skippedInstances: skipped,
  };
  group.userData = {
    ...(group.userData ?? {}),
    hmscCompiledScene: {
      stats,
      notes,
      pieceCount: scene.pieceCount,
      materialCount: scene.materials.length,
      colliderRects: scene.colliders ? scene.colliders.rects.length / 9 : 0,
      colliderOriented: scene.colliders ? scene.colliders.oriented.length / 12 : 0,
      physicsConfig: scene.physicsConfig,
      flora: scene.flora,
      environment: scene.environment,
    },
  };
  return { group, scene, stats, notes };
}

export function loadHmscThreeFromMapContainer(
  THREE: ThreeLike,
  bytes: Uint8Array,
  opts: HmscThreeOptions = {},
): HmscThreeLoadResult {
  return buildHmscThreeScene(THREE, loadSceneFromMapContainer(bytes), opts);
}

export function loadHmscThreeFromGameFile(
  THREE: ThreeLike,
  bytes: Uint8Array,
  opts: HmscThreeOptions = {},
): HmscThreeLoadResult {
  return buildHmscThreeScene(THREE, loadSceneFromGameFile(bytes), opts);
}
