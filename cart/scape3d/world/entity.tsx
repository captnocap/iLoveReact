// The uniform recursive world model.
//
// EVERYTHING is an Entity: { size, contents-placed-at-LOCAL-offsets }. Contents
// are themselves entities. An entity never knows where it is — the parent injects
// that. Map → Zone → Building → Object, the same shape all the way down.
//
// bake() is the single recursive walk that flattens this relative tree into the
// flat ABSOLUTE outputs the engine + systems want:
//   • a packed-tile lookup (kind | tier | style) and prop lookup  → pathfinding,
//     picking, minimap streaming
//   • a continuous height field                                   → camera, feet, pick raycast
//   • a flat list of mesh fragments                               → the ONE <Scene3D>
// Relative to author, absolute at runtime — so any glitch has one canonical coord.
//
// Two passes: pass 1 stamps tiles/props and collects relief + render entries;
// pass 2 builds heightAt (relief is ready) then emits frags (so a building can sit
// on the terrain it stands on). Static geometry only — players/NPCs/doors are
// dynamic and live in the render tree, not here.

import { Fragment } from 'react';
import { Scene3D } from '@reactjit/runtime/primitives';
import { T, VOID, type PropKind } from './citymap';
import { ZONE_HEX, PLAZA_A, PLAZA_B, ROAD_LINE, HILL_SIDE } from '../render3d/palette3d';
import { checkerTex, asphaltTex } from '../render3d/textures';

// ── types ──────────────────────────────────────────────────────────────────
export type Surface = 'road' | 'sidewalk' | 'plaza' | 'water' | 'sand' | 'grime';
export type Side = 'N' | 'E' | 'S' | 'W';
export interface Connector { side: Side; at: number; span: number; surface: Surface; }

export interface Entity {
  id?: string;                                  // stable id segment for addressing (e.g. 'bedroom', 'floorboard12')
  kind?: string;                                // semantic type (e.g. 'floorboard') — drives interaction
  cache?: Cache;                                // stateful, gated, lootable contents (the $ in the floorboard)
  size: [number, number];                      // local bounding box (tiles)
  ground?: Surface;                             // lays a floor fill of this surface
  pack?: number;                                // packed tile stamped over footprint (buildings: Wall|tier|style)
  prop?: PropKind;                              // registers a blocking prop of this kind at its origin tile
  propTint?: number;
  height?: (lx: number, ly: number) => number;  // relief in world units (LOCAL coords)
  render?: (ax: number, ay: number, heightAt: (x: number, y: number) => number) => any; // own meshes at ABSOLUTE origin
  contents?: { at: [number, number]; of: Entity }[];   // children at LOCAL offsets
  connections?: Connector[];                    // edge ports (seam continuity + validation)
}

// A stashed cache — what hides inside a thing. MUTABLE: `opened` flips at runtime
// when the player pries/loots it, and the render reads it. `needs` is the tool key
// that gates access (a crowbar to pry a board).
export interface Cache {
  needs?: PropKind | string;  // item key required to open (e.g. 'crowbar')
  money?: number;             // cash inside
  items?: string[];           // item keys inside
  opened?: boolean;           // pried/looted yet
  stash?: number;             // slot capacity — set from the thingymajigger's `stash`; makes an empty thing searchable
}

// A baked interactable: an entity with a cache, flattened to ABSOLUTE coords with
// its dotted address path. The cache is the SAME mutable object the entity holds,
// so prying it (via the action menu) is visible to the dynamic render next tick.
export interface Feature {
  id: string;
  kind: string;
  path: string;               // e.g. 'crackhouse_47.bedroom.floorboard12'
  x: number; y: number;       // absolute origin tile
  w: number; h: number;
  cache: Cache;
}

export interface Decor { id: string; kind: PropKind; x: number; y: number; tint: number; }
interface PropRec { x: number; y: number; kind: PropKind; tint: number; }
interface Relief { x0: number; y0: number; x1: number; y1: number; ax: number; ay: number; fn: (lx: number, ly: number) => number; }
interface AbsConnector extends Connector { zx0: number; zy0: number; zx1: number; zy1: number; }

