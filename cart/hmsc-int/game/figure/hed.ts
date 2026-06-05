// game/figure/hed.ts — .hed, the "head document": one self-contained sculpted
// head as a signed depth grid + N colored FEATURE layers, all in the SAME
// unwrap space (the 2:1 equirect of Geometry.Globe — face at u=0.5, v down,
// seam hidden at the back).
//
// The shared space is the whole trick: a feature layer is shapes + a color +
// a signed depth, so "nose" isn't a picture of a nose — it's an ellipse at a
// canonical unwrap position that paints skin-shadow AND bulges outward. Color
// and relief can never drift apart because they're the same shapes in the
// same coordinates. That's also what makes faces GENERATABLE (V2-AMENDED:
// "the variety of life is the right shape"): generateFace places shapes at
// face-anatomy positions with seeded variation, coherent by construction.
//
// Animations are pure document transforms — (doc, anim, phase) → doc with the
// affected layers replaced — deterministic per (anim, phase), so texture/mesh
// keys stay content-addressed: a loop cycles N cached bakes, not N×time.
//
// On disk: <stem>.hed.json (`kind: 'hed'` magic + version). Captured fresh
// from cart/head_lab/hed.ts (V2 behavior reference, untouched).

import { darkenHex } from './math';

// Grid constraints — in lockstep with the unwrap painter and the Globe bake:
// depth grid 48×24, texture bake 512×256. Shape coords are unwrap-UV (0..1),
// so the same numbers index the texture, the depth grid, and the globe's UVs.
export const HED_GRID_W = 48;
export const HED_GRID_H = 24;
export const HED_TEX_W = 512;
export const HED_TEX_H = 256;

export type HedShape = {
  kind: 'ellipse' | 'rect';
  /** center in unwrap UV. u=0.5 is the middle of the face. */
  cx: number;
  cy: number;
  /** radii (half-extents) — rx in u-units, ry in v-units. */
  rx: number;
  ry: number;
  /** also stamp the shape mirrored across u=0.5 (eyes, brows, ears...) */
  mirror?: boolean;
};

export type HedLayer = {
  id: string;
  label: string;
  /** '#RRGGBB' or '#RRGGBBAA' paint; null = depth-only (invisible relief) */
  color: string | null;
  /** signed depth stamped under the shapes, −1..1; 0 = color-only */
  depth: number;
  /** edge softness as a fraction of the radius. Applies to the DEPTH stamp;
   *  color edges stay hard (the chunky register reads better). */
  feather?: number;
  shapes: HedShape[];
};

export type HedDocument = {
  kind: 'hed';
  version: 1;
  /** depth grid resolution (row-major, row 0 = unwrap top) */
  cols: number;
  rows: number;
  skin: string;
  /** world units of displacement at depth 1 */
  amount: number;
  /** vertical skull stretch */
  scaleY: number;
  /** hand-sculpt residue, quantized signed bytes (−127..127), cols×rows.
   *  Composites additively UNDER the layers' depth stamps. */
  sculpt: number[];
  layers: HedLayer[];
  metadata?: {
    title?: string;
    seed?: number;
    createdAt?: number;
  };
};

// ── build / parse / serialize ────────────────────────────────────────────────

export function buildHed(args: {
  skin: string;
  amount: number;
  scaleY: number;
  /** signed floats −1..1 (a live edit grid); quantized to bytes here */
  sculpt: number[];
  layers: HedLayer[];
  title?: string;
  seed?: number;
}): HedDocument {
  return {
    kind: 'hed',
    version: 1,
    cols: HED_GRID_W,
    rows: HED_GRID_H,
    skin: args.skin,
    amount: args.amount,
    scaleY: args.scaleY,
    sculpt: args.sculpt.map((v) => Math.max(-127, Math.min(127, Math.round(v * 127)))),
    layers: args.layers,
    metadata: { title: args.title, seed: args.seed, createdAt: Date.now() },
  };
}

