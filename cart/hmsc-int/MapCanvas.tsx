// The 2D top-down placement canvas. The whole tile field is ONE <Effect> shader
// quad (the world_as_shader_quad pattern) — one draw at any world size — with TSX
// overlays for the landmarks the shader can't draw (road centerlines, cul-de-sac
// bulbs, building/zone/prop labels) and a placement GHOST the parent supplies.
//
// This file is a PURE interaction surface: it renders the staged world and emits
// semantic gestures (tap a cell, paint cells along a drag, commit a rect, hover a
// cell). It knows nothing about tools or world mutation — index.tsx maps gestures
// to the editorWorld mutators. Pointer→cell inverts the same pan/zoom transform
// the shader uses, so a click always lands on the cell under the cursor.

import { useRef, useState } from 'react';
import { Box, Effect, Pressable, Text } from '@reactjit/primitives';
import type { GameState } from '../hmsc/design';
import { tileKindDefinition } from '../hmsc/world/tileKinds';
import { worldMarkers } from '../hmsc/world/worldView';
import { roadFootprint } from '../hmsc/world/roads';
import { junctionFootprint } from '../hmsc/world/roadJunctions';
import { HMSC_ROAD_SCALE } from '../hmsc/world/roadProfile';
import { TILE_FILL_WGSL, tileFillMaterialId, tileFillVariant } from '../hmsc/render3d/tileFill';
import { hexToRgb01 } from '../hmsc/world/placeables';

export const MIN_PIXELS_PER_TILE = 1.5;
export const MAX_PIXELS_PER_TILE = 48;
export const ZOOM_STEP = 1.3;
const CLICK_DRAG_THRESHOLD_PX = 5;

export type MapView = { centerX: number; centerZ: number; pixelsPerTile: number };
type Rect = { x: number; y: number; width: number; height: number };
export type CellRect = { x: number; z: number; width: number; depth: number };

// How the active tool consumes a primary drag:
//   'pan'       — drag pans the view, a tap fires onTap (inspect / tap-place tools)
//   'paintCell' — drag paints every cell it crosses via onPaintCell (tile brush)
//   'rect'      — drag previews a rectangle, release fires onRectCommit (fill/zone)
export type DragMode = 'pan' | 'paintCell' | 'rect';

// A placement preview the parent draws over the map: a footprint rect (in cells)
// tinted by validity (green ok / red blocked). null = no ghost.
export type Ghost = { rect: CellRect; ok: boolean } | null;

// D layout (f32): header [0]W [1]H [2]centerX [3]centerZ [4]ppt [5]selX [6]selZ
// [7]hasSel [8]playerX [9]playerZ [10..12]water [13]regionCount, then per region
// (9 floats): minX, minZ, width, depth, matId, variant, tintR, tintG, tintB.
const MAP_HEADER = 14;
const MAP_REGION_STRIDE = 9;
const MAP_SHADER = `
@group(0) @binding(1) var<storage, read> D: array<f32>;
${TILE_FILL_WGSL}
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let W = D[0]; let H = D[1];
  let center = vec2f(D[2], D[3]);
  let ppt = D[4];
  let sel = vec2f(D[5], D[6]); let hasSel = D[7];
  let player = vec2f(D[8], D[9]);
  let water = vec3f(D[10], D[11], D[12]);
  let regionCount = i32(D[13]);

  let px = in.uv * vec2f(W, H);
  let world = center + (px - vec2f(W, H) * 0.5) / ppt;
  let id = floor(world);
  let f = fract(world);
  let edgePx = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * ppt;

  var col = water;
  var inAny = false;
  for (var r = 0; r < regionCount; r = r + 1) {
    let b = ${MAP_HEADER} + r * ${MAP_REGION_STRIDE};
    let minX = D[b]; let minZ = D[b + 1];
    let w = D[b + 2]; let d = D[b + 3];
    if (id.x >= minX && id.x < minX + w && id.y >= minZ && id.y < minZ + d) {
      let seed = tf_rand(id + vec2f(3.1, 7.7)) * 50.0;
      let mat = tileMaterial(D[b + 4], f, f * 64.0, D[b + 5], seed);
      let tint = vec3f(D[b + 6], D[b + 7], D[b + 8]);
      let lum = clamp(dot(mat, vec3f(0.333, 0.5, 0.167)), 0.0, 1.0);
      col = tint * (0.55 + lum * 0.7);
      inAny = true;
      break;
    }
  }
  if (inAny) {
    col = mix(col, col * 0.5, (1.0 - smoothstep(0.0, 1.2, edgePx)) * 0.7);
    if (hasSel > 0.5 && id.x == sel.x && id.y == sel.y) {
      col = mix(col, vec3f(1.0), 1.0 - smoothstep(0.0, 2.5, edgePx));
      col = mix(col, vec3f(1.0), 0.18);
    }
  }
  let pdist = length(world - player) * ppt;
  if (pdist < 7.0) {
    col = mix(col, vec3f(0.94, 0.97, 1.0), 1.0 - smoothstep(2.0, 4.0, pdist));
    col = mix(col, vec3f(0.05, 0.65, 0.95), (1.0 - smoothstep(4.0, 7.0, pdist)) * step(3.0, pdist));
  }
  return vec4f(col, 1.0);
}
`;