export interface BakedWorld {
  packedAt(x: number, y: number): number;
  kindAt(x: number, y: number): number;
  propAt(x: number, y: number): PropRec | null;
  heightAt(x: number, y: number): number;
  propsIn(ox: number, oy: number, w: number, h: number): Decor[];
  features: Feature[];
  featureAt(x: number, y: number): Feature | null;
  byPath(path: string): Feature | null;
  frags: any[];
}

const SURFACE_KIND: Record<Surface, T> = {
  road: T.Road, sidewalk: T.Sidewalk, plaza: T.Plaza, water: T.Water, sand: T.Sand, grime: T.Grime,
};

// ── textures (built once, host-cached by content hash) ───────────────────────
const WHITE = '#ffffff';
// cell px = texels per 1 m checker square. The whole plaza is one stretched face, so
// this is the only resolution knob until UV tiling lands — keep it dense (≈32px/tile)
// so the squares + grout stay crisp instead of bilinear-smearing into soft diamonds.
const PLAZA_TEX = checkerTex(20, 16, 32, PLAZA_A, PLAZA_B);
const ROAD_TEX = asphaltTex(ZONE_HEX.road, ROAD_LINE);

function zoneHex(t: T): string {
  switch (t) {
    case T.Road: return ZONE_HEX.road;
    case T.Plaza: return ZONE_HEX.plaza;
    case T.Water: return ZONE_HEX.water;
    case T.Sand: return ZONE_HEX.sand;
    case T.Grime: return ZONE_HEX.grime;
    default: return ZONE_HEX.sidewalk;
  }
}

// Discrete world objects (palm, dumpster, sign, building, …) live in
// thingymajiggers/ and are resolved via THINGYMAJIGGERS by the atlas. What stays
// here is the surface layer the bake engine owns directly: ground fills + relief.

// Flat ground fill (textured for plaza/road); roads also get crisp lane dashes.
// `y0` stacks overlapping fills by paint order (base under overrides) to avoid
// z-fighting where one zone's floor sits over another's.
function groundFrag(key: string, surface: Surface, ax: number, ay: number, w: number, h: number, y0: number, isRoad: (x: number, y: number) => boolean) {
  const cx = ax + w / 2;
  const cz = ay + h / 2;
  const textured = surface === 'plaza' ? PLAZA_TEX : surface === 'road' ? ROAD_TEX : null;
  const pieces: any[] = [
    <Scene3D.Mesh key="floor" geometry="box" material={textured ? WHITE : zoneHex(SURFACE_KIND[surface])}
      texture={textured ?? undefined} position={[cx, y0, cz]} sizeX={w} sizeY={0.1} sizeZ={h} />,
  ];
  if (surface === 'road') {
    const horizontal = w >= h;
    const len = horizontal ? w : h;
    const STEP = 3.0, DASH = 1.4;
    const n = Math.floor(len / STEP);
    for (let k = 0; k < n; k++) {
      const off = -len / 2 + STEP / 2 + k * STEP;
      const px = horizontal ? cx + off : cx;
      const pz = horizontal ? cz : cz + off;
      // A centerline dash only exists where the tile under it is STILL road after all
      // stamps — so markings can't float over water/sand/buildings that overdrew the road.
      if (!isRoad(Math.floor(px), Math.floor(pz))) continue;
      pieces.push(
        <Scene3D.Mesh key={`lane-${k}`} geometry="box" material={ROAD_LINE}
          position={[px, 0.06, pz]}
          sizeX={horizontal ? DASH : 0.16} sizeY={0.05} sizeZ={horizontal ? 0.16 : DASH} />,
      );
    }
  }
  return <Fragment key={key}>{pieces}</Fragment>;
}

