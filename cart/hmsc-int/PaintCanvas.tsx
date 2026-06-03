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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Canvas, Pressable, ScrollView, Text, TextInput } from '@reactjit/primitives';
import { Icon } from '@reactjit/icons/Icon';
import { callHost } from '@reactjit/ffi';
import { busOn } from '@reactjit/hooks/useIFTTT';
import { columnLabel } from './address';
import { type ChunkFloor } from './chunkFloor';
import type { TileKind, ZoneFlag } from '../hmsc/design';
import { TILE_KINDS, tileKindDefinition } from '../hmsc/world/tileKinds';
import { ZONE_FLAGS } from '../hmsc/world/zones';
import { TILE_UNITS, DOT_M, stampBrush, clearField, type BrushShape, type BrushProfile } from './heightData';
import { paintTile, tileKindIndex, encodeTileMap } from './tileData';
import { paintZoneCell, dropZoneIndex, ZONE_COLORS, type ZoneDef } from './zoneData';
import { ChunkSurface } from './ChunkSurface';
import { chunkKey, makeChunk, inBounds, openNeighbors, CHUNK_TILES, type Chunk, type ChunkKey } from './chunks';
import type { Placement } from './placements';
import type { EditorWorld } from './mapStore';
import type { SelCell } from './tileOverrides';
import type { EditNote } from './editLog';
import { plog, useChurn, countersSnapshot, counterDelta } from './perfLog';

export type HeightTool = 'brush' | 'erase';
type CanvasRect = { x: number; y: number; width: number; height: number } | null;
type HoverState = { x: number; y: number; addr: string } | null;
type HoverSink = { current: ((h: HoverState) => void) | null };
// The visible brush footprint: a circle at screen position (x,y), diameter d px,
// `on` = over a paintable cell (filled) vs off-grid (outline only).
type BrushVis = { x: number; y: number; d: number; color: string; on: boolean; shape?: BrushShape } | null;
type BrushSink = { current: ((b: BrushVis) => void) | null };

export type Tool = 'pointer' | 'brush' | 'eraser';
export type Layer = 'paint' | 'height' | 'place' | 'zone';
export type { BrushShape, BrushProfile };
export type BrushSettings = { size: number; centerZ: number; heightTool: HeightTool; heightProfile: BrushProfile; heightShape: BrushShape };

// The serialize seam: the cart pulls the live world (chunks + zone defs + focus)
// through this on autosave. Placements live in the cart, so they're added there.
export interface PaintCanvasApi {
  getWorld: () => Pick<EditorWorld, 'chunks' | 'zones' | 'focus'>;
}

// Two-letter flag tags for the cramped zone rail.
const FLAG_TAG: Record<ZoneFlag, string> = { private: 'PV', safe: 'SF', hostile: 'HO', restricted: 'RS', interior: 'IN' };

// The place-layer state + actions, owned by the cart (so placements persist /
// feed the world). Passed as a bundle to keep the prop list flat.
export interface PlaceProps {
  items: Placement[];
  selId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, gx: number, gy: number) => void;
  onUpdate: (id: string, patch: Partial<Placement>) => void;
  onClone: (id: string) => void;
  onDelete: (id: string) => void;
}

const CELL = 24;
const RAIL_W = 64; // double-wide rail: two 24px columns + gap + padding
const GUTTER_W = 58; // right-edge chunk-focus dock — thin so the centre stays clear

// One chunk spans CHUNK_TILES tiles (1 tile = 1m), so PATCH graph-units wide.
const PATCH = CHUNK_TILES * TILE_UNITS;

// Brush profile steppers.
const Z_STEP = 0.5, Z_MIN = -12, Z_MAX = 12;
// Shared brush size = RADIUS in tiles (0 = a single cell). 1 tile = 1m, so it also
// reads as the height cone's radius in metres. Footprint shown as width-across.
const SIZE_STEP = 1, SIZE_MIN = 0, SIZE_MAX = 40;

// Throttle for the live preview mirror — rebuilding regions + re-baking the
// preview's floor captures is heavy, so cap it to ~3 syncs/sec.
const REGION_SYNC_MS = 320;

