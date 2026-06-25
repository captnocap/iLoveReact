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
import { bindingsForScope } from './editors/controls';
import { startupMark } from './startupTimer';
import { useEditorControls, useHeldModifiers } from './editors/useEditorControls';
import { KeyLegend } from './editors/KeyLegend';
import { columnLabel } from './address';
import { CHUNK_FLOOR_HF_RES, downsampleChunkFloorHeights, type ChunkFloor } from './chunkFloor';
import type { TileKind } from './design';
import { TILE_KINDS, tileKindDefinition } from './world/tileKinds';
import { TILE_UNITS, DOT_M, DOTS_PER_TILE, HEIGHT_LIMIT, stampBrush, stampRamp, stampSlopeSegment, brushProfile, clearField, type BrushProfile } from './heightData';
import { gradeHeightField, strokeGradeProfile } from './roadGrade';
import { footprintDistance, forEachFootprintCell, type BrushMode, type BrushShape } from './brush';
import type { BrushRailSettings } from './BrushRail';
import { PainterRail } from './PainterRail';
import { TargetDock, channelVisible, type PainterChannels } from './TargetDock';
import { paintTile, tileKindIndex, encodeTileMap } from './tileData';
import { paintFlora, floraLayerForKindIndex, FLORA_KINDS, FLORA_KIND_DEFINITIONS } from './floraData';
import { paintZoneCell, dropZoneIndex, ZONE_COLORS, type ZoneDef } from './zoneData';
import { applyMergeGesture, clampProfile, deriveJunctions, laneFlowArrows, laneGuides, parseCellKey, planRoads, profileLabel, isOneWay, roadRibbonSegments, roadWidthTiles, snapToCenterline, snapToRoadEnd, splitStroke, strokeEndpoints, strokeWireFlip, type RoadPoint, type RoadProfile, type RoadStroke } from './roadData';
import { controlFor, planIntersectionProps, reconcileGenerated, resolveRoadNames, type GeneratedProp, type GenPoseOverride, type IntersectionControl } from './intersections';
import { IntersectionRail } from './IntersectionRail';
import { ChunkSurface } from './ChunkSurface';
import type { PainterEmphasis } from './painterSurface';
import { resolvePainterBehavior } from './painterBehavior';
import { chunkKey, makeChunk, inBounds, openNeighbors, CHUNK_TILES, type Chunk, type ChunkKey } from './chunks';
import { placementCellRect, resolvePlaceable, worldToPlacementGraph, type Placement, type PlaceCat } from './placements';
import { SCATTER_BRUSHES, scatterRollAt, type ScatterBrushId } from './game/kinds/scatter';
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
export type Layer = 'paint' | 'flora' | 'water' | 'height' | 'place' | 'zone' | 'road';
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
  active: { cat: PlaceCat; kind: string; label: string; color: string; footW: number; footD: number; rotation: number; scatter?: ScatterBrushId } | null;
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
  // INTERSECTIONS-0619: replace the derived intersection placements (gen-tagged)
  // with a freshly-generated set, preserving hand placements.
  onSyncGenerated?: (gen: Placement[]) => void;
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
// The lock key lives in the editor control contract — this export is a
// derived view for the shell/tests, never a second source.
export const CANVAS_PAN_FOCUS_LOCK_KEY = bindingsForScope('canvas').find((b) => b.action === 'view.pan-lock')!.keys[0];
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

export function isCanvasPanFocusLockKey(key: unknown): boolean {
  return String(key ?? '').toLowerCase() === CANVAS_PAN_FOCUS_LOCK_KEY;
}

export function canvasPanOwnsWasd(wasdFocused: boolean, focusLocked: boolean): boolean {
  return wasdFocused || focusLocked;
}

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

const NO_CHANNELS: PainterChannels = {}; // stable identity for the all-visible default

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

// A generated intersection prop (global-cell-space center + yaw) → a real
// Placement (INTERSECTIONS-0619): footprint/colour/label resolve from the kind
// like any prop, position snaps to the cell rect the compile lowers to, and the
// `gen` tag + per-instance `text` ride through render/compile/save unchanged.
function genToPlacement(gp: GeneratedProp): Placement {
  const base = resolvePlaceable('prop', gp.kind);
  const g = worldToPlacementGraph(gp.gx, gp.gz);
  const snap = placementCellRect({ gx: g.gx, gy: g.gy, footW: base.footW, footD: base.footD });
  return {
    id: `genpl:${gp.id}`, cat: 'prop', kind: gp.kind, label: base.label,
    gx: snap.snapGx, gy: snap.snapGy, rotation: gp.rotationDeg, locked: false,
    footW: base.footW, footD: base.footD, color: base.color,
    gen: gp.id, ...(gp.text ? { text: gp.text } : {}),
  };
}

