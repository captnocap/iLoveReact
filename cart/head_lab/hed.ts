// .hed — "head document". Self-contained sculpted head: a signed depth grid +
// N colored FEATURE layers, every one of them in the SAME unwrap space (the
// 2:1 equirect of Geometry.Globe: u across with the face at u=0.5, v down,
// seam hidden at the back). The .sqi idea applied to heads — any cart can
// parse one of these and rebuild both the head's texture AND its sculpt
// without head_lab, a photo, or any sibling files.
//
// The shared space is the whole trick. A feature layer is shapes + a color +
// a signed depth, so "nose" isn't a picture of a nose — it's an ellipse at a
// canonical unwrap position that paints skin-shadow AND bulges outward;
// "eye" is a white ellipse with zero depth over a wider carve-in socket
// layer. Color and relief can never drift apart because they're the same
// shapes in the same coordinates. That's also what makes faces GENERATABLE:
// generateFace() just places shapes at face-anatomy positions with seeded
// variation, and the result is coherent by construction.
//
// On disk: <stem>.hed.json — same convention as .sqi.json (JSON-highlightable,
// `kind: 'hed'` magic + version for cheap rejection of wrong files).
//
// Grid constraints come from head_lab and must stay in lockstep with it:
// depth grid 48×24 (HED_GRID_W/H), texture bake 512×256 (HED_TEX_W/H).
// Shape coords are unwrap-UV (0..1 each axis): rx is in u-units, ry in
// v-units, so the same numbers index the texture (×512/×256), the depth grid
// (×48/×24), and the globe's UVs directly.

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
  /** also stamp the shape mirrored across u=0.5 (eyes, brows, ears...). */
  mirror?: boolean;
};

export type HedLayer = {
  id: string;
  label: string;
  /** '#RRGGBB' or '#RRGGBBAA' paint; null = depth-only (invisible relief). */
  color: string | null;
  /** signed depth stamped under the shapes, −1..1; 0 = color-only. */
  depth: number;
  /** edge softness as a fraction of the radius (0 = hard edge, 1 = full
   *  falloff from center). Applies to the DEPTH stamp; color edges stay
   *  hard (the chunky register reads better). */
  feather?: number;
  shapes: HedShape[];
};

