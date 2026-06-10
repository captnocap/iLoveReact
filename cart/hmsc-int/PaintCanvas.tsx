// PaintCanvas — the 2D authoring surface for the bottom-left quadrant.
//
// LAYERED, MULTI-CHUNK editor. A bottom-right layer switch picks the active layer;
// the active layer decides what the left rail shows AND what is drawn:
//
//   • paint  — tile-painting tools (pointer / brush / eraser + tile palette).
//   • height — the underlying heightfield, brushed in place.
//   • place  — draggable object placements over the tile ground.
//   • zone   — named/flagged areas tinted over the tile ground.
//
// The world is a sparse grid of 120x120-tile chunks (chunks.ts). Only FOCUSED
// chunks render (the focus filter, top-right) so the whole map never loads into
// view at once. Each focused chunk is one <ChunkSurface> (its own coalesced GPU
// buffer); a "+" ghost sits on every open side (in-bounds + unoccupied) and snaps a
// new chunk flush against its neighbour.
//
// Brush input = the cutout pattern: a screen-space sibling <Pressable> over the
// <Canvas>, down+move on the same node so pointer capture carries the stroke; the
// rail / buttons / filter panel are absolute siblings rendered AFTER it so they
// stay clickable (the host hit-tests children in reverse). alt-drag pans.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Canvas, Pressable, ScrollView, Text } from '@reactjit/primitives';
import { callHost } from '@reactjit/ffi';
import { busOn } from '@reactjit/hooks/useIFTTT';
import { columnLabel } from './address';
import { CHUNK_FLOOR_HF_RES, downsampleChunkFloorHeights, type ChunkFloor } from './chunkFloor';
import type { TileKind } from '../hmsc/design';
import { TILE_KINDS, tileKindDefinition } from '../hmsc/world/tileKinds';
import { TILE_UNITS, DOT_M, HEIGHT_LIMIT, stampBrush, stampRamp, stampSlopeSegment, brushProfile, clearField, type BrushProfile } from './heightData';
import { footprintDistance, forEachFootprintCell, type BrushMode, type BrushShape } from './brush';
import { BrushRail, type BrushRailSettings } from './BrushRail';
import { LayerBtn, MiniStepper, ToolBtn } from './railAtoms';
import { paintTile, tileKindIndex, encodeTileMap } from './tileData';
import { paintZoneCell, dropZoneIndex, ZONE_COLORS, type ZoneDef } from './zoneData';
import { clampProfile, laneGuides, parseCellKey, planRoads, profileLabel, isOneWay, roadWidthTiles, snapToCenterline, snapToRoadEnd, splitStroke, strokeEndpoints, type RoadPoint, type RoadProfile, type RoadStroke } from './roadData';
import { RoadRail } from './RoadRail';
import { ChunkSurface } from './ChunkSurface';
import { chunkKey, makeChunk, inBounds, openNeighbors, CHUNK_TILES, type Chunk, type ChunkKey } from './chunks';
import { placementCellRect, type Placement, type PlaceCat } from './placements';
import type { MapBuildFootprint } from './mapBuildPlacements';
import type { EditorWorld } from './mapStore';
import type { SelCell } from './tileOverrides';
import type { EditNote } from './editLog';
import { plog, useChurn, countersSnapshot, counterDelta } from './perfLog';

export type HeightMode = 'brush' | 'ramp' | 'slope' | 'smooth';
type CanvasRect = { x: number; y: number; width: number; height: number } | null;
type HoverState = { x: number; y: number; addr: string } | null;
type HoverSink = { current: ((h: HoverState) => void) | null };
// The visible brush footprint: a circle at screen position (x,y), diameter d px,
// `on` = over a paintable cell (filled) vs off-grid (outline only).
type BrushVis = { x: number; y: number; d: number; color: string; on: boolean; shape?: BrushShape; rect?: { w: number; h: number; angle?: number }; ramp?: { w: number; h: number; angle: number } } | null;
type BrushSink = { current: ((b: BrushVis) => void) | null };

export type Tool = 'pointer' | 'brush' | 'eraser';
export type Layer = 'paint' | 'height' | 'place' | 'zone' | 'road';
export type { BrushMode, BrushShape, BrushProfile };
export type BrushSettings = BrushRailSettings;

// The 2D canvas camera as persisted state (MAPGONE2-0605: an unrestored view
// snapped to the lattice origin on every remount — on a map whose origin chunk
// is featureless, the canvas read as "blank" while every byte was intact).
export interface CanvasView2D {
  x: number;
  y: number;
  zoom: number;
}

// The serialize seam: the cart pulls the live world (chunks + zone defs + focus)
// through this on autosave. Placements live in the cart, so they're added there.
export interface PaintCanvasApi {
  getWorld: () => Pick<EditorWorld, 'chunks' | 'zones' | 'focus' | 'roads' | 'roadUnder'>;
  /** the live 2D camera (centre + px-per-graph-unit), derived through the
   *  host's affine screen→graph mapping; null before first layout */
  getView: () => CanvasView2D | null;
}

// The place-layer state + actions, owned by the cart (so placements persist /
// feed the world). Passed as a bundle to keep the prop list flat.
export interface PlaceProps {
  items: Placement[];
  selId: string | null;
  active: { cat: PlaceCat; kind: string; label: string; color: string; footW: number; footD: number; rotation: number } | null;
  buildItems?: MapBuildFootprint[];
  buildSelId?: string | null;
  onSelect: (id: string | null) => void;
  onSelectBuild?: (id: string | null) => void;
  onArm: (cat: PlaceCat, kind: string) => void;
  onRotateBrush: (delta: number) => void;
  onPaintAt: (cat: PlaceCat, kind: string, gx: number, gy: number, rotation: number) => void;
  onMove: (id: string, gx: number, gy: number) => void;
  onUpdate: (id: string, patch: Partial<Placement>) => void;
  onClone: (id: string) => void;
  onDelete: (id: string) => void;
  onDeleteBuild?: (id: string) => void;
}

const RAIL_W = 176;
const GUTTER_W = 58; // right-edge chunk-focus dock — thin so the centre stays clear

// One chunk spans CHUNK_TILES tiles (1 tile = 1m), so PATCH graph-units wide.
const PATCH = CHUNK_TILES * TILE_UNITS;

const Z_MAX = HEIGHT_LIMIT, Z_MIN = -HEIGHT_LIMIT;
// Shared brush size = RADIUS in tiles (0 = a single cell). 1 tile = 1m, so it also
// reads as the height cone's radius in metres. Footprint shown as width-across.
const SIZE_MIN = 0, SIZE_MAX = 40;

// Throttle for the live preview mirror — rebuilding regions + re-baking the
// preview's floor captures is heavy, so cap it to ~3 syncs/sec.
const REGION_SYNC_MS = 320;

export const CANVAS_PAN_SPEED = 700; // px/s while a direction key is held
type CanvasPanDrift = { x: number; y: number };
export type EffectiveCanvasPanDrift = CanvasPanDrift & { active: boolean };

const ZERO_CANVAS_DRIFT: EffectiveCanvasPanDrift = { x: 0, y: 0, active: false };
const PAN_DIR: Record<string, CanvasPanDrift> = {
  d: { x: 1, y: 0 }, a: { x: -1, y: 0 }, s: { x: 0, y: 1 }, w: { x: 0, y: -1 },
};

export function canvasPanDriftForHeldKeys(keys: Iterable<string>, wasdFocused = true): CanvasPanDrift {
  if (!wasdFocused) return ZERO_CANVAS_DRIFT;
  let x = 0, y = 0;
  for (const raw of keys) {
    const v = PAN_DIR[String(raw).toLowerCase()];
    if (v) { x += v.x; y += v.y; }
  }
  return { x: x * CANVAS_PAN_SPEED, y: y * CANVAS_PAN_SPEED };
}

export function effectiveCanvasPanDrift(drift: CanvasPanDrift, heldKeyCount: number, wasdFocused: boolean): EffectiveCanvasPanDrift {
  if (!wasdFocused || heldKeyCount <= 0 || (drift.x === 0 && drift.y === 0)) return ZERO_CANVAS_DRIFT;
  return { x: drift.x, y: drift.y, active: true };
}

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

const HIDDEN_CURSOR_STYLE = { position: 'absolute', left: -10000, top: -10000, width: 0, height: 0, borderWidth: 0, backgroundColor: '#00000000' };
const HIDDEN_CURSOR_PIP_STYLE = { position: 'absolute', left: 0, top: 0, width: 0, height: 0, backgroundColor: '#00000000' };

function hoverStateSame(a: HoverState, b: HoverState): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.addr === b.addr;
}

// Point-to-segment distance in cell units (road select hit-test).
function distPointSegmentCells(p: RoadPoint, a: RoadPoint, b: RoadPoint): number {
  const abx = b.gx - a.gx, abz = b.gz - a.gz;
  const len2 = abx * abx + abz * abz;
  const t = len2 ? Math.max(0, Math.min(1, ((p.gx - a.gx) * abx + (p.gz - a.gz) * abz) / len2)) : 0;
  return Math.hypot(p.gx - (a.gx + abx * t), p.gz - (a.gz + abz * t));
}

// Evenly spaced dots along a polyline (the road overlay's dotted centerline —
// dots need no rotation, so any segment angle renders clean).
function roadDots(points: RoadPoint[], everyTiles: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!, b = points[i + 1]!;
    const len = Math.hypot(b.gx - a.gx, b.gz - a.gz);
    if (len === 0) continue;
    const n = Math.max(1, Math.round(len / everyTiles));
    for (let s = 0; s <= n; s++) out.push({ x: a.gx + (b.gx - a.gx) * (s / n), z: a.gz + (b.gz - a.gz) * (s / n) });
  }
  return out;
}

// Per-LANE wire dots (req_0528): each lane's centre offset from the stroke,
// sampled along every segment with that segment's quantized right vector —
// the same math the stamp uses, so the wire sits exactly on the lane it marks.
function laneWireDots(r: RoadStroke, everyTiles: number): { x: number; z: number; flow: 'forward' | 'backward' }[] {
  const guides = laneGuides(r.profile);
  const out: { x: number; z: number; flow: 'forward' | 'backward' }[] = [];
  for (let i = 0; i + 1 < r.points.length; i++) {
    const a = r.points[i]!, b = r.points[i + 1]!;
    const dx = b.gx - a.gx, dz = b.gz - a.gz;
    const len = Math.hypot(dx, dz);
    if (!len) continue;
    const dir = Math.abs(dx) >= Math.abs(dz) ? { dx: Math.sign(dx), dz: 0 } : { dx: 0, dz: Math.sign(dz) };
    const right = { dx: -dir.dz, dz: dir.dx };
    const n = Math.max(1, Math.round(len / everyTiles));
    for (const g of guides) {
      for (let s = 0; s <= n; s++) {
        out.push({
          x: a.gx + dx * (s / n) + right.dx * g.off,
          z: a.gz + dz * (s / n) + right.dz * g.off,
          flow: g.flow,
        });
      }
    }
  }
  return out;
}

// One-way direction markers: an ASCII chevron per segment midpoint, pointed
// along the traffic flow (flipped when the forward side is the disabled one).
function roadChevrons(r: RoadStroke): { gx: number; gz: number; glyph: string }[] {
  const flip = clampProfile(r.profile).lanesF === 0 ? -1 : 1;
  const out: { gx: number; gz: number; glyph: string }[] = [];
  for (let i = 0; i + 1 < r.points.length; i++) {
    const a = r.points[i]!, b = r.points[i + 1]!;
    const dx = (b.gx - a.gx) * flip, dz = (b.gz - a.gz) * flip;
    if (!dx && !dz) continue;
    const glyph = Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? '>' : '<') : (dz > 0 ? 'v' : '^');
    out.push({ gx: (a.gx + b.gx) / 2, gz: (a.gz + b.gz) / 2, glyph });
  }
  return out;
}

// Global cell → graph centre (the selection-highlight formula: chunk (cx,cz) is
// CENTRED at cx·PATCH, so cell g sits at (g − CHUNK_TILES/2 + 0.5)·TILE_UNITS).
const cellGraph = (g: number): number => (g - CHUNK_TILES / 2 + 0.5) * TILE_UNITS;

function brushVisSame(a: BrushVis, b: BrushVis): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.x !== b.x || a.y !== b.y || a.d !== b.d || a.color !== b.color || a.on !== b.on || a.shape !== b.shape) return false;
  if (!!a.rect !== !!b.rect || !!a.ramp !== !!b.ramp) return false;
  if (a.rect && b.rect && (a.rect.w !== b.rect.w || a.rect.h !== b.rect.h || (a.rect.angle ?? 0) !== (b.rect.angle ?? 0))) return false;
  if (a.ramp && b.ramp && (a.ramp.w !== b.ramp.w || a.ramp.h !== b.ramp.h || a.ramp.angle !== b.ramp.angle)) return false;
  return true;
}

function brushPx(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function normalizeBrushVis(b: BrushVis): BrushVis {
  if (!b) return null;
  const rect = b.rect
    ? { w: brushPx(b.rect.w), h: brushPx(b.rect.h), angle: brushPx(b.rect.angle ?? 0) }
    : undefined;
  const ramp = b.ramp
    ? { w: brushPx(b.ramp.w), h: brushPx(b.ramp.h), angle: brushPx(b.ramp.angle) }
    : undefined;
  return {
    ...b,
    x: brushPx(b.x),
    y: brushPx(b.y),
    d: brushPx(b.d),
    rect,
    ramp,
  };
}

// A chunk's short address label, e.g. (0,0)→"A0", (1,0)→"B0", (0,1)→"A1".
const chunkLabel = (cx: number, cz: number) => `${columnLabel(cx)}${cz}`;

function MiniBtn(props: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={{ paddingLeft: 5, paddingRight: 5, paddingTop: 2, paddingBottom: 2, borderRadius: 3, borderWidth: 1, borderColor: '#27364a', backgroundColor: '#0f1a2e' }}>
      <Text fontSize={8} color="#94a3b8" style={{ fontWeight: 700 }}>{props.label}</Text>
    </Pressable>
  );
}