export type MapCanvasProps = {
  state: GameState;
  view: MapView;
  onView: (next: MapView) => void;
  selected: { x: number; z: number } | null;
  dragMode: DragMode;
  ghost: Ghost;
  onTap?: (cell: { x: number; z: number }) => void;
  onPaintCell?: (cell: { x: number; z: number }) => void;
  onRectCommit?: (rect: CellRect) => void;
  onHover?: (cell: { x: number; z: number }) => void;
};

export function MapCanvas(props: MapCanvasProps) {
  const { state, view, onView, selected, dragMode, ghost } = props;
  const world = state.world;
  const cellSize = world.cellSizeMeters;

  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, width: 900, height: 700 });
  const rectRef = useRef(rect);
  const viewRef = useRef(view);
  rectRef.current = rect;
  viewRef.current = view;

  // Pointer bookkeeping: a primary press records its start so we can tell a tap
  // from a drag; a rect gesture tracks its anchor cell + live preview.
  const dragRef = useRef<{ x: number; y: number; dist: number; painted: Set<string> } | null>(null);
  const rectAnchorRef = useRef<{ x: number; z: number } | null>(null);
  const [rectPreview, setRectPreview] = useState<CellRect | null>(null);

  const screenToCell = (clientX: number, clientY: number): { x: number; z: number } => {
    const r = rectRef.current;
    const v = viewRef.current;
    const px = clientX - r.x;
    const py = clientY - r.y;
    return {
      x: Math.floor(v.centerX + (px - r.width / 2) / v.pixelsPerTile),
      z: Math.floor(v.centerZ + (py - r.height / 2) / v.pixelsPerTile),
    };
  };

  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
  const ppt = view.pixelsPerTile;
  const sx = (wx: number) => (wx - view.centerX) * ppt + rect.width / 2;
  const sz = (wz: number) => (wz - view.centerZ) * ppt + rect.height / 2;

  // ── Pointer handlers ───────────────────────────────────────────────────────
  const onDown = (e: any) => {
    const cx = Number(e?.x ?? 0);
    const cy = Number(e?.y ?? 0);
    const cell = screenToCell(cx, cy);
    if (dragMode === 'rect') {
      rectAnchorRef.current = cell;
      setRectPreview({ x: cell.x, z: cell.z, width: 1, depth: 1 });
      return;
    }
    if (dragMode === 'paintCell') {
      const painted = new Set<string>();
      dragRef.current = { x: cx, y: cy, dist: 0, painted };
      painted.add(`${cell.x},${cell.z}`);
      props.onPaintCell?.(cell);
      return;
    }
    dragRef.current = { x: cx, y: cy, dist: 0, painted: new Set() };
  };

  const onMove = (e: any) => {
    const cx = Number(e?.x ?? 0);
    const cy = Number(e?.y ?? 0);
    props.onHover?.(screenToCell(cx, cy));

    if (dragMode === 'rect' && rectAnchorRef.current) {
      const a = rectAnchorRef.current;
      const c = screenToCell(cx, cy);
      setRectPreview({
        x: Math.min(a.x, c.x),
        z: Math.min(a.z, c.z),
        width: Math.abs(c.x - a.x) + 1,
        depth: Math.abs(c.z - a.z) + 1,
      });
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    if (dragMode === 'paintCell') {
      const cell = screenToCell(cx, cy);
      const key = `${cell.x},${cell.z}`;
      if (!d.painted.has(key)) {
        d.painted.add(key);
        props.onPaintCell?.(cell);
      }
      return;
    }
    // pan
    const dx = cx - d.x;
    const dy = cy - d.y;
    d.dist += Math.abs(dx) + Math.abs(dy);
    d.x = cx;
    d.y = cy;
    onView({ ...viewRef.current, centerX: viewRef.current.centerX - dx / viewRef.current.pixelsPerTile, centerZ: viewRef.current.centerZ - dy / viewRef.current.pixelsPerTile });
  };

  const onUp = (e: any) => {
    if (dragMode === 'rect') {
      const preview = rectPreview;
      rectAnchorRef.current = null;
      setRectPreview(null);
      if (preview) props.onRectCommit?.(preview);
      return;
    }
    const d = dragRef.current;
    dragRef.current = null;
    if (dragMode === 'paintCell') return;
    // pan mode: a press that didn't travel is a tap
    if (d && d.dist < CLICK_DRAG_THRESHOLD_PX) {
      props.onTap?.(screenToCell(Number(e?.x ?? 0), Number(e?.y ?? 0)));
    }
  };

  const onScrollZoom = (payload: any) => {
    const dz = Number(payload?.deltaY ?? 0);
    if (!dz) return;
    const next = clamp(view.pixelsPerTile * (dz > 0 ? ZOOM_STEP : 1 / ZOOM_STEP), MIN_PIXELS_PER_TILE, MAX_PIXELS_PER_TILE);
    if (next !== view.pixelsPerTile) onView({ ...view, pixelsPerTile: next });
  };

  // ── Shader region data (staged world) ───────────────────────────────────────
  const [waterR, waterG, waterB] = hexToRgb01(tileKindDefinition('water').render.color);
  const roadTint = hexToRgb01(tileKindDefinition('road').render.color);
  const roadMatId = tileFillMaterialId('road');
  const roadVariant = tileFillVariant('road');
  type MapRegion = { x: number; z: number; w: number; d: number; matId: number; variant: number; tint: [number, number, number] };
  const mapRegions: MapRegion[] = [];
  for (const road of world.roads) {
    const f = roadFootprint(road);
    mapRegions.push({ x: f.minX, z: f.minZ, w: f.maxX - f.minX, d: f.maxZ - f.minZ, matId: roadMatId, variant: roadVariant, tint: roadTint });
  }
  for (const junction of world.junctions) {
    if (junction.kind !== 'intersection') continue;
    const f = junctionFootprint(junction);
    mapRegions.push({ x: f.minX, z: f.minZ, w: f.maxX - f.minX, d: f.maxZ - f.minZ, matId: roadMatId, variant: roadVariant, tint: roadTint });
  }
  // Newest region first: the shader breaks on the FIRST region covering a cell
  // (lowest index wins), and the game's surfaceRegionAtCell resolves newest-first
  // (last in the array wins). Iterating in reverse makes the two agree, so a tile
  // fill painted OVER existing ground shows the same kind the game will resolve.
  for (let i = world.surfaceRegions.length - 1; i >= 0; i -= 1) {
    const r = world.surfaceRegions[i];
    mapRegions.push({ x: r.x, z: r.z, w: r.width, d: r.depth, matId: tileFillMaterialId(r.kind), variant: tileFillVariant(r.kind), tint: hexToRgb01(tileKindDefinition(r.kind).render.color) });
  }
  const data = [
    rect.width, rect.height,
    view.centerX, view.centerZ, view.pixelsPerTile,
    selected ? selected.x : 0, selected ? selected.z : 0, selected ? 1 : 0,
    state.player.position.x / cellSize, state.player.position.z / cellSize,
    waterR, waterG, waterB,
    mapRegions.length,
  ];
  for (const mr of mapRegions) {
    data.push(mr.x, mr.z, mr.w, mr.d, mr.matId, mr.variant, mr.tint[0], mr.tint[1], mr.tint[2]);
  }

  // ── Overlays ─────────────────────────────────────────────────────────────
  const markers = worldMarkers(state);
  const buildingMarkers = markers.filter((m) => m.layer === 'building');
  const zoneMarkers = markers.filter((m) => m.layer === 'zone');
  const mountainMarkers = markers.filter((m) => m.layer === 'mountain');
  const propMarkers = markers.filter((m) => m.layer === 'prop');
  const roadColor = tileKindDefinition('road').render.color;
  const sidewalkColor = tileKindDefinition('sidewalk').render.color;
  const culDeSacs = world.junctions.filter((j) => j.kind === 'culDeSac');

  return (
    <Pressable
      onLayout={(lr: any) => setRect({ x: Number(lr?.x ?? 0), y: Number(lr?.y ?? 0), width: Number(lr?.width ?? 900), height: Number(lr?.height ?? 700) })}
      onMouseDown={onDown}
      onMouseMove={onMove}
      onMouseUp={onUp}
      onScroll={onScrollZoom}
      style={{ flexGrow: 1, position: 'relative', overflow: 'scroll' }}
    >
      <Effect shader={MAP_SHADER} data={data} style={{ width: '100%', height: '100%' }} />
      <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        {world.roads.map((r) => {
          const f = roadFootprint(r);
          if (r.orientation === 'northSouth') {
            return <Box key={r.id} style={{ position: 'absolute', left: sx((f.minX + f.maxX) / 2) - 1, top: sz(f.minZ), width: 2, height: (f.maxZ - f.minZ) * ppt, backgroundColor: '#fde047' }} />;
          }
          return <Box key={r.id} style={{ position: 'absolute', left: sx(f.minX), top: sz((f.minZ + f.maxZ) / 2) - 1, width: (f.maxX - f.minX) * ppt, height: 2, backgroundColor: '#fde047' }} />;
        })}
        {culDeSacs.map((j) => {
          const bulb = j.bulbRadiusTiles * ppt;
          const island = HMSC_ROAD_SCALE.culDeSacIslandRadiusMeters * ppt;
          const cx = sx(j.centerX);
          const cz = sz(j.centerZ);
          return (
            <Box key={j.id}>
              <Box style={{ position: 'absolute', left: cx - bulb, top: cz - bulb, width: bulb * 2, height: bulb * 2, borderRadius: bulb, backgroundColor: roadColor }} />
              <Box style={{ position: 'absolute', left: cx - island, top: cz - island, width: island * 2, height: island * 2, borderRadius: island, backgroundColor: sidewalkColor, borderWidth: 1, borderColor: '#3f4654' }} />
            </Box>
          );
        })}
        {mountainMarkers.map((m) => {
          const left = sx(m.x);
          const top = sz(m.z);
          const w = m.width * ppt;
          const h = m.depth * ppt;
          const ringAlpha = ['40', '70', 'b0'];
          return (
            <Box key={m.id} style={{ position: 'absolute', left, top, width: w, height: h, alignItems: 'center', justifyContent: 'center' }}>
              {[1, 0.62, 0.3].map((fr, i) => (
                <Box key={i} style={{ position: 'absolute', left: (w - w * fr) / 2, top: (h - h * fr) / 2, width: w * fr, height: h * fr, borderRadius: (Math.min(w, h) * fr) / 2, backgroundColor: `${m.swatchColor}${ringAlpha[i]}`, borderWidth: i === 0 ? 2 : 1, borderColor: '#2b241a' }} />
              ))}
              {w > 36 ? <Text fontSize={10} color="#fdf6e3" style={{ fontWeight: 800 }}>{m.label}</Text> : null}
            </Box>
          );
        })}
        {zoneMarkers.map((m) => {
          const w = m.width * ppt;
          const h = m.depth * ppt;
          return (
            <Box key={m.id} style={{ position: 'absolute', left: sx(m.x), top: sz(m.z), width: w, height: h, backgroundColor: `${m.swatchColor}22`, borderWidth: 1, borderColor: m.swatchColor, overflow: 'hidden' }}>
              {w > 30 && h > 16 ? <Text fontSize={9} color={m.swatchColor} style={{ fontWeight: 800, padding: 2 }}>{m.label}</Text> : null}
            </Box>
          );
        })}
        {buildingMarkers.map((m) => {
          const w = m.width * ppt;
          const h = m.depth * ppt;
          return (
            <Box key={m.id} style={{ position: 'absolute', left: sx(m.x), top: sz(m.z), width: w, height: h, backgroundColor: `${m.swatchColor}aa`, borderWidth: 1, borderColor: m.swatchColor, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {w > 26 && h > 14 ? <Text fontSize={9} color="#0b1018" style={{ fontWeight: 800 }}>{m.label}</Text> : null}
            </Box>
          );
        })}
        {propMarkers.map((m) => {
          const size = Math.max(5, m.width * ppt);
          const cx = sx(m.x + m.width / 2);
          const cz = sz(m.z + m.depth / 2);
          return <Box key={m.id} style={{ position: 'absolute', left: cx - size / 2, top: cz - size / 2, width: size, height: size, borderRadius: size / 2, backgroundColor: m.swatchColor, borderWidth: 1, borderColor: '#0b1018' }} />;
        })}
        {/* Live rect-gesture preview (fill / zone). */}
        {rectPreview ? (
          <Box style={{ position: 'absolute', left: sx(rectPreview.x), top: sz(rectPreview.z), width: rectPreview.width * ppt, height: rectPreview.depth * ppt, backgroundColor: '#38bdf833', borderWidth: 2, borderColor: '#38bdf8' }} />
        ) : null}
        {/* Placement ghost (building / prop), green ok / red blocked. */}
        {ghost ? (
          <Box style={{ position: 'absolute', left: sx(ghost.rect.x), top: sz(ghost.rect.z), width: ghost.rect.width * ppt, height: ghost.rect.depth * ppt, backgroundColor: ghost.ok ? '#22c55e44' : '#ef444444', borderWidth: 2, borderColor: ghost.ok ? '#22c55e' : '#ef4444' }} />
        ) : null}
      </Box>
    </Pressable>
  );
}
