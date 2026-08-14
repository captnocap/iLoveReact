import { modelDocumentSeed } from './modelDocumentSeed';
import type { PackageMeshDoc } from '../data/meshDoc';

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

const semantics = new Uint32Array([7, 8]);
const instances = new Uint32Array([0, 3]);
const table = { version: 1 as const, regions: [
  { id: 7, name: 'panel.wall', role: 'wall' },
  { id: 8, name: 'boss.cap', role: 'cap' },
] };
const doc: PackageMeshDoc = {
  vertices: new Float32Array(6 * 8),
  faceGroups: new Uint32Array([1, 2]),
  faceMaterials: null,
  semanticRegions: semantics,
  semanticInstances: instances,
  semanticTable: table,
  hasLogicalVertices: true,
  logicalVertexCount: 3,
  renderCornerLogicalIds: new Uint32Array([0, 1, 2, 0, 2, 1]),
  ranges: [{ lo: 0, hi: 2 }],
  glassFirstVertex: 6,
};

const seed = modelDocumentSeed('model-46', 'Radio', doc);
assert(seed.semanticRegions === semantics, 'RJMD semantic regions were dropped at the ModelView boundary');
assert(seed.semanticInstances === instances, 'RJMD semantic instances were dropped at the ModelView boundary');
assert(seed.semanticTable === table, 'RJMD semantic dictionary was dropped at the ModelView boundary');
assert(seed.logicalVertexCount === 3, 'RJMD logical vertex count was dropped at the ModelView boundary');
assert(seed.renderCornerLogicalIds === doc.renderCornerLogicalIds, 'RJMD logical corner rows were dropped at the ModelView boundary');
assert(seed.partRanges.length === 1 && seed.partRanges[0]?.lo === 0 && seed.partRanges[0]?.hi === 2, 'RJMD part ownership was dropped at the ModelView boundary');
assert(seed.source === 'rjmd', 'RJMD seed lost its mount-source diagnosis');
assert(seed.count === 6 && seed.glassFirstVertex === 6, 'ordinary RJMD fields changed while forwarding semantics');

console.log('modelDocumentSeed: 1 passed');