function det3(
  a00: number, a01: number, a02: number,
  a10: number, a11: number, a12: number,
  a20: number, a21: number, a22: number,
): number {
  return a00 * (a11 * a22 - a12 * a21)
    - a01 * (a10 * a22 - a12 * a20)
    + a02 * (a10 * a21 - a11 * a20);
}

const ROT_STEP = 15; // degrees per rotate tap

// The spawn↔save link picker — shown only when a SAVE marker is selected. Lists
// every spawn marker (the manual pairing target) so the author chooses which spawn
// this save reappears the player at; clicking the armed one again unpairs it.
function SaveLinkPicker(props: { sel: Placement; place: PlaceProps }) {
  const spawns = props.place.items.filter((p) => p.cat === 'marker' && p.kind === 'spawn');
  const armed = props.sel.spawnId;
  const pick = (id: string) => props.place.onUpdate(props.sel.id, { spawnId: armed === id ? undefined : id });
  return (
    <Box style={{ gap: 4 }}>
      <Box style={{ height: 1, backgroundColor: '#1e293b' }} />
      <Text fontSize={8} color="#a855f7" style={{ fontFamily: 'monospace', fontWeight: 700 }}>RESPAWN AT</Text>
      {spawns.length === 0 ? (
        <Text fontSize={8} color="#64748b" style={{ fontFamily: 'monospace' }}>place a spawn first</Text>
      ) : spawns.map((sp, i) => {
        const on = armed === sp.id;
        return (
          <Pressable key={sp.id} onPress={() => pick(sp.id)} style={{ alignItems: 'center', paddingTop: 3, paddingBottom: 3, borderRadius: 4, borderWidth: 1, borderColor: on ? '#22c55e' : '#334155', backgroundColor: on ? '#0f3d2e' : '#0f1a2e' }}>
            <Text fontSize={8} color={on ? '#86efac' : '#cbd5e1'} style={{ fontFamily: 'monospace', fontWeight: on ? 700 : 500 }}>{`spawn ${i + 1}`}</Text>
          </Pressable>
        );
      })}
    </Box>
  );
}

