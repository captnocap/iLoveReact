// editors/model/textureize.ts — the GLOBAL "textureize" pack (USER req_1068): take
// the WHOLE SCENE and build ONE square sprite-map atlas, exactly the Blockbench
// "Create Texture" flow. Every face of every part becomes a packed ISLAND in a
// shared atlas, and each face's `uv` is rewritten into its slot — so all parts
// sample ONE texture (the sprite map). Pure + headless (the editMesh idiom) so
// textureize.test.ts proves the pack; no React, no Scene3D.
//
// Each island carries its OUTLINE (the cookie cutter, USER req_1069) + its atlas
// slot, so the downstream piece-by-piece image-to-image flow (send one island to
// an image model → mask the result to the outline → scale it back into the slot)
// needs no re-pack. The actual AI generate/mask/composite is Phase 5d; this module
// is the foundation that carries the outlines. See ../MESH_EDITOR_PLAYBOOK.md 5.6.

import { storedUVLayout, unwrapMesh, type EditMesh, type V2 } from './editMesh';
import { groupByShape } from './uvDedup';

/** Two UV loops equal within a texel-scale epsilon — lets the repack keep unchanged
 *  face refs (idempotent re-pack, req_1320). */
function uvEqual(a: V2[], b: V2[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (Math.abs(a[i][0] - b[i][0]) > 1e-6 || Math.abs(a[i][1] - b[i][1]) > 1e-6) return false;
  return true;
}

/** Texture Template = the colored per-island UV template (the default + the
 *  point); Solid Color = one flat fill; Blank = empty. (Blockbench's Type seg.) */
export type TextureType = 'template' | 'solid' | 'blank';

/** The Create Texture dialog's options — Blockbench's exact fields. The ones that
 *  change the pack today: density (resolution), rearrangeUV (repack), powerOfTwo,
 *  padding. combineIslands + the angle thresholds + keepOccupancy are surfaced for
 *  parity and carried through; their effect is the Phase-2 island-merge step. */
export type TextureOptions = {
  name: string;
  type: TextureType;
  /** texels per 16 model-units (a Blockbench "pixel"): 16x ≈ 1 texel/unit, 32x = 2×… */
  density: number;
  /** the fill for Solid Color type. */
  color: string;
  rearrangeUV: boolean;
  powerOfTwo: boolean;
  keepOccupancy: boolean;
  combineIslands: boolean;
  edgeAngle: number;
  islandAngle: number;
  padding: boolean;
  /** gutter width in texels when padding is on (default PAD_TEXELS). The PAINT atlas
   *  uses a wider gutter so a face's paint can bleed into it (edge dilation) without
   *  reaching a neighbour slot — kills seams without cross-contamination (req_1305). */
  padTexels?: number;
  /** DEDUP congruent faces to one shared atlas island (req_1255 — store each
   *  distinct shape once, reference it). Shrinks the atlas + makes matching panels
   *  paint uniformly. Off → one island per face (the legacy product layout). */
  dedupIslands: boolean;
};

/** The Pixel Density dropdown (Blockbench: 16x is the baseline). */
export const PIXEL_DENSITIES = [16, 32, 64, 128] as const;

export const DEFAULT_TEXTURE_OPTIONS: TextureOptions = {
  name: 'texture',
  type: 'template',
  density: 16,
  color: '#9b8c7a',
  rearrangeUV: true,
  powerOfTwo: true,
  keepOccupancy: true,
  combineIslands: true,
  edgeAngle: 36,
  islandAngle: 45,
  padding: true,
  dedupIslands: true,
};

/** 16 units = 1 tile = 1 m (STUDIO.unitsPerTile) — the Blockbench-pixel basis the
 *  density is measured against. Passed in by the caller (Studio) so this stays a
 *  pure module; the default keeps the test self-contained. */
export const TEXTURE_UNITS_PER_METER = 16;

/** the gutter between islands, in texels, when Padding is on (stops texel bleed). */
const PAD_TEXELS = 1;
/** keep an atlas sane even for a huge / tiny scene. */
const MIN_TEXELS = 16;
const MAX_TEXELS = 1024;

// pastels for the Texture Template render — a stable cycle (image-4 look). Exported
// so the atlas render colors islands the SAME way the packer does (rule of two).
export const ISLAND_PALETTE = ['#d8dee9', '#a3d9a5', '#e9a8b8', '#e9dca8', '#8fb9e9', '#c5a8e9', '#a8e9d6', '#e9c5a8'];
const PALETTE = ISLAND_PALETTE;

/** THE one island color (req_1072): a STABLE per-(part, face) palette pick used by
 *  the 3D atlas render, the UV panel, AND the PNG export — so all three show the
 *  EXACT same colors (the user's "the UV should be exactly what's on the model").
 *  Deterministic from the part id hash + face index: consecutive faces cycle the
 *  palette (always distinct within a part), different parts offset by their hash. */
export function islandColorIndex(partId: string, faceIndex: number): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < partId.length; i += 1) { h ^= partId.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return ((h + faceIndex) % ISLAND_PALETTE.length + ISLAND_PALETTE.length) % ISLAND_PALETTE.length;
}
export function islandColorFor(partId: string, faceIndex: number): string {
  return ISLAND_PALETTE[islandColorIndex(partId, faceIndex)];
}