export function parseHed(text: string): HedDocument | null {
  let doc: any;
  try { doc = JSON.parse(text); } catch { return null; }
  if (!doc || doc.kind !== 'hed' || doc.version !== 1) return null;
  if (typeof doc.cols !== 'number' || typeof doc.rows !== 'number') return null;
  if (!Array.isArray(doc.sculpt) || !Array.isArray(doc.layers)) return null;
  if (doc.sculpt.length !== doc.cols * doc.rows) return null;
  for (const layer of doc.layers) {
    if (!layer || typeof layer.id !== 'string' || !Array.isArray(layer.shapes)) return null;
    if (typeof layer.depth !== 'number') return null;
  }
  return doc as HedDocument;
}

export function serializeHed(doc: HedDocument): string {
  return JSON.stringify(doc);
}

// ── depth compositing ────────────────────────────────────────────────────────

// Coverage of one shape (plus its mirror twin) at unwrap point (u, v): 1 at
// center → 0 outside; `feather` widens the soft band. u-distance wraps the
// seam so shapes near u=0/1 stay round.
function shapeCoverage(shape: HedShape, feather: number, u: number, v: number): number {
  let best = 0;
  const centers = shape.mirror ? [shape.cx, 1 - shape.cx] : [shape.cx];
  for (const cx of centers) {
    let du = Math.abs(u - cx);
    if (du > 0.5) du = 1 - du; // seam wrap
    const dv = Math.abs(v - shape.cy);
    let t: number;
    if (shape.kind === 'rect') {
      t = Math.max(du / shape.rx, dv / shape.ry);
    } else {
      const nx = du / shape.rx;
      const ny = dv / shape.ry;
      t = Math.sqrt(nx * nx + ny * ny);
    }
    // t: 0 center, 1 silhouette. Hard inside (1-feather), smooth to 0 at edge.
    const soft = Math.max(feather, 1e-4);
    const cov = t <= 1 - soft ? 1 : Math.max(0, (1 - t) / soft);
    if (cov > best) best = cov;
  }
  return best;
}

/** The document's full displacement grid: hand-sculpt residue + every layer's
 *  depth stamp, clamped signed −1..1. Feed straight into Geometry.Globe. */
export function hedDepthGrid(doc: HedDocument): number[] {
  const out = new Array(doc.cols * doc.rows).fill(0);
  for (let i = 0; i < out.length; i++) out[i] = (doc.sculpt[i] ?? 0) / 127;
  for (const layer of doc.layers) {
    if (layer.depth === 0) continue;
    const feather = layer.feather ?? 0.35;
    for (let gy = 0; gy < doc.rows; gy++) {
      const v = (gy + 0.5) / doc.rows;
      for (let gx = 0; gx < doc.cols; gx++) {
        const u = (gx + 0.5) / doc.cols;
        let cov = 0;
        for (const shape of layer.shapes) {
          const c = shapeCoverage(shape, feather, u, v);
          if (c > cov) cov = c;
        }
        if (cov <= 0) continue;
        const i = gy * doc.cols + gx;
        out[i] = Math.max(-1, Math.min(1, out[i] + layer.depth * cov));
      }
    }
  }
  return out;
}

// ── face animation — pure document transforms ────────────────────────────────

export type HedAnimation = 'talk' | 'chew' | 'cry' | 'yell';

/** Loop length per animation — drive with `frame % HED_ANIM_FRAMES[anim]`. */
export const HED_ANIM_FRAMES: Record<HedAnimation, number> = { talk: 4, chew: 4, cry: 6, yell: 4 };

function firstShape(doc: HedDocument, layerId: string): HedShape | null {
  const layer = doc.layers.find((l) => l.id === layerId);
  return layer && layer.shapes.length > 0 ? layer.shapes[0] : null;
}

function layerColor(doc: HedDocument, layerId: string, fallback: string): string {
  const layer = doc.layers.find((l) => l.id === layerId);
  return layer?.color ?? fallback;
}

