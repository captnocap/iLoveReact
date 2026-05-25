// The authored city. NO procedural generation — every tile and prop is placed by
// hand. The old build streamed an infinite fbm-noise wilderness for testing; that
// is gone. The world is now a bounded neon-grime block laid out to TONE.md's
// dream↔squalor axis: a neon plaza at the heart, a market strip, pastel-stucco
// residential blocks, a canal + docks to the south, and a grimy industrial trap
// zone in the southeast.
//
// Layout is a list of rectangle "stamps" applied in order (later overwrites
// earlier) plus an explicit prop list. Readable, deterministic, editable.

export const enum T {
  Road = 0,
  Sidewalk = 1,
  Plaza = 2,
  Water = 3,
  Sand = 4,
  Grime = 5,
  Wall = 6,
}

export const CITY_W = 52;
export const CITY_H = 44;
export const VOID = -1; // outside the city: dusk fog, impassable

export type PropKind = 'palm' | 'dumpster' | 'sign';
export interface Prop {
  x: number;
  y: number;
  kind: PropKind;
  tint: number;
}

// ── stamps ────────────────────────────────────────────────────────────────────
type Rect = { x0: number; y0: number; x1: number; y1: number; t: T };
// A building: wall border, interior floor, and a 1-tile door punched in an edge.
type Bldg = { x0: number; y0: number; x1: number; y1: number; floor: T; door: [number, number] };

const FILL: T = T.Sidewalk; // base ground before anything is stamped

// Roads form a grid of blocks. Plaza is the central block. Buildings sit in the
// outer blocks; the canal eats the south-center; grime fills the southeast.
const RECTS: Rect[] = [
  // boulevards (asphalt), 3 tiles thick
  { x0: 2, y0: 10, x1: 49, y1: 12, t: T.Road }, // north boulevard
  { x0: 2, y0: 30, x1: 49, y1: 32, t: T.Road }, // south boulevard
  { x0: 12, y0: 2, x1: 14, y1: 41, t: T.Road }, // west avenue
  { x0: 36, y0: 2, x1: 38, y1: 41, t: T.Road }, // east avenue

  // central neon plaza (the dream)
  { x0: 16, y0: 14, x1: 35, y1: 29, t: T.Plaza },

  // grime / industrial flats (the squalor) — southeast
  { x0: 39, y0: 33, x1: 50, y1: 42, t: T.Grime },

  // canal + beach (south-center / southwest)
  { x0: 2, y0: 35, x1: 35, y1: 42, t: T.Water },
  { x0: 2, y0: 33, x1: 35, y1: 34, t: T.Sand }, // beach lip along the canal
];

// Buildings (walls with an interior floor + a door onto the street).
const BLDGS: Bldg[] = [
  // residential — northwest block (pastel apartment stacks)
  { x0: 2, y0: 2, x1: 10, y1: 8, floor: T.Sidewalk, door: [6, 8] },
  // residential — west block
  { x0: 2, y0: 14, x1: 9, y1: 21, floor: T.Sidewalk, door: [9, 17] },
  { x0: 2, y0: 23, x1: 9, y1: 29, floor: T.Sidewalk, door: [9, 26] },
  // market strip — north-center storefronts
  { x0: 16, y0: 2, x1: 23, y1: 8, floor: T.Sidewalk, door: [19, 8] },
  { x0: 27, y0: 2, x1: 34, y1: 8, floor: T.Sidewalk, door: [30, 8] },
  // commercial — northeast tower
  { x0: 40, y0: 2, x1: 49, y1: 8, floor: T.Sidewalk, door: [44, 8] },
  { x0: 40, y0: 14, x1: 49, y1: 21, floor: T.Sidewalk, door: [40, 17] },
  { x0: 40, y0: 23, x1: 49, y1: 29, floor: T.Sidewalk, door: [40, 26] },
  // trap houses — southeast grime (run-down sheds)
  { x0: 41, y0: 35, x1: 45, y1: 40, floor: T.Grime, door: [43, 35] },
  { x0: 46, y0: 35, x1: 49, y1: 40, floor: T.Grime, door: [47, 35] },
];

// ── grid build (once) ─────────────────────────────────────────────────────────
function buildGrid(): Int8Array {
  const g = new Int8Array(CITY_W * CITY_H).fill(FILL);
  const set = (x: number, y: number, t: T) => {
    if (x < 0 || y < 0 || x >= CITY_W || y >= CITY_H) return;
    g[y * CITY_W + x] = t;
  };
  for (const r of RECTS) {
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) set(x, y, r.t);
  }
  for (const b of BLDGS) {
    for (let y = b.y0; y <= b.y1; y++) {
      for (let x = b.x0; x <= b.x1; x++) {
        const edge = x === b.x0 || x === b.x1 || y === b.y0 || y === b.y1;
        set(x, y, edge ? T.Wall : b.floor);
      }
    }
    set(b.door[0], b.door[1], b.floor); // punch the door
  }
  return g;
}

const GRID = buildGrid();

export function cityTileAt(x: number, y: number): number {
  if (x < 0 || y < 0 || x >= CITY_W || y >= CITY_H) return VOID;
  return GRID[y * CITY_W + x];
}

// ── props (hand-placed, blocking) ───────────────────────────────────────────────
// tint indexes into the per-kind color ramp in the shader (signs cycle neon hues).
const r = (x: number, y: number, kind: PropKind, tint = 0): Prop => ({ x: x + 0.5, y: y + 0.5, kind, tint });

const PROPS: Prop[] = [
  // palms lining the plaza + boulevards (the Miami dream)
  r(17, 15, 'palm'), r(34, 15, 'palm'), r(17, 28, 'palm'), r(34, 28, 'palm'),
  r(25, 13, 'palm'), r(20, 30, 'palm'), r(31, 30, 'palm'),
  r(4, 12, 'palm'), r(48, 12, 'palm'), r(25, 33, 'palm'),
  // neon signs at storefronts + the plaza edge (tint = hue: 0 pink,1 cyan,2 purple,3 orange)
  r(19, 9, 'sign', 0), r(30, 9, 'sign', 1), r(44, 9, 'sign', 3),
  r(16, 16, 'sign', 2), r(35, 27, 'sign', 0), r(40, 16, 'sign', 1),
  // dumpsters + trash in the grime + back alleys (the squalor)
  r(42, 41, 'dumpster'), r(47, 41, 'dumpster'), r(44, 33, 'dumpster'),
  r(40, 33, 'dumpster'), r(11, 9, 'dumpster'), r(10, 30, 'dumpster'),
];

const PROP_AT = new Map<string, Prop>();
for (const p of PROPS) PROP_AT.set(`${Math.floor(p.x)},${Math.floor(p.y)}`, p);

export function cityPropAt(x: number, y: number): Prop | null {
  return PROP_AT.get(`${x},${y}`) ?? null;
}

export function cityPropsIn(ox: number, oy: number, w: number, h: number): Prop[] {
  const out: Prop[] = [];
  for (const p of PROPS) {
    const px = Math.floor(p.x);
    const py = Math.floor(p.y);
    if (px >= ox && px < ox + w && py >= oy && py < oy + h) out.push(p);
  }
  return out;
}