// Road authoring wires as POLYLINE paths, not per-dot Canvas.Nodes (OVERFLOW-0610):
// a long road's wire dots numbered in the hundreds, and with flow arrows ALSO on
// the road overlay blew past the host's 512-children-per-container cap
// (layout_refactor MAX_CHILDREN), which SILENTLY drops the overflow — so both
// overlays vanished. One Canvas.Path per stroke/lane is ~3 nodes total and scales
// to any road length. Coords are baked into the SVG `d` in graph space.
function roadCenterPathD(points: RoadPoint[]): string {
  if (points.length < 2) return '';
  let d = `M ${cellGraph(points[0]!.gx)} ${cellGraph(points[0]!.gz)}`;
  for (let i = 1; i < points.length; i += 1) d += ` L ${cellGraph(points[i]!.gx)} ${cellGraph(points[i]!.gz)}`;
  return d;
}
// One lane's wire: each segment offset by THAT segment's axis-quantized right
// vector (the same math the stamp + laneFlowArrows use), emitted as an independent
// M/L subpath so corners don't smear between differing right vectors.
function laneWirePathD(points: RoadPoint[], off: number): string {
  let d = '';
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const dx = b.gx - a.gx;
    const dz = b.gz - a.gz;
    if (!Math.hypot(dx, dz)) continue;
    const dir = Math.abs(dx) >= Math.abs(dz) ? { dx: Math.sign(dx), dz: 0 } : { dx: 0, dz: Math.sign(dz) };
    const rx = -dir.dz;
    const rz = dir.dx;
    d += `M ${cellGraph(a.gx + rx * off)} ${cellGraph(a.gz + rz * off)} L ${cellGraph(b.gx + rx * off)} ${cellGraph(b.gz + rz * off)} `;
  }
  return d;
}

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
  // Channel visibility (PAINTER-0610): which INACTIVE channels stay visible as
  // dim landmarks (shader emphasis + ghost/wire overlays). Owned by the cart so
  // it persists per map; absent = everything visible. The active target always
  // renders full-strength regardless.
  channels?: PainterChannels;
  onToggleChannel?: (l: Layer) => void;
  brush: BrushSettings;
  onBrushChange: (patch: Partial<BrushSettings>) => void;
  place: PlaceProps;
  showGrid?: boolean;
  onShowGrid?: (v: boolean) => void;
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
  const channels = props.channels ?? NO_CHANNELS;
  const grid = props.showGrid !== false;
  const selPlacement = place.items.find((p) => p.id === place.selId) ?? null;
  const selBuildPlacement = place.buildItems?.find((p) => p.id === place.buildSelId) ?? null;

  const brushMode: BrushMode = props.brush.mode === 'erase' ? 'erase' : 'paint';
  // Erase is a TOOL on every target (PAINTER-0610): the eraser tool erases the
  // active target (tiles, zone cells, terrain lowers, objects delete, roads
  // delete). The legacy brush.mode==='erase' (the rail's old eraser chip,
  // persisted in saved maps) still counts.
  const activeBrushMode: BrushMode = tool === 'eraser' ? 'erase' : brushMode;
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
  const [panFocusLocked, setPanFocusLocked] = useState(false);
  const driftRef = useRef<CanvasPanDrift>({ x: 0, y: 0 });
  const heldKeys = useRef<Set<string>>(new Set());
  const recomputeDriftRef = useRef<() => void>(() => {});
  const wasdFocusedRef = useRef(false);
  const panFocusLockedRef = useRef(false);
  const panFocusLockKeyDownRef = useRef(false);
  const canvasOwnsWasd = canvasPanOwnsWasd(!!props.wasdFocused, panFocusLocked);
  wasdFocusedRef.current = canvasOwnsWasd;
  panFocusLockedRef.current = panFocusLocked;
  const setPanDrift = useCallback((next: CanvasPanDrift) => {
    driftRef.current = next;
    setDrift(next);
  }, []);
  const clearPanDrift = useCallback(() => {
    if (!heldKeys.current.size && driftRef.current.x === 0 && driftRef.current.y === 0) return;
    heldKeys.current.clear();
    setPanDrift({ x: 0, y: 0 });
  }, [setPanDrift]);
  const togglePanFocusLock = useCallback(() => {
    const next = !panFocusLockedRef.current;
    panFocusLockedRef.current = next;
    setPanFocusLocked(next);
    if (next) props.onWasdFocus?.();
    else clearPanDrift();
  }, [clearPanDrift, props.onWasdFocus]);
  // Ctrl-held state — mouse events carry no modifier flags, so read the shared
  // contract tracker at click time. Drives ctrl-click select.
  const heldModifiers = useHeldModifiers();
  const placeBrushKeyRef = useRef<{ enabled: boolean; rotate: (delta: number) => void }>({ enabled: false, rotate: () => {} });
  // Lost focus (another quad claimed WASD) → drop held keys so the pan stops at once.
  useEffect(() => {
    if (!canvasOwnsWasd) clearPanDrift();
  }, [canvasOwnsWasd, clearPanDrift]);
  const recomputeDrift = useCallback(() => {
    setPanDrift(canvasPanDriftForHeldKeys(heldKeys.current));
  }, [setPanDrift]);
  recomputeDriftRef.current = recomputeDrift;
  // The keys ride the EDITOR CONTROL CONTRACT (editors/controls.ts,
  // EDITORCTL-0610): the 'canvas' scope table IS the bindings; this surface
  // only supplies the verbs. The contract owns chord matching + the typing
  // gate; the pan focus lock is this surface's documented gate override
  // (locking exists precisely to pan while a text field is focused).
  useEditorControls('canvas', {
    active: true, // the brush + lock work canvas-wide; pan gates on wasdFocused below
    bypassTypingGate: () => panFocusLockedRef.current,
    handlers: {
      'view.pan-lock': ({ phase }) => {
        if (phase === 'up') { panFocusLockKeyDownRef.current = false; return; }
        if (!panFocusLockKeyDownRef.current) {
          panFocusLockKeyDownRef.current = true;
          togglePanFocusLock();
        }
      },
      'brush.rotate-cw': () => { if (placeBrushKeyRef.current.enabled) placeBrushKeyRef.current.rotate(ROT_STEP); },
      'brush.rotate-ccw': () => { if (placeBrushKeyRef.current.enabled) placeBrushKeyRef.current.rotate(-ROT_STEP); },
      'view.pan': ({ phase, key }) => {
        if (phase === 'up') {
          if (heldKeys.current.delete(key)) recomputeDriftRef.current();
          return;
        }
        if (!wasdFocusedRef.current) return; // only the focused quad pans
        if (heldKeys.current.has(key)) return; // ignore key-repeat
        heldKeys.current.add(key);
        recomputeDriftRef.current();
      },
    },
  });
  // Alt-tab / window blur clears the drift so nothing strands mid-pan.
  useEffect(() => {
    const clear = () => { clearPanDrift(); };
    const offBlur = busOn('system:blur', clear);
    return () => { offBlur(); clear(); };
  }, [clearPanDrift]);
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
  const waterDirty = useRef<Set<ChunkKey>>(new Set());
  // True after a water stroke that found NO sub-0 terrain to fill — drives a hint
  // ("carve a basin first") so painting water on flat ground isn't a silent no-op.
  const waterDryStrokeRef = useRef(false);
  const tileCache = useRef<Map<ChunkKey, number[]>>(new Map());
  const heightCache = useRef<Map<ChunkKey, number[]>>(new Map());
  const waterCache = useRef<Map<ChunkKey, number[] | null>>(new Map()); // downsampled water grid (null = dry, no body)
  const heightVer = useRef<Map<ChunkKey, number>>(new Map()); // bumps per re-downsample → host slot overwrite
  // Analytic ribbon segments per chunk (ROADCURVE-0610): recomputed only when
  // a road changed (per-entry rev vs roadsRev), and kept IDENTITY-STABLE when a
  // chunk's clipped content comes out unchanged — so a road edit re-bakes only
  // the chunks the road actually crosses. ONE getter serves both consumers:
  // buildFloors (the 3D drape capture) and the ChunkSurface quads (the 2D
  // canvas) — both run the same shader, so roads curve identically in both.
  const roadSegCache = useRef<Map<ChunkKey, { rev: number; segs: number[] }>>(new Map());
  const roadsRev = useRef(1);
  const ribbonSegsFor = (cx: number, cz: number): number[] => {
    const k = chunkKey(cx, cz);
    const hit = roadSegCache.current.get(k);
    if (hit && hit.rev === roadsRev.current) return hit.segs;
    const segs = roadRibbonSegments(roadsRef.current, cx, cz, CHUNK_TILES);
    const same = hit && hit.segs.length === segs.length && hit.segs.every((v, i) => v === segs[i]);
    const keep = same ? hit!.segs : segs;
    roadSegCache.current.set(k, { rev: roadsRev.current, segs: keep });
    return keep;
  };
  const ribbonSegsForRef = useRef(ribbonSegsFor);
  ribbonSegsForRef.current = ribbonSegsFor;
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
      // Painted water: re-downsample only on a water edit. A dry
      // chunk caches null so floorsToWaterBodies skips it; a stable ref otherwise.
      if (waterDirty.current.has(k) || !waterCache.current.has(k)) {
        let wet = false;
        for (let i = 0; i < c.water.z.length; i++) if (c.water.z[i] > 0) { wet = true; break; }
        waterCache.current.set(k, wet ? downsampleChunkFloorHeights(c.water.z, c.water.cols, c.water.rows) : null);
        waterDirty.current.delete(k);
      }
      const segs = ribbonSegsForRef.current(c.cx, c.cz);
      const water = waterCache.current.get(k) ?? null;
      out.push({ cx: c.cx, cz: c.cz, tileData: tileCache.current.get(k)!, heights: heightCache.current.get(k)!, hcols: CHUNK_FLOOR_HF_RES, hrows: CHUNK_FLOOR_HF_RES, hver: heightVer.current.get(k) ?? 0, ...(water ? { water } : {}), ...(segs.length ? { roads: segs } : {}) });
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
  // Per-channel emphasis for the combined chunk shader (PAINTER-0610): the active
  // target reads full strength, visible inactive channels stay as dim landmarks,
  // eye-off channels go dark — except roads, world content, which render full
  // whenever shown. Identity-stable (useMemo): ChunkSurface is memo'd and its
  // encode re-runs on emphasis change.
  const emphasis = useMemo<PainterEmphasis>(() => ({
    road: layer === 'road' || channelVisible(channels, 'road') ? 1 : 0,
    height: layer === 'height' ? 1 : channelVisible(channels, 'height') ? 0.3 : 0,
    zone: layer === 'zone' ? 1 : channelVisible(channels, 'zone') ? 0.25 : 0,
    flora: layer === 'flora' ? 1 : channelVisible(channels, 'flora') ? 0.25 : 0,
  }), [layer, channels]);
  // [mapgone-probe MAPGONE2-0605] surface gate — stays until the user confirms
  useEffect(() => {
    console.warn(`[mapgone] PaintCanvas mount: seed=${props.initialWorld ? 'initialWorld' : 'blank'} chunks=${chunks.size} focus=${focus.size} focusedChunks=${focusedChunks.length} layer=${layer}`);
    // Startup timing: both are phase MARKS now — the canvas mounting is not the map
    // being loaded (chunk bakes/grass/3D still run after), so the real READY is the
    // main-thread settle armed in EditorShell, not this mount.
    if (props.initialWorld) startupMark(`PaintCanvas mounted real world (chunks=${chunks.size})`);
    else startupMark('PaintCanvas first mount (blank)');
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
  const brushRef = useRef({ centerZ, size: brushSize, mode: activeBrushMode, shape: brushShape, profile: heightProfile, heightMode, rampMin, rampMax, rampWide, rampLong, rampAngle, smoothStrength });
  brushRef.current = { centerZ, size: brushSize, mode: activeBrushMode, shape: brushShape, profile: heightProfile, heightMode, rampMin, rampMax, rampWide, rampLong, rampAngle, smoothStrength };
  // Height is ADDITIVE (heightData.stampCone stacks), but onMouseMove fires at input
  // rate (~100/s) — re-stamping a stationary brush every event saturates cells to
  // HEIGHT_LIMIT in a few frames, flattening everything to one max plateau and making
  // the z intensity look inert. The design's "overlap builds relief" comes from the
  // brush MOVING, so deposit the cone at most once per center-cell per stroke; genuine
  // drag motion still stacks across cells, separate strokes still stack on top.
  const heightStamped = useRef<Set<string>>(new Set());
  const paintRef = useRef({ tile, tool, size: brushSize, mode: activeBrushMode, shape: brushShape });
  paintRef.current = { tile, tool, size: brushSize, mode: activeBrushMode, shape: brushShape };
  // Active FLORA kind index (into FLORA_KINDS) — the flora target's brush. PaintCanvas
  // owns it like activeZone; the rail picks it. A ref mirrors it for the stamp.
  const [activeFlora, setActiveFlora] = useState(0);
  const activeFloraRef = useRef(activeFlora);
  activeFloraRef.current = activeFlora;

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

  // Paint WATER as its own channel: it does not dig. Height controls depth; the
  // brush marks wet samples only where the terrain bed is below zero and stores
  // depth = -bed, so the rendered water surface resolves to world height 0.
  // Erase drains the water channel without changing terrain.
  const stampWaterAtGraph = (gx: number, gy: number, touched: Set<ChunkKey>) => {
    const b = brushRef.current;
    const gsx = Math.round(gx / GSAMPLE), gsy = Math.round(gy / GSAMPLE);
    const stampKey = `water:${gsx}:${gsy}`;
    if (heightStamped.current.has(stampKey)) return;
    heightStamped.current.add(stampKey);
    const radiusM = Math.max(0.5, b.size);
    const rd = Math.max(1, Math.ceil(radiusM / DOT_M));
    const erase = b.mode === 'erase';
    let anyBasin = false; // did the brush touch any sub-0 terrain it could fill?
    for (const ch of focusedChunks) {
      const cols = ch.water.cols, rows = ch.water.rows;
      const cix = Math.round((gx - ch.cx * PATCH + PATCH / 2) / PATCH * (cols - 1));
      const ciy = Math.round((gy - ch.cz * PATCH + PATCH / 2) / PATCH * (rows - 1));
      if (cix + rd < 0 || cix - rd > cols - 1 || ciy + rd < 0 || ciy - rd > rows - 1) continue;
      let wrote = false;
      for (let dy = -rd; dy <= rd; dy += 1) {
        const jy = ciy + dy;
        if (jy < 0 || jy >= rows) continue;
        for (let dx = -rd; dx <= rd; dx += 1) {
          const jx = cix + dx;
          if (jx < 0 || jx >= cols) continue;
          const dm = footprintDistance(b.shape, dx, dy) * DOT_M;
          if (dm > radiusM) continue;
          const idx = jy * cols + jx;
          const bed = ch.height.z[idx] ?? 0;
          if (bed < 0) anyBasin = true;
          const next = erase ? 0 : Math.max(0, -bed);
          if (ch.water.z[idx] !== next) {
            ch.water.z[idx] = next;
            wrote = true;
          }
        }
      }
      if (!wrote) continue;
      const k = chunkKey(ch.cx, ch.cz);
      touched.add(k);
      waterDirty.current.add(k);
    }
    // No basin under the brush ⇒ nothing to fill (water rides negative terrain).
    // Flag it so the stroke note nudges the user to carve first, not silently no-op.
    if (!erase) waterDryStrokeRef.current = !anyBasin;
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
    // Road cells are owned by the stroke recipe and IMMUTABLE to paint/erase
    // (USER RULING req_0795): the grid is a pure base+roads function, so brushing
    // a road cell can't persist (the v2 load re-derives roads over base). Skip
    // them — to change a road, edit the stroke. Keeps live == persisted.
    const roadCells = roadUnderRef.current;
    const cgx0 = c.chunk.cx * CHUNK_TILES;
    const cgz0 = c.chunk.cz * CHUNK_TILES;
    forEachFootprintCell(p.shape, p.size, c.cellX, c.cellZ, (x, z) => {
      if (roadCells && roadCells.has(`${cgx0 + x},${cgz0 + z}`)) return; // cellKey format
      const s = strokeStats.current; s.stamps++;
      if (x >= 0 && z >= 0 && x < CHUNK_TILES && z < CHUNK_TILES) s.cells.add(`${c.k}:${x}:${z}`);
      paintTile(c.chunk.tiles, x, z, idx);
    });
    touched.add(c.k);
    tileDirty.current.add(c.k); // mirror the floor texture to the preview (synced by onBrush)
  };

  // FLORA target (FLORADECOUPLE-0619): paint what GROWS on a cell into chunk.flora,
  // a SEPARATE channel from the ground tiles — so a population layers over any
  // surface (beach grass = sand tile + grass flora). The 3D preview re-bakes the
  // grass/palm/bush populations from this on the next region sync (tileDirty mirrors
  // the floor, whose chunkToFloor now carries floraData).
  const stampFloraAtGraph = (gx: number, gy: number, touched: Set<ChunkKey>) => {
    const c = resolveCell(gx, gy);
    if (!c) return;
    const p = paintRef.current;
    const active = activeFloraRef.current;
    const layer = floraLayerForKindIndex(active);
    if (!layer) return;
    const idx = p.tool === 'eraser' || p.mode === 'erase' ? -1 : active;
    forEachFootprintCell(p.shape, p.size, c.cellX, c.cellZ, (x, z) => {
      const s = strokeStats.current; s.stamps++;
      if (x >= 0 && z >= 0 && x < CHUNK_TILES && z < CHUNK_TILES) s.cells.add(`${c.k}:${x}:${z}`);
      paintFlora(c.chunk.flora, x, z, idx, layer);
    });
    touched.add(c.k);
    tileDirty.current.add(c.k); // flora rides the floor mirror → preview re-bakes populations
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
  // Per-lane flow arrows (FLOWARROWS-0610, user ask): glyphs pointing each
  // lane's ACTUAL travel direction — the disambiguator colours can't be.
  const [showFlowArrows, setShowFlowArrows] = useState(true);
  // INTERSECTIONS-0619 (req_1480): the authored control type per derived junction
  // (keyed by stable junctionKey), and the per-id pose overrides that honor a
  // manually-dragged generated prop. Both ride the map snapshot like roads.
  const [intersectionControls, setIntersectionControls] = useState<Map<string, IntersectionControl>>(
    () => new Map(props.initialWorld?.intersectionControls ?? []),
  );
  const [intersectionOverrides, setIntersectionOverrides] = useState<Map<string, GenPoseOverride>>(
    () => new Map(props.initialWorld?.intersectionOverrides ?? []),
  );
  const [selJunctionKey, setSelJunctionKey] = useState<string | null>(null);
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
    // GRADE MODE (ROADGRADE-0610): the road's earthworks — every stroke
    // smooths the painted heightfield under its bed (zero crossfall, the
    // longitudinal profile irons potholes, a feather blends the shoulders).
    // Idempotent once graded; Ctrl+Z restores heights like any height edit.
    const readWorldHeight = (x: number, z: number): number | null => {
      const cx = Math.floor(x / CHUNK_TILES), cz = Math.floor(z / CHUNK_TILES);
      const ch = chunks.get(chunkKey(cx, cz));
      if (!ch) return null;
      const jx = Math.round((x - cx * CHUNK_TILES) * DOTS_PER_TILE);
      const jz = Math.round((z - cz * CHUNK_TILES) * DOTS_PER_TILE);
      if (jx < 0 || jz < 0 || jx >= ch.height.cols || jz >= ch.height.rows) return null;
      return ch.height.z[jz * ch.height.cols + jx]!;
    };
    const gradeProfiles = next
      .map((r) => strokeGradeProfile(r, readWorldHeight))
      .filter((p): p is NonNullable<typeof p> => p !== null);
    if (gradeProfiles.length) {
      for (const ch of chunks.values()) {
        const k = chunkKey(ch.cx, ch.cz);
        if (gradeHeightField({ profiles: gradeProfiles, field: ch.height, chunkCx: ch.cx, chunkCz: ch.cz, chunkTiles: CHUNK_TILES })) {
          touched.add(k);
          heightDirty.current.add(k);
        }
      }
    }
    setRoads(next);
    roadsRev.current += 1; // ribbon segs recompute (identity-stable per chunk)
    for (const k of touched) touchChunk(k);
    scheduleRegionSync();
    notifyEdit({ cat: 'road', text: noteText });
  };
  const commitRoadDraft = () => {
    let pts = [...roadDraftRef.current];
    if (pts.length < 2) return;
    const profile = clampProfile(roadProfileRef.current);
    let next = [...roadsRef.current];
    // THE MERGE GESTURE (req_0532): a one-way draft running [...ramp, C, E] —
    // C on a road's wire, E that road's endpoint — splits at C, WIDENS the
    // C→E half on the side the merging traffic flows, and trims the ramp to
    // end at C. "Click C, then click A" IS the merge.
    let noteText = `road ${profileLabel(profile)}`;
    const merged = applyMergeGesture(next, pts, profile, () => {
      roadSeq.current += 1;
      return `r_${roadSeq.current}`;
    });
    if (merged) {
      next = merged.strokes;
      pts = merged.points;
      const widened = next.find((r) => r.id === merged.widenedId);
      noteText = `merged ${Math.max(profile.lanesF, profile.lanesB)} lane(s) in → ${widened ? profileLabel(widened.profile) : 'road'}`;
    }
    // Mid-stroke connections (req_0529): any remaining draft END landing on a
    // road's centerline mid-span SPLITS that road there — the seam stays one
    // continuous road (parallel axes never box) and each half re-profiles
    // independently.
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
    if (pts.length < 2) return; // gesture consumed the whole draft (degenerate)
    roadSeq.current += 1;
    const stroke: RoadStroke = { id: `r_${roadSeq.current}`, points: pts, profile };
    setRoadDraft([]);
    setSelRoadId(stroke.id);
    restampRoads([...next, stroke], noteText);
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
  // Rename the selected road (INTERSECTIONS-0619) — no geometry change, so no
  // restamp; just updates the stroke and lets the signage regenerate.
  const editActiveName = (name: string) => {
    if (!selRoad) return;
    setRoads((rs) => rs.map((r) => (r.id === selRoad.id ? { ...r, name } : r)));
    notifyEdit({ cat: 'road', text: `named road ${name.trim() || '(cleared)'}` });
  };

  // INTERSECTIONS-0619: derive junctions from the network, generate the control +
  // street-name props per the authored types (honoring manual drags), and push
  // them into the cart's placement store so render / iso preview / compile / save
  // all consume them like hand placements (one store, one truth).
  const junctions = useMemo(() => deriveJunctions(roads), [roads]);
  const resolvedRoadNames = useMemo(() => resolveRoadNames(roads, junctions), [roads, junctions]);
  const roadNameOf = (roadId: string, fallback?: string) => resolvedRoadNames.get(roadId) ?? fallback;
  const generatedPlacements = useMemo(() => {
    const fresh = reconcileGenerated(planIntersectionProps(junctions, intersectionControls, roads), intersectionOverrides);
    return fresh.map(genToPlacement);
  }, [junctions, intersectionControls, roads, intersectionOverrides]);
  const syncGenRef = useRef(props.place.onSyncGenerated);
  syncGenRef.current = props.place.onSyncGenerated;
  // Re-assert the road-derived gen props whenever EITHER the derived set changes OR
  // the placement store is reverted (req_1505). An autosave/hot-reload restore or a
  // map switch calls setPlacements(snapshot) — which brings back the SAVED gen set,
  // STALE vs the live roads (e.g. a since-renamed street) — and the generatedPlacements
  // memo won't re-fire on its own because roads are unchanged. Without re-syncing on
  // the store identity, the editor renders the live signs (from a fresh previewWorld
  // built after a later edit) while Compile ships the stale snapshot set — so the
  // current intersection's signs are simply absent in-game. syncGenerated's no-op
  // guard returns the same array when the store already matches, so an already-
  // consistent store neither churns nor loops.
  useEffect(() => { syncGenRef.current?.(generatedPlacements); }, [generatedPlacements, props.place.items]);

  const selJunction = selJunctionKey ? junctions.find((j) => j.key === selJunctionKey) ?? null : null;
  const setJunctionControl = (key: string, ctrl: IntersectionControl) => {
    setIntersectionControls((m) => { const n = new Map(m); n.set(key, ctrl); return n; });
    notifyEdit({ cat: 'road', text: `intersection → ${ctrl}` });
  };
  // A manual drag of a generated prop records a pose override (settle-debounced,
  // global-cell space) so the next re-derivation keeps the dragged pose.
  const genMoveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordGenMove = (genIdStr: string, graphGx: number, graphGy: number, rotationDeg: number) => {
    if (genMoveTimer.current) clearTimeout(genMoveTimer.current);
    genMoveTimer.current = setTimeout(() => {
      genMoveTimer.current = null;
      const gx = graphGx / TILE_UNITS + CHUNK_TILES / 2;
      const gz = graphGy / TILE_UNITS + CHUNK_TILES / 2;
      setIntersectionOverrides((m) => { const n = new Map(m); n.set(genIdStr, { gx, gz, rotationDeg }); return n; });
    }, 160);
  };

  const commitRoadDraftRef = useRef(commitRoadDraft);
  commitRoadDraftRef.current = commitRoadDraft;
  const cancelRoadDraftRef = useRef(cancelRoadDraft);
  cancelRoadDraftRef.current = cancelRoadDraft;
  // Enter stamps the draft, Esc drops it — only while the road layer is up
  // (contract scope 'canvas'; activation is the layer, the table is the keys).
  useEditorControls('canvas', {
    active: layer === 'road',
    handlers: {
      'road.commit': () => commitRoadDraftRef.current(),
      'road.cancel': () => cancelRoadDraftRef.current(),
    },
  });

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
  if (props.apiRef) props.apiRef.current = { getWorld: () => ({ chunks, zones, focus, roads, roadUnder: roadUnderRef.current!, intersectionControls, intersectionOverrides }), getView };

  // ── One Painter (PAINTER-0610, req_0593) ─────────────────────────────────────
  // One active tool (Select/Paint/Erase), one active target (`layer`). The pure
  // resolver picks what the single input overlay does; the capability table picks
  // what a stroke sample edits — the per-layer if-chains live HERE now, nowhere else.
  const isRampTool = layer === 'height' && heightMode === 'ramp';
  const isSlopeTool = layer === 'height' && heightMode === 'slope';
  const isSmoothTool = layer === 'height' && heightMode === 'smooth';
  const isWaterTool = layer === 'water';
  const showPlaceBrush = layer === 'place' && tool === 'brush' && !!place.active;
  const behavior = resolvePainterBehavior({ tool, target: layer, placeArmed: !!place.active });
  const showBrush = behavior === 'stroke';
  placeBrushKeyRef.current = { enabled: showPlaceBrush, rotate: place.onRotateBrush };

  // Stamp the armed object at the cursor's cell (no interpolation — objects drop
  // at input samples, deduped per tile, exactly the pre-table behavior).
  const stampObjectAt = (gx0: number, gy0: number) => {
    if (!place.active) return;
    if (place.active.scatter) return scatterStampAt(gx0, gy0);
    const c = resolveCell(gx0, gy0);
    if (!c) return;
    const gx = c.cgx, gy = c.cgy;
    const stampKey = `${place.active.cat}:${place.active.kind}:${Math.round(gx / TILE_UNITS)}:${Math.round(gy / TILE_UNITS)}`;
    if (heightStamped.current.has(stampKey)) return;
    heightStamped.current.add(stampKey);
    strokeStats.current.stamps++;
    place.onPaintAt(place.active.cat, place.active.kind, gx, gy, place.active.rotation);
  };
  // SCATTERBRUSH-0611 (req_0642): the armed scatter brush rolls weighted prop
  // placements over the brush footprint. The roll is deterministic per tile
  // (game/kinds/scatter.ts) and tiles already holding a prop are skipped, so
  // re-painting the same ground is a no-op — never a double-density pileup.
  const scatterStampAt = (gx0: number, gy0: number) => {
    const active = place.active;
    if (!active?.scatter) return;
    const brush = SCATTER_BRUSHES[active.scatter];
    const c = resolveCell(gx0, gy0);
    if (!c) return;
    const occupied = new Set<string>();
    for (const p of place.items) {
      if (p.cat === 'prop') occupied.add(`${Math.round(p.gx / TILE_UNITS)}:${Math.round(p.gy / TILE_UNITS)}`);
    }
    forEachFootprintCell(
      paintRef.current.shape,
      paintRef.current.size,
      Math.round(c.cgx / TILE_UNITS),
      Math.round(c.cgy / TILE_UNITS),
      (tx, tz) => {
        const stampKey = `scatter:${tx}:${tz}`;
        if (heightStamped.current.has(stampKey)) return;
        heightStamped.current.add(stampKey);
        if (occupied.has(`${tx}:${tz}`)) return;
        const roll = scatterRollAt(brush, tx, tz);
        if (!roll) return;
        strokeStats.current.stamps++;
        place.onPaintAt('prop', roll.kind, tx * TILE_UNITS, tz * TILE_UNITS, roll.rotation);
      },
    );
  };
  // Erase-everywhere: on the Object target the eraser deletes any UNLOCKED
  // placement whose footprint rect intersects the brush footprint (rect-to-point
  // distance, rotation ignored — the same axis rect the native node hit-tests).
  const erasePlacementsAt = (gx: number, gy: number) => {
    const radiusG = (paintRef.current.size + 0.5) * TILE_UNITS;
    for (const p of place.items) {
      if (p.locked) continue;
      const dx = Math.max(0, Math.abs(gx - p.gx) - (p.footW * TILE_UNITS) / 2);
      const dy = Math.max(0, Math.abs(gy - p.gy) - (p.footD * TILE_UNITS) / 2);
      if (Math.hypot(dx, dy) <= radiusG) {
        strokeStats.current.stamps++;
        place.onDelete(p.id);
      }
    }
  };

  // What the active target's stroke does + how the event log names it. `sample`
  // runs inside the drag interpolation (touched accumulates dirty chunks);
  // `rawSample` runs once per raw input sample (object stamp/erase — cart-side
  // state, no chunk buffers to touch). Road has neither: its edits are clicks.
  type PainterCapability = {
    sample?: (gx: number, gy: number, touched: Set<ChunkKey>) => void;
    rawSample?: (gx: number, gy: number) => void;
    note: () => EditNote;
  };
  const painterCapabilities: Record<Layer, PainterCapability> = {
    paint: {
      sample: stampTileAtGraph,
      note: () => ({ cat: 'tile', text: activeBrushMode === 'erase' ? 'erased tiles' : `painted ${tile}` }),
    },
    flora: {
      sample: stampFloraAtGraph,
      note: () => ({ cat: 'tile', text: activeBrushMode === 'erase' ? 'erased flora' : 'painted flora' }),
    },
    height: {
      sample: isSmoothTool ? stampSmoothAtGraph : isRampTool || isSlopeTool ? undefined : stampHeightAtGraph,
      note: () => ({ cat: 'height', text: isRampTool ? 'stamped ramp' : isSlopeTool ? 'painted slope' : isSmoothTool ? 'smoothed terrain' : activeBrushMode === 'erase' ? 'lowered terrain' : 'raised terrain' }),
    },
    water: {
      sample: stampWaterAtGraph,
      note: () => ({ cat: 'height', text: activeBrushMode === 'erase' ? 'cleared water' : (waterDryStrokeRef.current ? 'no basin here — lower terrain below 0 first (Terrain tool)' : 'painted water') }),
    },
    zone: {
      sample: stampZoneAtGraph,
      note: () => { const z = zones[activeZone]; return { cat: 'zone', text: activeBrushMode === 'erase' ? 'erased zone' : `painted ${z ? z.name : 'zone'}` }; },
    },
    place: {
      rawSample: tool === 'eraser' ? erasePlacementsAt : stampObjectAt,
      note: () => ({ cat: 'object', text: tool === 'eraser' ? 'erased objects' : `painted ${place.active?.label ?? 'object'}` }),
    },
    road: {
      note: () => ({ cat: 'road', text: 'road' }), // road notes come from restampRoads, not strokes
    },
  };
  const strokeNote = painterCapabilities[layer].note;
  // Where the last stamp landed, in GRAPH space, so onBrush can fill the gap to the
  // current point. null between strokes (reset in beginStroke) so a new stroke never
  // draws a line from the previous stroke's end.
  const lastStampG = useRef<{ x: number; y: number } | null>(null);
  const rampStroke = useRef<{ start: { x: number; y: number }; current: { x: number; y: number } } | null>(null);

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
    const stampSegment = stampSlopeSegmentAtGraph;
    if (points.length === 1) {
      stampSegment(points[0]!, points[0]!, 0, runM, touched);
    } else {
      let distanceStartM = 0;
      for (let i = 1; i < points.length; i += 1) {
        const from = points[i - 1]!, to = points[i]!;
        stampSegment(from, to, distanceStartM, runM, touched);
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
    const cap = painterCapabilities[layer];
    if (cap.rawSample) { cap.rawSample(g.gx, g.gy); return; } // object stamp/erase: per raw sample, no interpolation
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
      cap.sample?.(g.gx, g.gy, touched); // first sample of the stroke: just the point
    } else {
      const dx = g.gx - prev.x, dy = g.gy - prev.y;
      const dist = Math.hypot(dx, dy);
      const radiusTiles = layer === 'height' ? brushRef.current.size : paintRef.current.size;
      const stepG = TILE_UNITS * Math.max(0.5, radiusTiles * 0.5); // ≤ ½ disc, so stamps overlap
      const steps = Math.min(256, Math.max(1, Math.ceil(dist / stepG)));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        cap.sample?.(prev.x + dx * t, prev.y + dy * t, touched);
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

  // The road stroke nearest a cell, within half its stamped width + a tile of
  // slack — shared by Select (pick) and Erase (delete) on the road network.
  const roadStrokeAtCell = (p: RoadPoint): RoadStroke | null => {
    let best: { r: RoadStroke; d: number } | null = null;
    for (const r of roadsRef.current) {
      for (let i = 0; i + 1 < r.points.length; i++) {
        const d = distPointSegmentCells(p, r.points[i]!, r.points[i + 1]!);
        if (!best || d < best.d) best = { r, d };
      }
    }
    return best && best.d <= roadWidthTiles(best.r.profile) / 2 + 1 ? best.r : null;
  };

  // Universal Select (PAINTER-0610): one click, the most specific thing under the
  // cursor wins — placement/build piece first, road stroke second, tile cell third
  // (ctrl-click keeps the cell group-toggle). Runs from every target except Object,
  // where no overlay mounts and the native Canvas.Nodes own the pointer.
  const selectAtScreen = (sx: number, sy: number) => {
    const g = screenToGraph(sx, sy); if (!g) return;
    const inRect = (p: { gx: number; gy: number; footW: number; footD: number }) =>
      Math.abs(g.gx - p.gx) <= (p.footW * TILE_UNITS) / 2 && Math.abs(g.gy - p.gy) <= (p.footD * TILE_UNITS) / 2;
    const hitPlacement = [...place.items].reverse().find(inRect); // later = painted on top
    if (hitPlacement) { place.onSelectBuild?.(null); place.onSelect(hitPlacement.id); return; }
    const hitBuild = [...(place.buildItems ?? [])].reverse().find(inRect);
    if (hitBuild) { place.onSelect(null); place.onSelectBuild?.(hitBuild.id); return; }
    const c = resolveCell(g.gx, g.gy);
    const road = c ? roadStrokeAtCell({ gx: c.gCellX, gz: c.gCellZ }) : null;
    setSelRoadId(road ? road.id : null); // one selection focus: a non-road click clears a stale road pick
    if (road) return;
    const sel = props.select; if (!sel) return;
    if (!c) { if (!heldModifiers.current.ctrl) sel.clear(); return; } // plain click on empty = deselect
    const idx = c.chunk.tiles.idx[c.cellZ * c.chunk.tiles.cols + c.cellX];
    const cell: SelCell = { gx: c.gCellX, gz: c.gCellZ, kind: idx >= 0 ? (TILE_KINDS[idx] ?? null) : null };
    if (heldModifiers.current.ctrl) sel.toggle(cell); else sel.set(cell);
  };

  // Road target clicks: Paint lays centerline points; Erase deletes the stroke
  // under the cursor (erase-everywhere). Select goes through selectAtScreen.
  const roadClickAt = (sx: number, sy: number) => {
    const g = screenToGraph(sx, sy);
    if (!g) return;
    const c = resolveCell(g.gx, g.gy);
    if (!c) return;
    if (tool === 'eraser') {
      const road = roadStrokeAtCell({ gx: c.gCellX, gz: c.gCellZ });
      if (road) deleteRoad(road.id);
      return;
    }
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
    const erasing = !isRampTool && activeBrushMode === 'erase';
    const color = erasing ? '#f87171'
      : isWaterTool ? '#2f7fa8'
      : layer === 'height' ? '#fbbf24'
      : layer === 'place' ? (place.active?.color ?? '#a78bfa')
      : layer === 'zone' ? (zones[activeZone]?.color ?? '#22d3ee')
      : layer === 'flora' ? (FLORA_KIND_DEFINITIONS[FLORA_KINDS[activeFlora]]?.color ?? '#4ade80')
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
  const canvasDrift = effectiveCanvasPanDrift(drift, heldKeys.current.size, canvasOwnsWasd);
  driftActiveRef.current = canvasDrift.active;
  brushShownRef.current = showBrush;

  // Churn probe: PaintCanvas is memoized + paints through refs, so it should NOT
  // re-render while you paint. A line here mid-stroke means a prop/state churned
  // it (e.g. focus/zones/drift/select) — naming which is the lead.
  useChurn('PaintCanvas', {
    focus, chunkRev, zones, drift, tool, tile, layer, channels, place,
    selCells: props.select?.cells, brushSize, centerZ, activeBrushMode, brushShape, heightMode, smoothStrength, wasdFocused: props.wasdFocused, panFocusLocked,
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
        // The painter owns its own selection (tile cells / placements / roads).
        // Without this, a background click over ANY Canvas.Node — and every
        // chunk surface IS one — toggled the engine's hidden click-to-select,
        // and a selected node freezes drift: WASD pan dead until the next
        // click happened to toggle it back off (the "gridlocked half the
        // time" lockup, req_0636). F8 couldn't help — it only bypasses the
        // JS typing gate; the freeze lived engine-side.
        selectNodes={false}
      >
        {/* Each focused chunk = one Effect quad at its lattice slot (own buffer). */}
        {focusedChunks.map((c) => (
          <ChunkSurface
            key={chunkKey(c.cx, c.cz)}
            chunk={c}
            emphasis={emphasis}
            zones={zones}
            roads={ribbonSegsFor(c.cx, c.cz)}
            register={registerTouch}
            unregister={unregisterTouch}
          />
        ))}

        {/* Placement ghosts (req_0527): on every target EXCEPT object (where the
            real interactive nodes live), placements + build pieces render as dim
            outlines so painting/roads/zoning/height never happen blind to where
            the buildings are — unless the object channel's eye is off. Non-
            interactive — the painter overlay owns all clicks; these are landmarks
            only. Drawn first so every authoring affordance (selection, road dots,
            drafts) paints above them. */}
        {layer !== 'place' && channelVisible(channels, 'place') ? place.items.map((p) => (
          <Canvas.Node key={`ghost_${p.id}`} gx={p.gx} gy={p.gy} gw={p.footW * TILE_UNITS} gh={p.footD * TILE_UNITS}>
            <Box style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: `${p.color}77`, backgroundColor: `${p.color}14`, transform: { rotate: p.rotation } }}>
              <Text fontSize={7} color={`${p.color}bb`} style={{ fontWeight: 700 }}>{p.label}</Text>
            </Box>
          </Canvas.Node>
        )) : null}
        {layer !== 'place' && channelVisible(channels, 'place') ? (place.buildItems ?? []).map((p) => (
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
            road itself — these nodes are the AUTHORING affordances. With the
            painter channels (PAINTER-0610) the WIRES stay visible as dim
            landmarks from every target while the road channel's eye is on (or a
            road is selected); the per-node glyphs — flow arrows, one-way
            chevrons, endpoints, draft dots — mount only when Road is the ACTIVE
            target, so an idle channel can't crowd the 512-children cap
            (OVERFLOW-0610). Non-interactive; the painter overlay owns clicks. */}
        {showRoadWires && (layer === 'road' || selRoad || channelVisible(channels, 'road')) ? roads.flatMap((r) => {
          const sel = r.id === selRoadId;
          const dimWire = layer !== 'road' && !sel; // landmark, not the working channel
          const color = sel ? '#f8fafc' : dimWire ? '#fbbf2455' : '#fbbf24cc';
          const nodes: any[] = [];
          // Centerline + per-LANE wires as POLYLINES (one Canvas.Path each), so
          // lanes line up / merge across strokes by eye. Colours are CANONICAL
          // (WIRECOLOR-0610): green = east/south flow, red = west/north — NOT
          // draw-relative, so a road's two halves drawn outward from a junction
          // read one continuous colour instead of flipping at the seam. Paths,
          // not per-dot nodes (OVERFLOW-0610): a long road with arrows ALSO on
          // used to overflow the 512-children cap and drop the whole overlay.
          nodes.push(
            <Canvas.Path key={`rd_${r.id}`} d={roadCenterPathD(r.points)} stroke={color} strokeWidth={TILE_UNITS * (sel ? 0.42 : 0.3)} fill="none" />,
          );
          const flip = strokeWireFlip(r.points);
          for (const [li, g] of laneGuides(r.profile).entries()) {
            nodes.push(
              <Canvas.Path key={`rl_${r.id}_${li}`} d={laneWirePathD(r.points, g.off)} stroke={(g.flow === 'forward') !== flip ? (dimWire ? '#86efac33' : '#86efac88') : (dimWire ? '#f8717133' : '#f8717188')} strokeWidth={TILE_UNITS * 0.2} fill="none" />,
            );
          }
          return nodes;
        }) : null}
        {layer === 'road' ? roads.flatMap((r) => {
          const nodes: any[] = [];
          // Per-lane flow arrows (FLOWARROWS-0610): a glyph every few tiles on
          // each lane, pointing the lane's TRUE travel direction. Colour
          // matches the canonical wire legend so both views tell one story.
          if (showFlowArrows) {
            const flip = strokeWireFlip(r.points);
            for (const [i, ar] of laneFlowArrows(r, 5).entries()) {
              nodes.push(
                <Canvas.Node key={`ra_${r.id}_${i}`} gx={cellGraph(ar.x)} gy={cellGraph(ar.z)} gw={TILE_UNITS * 1.7} gh={TILE_UNITS * 1.7}>
                  <Box style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', borderRadius: 99, backgroundColor: '#0b132066' }}>
                    <Text fontSize={11} color={(ar.flow === 'forward') !== flip ? '#86efac' : '#f87171'} style={{ fontWeight: 900 }}>{ar.glyph}</Text>
                  </Box>
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
        {/* Junction badges (INTERSECTIONS-0619): one clickable marker per derived
            crossing; click selects it for the type card. Red = 4-way stop, green =
            signals, grey = uncontrolled. */}
        {layer === 'road' ? junctions.map((j) => {
          const ctrl = controlFor(j, intersectionControls);
          const sel = j.key === selJunctionKey;
          const tint = ctrl === 'signals' ? '#22c55e' : ctrl === 'allWayStop' ? '#ef4444' : '#94a3b8';
          const g = worldToPlacementGraph(j.centerGx, j.centerGz);
          return (
            <Canvas.Node key={`jx_${j.key}`} gx={g.gx} gy={g.gy} gw={TILE_UNITS * 2.6} gh={TILE_UNITS * 2.6}>
              <Pressable onPress={() => { claimWasd?.(); setSelJunctionKey(sel ? null : j.key); }} style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', borderRadius: 99, borderWidth: sel ? 3 : 2, borderColor: sel ? '#f8fafc' : tint, backgroundColor: `${tint}33` }}>
                <Text fontSize={13} color={sel ? '#f8fafc' : tint} style={{ fontWeight: 900 }}>{ctrl === 'signals' ? '◉' : ctrl === 'allWayStop' ? '⬣' : '∘'}</Text>
              </Pressable>
            </Canvas.Node>
          );
        }) : null}
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
              onMove={p.locked || showPlaceBrush ? undefined : (evt: any) => { claimWasd?.(); place.onSelectBuild?.(null); const mgx = Number(evt?.gx ?? p.gx), mgy = Number(evt?.gy ?? p.gy); place.onMove(p.id, mgx, mgy); if (p.gen) recordGenMove(p.gen, mgx, mgy, p.rotation); if (p.id !== place.selId) place.onSelect(p.id); }}
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

      {/* Painter input overlay (PAINTER-0610) — ONE screen-space sibling for every
          behavior (cutout pattern: down + move + up on the same node so pointer
          capture carries the stroke; rails/buttons render after it so they stay
          clickable). The resolver picks what events mean: 'stroke' runs the brush
          lifecycle, 'click' lays/erases road points, 'select' runs the universal
          most-specific pick. 'none' (Object+Select, or Object+Paint with nothing
          armed) mounts NO overlay — the placements' native Canvas.Nodes own the
          pointer there (engine-side drag). A down on an empty open slot attaches
          a chunk instead, on every behavior. */}
      {behavior !== 'none' ? (
        <Pressable
          onMouseDown={(p: any) => {
            claimWasd?.();
            const sx = Number(p?.x ?? 0); const sy = Number(p?.y ?? 0);
            if (tryAddSlotAt(sx, sy)) return;
            if (behavior === 'select') { selectAtScreen(sx, sy); return; }
            if (behavior === 'click') { roadClickAt(sx, sy); return; }
            drawing.current = true; beginStroke(); notifyEditBegin();
            if (isRampTool) beginRamp(sx, sy); else onBrush(sx, sy);
            updateCursor(sx, sy);
          }}
          onMouseMove={(p: any) => {
            const sx = Number(p?.x ?? 0); const sy = Number(p?.y ?? 0);
            if (behavior !== 'stroke') { updateHover(sx, sy); return; }
            if (drawing.current) { if (isRampTool) updateRamp(sx, sy); else onBrush(sx, sy); }
            updateCursor(sx, sy);
          }}
          onMouseUp={() => { const was = drawing.current; drawing.current = false; let changed = false; if (was && isRampTool) changed = finishRamp(); else if (was && isSlopeTool) changed = finishSlope(); if (was) { endStroke(); if (changed || (!isRampTool && !isSlopeTool)) notifyEdit(strokeNote()); } }}
          onMouseLeave={() => { const was = drawing.current; drawing.current = false; let changed = false; if (was && isRampTool) changed = finishRamp(); else if (was && isSlopeTool) changed = finishSlope(); hoverSink.current?.(null); brushSink.current?.(null); if (was) { endStroke(); if (changed || (!isRampTool && !isSlopeTool)) notifyEdit(strokeNote()); } }}
          style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000001' }}
        />
      ) : null}

      {/* The one-at-a-time address readout — owns its own state (see HoverReadout). */}
      <HoverReadout sink={hoverSink} />

      {/* The visible brush footprint — only while a brush is the active tool. */}
      {showBrush ? <BrushCursor sink={brushSink} /> : null}

      {/* Left rail — ONE PainterRail of composable cards (absolute overlay, on
          top): universal ToolCard + the active target's cards + the selection
          inspector. The rail never swaps wholesale on a target change. */}
      <Box style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: RAIL_W, backgroundColor: '#0b1320ee', borderRightWidth: 1, borderRightColor: '#1e293b', paddingLeft: 5, paddingRight: 5, paddingTop: 6, paddingBottom: 6 }}>
        <PainterRail
          tool={tool}
          onTool={props.onTool}
          target={layer}
          tile={tile}
          onTile={props.onTile}
          activeFlora={activeFlora}
          onActiveFlora={setActiveFlora}
          brush={{ size: brushSize, mode: activeBrushMode, shape: brushShape, profile: heightProfile, centerZ, heightMode, rampMin, rampMax, rampWide, rampLong, rampAngle, smoothStrength }}
          onBrushChange={setBrushPatch}
          onClearHeights={clearHeights}
          zones={zones}
          activeZone={activeZone}
          onActiveZone={setActiveZone}
          onAddZone={addZone}
          onUpdateZone={updateZone}
          onDeleteZone={deleteZone}
          place={place}
          selPlacement={selPlacement}
          selBuild={selBuildPlacement}
          grid={grid}
          onGrid={(v: boolean) => props.onShowGrid?.(v)}
          road={{
            profile: selRoad ? selRoad.profile : roadProfile,
            onProfile: editActiveProfile,
            editingLabel: selRoad ? (selRoad.name?.trim() || `Road ${roads.indexOf(selRoad) + 1}`) : null,
            draftCount: roadDraft.length,
            onFinish: commitRoadDraft,
            onCancel: cancelRoadDraft,
            onUndoPoint: undoRoadPoint,
            roads,
            selId: selRoadId,
            onSelect: setSelRoadId,
            onDelete: deleteRoad,
            onName: editActiveName,
            wires: showRoadWires,
            onWires: setShowRoadWires,
            arrows: showFlowArrows,
            onArrows: setShowFlowArrows,
          }}
        />
      </Box>

      {/* Intersection card (INTERSECTIONS-0619): floats beside the rail when a
          junction badge is selected on the road layer. */}
      {layer === 'road' && selJunction ? (
        <Box style={{ position: 'absolute', left: RAIL_W + 8, top: 8 }}>
          <IntersectionRail
            junction={selJunction}
            control={controlFor(selJunction, intersectionControls)}
            onControl={(c) => setJunctionControl(selJunction.key, c)}
            onClose={() => setSelJunctionKey(null)}
            nameOf={roadNameOf}
          />
        </Box>
      ) : null}

      {/* Right edge: chunk focus gutter (thin dock, keeps the centre clear). */}
      <ChunkGutter chunks={allChunks} focus={focus} onToggle={toggleFocus} onAll={focusAll} onNone={focusNone} />

      {/* Bottom: the channel dock (PAINTER-0610) — click a chip to make that
          target active, its eye to show/hide the channel as a dim landmark.
          Inset left of the gutter so they never overlap. */}
      <Box style={{ position: 'absolute', right: GUTTER_W + 8, bottom: 8, backgroundColor: '#0b1320ee', borderWidth: 1, borderColor: '#1e293b', borderRadius: 6, padding: 4 }}>
        <TargetDock layer={layer} onLayer={props.onLayer} channels={channels} onToggleChannel={props.onToggleChannel ?? (() => {})} />
      </Box>

      {/* The keymap strip — rendered from the control contract, so it can't lie. */}
      <Box style={{ position: 'absolute', left: RAIL_W + 8, bottom: 8 }}>
        <KeyLegend scope="canvas" dimmed={!canvasOwnsWasd} />
      </Box>
    </Box>
  );
}
