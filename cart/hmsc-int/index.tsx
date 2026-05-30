import { useEffect, useRef, useState } from 'react';
import { busOn } from '@reactjit/runtime/hooks/useIFTTT';
import { Box, Effect, Pressable, ScrollView, Text } from '@reactjit/runtime/primitives';
import {
  DEFAULT_LIVE_SYNC_INTERVAL_MS,
  type GameState,
  type PlacedCell,
  type WorldSurfaceRegion,
} from '../hmsc/design';
import { createInitialGameState, readLivePlayerSnapshot, readStoredGameState } from '../hmsc/state/gameState';
import { tileKindDefinition } from '../hmsc/world/tileKinds';
import { tileKindAtCell } from '../hmsc/world/grid';
import { worldMarkers } from '../hmsc/world/worldView';
import { roadFootprint } from '../hmsc/world/roads';
import { junctionFootprint } from '../hmsc/world/roadJunctions';
import { TILE_FILL_WGSL, tileFillMaterialId, tileFillVariant } from '../hmsc/render3d/tileFill';

// hmsc-int renders the SAME WorldState the game uses, top-down, as ONE Effect
// shader quad — the whole tile field is a single draw no matter the size (the
// world_as_shader_quad pattern). Per-cell nodes don't scale (they cap out and
// lag at 14,400); instead the shader draws every cell, and clicks are mapped to
// a cell by inverting the pan/zoom transform. Same one draw at 120x120 or
// 1200x1200. The shader also draws the selection highlight and the live player.

const DEFAULT_PIXELS_PER_TILE = 7;
const MIN_PIXELS_PER_TILE = 1.5;
const MAX_PIXELS_PER_TILE = 48;
const ZOOM_STEP = 1.3;
const CLICK_DRAG_THRESHOLD_PX = 5;

type View = { centerX: number; centerZ: number; pixelsPerTile: number };
type Rect = { x: number; y: number; width: number; height: number };