// Terraced relief: a box per row spanning the entity width, height = heightAt.
// Solid tones (a stretched texture across a wide band smears).
function terraceFrag(key: string, surface: Surface, ax: number, ay: number, w: number, h: number, fn: (lx: number, ly: number) => number) {
  const cx = ax + w / 2;
  const cap = zoneHex(SURFACE_KIND[surface]);
  const pieces: any[] = [];
  for (let z = 0; z < h; z++) {
    const top = fn(w / 2, z + 0.5);
    if (top < 0.03) continue;
    const bz = ay + z + 0.5;
    pieces.push(
      <Scene3D.Mesh key={`slab-${z}`} geometry="box" material={HILL_SIDE} position={[cx, top / 2, bz]} sizeX={w} sizeY={top} sizeZ={1} />,
      <Scene3D.Mesh key={`cap-${z}`} geometry="box" material={cap} position={[cx, top - 0.04, bz]} sizeX={w} sizeY={0.12} sizeZ={1} />,
    );
  }
  return <Fragment key={key}>{pieces}</Fragment>;
}

// ── bake ─────────────────────────────────────────────────────────────────
type Entry =
  | { kind: 'ground'; surface: Surface; ax: number; ay: number; w: number; h: number }
  | { kind: 'terrace'; surface: Surface; ax: number; ay: number; w: number; h: number; fn: (lx: number, ly: number) => number }
  | { kind: 'custom'; e: Entity; ax: number; ay: number };

export function bake(root: Entity): BakedWorld {
  const packed = new Map<string, number>();
  const props = new Map<string, PropRec>();
  const propList: PropRec[] = [];
  const reliefs: Relief[] = [];
  const entries: Entry[] = [];
  const connectors: AbsConnector[] = [];
  const features: Feature[] = [];
  const featureMap = new Map<string, Feature>();
  const pathMap = new Map<string, Feature>();

  function stamp(ax: number, ay: number, w: number, h: number, v: number) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) packed.set(`${ax + x},${ay + y}`, v);
  }

  (function walk(e: Entity, ax: number, ay: number, path: string) {
    const [w, h] = e.size;
    const here = e.id ? (path ? `${path}.${e.id}` : e.id) : path; // accumulate the dotted address
    if (e.ground !== undefined) {
      stamp(ax, ay, w, h, SURFACE_KIND[e.ground]);
      if (e.height) entries.push({ kind: 'terrace', surface: e.ground, ax, ay, w, h, fn: e.height });
      else entries.push({ kind: 'ground', surface: e.ground, ax, ay, w, h });
    }
    if (e.pack !== undefined) stamp(ax, ay, w, h, e.pack);
    if (e.prop !== undefined) {
      const rec: PropRec = { x: ax + 0.5, y: ay + 0.5, kind: e.prop, tint: e.propTint ?? 0 };
      props.set(`${ax},${ay}`, rec);
      propList.push(rec);
    }
    if (e.cache) {
      const f: Feature = { id: e.id ?? e.kind ?? 'feature', kind: e.kind ?? 'feature', path: here, x: ax, y: ay, w, h, cache: e.cache };
      features.push(f);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) featureMap.set(`${ax + x},${ay + y}`, f);
      pathMap.set(here, f);
    }
    if (e.height) reliefs.push({ x0: ax, y0: ay, x1: ax + w - 1, y1: ay + h - 1, ax, ay, fn: e.height });
    if (e.render) entries.push({ kind: 'custom', e, ax, ay });
    if (e.connections) for (const c of e.connections) connectors.push({ ...c, zx0: ax, zy0: ay, zx1: ax + w - 1, zy1: ay + h - 1 });
    if (e.contents) for (const c of e.contents) walk(c.of, ax + c.at[0], ay + c.at[1], here);
  })(root, 0, 0, '');

  const heightAt = (x: number, y: number): number => {
    for (let i = reliefs.length - 1; i >= 0; i--) {
      const r = reliefs[i];
      if (x >= r.x0 && x <= r.x1 + 1 && y >= r.y0 && y <= r.y1 + 1) {
        const hh = r.fn(x - r.ax, y - r.ay);
        if (hh > 0) return hh;
      }
    }
    return 0;
  };

  // pass 2: emit frags now that heightAt exists (buildings sit on their terrain).
  // The packed grid is final here, so road markings can be clipped to tiles that are
  // STILL road after every stamp — no lane lines floating over water/buildings.
  const isRoad = (x: number, y: number): boolean => ((packed.get(`${x},${y}`) ?? VOID) & 7) === T.Road;
  let gi = 0; // ground paint order → tiny y stack so overlapping fills don't z-fight
  const frags: any[] = entries.map((en, i) => {
    if (en.kind === 'ground') return groundFrag(`g${i}`, en.surface, en.ax, en.ay, en.w, en.h, -0.05 + gi++ * 0.004, isRoad);
    if (en.kind === 'terrace') return terraceFrag(`t${i}`, en.surface, en.ax, en.ay, en.w, en.h, en.fn);
    return <Fragment key={`c${i}`}>{en.e.render!(en.ax, en.ay, heightAt)}</Fragment>;
  });

  validateSeams(connectors);

  return {
    packedAt: (x, y) => packed.get(`${x},${y}`) ?? VOID,
    kindAt: (x, y) => { const v = packed.get(`${x},${y}`); return v == null ? VOID : v & 7; },
    propAt: (x, y) => props.get(`${x},${y}`) ?? null,
    heightAt,
    propsIn: (ox, oy, w, h) => propList
      .filter((p) => Math.floor(p.x) >= ox && Math.floor(p.x) < ox + w && Math.floor(p.y) >= oy && Math.floor(p.y) < oy + h)
      .map((p) => ({ id: `d-${Math.floor(p.x)}-${Math.floor(p.y)}`, kind: p.kind, x: p.x, y: p.y, tint: p.tint })),
    features,
    featureAt: (x, y) => featureMap.get(`${Math.floor(x)},${Math.floor(y)}`) ?? null,
    byPath: (p) => pathMap.get(p) ?? null,
    frags,
  };
}