// Preview height-mesh resolution (vertices per side). The brush field is sampled at
// DOTS_PER_TILE (0.5 m → 241² for a 120-tile chunk), far finer than the mesh needs;
// baking that 1:1 ships a ~580KB heights key + ~350k verts per sculpt and chokes.
// But the mesh MUST resolve at least per TILE, or distinct 1-tile strokes collapse
// into the same mesh cell (3 painted dots and a filled 2×2 rendered identically).
// So pin it to ONE VERTEX PER TILE: CHUNK_TILES+1 (121 over 120 m = 1 m spacing).
// That's the authoring grain — what you paint per tile shows per tile — at 1/4 the
// cost of the full 0.5 m field. The landform renders this field 1:1 (no further
// downsample; see hmsc/world/landforms/kinds.ts heightfield resolution).
const HF_RES = CHUNK_TILES + 1;

// Downsample a chunk's full height field (cols x rows) to an HF_RES x HF_RES grid.
// MAX-MAGNITUDE POOLING, not point-sampling: each coarse sample takes the most
// extreme source height (largest |z|) in its footprint, keeping the sign. The field
// is 0.5m-spaced and the mesh is 1m (sx≈2), so nearest-sampling dropped every other
// source sample — a thin painted ridge/pit could fall between the kept points and
// vanish from the mesh while the 2D field still showed it. Max-pooling guarantees a
// painted feature survives at its full height, snapped to the mesh grid. Window
// half-extent = ceil(step/2) so footprints tile the source with no gaps.
function downsampleHeights(z: Float32Array, cols: number, rows: number): number[] {
  const out = new Array<number>(HF_RES * HF_RES);
  const sx = (cols - 1) / (HF_RES - 1);
  const sy = (rows - 1) / (HF_RES - 1);
  const hx = Math.max(1, Math.ceil(sx / 2));
  const hy = Math.max(1, Math.ceil(sy / 2));
  for (let j = 0; j < HF_RES; j++) {
    const cy = Math.round(j * sy);
    for (let i = 0; i < HF_RES; i++) {
      const cx = Math.round(i * sx);
      let best = 0;
      for (let dy = -hy; dy <= hy; dy++) {
        const yy = cy + dy;
        if (yy < 0 || yy >= rows) continue;
        for (let dx = -hx; dx <= hx; dx++) {
          const xx = cx + dx;
          if (xx < 0 || xx >= cols) continue;
          const v = z[yy * cols + xx];
          if (Math.abs(v) > Math.abs(best)) best = v;
        }
      }
      out[j * HF_RES + i] = best;
    }
  }
  return out;
}

const TOOLS: { id: Tool; icon: string }[] = [
  { id: 'pointer', icon: 'MousePointer' },
  { id: 'brush', icon: 'Brush' },
  { id: 'eraser', icon: 'Eraser' },
];

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

// Stamp a round brush of `radius` cells (0 = single cell) around (cx,cz), calling
// paintCell per in-disc cell. Cells outside the chunk are dropped by paintCell, so
// a brush at a chunk edge clips to this chunk (cross-chunk paint is a later pass).
function stampDisc(radius: number, cx: number, cz: number, paintCell: (x: number, z: number) => void) {
  const r2 = radius * radius + radius; // ≈ (radius+0.5)², a round footprint
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dz * dz <= r2) paintCell(cx + dx, cz + dz);
    }
  }
}

// A chunk's short address label, e.g. (0,0)→"A0", (1,0)→"B0", (0,1)→"A1".
const chunkLabel = (cx: number, cz: number) => `${columnLabel(cx)}${cz}`;

// ── Atoms ────────────────────────────────────────────────────────────────────

function ToolBtn(props: { icon: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={{ width: CELL, height: CELL, borderRadius: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: props.active ? '#f8fafc' : '#334155', backgroundColor: props.active ? '#1e293b' : '#0f1a2e' }}>
      <Icon name={props.icon} size={14} color={props.active ? '#f8fafc' : '#94a3b8'} />
    </Pressable>
  );
}

function Swatch(props: { color: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={{ width: CELL, height: CELL, borderRadius: 3, borderWidth: props.active ? 2 : 1, borderColor: props.active ? '#f8fafc' : '#1e293b', backgroundColor: props.color }} />
  );
}

function LayerBtn(props: { label: string; color: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 9, paddingRight: 9, paddingTop: 5, paddingBottom: 5, borderRadius: 5, borderWidth: props.active ? 2 : 1, borderColor: props.active ? '#f8fafc' : '#27364a', backgroundColor: props.active ? '#1e293b' : '#0b1320' }}>
      <Box style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: props.color }} />
      <Text fontSize={10} color={props.active ? '#f8fafc' : '#94a3b8'} style={{ fontWeight: props.active ? 700 : 600, letterSpacing: 1 }}>{props.label}</Text>
    </Pressable>
  );
}