/** One packed island = one face's UV piece in the shared atlas. */
export type TextureIsland = {
  /** index into the parts passed to textureizeScene. */
  part: number;
  /** face index within that part's mesh. */
  face: number;
  /** the packed atlas slot, in TEXELS (the bin-pack result). */
  slot: { x: number; y: number; w: number; h: number };
  /** the island OUTLINE in atlas TEXELS — the cookie cutter (req_1069). */
  outline: V2[];
  /** the island outline NORMALIZED [0,1] in the atlas — this IS the stored uv. */
  uv: V2[];
  /** a stable pastel for the Texture Template render. */
  color: string;
};

export type SceneTexture = {
  /** atlas edge length in texels (square, power-of-two when requested). */
  texels: number;
  islands: TextureIsland[];
  /** the parts with their face `uv` rewritten into the shared atlas. */
  meshes: EditMesh[];
  options: TextureOptions;
};

function nextPow2(n: number): number {
  if (n <= 1) return 1;
  return 1 << Math.ceil(Math.log2(n));
}

/** Build the sprite-map atlas for a whole scene. Per-face islands are projected
 *  (reusing unwrapMesh's box projection), scaled by Pixel Density, and shelf-packed
 *  into one square atlas (Padding gutters, Power-of-2 rounding); every face's `uv`
 *  is rewritten into its slot. Deterministic (stable sort) so the layout + colors
 *  are reproducible. `rearrangeUV: false` keeps the current UVs (no repack), still
 *  reporting islands/outlines from the stored mapping. */
