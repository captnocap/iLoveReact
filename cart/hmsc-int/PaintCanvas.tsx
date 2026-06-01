// PaintCanvas — the 2D authoring surface for the bottom-left quadrant.
//
// LAYERED editor. A bottom-right <Canvas.Clamp> holds layer buttons; the active
// layer decides what the left rail (<Canvas.Clamp>) shows AND what is drawn:
//
//   • paint  — tile-painting tools (pointer / brush / eraser + tile palette).
//              1 tile = 1m; the artboard is the tile field.
//   • height — the underlying heightfield, rendered + edited by <HeightField>:
//              ONE Effect quad over a Float32Array buffer, brushed in place. No
//              per-cell nodes / state, so it scales from this demo patch to full
//              120-tile chunks (see heightfield.ts).
//
// Clamp overlays only capture input where there are handlers (rail + buttons);
// the height brush layer captures inside the patch. Empty areas fall through to
// the Canvas for pan (events.zig).

import { useMemo, useRef, useState } from 'react';
import { Box, Canvas, Effect, Pressable, Text, TextInput } from '@reactjit/primitives';
import { Icon } from '@reactjit/icons/Icon';
import { callHost } from '@reactjit/ffi';
import { columnLabel } from './address';
import type { TileKind, ZoneFlag } from '../hmsc/design';
import { TILE_KINDS, tileKindDefinition } from '../hmsc/world/tileKinds';
import { ZONE_FLAGS } from '../hmsc/world/zones';
import { makeHeightField, stampCone, clearField, encodeField, TILE_UNITS, DOT_M, type HeightField as HField } from './heightData';
import { HEIGHT_FIELD_WGSL } from './heightField.wgsl';
import { makeTileMap, paintTile, clearTileMap, encodeTileMap, tileKindIndex, type TileMap } from './tileData';
import { TILE_FIELD_WGSL } from './tileField.wgsl';
import { makeZoneMap, paintZoneCell, dropZoneIndex, encodeZoneSection, ZONE_COLORS, type ZoneMap, type ZoneDef } from './zoneData';
import { ZONE_VIEW_WGSL } from './zoneView.wgsl';
import type { Placement } from './placements';

type HeightTool = 'brush' | 'erase';
type CanvasRect = { x: number; y: number; width: number; height: number } | null;

export type Tool = 'pointer' | 'brush' | 'eraser';
export type Layer = 'paint' | 'height' | 'place' | 'zone';

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

// The demo patch: 8x8 tiles (1 tile = 1m). The artboard + heightfield span this;
// real chunks just change the tile counts — the field code is size-agnostic.
const PATCH_TILES = 8;
const PATCH = PATCH_TILES * TILE_UNITS;

// Brush profile steppers.
const Z_STEP = 0.5, Z_MIN = -12, Z_MAX = 12;
const FALL_STEP = 0.25, FALL_MIN = 0.25, FALL_MAX = 4;

const TOOLS: { id: Tool; icon: string }[] = [
  { id: 'pointer', icon: 'MousePointer' },
  { id: 'brush', icon: 'Brush' },
  { id: 'eraser', icon: 'Eraser' },
];

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

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

// ── Rails (left, conditional on layer) ───────────────────────────────────────

function PaintRail(props: { tool: Tool; onTool: (t: Tool) => void; tile: TileKind; onTile: (k: TileKind) => void }) {
  return (
    <Box style={{ gap: 6 }}>
      <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {TOOLS.map((t) => <ToolBtn key={t.id} icon={t.icon} active={props.tool === t.id} onPress={() => props.onTool(t.id)} />)}
      </Box>
      <Box style={{ height: 1, backgroundColor: '#1e293b' }} />
      <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {TILE_KINDS.map((k) => <Swatch key={k} color={tileKindDefinition(k).render.color} active={props.tile === k} onPress={() => props.onTile(k)} />)}
      </Box>
    </Box>
  );
}