function MiniBtn(props: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={{ paddingLeft: 5, paddingRight: 5, paddingTop: 2, paddingBottom: 2, borderRadius: 3, borderWidth: 1, borderColor: '#27364a', backgroundColor: '#0f1a2e' }}>
      <Text fontSize={8} color="#94a3b8" style={{ fontWeight: 700 }}>{props.label}</Text>
    </Pressable>
  );
}

function StepBtn(props: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={{ width: 16, height: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 3, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f1a2e' }}>
      <Text fontSize={11} color="#cbd5e1">{props.label}</Text>
    </Pressable>
  );
}

function MiniStepper(props: { label: string; value: string; onDec: () => void; onInc: () => void }) {
  return (
    <Box style={{ gap: 2 }}>
      <Text fontSize={8} color="#64748b" style={{ fontFamily: 'monospace' }}>{props.label}</Text>
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        <StepBtn label="−" onPress={props.onDec} />
        <Box style={{ flexGrow: 1, alignItems: 'center', borderWidth: 1, borderColor: '#27364a', borderRadius: 3, paddingTop: 2, paddingBottom: 2, backgroundColor: '#0f1a2e' }}>
          <Text fontSize={9} color="#cbd5e1" style={{ fontFamily: 'monospace' }}>{props.value}</Text>
        </Box>
        <StepBtn label="+" onPress={props.onInc} />
      </Box>
    </Box>
  );
}

// Shared brush-size stepper — radius in tiles, shown as the footprint width across.
function SizeStepper(props: { size: number; onSize: (n: number) => void }) {
  return (
    <MiniStepper
      label="size"
      value={`${props.size * 2 + 1}t`}
      onDec={() => props.onSize(clamp(props.size - SIZE_STEP, SIZE_MIN, SIZE_MAX))}
      onInc={() => props.onSize(clamp(props.size + SIZE_STEP, SIZE_MIN, SIZE_MAX))}
    />
  );
}

// ── Rails (left, conditional on layer) ───────────────────────────────────────

function PaintRail(props: { tool: Tool; onTool: (t: Tool) => void; tile: TileKind; onTile: (k: TileKind) => void; size: number; onSize: (n: number) => void }) {
  return (
    <Box style={{ gap: 6 }}>
      <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {TOOLS.map((t) => <ToolBtn key={t.id} icon={t.icon} active={props.tool === t.id} onPress={() => props.onTool(t.id)} />)}
      </Box>
      <SizeStepper size={props.size} onSize={props.onSize} />
      <Box style={{ height: 1, backgroundColor: '#1e293b' }} />
      <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {TILE_KINDS.map((k) => <Swatch key={k} color={tileKindDefinition(k).render.color} active={props.tile === k} onPress={() => { props.onTile(k); props.onTool('brush'); }} />)}
      </Box>
    </Box>
  );
}

// Cross-section profiles (height falloff) and footprint shapes (covered area), each
// with a tiny ASCII glyph hint. Combine freely: flat+square = square plateau, etc.
const HEIGHT_PROFILES: { id: BrushProfile; label: string; hint: string }[] = [
  { id: 'cone', label: 'cone', hint: '▲' }, // slopes to nothing
  { id: 'flat', label: 'flat', hint: '▬' }, // plateau, vertical edge
  { id: 'dome', label: 'dome', hint: '◗' }, // rounded cap
];
const HEIGHT_FOOTPRINTS: { id: BrushShape; label: string; hint: string }[] = [
  { id: 'circle', label: 'circle', hint: '●' },
  { id: 'square', label: 'square', hint: '■' },
  { id: 'diamond', label: 'diamond', hint: '◆' },
];

// A 2-wide chip grid (wraps): 3 items render 2-on-top + 1-below, never 3-across tight.
function ChipGrid(props: {
  items: ReadonlyArray<{ id: string; label: string; hint: string }>;
  value: string; onPick: (id: string) => void; dim?: boolean;
}) {
  return (
    <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, opacity: props.dim ? 0.4 : 1 }}>
      {props.items.map((it) => {
        const active = props.value === it.id;
        return (
          <Pressable key={it.id} onPress={() => props.onPick(it.id)} style={{ width: '47%', alignItems: 'center', paddingTop: 3, paddingBottom: 3, borderRadius: 4, borderWidth: 1, borderColor: active ? '#f8fafc' : '#334155', backgroundColor: active ? '#1e293b' : '#0f1a2e' }}>
            <Text fontSize={11} color={active ? '#7dd3fc' : '#64748b'}>{it.hint}</Text>
            <Text fontSize={7} color={active ? '#f8fafc' : '#94a3b8'} style={{ fontFamily: 'monospace' }}>{it.label}</Text>
          </Pressable>
        );
      })}
    </Box>
  );
}