export function animateHed(doc: HedDocument, anim: HedAnimation, phase: number): HedDocument {
  // Anchors from the doc's own layers (hand-authored docs without them get the
  // generator's canonical positions).
  const mouth = firstShape(doc, 'mouth') ?? { kind: 'ellipse' as const, cx: 0.5, cy: 0.68, rx: 0.034, ry: 0.016 };
  const eye = firstShape(doc, 'whites') ?? { kind: 'ellipse' as const, cx: 0.442, cy: 0.43, rx: 0.022, ry: 0.042, mirror: true };
  const lipColor = layerColor(doc, 'mouth', '#7a4a3a');

  if (anim === 'talk') {
    // jaw flaps: closed → half → open(+teeth) → half
    const open = [0, 0.5, 1, 0.5][phase % 4];
    const mouthLayers: HedLayer[] =
      open === 0
        ? [{ id: 'mouth', label: 'mouth', color: lipColor, depth: -0.07, feather: 0.4, shapes: [mouth] }]
        : [
            {
              id: 'mouth', label: 'mouth (open)', color: '#2a1410', depth: -0.16 - 0.22 * open, feather: 0.4,
              shapes: [{ kind: 'ellipse', cx: mouth.cx, cy: mouth.cy + 0.012 * open, rx: Math.max(mouth.rx, 0.028), ry: 0.014 + 0.030 * open }],
            },
            ...(open === 1
              ? [{
                  id: 'teeth', label: 'teeth', color: '#e8e2d4', depth: 0,
                  shapes: [{ kind: 'rect' as const, cx: mouth.cx, cy: mouth.cy - 0.014, rx: Math.max(mouth.rx, 0.028) * 0.7, ry: 0.006 }],
                }]
              : []),
          ];
    return { ...doc, layers: doc.layers.filter((l) => l.id !== 'mouth').concat(mouthLayers) };
  }

  if (anim === 'yell') {
    const open = [0.65, 1, 0.92, 1][phase % 4];
    const mouthLayers: HedLayer[] = [
      {
        id: 'mouth', label: 'mouth (yell)', color: '#1b0d0a', depth: -0.28 - 0.18 * open, feather: 0.45,
        shapes: [{ kind: 'ellipse', cx: mouth.cx, cy: mouth.cy + 0.02 * open, rx: Math.max(mouth.rx * 1.18, 0.038), ry: 0.032 + 0.04 * open }],
      },
      {
        id: 'teeth', label: 'teeth', color: '#efe8dc', depth: 0,
        shapes: [
          { kind: 'rect', cx: mouth.cx, cy: mouth.cy - 0.018, rx: Math.max(mouth.rx, 0.032) * 0.72, ry: 0.006 },
          { kind: 'rect', cx: mouth.cx, cy: mouth.cy + 0.032, rx: Math.max(mouth.rx, 0.032) * 0.58, ry: 0.005 },
        ],
      },
    ];
    return { ...doc, layers: doc.layers.filter((l) => l.id !== 'mouth' && l.id !== 'teeth').concat(mouthLayers) };
  }

  if (anim === 'chew') {
    // closed-mouth munch: the wad bulges one cheek, then the other; the mouth
    // wiggles slightly off-axis on the in-between frames.
    const side = [-1, 0, 1, 0][phase % 4];
    const wobble = (phase % 2) * 0.008;
    const layers = doc.layers
      .filter((l) => l.id !== 'mouth')
      .concat([
        {
          id: 'mouth', label: 'mouth (chewing)', color: lipColor, depth: -0.07, feather: 0.4,
          shapes: [{ kind: 'ellipse', cx: mouth.cx + wobble * 0.5, cy: mouth.cy + wobble, rx: mouth.rx, ry: mouth.ry }],
        },
        {
          id: 'chew-wad', label: 'chew wad', color: null, depth: 0.24, feather: 0.6,
          shapes: side === 0 ? [] : [{ kind: 'ellipse', cx: mouth.cx + side * 0.055, cy: mouth.cy - 0.03, rx: 0.028, ry: 0.05 }],
        },
      ]);
    return { ...doc, layers };
  }

  // cry: sad brows, squeezed eyes, frown, and two tears running down each
  // cheek (offset half a loop apart so there's always one falling).
  const t = phase % 6;
  const browColor = layerColor(doc, 'brows', '#2a2018');
  const tearY = (k: number) => eye.cy + 0.055 + (((t + k) % 6) / 6) * 0.17;
  const layers = doc.layers
    .filter((l) => l.id !== 'mouth' && l.id !== 'brows')
    .concat([
      {
        // sad brows: inner ends pulled up, outer ends dropped
        id: 'brows', label: 'brows (sad)', color: browColor, depth: 0.05, feather: 0.3,
        shapes: [
          { kind: 'rect', cx: eye.cx + 0.014, cy: eye.cy - 0.064, rx: 0.013, ry: 0.009, mirror: true },
          { kind: 'rect', cx: eye.cx - 0.012, cy: eye.cy - 0.050, rx: 0.014, ry: 0.009, mirror: true },
        ],
      },
      {
        // squeezed lids over the top half of the whites
        id: 'lids', label: 'lids', color: darkenHex(doc.skin, 0.82), depth: 0,
        shapes: [{ kind: 'rect', cx: eye.cx, cy: eye.cy - 0.018, rx: eye.rx + 0.002, ry: 0.018, mirror: true }],
      },
      {
        id: 'mouth', label: 'mouth (frown)', color: lipColor, depth: -0.07, feather: 0.4,
        shapes: [
          { kind: 'ellipse', cx: mouth.cx, cy: mouth.cy + (t % 2) * 0.006, rx: mouth.rx * 0.8, ry: 0.014 },
          { kind: 'ellipse', cx: mouth.cx - mouth.rx * 0.8, cy: mouth.cy + 0.012, rx: 0.008, ry: 0.011, mirror: true },
        ],
      },
      {
        id: 'tears', label: 'tears', color: '#8fd4f6', depth: 0,
        shapes: [
          { kind: 'ellipse', cx: eye.cx, cy: tearY(0), rx: 0.006, ry: 0.014, mirror: true },
          { kind: 'ellipse', cx: eye.cx + 0.005, cy: tearY(3), rx: 0.004, ry: 0.010, mirror: true },
        ],
      },
    ]);
  return { ...doc, layers };
}