// Place rail — controls for the SELECTED placement (conditional on selection).
function PlaceRail(props: { tool: Tool; onTool: (t: Tool) => void; sel: Placement | null; buildSel: MapBuildFootprint | null; place: PlaceProps }) {
  const sel = props.sel;
  const buildSel = props.buildSel;
  const active = props.place.active;
  const recent = (() => {
    const out: Placement[] = [];
    const seen = new Set<string>();
    for (let i = props.place.items.length - 1; i >= 0 && out.length < 8; i--) {
      const p = props.place.items[i];
      const k = `${p.cat}:${p.kind}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(p);
    }
    return out;
  })();
  const toolRow = (
    <Box style={{ gap: 5 }}>
      <Box style={{ flexDirection: 'row', gap: 4 }}>
        <ToolBtn icon="MousePointer" active={props.tool === 'pointer'} onPress={() => props.onTool('pointer')} />
        <ToolBtn icon="Brush" active={props.tool === 'brush'} onPress={() => props.onTool('brush')} />
      </Box>
      {active ? (
        <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 4, paddingBottom: 4, borderTopWidth: 1, borderTopColor: '#1e293b' }}>
          <Box style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: active.color }} />
          <Text fontSize={8} color="#cbd5e1" style={{ flexGrow: 1, minWidth: 0, fontFamily: 'monospace', fontWeight: 700 }} numberOfLines={1}>{active.label}</Text>
        </Box>
      ) : (
        <Text fontSize={8} color="#475569" style={{ fontFamily: 'monospace' }}>pick an object in the Objects tab</Text>
      )}
      {active ? (
        <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <ToolBtn icon="RotateCcw" active={false} onPress={() => props.place.onRotateBrush(-ROT_STEP)} />
          <Box style={{ flexGrow: 1, alignItems: 'center', borderWidth: 1, borderColor: '#27364a', borderRadius: 3, paddingTop: 4, paddingBottom: 4, backgroundColor: '#0f1a2e' }}>
            <Text fontSize={8} color="#cbd5e1" style={{ fontFamily: 'monospace', fontWeight: 700 }}>{`${((active.rotation % 360) + 360) % 360}deg`}</Text>
          </Box>
          <ToolBtn icon="RefreshCw" active={false} onPress={() => props.place.onRotateBrush(ROT_STEP)} />
        </Box>
      ) : null}
      {recent.length ? (
        <Box style={{ gap: 4 }}>
          <Text fontSize={7} color="#64748b" style={{ fontFamily: 'monospace', letterSpacing: 0.5 }}>recent</Text>
          <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
            {recent.map((p) => {
              const on = active?.cat === p.cat && active?.kind === p.kind;
              return (
                <Pressable key={`${p.cat}:${p.kind}`} onPress={() => { props.place.onArm(p.cat, p.kind); props.onTool('brush'); }} style={{ width: '48%', minHeight: 30, paddingLeft: 4, paddingRight: 4, paddingTop: 4, paddingBottom: 4, borderRadius: 4, borderWidth: on ? 2 : 1, borderColor: on ? '#f8fafc' : '#334155', backgroundColor: on ? '#1e293b' : '#0f1a2e' }}>
                  <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Box style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: p.color }} />
                    <Text fontSize={7} color={on ? '#f8fafc' : '#94a3b8'} style={{ flexGrow: 1, minWidth: 0, fontFamily: 'monospace', fontWeight: on ? 700 : 500 }} numberOfLines={1}>{p.label}</Text>
                  </Box>
                </Pressable>
              );
            })}
          </Box>
        </Box>
      ) : null}
    </Box>
  );
  if (!sel && !buildSel) {
    return toolRow;
  }
  if (buildSel) {
    return (
      <Box style={{ gap: 6 }}>
        {toolRow}
        <Box style={{ height: 1, backgroundColor: '#1e293b' }} />
        <Text fontSize={8} color="#cbd5e1" style={{ fontFamily: 'monospace' }}>{buildSel.label}</Text>
        <Text fontSize={8} color="#64748b" style={{ fontFamily: 'monospace' }}>{`${buildSel.pieceIds.length} build pieces`}</Text>
        <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
          <ToolBtn icon="Trash2" active={false} onPress={() => props.place.onDeleteBuild?.(buildSel.id)} />
        </Box>
      </Box>
    );
  }
  const set = (patch: Partial<Placement>) => props.place.onUpdate(sel.id, patch);
  return (
    <Box style={{ gap: 6 }}>
      {toolRow}
      <Box style={{ height: 1, backgroundColor: '#1e293b' }} />
      <Text fontSize={8} color="#cbd5e1" style={{ fontFamily: 'monospace' }}>{sel.label}</Text>
      <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        <ToolBtn icon="RotateCcw" active={false} onPress={() => set({ rotation: sel.rotation - ROT_STEP })} />
        <ToolBtn icon="RefreshCw" active={false} onPress={() => set({ rotation: sel.rotation + ROT_STEP })} />
        <ToolBtn icon="Copy" active={false} onPress={() => props.place.onClone(sel.id)} />
        <ToolBtn icon="Trash2" active={false} onPress={() => props.place.onDelete(sel.id)} />
      </Box>
      <Text fontSize={8} color="#64748b" style={{ fontFamily: 'monospace' }}>{`${((sel.rotation % 360) + 360) % 360}°`}</Text>
      <Pressable onPress={() => set({ locked: !sel.locked })} style={{ alignItems: 'center', paddingTop: 3, paddingBottom: 3, borderRadius: 4, borderWidth: 1, borderColor: sel.locked ? '#22c55e' : '#334155', backgroundColor: sel.locked ? '#0f3d2e' : '#0f1a2e' }}>
        <Text fontSize={8} color={sel.locked ? '#86efac' : '#cbd5e1'} style={{ fontWeight: 700 }}>{sel.locked ? 'LOCKED' : 'lock'}</Text>
      </Pressable>
      {sel.cat === 'marker' && sel.kind === 'save' ? <SaveLinkPicker sel={sel} place={props.place} /> : null}
    </Box>
  );
}

// Chunk focus filter — docked in a thin right-edge GUTTER (not a floating panel)
// so it never eats the centre working area no matter how many chunks exist. A
// scrolling column of address chips; toggling one focuses/unfocuses that chunk
// (only focused chunks render + are editable, so the whole map never loads at
// once). all/none act on every existing chunk.
function ChunkGutter(props: {
  chunks: Chunk[]; focus: Set<ChunkKey>;
  onToggle: (k: ChunkKey) => void; onAll: () => void; onNone: () => void;
}) {
  return (
    <Box style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: GUTTER_W, backgroundColor: '#0b1320f5', borderLeftWidth: 1, borderLeftColor: '#1e293b', paddingTop: 6, paddingBottom: 6, paddingLeft: 5, paddingRight: 5, alignItems: 'center', gap: 5 }}>
      <Text fontSize={8} color="#94a3b8" style={{ fontWeight: 700, letterSpacing: 2 }}>CH</Text>
      <Box style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 3 }}>
        <MiniBtn label="all" onPress={props.onAll} />
        <MiniBtn label="none" onPress={props.onNone} />
      </Box>
      <Box style={{ height: 1, width: '82%', backgroundColor: '#1e293b' }} />
      <ScrollView showScrollbar style={{ width: '100%', flexGrow: 1, minHeight: 0 }} contentContainerStyle={{ alignItems: 'center', gap: 4, paddingBottom: 8 }}>
        {props.chunks.map((c) => {
          const k = chunkKey(c.cx, c.cz);
          const on = props.focus.has(k);
          return (
            <Pressable key={k} onPress={() => props.onToggle(k)} style={{ width: '100%', paddingTop: 4, paddingBottom: 4, alignItems: 'center', borderRadius: 4, borderWidth: on ? 2 : 1, borderColor: on ? '#f8fafc' : '#27364a', backgroundColor: on ? '#1e293b' : '#0b1320' }}>
              <Text fontSize={10} color={on ? '#f8fafc' : '#64748b'} style={{ fontFamily: 'monospace', fontWeight: on ? 700 : 600 }}>{chunkLabel(c.cx, c.cz)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </Box>
  );
}

// The hovered-cell address pill. Owns its OWN state and registers its setter into
// a sink ref, so cursor moves update only THIS node — not the whole PaintCanvas
// (which would re-render the gutter, the "+" ghosts, and every chunk on each move,
// the storm that chokes paint past a handful of chunks).
function HoverReadout(props: { sink: HoverSink }) {
  const [hover, setHover] = useState<HoverState>(null);
  props.sink.current = (next) => setHover((prev) => hoverStateSame(prev, next) ? prev : next);
  if (!hover) return null;
  return (
    <Box style={{ position: 'absolute', left: hover.x, top: hover.y, paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2, borderRadius: 4, backgroundColor: '#0b1320ee', borderWidth: 1, borderColor: '#334155' }}>
      <Text fontSize={11} color="#cbd5e1" style={{ fontFamily: 'monospace', fontWeight: 700 }}>{hover.addr}</Text>
    </Box>
  );
}

// The visible brush footprint — a ring that tracks the cursor, snapped to the cell
// it'll paint, sized to the footprint in SCREEN pixels (so it scales as you zoom),
// and tinted to the active tool. Same trick as HoverReadout: it owns its own state
// and registers its setter into a sink ref, so cursor moves repaint ONLY this node,
// never the whole PaintCanvas (the re-render storm that chokes paint past a few
// chunks). A plain Box never hit-tests, so it sits over the brush overlay harmlessly.
const BrushCursor = memo(function BrushCursor(props: { sink: BrushSink }) {
  const [b, setB] = useState<BrushVis>(null);
  props.sink.current = (next) => {
    const normalized = normalizeBrushVis(next);
    setB((prev) => brushVisSame(prev, normalized) ? prev : normalized);
  };
  if (!b) {
    return (
      <Box style={HIDDEN_CURSOR_STYLE}>
        <Box style={HIDDEN_CURSOR_PIP_STYLE} />
      </Box>
    );
  }
  const r = b.d / 2;
  if (b.rect) {
    return (
      <Box style={{ position: 'absolute', left: b.x - b.rect.w / 2, top: b.y - b.rect.h / 2, width: b.rect.w, height: b.rect.h, borderRadius: 2, borderWidth: 2, borderColor: b.color, backgroundColor: b.on ? `${b.color}26` : '#00000000', transform: { rotate: b.rect.angle ?? 0 } }}>
        <Box style={{ position: 'absolute', left: b.rect.w / 2 - 2, top: b.rect.h / 2 - 2, width: 4, height: 4, borderRadius: 2, backgroundColor: b.color }} />
      </Box>
    );
  }
  if (b.ramp) {
    const capH = Math.max(5, Math.min(14, Math.floor(b.ramp.h * 0.16)));
    const shaftTop = capH + 3;
    const shaftH = Math.max(6, b.ramp.h - capH * 2 - 8);
    const arrowY = Math.max(capH + 6, b.ramp.h - capH - 11);
    const arrowX = b.ramp.w / 2;
    return (
      <Box style={{ position: 'absolute', left: b.x - b.ramp.w / 2, top: b.y - b.ramp.h / 2, width: b.ramp.w, height: b.ramp.h, borderRadius: 2, borderWidth: 2, borderColor: b.color, backgroundColor: b.on ? `${b.color}22` : '#00000000', transform: { rotate: b.ramp.angle } }}>
        <Box style={{ position: 'absolute', left: 2, right: 2, top: 2, height: capH, borderRadius: 2, backgroundColor: '#38bdf8aa' }} />
        <Box style={{ position: 'absolute', left: 2, right: 2, bottom: 2, height: capH, borderRadius: 2, backgroundColor: '#f97316cc' }} />
        <Box style={{ position: 'absolute', left: b.ramp.w / 2 - 2, top: shaftTop, width: 4, height: shaftH, borderRadius: 2, backgroundColor: '#f8fafccc' }} />
        <Box style={{ position: 'absolute', left: arrowX - 10, top: arrowY, width: 13, height: 4, borderRadius: 2, backgroundColor: '#f8fafc', transform: { rotate: 45 } }} />
        <Box style={{ position: 'absolute', left: arrowX - 3, top: arrowY, width: 13, height: 4, borderRadius: 2, backgroundColor: '#f8fafc', transform: { rotate: -45 } }} />
        <Box style={{ position: 'absolute', left: arrowX - 5, top: b.ramp.h - capH - 7, width: 10, height: 10, borderRadius: 5, backgroundColor: '#f97316', borderWidth: 2, borderColor: '#0b1320' }} />
      </Box>
    );
  }
  const shape = b.shape ?? 'circle';
  // Match the cursor to the footprint: diamond = a square rotated 45°, scaled by 1/√2
  // so its points (not its corners) sit on the footprint radius; square = sharp; circle
  // = round. So you're not painting squares behind a round cursor.
  const isDiamond = shape === 'diamond';
  const sz = isDiamond ? b.d * 0.70711 : b.d;
  const off = (b.d - sz) / 2;
  const c = sz / 2;
  return (
    <Box style={{ position: 'absolute', left: b.x - r + off, top: b.y - r + off, width: sz, height: sz, borderRadius: shape === 'circle' ? sz / 2 : 2, borderWidth: 2, borderColor: b.color, backgroundColor: b.on ? `${b.color}26` : '#00000000', ...(isDiamond ? { transform: { rotate: 45 } } : {}) }}>
      {/* centre pip — the exact cell the next stamp lands on */}
      <Box style={{ position: 'absolute', left: c - 2, top: c - 2, width: 4, height: 4, borderRadius: 2, backgroundColor: b.color }} />
    </Box>
  );
});

// ── Canvas ───────────────────────────────────────────────────────────────────

// Controlled: tool / tile / layer live in the parent so they persist across hot
// reloads. Chunk buffers + zone defs + focus live here; they're seeded from the
// opened map (props.initialWorld) on mount, exposed for serialize via props.apiRef,
// and props.onEdit fires once per stroke / structural change to drive autosave.
export function PaintCanvas(props: {
  tool: Tool;
  onTool: (t: Tool) => void;
  tile: TileKind;
  onTile: (k: TileKind) => void;
  layer: Layer;
  onLayer: (l: Layer) => void;
  brush: BrushSettings;
  onBrushChange: (patch: Partial<BrushSettings>) => void;
  place: PlaceProps;
  showGrid?: boolean;
  // Throttled mirror of the focused chunks' painted tiles (one floor snapshot per
  // chunk) — drives the live iso-3D preview.
  onFloors?: (floors: ChunkFloor[]) => void;
  // The map to seed from on mount. The cart remounts PaintCanvas (key=map name)
  // when opening a different map, so this only ever reads on the first render of
  // each mount. null/undefined = a blank map (one seed chunk).
  initialWorld?: EditorWorld | null;
  // Where the 2D camera opens: the map's saved view (or the cart's painted-
  // content fallback). null/undefined = the host default (lattice origin) —
  // the pre-MAPGONE2-0605 behavior. Applied once per canvas instance.
  initialView?: CanvasView2D | null;
  // Registered with the live-world getter so the cart can serialize on autosave.
  apiRef?: { current: PaintCanvasApi | null };
  // Fired once per meaningful edit (stroke end, chunk add, focus / zone change) so
  // the cart can schedule a debounced autosave. NOT per painted cell. The optional
  // note categorizes the edit for the event log; omit it for silent edits (focus
  // toggles, zone-name keystrokes) that should autosave but not clutter the trace.
  onEdit?: (e?: EditNote) => void;
  // Fired at the START of an undoable action (before it mutates) — stroke begin,
  // chunk add, zone add/delete, clear — so the cart can snapshot the PRE-edit state
  // onto the undo stack. Pairs with onEdit (which fires after, for autosave).
  onEditBegin?: () => void;
  // WASD-pan focus is owned by the cart (shared with the 3D preview, which also
  // uses WASD) so exactly ONE quad consumes the keys. true = this pane is focused;
  // onWasdFocus fires on a click in this pane to claim it. Click-to-focus, never
  // hover — so the cursor wandering between quads can't steal an in-progress fly.
  wasdFocused?: boolean;
  onWasdFocus?: () => void;
  // Tile SELECTION (the pointer tool): click a cell to focus it, ctrl-click to
  // build a group. The selection drives the top-left override panel; the canvas
  // only reports clicks + draws the highlight. Owned by the cart so the panel can
  // read it. Never explodes to a Canvas.Node per tile — only the (small) selection
  // is drawn as highlight nodes.
  select?: {
    cells: SelCell[];
    set: (c: SelCell) => void;
    toggle: (c: SelCell) => void;
    clear: () => void;
  };
}) {
  const { tool, tile, layer, place } = props;
  const grid = props.showGrid !== false;
  const selPlacement = place.items.find((p) => p.id === place.selId) ?? null;
  const selBuildPlacement = place.buildItems?.find((p) => p.id === place.buildSelId) ?? null;

  const brushMode: BrushMode = props.brush.mode === 'erase' ? 'erase' : 'paint';
  const activeBrushMode: BrushMode = tool === 'eraser' && (layer === 'paint' || layer === 'zone') ? 'erase' : brushMode;
  const heightMode: HeightMode = props.brush.heightMode === 'ramp' || props.brush.heightMode === 'slope' || props.brush.heightMode === 'smooth' ? props.brush.heightMode : 'brush';
  const centerZ = clamp(Number(props.brush.centerZ), Z_MIN, Z_MAX);
  // One brush size (radius in tiles) shared by paint, zone, and height.
  const brushSize = clamp(Math.round(Number(props.brush.size)), SIZE_MIN, SIZE_MAX);
  const brushShape: BrushShape = props.brush.shape ?? 'circle';
  const heightProfile: BrushProfile = props.brush.profile ?? 'cone';
  const rampMin = clamp(Number(props.brush.rampMin), Z_MIN, Z_MAX);
  const rampMax = clamp(Number(props.brush.rampMax), Z_MIN, Z_MAX);
  const rampWide = Math.max(1, Number(props.brush.rampWide) || 1);
  const rampLong = Math.max(1, Number(props.brush.rampLong) || 1);
  const rampAngle = Number(props.brush.rampAngle) || 0;
  const smoothStrength = clamp(Number(props.brush.smoothStrength), 0.05, 1);
  const setBrushPatch = useCallback((patch: Partial<BrushSettings>) => props.onBrushChange(patch), [props.onBrushChange]);

  // The canvas viewport rect (screen space), for screen→graph.
  const rectRef = useRef<CanvasRect>(null);
  const drawing = useRef(false);
  // Per-stroke churn counters, logged at stroke end so we see what a single drag
  // costs without a line per sample. `cells` = UNIQUE cells touched (a slow drag
  // re-stamps the same cell many times, so this is the honest "how many tiles did I
  // paint"); `stamps` = total paint-calls (cells × overlap). `snap` = render-counter
  // snapshot at stroke begin, diffed at end to count how many UPDATES fired — the
  // guard against the old "one state update per painted tile" regression.
  const strokeStats = useRef<{ samples: number; stamps: number; cells: Set<string>; touches: number; coalesced: number; t0: number; snap: Record<string, number> }>({ samples: 0, stamps: 0, cells: new Set(), touches: 0, coalesced: 0, t0: 0, snap: {} });

  // ── WASD pans the view ───────────────────────────────────────────────────────
  // The Canvas's built-in `drift` (px/s, animated engine-side while no drag) does
  // the panning, so a held key streams smoothly with NO per-frame re-render — we
  // only re-render when the held-key SET changes. drift divides by zoom, so the
  // px/s speed stays constant at any zoom. Held keys sum, so W+A drifts diagonally.
  // Gated on props.wasdFocused (click-to-focus, owned by the cart and shared with
  // the 3D preview) so the cursor merely passing over this quad can't steal WASD
  // mid-fly — only a click claims it. Also gated on no text field being focused
  // anywhere (zone-name input, notes pane) so typing never pans; blur clears so
  // alt-tab can't strand a drift.
  const [drift, setDrift] = useState<CanvasPanDrift>({ x: 0, y: 0 });
  const driftRef = useRef<CanvasPanDrift>({ x: 0, y: 0 });
  const heldKeys = useRef<Set<string>>(new Set());
  const recomputeDriftRef = useRef<() => void>(() => {});
  const wasdFocusedRef = useRef(false);
  wasdFocusedRef.current = !!props.wasdFocused;
  const setPanDrift = useCallback((next: CanvasPanDrift) => {
    driftRef.current = next;
    setDrift(next);
  }, []);
  const clearPanDrift = useCallback(() => {
    if (!heldKeys.current.size && driftRef.current.x === 0 && driftRef.current.y === 0) return;
    heldKeys.current.clear();
    setPanDrift({ x: 0, y: 0 });
  }, [setPanDrift]);
  // Ctrl-held state — mouse events carry no modifier flags, so track it off the key
  // bus (every key event reports the live modifier mask). Drives ctrl-click select.
  const ctrlHeldRef = useRef(false);
  const placeBrushKeyRef = useRef<{ enabled: boolean; rotate: (delta: number) => void }>({ enabled: false, rotate: () => {} });
  // Lost focus (another quad claimed WASD) → drop held keys so the pan stops at once.
  useEffect(() => {
    if (!props.wasdFocused) clearPanDrift();
  }, [props.wasdFocused, clearPanDrift]);
  useEffect(() => {
    const recompute = () => {
      setPanDrift(canvasPanDriftForHeldKeys(heldKeys.current));
    };
    recomputeDriftRef.current = recompute;
    const textFocused = () => {
      const t = callHost<{ focused_id?: number } | null>('__tel_input', null);
      return !!t && Number(t.focused_id ?? -1) >= 0;
    };
    const onDown = (ev: any) => {
      if (typeof ev?.ctrlKey === 'boolean') ctrlHeldRef.current = ev.ctrlKey || ev.metaKey;
      const k = String(ev?.key ?? '').toLowerCase();
      if (placeBrushKeyRef.current.enabled && !ev?.ctrlKey && !ev?.altKey && !ev?.metaKey && (k === 'r' || k === 'e' || k === 'q')) {
        if (!textFocused()) placeBrushKeyRef.current.rotate(k === 'q' ? -ROT_STEP : ROT_STEP);
        return;
      }
      if (!PAN_DIR[k] || ev?.ctrlKey || ev?.altKey || ev?.metaKey) return;
      if (!wasdFocusedRef.current) return; // only the focused quad pans
      if (heldKeys.current.has(k) || textFocused()) return; // ignore key-repeat / typing
      heldKeys.current.add(k); recompute();
    };
    const onUp = (ev: any) => {
      if (typeof ev?.ctrlKey === 'boolean') ctrlHeldRef.current = ev.ctrlKey || ev.metaKey;
      const k = String(ev?.key ?? '').toLowerCase();
      if (heldKeys.current.delete(k)) recompute();
    };
    const clear = () => { clearPanDrift(); };
    const offDown = busOn('__keydown', onDown);
    const offUp = busOn('__keyup', onUp);
    const offBlur = busOn('system:blur', clear);
    return () => { offDown(); offUp(); offBlur(); clear(); };
  }, [clearPanDrift, setPanDrift]);
  // Claim WASD focus on a click anywhere in the canvas working area.
  const claimWasd = props.onWasdFocus;

  // ── Chunk registry: a sparse grid of 120x120 chunks, seeded with (0,0) = a0.
  //    The Map holds the (big, non-React) buffers; chunkRev bumps when the SET of
  //    chunks changes so derived lists re-read it. ────────────────────────────
  const chunksRef = useRef<Map<ChunkKey, Chunk> | null>(null);
  if (!chunksRef.current) {
    if (props.initialWorld) {
      chunksRef.current = props.initialWorld.chunks; // seed from the opened map
    } else {
      const m = new Map<ChunkKey, Chunk>();
      m.set(chunkKey(0, 0), makeChunk(0, 0));
      chunksRef.current = m;
    }
  }
  const chunks = chunksRef.current;
  const [chunkRev, setChunkRev] = useState(0);
  const [focus, setFocus] = useState<Set<ChunkKey>>(() => props.initialWorld ? new Set(props.initialWorld.focus) : new Set([chunkKey(0, 0)]));
  const focusRef = useRef(focus);
  focusRef.current = focus;

  // Live preview sync: mirror the focused chunks' painted tiles + height to the 3D
  // preview, THROTTLED. tileData / heights are cached per chunk and only re-encoded
  // when that LAYER was painted (dirty set), so a tile stroke keeps heights stable
  // (no height-mesh regen) and a height stroke keeps tileData stable (no texture
  // re-bake) — the preview only redoes the part that changed.
  const onFloorsRef = useRef(props.onFloors);
  onFloorsRef.current = props.onFloors;
  // Edit notifier — coalesced to once per stroke / structural change (NOT per
  // cell) so the cart's autosave debounce fires without thrashing the paint path.
  const onEditRef = useRef(props.onEdit);
  onEditRef.current = props.onEdit;
  const notifyEdit = useCallback((e?: EditNote) => { onEditRef.current?.(e); }, []);
  const onEditBeginRef = useRef(props.onEditBegin);
  onEditBeginRef.current = props.onEditBegin;
  const notifyEditBegin = useCallback(() => { onEditBeginRef.current?.(); }, []);
  const tileDirty = useRef<Set<ChunkKey>>(new Set());
  const heightDirty = useRef<Set<ChunkKey>>(new Set());
  const tileCache = useRef<Map<ChunkKey, number[]>>(new Map());
  const heightCache = useRef<Map<ChunkKey, number[]>>(new Map());
  const heightVer = useRef<Map<ChunkKey, number>>(new Map()); // bumps per re-downsample → host slot overwrite
  const regionSyncPending = useRef(false);
  const buildFloors = useCallback((): ChunkFloor[] => {
    const t0 = (globalThis as any).performance?.now?.() ?? 0;
    let focused = 0, tileEnc = 0, heightEnc = 0;
    const out: ChunkFloor[] = [];
    for (const c of chunks.values()) {
      const k = chunkKey(c.cx, c.cz);
      if (!focusRef.current.has(k)) continue;
      focused++;
      if (tileDirty.current.has(k) || !tileCache.current.has(k)) {
        tileCache.current.set(k, encodeTileMap(c.tiles));
        tileDirty.current.delete(k);
        tileEnc++;
      }
      if (heightDirty.current.has(k) || !heightCache.current.has(k)) {
        heightCache.current.set(k, downsampleChunkFloorHeights(c.height.z, c.height.cols, c.height.rows));
        heightVer.current.set(k, (heightVer.current.get(k) ?? 0) + 1);
        heightDirty.current.delete(k);
        heightEnc++;
      }
      out.push({ cx: c.cx, cz: c.cz, tileData: tileCache.current.get(k)!, heights: heightCache.current.get(k)!, hcols: CHUNK_FLOOR_HF_RES, hrows: CHUNK_FLOOR_HF_RES, hver: heightVer.current.get(k) ?? 0 });
    }
    const dt = ((globalThis as any).performance?.now?.() ?? 0) - t0;
    plog('buildFloors', `focused=${focused} tileEncoded=${tileEnc} heightEncoded=${heightEnc} took ${dt.toFixed(2)}ms`);
    return out;
  }, [chunks]);
  const syncRegionsNow = useCallback(() => {
    plog('regionSync', `FIRE → onFloors (coalesced ${strokeStats.current.coalesced} schedule calls)`);
    strokeStats.current.coalesced = 0;
    onFloorsRef.current?.(buildFloors());
  }, [buildFloors]);
  const scheduleRegionSync = useCallback(() => {
    // Already pending: just tally it (one paint sample = one schedule call). Logging
    // each would bury the signal — the count rides the next FIRE line instead.
    if (regionSyncPending.current) { strokeStats.current.coalesced++; return; }
    regionSyncPending.current = true;
    setTimeout(() => { regionSyncPending.current = false; syncRegionsNow(); }, REGION_SYNC_MS);
  }, [syncRegionsNow]);
  useEffect(() => { syncRegionsNow(); }, [syncRegionsNow]); // initial mirror on mount

  const allChunks = useMemo(() => Array.from(chunks.values()), [chunks, chunkRev]);
  const focusedChunks = allChunks.filter((c) => focus.has(chunkKey(c.cx, c.cz)));
  // [mapgone-probe MAPGONE2-0605] surface gate — stays until the user confirms
  useEffect(() => {
    console.warn(`[mapgone] PaintCanvas mount: seed=${props.initialWorld ? 'initialWorld' : 'blank'} chunks=${chunks.size} focus=${focus.size} focusedChunks=${focusedChunks.length} layer=${layer}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount probe
  }, []);
  const occupied = useCallback((cx: number, cz: number) => chunks.has(chunkKey(cx, cz)), [chunks]);

  // Per-chunk flush callbacks (registered by each ChunkSurface) so the brush can
  // re-upload only the chunk it painted.
  const touchMapRef = useRef<Map<ChunkKey, () => void>>(new Map());
  const registerTouch = useCallback((k: ChunkKey, t: () => void) => { touchMapRef.current.set(k, t); }, []);
  const unregisterTouch = useCallback((k: ChunkKey) => { touchMapRef.current.delete(k); }, []);
  const touchChunk = (k: ChunkKey) => { strokeStats.current.touches++; touchMapRef.current.get(k)?.(); };

  const addChunk = useCallback((cx: number, cz: number) => {
    const k = chunkKey(cx, cz);
    if (chunks.has(k) || !inBounds(cx, cz)) return;
    notifyEditBegin(); // snapshot pre-add state for undo
    chunks.set(k, makeChunk(cx, cz));
    setChunkRev((r) => r + 1);
    setFocus((f) => { const n = new Set(f); n.add(k); return n; }); // bring the new chunk into view
    scheduleRegionSync();
    notifyEdit({ cat: 'chunk', text: `added chunk ${chunkLabel(cx, cz)}` });
  }, [chunks, scheduleRegionSync, notifyEdit, notifyEditBegin]);

  const toggleFocus = useCallback((k: ChunkKey) => {
    setFocus((f) => { const n = new Set(f); if (n.has(k)) n.delete(k); else n.add(k); return n; });
    scheduleRegionSync();
    notifyEdit();
  }, [scheduleRegionSync, notifyEdit]);
  const focusAll = useCallback(() => { setFocus(new Set(Array.from(chunks.keys()))); scheduleRegionSync(); notifyEdit(); }, [chunks, scheduleRegionSync, notifyEdit]);
  const focusNone = useCallback(() => { setFocus(new Set()); scheduleRegionSync(); notifyEdit(); }, [scheduleRegionSync, notifyEdit]);

  // The open "+" slots = unique in-bounds, unoccupied neighbours of focused chunks.
  const addSlots = useMemo(() => {
    const slots = new Map<ChunkKey, { cx: number; cz: number }>();
    for (const c of focusedChunks) {
      for (const n of openNeighbors(occupied, c.cx, c.cz)) slots.set(chunkKey(n.cx, n.cz), n);
    }
    return Array.from(slots.values());
  }, [focusedChunks, occupied, chunkRev]);

  // ── Coordinate plumbing ──────────────────────────────────────────────────────
  const screenToGraph = (sx: number, sy: number) => {
    const r = rectRef.current;
    if (!r) return null;
    return callHost<{ gx: number; gy: number } | null>('__canvas_screen_to_graph', null, sx, sy, r.x + r.width / 2, r.y + r.height / 2);
  };

  // graph point → which focused chunk + local/global cell, or null if off any
  // focused chunk. Centre-lattice: chunk (cx,cz) is centred at (cx*PATCH, cz*PATCH).
  const resolveCell = (gx: number, gz: number) => {
    const cx = Math.round(gx / PATCH);
    const cz = Math.round(gz / PATCH);
    const k = chunkKey(cx, cz);
    if (!focus.has(k)) return null;
    const chunk = chunks.get(k);
    if (!chunk) return null;
    const lx = gx - cx * PATCH + PATCH / 2; // 0..PATCH within the chunk
    const lz = gz - cz * PATCH + PATCH / 2;
    const cellX = Math.floor(lx / TILE_UNITS);
    const cellZ = Math.floor(lz / TILE_UNITS);
    if (cellX < 0 || cellZ < 0 || cellX >= CHUNK_TILES || cellZ >= CHUNK_TILES) return null;
    // The cell's CENTRE in graph space (chunk left edge + (cell + 0.5) tiles) — where
    // the brush footprint snaps so the visible circle sits on what it'll actually paint.
    const cgx = cx * PATCH - PATCH / 2 + (cellX + 0.5) * TILE_UNITS;
    const cgy = cz * PATCH - PATCH / 2 + (cellZ + 0.5) * TILE_UNITS;
    return { chunk, k, lx, lz, cellX, cellZ, cgx, cgy, gCellX: cx * CHUNK_TILES + cellX, gCellZ: cz * CHUNK_TILES + cellZ };
  };

  // Clicking an empty open slot (through the brush overlay) attaches a chunk there.
  const tryAddSlotAt = (sx: number, sy: number): boolean => {
    const g = screenToGraph(sx, sy);
    if (!g) return false;
    const cx = Math.round(g.gx / PATCH);
    const cz = Math.round(g.gy / PATCH);
    if (occupied(cx, cz) || !inBounds(cx, cz)) return false;
    // Only an add-slot if it borders a focused (visible) chunk — matches addSlots.
    const adjacentToFocus = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dz]) => focus.has(chunkKey(cx + dx, cz + dz)) && chunks.has(chunkKey(cx + dx, cz + dz)));
    if (!adjacentToFocus) return false;
    addChunk(cx, cz);
    return true;
  };

  // ── Brush params (ref so the screen-space handler never goes stale) ──────────
  const brushRef = useRef({ centerZ, size: brushSize, mode: brushMode, shape: brushShape, profile: heightProfile, heightMode, rampMin, rampMax, rampWide, rampLong, rampAngle, smoothStrength });
  brushRef.current = { centerZ, size: brushSize, mode: brushMode, shape: brushShape, profile: heightProfile, heightMode, rampMin, rampMax, rampWide, rampLong, rampAngle, smoothStrength };
  // Height is ADDITIVE (heightData.stampCone stacks), but onMouseMove fires at input
  // rate (~100/s) — re-stamping a stationary brush every event saturates cells to
  // HEIGHT_LIMIT in a few frames, flattening everything to one max plateau and making
  // the z intensity look inert. The design's "overlap builds relief" comes from the
  // brush MOVING, so deposit the cone at most once per center-cell per stroke; genuine
  // drag motion still stacks across cells, separate strokes still stack on top.
  const heightStamped = useRef<Set<string>>(new Set());
  const paintRef = useRef({ tile, tool, size: brushSize, mode: activeBrushMode, shape: brushShape });
  paintRef.current = { tile, tool, size: brushSize, mode: activeBrushMode, shape: brushShape };

  // Height sculpt. The cone is stamped in a SHARED GLOBAL sample frame, not clipped to
  // the one chunk under the cursor — so a stroke straddling a chunk border deposits the
  // SAME cone into both chunks. Because the shared edge column maps to the identical
  // global sample distance on each side (chunk widths are exact multiples), both sides
  // compute the same height there: no seam, no clipped half-dome at the border.
  const GSAMPLE = TILE_UNITS * DOT_M; // graph units between adjacent height samples

  // The stamps below take a GRAPH point (not screen) and accumulate the chunks they
  // dirtied into `touched`, but never touch the GPU or schedule a sync themselves —
  // onBrush coalesces those once per call. That's what lets onBrush interpolate a
  // whole segment (many sub-stamps) without firing one GPU re-upload per sub-stamp.

  // Height sculpt. The cone is stamped in a SHARED GLOBAL sample frame, not clipped to
  // the one chunk under the cursor — so a stroke straddling a chunk border deposits the
  // SAME cone into both chunks. Because the shared edge column maps to the identical
  // global sample distance on each side (chunk widths are exact multiples), both sides
  // compute the same height there: no seam, no clipped half-dome at the border.
  const stampHeightAtGraph = (gx: number, gy: number, touched: Set<ChunkKey>) => {
    const b = brushRef.current;
    // Per-stroke dedup on the GLOBAL sample cell (chunk-independent) so a stationary
    // brush deposits once but genuine drag motion still stacks across cells.
    const gsx = Math.round(gx / GSAMPLE), gsy = Math.round(gy / GSAMPLE);
    const stampKey = `${gsx}:${gsy}`;
    if (heightStamped.current.has(stampKey)) return; // already deposited here this stroke
    heightStamped.current.add(stampKey);
    // Brush radius = brush size (metres); the shape sets the cross-section profile.
    const radiusM = Math.max(0.5, b.size);
    const rd = Math.max(1, Math.ceil(radiusM / DOT_M)); // brush reach in samples
    for (const ch of focusedChunks) {
      const cols = ch.height.cols, rows = ch.height.rows;
      // Express the global brush centre in THIS chunk's local sample index space. Chunk
      // (cx,cz) is centred at (cx*PATCH, cz*PATCH); its sample 0 sits at the left edge.
      const cix = Math.round((gx - ch.cx * PATCH + PATCH / 2) / PATCH * (cols - 1));
      const ciy = Math.round((gy - ch.cz * PATCH + PATCH / 2) / PATCH * (rows - 1));
      // Skip chunks the brush can't reach (cheap: avoids touching/re-uploading them).
      if (cix + rd < 0 || cix - rd > cols - 1 || ciy + rd < 0 || ciy - rd > rows - 1) continue;
      stampBrush(ch.height, cix, ciy, { centerZ: b.centerZ, radiusM, shape: b.shape, profile: b.profile, erase: b.mode === 'erase' });
      const k = chunkKey(ch.cx, ch.cz);
      touched.add(k);
      heightDirty.current.add(k);
    }
    // The 3D preview-mesh mirror is DEFERRED to stroke end (endStroke → syncRegionsNow):
    // a height edit re-ships the whole ~65k-float mesh across the bridge, so doing it
    // mid-stroke per dirty chunk freezes paint. The 2D canvas is live via the touch.
  };

  const slopeStroke = useRef<{ points: { x: number; y: number }[] } | null>(null);
  const stampSlopeSegmentAtGraph = (from: { x: number; y: number }, to: { x: number; y: number }, distanceStartM: number, runM: number, touched: Set<ChunkKey>) => {
    const b = brushRef.current;
    const key = `slope:${Math.round(from.x / GSAMPLE)}:${Math.round(from.y / GSAMPLE)}:${Math.round(to.x / GSAMPLE)}:${Math.round(to.y / GSAMPLE)}:${Math.round(distanceStartM * 4)}`;
    if (heightStamped.current.has(key)) return;
    heightStamped.current.add(key);
    const radiusM = Math.max(0.5, b.size);
    const rd = Math.max(1, Math.ceil(radiusM / DOT_M)) + 1;
    for (const ch of focusedChunks) {
      const cols = ch.height.cols, rows = ch.height.rows;
      const ax = (from.x - ch.cx * PATCH + PATCH / 2) / PATCH * (cols - 1);
      const ay = (from.y - ch.cz * PATCH + PATCH / 2) / PATCH * (rows - 1);
      const bx = (to.x - ch.cx * PATCH + PATCH / 2) / PATCH * (cols - 1);
      const by = (to.y - ch.cz * PATCH + PATCH / 2) / PATCH * (rows - 1);
      if (Math.max(ax, bx) + rd < 0 || Math.min(ax, bx) - rd > cols - 1 || Math.max(ay, by) + rd < 0 || Math.min(ay, by) - rd > rows - 1) continue;
      const wrote = stampSlopeSegment(ch.height, ax, ay, bx, by, { startZ: b.rampMin, endZ: b.rampMax, runM, distanceStartM, radiusM, profile: b.profile });
      if (!wrote) continue;
      const k = chunkKey(ch.cx, ch.cz);
      touched.add(k);
      heightDirty.current.add(k);
    }
  };

  const stampSmoothAtGraph = (gx: number, gy: number, touched: Set<ChunkKey>) => {
    const b = brushRef.current;
    const gsx = Math.round(gx / GSAMPLE), gsy = Math.round(gy / GSAMPLE);
    const stampKey = `smooth:${gsx}:${gsy}`;
    if (heightStamped.current.has(stampKey)) return;
    heightStamped.current.add(stampKey);
    const radiusM = Math.max(0.5, b.size);
    type Sample = { ch: Chunk; k: ChunkKey; idx: number; x: number; y: number; z: number; falloff: number };
    const samples: Sample[] = [];
    let sw = 0, sx = 0, sy = 0, sz = 0;
    let sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0;

    for (const ch of focusedChunks) {
      const cols = ch.height.cols, rows = ch.height.rows;
      const cix = (gx - ch.cx * PATCH + PATCH / 2) / PATCH * (cols - 1);
      const ciy = (gy - ch.cz * PATCH + PATCH / 2) / PATCH * (rows - 1);
      const rd = Math.max(1, Math.ceil(radiusM / DOT_M)) + 1;
      const minX = Math.max(0, Math.floor(cix - rd));
      const maxX = Math.min(cols - 1, Math.ceil(cix + rd));
      const minY = Math.max(0, Math.floor(ciy - rd));
      const maxY = Math.min(rows - 1, Math.ceil(ciy + rd));
      if (minX > maxX || minY > maxY) continue;
      const k = chunkKey(ch.cx, ch.cz);
      for (let jy = minY; jy <= maxY; jy += 1) {
        for (let jx = minX; jx <= maxX; jx += 1) {
          const x = ((jx - cix) * DOT_M);
          const y = ((jy - ciy) * DOT_M);
          const dm = footprintDistance(b.shape, x / DOT_M, y / DOT_M) * DOT_M;
          if (dm > radiusM) continue;
          const falloff = brushProfile(b.profile, dm / radiusM);
          if (falloff <= 0) continue;
          const idx = jy * cols + jx;
          const z = ch.height.z[idx];
          const w = Math.max(0.001, falloff);
          samples.push({ ch, k, idx, x, y, z, falloff });
          sw += w; sx += w * x; sy += w * y; sz += w * z;
          sxx += w * x * x; sxy += w * x * y; syy += w * y * y;
          sxz += w * x * z; syz += w * y * z;
        }
      }
    }

    if (!samples.length || sw <= 0) return;
    const det = det3(sxx, sxy, sx, sxy, syy, sy, sx, sy, sw);
    let a = 0, bb = 0, c = sz / sw;
    if (Math.abs(det) > 1e-9) {
      a = det3(sxz, sxy, sx, syz, syy, sy, sz, sy, sw) / det;
      bb = det3(sxx, sxz, sx, sxy, syz, sy, sx, sz, sw) / det;
      c = det3(sxx, sxy, sxz, sxy, syy, syz, sx, sy, sz) / det;
    }

    const strength = Math.max(0.05, Math.min(1, b.smoothStrength));
    for (const s of samples) {
      const target = clamp(a * s.x + bb * s.y + c, Z_MIN, Z_MAX);
      s.ch.height.z[s.idx] = clamp(s.z + (target - s.z) * strength * s.falloff, Z_MIN, Z_MAX);
      touched.add(s.k);
      heightDirty.current.add(s.k);
    }
  };

  const stampRampAtGraph = (gx: number, gy: number, opts: { minZ: number; maxZ: number; wideM: number; longM: number; angleDeg: number }, touched: Set<ChunkKey>) => {
    const stampKey = `ramp:${Math.round(gx / GSAMPLE)}:${Math.round(gy / GSAMPLE)}:${Math.round(opts.angleDeg)}:${Math.round(opts.longM * 10)}:${Math.round(opts.wideM * 10)}`;
    if (heightStamped.current.has(stampKey)) return;
    heightStamped.current.add(stampKey);
    const rd = Math.ceil(Math.hypot(opts.wideM, opts.longM) / DOT_M / 2) + 2;
    for (const ch of focusedChunks) {
      const cols = ch.height.cols, rows = ch.height.rows;
      const cix = (gx - ch.cx * PATCH + PATCH / 2) / PATCH * (cols - 1);
      const ciy = (gy - ch.cz * PATCH + PATCH / 2) / PATCH * (rows - 1);
      if (cix + rd < 0 || cix - rd > cols - 1 || ciy + rd < 0 || ciy - rd > rows - 1) continue;
      stampRamp(ch.height, cix, ciy, opts);
      const k = chunkKey(ch.cx, ch.cz);
      touched.add(k);
      heightDirty.current.add(k);
    }
  };

  const stampTileAtGraph = (gx: number, gy: number, touched: Set<ChunkKey>) => {
    const c = resolveCell(gx, gy);
    if (!c) return;
    const p = paintRef.current;
    const idx = p.tool === 'eraser' || p.mode === 'erase' ? -1 : tileKindIndex(p.tile);
    forEachFootprintCell(p.shape, p.size, c.cellX, c.cellZ, (x, z) => {
      const s = strokeStats.current; s.stamps++;
      if (x >= 0 && z >= 0 && x < CHUNK_TILES && z < CHUNK_TILES) s.cells.add(`${c.k}:${x}:${z}`);
      paintTile(c.chunk.tiles, x, z, idx);
    });
    touched.add(c.k);
    tileDirty.current.add(c.k); // mirror the floor texture to the preview (synced by onBrush)
  };

  const stampZoneAtGraph = (gx: number, gy: number, touched: Set<ChunkKey>) => {
    if (!zones.length) return;
    const c = resolveCell(gx, gy);
    if (!c) return;
    const p = paintRef.current;
    const idx = p.tool === 'eraser' || p.mode === 'erase' ? -1 : activeZoneRef.current;
    forEachFootprintCell(p.shape, p.size, c.cellX, c.cellZ, (x, z) => {
      const s = strokeStats.current; s.stamps++;
      if (x >= 0 && z >= 0 && x < CHUNK_TILES && z < CHUNK_TILES) s.cells.add(`${c.k}:${x}:${z}`);
      paintZoneCell(c.chunk.zones, x, z, idx);
    });
    touched.add(c.k);
  };

  const clearHeights = () => {
    notifyEditBegin(); // snapshot pre-clear state for undo
    for (const c of focusedChunks) { clearField(c.height); touchChunk(chunkKey(c.cx, c.cz)); heightDirty.current.add(chunkKey(c.cx, c.cz)); }
    scheduleRegionSync();
    notifyEdit({ cat: 'height', text: 'cleared height' });
  };

  // ── Zones: per-cell membership is per chunk; the DEFS are shared world-wide ───
  const [zones, setZones] = useState<ZoneDef[]>(() => props.initialWorld ? props.initialWorld.zones : []);
  const [activeZone, setActiveZone] = useState(0);
  // Start the id counter past any seeded zone (ids are `z_<n>`) so new zones in an
  // opened map don't collide with restored ones.
  const zoneSeq = useRef(
    (props.initialWorld?.zones ?? []).reduce((mx, z) => {
      const n = Number(/^z_(\d+)$/.exec(z.id)?.[1] ?? 0);
      return n > mx ? n : mx;
    }, 0),
  );
  const activeZoneRef = useRef(activeZone);
  activeZoneRef.current = activeZone;

  const addZone = () => {
    notifyEditBegin(); // snapshot pre-add state for undo
    zoneSeq.current += 1;
    const id = `z_${zoneSeq.current}`;
    const i = zones.length;
    setZones((zs) => [...zs, { id, name: `Zone ${zs.length + 1}`, color: ZONE_COLORS[zs.length % ZONE_COLORS.length], flags: [] }]);
    setActiveZone(i);
    props.onTool('brush');
    props.onBrushChange({ mode: 'paint' });
    notifyEdit({ cat: 'zone', text: `added zone Zone ${i + 1}` });
  };
  const updateZone = (i: number, patch: Partial<ZoneDef>) => { setZones((zs) => zs.map((z, j) => (j === i ? { ...z, ...patch } : z))); notifyEdit(); };
  const deleteZone = (i: number) => {
    notifyEditBegin(); // snapshot pre-delete state for undo
    for (const c of allChunks) dropZoneIndex(c.zones, i); // keep zone indices consistent across all chunks
    for (const c of focusedChunks) touchChunk(chunkKey(c.cx, c.cz));
    setZones((zs) => zs.filter((_, j) => j !== i));
    setActiveZone((a) => (a >= i ? Math.max(0, a - 1) : a));
    notifyEdit({ cat: 'zone', text: 'removed zone' });
  };

  // ── Roads (ROADSTROKE-0610): authored strokes, compiled to tile stamps ───────
  // A road is a stroke (centerline + profile, roadData.ts). Stamping is
  // DESTRUCTIVE into the chunk tile grids — the grid stays the single runtime
  // truth — with an UNDERCOAT (cell → prior index) so editing or deleting a
  // stroke restores the paint beneath. Any stroke change does a GLOBAL restamp
  // (restore all, replan all, stamp all): junctions depend on every stroke, and
  // road footprints are tiny next to the chunk grids.
  const [roads, setRoads] = useState<RoadStroke[]>(() => props.initialWorld?.roads ?? []);
  const roadUnderRef = useRef<Map<string, number> | null>(null);
  if (!roadUnderRef.current) roadUnderRef.current = props.initialWorld?.roadUnder ?? new Map();
  const roadSeq = useRef(
    (props.initialWorld?.roads ?? []).reduce((mx, r) => {
      const n = Number(/^r_(\d+)$/.exec(r.id)?.[1] ?? 0);
      return n > mx ? n : mx;
    }, 0),
  );
  const [roadDraft, setRoadDraft] = useState<RoadPoint[]>([]);
  const [roadProfile, setRoadProfile] = useState<RoadProfile>({ lanesF: 1, lanesB: 1, sidewalks: true });
  const [selRoadId, setSelRoadId] = useState<string | null>(null);
  // The wire view (req_0528): dotted centerlines + endpoint connect-squares
  // over every committed stroke, so new roads continue the existing network.
  const [showRoadWires, setShowRoadWires] = useState(true);
  const roadsRef = useRef(roads);
  roadsRef.current = roads;
  const roadDraftRef = useRef(roadDraft);
  roadDraftRef.current = roadDraft;
  const roadProfileRef = useRef(roadProfile);
  roadProfileRef.current = roadProfile;

  // Global-cell read/write through the chunk registry (gx = cx·CHUNK_TILES + cellX,
  // the SelCell convention). Cells over missing chunks read null and skip the
  // stamp — they catch up on the next restamp once the chunk exists.
  const readWorldCell = (gx: number, gz: number): number | null => {
    const cx = Math.floor(gx / CHUNK_TILES), cz = Math.floor(gz / CHUNK_TILES);
    const ch = chunks.get(chunkKey(cx, cz));
    if (!ch) return null;
    return ch.tiles.idx[(gz - cz * CHUNK_TILES) * ch.tiles.cols + (gx - cx * CHUNK_TILES)] ?? -1;
  };
  const writeWorldCell = (gx: number, gz: number, idx: number, touched: Set<ChunkKey>) => {
    const cx = Math.floor(gx / CHUNK_TILES), cz = Math.floor(gz / CHUNK_TILES);
    const k = chunkKey(cx, cz);
    const ch = chunks.get(k);
    if (!ch) return;
    paintTile(ch.tiles, gx - cx * CHUNK_TILES, gz - cz * CHUNK_TILES, idx);
    touched.add(k);
    tileDirty.current.add(k);
  };
  const restampRoads = (next: RoadStroke[], noteText: string) => {
    notifyEditBegin();
    const touched = new Set<ChunkKey>();
    const under = roadUnderRef.current!;
    for (const [key, prior] of under) {
      const { gx, gz } = parseCellKey(key);
      writeWorldCell(gx, gz, prior, touched);
    }
    under.clear();
    const plan = planRoads(next);
    for (const [key, kind] of plan) {
      const { gx, gz } = parseCellKey(key);
      const cur = readWorldCell(gx, gz);
      if (cur === null) continue;
      under.set(key, cur);
      writeWorldCell(gx, gz, tileKindIndex(kind), touched);
    }
    setRoads(next);
    for (const k of touched) touchChunk(k);
    scheduleRegionSync();
    notifyEdit({ cat: 'road', text: noteText });
  };
  const commitRoadDraft = () => {
    const pts = roadDraftRef.current;
    if (pts.length < 2) return;
    roadSeq.current += 1;
    const stroke: RoadStroke = { id: `r_${roadSeq.current}`, points: [...pts], profile: clampProfile(roadProfileRef.current) };
    // Mid-stroke connections (req_0529): a draft END landing on another road's
    // centerline mid-span SPLITS that road there — the seam stays one
    // continuous road (parallel axes never box) and each half re-profiles
    // independently (widen the downstream half = the lane merge).
    let next = [...roadsRef.current];
    for (const end of [pts[0]!, pts[pts.length - 1]!]) {
      const hit = snapToCenterline(next, end, 0.6);
      if (!hit?.midSpan) continue;
      const idx = next.findIndex((r) => r.id === hit.strokeId);
      if (idx < 0) continue;
      roadSeq.current += 1;
      const idA = `r_${roadSeq.current}`;
      roadSeq.current += 1;
      const idB = `r_${roadSeq.current}`;
      const halves = splitStroke(next[idx]!, hit.point, idA, idB);
      if (halves) next.splice(idx, 1, ...halves);
    }
    setRoadDraft([]);
    setSelRoadId(stroke.id);
    restampRoads([...next, stroke], `road ${profileLabel(stroke.profile)}`);
  };
  const cancelRoadDraft = () => setRoadDraft([]);
  const undoRoadPoint = () => setRoadDraft((d) => d.slice(0, -1));
  const deleteRoad = (id: string) => {
    setSelRoadId((s) => (s === id ? null : s));
    restampRoads(roadsRef.current.filter((r) => r.id !== id), 'removed road');
  };
  // The rail's steppers edit the SELECTED road live (restamp) when one is
  // selected; otherwise they shape the draft profile for the next stroke.
  const selRoad = roads.find((r) => r.id === selRoadId) ?? null;
  const editActiveProfile = (patch: Partial<RoadProfile>) => {
    if (selRoad) {
      const next = roadsRef.current.map((r) =>
        r.id === selRoad.id ? { ...r, profile: clampProfile({ ...r.profile, ...patch }) } : r,
      );
      const changed = next.find((r) => r.id === selRoad.id)!;
      restampRoads(next, `road reprofiled ${profileLabel(changed.profile)}`);
    } else {
      setRoadProfile((p) => clampProfile({ ...p, ...patch }));
    }
  };
  const commitRoadDraftRef = useRef(commitRoadDraft);
  commitRoadDraftRef.current = commitRoadDraft;
  const cancelRoadDraftRef = useRef(cancelRoadDraft);
  cancelRoadDraftRef.current = cancelRoadDraft;
  // Enter stamps the draft, Esc drops it — only while the road layer is up.
  useEffect(() => {
    if (layer !== 'road') return;
    return busOn('__keydown', (ev: any) => {
      const k = String(ev?.key ?? '');
      if (k === 'Enter') commitRoadDraftRef.current();
      else if (k === 'Escape') cancelRoadDraftRef.current();
    });
  }, [layer]);

  // Register the live-world getter so the cart can serialize on autosave. Reassign
  // each render so it captures the latest zones / focus (chunks is a stable ref).
  // The live 2D camera, read back through the host's affine screen→graph
  // mapping: the rect centre maps to the view centre, and a second probe one
  // PROBE px to the side yields the zoom (px per graph unit) — the same trick
  // the brush cursor uses (no graph→screen host fn exists; none needed).
  const getView = (): CanvasView2D | null => {
    const r = rectRef.current;
    if (!r || r.width <= 0) return null;
    const cxp = r.x + r.width / 2;
    const cyp = r.y + r.height / 2;
    const center = callHost<{ gx: number; gy: number } | null>('__canvas_screen_to_graph', null, cxp, cyp, cxp, cyp);
    const probe = callHost<{ gx: number; gy: number } | null>('__canvas_screen_to_graph', null, cxp + 100, cyp, cxp, cyp);
    if (!center || !probe || probe.gx === center.gx) return null;
    return { x: center.gx, y: center.gy, zoom: 100 / (probe.gx - center.gx) };
  };
  if (props.apiRef) props.apiRef.current = { getWorld: () => ({ chunks, zones, focus, roads, roadUnder: roadUnderRef.current! }), getView };

  // Unified brush dispatch: paint paints tiles, zone paints the active zone, height
  // sculpts; place stamps the armed object when the brush tool is active.
  const isRampTool = layer === 'height' && heightMode === 'ramp';
  const isSlopeTool = layer === 'height' && heightMode === 'slope';
  const isSmoothTool = layer === 'height' && heightMode === 'smooth';
  const showPlaceBrush = layer === 'place' && tool === 'brush' && !!place.active;
  const showBrush = layer === 'height' || showPlaceBrush || ((layer === 'paint' || layer === 'zone') && tool !== 'pointer');
  placeBrushKeyRef.current = { enabled: showPlaceBrush, rotate: place.onRotateBrush };
  // What a just-finished stroke did, for the event log — read from the active layer
  // + tool at stroke end.
  const strokeNote = (): EditNote => {
    if (layer === 'height') return { cat: 'height', text: isRampTool ? 'stamped ramp' : isSlopeTool ? 'painted slope' : isSmoothTool ? 'smoothed terrain' : brushMode === 'erase' ? 'lowered terrain' : 'raised terrain' };
    if (layer === 'place') return { cat: 'object', text: `painted ${place.active?.label ?? 'object'}` };
    if (layer === 'zone') { const z = zones[activeZone]; return { cat: 'zone', text: activeBrushMode === 'erase' ? 'erased zone' : `painted ${z ? z.name : 'zone'}` }; }
    return { cat: 'tile', text: activeBrushMode === 'erase' ? 'erased tiles' : `painted ${tile}` };
  };
  // Where the last stamp landed, in GRAPH space, so onBrush can fill the gap to the
  // current point. null between strokes (reset in beginStroke) so a new stroke never
  // draws a line from the previous stroke's end.
  const lastStampG = useRef<{ x: number; y: number } | null>(null);
  const rampStroke = useRef<{ start: { x: number; y: number }; current: { x: number; y: number } } | null>(null);
  const stampOneAtGraph = (gx: number, gy: number, touched: Set<ChunkKey>) => {
    if (layer === 'height' && isSmoothTool) stampSmoothAtGraph(gx, gy, touched);
    else if (layer === 'height' && !isRampTool && !isSlopeTool) stampHeightAtGraph(gx, gy, touched);
    else if (layer === 'zone') stampZoneAtGraph(gx, gy, touched);
    else if (layer === 'paint') stampTileAtGraph(gx, gy, touched);
  };

  const rampPlan = () => {
    const b = brushRef.current;
    const rs = rampStroke.current;
    if (!rs) return null;
    const dx = rs.current.x - rs.start.x;
    const dy = rs.current.y - rs.start.y;
    const distM = Math.hypot(dx, dy) / TILE_UNITS;
    if (distM >= 0.5) {
      return {
        gx: (rs.start.x + rs.current.x) / 2,
        gy: (rs.start.y + rs.current.y) / 2,
        minZ: b.rampMin,
        maxZ: b.rampMax,
        wideM: b.rampWide,
        longM: Math.max(1, distM),
        angleDeg: Math.atan2(dx, dy) * 180 / Math.PI,
      };
    }
    return { gx: rs.start.x, gy: rs.start.y, minZ: b.rampMin, maxZ: b.rampMax, wideM: b.rampWide, longM: b.rampLong, angleDeg: b.rampAngle };
  };

  const beginRamp = (sx: number, sy: number) => {
    const g = screenToGraph(sx, sy);
    if (!g) return;
    const c = resolveCell(g.gx, g.gy);
    const start = c ? { x: c.cgx, y: c.cgy } : { x: g.gx, y: g.gy };
    rampStroke.current = { start, current: start };
  };

  const updateRamp = (sx: number, sy: number) => {
    const g = screenToGraph(sx, sy);
    if (!g || !rampStroke.current) return;
    rampStroke.current.current = { x: g.gx, y: g.gy };
  };

  const finishRamp = () => {
    const plan = rampPlan();
    rampStroke.current = null;
    if (!plan) return false;
    const touched = new Set<ChunkKey>();
    strokeStats.current.samples++;
    stampRampAtGraph(plan.gx, plan.gy, plan, touched);
    if (!touched.size) return false;
    for (const k of touched) touchChunk(k);
    return true;
  };

  const finishSlope = () => {
    const stroke = slopeStroke.current;
    slopeStroke.current = null;
    const points = stroke?.points ?? [];
    if (!points.length) return false;
    let totalM = 0;
    for (let i = 1; i < points.length; i += 1) {
      totalM += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y) / TILE_UNITS;
    }
    const runM = Math.max(DOT_M, totalM);
    const touched = new Set<ChunkKey>();
    if (points.length === 1) {
      stampSlopeSegmentAtGraph(points[0]!, points[0]!, 0, runM, touched);
    } else {
      let distanceStartM = 0;
      for (let i = 1; i < points.length; i += 1) {
        const from = points[i - 1]!, to = points[i]!;
        stampSlopeSegmentAtGraph(from, to, distanceStartM, runM, touched);
        distanceStartM += Math.hypot(to.x - from.x, to.y - from.y) / TILE_UNITS;
      }
    }
    if (!touched.size) return false;
    for (const k of touched) touchChunk(k);
    return true;
  };

  // One brush sample. The world can slide a long way between samples — a fast drag, or
  // (the hard case) a held-WASD pan when zoomed out, where each screen pixel spans many
  // tiles so the graph point under a STILL cursor leaps cells per tick. Stamping only at
  // the endpoint there leaves a dashed line. So interpolate from the last stamp to here
  // and stamp along the segment. Step spacing scales with the brush radius (a wide disc
  // already covers the gaps, so it needs far fewer sub-stamps) and is capped, so a big
  // brush at extreme zoom can't explode into millions of paintTile calls — that blow-up
  // was the lag. Coalesce all the segment's GPU touches + the preview sync to ONE each.
  const onBrush = (sx: number, sy: number) => {
    strokeStats.current.samples++;
    const g = screenToGraph(sx, sy);
    if (!g) return;
    if (showPlaceBrush && place.active) {
      const c = resolveCell(g.gx, g.gy);
      if (!c) return;
      const gx = c ? c.cgx : g.gx;
      const gy = c ? c.cgy : g.gy;
      const stampKey = `${place.active.cat}:${place.active.kind}:${Math.round(gx / TILE_UNITS)}:${Math.round(gy / TILE_UNITS)}`;
      if (heightStamped.current.has(stampKey)) return;
      heightStamped.current.add(stampKey);
      strokeStats.current.stamps++;
      place.onPaintAt(place.active.cat, place.active.kind, gx, gy, place.active.rotation);
      return;
    }
    const touched = new Set<ChunkKey>();
    if (isSlopeTool) {
      const st = slopeStroke.current ?? { points: [] };
      const point = { x: g.gx, y: g.gy };
      const prev = st.points[st.points.length - 1];
      if (!prev || Math.hypot(point.x - prev.x, point.y - prev.y) >= GSAMPLE * 0.25) st.points.push(point);
      slopeStroke.current = st;
      lastStampG.current = point;
      return;
    }
    const prev = lastStampG.current;
    if (!prev) {
      stampOneAtGraph(g.gx, g.gy, touched); // first sample of the stroke: just the point
    } else {
      const dx = g.gx - prev.x, dy = g.gy - prev.y;
      const dist = Math.hypot(dx, dy);
      const radiusTiles = layer === 'height' ? brushRef.current.size : paintRef.current.size;
      const stepG = TILE_UNITS * Math.max(0.5, radiusTiles * 0.5); // ≤ ½ disc, so stamps overlap
      const steps = Math.min(256, Math.max(1, Math.ceil(dist / stepG)));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        stampOneAtGraph(prev.x + dx * t, prev.y + dy * t, touched);
      }
    }
    lastStampG.current = { x: g.gx, y: g.gy };
    if (touched.size) {
      for (const k of touched) touchChunk(k);
      if (layer !== 'height') scheduleRegionSync(); // height defers its 3D mirror to stroke end
    }
  };
  const strokeNow = () => (globalThis as any).performance?.now?.() ?? 0;
  const beginStroke = () => {
    strokeStats.current = { samples: 0, stamps: 0, cells: new Set(), touches: 0, coalesced: 0, t0: strokeNow(), snap: countersSnapshot() };
    heightStamped.current.clear(); // fresh per-stroke dedup of height deposits
    lastStampG.current = null;     // fresh interpolation anchor (no line from the last stroke)
    rampStroke.current = null;
    slopeStroke.current = null;
    plog('stroke', `BEGIN ${layer}/${tool}`);
  };
  const endStroke = () => {
    const s = strokeStats.current;
    const dt = strokeNow() - s.t0;
    const tiles = s.cells.size; // UNIQUE cells painted (the honest count)
    // How many UPDATES (component re-renders) fired across the stroke, by component.
    const cart = counterDelta(s.snap, 'render:cart');
    const paint = counterDelta(s.snap, 'render:PaintCanvas');
    const preview = counterDelta(s.snap, 'render:IsoPreview');
    const chunk = counterDelta(s.snap, 'render:chunkSurface');
    const updates = cart + paint + preview + chunk;
    plog('stroke', `END ${layer}/${tool} tiles=${tiles} (stamps=${s.stamps} samples=${s.samples}) gpuTouches=${s.touches} | UPDATES=${updates} (cart ${cart}, PaintCanvas ${paint}, IsoPreview ${preview}, chunkSurface ${chunk}) over ${dt.toFixed(0)}ms`);
    // The regression guard (this is the old bug): paint mutates refs, so PaintCanvas
    // must NOT update mid-stroke, and cart updates should track region-syncs
    // (~dt/REGION_SYNC_MS), NEVER the cell count. If updates scale with cells, a
    // per-cell setState has crept back in.
    const expectedSyncs = Math.ceil(dt / REGION_SYNC_MS) + 2;
    if (paint > 0 || cart > expectedSyncs * 2 || (tiles > 4 && updates >= tiles * 0.5)) {
      plog('stroke', `⚠ UPDATE STORM — ${updates} updates for ${tiles} cells (expected ~${expectedSyncs} syncs). Per-tile state update regression!`);
    } else {
      plog('stroke', `✓ clean — ${updates} updates decoupled from ${tiles} cells (state updates track region-syncs, not paint)`);
    }
    // Flush the 3D preview mirror ONCE on release. Height strokes defer ALL their
    // mesh re-ship to here (stamping above only marks heightDirty + updates the live
    // 2D canvas), so this lands the final terrain in 3D in a single hitch instead of
    // re-shipping every dirty chunk's ~65k-float mesh on every mid-stroke sync. Tile
    // strokes already mirrored mid-stroke; this just lands the last few cells crisply.
    plog('stroke', 'flush preview on release');
    syncRegionsNow();
  };

  // The pointer tool SELECTS tiles (paint/zone layers): click = focus one cell,
  // ctrl-click = add/remove from the group. The selection (cart-owned) drives the
  // top-left override panel. A select overlay (sibling, like the brush) captures the
  // click without one Canvas.Node per tile; only the chosen cells get a highlight.
  const showSelect = !!props.select && tool === 'pointer' && (layer === 'paint' || layer === 'zone');
  const selectAtScreen = (sx: number, sy: number) => {
    const sel = props.select; if (!sel) return;
    const g = screenToGraph(sx, sy); if (!g) return;
    const c = resolveCell(g.gx, g.gy);
    if (!c) { if (!ctrlHeldRef.current) sel.clear(); return; } // plain click on empty = deselect
    const idx = c.chunk.tiles.idx[c.cellZ * c.chunk.tiles.cols + c.cellX];
    const cell: SelCell = { gx: c.gCellX, gz: c.gCellZ, kind: idx >= 0 ? (TILE_KINDS[idx] ?? null) : null };
    if (ctrlHeldRef.current) sel.toggle(cell); else sel.set(cell);
  };

  // Road layer clicks: the brush lays centerline points; the pointer selects the
  // nearest stroke (within half its stamped width + a tile of slack).
  const roadClickAt = (sx: number, sy: number) => {
    const g = screenToGraph(sx, sy);
    if (!g) return;
    const c = resolveCell(g.gx, g.gy);
    if (tool === 'pointer') {
      if (!c) { setSelRoadId(null); return; }
      const p: RoadPoint = { gx: c.gCellX, gz: c.gCellZ };
      let best: { r: RoadStroke; d: number } | null = null;
      for (const r of roadsRef.current) {
        for (let i = 0; i + 1 < r.points.length; i++) {
          const d = distPointSegmentCells(p, r.points[i]!, r.points[i + 1]!);
          if (!best || d < best.d) best = { r, d };
        }
      }
      setSelRoadId(best && best.d <= roadWidthTiles(best.r.profile) / 2 + 1 ? best.r.id : null);
      return;
    }
    if (!c) return;
    // Snap order: a nearby stroke ENDPOINT (2.5 cells) continues the network;
    // failing that, a nearby CENTERLINE (1.5 cells) lands the point ON the
    // wire — committing a stroke that ends there splits the road at that spot.
    const raw: RoadPoint = { gx: c.gCellX, gz: c.gCellZ };
    const pt = snapToRoadEnd(roadsRef.current, raw, 2.5)
      ?? snapToCenterline(roadsRef.current, raw, 1.5)?.point
      ?? raw;
    setRoadDraft((d) => {
      const last = d[d.length - 1];
      if (last && last.gx === pt.gx && last.gz === pt.gz) return d;
      return [...d, pt];
    });
  };

  // One-at-a-time coordinate readout: the hovered cell's address (col letter + row),
  // global across chunks. null = cursor off any focused chunk.
  // Hover pushes through a sink ref into <HoverReadout> — NO parent state, so a
  // cursor move never re-renders PaintCanvas (or, via that, the chunks).
  const hoverSink = useRef<((h: HoverState) => void) | null>(null);
  const updateHover = (sx: number, sy: number) => {
    const r = rectRef.current;
    const g = r ? screenToGraph(sx, sy) : null;
    const c = g ? resolveCell(g.gx, g.gy) : null;
    if (!c) { hoverSink.current?.(null); return; }
    hoverSink.current?.({ x: sx - r!.x + 12, y: sy - r!.y + 12, addr: `${columnLabel(c.gCellX).toLowerCase()}${c.gCellZ}` });
  };

  // The brush ring (see BrushCursor). Drives BOTH the address pill and the ring from a
  // SINGLE resolve so a brush-layer move costs the same as before. The canvas exposes
  // no graph→screen, but screenToGraph is affine, so the zoom (px per graph unit) falls
  // out of a second probe BRUSH_PROBE px to the side; with it, the cell-centre graph
  // point maps back to a screen pixel and the footprint width to a pixel diameter.
  const brushSink = useRef<((b: BrushVis) => void) | null>(null);
  const BRUSH_PROBE = 100;
  const updateCursor = (sx: number, sy: number) => {
    const r = rectRef.current;
    const g = r ? screenToGraph(sx, sy) : null;
    const c = g ? resolveCell(g.gx, g.gy) : null;
    hoverSink.current?.(null);
    if (!g || !r) { brushSink.current?.(null); return; }
    const g2 = screenToGraph(sx + BRUSH_PROBE, sy);
    const zoom = g2 && g2.gx !== g.gx ? BRUSH_PROBE / (g2.gx - g.gx) : 1; // px per graph unit
    const dia = (brushSize * 2 + 1) * TILE_UNITS * zoom; // footprint width across, in px
    const erasing = !isRampTool && (layer === 'height' ? brushMode === 'erase' : activeBrushMode === 'erase');
    const color = erasing ? '#f87171'
      : layer === 'height' ? '#fbbf24'
      : layer === 'place' ? (place.active?.color ?? '#a78bfa')
      : layer === 'zone' ? (zones[activeZone]?.color ?? '#22d3ee')
      : tileKindDefinition(tile).render.color;
    if (showPlaceBrush && place.active) {
      // Ghost at the SNAPPED rect (placementCellRect — the same cells the drop
      // stores and the compile lowers), not the raw cell centre: an even-width
      // footprint can't centre on a cell centre, so without the snap the ghost
      // sat half a tile off the cells the object would actually take.
      const snap = c ? placementCellRect({ gx: c.cgx, gy: c.cgy, footW: place.active.footW, footD: place.active.footD }) : null;
      const cxp = snap ? sx + (snap.snapGx - g.gx) * zoom : sx;
      const cyp = snap ? sy + (snap.snapGy - g.gy) * zoom : sy;
      brushSink.current?.({
        x: cxp - r.x,
        y: cyp - r.y,
        d: TILE_UNITS * zoom,
        on: !!c,
        color,
        rect: { w: Math.max(12, place.active.footW * TILE_UNITS * zoom), h: Math.max(12, place.active.footD * TILE_UNITS * zoom), angle: place.active.rotation },
      });
      return;
    }
    if (isRampTool) {
      const plan = rampPlan();
      const base = c ? { x: c.cgx, y: c.cgy } : { x: g.gx, y: g.gy };
      const cx = plan ? plan.gx : base.x;
      const cy = plan ? plan.gy : base.y;
      const w = Math.max(6, (plan?.wideM ?? rampWide) * TILE_UNITS * zoom);
      const h = Math.max(6, (plan?.longM ?? rampLong) * TILE_UNITS * zoom);
      const angle = -(plan?.angleDeg ?? rampAngle);
      brushSink.current?.({ x: sx + (cx - g.gx) * zoom - r.x, y: sy + (cy - g.gy) * zoom - r.y, d: dia, on: !!c || !!plan, color, ramp: { w, h, angle } });
      return;
    }
    // Snap the ring to the cell centre it'll paint; off any focused chunk, ride the cursor.
    const cxp = c ? sx + (c.cgx - g.gx) * zoom : sx;
    const cyp = c ? sy + (c.cgy - g.gy) * zoom : sy;
    brushSink.current?.({ x: cxp - r.x, y: cyp - r.y, d: dia, on: !!c, color, shape: brushShape });
  };

  // ── Cursor pump: live ring + pan-paint ───────────────────────────────────────
  // A Pressable's onMouseMove only fires while the button is CAPTURED (held) — see
  // engine.zig dispatchPointerHandler(.move), gated on dragging_left. So a free-moving
  // cursor delivers no move events and the ring would only appear once you start
  // painting (blind to where the brush is until you commit). The host already tracks
  // the live cursor (mouse_state.g_mouse_x/y, exposed as getMouseX/getMouseY), so poll
  // it here: drive the ring from the real cursor whether or not the button is down.
  // The same loop also covers pan-paint — while a stroke is live and the view drifts
  // under a still cursor (held WASD), keep stamping at the live cursor so a held
  // direction paints a clean straight line. Idle (cursor parked, no drift) → no work.
  const onBrushRef = useRef<(sx: number, sy: number) => void>(() => {});
  const updateCursorRef = useRef<(sx: number, sy: number) => void>(() => {});
  const driftActiveRef = useRef(false);
  const brushShownRef = useRef(false); // mirrors showBrush — no ring on place/pointer
  const lastPollRef = useRef<{ x: number; y: number }>({ x: -1, y: -1 });
  useEffect(() => {
    const host: any = globalThis as any;
    const id = setInterval(() => {
      const r = rectRef.current;
      if (!r || typeof host.getMouseX !== 'function') return;
      const mx = Number(host.getMouseX()), my = Number(host.getMouseY());
      if (!Number.isFinite(mx) || !Number.isFinite(my)) return;
      const panPainting = drawing.current && driftActiveRef.current;
      // Skip a parked cursor (the common idle case) so the ring doesn't churn at 40Hz;
      // pan-paint forces through because the world is moving under a still cursor.
      const last = lastPollRef.current;
      if (mx === last.x && my === last.y && !panPainting) return;
      lastPollRef.current = { x: mx, y: my };
      if (panPainting) onBrushRef.current(mx, my); // straight-line paint as the view drifts
      // Show the ring over this pane's working area (not the left rail / right gutter);
      // hide it elsewhere so it never strays onto the chrome or a neighbouring quad.
      const inWork = mx >= r.x + RAIL_W && mx <= r.x + r.width - GUTTER_W && my >= r.y && my <= r.y + r.height;
      if (brushShownRef.current && inWork) updateCursorRef.current(mx, my);
      else brushSink.current?.(null);
    }, 24); // ~40Hz; < 1 tile/tick at the 700px/s pan speed, so no gaps in the line
    return () => clearInterval(id);
  }, []);

  // Feed the cursor pump the latest closures + drift each render (it reads through
  // refs so the interval set up once on mount never goes stale on tool/layer change).
  onBrushRef.current = isRampTool ? updateRamp : onBrush;
  updateCursorRef.current = updateCursor;
  const canvasDrift = effectiveCanvasPanDrift(drift, heldKeys.current.size, !!props.wasdFocused);
  driftActiveRef.current = canvasDrift.active;
  brushShownRef.current = showBrush;

  // Churn probe: PaintCanvas is memoized + paints through refs, so it should NOT
  // re-render while you paint. A line here mid-stroke means a prop/state churned
  // it (e.g. focus/zones/drift/select) — naming which is the lead.
  useChurn('PaintCanvas', {
    focus, chunkRev, zones, drift, tool, tile, layer, place,
    selCells: props.select?.cells, brushSize, centerZ, activeBrushMode, brushShape, heightMode, smoothStrength, wasdFocused: props.wasdFocused,
    roads, roadDraft, roadProfile, selRoadId,
  });

  return (
    <Box
      style={{ width: '100%', height: '100%', position: 'relative' }}
      onLayout={(lr: any) => { rectRef.current = { x: Number(lr?.x ?? 0), y: Number(lr?.y ?? 0), width: Number(lr?.width ?? 1), height: Number(lr?.height ?? 1) }; }}
    >
      <Canvas
        style={{ width: '100%', height: '100%', backgroundColor: '#0a1018' }}
        gridStep={TILE_UNITS}
        gridStroke={1}
        gridColor="#13203200"
        gridMajorColor={grid ? '#1b2a40' : '#00000000'}
        gridMajorEvery={2}
        // the restored (or painted-content-fallback) camera — mount-stable
        // values, so the host applies them once and user pan/zoom takes over
        viewX={props.initialView?.x}
        viewY={props.initialView?.y}
        viewZoom={props.initialView?.zoom}
        driftX={canvasDrift.x}
        driftY={canvasDrift.y}
        driftActive={canvasDrift.active}
      >
        {/* Each focused chunk = one Effect quad at its lattice slot (own buffer). */}
        {focusedChunks.map((c) => (
          <ChunkSurface
            key={chunkKey(c.cx, c.cz)}
            chunk={c}
            layer={layer}
            zones={zones}
            register={registerTouch}
            unregister={unregisterTouch}
          />
        ))}

        {/* Placement ghosts (req_0527): on every layer EXCEPT place (where the
            real interactive nodes live), placements + build pieces render as dim
            outlines so painting/roads/zoning/height never happen blind to where
            the buildings are. Non-interactive — the active layer's overlay owns
            all clicks; these are landmarks only. Drawn first so every authoring
            affordance (selection, road dots, drafts) paints above them. */}
        {layer !== 'place' ? place.items.map((p) => (
          <Canvas.Node key={`ghost_${p.id}`} gx={p.gx} gy={p.gy} gw={p.footW * TILE_UNITS} gh={p.footD * TILE_UNITS}>
            <Box style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: `${p.color}77`, backgroundColor: `${p.color}14`, transform: { rotate: p.rotation } }}>
              <Text fontSize={7} color={`${p.color}bb`} style={{ fontWeight: 700 }}>{p.label}</Text>
            </Box>
          </Canvas.Node>
        )) : null}
        {layer !== 'place' ? (place.buildItems ?? []).map((p) => (
          <Canvas.Node key={`ghostb_${p.id}`} gx={p.gx} gy={p.gy} gw={p.footW * TILE_UNITS} gh={p.footD * TILE_UNITS}>
            <Box style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: `${p.color}66`, backgroundColor: `${p.color}0f` }}>
              <Text fontSize={6} color={`${p.color}aa`} style={{ fontWeight: 700, fontFamily: 'monospace' }}>{p.label}</Text>
            </Box>
          </Canvas.Node>
        )) : null}

        {/* Selection highlight — one thin outline Canvas.Node per SELECTED cell
            (bounded by the selection, never per-tile). Non-interactive: the select
            overlay (sibling, on top) owns the clicks. */}
        {(props.select?.cells ?? []).map((cell) => {
          const cx = Math.floor(cell.gx / CHUNK_TILES), cz = Math.floor(cell.gz / CHUNK_TILES);
          if (!focus.has(chunkKey(cx, cz))) return null;
          // Canvas.Node positions by CENTRE (chunks sit at gx=cx*PATCH), so place the
          // highlight at the cell's centre: chunk left edge + (cellX + 0.5) tiles.
          const wx = cx * PATCH - PATCH / 2 + (cell.gx - cx * CHUNK_TILES + 0.5) * TILE_UNITS;
          const wz = cz * PATCH - PATCH / 2 + (cell.gz - cz * CHUNK_TILES + 0.5) * TILE_UNITS;
          return (
            <Canvas.Node key={`sel_${cell.gx}_${cell.gz}`} gx={wx} gy={wz} gw={TILE_UNITS} gh={TILE_UNITS}>
              <Box style={{ width: '100%', height: '100%', borderWidth: 2, borderColor: '#f8fafc', backgroundColor: '#f8fafc26' }} />
            </Canvas.Node>
          );
        })}

        {/* Road overlay (ROADSTROKE-0610): the stamped tiles already paint the
            road itself — these nodes are the AUTHORING affordances: a dotted
            centerline per stroke (white when selected), one-way flow chevrons,
            and the live draft in green. Dots, not lines: no rotation, so any
            segment angle renders clean. Non-interactive; the road overlay
            Pressable (sibling, below) owns the clicks. */}
        {layer === 'road' ? roads.flatMap((r) => {
          const sel = r.id === selRoadId;
          const color = sel ? '#f8fafc' : '#fbbf24cc';
          const nodes = showRoadWires ? roadDots(r.points, 2).map((d, i) => (
            <Canvas.Node key={`rd_${r.id}_${i}`} gx={cellGraph(d.x)} gy={cellGraph(d.z)} gw={TILE_UNITS * (sel ? 0.5 : 0.35)} gh={TILE_UNITS * (sel ? 0.5 : 0.35)}>
              <Box style={{ width: '100%', height: '100%', borderRadius: 99, backgroundColor: color }} />
            </Canvas.Node>
          )) : [];
          // Lane wires: one dotted line per LANE (green = with draw direction,
          // red = opposing) so lanes line up / merge across strokes by eye.
          if (showRoadWires) {
            for (const [i, d] of laneWireDots(r, 3).entries()) {
              nodes.push(
                <Canvas.Node key={`rl_${r.id}_${i}`} gx={cellGraph(d.x)} gy={cellGraph(d.z)} gw={TILE_UNITS * 0.22} gh={TILE_UNITS * 0.22}>
                  <Box style={{ width: '100%', height: '100%', borderRadius: 99, backgroundColor: d.flow === 'forward' ? '#86efac88' : '#f8717188' }} />
                </Canvas.Node>,
              );
            }
          }
          if (isOneWay(r.profile)) {
            for (const [i, ch] of roadChevrons(r).entries()) {
              nodes.push(
                <Canvas.Node key={`rc_${r.id}_${i}`} gx={cellGraph(ch.gx)} gy={cellGraph(ch.gz)} gw={TILE_UNITS * 2.4} gh={TILE_UNITS * 2.4}>
                  <Box style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', borderRadius: 99, backgroundColor: '#0b132088' }}>
                    <Text fontSize={15} color="#f59e0b" style={{ fontWeight: 900 }}>{ch.glyph}</Text>
                  </Box>
                </Canvas.Node>,
              );
            }
          }
          return nodes;
        }) : null}
        {/* Endpoint connect-squares: where a click snaps (2.5-cell radius) to
            continue the network. Cyan so they read apart from the amber wires. */}
        {layer === 'road' && showRoadWires ? strokeEndpoints(roads).map((e, i) => (
          <Canvas.Node key={`rend_${i}`} gx={cellGraph(e.gx)} gy={cellGraph(e.gz)} gw={TILE_UNITS * 1.4} gh={TILE_UNITS * 1.4}>
            <Box style={{ width: '100%', height: '100%', borderRadius: 3, borderWidth: 2, borderColor: '#22d3ee', backgroundColor: '#0e2a33cc' }} />
          </Canvas.Node>
        )) : null}
        {layer === 'road' && roadDraft.length >= 2 ? roadDots(roadDraft, 1.5).map((d, i) => (
          <Canvas.Node key={`rdraft_${i}`} gx={cellGraph(d.x)} gy={cellGraph(d.z)} gw={TILE_UNITS * 0.3} gh={TILE_UNITS * 0.3}>
            <Box style={{ width: '100%', height: '100%', borderRadius: 99, backgroundColor: '#86efacdd' }} />
          </Canvas.Node>
        )) : null}
        {layer === 'road' ? roadDraft.map((p, i) => (
          <Canvas.Node key={`rpt_${i}`} gx={cellGraph(p.gx)} gy={cellGraph(p.gz)} gw={TILE_UNITS * 1.1} gh={TILE_UNITS * 1.1}>
            <Box style={{ width: '100%', height: '100%', borderRadius: 99, borderWidth: 2, borderColor: '#86efac', backgroundColor: '#12331fcc' }} />
          </Canvas.Node>
        )) : null}

        {/* "+" ghost on every open side — clicking attaches a chunk flush there.
            Clickable directly when no brush overlay is up (pointer / place); while
            brushing, the overlay forwards the click via tryAddSlotAt. */}
        {addSlots.map((s) => (
          <Canvas.Node key={`add_${s.cx}_${s.cz}`} gx={s.cx * PATCH} gy={s.cz * PATCH} gw={PATCH} gh={PATCH}>
            <Pressable onPress={() => { claimWasd?.(); addChunk(s.cx, s.cz); }} style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#2b3f5e', borderRadius: 12, backgroundColor: '#0b132044' }}>
              <Box style={{ width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#3b5170', backgroundColor: '#11203add' }}>
                <Text fontSize={44} color="#86efac" style={{ fontWeight: 800 }}>+</Text>
              </Box>
              <Text fontSize={16} color="#64748b" style={{ fontFamily: 'monospace', marginTop: 8 }}>{chunkLabel(s.cx, s.cz)}</Text>
            </Pressable>
          </Canvas.Node>
        ))}

        {/* Place layer: each placement is a draggable Canvas.Node over the ground.
            Drawn at the STORED position raw — the engine drags the node natively
            (it writes canvas_gx straight into the pool), so a snapped display prop
            would fight the live drag and jitter. The DATA is snapped instead: at
            creation, on drag-settle (index.tsx movePlacement) and on map load, so
            at rest the stored position IS the snapped cell rect the compile uses. */}
        {layer === 'place' ? place.items.map((p) => {
          const isSel = p.id === place.selId;
          return (
            <Canvas.Node
              key={p.id}
              gx={p.gx}
              gy={p.gy}
              gw={p.footW * TILE_UNITS}
              gh={p.footD * TILE_UNITS}
              onPress={() => { claimWasd?.(); place.onSelectBuild?.(null); place.onSelect(p.id); }}
              onMove={p.locked || showPlaceBrush ? undefined : (evt: any) => { claimWasd?.(); place.onSelectBuild?.(null); place.onMove(p.id, Number(evt?.gx ?? p.gx), Number(evt?.gy ?? p.gy)); if (p.id !== place.selId) place.onSelect(p.id); }}
            >
              <Box style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: `${p.color}cc`, borderWidth: isSel ? 2 : 1, borderColor: isSel ? '#f8fafc' : '#0b1320', transform: { rotate: p.rotation } }}>
                <Box style={{ position: 'absolute', top: 2, width: '40%', height: 3, borderRadius: 2, backgroundColor: isSel ? '#f8fafc' : '#0b1320' }} />
                <Text fontSize={8} color="#0b1320" style={{ fontWeight: 800 }}>{p.label}</Text>
              </Box>
            </Canvas.Node>
          );
        }) : null}

        {layer === 'place' ? (place.buildItems ?? []).map((p) => {
          const isSel = p.id === place.buildSelId;
          return (
            <Canvas.Node
              key={`build_${p.id}`}
              gx={p.gx}
              gy={p.gy}
              gw={p.footW * TILE_UNITS}
              gh={p.footD * TILE_UNITS}
              onPress={() => { claimWasd?.(); place.onSelect(null); place.onSelectBuild?.(p.id); }}
            >
              <Box style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: isSel ? `${p.color}24` : `${p.color}14`, borderWidth: isSel ? 3 : 2, borderColor: isSel ? '#f8fafc' : p.color }}>
                <Box style={{ position: 'absolute', left: 3, right: 3, top: 3, bottom: 3, borderWidth: 1, borderColor: `${p.color}aa` }} />
                <Pressable onPress={() => { claimWasd?.(); place.onDeleteBuild?.(p.id); }} style={{ position: 'absolute', right: 2, top: 2, width: 18, height: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 3, borderWidth: 1, borderColor: '#f87171', backgroundColor: '#3f1218dd' }}>
                  <Text fontSize={12} color="#fecaca" style={{ fontWeight: 900 }}>×</Text>
                </Pressable>
                <Text fontSize={8} color="#e0f2fe" style={{ fontWeight: 800, fontFamily: 'monospace' }}>{p.label}</Text>
              </Box>
            </Canvas.Node>
          );
        }) : null}
      </Canvas>

      {/* Brush layer — screen-space sibling (cutout pattern). Down + move on the
          same node → pointer capture carries the stroke. A down on an empty open
          slot attaches a chunk instead of painting. */}
      {showBrush ? (
        <Pressable
          onMouseDown={(p: any) => { claimWasd?.(); const sx = Number(p?.x ?? 0); const sy = Number(p?.y ?? 0); if (tryAddSlotAt(sx, sy)) return; drawing.current = true; beginStroke(); notifyEditBegin(); if (isRampTool) beginRamp(sx, sy); else onBrush(sx, sy); updateCursor(sx, sy); }}
          onMouseMove={(p: any) => { const sx = Number(p?.x ?? 0); const sy = Number(p?.y ?? 0); if (drawing.current) { if (isRampTool) updateRamp(sx, sy); else onBrush(sx, sy); } updateCursor(sx, sy); }}
          onMouseUp={() => { const was = drawing.current; drawing.current = false; let changed = false; if (was && isRampTool) changed = finishRamp(); else if (was && isSlopeTool) changed = finishSlope(); if (was) { endStroke(); if (changed || (!isRampTool && !isSlopeTool)) notifyEdit(strokeNote()); } }}
          onMouseLeave={() => { const was = drawing.current; drawing.current = false; let changed = false; if (was && isRampTool) changed = finishRamp(); else if (was && isSlopeTool) changed = finishSlope(); hoverSink.current?.(null); brushSink.current?.(null); if (was) { endStroke(); if (changed || (!isRampTool && !isSlopeTool)) notifyEdit(strokeNote()); } }}
          style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000001' }}
        />
      ) : null}

      {/* Select layer — pointer tool, paint/zone. Click focuses a cell (ctrl-click
          adds to the group); forwards "+" ghost clicks like the brush overlay. Pan
          here is via WASD (this overlay owns the clicks). */}
      {showSelect ? (
        <Pressable
          onMouseDown={(p: any) => { claimWasd?.(); const sx = Number(p?.x ?? 0); const sy = Number(p?.y ?? 0); if (tryAddSlotAt(sx, sy)) return; selectAtScreen(sx, sy); }}
          onMouseMove={(p: any) => { updateHover(Number(p?.x ?? 0), Number(p?.y ?? 0)); }}
          onMouseLeave={() => { hoverSink.current?.(null); }}
          style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000001' }}
        />
      ) : null}

      {/* Road layer — click overlay (cutout pattern, like select): brush lays
          centerline points, pointer selects a stroke; forwards "+" ghost clicks. */}
      {layer === 'road' ? (
        <Pressable
          onMouseDown={(p: any) => { claimWasd?.(); const sx = Number(p?.x ?? 0); const sy = Number(p?.y ?? 0); if (tryAddSlotAt(sx, sy)) return; roadClickAt(sx, sy); }}
          onMouseMove={(p: any) => { updateHover(Number(p?.x ?? 0), Number(p?.y ?? 0)); }}
          onMouseLeave={() => { hoverSink.current?.(null); }}
          style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000001' }}
        />
      ) : null}

      {/* The one-at-a-time address readout — owns its own state (see HoverReadout). */}
      <HoverReadout sink={hoverSink} />

      {/* The visible brush footprint — only while a brush is the active tool. */}
      {showBrush ? <BrushCursor sink={brushSink} /> : null}

      {/* Left rail — conditional on the active layer (absolute overlay, on top). */}
      <Box style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: RAIL_W, backgroundColor: '#0b1320ee', borderRightWidth: 1, borderRightColor: '#1e293b', paddingLeft: 5, paddingRight: 5, paddingTop: 6, paddingBottom: 6 }}>
        {layer === 'paint' || layer === 'height' || layer === 'zone' ? (
          <BrushRail
            layer={layer}
            tool={tool}
            tile={tile}
            onTool={props.onTool}
            onTile={props.onTile}
            brush={{ size: brushSize, mode: layer === 'height' ? brushMode : activeBrushMode, shape: brushShape, profile: heightProfile, centerZ, heightMode, rampMin, rampMax, rampWide, rampLong, rampAngle, smoothStrength }}
            onBrushChange={setBrushPatch}
            onClearHeights={clearHeights}
            zones={zones}
            activeZone={activeZone}
            onActiveZone={setActiveZone}
            onAddZone={addZone}
            onUpdateZone={updateZone}
            onDeleteZone={deleteZone}
          />
        ) : null}
        {layer === 'place' ? <PlaceRail tool={tool} onTool={props.onTool} sel={selPlacement} buildSel={selBuildPlacement} place={place} /> : null}
        {layer === 'road' ? (
          <RoadRail
            tool={tool}
            onTool={props.onTool}
            profile={selRoad ? selRoad.profile : roadProfile}
            onProfile={editActiveProfile}
            editingLabel={selRoad ? `Road ${roads.indexOf(selRoad) + 1}` : null}
            draftCount={roadDraft.length}
            onFinish={commitRoadDraft}
            onCancel={cancelRoadDraft}
            onUndoPoint={undoRoadPoint}
            roads={roads}
            selId={selRoadId}
            onSelect={setSelRoadId}
            onDelete={deleteRoad}
            wires={showRoadWires}
            onWires={setShowRoadWires}
          />
        ) : null}
      </Box>

      {/* Right edge: chunk focus gutter (thin dock, keeps the centre clear). */}
      <ChunkGutter chunks={allChunks} focus={focus} onToggle={toggleFocus} onAll={focusAll} onNone={focusNone} />

      {/* Bottom: layer switch, inset left of the gutter so they never overlap. */}
      <Box style={{ position: 'absolute', right: GUTTER_W + 8, bottom: 8, flexDirection: 'row', gap: 4, backgroundColor: '#0b1320ee', borderWidth: 1, borderColor: '#1e293b', borderRadius: 6, padding: 4 }}>
        <LayerBtn label="PAINT" color="#86efac" active={layer === 'paint'} onPress={() => props.onLayer('paint')} />
        <LayerBtn label="ROAD" color="#f59e0b" active={layer === 'road'} onPress={() => props.onLayer('road')} />
        <LayerBtn label="HEIGHT" color="#fbbf24" active={layer === 'height'} onPress={() => props.onLayer('height')} />
        <LayerBtn label="PLACE" color="#a78bfa" active={layer === 'place'} onPress={() => props.onLayer('place')} />
        <LayerBtn label="ZONE" color="#22d3ee" active={layer === 'zone'} onPress={() => props.onLayer('zone')} />
      </Box>
    </Box>
  );
}