function RailLabel(props: { text: string }) {
  return <Text fontSize={7} color="#64748b" style={{ fontFamily: 'monospace', letterSpacing: 0.5 }}>{props.text}</Text>;
}

function HeightRail(props: {
  hTool: HeightTool; onHTool: (t: HeightTool) => void;
  profile: BrushProfile; onProfile: (p: BrushProfile) => void;
  shape: BrushShape; onShape: (s: BrushShape) => void;
  centerZ: number; onCenterZ: (z: number) => void;
  size: number; onSize: (n: number) => void;
  onClear: () => void;
}) {
  const dim = props.hTool === 'erase'; // profile/shape only matter when raising
  return (
    <Box style={{ gap: 6 }}>
      <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        <ToolBtn icon="Brush" active={props.hTool === 'brush'} onPress={() => props.onHTool('brush')} />
        <ToolBtn icon="Eraser" active={props.hTool === 'erase'} onPress={() => props.onHTool('erase')} />
      </Box>
      {/* Footprint outline (which cells) + cross-section profile (how tall across).
          Both dim under the eraser, which just zeros its footprint. */}
      <RailLabel text="shape" />
      <ChipGrid items={HEIGHT_FOOTPRINTS} value={props.shape} onPick={(v) => props.onShape(v as BrushShape)} dim={dim} />
      <RailLabel text="profile" />
      <ChipGrid items={HEIGHT_PROFILES} value={props.profile} onPick={(v) => props.onProfile(v as BrushProfile)} dim={dim} />
      <Box style={{ height: 1, backgroundColor: '#1e293b' }} />
      <MiniStepper label="z (m)" value={props.centerZ.toFixed(1)} onDec={() => props.onCenterZ(clamp(props.centerZ - Z_STEP, Z_MIN, Z_MAX))} onInc={() => props.onCenterZ(clamp(props.centerZ + Z_STEP, Z_MIN, Z_MAX))} />
      <SizeStepper size={props.size} onSize={props.onSize} />
      <Pressable onPress={props.onClear} style={{ alignItems: 'center', paddingTop: 3, paddingBottom: 3, borderRadius: 4, borderWidth: 1, borderColor: '#7f1d1d', backgroundColor: '#3d1414' }}>
        <Text fontSize={8} color="#fca5a5" style={{ fontWeight: 700 }}>clear focused</Text>
      </Pressable>
    </Box>
  );
}

const ROT_STEP = 15; // degrees per rotate tap

// Place rail — controls for the SELECTED placement (conditional on selection).
function PlaceRail(props: { sel: Placement | null; place: PlaceProps }) {
  const sel = props.sel;
  if (!sel) {
    return <Text fontSize={8} color="#475569" style={{ fontFamily: 'monospace' }}>click + in the model viewer to place an object</Text>;
  }
  const set = (patch: Partial<Placement>) => props.place.onUpdate(sel.id, patch);
  return (
    <Box style={{ gap: 6 }}>
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
    </Box>
  );
}