// D layout (f32): header [0]W [1]H [2]centerX [3]centerZ [4]ppt [5]selX [6]selZ
// [7]hasSel [8]playerX [9]playerZ [10..12]water [13]regionCount, then per
// region (6 floats from index 14): minX, minZ, width, depth, matId, variant.
// Every chunk is one region; the shader finds which chunk a cell is in and
// renders that chunk's effect_fills material. One draw for the whole world.
const MAP_HEADER = 14;
const MAP_REGION_STRIDE = 6;
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
      col = tileMaterial(D[b + 4], f, f * 64.0, D[b + 5], seed);
      inAny = true;
      break;
    }
  }

  if (inAny) {
    col = mix(col, col * 0.5, (1.0 - smoothstep(0.0, 1.2, edgePx)) * 0.7); // slab joints
    if (hasSel > 0.5 && id.x == sel.x && id.y == sel.y) {
      col = mix(col, vec3f(1.0), 1.0 - smoothstep(0.0, 2.5, edgePx));
      col = mix(col, vec3f(1.0), 0.18);
    }
  }

  let pdist = length(world - player) * ppt; // live player marker
  if (pdist < 7.0) {
    col = mix(col, vec3f(0.94, 0.97, 1.0), 1.0 - smoothstep(2.0, 4.0, pdist));
    col = mix(col, vec3f(0.05, 0.65, 0.95), (1.0 - smoothstep(4.0, 7.0, pdist)) * step(3.0, pdist));
  }

  return vec4f(col, 1.0);
}
`;

function rgb01(hex: string): [number, number, number] {
  const s = hex.startsWith('#') ? hex.slice(1) : hex;
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
  if (!Number.isFinite(n)) return [0.8, 0.8, 0.8];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function loadWorldState(): GameState {
  const state = readStoredGameState() ?? createInitialGameState();
  const live = readLivePlayerSnapshot();
  if (!live) return state;
  return { ...state, sessionName: live.sessionName, updatedAt: live.updatedAt, player: { ...state.player, ...live.player } };
}

function sameMapView(a: GameState, b: GameState): boolean {
  return a.updatedAt === b.updatedAt
    && a.player.position.x === b.player.position.x
    && a.player.position.z === b.player.position.z
    && a.world.layout.key === b.world.layout.key
    && a.world.surfaceRegions.length === b.world.surfaceRegions.length;
}

function regionsBounds(regions: WorldSurfaceRegion[]): { minX: number; minZ: number; maxX: number; maxZ: number } {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const r of regions) {
    minX = Math.min(minX, r.x);
    minZ = Math.min(minZ, r.z);
    maxX = Math.max(maxX, r.x + r.width);
    maxZ = Math.max(maxZ, r.z + r.depth);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minZ: 0, maxX: 1, maxZ: 1 };
  return { minX, minZ, maxX, maxZ };
}

function regionAtCell(regions: WorldSurfaceRegion[], x: number, z: number): WorldSurfaceRegion | null {
  for (const r of regions) {
    if (x >= r.x && x < r.x + r.width && z >= r.z && z < r.z + r.depth) return r;
  }
  return null;
}

// Trigger data + any hand-placed override live on PlacedCell, not the region.
// The map only draws regions, so a placed cell can sit at any y over the same
// (x,z) column; match the column and take the first hit.
function placedCellAtColumn(placedCells: Record<string, PlacedCell>, x: number, z: number): PlacedCell | null {
  for (const cell of Object.values(placedCells)) {
    if (cell.cell.x === x && cell.cell.z === z) return cell;
  }
  return null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '-∞';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function yesNo(b: boolean): string {
  return b ? 'yes' : 'no';
}

function InfoRow(props: { label: string; value: string }) {
  return (
    <Box style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
      <Text fontSize={11} color="#64748b" style={{ fontFamily: 'monospace', flexShrink: 0 }}>{props.label}</Text>
      <Text fontSize={11} color="#e2e8f0" style={{ fontFamily: 'monospace', flexShrink: 1, textAlign: 'right' }}>{props.value}</Text>
    </Box>
  );
}

function Section(props: { title: string }) {
  return (
    <Text fontSize={10} color="#38bdf8" style={{ fontWeight: 800, letterSpacing: 1, marginTop: 4 }}>
      {props.title}
    </Text>
  );
}

export default function HmscInternalMapToolingCart() {
  const [world, setWorld] = useState<GameState>(loadWorldState);
  const [selected, setSelected] = useState<{ x: number; z: number } | null>(null);
  const [view, setView] = useState<View>(() => {
    const b = regionsBounds(loadWorldState().world.surfaceRegions);
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 1);
    return {
      centerX: (b.minX + b.maxX) / 2,
      centerZ: (b.minZ + b.maxZ) / 2,
      pixelsPerTile: clamp((720 * 0.85) / span, MIN_PIXELS_PER_TILE, MAX_PIXELS_PER_TILE),
    };
  });
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, width: 900, height: 700 });
  const rectRef = useRef(rect);
  const viewRef = useRef(view);
  const dragRef = useRef<{ x: number; y: number; dist: number } | null>(null);
  rectRef.current = rect;
  viewRef.current = view;

  useEffect(() => {
    const refresh = () => {
      const next = loadWorldState();
      setWorld((current) => (sameMapView(current, next) ? current : next));
    };
    refresh();
    const timer = setInterval(refresh, DEFAULT_LIVE_SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    return busOn('__keydown', (event: any) => {
      const key = String(event?.key ?? '').toLowerCase();
      if (key === '=' || key === '+') setView((v) => ({ ...v, pixelsPerTile: clamp(v.pixelsPerTile * ZOOM_STEP, MIN_PIXELS_PER_TILE, MAX_PIXELS_PER_TILE) }));
      if (key === '-' || key === '_') setView((v) => ({ ...v, pixelsPerTile: clamp(v.pixelsPerTile / ZOOM_STEP, MIN_PIXELS_PER_TILE, MAX_PIXELS_PER_TILE) }));
    });
  }, []);

  const regions = world.world.surfaceRegions;
  const cellSize = world.world.cellSizeMeters;
  const player = world.player;

  const beginDrag = (e: any) => { dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0), dist: 0 }; };
  const moveDrag = (e: any) => {
    const d = dragRef.current;
    if (!d) return;
    const x = Number(e?.x ?? d.x);
    const y = Number(e?.y ?? d.y);
    const dx = x - d.x;
    const dy = y - d.y;
    d.dist += Math.abs(dx) + Math.abs(dy);
    d.x = x;
    d.y = y;
    setView((v) => ({ ...v, centerX: v.centerX - dx / v.pixelsPerTile, centerZ: v.centerZ - dy / v.pixelsPerTile }));
  };
  const endDrag = (e: any) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.dist >= CLICK_DRAG_THRESHOLD_PX) return;
    // a tap → invert the transform to a cell coordinate
    const r = rectRef.current;
    const v = viewRef.current;
    const px = Number(e?.x ?? 0) - r.x;
    const py = Number(e?.y ?? 0) - r.y;
    const worldX = v.centerX + (px - r.width / 2) / v.pixelsPerTile;
    const worldZ = v.centerZ + (py - r.height / 2) / v.pixelsPerTile;
    setSelected({ x: Math.floor(worldX), z: Math.floor(worldZ) });
  };
  // Wheel zoom. The map node carries overflow:'scroll' purely so the host
  // routes the wheel here; nothing actually scrolls (content fits), but the
  // onScroll handler still receives deltaY. Zoom is about the screen center.
  const onScrollZoom = (payload: any) => {
    const dz = Number(payload?.deltaY ?? 0);
    if (!dz) return;
    setView((v) => {
      const next = clamp(v.pixelsPerTile * (dz > 0 ? ZOOM_STEP : 1 / ZOOM_STEP), MIN_PIXELS_PER_TILE, MAX_PIXELS_PER_TILE);
      return next === v.pixelsPerTile ? v : { ...v, pixelsPerTile: next };
    });
  };

  const [waterR, waterG, waterB] = rgb01(tileKindDefinition('water').render.color);
  const selectedRegion = selected ? regionAtCell(regions, selected.x, selected.z) : null;
  const selectedPlaced = selected ? placedCellAtColumn(world.world.placedCells, selected.x, selected.z) : null;
  // Resolve the true layered kind through the shared resolver (placed > junction
  // band > road band > surface) so the inspector reports what the GAME sees, not
  // just placed-or-region. The region/placed records still drive the labels below.
  const selectedKind = selected
    ? (tileKindAtCell(world, { x: selected.x, y: selectedRegion?.y ?? 0, z: selected.z }) ?? null)
    : null;
  const selectedDef = selectedKind ? tileKindDefinition(selectedKind) : null;

  // Building footprints drawn as a non-blocking TSX overlay (labels + facade
  // color) over the shader raster — same landmarks the minimap shows, one source.
  const buildingMarkers = worldMarkers(world).filter((m) => m.layer === 'building');

  // Header (14 floats) + 6 floats per region: minX, minZ, width, depth, matId,
  // variant. Roads + junctions are prepended so they draw OVER the base chunks —
  // the shader breaks on the FIRST region containing a cell, so lower index wins.
  const roadMatId = tileFillMaterialId('road');
  const roadVariant = tileFillVariant('road');
  type MapRegion = { x: number; z: number; w: number; d: number; matId: number; variant: number };
  const mapRegions: MapRegion[] = [];
  for (const road of world.world.roads) {
    const f = roadFootprint(road);
    mapRegions.push({ x: f.minX, z: f.minZ, w: f.maxX - f.minX, d: f.maxZ - f.minZ, matId: roadMatId, variant: roadVariant });
  }
  for (const junction of world.world.junctions) {
    const f = junctionFootprint(junction);
    mapRegions.push({ x: f.minX, z: f.minZ, w: f.maxX - f.minX, d: f.maxZ - f.minZ, matId: roadMatId, variant: roadVariant });
  }
  for (const r of regions) {
    mapRegions.push({ x: r.x, z: r.z, w: r.width, d: r.depth, matId: tileFillMaterialId(r.kind), variant: tileFillVariant(r.kind) });
  }
  const data = [
    rect.width, rect.height,
    view.centerX, view.centerZ, view.pixelsPerTile,
    selected ? selected.x : 0, selected ? selected.z : 0, selected ? 1 : 0,
    player.position.x / cellSize, player.position.z / cellSize,
    waterR, waterG, waterB,
    mapRegions.length,
  ];
  for (const mr of mapRegions) {
    data.push(mr.x, mr.z, mr.w, mr.d, mr.matId, mr.variant);
  }

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#080d16', flexDirection: 'column' }}>
      <Box style={{ height: 52, paddingLeft: 16, paddingRight: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#1f2937', backgroundColor: '#111827' }}>
        <Box>
          <Text fontSize={14} color="#f8fafc" style={{ fontWeight: 800 }}>HMSC INTERNAL MAP</Text>
          <Text fontSize={10} color="#94a3b8" style={{ fontFamily: 'monospace' }}>
            {`layout ${world.world.layout.widthCells}×${world.world.layout.depthCells}  one shader quad  drag to pan, +/- to zoom, click a tile`}
          </Text>
        </Box>
        <Text fontSize={10} color="#475569" style={{ fontFamily: 'monospace' }}>
          {`${view.pixelsPerTile.toFixed(1)} px/tile  ${readLivePlayerSnapshot() ? 'live: synced' : 'live: initial'}`}
        </Text>
      </Box>

      <Box style={{ flexGrow: 1, flexDirection: 'row', minHeight: 0 }}>
        <Pressable
          onLayout={(lr: any) => setRect({ x: Number(lr?.x ?? 0), y: Number(lr?.y ?? 0), width: Number(lr?.width ?? 900), height: Number(lr?.height ?? 700) })}
          onMouseDown={beginDrag}
          onMouseMove={moveDrag}
          onMouseUp={endDrag}
          onScroll={onScrollZoom}
          style={{ flexGrow: 1, position: 'relative', overflow: 'scroll' }}
        >
          <Effect shader={MAP_SHADER} data={data} style={{ width: '100%', height: '100%' }} />
          {/* Building landmarks: facade-colored, labeled, non-blocking so the
              map below still receives drag/click. Footprint -> screen via the
              same transform endDrag inverts. */}
          <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, pointerEvents: 'none', overflow: 'hidden' }}>
            {buildingMarkers.map((m) => {
              const left = (m.x - view.centerX) * view.pixelsPerTile + rect.width / 2;
              const top = (m.z - view.centerZ) * view.pixelsPerTile + rect.height / 2;
              const w = m.width * view.pixelsPerTile;
              const h = m.depth * view.pixelsPerTile;
              return (
                <Box
                  key={m.id}
                  style={{ position: 'absolute', left, top, width: w, height: h, backgroundColor: `${m.swatchColor}aa`, borderWidth: 1, borderColor: m.swatchColor, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
                >
                  {w > 26 && h > 14 ? (
                    <Text fontSize={9} color="#0b1018" style={{ fontWeight: 800 }}>{m.label}</Text>
                  ) : null}
                </Box>
              );
            })}
          </Box>
        </Pressable>

        <Box style={{ width: 340, backgroundColor: '#0b1424', borderLeftWidth: 1, borderLeftColor: '#1e293b', flexDirection: 'column', minHeight: 0 }}>
          <ScrollView style={{ flexGrow: 1, height: '100%' }} contentContainerStyle={{ padding: 18, gap: 12 }}>
            <Text fontSize={12} color="#e2e8f0" style={{ fontWeight: 800 }}>TILE DIAGNOSTICS</Text>
            {selected ? (
              <Box style={{ gap: 6 }}>
                <Section title="CELL" />
                <InfoRow label="cell" value={`${selected.x}, ${selectedRegion ? selectedRegion.y : 0}, ${selected.z}`} />
                <InfoRow label="chunk" value={selectedRegion ? selectedRegion.id : 'none (void)'} />
                {selectedRegion ? <InfoRow label="region label" value={selectedRegion.label} /> : null}
                {selectedRegion ? <InfoRow label="zone" value={selectedRegion.zoneKey} /> : null}
                {selectedRegion ? <InfoRow label="region size" value={`${selectedRegion.width}×${selectedRegion.depth}`} /> : null}
                {selectedPlaced ? <InfoRow label="placed" value={selectedPlaced.key} /> : null}
                {selectedPlaced ? <InfoRow label="placed by" value={selectedPlaced.createdByCommand} /> : null}
                {selectedPlaced?.triggerCommand ? <InfoRow label="trigger cmd" value={selectedPlaced.triggerCommand} /> : null}
                {selectedPlaced?.triggerLabel ? <InfoRow label="trigger label" value={selectedPlaced.triggerLabel} /> : null}

                {selectedDef ? (
                  <Box style={{ gap: 6 }}>
                    <Section title="KIND" />
                    <InfoRow label="kind" value={selectedDef.kind} />
                    <InfoRow label="label" value={selectedDef.label} />

                    <Section title="PATHING" />
                    <InfoRow label="walkable" value={yesNo(selectedDef.pathing.walkable)} />
                    <InfoRow label="movementCost" value={fmtNum(selectedDef.pathing.movementCost)} />
                    <InfoRow label="blocksLoS" value={yesNo(selectedDef.pathing.blocksLineOfSight)} />

                    <Section title="SURFACE" />
                    <InfoRow label="material" value={selectedDef.surface.material} />
                    <InfoRow label="walkSpeed×" value={fmtNum(selectedDef.surface.walkSpeedMultiplier)} />
                    <InfoRow label="runSpeed×" value={fmtNum(selectedDef.surface.runSpeedMultiplier)} />
                    <InfoRow label="vehSpeed×" value={fmtNum(selectedDef.surface.vehicleSpeedMultiplier)} />
                    <InfoRow label="accel×" value={fmtNum(selectedDef.surface.accelerationMultiplier)} />
                    <InfoRow label="friction" value={fmtNum(selectedDef.surface.friction)} />
                    <InfoRow label="lateralGrip" value={fmtNum(selectedDef.surface.lateralGrip)} />
                    <InfoRow label="restitution" value={fmtNum(selectedDef.surface.restitution)} />

                    <Section title="TRAVERSAL" />
                    <InfoRow label="modes" value={selectedDef.traversal.allowedModes.join(', ') || 'none'} />
                    <InfoRow label="width" value={selectedDef.traversal.width} />
                    <InfoRow label="maxStepUp m" value={fmtNum(selectedDef.traversal.maxStepUpMeters)} />
                    <InfoRow label="minClear m" value={fmtNum(selectedDef.traversal.minClearanceMeters)} />
                    <InfoRow label="slopeLimit°" value={fmtNum(selectedDef.traversal.slopeLimitDegrees)} />
                    <InfoRow label="crouch" value={yesNo(selectedDef.traversal.requiresCrouch)} />
                    <InfoRow label="mantle" value={yesNo(selectedDef.traversal.requiresMantle)} />
                    <InfoRow label="vehGrip×" value={fmtNum(selectedDef.traversal.vehicleGripMultiplier)} />

                    <Section title="COVER" />
                    <InfoRow label="height" value={selectedDef.cover.height} />
                    <InfoRow label="protection" value={fmtNum(selectedDef.cover.protection)} />
                    <InfoRow label="concealment" value={fmtNum(selectedDef.cover.concealment)} />
                    <InfoRow label="shootOver" value={yesNo(selectedDef.cover.shootOver)} />
                    <InfoRow label="leanAround" value={yesNo(selectedDef.cover.leanAround)} />
                    <InfoRow label="crouchReq" value={yesNo(selectedDef.cover.crouchRequired)} />

                    <Section title="VISIBILITY" />
                    <InfoRow label="opacity" value={fmtNum(selectedDef.visibility.opacity)} />
                    <InfoRow label="concealment" value={fmtNum(selectedDef.visibility.concealment)} />
                    <InfoRow label="lightTrans" value={fmtNum(selectedDef.visibility.lightTransmission)} />
                    <InfoRow label="soundOcc" value={fmtNum(selectedDef.visibility.soundOcclusion)} />
                    <InfoRow label="blocksLoS" value={yesNo(selectedDef.visibility.blocksLineOfSight)} />

                    <Section title="NPC" />
                    <InfoRow label="traversable" value={yesNo(selectedDef.npc.traversable)} />
                    <InfoRow label="walkCost" value={fmtNum(selectedDef.npc.walkCost)} />
                    <InfoRow label="runCost" value={fmtNum(selectedDef.npc.runCost)} />
                    <InfoRow label="vehicleCost" value={fmtNum(selectedDef.npc.vehicleCost)} />
                    <InfoRow label="prefByVeh" value={yesNo(selectedDef.npc.preferredByVehicles)} />
                    <InfoRow label="cover" value={selectedDef.npc.cover} />
                    <InfoRow label="noise" value={fmtNum(selectedDef.npc.noise)} />

                    {selectedDef.door.isDoor ? (
                      <Box style={{ gap: 6 }}>
                        <Section title="DOOR" />
                        <InfoRow label="defaultState" value={selectedDef.door.defaultState} />
                        <InfoRow label="interaction" value={selectedDef.door.interaction} />
                        <InfoRow label="width m" value={fmtNum(selectedDef.door.widthMeters)} />
                        <InfoRow label="blockMoveClosed" value={yesNo(selectedDef.door.blocksMovementWhenClosed)} />
                        <InfoRow label="blockLoSClosed" value={yesNo(selectedDef.door.blocksLineOfSightWhenClosed)} />
                        <InfoRow label="vehPassable" value={yesNo(selectedDef.door.vehiclePassable)} />
                        <InfoRow label="openCost" value={fmtNum(selectedDef.door.openCost)} />
                      </Box>
                    ) : null}

                    <Section title="RENDER" />
                    <InfoRow label="color" value={selectedDef.render.color} />
                    <InfoRow label="height m" value={fmtNum(selectedDef.render.heightMeters)} />
                    <InfoRow label="texture" value={selectedDef.render.textureKey} />
                  </Box>
                ) : (
                  <Text fontSize={11} color="#64748b" style={{ fontFamily: 'monospace' }}>void — no tile at this cell</Text>
                )}
              </Box>
            ) : (
              <Text fontSize={11} color="#64748b" style={{ fontFamily: 'monospace' }}>click a tile to inspect</Text>
            )}

            <Box style={{ height: 1, backgroundColor: '#1e293b', marginTop: 6 }} />
            <Text fontSize={12} color="#e2e8f0" style={{ fontWeight: 800 }}>LIVE PLAYER</Text>
            <Box style={{ gap: 6 }}>
              <InfoRow label="x" value={player.position.x.toFixed(2)} />
              <InfoRow label="y" value={player.position.y.toFixed(2)} />
              <InfoRow label="z" value={player.position.z.toFixed(2)} />
              <InfoRow label="yaw°" value={player.yawDegrees.toFixed(1)} />
            </Box>
          </ScrollView>
        </Box>
      </Box>
    </Box>
  );
}
