/** The RENDERED terrain grid — the one resolution the compiled game can draw
 *  and collide against.
 *
 *  Mirrors `framework/gpu/terrain_grid.zig` SAMPLE_COLS/SAMPLE_ROWS and
 *  `framework/game/map/engine.zig` FLOOR_RES. Three native gates enforce it and
 *  ALL THREE fail silently on the finer 241×241 sculpt field:
 *    - `terrain_grid.canAppend` refuses a non-121 grid, so `world/constructor.zig`
 *      never appends the height trailer and the chunk misses the shared-grid
 *      ground pipeline;
 *    - the dynamic-heightfield fallback needs 240·240·6 ≈ 346k verts against a
 *      98,304 MAX_DYN_VERTS budget, so the mesh is dropped;
 *    - `game_physics.HF_MAX_SAMPLES` is 16,384, so no collider registers.
 *  The result is a world that renders as empty sky. Read the floor mirror
 *  (`mapReadFloor`), never the brush field (`mapReadHeight`). */
export const GROUND_FLOOR_RES = 121;
export const GROUND_FLOOR_SAMPLES = GROUND_FLOOR_RES * GROUND_FLOOR_RES;

/** Metres spanned by one authored map chunk (`map/chunks.zig` CHUNK_METERS). */
export const GROUND_CHUNK_METERS = 120;

/** World X (or Z) of the LOW corner of chunk index `c`.
 *
 *  The native map centres a chunk on its index times the chunk span:
 *  `chunks.globalTile(x) = floor(x + CHUNK_METERS/2)`, and `localSampleF`
 *  subtracts `cx*CHUNK_METERS - CHUNK_METERS/2`. Every generator that lays out
 *  a chunk's cells or height samples must start from HERE, not from
 *  `c * GROUND_CHUNK_METERS` — that is the chunk's middle. */
export function chunkOriginMeters(c: number): number {
  return c * GROUND_CHUNK_METERS - GROUND_CHUNK_METERS / 2;
}

export type FormulaHeightfield = Readonly<{
  cx: number;
  cz: number;
  heights: Float32Array;
  groundData: Float32Array;
}>;

/** HEIGHTFIELDS v3 encoder. The caller supplies streams already read from the
 * native map owner; this function only lays out the constructor.zig contract. */
export function encodeFormulaHeightfields(
  formulaBytes: Uint8Array,
  fields: readonly FormulaHeightfield[],
  color: readonly [number, number, number],
  walkableSlopeDegrees: number,
): Uint8Array {
  for (const field of fields) {
    if (field.heights.length !== GROUND_FLOOR_SAMPLES) {
      throw new Error(
        `heightfield chunk ${field.cx},${field.cz} carries ${field.heights.length} samples; the rendered grid is ${GROUND_FLOOR_RES}x${GROUND_FLOOR_RES}`,
      );
    }
  }
  const recordBytes = fields.reduce(
    (total, field) => total + 16 + 10 * 4 + GROUND_FLOOR_SAMPLES * 4 + field.groundData.byteLength,
    0,
  );
  const out = new Uint8Array(12 + formulaBytes.length + recordBytes);
  const view = new DataView(out.buffer);
  view.setUint32(0, 3, true);
  view.setUint32(4, fields.length, true);
  view.setUint32(8, formulaBytes.length, true);
  out.set(formulaBytes, 12);
  let at = 12 + formulaBytes.length;
  for (const field of fields) {
    view.setUint32(at, GROUND_FLOOR_RES, true);
    view.setUint32(at + 4, GROUND_FLOOR_RES, true);
    view.setUint32(at + 8, field.groundData.length, true);
    view.setUint32(at + 12, 0, true);
    at += 16;
    // The record's first two floats are the chunk's CENTRE — and the native map
    // CENTRES chunk (cx, cz) on (cx*120, cz*120): `chunks.globalTile(x)` is
    // `floor(x + CHUNK_METERS/2)`, so the chunk spans [cx*120 - 60, cx*120 + 60].
    // The centre and the chunk index therefore coincide; anything that treats
    // cx*120 as the chunk's low CORNER is half a chunk out.
    const values = [
      field.cx * GROUND_CHUNK_METERS,
      field.cz * GROUND_CHUNK_METERS,
      0,
      GROUND_CHUNK_METERS,
      GROUND_CHUNK_METERS,
      GROUND_CHUNK_METERS / (GROUND_FLOOR_RES - 1),
      Math.cos(walkableSlopeDegrees * Math.PI / 180),
      color[0], color[1], color[2],
    ];
    values.forEach((value, index) => view.setFloat32(at + index * 4, value, true));
    at += 40;
    out.set(new Uint8Array(field.heights.buffer, field.heights.byteOffset, field.heights.byteLength), at);
    at += field.heights.byteLength;
    out.set(new Uint8Array(field.groundData.buffer, field.groundData.byteOffset, field.groundData.byteLength), at);
    at += field.groundData.byteLength;
  }
  return out;
}
