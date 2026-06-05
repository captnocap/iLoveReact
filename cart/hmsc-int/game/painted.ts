// game/painted.ts — the PAINTED OVERLAY: a model's pixel-painted texture
// layer as plain data (MODELPAINT-0605, ruled).
//
// THE USER'S RULING, verbatim: "i dont want to paint depth, i want to paint
// their face though, or body parts, is that clear." Color pixels ONLY —
// geometry never rides this channel (sculpt stays /characters' tool).
//
// The shape: /cutout paints a model surface with the shared painter
// (editors/paint) and SAVES the result onto the owning model document
// (BodyDocument.paint / VehicleDoc.paint — additive V20 fields, old
// documents unaffected) as ONE PaintedOverlay:
//
//   - the BAKE: per-layer colored cell grids in the surface's unwrap space —
//     what every renderer composites (cheap, self-contained, no GPU state).
//     Cell resolution is chosen by the painter at save and stored here.
//   - the PAINT DOC: the painter's full re-editable document, carried OPAQUE
//     (`unknown`) — game/ stores it, only editors/cutout interprets it
//     (STRUCTURE arrows: game/ never imports editors/).
//
// game/ owns the data + validation + texture-key recipes (this file,
// headless) and the preview render (paintedRender.tsx — React, imported
// directly by editors like figure/render.tsx; the door stays React-free).

/** One baked color layer: sparse ON cell indices over the cols×rows grid. */
export type PaintedOverlayLayer = {
  /** '#RRGGBB' or '#RRGGBBAA' */
  color: string;
  /** sparse row-major indices of painted cells */
  cells: number[];
};

export type PaintedOverlay = {
  version: 1;
  /** save stamp — content-addresses the texture keys (a re-save re-keys) */
  stamp: number;
  /** bake grid resolution across the unwrap (cols×rows) */
  cols: number;
  rows: number;
  /** bottom-up — later layers composite over earlier ones */
  layers: PaintedOverlayLayer[];
  /** the re-editable painter document — OPAQUE to game/ (editors/cutout
   *  parses it back into the shared painter; absent = bake-only overlay) */
  paintDoc?: unknown;
};

const COLOR_SHAPE = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

/** Boundary validation for overlays arriving from documents/streams/files.
 *  Returns the overlay (cells clamped to the grid) or null — never throws
 *  (V20: old/foreign data is skipped, not a crash). */
export function validatePaintedOverlay(value: unknown): PaintedOverlay | null {
  const v = value as any;
  if (!v || v.version !== 1) return null;
  if (typeof v.stamp !== 'number' || !Number.isFinite(v.stamp)) return null;
  const cols = v.cols, rows = v.rows;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1 || cols * rows > 1_048_576) return null;
  if (!Array.isArray(v.layers)) return null;
  const total = cols * rows;
  const layers: PaintedOverlayLayer[] = [];
  for (const layer of v.layers) {
    if (!layer || typeof layer.color !== 'string' || !COLOR_SHAPE.test(layer.color)) return null;
    if (!Array.isArray(layer.cells)) return null;
    const cells: number[] = [];
    for (const idx of layer.cells) {
      if (Number.isInteger(idx) && idx >= 0 && idx < total) cells.push(idx);
    }
    layers.push({ color: layer.color, cells });
  }
  return { version: 1, stamp: v.stamp, cols, rows, layers, paintDoc: v.paintDoc };
}

/** Does the overlay paint anything? (Empty overlays save as REMOVALS.) */
export function paintedOverlayHasContent(overlay: PaintedOverlay): boolean {
  return overlay.layers.some((layer) => layer.cells.length > 0);
}

// ── texture-key recipes (content-addressed — the carve_lab stale-bake law) ───
// The STAMP is the content address: a re-save mints a new stamp, so consumers
// re-bake exactly when the painting changed and never sooner.

export function figurePaintTextureKey(part: string, stamp: number): string {
  return `painted.figure.${part}.${stamp}`;
}

export function vehiclePaintTextureKey(part: string, stamp: number): string {
  return `painted.vehicle.${part}.${stamp}`;
}

// ── the bake's Effect packing (paintedRender.tsx + tests share it) ────────────
// data = [cols, rows, r, g, b, a, ...cols×rows cell flags] per layer quad —
// the cell-mode idiom (one float per cell; grids are small by construction).

export function hexChannel(hex: string, i: number): number {
  return parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
}

export function packPaintedLayerData(overlay: PaintedOverlay, layerIndex: number): number[] {
  const layer = overlay.layers[layerIndex];
  const total = overlay.cols * overlay.rows;
  const data = new Array<number>(6 + total);
  data[0] = overlay.cols;
  data[1] = overlay.rows;
  data[2] = hexChannel(layer.color, 0);
  data[3] = hexChannel(layer.color, 1);
  data[4] = hexChannel(layer.color, 2);
  data[5] = layer.color.length === 9 ? hexChannel(layer.color, 3) : 1;
  for (let i = 0; i < total; i++) data[6 + i] = 0;
  for (const idx of layer.cells) data[6 + idx] = 1;
  return data;
}

/** One baked layer as a fragment fill: cell lookup → premultiplied color
 *  (the painter's own shader output convention). No backticks, no unary +. */
export const PAINTED_LAYER_WGSL = `
@group(0) @binding(1) var<storage, read> data: array<f32>;

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let cols = u32(data[0]);
  let rows = u32(data[1]);
  let cx = min(u32(in.uv.x * f32(cols)), cols - 1u);
  let cy = min(u32(in.uv.y * f32(rows)), rows - 1u);
  let on = data[6u + cy * cols + cx];
  let a = data[5] * on;
  if (a < 0.005) { return vec4f(0.0); }
  return vec4f(data[2] * a, data[3] * a, data[4] * a, a);
}
`;