// ── face generation — seeded variety (V2-AMENDED: the generators stay) ──────

/** Deterministic seeded rand (mulberry32) — same seed, same face. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, list: T[]): T {
  return list[Math.floor(r() * list.length) % list.length];
}

// The generator's palettes — seeded-variety data (P2).
export const FACE_GEN_PALETTES = {
  skins: ['#caa07a', '#8d5a3c', '#e0b48c', '#a9785a', '#6e4a32'],
  hair: ['#2a2018', '#4a3520', '#1a1a1e', '#6b4a26', '#7a7570', '#3a2a3e'],
  eyes: ['#4a3220', '#2f5d8a', '#456b3a', '#5a4632', '#3a2a1a'],
  lips: ['#98505d', '#a85c66', '#7f454a', '#b46b72'],
} as const;

export type FaceStyle = 'masculine' | 'feminine';

/** Generate a coherent face as a head document. Anatomy lives at canonical
 *  unwrap positions; the seed varies colors, proportions, hair, and mood.
 *  Color and depth are placed by the SAME shapes, so features always agree. */
export function generateFace(seed: number, opts?: { style?: FaceStyle }): HedDocument {
  const r = mulberry32(seed);
  const style = opts?.style ?? (r() < 0.45 ? 'feminine' : 'masculine');
  const feminine = style === 'feminine';
  const skin = pick(r, [...FACE_GEN_PALETTES.skins]);
  const hair = pick(r, [...FACE_GEN_PALETTES.hair]);
  const eye = pick(r, [...FACE_GEN_PALETTES.eyes]);
  const shade = darkenHex(skin, 0.8);
  const lip = feminine ? pick(r, [...FACE_GEN_PALETTES.lips]) : darkenHex(skin, 0.62);

  // seeded proportions (all in unwrap UV)
  const eyeU = 0.058 + r() * 0.016;          // eye offset from center
  const eyeV = feminine ? 0.39 + r() * 0.04 : 0.40 + r() * 0.05;
  const eyeRx = feminine ? 0.026 + r() * 0.004 : 0.022;
  const eyeRy = feminine ? 0.046 + r() * 0.006 : 0.042;
  const browTilt = feminine ? -0.004 + r() * 0.014 : (r() - 0.5) * 0.02;
  const mouthW = feminine ? 0.042 + r() * 0.018 : 0.030 + r() * 0.022;
  const mouthV = feminine ? 0.655 + r() * 0.026 : 0.66 + r() * 0.04;
  const hairLine = feminine ? 0.22 + r() * 0.11 : 0.16 + r() * 0.10;
  const jawW = feminine ? 0.078 + r() * 0.025 : 0.10 + r() * 0.04;
  const smile = r() > 0.5;
  const stubble = !feminine && r() > 0.65;

  // hair style — seeded variation. All pieces live in the same unwrap space:
  // the cap is a crown band, side curtains are mirrored ellipses at the
  // temples, back hair is a rect at u=0 (the seam IS the back of the head —
  // shapeCoverage wraps u, so it stays one piece).
  type HairStyle = 'crew' | 'buzz' | 'afro' | 'bald' | 'long' | 'bob' | 'bangs';
  const hairStyle: HairStyle = pick(r, feminine
    ? (['bob', 'long', 'bangs', 'crew'] as HairStyle[])
    : (['crew', 'crew', 'buzz', 'afro', 'long', 'bald'] as HairStyle[]));
  const hairLayers: HedLayer[] = [];
  if (hairStyle !== 'bald') {
    const capDepth = hairStyle === 'afro' ? 0.34 : hairStyle === 'buzz' ? 0.04 : feminine ? 0.18 : 0.16;
    const capLine = hairStyle === 'afro' ? Math.min(0.36, hairLine * 1.35) : hairLine;
    hairLayers.push({
      id: 'hair', label: `hair (${hairStyle})`, color: hairStyle === 'buzz' ? darkenHex(hair, 0.92) : hair,
      depth: capDepth, feather: hairStyle === 'afro' ? 0.32 : 0.5,
      shapes: [{ kind: 'rect', cx: 0.5, cy: capLine / 2, rx: 0.5, ry: capLine / 2 }],
    });
  }
  if (hairStyle === 'bob' || hairStyle === 'bangs') {
    hairLayers.push({
      id: 'sidehair', label: 'side hair', color: hair, depth: 0.12, feather: 0.45,
      shapes: [{ kind: 'ellipse', cx: 0.36, cy: 0.39, rx: 0.035, ry: 0.16, mirror: true }],
    });
    hairLayers.push({
      id: 'backhair', label: 'back hair', color: hair, depth: 0.1, feather: 0.5,
      shapes: [{ kind: 'rect', cx: 0, cy: 0.36, rx: 0.13, ry: 0.2 }],
    });
  }
  if (hairStyle === 'long') {
    // curtains past the ears + a back panel falling toward the neck
    hairLayers.push({
      id: 'sidehair', label: 'side hair', color: hair, depth: 0.13, feather: 0.45,
      shapes: [{ kind: 'ellipse', cx: 0.34, cy: 0.46, rx: 0.05, ry: 0.24, mirror: true }],
    });
    hairLayers.push({
      id: 'backhair', label: 'back hair', color: hair, depth: 0.12, feather: 0.5,
      shapes: [{ kind: 'rect', cx: 0, cy: 0.44, rx: 0.15, ry: 0.28 }],
    });
  }
  if (hairStyle === 'bangs') {
    hairLayers.push({
      id: 'bangs', label: 'bangs', color: hair, depth: 0.07, feather: 0.35,
      shapes: [{ kind: 'rect', cx: 0.5, cy: hairLine + 0.018, rx: 0.105, ry: 0.032 }],
    });
  }

  const layers: HedLayer[] = [
    ...hairLayers,
    // brow ridge + sockets: a soft raised band, then carved-in eye wells UNDER
    // where the eye whites will paint — relief first, paint on top.
    {
      id: 'browridge', label: 'brow ridge', color: null, depth: feminine ? 0.08 : 0.18, feather: 0.6,
      shapes: [{ kind: 'rect', cx: 0.5, cy: eyeV - 0.07, rx: 0.16, ry: 0.035 }],
    },
    {
      id: 'sockets', label: 'eye sockets', color: null, depth: feminine ? -0.14 : -0.22, feather: 0.55,
      shapes: [{ kind: 'ellipse', cx: 0.5 - eyeU, cy: eyeV, rx: 0.035, ry: 0.075, mirror: true }],
    },
    // brows — hair-colored bars riding the ridge
    {
      id: 'brows', label: 'brows', color: darkenHex(hair, 0.9), depth: 0.05, feather: 0.3,
      shapes: [{ kind: 'rect', cx: 0.5 - eyeU, cy: eyeV - 0.055 + browTilt, rx: feminine ? 0.022 : 0.026, ry: feminine ? 0.008 : 0.011, mirror: true }],
    },
    // eyes — whites, iris, pupil. Pure paint (depth 0): they sit inside the
    // sockets the layer above carved.
    {
      id: 'whites', label: 'eye whites', color: '#f2ece2', depth: 0,
      shapes: [{ kind: 'ellipse', cx: 0.5 - eyeU, cy: eyeV, rx: eyeRx, ry: eyeRy, mirror: true }],
    },
    {
      id: 'iris', label: 'iris', color: eye, depth: 0,
      shapes: [{ kind: 'ellipse', cx: 0.5 - eyeU, cy: eyeV + 0.004, rx: feminine ? 0.014 : 0.012, ry: feminine ? 0.029 : 0.026, mirror: true }],
    },
    {
      id: 'pupils', label: 'pupils', color: '#16120e', depth: 0,
      shapes: [{ kind: 'ellipse', cx: 0.5 - eyeU, cy: eyeV + 0.006, rx: 0.006, ry: 0.013, mirror: true }],
    },
    // nose — one shape, color AND ridge bulge together (the coherence demo)
    {
      id: 'nose', label: 'nose', color: shade, depth: feminine ? 0.36 : 0.5, feather: 0.5,
      shapes: [{ kind: 'ellipse', cx: 0.5, cy: 0.53, rx: feminine ? 0.013 : 0.016, ry: feminine ? 0.075 : 0.085 }],
    },
    // cheekbones — invisible relief
    {
      id: 'cheeks', label: 'cheeks', color: null, depth: feminine ? 0.18 : 0.14, feather: 0.7,
      shapes: [{ kind: 'ellipse', cx: 0.5 - eyeU - 0.01, cy: 0.56, rx: feminine ? 0.043 : 0.035, ry: feminine ? 0.055 : 0.06, mirror: true }],
    },
    // mouth — lips paint + a slight carve so the mouth line reads in profile
    {
      id: 'mouth', label: 'mouth', color: lip, depth: -0.07, feather: 0.4,
      shapes: smile
        ? [
            { kind: 'ellipse', cx: 0.5, cy: mouthV, rx: mouthW, ry: feminine ? 0.021 : 0.018 },
            { kind: 'ellipse', cx: 0.5 - mouthW, cy: mouthV - 0.012, rx: 0.008, ry: 0.012, mirror: true },
          ]
        : [{ kind: 'ellipse', cx: 0.5, cy: mouthV, rx: mouthW, ry: feminine ? 0.019 : 0.016 }],
    },
    // chin + jaw — invisible relief that squares the lower face
    {
      id: 'chin', label: 'chin', color: null, depth: feminine ? 0.1 : 0.2, feather: 0.65,
      shapes: [{ kind: 'ellipse', cx: 0.5, cy: feminine ? 0.79 : 0.80, rx: feminine ? 0.038 : 0.05, ry: feminine ? 0.055 : 0.07 }],
    },
    {
      id: 'jaw', label: 'jaw', color: null, depth: feminine ? 0.045 : 0.12, feather: 0.7,
      shapes: [{ kind: 'ellipse', cx: 0.5 - jawW, cy: 0.72, rx: feminine ? 0.026 : 0.04, ry: feminine ? 0.055 : 0.07, mirror: true }],
    },
    // ears — a quarter turn around from the face, color + stick-out
    {
      id: 'ears', label: 'ears', color: shade, depth: 0.4, feather: 0.35,
      shapes: [{ kind: 'ellipse', cx: 0.25, cy: 0.50, rx: 0.022, ry: 0.055, mirror: true }],
    },
  ];

  if (stubble) {
    layers.push({
      id: 'stubble', label: 'stubble', color: `${darkenHex(skin, 0.72)}66`, depth: 0,
      shapes: [{ kind: 'ellipse', cx: 0.5, cy: 0.76, rx: 0.10, ry: 0.13 }],
    });
  }

  return buildHed({
    skin, amount: feminine ? 0.31 : 0.35, scaleY: feminine ? 1.14 : 1.2,
    sculpt: new Array(HED_GRID_W * HED_GRID_H).fill(0),
    layers,
    title: `face ${seed}`,
    seed,
  });
}