// Zone rail — paint tools + the zone palette (each a named, coloured, flagged
// area), plus an editor for the active zone: name, the ZONE_FLAGS trigger
// taxonomy, delete.
function ZoneRail(props: {
  tool: Tool; onTool: (t: Tool) => void; size: number; onSize: (n: number) => void;
  zones: ZoneDef[]; activeZone: number; onActiveZone: (i: number) => void;
  onAddZone: () => void; onUpdateZone: (i: number, patch: Partial<ZoneDef>) => void; onDeleteZone: (i: number) => void;
}) {
  const z = props.zones[props.activeZone];
  return (
    <Box style={{ gap: 6 }}>
      <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {TOOLS.map((t) => <ToolBtn key={t.id} icon={t.icon} active={props.tool === t.id} onPress={() => props.onTool(t.id)} />)}
      </Box>
      <SizeStepper size={props.size} onSize={props.onSize} />
      <Box style={{ height: 1, backgroundColor: '#1e293b' }} />
      {/* Zone palette: a swatch per zone + a dashed "new zone" tile. */}
      <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {props.zones.map((zz, i) => (
          <Pressable key={zz.id} onPress={() => { props.onActiveZone(i); props.onTool('brush'); }} style={{ width: CELL, height: CELL, borderRadius: 3, borderWidth: i === props.activeZone ? 2 : 1, borderColor: i === props.activeZone ? '#f8fafc' : '#1e293b', backgroundColor: zz.color }} />
        ))}
        <Pressable onPress={props.onAddZone} style={{ width: CELL, height: CELL, borderRadius: 3, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f1a2e', alignItems: 'center', justifyContent: 'center' }}>
          <Text fontSize={13} color="#86efac" style={{ fontWeight: 800 }}>+</Text>
        </Pressable>
      </Box>
      {z ? (
        <Box style={{ gap: 5, borderTopWidth: 1, borderTopColor: '#1e293b', paddingTop: 6 }}>
          <TextInput text={z.name} onChangeText={(v: string) => props.onUpdateZone(props.activeZone, { name: v })} style={{ backgroundColor: '#0f1a2e', borderWidth: 1, borderColor: '#27364a', borderRadius: 3, paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2, color: '#e2e8f0', fontSize: 10 }} />
          <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3 }}>
            {ZONE_FLAGS.map((f) => {
              const on = z.flags.includes(f);
              return (
                <Pressable key={f} onPress={() => props.onUpdateZone(props.activeZone, { flags: on ? z.flags.filter((x) => x !== f) : [...z.flags, f] })} style={{ paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2, borderRadius: 3, borderWidth: on ? 2 : 1, borderColor: on ? '#f8fafc' : '#27364a', backgroundColor: on ? '#1e293b' : '#0f1a2e' }}>
                  <Text fontSize={8} color={on ? '#f8fafc' : '#94a3b8'} style={{ fontWeight: on ? 700 : 500 }}>{FLAG_TAG[f]}</Text>
                </Pressable>
              );
            })}
          </Box>
          <Pressable onPress={() => props.onDeleteZone(props.activeZone)} style={{ alignItems: 'center', paddingTop: 3, paddingBottom: 3, borderRadius: 4, borderWidth: 1, borderColor: '#7f1d1d', backgroundColor: '#3d1414' }}>
            <Text fontSize={8} color="#fca5a5" style={{ fontWeight: 700 }}>delete zone</Text>
          </Pressable>
        </Box>
      ) : (
        <Text fontSize={8} color="#475569" style={{ fontFamily: 'monospace' }}>+ a zone, then paint it</Text>
      )}
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
  props.sink.current = setHover; // stable setter; idempotent to assign each render
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
function BrushCursor(props: { sink: BrushSink }) {
  const [b, setB] = useState<BrushVis>(null);
  props.sink.current = setB; // stable setter; idempotent to assign each render
  if (!b) return null;
  const r = b.d / 2;
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
}

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

  const hTool: HeightTool = props.brush.heightTool === 'erase' ? 'erase' : 'brush';
  const centerZ = clamp(Number(props.brush.centerZ), Z_MIN, Z_MAX);
  // One brush size (radius in tiles) shared by paint, zone, and height.
  const brushSize = clamp(Math.round(Number(props.brush.size)), SIZE_MIN, SIZE_MAX);
  const heightProfile: BrushProfile = props.brush.heightProfile ?? 'cone';
  const heightShape: BrushShape = props.brush.heightShape ?? 'circle';
  const setHTool = useCallback((heightTool: HeightTool) => props.onBrushChange({ heightTool }), [props.onBrushChange]);
  const setHeightProfile = useCallback((heightProfile: BrushProfile) => props.onBrushChange({ heightProfile }), [props.onBrushChange]);
  const setHeightShape = useCallback((heightShape: BrushShape) => props.onBrushChange({ heightShape }), [props.onBrushChange]);
  const setCenterZ = useCallback((z: number) => props.onBrushChange({ centerZ: clamp(z, Z_MIN, Z_MAX) }), [props.onBrushChange]);
  const setBrushSize = useCallback((size: number) => props.onBrushChange({ size: clamp(Math.round(size), SIZE_MIN, SIZE_MAX) }), [props.onBrushChange]);

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
  const PAN_SPEED = 700; // px/s while a direction key is held
  const [drift, setDrift] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const heldKeys = useRef<Set<string>>(new Set());
  const recomputeDriftRef = useRef<() => void>(() => {});
  const wasdFocusedRef = useRef(false);
  wasdFocusedRef.current = !!props.wasdFocused;
  // Ctrl-held state — mouse events carry no modifier flags, so track it off the key
  // bus (every key event reports the live modifier mask). Drives ctrl-click select.
  const ctrlHeldRef = useRef(false);
  // Lost focus (another quad claimed WASD) → drop held keys so the pan stops at once.
  useEffect(() => {
    if (!props.wasdFocused && heldKeys.current.size) { heldKeys.current.clear(); recomputeDriftRef.current(); }
  }, [props.wasdFocused]);
  useEffect(() => {
    const DIR: Record<string, { x: number; y: number }> = {
      d: { x: 1, y: 0 }, a: { x: -1, y: 0 }, s: { x: 0, y: 1 }, w: { x: 0, y: -1 },
    };
    const recompute = () => {
      let x = 0, y = 0;
      for (const k of heldKeys.current) { const v = DIR[k]; if (v) { x += v.x; y += v.y; } }
      setDrift({ x: x * PAN_SPEED, y: y * PAN_SPEED });
    };
    recomputeDriftRef.current = recompute;
    const textFocused = () => {
      const t = callHost<{ focused_id?: number } | null>('__tel_input', null);
      return !!t && Number(t.focused_id ?? -1) >= 0;
    };
    const onDown = (ev: any) => {
      if (typeof ev?.ctrlKey === 'boolean') ctrlHeldRef.current = ev.ctrlKey || ev.metaKey;
      const k = String(ev?.key ?? '').toLowerCase();
      if (!DIR[k] || ev?.ctrlKey || ev?.altKey || ev?.metaKey) return;
      if (!wasdFocusedRef.current) return; // only the focused quad pans
      if (heldKeys.current.has(k) || textFocused()) return; // ignore key-repeat / typing
      heldKeys.current.add(k); recompute();
    };
    const onUp = (ev: any) => {
      if (typeof ev?.ctrlKey === 'boolean') ctrlHeldRef.current = ev.ctrlKey || ev.metaKey;
      const k = String(ev?.key ?? '').toLowerCase();
      if (heldKeys.current.delete(k)) recompute();
    };
    const clear = () => { if (heldKeys.current.size) { heldKeys.current.clear(); recompute(); } };
    const offDown = busOn('__keydown', onDown);
    const offUp = busOn('__keyup', onUp);
    const offBlur = busOn('system:blur', clear);
    return () => { offDown(); offUp(); offBlur(); heldKeys.current.clear(); };
  }, []);
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
        heightCache.current.set(k, downsampleHeights(c.height.z, c.height.cols, c.height.rows));
        heightVer.current.set(k, (heightVer.current.get(k) ?? 0) + 1);
        heightDirty.current.delete(k);
        heightEnc++;
      }
      out.push({ cx: c.cx, cz: c.cz, tileData: tileCache.current.get(k)!, heights: heightCache.current.get(k)!, hcols: HF_RES, hrows: HF_RES, hver: heightVer.current.get(k) ?? 0 });
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
  const brushRef = useRef({ centerZ, size: brushSize, tool: hTool, shape: heightShape, profile: heightProfile });
  brushRef.current = { centerZ, size: brushSize, tool: hTool, shape: heightShape, profile: heightProfile };
  // Height is ADDITIVE (heightData.stampCone stacks), but onMouseMove fires at input
  // rate (~100/s) — re-stamping a stationary brush every event saturates cells to
  // HEIGHT_LIMIT in a few frames, flattening everything to one max plateau and making
  // the z intensity look inert. The design's "overlap builds relief" comes from the
  // brush MOVING, so deposit the cone at most once per center-cell per stroke; genuine
  // drag motion still stacks across cells, separate strokes still stack on top.
  const heightStamped = useRef<Set<string>>(new Set());
  const paintRef = useRef({ tile, tool, size: brushSize });
  paintRef.current = { tile, tool, size: brushSize };

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
      stampBrush(ch.height, cix, ciy, { centerZ: b.centerZ, radiusM, shape: b.shape, profile: b.profile, erase: b.tool === 'erase' });
      const k = chunkKey(ch.cx, ch.cz);
      touched.add(k);
      heightDirty.current.add(k);
    }
    // The 3D preview-mesh mirror is DEFERRED to stroke end (endStroke → syncRegionsNow):
    // a height edit re-ships the whole ~65k-float mesh across the bridge, so doing it
    // mid-stroke per dirty chunk freezes paint. The 2D canvas is live via the touch.
  };

  const stampTileAtGraph = (gx: number, gy: number, touched: Set<ChunkKey>) => {
    const c = resolveCell(gx, gy);
    if (!c) return;
    const p = paintRef.current;
    const idx = p.tool === 'eraser' ? -1 : tileKindIndex(p.tile);
    stampDisc(p.size, c.cellX, c.cellZ, (x, z) => {
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
    const idx = p.tool === 'eraser' ? -1 : activeZoneRef.current;
    stampDisc(p.size, c.cellX, c.cellZ, (x, z) => {
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

  // Register the live-world getter so the cart can serialize on autosave. Reassign
  // each render so it captures the latest zones / focus (chunks is a stable ref).
  if (props.apiRef) props.apiRef.current = { getWorld: () => ({ chunks, zones, focus }) };

  // Unified brush dispatch: paint paints tiles, zone paints the active zone, height
  // sculpts; all with brush/eraser (pointer pans). Place has no brush (draggable).
  const showBrush = layer === 'height' || ((layer === 'paint' || layer === 'zone') && tool !== 'pointer');
  // What a just-finished stroke did, for the event log — read from the active layer
  // + tool at stroke end.
  const strokeNote = (): EditNote => {
    if (layer === 'height') return { cat: 'height', text: hTool === 'erase' ? 'lowered terrain' : 'raised terrain' };
    if (layer === 'zone') { const z = zones[activeZone]; return { cat: 'zone', text: tool === 'eraser' ? 'erased zone' : `painted ${z ? z.name : 'zone'}` }; }
    return { cat: 'tile', text: tool === 'eraser' ? 'erased tiles' : `painted ${tile}` };
  };
  // Where the last stamp landed, in GRAPH space, so onBrush can fill the gap to the
  // current point. null between strokes (reset in beginStroke) so a new stroke never
  // draws a line from the previous stroke's end.
  const lastStampG = useRef<{ x: number; y: number } | null>(null);
  const stampOneAtGraph = (gx: number, gy: number, touched: Set<ChunkKey>) => {
    if (layer === 'height') stampHeightAtGraph(gx, gy, touched);
    else if (layer === 'zone') stampZoneAtGraph(gx, gy, touched);
    else stampTileAtGraph(gx, gy, touched);
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
    const touched = new Set<ChunkKey>();
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
    if (!c) hoverSink.current?.(null);
    else hoverSink.current?.({ x: sx - r!.x + 12, y: sy - r!.y + 12, addr: `${columnLabel(c.gCellX).toLowerCase()}${c.gCellZ}` });
    if (!g || !r) { brushSink.current?.(null); return; }
    const g2 = screenToGraph(sx + BRUSH_PROBE, sy);
    const zoom = g2 && g2.gx !== g.gx ? BRUSH_PROBE / (g2.gx - g.gx) : 1; // px per graph unit
    const dia = (brushSize * 2 + 1) * TILE_UNITS * zoom; // footprint width across, in px
    const erasing = layer === 'height' ? hTool === 'erase' : tool === 'eraser';
    const color = erasing ? '#f87171'
      : layer === 'height' ? '#fbbf24'
      : layer === 'zone' ? (zones[activeZone]?.color ?? '#22d3ee')
      : tileKindDefinition(tile).render.color;
    // Snap the ring to the cell centre it'll paint; off any focused chunk, ride the cursor.
    const cxp = c ? sx + (c.cgx - g.gx) * zoom : sx;
    const cyp = c ? sy + (c.cgy - g.gy) * zoom : sy;
    brushSink.current?.({ x: cxp - r.x, y: cyp - r.y, d: dia, on: !!c, color, shape: layer === 'height' ? heightShape : 'circle' });
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
  onBrushRef.current = onBrush;
  updateCursorRef.current = updateCursor;
  driftActiveRef.current = drift.x !== 0 || drift.y !== 0;
  brushShownRef.current = showBrush;

  // Churn probe: PaintCanvas is memoized + paints through refs, so it should NOT
  // re-render while you paint. A line here mid-stroke means a prop/state churned
  // it (e.g. focus/zones/drift/select) — naming which is the lead.
  useChurn('PaintCanvas', {
    focus, chunkRev, zones, drift, tool, tile, layer, place,
    selCells: props.select?.cells, brushSize, centerZ, hTool, wasdFocused: props.wasdFocused,
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
        driftX={drift.x}
        driftY={drift.y}
        driftActive={drift.x !== 0 || drift.y !== 0}
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

        {/* Place layer: each placement is a draggable Canvas.Node over the ground. */}
        {layer === 'place' ? place.items.map((p) => {
          const isSel = p.id === place.selId;
          return (
            <Canvas.Node
              key={p.id}
              gx={p.gx}
              gy={p.gy}
              gw={p.footW * TILE_UNITS}
              gh={p.footD * TILE_UNITS}
              onPress={() => { claimWasd?.(); place.onSelect(p.id); }}
              onMove={p.locked ? undefined : (evt: any) => { claimWasd?.(); place.onMove(p.id, Number(evt?.gx ?? p.gx), Number(evt?.gy ?? p.gy)); if (p.id !== place.selId) place.onSelect(p.id); }}
            >
              <Box style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: `${p.color}cc`, borderWidth: isSel ? 2 : 1, borderColor: isSel ? '#f8fafc' : '#0b1320', transform: { rotate: p.rotation } }}>
                <Box style={{ position: 'absolute', top: 2, width: '40%', height: 3, borderRadius: 2, backgroundColor: isSel ? '#f8fafc' : '#0b1320' }} />
                <Text fontSize={8} color="#0b1320" style={{ fontWeight: 800 }}>{p.label}</Text>
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
          onMouseDown={(p: any) => { claimWasd?.(); const sx = Number(p?.x ?? 0); const sy = Number(p?.y ?? 0); if (tryAddSlotAt(sx, sy)) return; drawing.current = true; beginStroke(); notifyEditBegin(); onBrush(sx, sy); updateCursor(sx, sy); }}
          onMouseMove={(p: any) => { const sx = Number(p?.x ?? 0); const sy = Number(p?.y ?? 0); if (drawing.current) onBrush(sx, sy); updateCursor(sx, sy); }}
          onMouseUp={() => { const was = drawing.current; drawing.current = false; if (was) { endStroke(); notifyEdit(strokeNote()); } }}
          onMouseLeave={() => { const was = drawing.current; drawing.current = false; hoverSink.current?.(null); brushSink.current?.(null); if (was) { endStroke(); notifyEdit(strokeNote()); } }}
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

      {/* The one-at-a-time address readout — owns its own state (see HoverReadout). */}
      <HoverReadout sink={hoverSink} />

      {/* The visible brush footprint — only while a brush is the active tool. */}
      {showBrush ? <BrushCursor sink={brushSink} /> : null}

      {/* Left rail — conditional on the active layer (absolute overlay, on top). */}
      <Box style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: RAIL_W, backgroundColor: '#0b1320ee', borderRightWidth: 1, borderRightColor: '#1e293b', paddingLeft: 5, paddingRight: 5, paddingTop: 6, paddingBottom: 6 }}>
        {layer === 'paint' ? <PaintRail tool={tool} onTool={props.onTool} tile={tile} onTile={props.onTile} size={brushSize} onSize={setBrushSize} /> : null}
        {layer === 'height' ? <HeightRail hTool={hTool} onHTool={setHTool} profile={heightProfile} onProfile={setHeightProfile} shape={heightShape} onShape={setHeightShape} centerZ={centerZ} onCenterZ={setCenterZ} size={brushSize} onSize={setBrushSize} onClear={clearHeights} /> : null}
        {layer === 'place' ? <PlaceRail sel={selPlacement} place={place} /> : null}
        {layer === 'zone' ? <ZoneRail tool={tool} onTool={props.onTool} size={brushSize} onSize={setBrushSize} zones={zones} activeZone={activeZone} onActiveZone={setActiveZone} onAddZone={addZone} onUpdateZone={updateZone} onDeleteZone={deleteZone} /> : null}
      </Box>

      {/* Right edge: chunk focus gutter (thin dock, keeps the centre clear). */}
      <ChunkGutter chunks={allChunks} focus={focus} onToggle={toggleFocus} onAll={focusAll} onNone={focusNone} />

      {/* Bottom: layer switch, inset left of the gutter so they never overlap. */}
      <Box style={{ position: 'absolute', right: GUTTER_W + 8, bottom: 8, flexDirection: 'row', gap: 4, backgroundColor: '#0b1320ee', borderWidth: 1, borderColor: '#1e293b', borderRadius: 6, padding: 4 }}>
        <LayerBtn label="PAINT" color="#86efac" active={layer === 'paint'} onPress={() => props.onLayer('paint')} />
        <LayerBtn label="HEIGHT" color="#fbbf24" active={layer === 'height'} onPress={() => props.onLayer('height')} />
        <LayerBtn label="PLACE" color="#a78bfa" active={layer === 'place'} onPress={() => props.onLayer('place')} />
        <LayerBtn label="ZONE" color="#22d3ee" active={layer === 'zone'} onPress={() => props.onLayer('zone')} />
      </Box>
    </Box>
  );
}
