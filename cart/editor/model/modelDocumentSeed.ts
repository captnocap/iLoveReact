import type { PackageMeshDoc } from '../data/meshDoc';

export type ModelDocumentSeed = {
  source: 'rjmd' | 'primitive' | 'composed';
  key: string;
  name: string;
  vertices: Float32Array;
  count: number;
  /** Durable Outliner ownership copied from the RJMD document. This remains
   * available even during the render before AppFrame has hydrated its rows. */
  partRanges: { lo: number; hi: number }[];
  faceGroups?: Uint32Array;
  faceMaterials?: Uint32Array;
  semanticRegions?: Uint32Array;
  semanticInstances?: Uint32Array;
  semanticTable?: NonNullable<PackageMeshDoc['semanticTable']>;
  logicalVertexCount?: number;
  renderCornerLogicalIds?: Uint32Array;
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
    partRanges: doc.ranges.map((range) => ({ lo: range.lo, hi: range.hi })),
    faceGroups: doc.faceGroups ?? undefined,
    faceMaterials: doc.faceMaterials ?? undefined,
    semanticRegions: doc.semanticRegions ?? undefined,
    semanticInstances: doc.semanticInstances ?? undefined,
    semanticTable: doc.semanticTable ?? undefined,
    logicalVertexCount: doc.hasLogicalVertices ? doc.logicalVertexCount : undefined,
    renderCornerLogicalIds: doc.renderCornerLogicalIds ?? undefined,
    glassFirstVertex: doc.glassFirstVertex,
  };
}