export function textureizeScene(meshes: EditMesh[], opts: TextureOptions, unitsPerMeter = TEXTURE_UNITS_PER_METER, fitTexels?: number): SceneTexture {
  const pad = opts.padding ? (opts.padTexels ?? PAD_TEXELS) : 0;

  // 0. unwrap every part once (origin-local face rects, in UNITS at this stage).
  const layouts = meshes.map((mesh) => unwrapMesh(mesh, unitsPerMeter, 0)); // pad 0 — our own gutter below

  // `t` = texels per unit. Normally density/16 (the Pixel Density dial). For PAINT
  // (req_1207/1209) the caller passes `fitTexels`: a FIXED target atlas size so the
  // grid is the same regardless of model size (a face sits on a fixed global grid, no
  // bleed — the grid IS the packed atlas). We size `t` so the packed extent ≈ fitTexels
  // by estimating the shelf-pack extent (√area, shelf packs ~80% dense → /0.85).
  let t = Math.max(1e-6, opts.density / 16);
  if (fitTexels && fitTexels > 0) {
    let area = 0, widest = 0;
    for (const layout of layouts) for (const f of layout.faces) {
      area += Math.max(0.001, f.rect.w) * Math.max(0.001, f.rect.h);
      widest = Math.max(widest, f.rect.w, f.rect.h);
    }
    const naturalExtent = Math.max(widest, Math.sqrt(area) / 0.85, 1e-6);
    t = (fitTexels * 0.92) / naturalExtent; // 0.92 headroom so nextPow2 rarely overshoots
  }

  // 1. project + measure every face into texel space (origin-local), scaled by `t`.
  type Raw = { part: number; face: number; w: number; h: number; local: V2[] };
  const raws: Raw[] = [];
  layouts.forEach((layout, pi) => {
    for (const f of layout.faces) {
      const local = f.poly.map(([u, v]) => [(u - f.rect.x) * t, (v - f.rect.y) * t] as V2);
      raws.push({ part: pi, face: f.faceIndex, w: Math.max(1, f.rect.w * t), h: Math.max(1, f.rect.h * t), local });
    }
  });

  if (raws.length === 0) {
    return { texels: MIN_TEXELS, islands: [], meshes, options: opts };
  }

  // 2. DEDUP congruent faces (req_1255, the GUIDING_LIGHT "store once, reference"
  //    law): group faces by shape so each DISTINCT shape packs ONE slot and every
  //    congruent member references it. Off → one group per face (the product, the
  //    old behaviour). A face's local poly is min-normalized, so every member of a
  //    group lands on its slot corner-for-corner — no rotation transform needed.
  const groups = opts.dedupIslands
    ? groupByShape(raws, (r) => r.local)
    : raws.map((_, i) => ({ rep: i, members: [i] }));

  // shelf-pack the REPRESENTATIVES tallest-first into a near-square atlas. Members
  // share their group's slot. Deterministic order → reproducible sprite map.
  const totalArea = groups.reduce((s, g) => { const r = raws[g.rep]; return s + (r.w + pad) * (r.h + pad); }, 0);
  const widest = groups.reduce((s, g) => Math.max(s, raws[g.rep].w + pad), 0);
  const rowWidth = Math.max(widest, Math.ceil(Math.sqrt(totalArea)));
  const order = groups.slice().sort((a, b) => { const ra = raws[a.rep], rb = raws[b.rep]; return rb.h - ra.h || rb.w - ra.w || ra.part - rb.part || ra.face - rb.face; });

  const pos = new Map<string, { x: number; y: number }>(); // part:face → slot (shared within a group)
  let cx = 0, cy = 0, rowH = 0, atlasW = 0;
  for (const g of order) {
    const r = raws[g.rep];
    if (cx > 0 && cx + r.w + pad > rowWidth) { cx = 0; cy += rowH; rowH = 0; } // wrap to a new shelf
    for (const mi of g.members) { const m = raws[mi]; pos.set(`${m.part}:${m.face}`, { x: cx, y: cy }); }
    cx += r.w + pad;
    if (r.h + pad > rowH) rowH = r.h + pad;
    if (cx > atlasW) atlasW = cx;
  }
  const extent = Math.max(atlasW, cy + rowH, MIN_TEXELS);
  let texels = opts.powerOfTwo ? nextPow2(extent) : Math.ceil(extent);
  texels = Math.min(MAX_TEXELS, Math.max(MIN_TEXELS, texels));

  // 3. UVs: EVERY face gets its uv (members of a group share their slot → identical
  //    uv within the group). ISLANDS: one per distinct shape (the rep), so the atlas
  //    + UV panel show K shapes, not N faces. Stable color by rep part/face order.
  const islands: TextureIsland[] = [];
  const uvByPart = new Map<number, Map<number, V2[]>>();
  for (const r of raws) {
    const p = pos.get(`${r.part}:${r.face}`)!;
    const uv = r.local.map(([u, v]) => [(u + p.x) / texels, (v + p.y) / texels] as V2);
    let m = uvByPart.get(r.part);
    if (!m) { m = new Map(); uvByPart.set(r.part, m); }
    m.set(r.face, uv);
  }
  const colorOf = new Map<number, number>(); // group index → palette slot
  groups.map((g, gi) => ({ gi, r: raws[g.rep] })).sort((a, b) => a.r.part - b.r.part || a.r.face - b.r.face).forEach((e, i) => colorOf.set(e.gi, i));
  groups.forEach((g, gi) => {
    const r = raws[g.rep];
    const p = pos.get(`${r.part}:${r.face}`)!;
    const outline = r.local.map(([u, v]) => [u + p.x, v + p.y] as V2);
    const uv = outline.map(([u, v]) => [u / texels, v / texels] as V2);
    islands.push({ part: r.part, face: r.face, slot: { x: p.x, y: p.y, w: r.w, h: r.h }, outline, uv, color: PALETTE[(colorOf.get(gi) ?? 0) % PALETTE.length] });
  });

  // 4. rewrite each part's face UVs into the shared atlas (the BRANCH edit the
  //    caller commits). rearrangeUV: false keeps the meshes as-is (no repack).
  //    IDEMPOTENT: a face whose UV is already its packed slot keeps its exact ref, and
  //    an unchanged mesh returns its exact ref — so re-packing identical geometry is a
  //    no-op the caller can skip (no spurious mesh edit, no re-bake churn, req_1320).
  const meshesOut = opts.rearrangeUV
    ? meshes.map((mesh, pi) => {
        const m = uvByPart.get(pi);
        if (!m) return mesh;
        let changed = false;
        const faces = mesh.faces.map((face, fi) => {
          const uv = m.get(fi);
          if (!uv || (face.uv && uvEqual(face.uv, uv))) return face;
          changed = true;
          return { ...face, uv };
        });
        return changed ? { ...mesh, faces } : mesh;
      })
    : meshes;

  return { texels, islands, meshes: meshesOut, options: opts };
}

