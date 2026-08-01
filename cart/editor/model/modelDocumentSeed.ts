import type { PackageMeshDoc } from '../data/meshDoc';

export type ModelDocumentSeed = {
  source: 'rjmd' | 'primitive' | 'composed';
  key: string;
  name: string;
  vertices: Float32Array;
  count: number;
  faceGroups?: Uint32Array;
  faceMaterials?: Uint32Array;
  semanticRegions?: Uint32Array;
  semanticInstances?: Uint32Array;
  semanticTable?: NonNullable<PackageMeshDoc['semanticTable']>;
  glassFirstVertex?: number | null;
};

/**
 * The one RJMD -> ModelView boundary. Keep every durable per-face channel together:
 * a mount that forwards geometry while dropping semantics creates a valid-looking but
 * anonymous resident mesh, which is more dangerous than refusing the document.
 */
export function modelDocumentSeed(
  key: string,
  name: string,
  doc: PackageMeshDoc,
): ModelDocumentSeed {
  return {
    source: 'rjmd',
    key,
    name,
    vertices: doc.vertices,
    count: Math.floor(doc.vertices.length / 8),
    faceGroups: doc.faceGroups ?? undefined,
    faceMaterials: doc.faceMaterials ?? undefined,
    semanticRegions: doc.semanticRegions ?? undefined,
    semanticInstances: doc.semanticInstances ?? undefined,
    semanticTable: doc.semanticTable ?? undefined,
    glassFirstVertex: doc.glassFirstVertex,
  };
}