function HeightRail(props: {
  hTool: HeightTool; onHTool: (t: HeightTool) => void;
  centerZ: number; onCenterZ: (z: number) => void;
  falloff: number; onFalloff: (f: number) => void;
  radiusM: number; onClear: () => void;
}) {
  return (
    <Box style={{ gap: 6 }}>
      <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        <ToolBtn icon="Brush" active={props.hTool === 'brush'} onPress={() => props.onHTool('brush')} />
        <ToolBtn icon="Eraser" active={props.hTool === 'erase'} onPress={() => props.onHTool('erase')} />
      </Box>
      <Box style={{ height: 1, backgroundColor: '#1e293b' }} />
      <MiniStepper label="z (m)" value={props.centerZ.toFixed(1)} onDec={() => props.onCenterZ(clamp(props.centerZ - Z_STEP, Z_MIN, Z_MAX))} onInc={() => props.onCenterZ(clamp(props.centerZ + Z_STEP, Z_MIN, Z_MAX))} />
      <MiniStepper label="fall /m" value={props.falloff.toFixed(2)} onDec={() => props.onFalloff(clamp(props.falloff - FALL_STEP, FALL_MIN, FALL_MAX))} onInc={() => props.onFalloff(clamp(props.falloff + FALL_STEP, FALL_MIN, FALL_MAX))} />
      <Text fontSize={8} color="#64748b" style={{ fontFamily: 'monospace' }}>{`r≈${props.radiusM.toFixed(1)}m`}</Text>
      <Pressable onPress={props.onClear} style={{ alignItems: 'center', paddingTop: 3, paddingBottom: 3, borderRadius: 4, borderWidth: 1, borderColor: '#7f1d1d', backgroundColor: '#3d1414' }}>
        <Text fontSize={8} color="#fca5a5" style={{ fontWeight: 700 }}>clear</Text>
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
  tool: Tool; onTool: (t: Tool) => void;
  zones: ZoneDef[]; activeZone: number; onActiveZone: (i: number) => void;
  onAddZone: () => void; onUpdateZone: (i: number, patch: Partial<ZoneDef>) => void; onDeleteZone: (i: number) => void;
}) {
  const z = props.zones[props.activeZone];
  return (
    <Box style={{ gap: 6 }}>
      <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {TOOLS.map((t) => <ToolBtn key={t.id} icon={t.icon} active={props.tool === t.id} onPress={() => props.onTool(t.id)} />)}
      </Box>
      <Box style={{ height: 1, backgroundColor: '#1e293b' }} />
      {/* Zone palette: a swatch per zone + a dashed "new zone" tile. */}
      <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {props.zones.map((zz, i) => (
          <Pressable key={zz.id} onPress={() => props.onActiveZone(i)} style={{ width: CELL, height: CELL, borderRadius: 3, borderWidth: i === props.activeZone ? 2 : 1, borderColor: i === props.activeZone ? '#f8fafc' : '#1e293b', backgroundColor: zz.color }} />
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

// ── Canvas ───────────────────────────────────────────────────────────────────

// Controlled: tool / tile / layer live in the parent so they persist across hot
// reloads. Heightfield Z data lives in <HeightField>'s buffer (v1, not persisted).
export function PaintCanvas(props: {
  tool: Tool;
  onTool: (t: Tool) => void;
  tile: TileKind;
  onTile: (k: TileKind) => void;
  layer: Layer;
  onLayer: (l: Layer) => void;
  place: PlaceProps;
  showGrid?: boolean;
}) {
  const { tool, tile, layer, place } = props;
  const grid = props.showGrid !== false;
  const selPlacement = place.items.find((p) => p.id === place.selId) ?? null;

  const [hTool, setHTool] = useState<HeightTool>('brush');
  const [centerZ, setCenterZ] = useState(3);
  const [falloff, setFalloff] = useState(1);

  // Cone radius (where the linear fan reaches zero), for the rail readout.
  const radiusM = Math.max(DOT_M, Math.abs(centerZ) / Math.max(FALL_MIN, falloff));

  // The canvas viewport rect (screen space), for screen→graph. ref for the live
  // brush handler, state to size the Effect quad.
  const rectRef = useRef<CanvasRect>(null);

  // ── Heightfield: a Float32Array edited in place (no per-cell nodes/state) ────
  const fieldRef = useRef<HField | null>(null);
  if (!fieldRef.current) fieldRef.current = makeHeightField(PATCH_TILES, PATCH_TILES);
  const field = fieldRef.current;
  const [version, setVersion] = useState(0);     // bump → one storage-buffer re-upload
  const drawing = useRef(false);

  // Plain number[] for the Effect storage buffer — the proven MapCanvas path; a
  // Float32Array may not bind through the reconciler's effectData parser.
  const data = useMemo(() => Array.from(encodeField(field)), [version, field]);
  const quadStyle = useMemo(() => ({ width: '100%' as const, height: '100%' as const }), []);

  // Live brush params via ref so the screen-space handler never goes stale.
  const brushRef = useRef({ centerZ, falloff, tool: hTool });
  brushRef.current = { centerZ, falloff, tool: hTool };

  // Screen point → graph (host binding) → field cell → stamp the cone → re-upload.
  const stampAtScreen = (sx: number, sy: number) => {
    const r = rectRef.current;
    if (!r) return;
    const g = callHost<{ gx: number; gy: number } | null>('__canvas_screen_to_graph', null, sx, sy, r.x + r.width / 2, r.y + r.height / 2);
    if (!g) return;
    const ux = (g.gx + PATCH / 2) / PATCH;
    const uy = (g.gy + PATCH / 2) / PATCH;
    if (ux < -0.05 || uy < -0.05 || ux > 1.05 || uy > 1.05) return;
    const cix = Math.round(ux * (field.cols - 1));
    const ciy = Math.round(uy * (field.rows - 1));
    const b = brushRef.current;
    stampCone(field, cix, ciy, { centerZ: b.centerZ, falloff: b.falloff, erase: b.tool === 'erase' });
    setVersion((v) => v + 1);
  };
  const clearHeights = () => { clearField(field); setVersion((v) => v + 1); };

  // ── Tile map: one tile-kind index per 1m cell (paint layer paints it, the
  //    place layer renders it READ-ONLY as the ground). Same buffer architecture. ─
  const tileMapRef = useRef<TileMap | null>(null);
  if (!tileMapRef.current) tileMapRef.current = makeTileMap(PATCH_TILES, PATCH_TILES);
  const tileMap = tileMapRef.current;
  const [tileVersion, setTileVersion] = useState(0);
  const tileData = useMemo(() => encodeTileMap(tileMap), [tileVersion, tileMap]);
  const paintRef = useRef({ tile, tool });
  paintRef.current = { tile, tool };

  const screenToGraph = (sx: number, sy: number) => {
    const r = rectRef.current;
    if (!r) return null;
    return callHost<{ gx: number; gy: number } | null>('__canvas_screen_to_graph', null, sx, sy, r.x + r.width / 2, r.y + r.height / 2);
  };
  const paintTileAtScreen = (sx: number, sy: number) => {
    const g = screenToGraph(sx, sy);
    if (!g) return;
    const cx = Math.floor((g.gx + PATCH / 2) / TILE_UNITS);
    const cy = Math.floor((g.gy + PATCH / 2) / TILE_UNITS);
    const p = paintRef.current;
    paintTile(tileMap, cx, cy, p.tool === 'eraser' ? -1 : tileKindIndex(p.tile));
    setTileVersion((v) => v + 1);
  };

  // ── Zone map: per-cell zone membership + the zone defs (name/colour/flags) ───
  const zoneMapRef = useRef<ZoneMap | null>(null);
  if (!zoneMapRef.current) zoneMapRef.current = makeZoneMap(PATCH_TILES, PATCH_TILES);
  const zoneMap = zoneMapRef.current;
  const [zones, setZones] = useState<ZoneDef[]>([]);
  const [activeZone, setActiveZone] = useState(0);
  const [zoneVersion, setZoneVersion] = useState(0);
  const zoneSeq = useRef(0);
  const activeZoneRef = useRef(activeZone);
  activeZoneRef.current = activeZone;

  // The zone layer's surface buffer = tile section (ground) + zone section (tint).
  const zoneViewData = useMemo(
    () => [...encodeTileMap(tileMap), ...encodeZoneSection(zoneMap, zones)],
    [tileVersion, zoneVersion, zones, tileMap, zoneMap],
  );

  const addZone = () => {
    zoneSeq.current += 1;
    const id = `z_${zoneSeq.current}`;
    const i = zones.length;
    setZones((zs) => [...zs, { id, name: `Zone ${zs.length + 1}`, color: ZONE_COLORS[zs.length % ZONE_COLORS.length], flags: [] }]);
    setActiveZone(i);
  };
  const updateZone = (i: number, patch: Partial<ZoneDef>) => setZones((zs) => zs.map((z, j) => (j === i ? { ...z, ...patch } : z)));
  const deleteZone = (i: number) => {
    dropZoneIndex(zoneMap, i);
    setZoneVersion((v) => v + 1);
    setZones((zs) => zs.filter((_, j) => j !== i));
    setActiveZone((a) => (a >= i ? Math.max(0, a - 1) : a));
  };
  const paintZoneAtScreen = (sx: number, sy: number) => {
    if (!zones.length) return;
    const g = screenToGraph(sx, sy);
    if (!g) return;
    const cx = Math.floor((g.gx + PATCH / 2) / TILE_UNITS);
    const cy = Math.floor((g.gy + PATCH / 2) / TILE_UNITS);
    paintZoneCell(zoneMap, cx, cy, paintRef.current.tool === 'eraser' ? -1 : activeZoneRef.current);
    setZoneVersion((v) => v + 1);
  };

  // Unified brush dispatch: paint paints tiles, zone paints the active zone, height
  // sculpts; all with brush/eraser (pointer pans). Place has no brush (draggable).
  const showBrush = layer === 'height' || ((layer === 'paint' || layer === 'zone') && tool !== 'pointer');
  const onBrush = (sx: number, sy: number) => {
    if (layer === 'height') stampAtScreen(sx, sy);
    else if (layer === 'zone') paintZoneAtScreen(sx, sy);
    else paintTileAtScreen(sx, sy);
  };

  // One-at-a-time coordinate readout: the hovered cell's address (col letter + row),
  // computed from the brush overlay's window-relative coords (same source the
  // brush uses, so it's never offset). null = cursor off the patch.
  const [hover, setHover] = useState<{ x: number; y: number; addr: string } | null>(null);
  const updateHover = (sx: number, sy: number) => {
    const r = rectRef.current;
    const g = r ? screenToGraph(sx, sy) : null;
    if (!g) { setHover((h) => (h ? null : h)); return; }
    const cx = Math.floor((g.gx + PATCH / 2) / TILE_UNITS);
    const cy = Math.floor((g.gy + PATCH / 2) / TILE_UNITS);
    if (cx < 0 || cy < 0 || cx >= PATCH_TILES || cy >= PATCH_TILES) { setHover((h) => (h ? null : h)); return; }
    setHover({ x: sx - r!.x + 12, y: sy - r!.y + 12, addr: `${columnLabel(cx).toLowerCase()}${cy}` });
  };

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
      >
        {/* Surface (ONE Effect quad each, gx/gy = node center → centered on origin).
            Paint + Place show the painted TILE map (Place read-only as the ground
            under placements); Height shows the heightfield. */}
        {layer === 'paint' || layer === 'place' ? (
          <Canvas.Node gx={0} gy={0} gw={PATCH} gh={PATCH}>
            <Effect shader={TILE_FIELD_WGSL} data={tileData} style={quadStyle} />
          </Canvas.Node>
        ) : null}
        {layer === 'height' ? (
          <Canvas.Node gx={0} gy={0} gw={PATCH} gh={PATCH}>
            <Effect shader={HEIGHT_FIELD_WGSL} data={data} style={quadStyle} />
          </Canvas.Node>
        ) : null}
        {layer === 'zone' ? (
          <Canvas.Node gx={0} gy={0} gw={PATCH} gh={PATCH}>
            <Effect shader={ZONE_VIEW_WGSL} data={zoneViewData} style={quadStyle} />
          </Canvas.Node>
        ) : null}

        {/* Place layer: each placement is a draggable Canvas.Node (onMove gives
            graph coords). Click selects; drag moves (unless locked); the rail
            rotates/clones/deletes/locks the selected one. The footprint box
            rotates via the transform, carrying its facing bar. */}
        {layer === 'place' ? place.items.map((p) => {
          const isSel = p.id === place.selId;
          return (
            // onPress (tap = select) + onMove (drag = move) live on the NODE —
            // a child Pressable would eat the drag and onMove would never fire.
            // onMove also selects so a drag grabs the item too.
            <Canvas.Node
              key={p.id}
              gx={p.gx}
              gy={p.gy}
              gw={p.footW * TILE_UNITS}
              gh={p.footD * TILE_UNITS}
              onPress={() => place.onSelect(p.id)}
              onMove={p.locked ? undefined : (evt: any) => { place.onMove(p.id, Number(evt?.gx ?? p.gx), Number(evt?.gy ?? p.gy)); if (p.id !== place.selId) place.onSelect(p.id); }}
            >
              <Box style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: `${p.color}cc`, borderWidth: isSel ? 2 : 1, borderColor: isSel ? '#f8fafc' : '#0b1320', transform: { rotate: p.rotation } }}>
                <Box style={{ position: 'absolute', top: 2, width: '40%', height: 3, borderRadius: 2, backgroundColor: isSel ? '#f8fafc' : '#0b1320' }} />
                <Text fontSize={8} color="#0b1320" style={{ fontWeight: 800 }}>{p.label}</Text>
              </Box>
            </Canvas.Node>
          );
        }) : null}
      </Canvas>

      {/* Brush layer — a SCREEN-SPACE sibling of the Canvas (cutout pattern), so
          p.x/p.y are screen coords for __canvas_screen_to_graph. Near-transparent
          so it's hittable. Down + move on the same node → pointer capture carries
          the stroke (drag paints). Shown for height (sculpt) and for paint with a
          brush/eraser; pointer + the place layer leave the canvas free to pan/drag.
          Rendered before the controls so they stay clickable on top. */}
      {showBrush ? (
        <Pressable
          onMouseDown={(p: any) => { drawing.current = true; onBrush(Number(p?.x ?? 0), Number(p?.y ?? 0)); }}
          onMouseMove={(p: any) => { const sx = Number(p?.x ?? 0); const sy = Number(p?.y ?? 0); if (drawing.current) onBrush(sx, sy); updateHover(sx, sy); }}
          onMouseUp={() => { drawing.current = false; }}
          onMouseLeave={() => { drawing.current = false; setHover(null); }}
          style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000001' }}
        />
      ) : null}

      {/* The one-at-a-time address readout, pinned to the hovered cell. */}
      {hover ? (
        <Box style={{ position: 'absolute', left: hover.x, top: hover.y, paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2, borderRadius: 4, backgroundColor: '#0b1320ee', borderWidth: 1, borderColor: '#334155' }}>
          <Text fontSize={11} color="#cbd5e1" style={{ fontFamily: 'monospace', fontWeight: 700 }}>{hover.addr}</Text>
        </Box>
      ) : null}

      {/* Left rail — conditional on the active layer (absolute overlay, on top). */}
      <Box style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: RAIL_W, backgroundColor: '#0b1320ee', borderRightWidth: 1, borderRightColor: '#1e293b', paddingLeft: 5, paddingRight: 5, paddingTop: 6, paddingBottom: 6 }}>
        {layer === 'paint' ? <PaintRail tool={tool} onTool={props.onTool} tile={tile} onTile={props.onTile} /> : null}
        {layer === 'height' ? <HeightRail hTool={hTool} onHTool={setHTool} centerZ={centerZ} onCenterZ={setCenterZ} falloff={falloff} onFalloff={setFalloff} radiusM={radiusM} onClear={clearHeights} /> : null}
        {layer === 'place' ? <PlaceRail sel={selPlacement} place={place} /> : null}
        {layer === 'zone' ? <ZoneRail tool={tool} onTool={props.onTool} zones={zones} activeZone={activeZone} onActiveZone={setActiveZone} onAddZone={addZone} onUpdateZone={updateZone} onDeleteZone={deleteZone} /> : null}
      </Box>

      {/* Bottom-right: layer switch (absolute overlay, on top). */}
      <Box style={{ position: 'absolute', right: 8, bottom: 8, flexDirection: 'row', gap: 4, backgroundColor: '#0b1320ee', borderWidth: 1, borderColor: '#1e293b', borderRadius: 6, padding: 4 }}>
        <LayerBtn label="PAINT" color="#86efac" active={layer === 'paint'} onPress={() => props.onLayer('paint')} />
        <LayerBtn label="HEIGHT" color="#fbbf24" active={layer === 'height'} onPress={() => props.onLayer('height')} />
        <LayerBtn label="PLACE" color="#a78bfa" active={layer === 'place'} onPress={() => props.onLayer('place')} />
        <LayerBtn label="ZONE" color="#22d3ee" active={layer === 'zone'} onPress={() => props.onLayer('zone')} />
      </Box>
    </Box>
  );
}