// ── PNG export raster (req_1072) ──────────────────────────────────────────────
// Rasterize the sprite-map atlas (or ONE slice) to a tight RGBA buffer the PNG
// encoder consumes. Pure + headless. Each island is filled with its `islandColorFor`
// color (so the export matches the model + the UV panel EXACTLY) clipped to the
// island OUTLINE (the cookie cutter) — a slice is one island cropped to its slot.

export type ScenePartRef = { id: string; mesh: EditMesh };
export type RasterSlice = { partId: string; faceIndex: number };
export type RasterImage = { rgba: Uint8Array; width: number; height: number };

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function pointInPoly(px: number, py: number, poly: V2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/** Rasterize the WHOLE atlas (texels²) or, with `slice`, just one island cropped to
 *  its atlas slot — the cookie-cutter silhouette filled with its island color on a
 *  transparent ground (the image-to-image piece, req_1069). Solid type = a flat
 *  fill; Blank = transparent. The poly is read from the parts' STORED UVs, so the
 *  raster is the same mapping the mesh samples. */
export function rasterizeAtlas(parts: ScenePartRef[], texels: number, type: TextureType, color: string, slice?: RasterSlice): RasterImage {
  type Isl = { poly: V2[]; rect: { x: number; y: number; w: number; h: number }; color: string };
  const islands: Isl[] = [];
  for (const part of parts) {
    const layout = storedUVLayout(part.mesh, texels);
    for (const f of layout.faces) {
      if (slice && !(part.id === slice.partId && f.faceIndex === slice.faceIndex)) continue;
      islands.push({ poly: f.poly, rect: f.rect, color: islandColorFor(part.id, f.faceIndex) });
    }
  }

  // canvas: the whole square, or the slice's slot bbox.
  let ox = 0, oy = 0, W = Math.max(1, Math.round(texels)), H = W;
  if (slice) {
    if (islands.length === 0) return { rgba: new Uint8Array(4), width: 1, height: 1 };
    const r = islands[0].rect;
    ox = Math.floor(r.x); oy = Math.floor(r.y);
    W = Math.max(1, Math.ceil(r.w)); H = Math.max(1, Math.ceil(r.h));
  }

  const rgba = new Uint8Array(W * H * 4); // transparent ground
  const put = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 4;
    rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
  };

  if (type === 'solid') {
    const [r, g, b] = hexToRgb(color);
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) put(x, y, r, g, b);
    return { rgba, width: W, height: H };
  }
  if (type === 'blank') return { rgba, width: W, height: H }; // empty (transparent)

  // template: fill each island's silhouette with its color (the cookie cutter).
  for (const isl of islands) {
    const [r, g, b] = hexToRgb(isl.color);
    const x0 = Math.max(0, Math.floor(isl.rect.x) - ox), x1 = Math.min(W - 1, Math.ceil(isl.rect.x + isl.rect.w) - ox);
    const y0 = Math.max(0, Math.floor(isl.rect.y) - oy), y1 = Math.min(H - 1, Math.ceil(isl.rect.y + isl.rect.h) - oy);
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        if (pointInPoly(x + ox + 0.5, y + oy + 0.5, isl.poly)) put(x, y, r, g, b);
      }
    }
  }
  return { rgba, width: W, height: H };
}