// Validate-and-warn: a road/sidewalk connector that doesn't meet a complementary
// connector across its seam is a dead-end. Loud, non-fatal.
function validateSeams(connectors: AbsConnector[]) {
  const seam = (c: AbsConnector) => {
    // absolute span of the port along the shared edge
    if (c.side === 'N') return { axis: 'y' as const, line: c.zy0, a: c.zx0 + c.at, b: c.zx0 + c.at + c.span - 1 };
    if (c.side === 'S') return { axis: 'y' as const, line: c.zy1 + 1, a: c.zx0 + c.at, b: c.zx0 + c.at + c.span - 1 };
    if (c.side === 'W') return { axis: 'x' as const, line: c.zx0, a: c.zy0 + c.at, b: c.zy0 + c.at + c.span - 1 };
    return { axis: 'x' as const, line: c.zx1 + 1, a: c.zy0 + c.at, b: c.zy0 + c.at + c.span - 1 };
  };
  for (let i = 0; i < connectors.length; i++) {
    const ci = connectors[i];
    if (ci.surface !== 'road' && ci.surface !== 'sidewalk') continue;
    const si = seam(ci);
    const opposite = ci.side === 'N' ? 'S' : ci.side === 'S' ? 'N' : ci.side === 'E' ? 'W' : 'E';
    const matched = connectors.some((cj, j) => {
      if (j === i || cj.side !== opposite || cj.surface !== ci.surface) return false;
      const sj = seam(cj);
      return sj.axis === si.axis && sj.line === si.line && sj.a <= si.b && sj.b >= si.a;
    });
    if (!matched) {
      const log = (globalThis as any).console?.warn ?? (() => {});
      log(`[seam] ${ci.surface} connector on ${ci.side} edge @${ci.at}+${ci.span} of zone [${ci.zx0},${ci.zy0}] has no match across the seam — road dead-ends here.`);
    }
  }
}