export type HedDocument = {
  kind: 'hed';
  version: 1;
  /** depth grid resolution (row-major, row 0 = unwrap top). */
  cols: number;
  rows: number;
  skin: string;
  /** world units of displacement at depth 1 (the lab's `amount` knob). */
  amount: number;
  /** vertical skull stretch (the lab's knob). */
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

// ── build / parse / serialize (the .sqi conventions) ────────────────────────

export function buildHed(args: {
  skin: string;
  amount: number;
  scaleY: number;
  /** signed floats −1..1 (the lab's live grid); quantized to bytes here. */
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

// ── face generation ──────────────────────────────────────────────────────────

// Deterministic seeded rand (mulberry32) — same seed, same face.
function rng(seed: number): () => number {
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

const GEN_SKINS = ['#caa07a', '#8d5a3c', '#e0b48c', '#a9785a', '#6e4a32'];
const GEN_HAIR = ['#2a2018', '#4a3520', '#1a1a1e', '#6b4a26', '#7a7570', '#3a2a3e'];
const GEN_EYES = ['#4a3220', '#2f5d8a', '#456b3a', '#5a4632', '#3a2a1a'];

function darken(hex: string, f: number): string {
  const c = (i: number) => Math.round(parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) * f).toString(16).padStart(2, '0');
  return `#${c(0)}${c(1)}${c(2)}`;
}

/** Generate a coherent face as a head document. Anatomy lives at canonical
 *  unwrap positions; the seed varies colors, proportions, hair, and mood.
 *  Color and depth are placed by the SAME shapes, so features always agree. */
export function generateFace(seed: number): HedDocument {
  const r = rng(seed);
  const skin = pick(r, GEN_SKINS);
  const hair = pick(r, GEN_HAIR);
  const eye = pick(r, GEN_EYES);
  const shade = darken(skin, 0.8);

  // seeded proportions (all in unwrap UV)
  const eyeU = 0.058 + r() * 0.016;          // eye offset from center
  const eyeV = 0.40 + r() * 0.05;            // eye height
  const browTilt = (r() - 0.5) * 0.02;       // grumpy ↔ surprised
  const mouthW = 0.030 + r() * 0.022;
  const mouthV = 0.66 + r() * 0.04;
  const hairLine = 0.16 + r() * 0.10;        // how far the hair reaches down
  const jawW = 0.10 + r() * 0.04;
  const smile = r() > 0.5;
  const stubble = r() > 0.65;

  const layers: HedLayer[] = [
    // hair cap — colors the crown band of the unwrap (wraps the whole back of
    // the head) and pads it slightly outward so hair reads as volume.
    {
      id: 'hair', label: 'hair', color: hair, depth: 0.16, feather: 0.5,
      shapes: [{ kind: 'rect', cx: 0.5, cy: hairLine / 2, rx: 0.5, ry: hairLine / 2 }],
    },
    // brow ridge + sockets: a soft raised band, then carved-in eye wells UNDER
    // where the eye whites will paint — relief first, paint on top.
    {
      id: 'browridge', label: 'brow ridge', color: null, depth: 0.18, feather: 0.6,
      shapes: [{ kind: 'rect', cx: 0.5, cy: eyeV - 0.07, rx: 0.16, ry: 0.035 }],
    },
    {
      id: 'sockets', label: 'eye sockets', color: null, depth: -0.22, feather: 0.55,
      shapes: [{ kind: 'ellipse', cx: 0.5 - eyeU, cy: eyeV, rx: 0.035, ry: 0.075, mirror: true }],
    },
    // brows — hair-colored bars riding the ridge
    {
      id: 'brows', label: 'brows', color: darken(hair, 0.9), depth: 0.05, feather: 0.3,
      shapes: [{ kind: 'rect', cx: 0.5 - eyeU, cy: eyeV - 0.055 + browTilt, rx: 0.026, ry: 0.011, mirror: true }],
    },
    // eyes — whites, iris, pupil. Pure paint (depth 0): they sit inside the
    // sockets the layer above carved.
    {
      id: 'whites', label: 'eye whites', color: '#f2ece2', depth: 0,
      shapes: [{ kind: 'ellipse', cx: 0.5 - eyeU, cy: eyeV, rx: 0.022, ry: 0.042, mirror: true }],
    },
    {
      id: 'iris', label: 'iris', color: eye, depth: 0,
      shapes: [{ kind: 'ellipse', cx: 0.5 - eyeU, cy: eyeV + 0.004, rx: 0.012, ry: 0.026, mirror: true }],
    },
    {
      id: 'pupils', label: 'pupils', color: '#16120e', depth: 0,
      shapes: [{ kind: 'ellipse', cx: 0.5 - eyeU, cy: eyeV + 0.006, rx: 0.006, ry: 0.013, mirror: true }],
    },
    // nose — one shape, color AND ridge bulge together (the coherence demo)
    {
      id: 'nose', label: 'nose', color: shade, depth: 0.5, feather: 0.5,
      shapes: [{ kind: 'ellipse', cx: 0.5, cy: 0.53, rx: 0.016, ry: 0.085 }],
    },
    // cheekbones — invisible relief
    {
      id: 'cheeks', label: 'cheeks', color: null, depth: 0.14, feather: 0.7,
      shapes: [{ kind: 'ellipse', cx: 0.5 - eyeU - 0.01, cy: 0.56, rx: 0.035, ry: 0.06, mirror: true }],
    },
    // mouth — lips paint + a slight carve so the mouth line reads in profile
    {
      id: 'mouth', label: 'mouth', color: darken(skin, 0.62), depth: -0.07, feather: 0.4,
      shapes: smile
        ? [
            { kind: 'ellipse', cx: 0.5, cy: mouthV, rx: mouthW, ry: 0.018 },
            { kind: 'ellipse', cx: 0.5 - mouthW, cy: mouthV - 0.012, rx: 0.008, ry: 0.012, mirror: true },
          ]
        : [{ kind: 'ellipse', cx: 0.5, cy: mouthV, rx: mouthW, ry: 0.016 }],
    },
    // chin + jaw — invisible relief that squares the lower face
    {
      id: 'chin', label: 'chin', color: null, depth: 0.2, feather: 0.65,
      shapes: [{ kind: 'ellipse', cx: 0.5, cy: 0.80, rx: 0.05, ry: 0.07 }],
    },
    {
      id: 'jaw', label: 'jaw', color: null, depth: 0.12, feather: 0.7,
      shapes: [{ kind: 'ellipse', cx: 0.5 - jawW, cy: 0.72, rx: 0.04, ry: 0.07, mirror: true }],
    },
    // ears — a quarter turn around from the face, color + stick-out
    {
      id: 'ears', label: 'ears', color: shade, depth: 0.4, feather: 0.35,
      shapes: [{ kind: 'ellipse', cx: 0.25, cy: 0.50, rx: 0.022, ry: 0.055, mirror: true }],
    },
  ];

  if (stubble) {
    layers.push({
      id: 'stubble', label: 'stubble', color: `${darken(skin, 0.72)}66`, depth: 0,
      shapes: [{ kind: 'ellipse', cx: 0.5, cy: 0.76, rx: 0.10, ry: 0.13 }],
    });
  }

  return buildHed({
    skin, amount: 0.35, scaleY: 1.2,
    sculpt: new Array(HED_GRID_W * HED_GRID_H).fill(0),
    layers,
    title: `face ${seed}`,
    seed,
  });
}
