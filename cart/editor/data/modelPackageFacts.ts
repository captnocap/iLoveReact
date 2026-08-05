// Live, cheap facts for asset-browser model summaries.
//
// Manifest counts are legacy hints: import/materialization paths commonly leave
// them at zero while the package already contains geometry, paint variants, and
// an atlas.  The browser therefore reads the package artifacts themselves.  It
// deliberately does not rewrite manifests — browsing a model must stay read-only.
import { exists, listDir } from '../../../runtime/hooks/fs';
import type { ModelPackage } from './types';
import { readMeshDoc } from './meshDoc';
import { resolvePackageDir } from './modelPackageStore';

const FLOATS_PER_VERTEX = 8;
const VERTICES_PER_TRIANGLE = 3;
const FLOATS_PER_TRIANGLE = FLOATS_PER_VERTEX * VERTICES_PER_TRIANGLE;
const SAVED_PAINT_FILE = /^paint_[^/]+\.json$/;

export type ModelPackageFacts = {
  /** null means no trustworthy geometry source was available; it does not mean zero. */
  triangles: number | null;
  paints: number;
  atlases: number;
};

/**
 * Resolve the model summary from durable package artifacts. Geometry prefers
 * the editable mesh document; old manifest values are only a compatibility
 * fallback. Source-only files stay unknown here because the native preview
 * loader also changes shared orbit state — a read-only card must not invoke it.
 */
export function readModelPackageFacts(model: ModelPackage): ModelPackageFacts {
  const dir = resolvePackageDir(model.kind, model.id);
  const doc = dir ? readMeshDoc(dir) : null;
  const docTriangles = doc && doc.vertices.length >= FLOATS_PER_TRIANGLE
    ? Math.floor(doc.vertices.length / FLOATS_PER_TRIANGLE)
    : null;
  const manifestTriangles = Number.isFinite(model.triangles) && model.triangles > 0
    ? Math.floor(model.triangles)
    : null;

  if (!dir) {
    return {
      triangles: docTriangles ?? manifestTriangles,
      paints: model.paints.length,
      atlases: model.atlases.length,
    };
  }

  const paintFiles = exists(`${dir}/paints`) ? listDir(`${dir}/paints`) : [];
  return {
    triangles: docTriangles ?? manifestTriangles,
    paints: paintFiles.filter((name) => SAVED_PAINT_FILE.test(name)).length,
    // base.png is the package's live atlas. UV guides, reset records, and
    // raster baselines are supporting artifacts, not additional atlases.
    atlases: exists(`${dir}/atlases/base.png`) ? 1 : 0,
  };
}
