// Generic terrain substrate shared by every heightfield landform (mountain, hills,
// future canyons/dunes). A landform supplies a height function rise(worldX,worldZ)
// → meters above its base; this bakes it into the cols×rows grid that feeds BOTH
// the Heightfield mesh and the host collider (mountainColliderData's twin). The
// only thing that differs between landforms is the rise function and the texture —
// the bake, placement, and collider plumbing are one shared path. 1 tile = 1 meter.

// The baked grid plus everything the mesh and collider need to place it.
export type TerrainField = {
  heights: Float32Array;
  cols: number;
  rows: number;
  width: number; // mesh footprint span (= 2 * halfWidth)
  depth: number;
  base: number; // mesh skirt drops to this (0 = rims sit at baseY)
  originX: number; // world position of sample (0,0) — collider placement
  originZ: number;
  cell: number; // world meters between samples
  baseY: number; // world Y the heights are measured above
  walkCos: number; // cos(slope limit) for the host
};

// What the host needs to register a terrain collider (the subset of TerrainField).
export type TerrainColliderData = {
  originX: number;
  originZ: number;
  cell: number;
  cols: number;
  rows: number;
  baseY: number;
  walkCos: number;
  heights: Float32Array;
};

export type BakeTerrainOptions = {
  centerX: number;
  centerZ: number;
  baseY: number;
  halfWidth: number;
  resolution: number; // cols == rows
  walkCos: number;
  rise: (worldX: number, worldZ: number) => number; // meters above baseY
};

export function bakeTerrainField(opts: BakeTerrainOptions): TerrainField {
  const cols = opts.resolution;
  const rows = opts.resolution;
  const width = opts.halfWidth * 2;
  const depth = width;
  const heights = new Float32Array(cols * rows);
  const x0 = -width / 2;
  const z0 = -depth / 2;
  const dx = width / (cols - 1);
  const dz = depth / (rows - 1);
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      heights[j * cols + i] = opts.rise(opts.centerX + x0 + i * dx, opts.centerZ + z0 + j * dz);
    }
  }
  return {
    heights,
    cols,
    rows,
    width,
    depth,
    base: 0,
    originX: opts.centerX - width / 2,
    originZ: opts.centerZ - depth / 2,
    cell: width / (cols - 1),
    baseY: opts.baseY,
    walkCos: opts.walkCos,
  };
}

export function terrainColliderData(field: TerrainField): TerrainColliderData {
  return {
    originX: field.originX,
    originZ: field.originZ,
    cell: field.cell,
    cols: field.cols,
    rows: field.rows,
    baseY: field.baseY,
    walkCos: field.walkCos,
    heights: field.heights,
  };
}
