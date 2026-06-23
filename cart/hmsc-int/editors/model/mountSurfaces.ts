// editors/model/mountSurfaces.ts — the HORIZONTAL SURFACES of a model: the flat,
// upward-facing levels a prop can rest on (a shelf's boards, a tabletop, a desk).
// req_1687: a multi-layer model (a shelf) is ONE mesh, not separable parts, so the
// build collider/placement sees a single box and every prop lands on the box top.
// We read the layers straight off the cooked geometry instead — every up-facing
// facet contributes its Y, clustered into distinct levels — so point-and-place can
// drop a prop on whichever shelf the cursor is over, with no per-model authoring.
//
// Pure + headless (the editMesh idiom): a Float32Array in, surface levels out.

/** One flat upward-facing level of a model, in prop-local meters (add piece.y for
 *  world). The XZ extent is the level's measured span — used to drop slivers. */
export type LayerSurface = {
  /** local top Y of the surface, meters. */
  y: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

const FLOATS_PER_VERTEX = 8; // pos3 nrm3 uv2 — the cooked MESH_PROPS format
const UP_NORMAL_MIN = 0.85; // ny above this = a (near-)horizontal up face
const LEVEL_GAP_METERS = 0.06; // a Y jump past this starts a new surface level
const MIN_SURFACE_AREA_M2 = 0.02; // drop slivers (a leg's top corner is not a shelf)

/**
 * Distinct horizontal up-facing surface levels of a cooked mesh, LOW → HIGH.
 * Empty when the mesh has none worth standing a prop on (a sphere, a slanted-only
 * model, a single solid block). Each level is the merged top face of one layer.
 */
export function horizontalSurfacesFromMesh(verts: Float32Array): LayerSurface[] {
  // gather the up-facing vertices (position only); ignore side/under faces.
  const points: { x: number; y: number; z: number }[] = [];
  const vertCount = Math.floor(verts.length / FLOATS_PER_VERTEX);
  for (let i = 0; i < vertCount; i += 1) {
    const o = i * FLOATS_PER_VERTEX;
    if (verts[o + 4] < UP_NORMAL_MIN) continue; // ny — only near-horizontal up faces
    points.push({ x: verts[o], y: verts[o + 1], z: verts[o + 2] });
  }
  if (points.length === 0) return [];

  // cluster by Y: sort, then split wherever the gap to the next vertex exceeds the
  // window. Each cluster is one board's top (its verts share a Y, big gaps between).
  points.sort((a, b) => a.y - b.y);
  const surfaces: LayerSurface[] = [];
  let acc: { ySum: number; n: number; minX: number; maxX: number; minZ: number; maxZ: number } | null = null;
  let prevY = -Infinity;
  const flush = () => {
    if (!acc) return;
    const w = acc.maxX - acc.minX;
    const d = acc.maxZ - acc.minZ;
    if (w * d >= MIN_SURFACE_AREA_M2) {
      surfaces.push({ y: acc.ySum / acc.n, minX: acc.minX, maxX: acc.maxX, minZ: acc.minZ, maxZ: acc.maxZ });
    }
    acc = null;
  };
  for (const p of points) {
    if (!acc || p.y - prevY > LEVEL_GAP_METERS) {
      flush();
      acc = { ySum: 0, n: 0, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    }
    acc.ySum += p.y;
    acc.n += 1;
    if (p.x < acc.minX) acc.minX = p.x;
    if (p.x > acc.maxX) acc.maxX = p.x;
    if (p.z < acc.minZ) acc.minZ = p.z;
    if (p.z > acc.maxZ) acc.maxZ = p.z;
    prevY = p.y;
  }
  flush();
  return surfaces; // already low → high (points were sorted by y)
}
