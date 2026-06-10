import { useEffect, useMemo, useRef, useState } from 'react';
import { busOn } from '@reactjit/hooks/useIFTTT';
import { Box, Pressable, ScrollView, Text, TextInput } from '@reactjit/primitives';
import type {
  BuildingEnclosure,
  BuildingSkin,
  GameState,
  PropKind,
  TileKind,
  ZoneFlag,
} from '../hmsc-int/design';
import { BUILDING_KINDS, buildingKindDefinition } from '../hmsc-int/world/buildingKinds';
import { PROP_KINDS, propKindDefinition } from '../hmsc-int/world/propKinds';
import { TILE_KINDS, tileKindDefinition } from '../hmsc-int/world/tileKinds';
import { ZONE_FLAGS } from '../hmsc-int/world/zones';
import { tileKindAtCell } from '../hmsc-int/world/grid';
import { setBuildingFaceSkin } from '../hmsc-int/world/buildings';
import { swatchColorForId } from '../hmsc-int/world/placeables';
import {
  loadEditorWorld,
  compileEditorWorld,
  resetEditorWorld,
  placeBuilding,
  removeBuilding,
  buildingFootprintBlocked,
  placeWorldProp,
  removeWorldProp,
  propNearPoint,
  fillTiles,
  defineZone,
} from './editorWorld';
import { MapCanvas, MIN_PIXELS_PER_TILE, MAX_PIXELS_PER_TILE, ZOOM_STEP, type MapView, type CellRect, type DragMode, type Ghost } from './MapCanvas';
import { IsoPreview, type IsoView } from './IsoPreview';
import { cellAddress, chunkOfCell, parseAddress } from './address';
import { FACE_ROLES, SKIN_NAMES, buildingAtCell, currentFaceSkins } from './buildingEditor';

// hmsc-int is the world EDITOR. It authors a real GameState — the same record the
// game boots from — and "compile" persists it to the shared 'hmsc'/'game-state'
// key (one storage root across carts), so the game loads exactly what you built.
// No wv_* copy-paste: every tool calls the game's own world mutators on a staged
// GameState, so an authored building/prop/zone/tile is identical to one the game
// made. Author top-down in 2D (left), preview live in iso-3D (right), compile.

type Tool = 'inspect' | 'tile' | 'building' | 'prop' | 'zone' | 'bulldoze';

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'inspect', label: 'Inspect', hint: 'click a cell or building' },
  { id: 'tile', label: 'Tile', hint: 'drag a rectangle to fill ground' },
  { id: 'building', label: 'Building', hint: 'click to place (ghost shows fit)' },
  { id: 'prop', label: 'Prop', hint: 'click to place street furniture' },
  { id: 'zone', label: 'Zone', hint: 'drag a rectangle, name it' },
  { id: 'bulldoze', label: 'Bulldoze', hint: 'click a building or prop to remove' },
];

const ENCLOSURES: BuildingEnclosure[] = ['sealed', 'hollow', 'interior'];

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '-∞';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// World bounds from the surface regions, for the initial fit + iso center.
function worldBounds(state: GameState) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const r of state.world.surfaceRegions) {
    minX = Math.min(minX, r.x); minZ = Math.min(minZ, r.z);
    maxX = Math.max(maxX, r.x + r.width); maxZ = Math.max(maxZ, r.z + r.depth);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minZ: 0, maxX: 1, maxZ: 1 };
  return { minX, minZ, maxX, maxZ };
}

function InfoRow(props: { label: string; value: string }) {
  return (
    <Box style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text fontSize={11} color="#64748b" style={{ fontFamily: 'monospace', flexShrink: 0 }}>{props.label}</Text>
      <Text fontSize={11} color="#e2e8f0" style={{ fontFamily: 'monospace', flexShrink: 1, textAlign: 'right' }}>{props.value}</Text>
    </Box>
  );
}

function Chip(props: { label: string; active: boolean; onPress: () => void; color?: string; small?: boolean }) {
  return (
    <Pressable
      onPress={props.onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 5,
        paddingVertical: props.small ? 3 : 5, paddingHorizontal: props.small ? 6 : 9,
        borderRadius: 5, borderWidth: props.active ? 2 : 1,
        borderColor: props.active ? '#f8fafc' : '#334155', backgroundColor: props.active ? '#1e293b' : '#0f1a2e',
      }}
    >
      {props.color ? <Box style={{ width: 11, height: 11, borderRadius: 2, backgroundColor: props.color }} /> : null}
      <Text fontSize={props.small ? 9 : 10} color="#cbd5e1" style={{ fontWeight: props.active ? 700 : 500 }}>{props.label}</Text>
    </Pressable>
  );
}

function Btn(props: { label: string; onPress: () => void; disabled?: boolean; tone?: 'default' | 'go' | 'danger' }) {
  const tone = props.tone ?? 'default';
  const bg = props.disabled ? '#0f1a2e' : tone === 'go' ? '#0f3d2e' : tone === 'danger' ? '#3d1414' : '#0f1a2e';
  const border = props.disabled ? '#1e293b' : tone === 'go' ? '#22c55e' : tone === 'danger' ? '#ef4444' : '#334155';
  const color = props.disabled ? '#475569' : tone === 'go' ? '#86efac' : tone === 'danger' ? '#fca5a5' : '#cbd5e1';
  return (
    <Pressable
      onPress={() => { if (!props.disabled) props.onPress(); }}
      style={{ flexGrow: 1, paddingVertical: 6, borderRadius: 5, alignItems: 'center', borderWidth: 1, borderColor: border, backgroundColor: bg }}
    >
      <Text fontSize={11} color={color} style={{ fontWeight: 700 }}>{props.label}</Text>
    </Pressable>
  );
}

export default function HmscWorldEditorCart() {
  // The staged world IS a GameState — the same shape the game boots from. Every
  // tool mutates it through the game's own mutators; compile persists it.
  const [world, setWorld] = useState<GameState>(loadEditorWorld);
  const [tool, setTool] = useState<Tool>('inspect');
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string>('loaded world');

  // In-memory undo stack of whole-world snapshots (compile is the durable save).
  const undoRef = useRef<GameState[]>([]);
  const [undoDepth, setUndoDepth] = useState(0);

  // Tool selections.
  const [tileKind, setTileKind] = useState<TileKind>('sidewalk');
  const [buildingKind, setBuildingKind] = useState<typeof BUILDING_KINDS[number]>('house');
  const [enclosure, setEnclosure] = useState<BuildingEnclosure>('hollow');
  const [forcePlace, setForcePlace] = useState(false);
  const [propKind, setPropKind] = useState<PropKind>('fireHydrant');
  const [zoneName, setZoneName] = useState('District');
  const [zoneFlags, setZoneFlags] = useState<ZoneFlag[]>([]);

  // Selection + hover.
  const [selected, setSelected] = useState<{ x: number; z: number } | null>(null);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const hoverRef = useRef<{ x: number; z: number } | null>(null);
  const [hover, setHover] = useState<{ x: number; z: number } | null>(null);

  // View (shared anchor for the 2D map + iso preview).
  const [view, setView] = useState<MapView>(() => {
    const b = worldBounds(loadEditorWorld());
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 1);
    return { centerX: (b.minX + b.maxX) / 2, centerZ: (b.minZ + b.maxZ) / 2, pixelsPerTile: clamp(612 / span, MIN_PIXELS_PER_TILE, MAX_PIXELS_PER_TILE) };
  });
  const [isoYaw, setIsoYaw] = useState(45);
  const [gotoText, setGotoText] = useState('');

  // ── Staging helpers ────────────────────────────────────────────────────────
  // Every mutation snapshots first (undo), applies, and marks dirty.
  const mutate = (next: GameState, note: string) => {
    undoRef.current = [...undoRef.current.slice(-49), world];
    setUndoDepth(undoRef.current.length);
    setWorld(next);
    setDirty(true);
    setStatus(note);
  };
  const undo = () => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    setUndoDepth(undoRef.current.length);
    setWorld(prev);
    setDirty(true);
    setStatus('undo');
  };

  const compile = () => {
    const saved = compileEditorWorld(world);
    setWorld(saved);
    setDirty(false);
    setStatus(`compiled → game boots this world (${saved.world.buildings.length} buildings, ${saved.world.props.length} props)`);
  };
  const reset = () => {
    const fresh = resetEditorWorld();
    undoRef.current = [...undoRef.current.slice(-49), world];
    setUndoDepth(undoRef.current.length);
    setWorld(fresh);
    setDirty(true);
    setStatus('reset to demo world (compile to make it the booted world)');
  };

  // Keyboard zoom, mirroring the game's +/- feel.
  useEffect(() => busOn('__keydown', (event: any) => {
    const key = String(event?.key ?? '').toLowerCase();
    if (key === '=' || key === '+') setView((v) => ({ ...v, pixelsPerTile: clamp(v.pixelsPerTile * ZOOM_STEP, MIN_PIXELS_PER_TILE, MAX_PIXELS_PER_TILE) }));
    if (key === '-' || key === '_') setView((v) => ({ ...v, pixelsPerTile: clamp(v.pixelsPerTile / ZOOM_STEP, MIN_PIXELS_PER_TILE, MAX_PIXELS_PER_TILE) }));
  }), []);

  // ── Tool → gesture wiring ────────────────────────────────────────────────
  const dragMode: DragMode = tool === 'tile' || tool === 'zone' ? 'rect' : tool === 'inspect' || tool === 'building' || tool === 'prop' || tool === 'bulldoze' ? 'pan' : 'pan';

  const buildingFootprintAt = (cell: { x: number; z: number }) => {
    const def = buildingKindDefinition(buildingKind);
    const w = def.defaultWidthTiles;
    const d = def.defaultDepthTiles;
    return { x: cell.x - Math.floor(w / 2), z: cell.z - Math.floor(d / 2), width: w, depth: d };
  };

  // Ghost for the placement tools, colored by validity at the hovered cell.
  let ghost: Ghost = null;
  if (hover && tool === 'building') {
    const fp = buildingFootprintAt(hover);
    const blocked = buildingFootprintBlocked(world, { x: fp.x, z: fp.z, widthTiles: fp.width, depthTiles: fp.depth });
    ghost = { rect: fp, ok: !blocked };
  } else if (hover && tool === 'prop') {
    ghost = { rect: { x: hover.x, z: hover.z, width: 1, depth: 1 }, ok: true };
  }

  const onHover = (cell: { x: number; z: number }) => {
    const prev = hoverRef.current;
    hoverRef.current = cell;
    // Only re-render on hover for tools that draw a ghost, and only when the cell
    // actually changes — a same-cell mouse move must not churn the 3D preview.
    if ((tool === 'building' || tool === 'prop') && (!prev || prev.x !== cell.x || prev.z !== cell.z)) setHover(cell);
  };

  const onTap = (cell: { x: number; z: number }) => {
    if (tool === 'inspect') {
      setSelected(cell);
      const b = buildingAtCell(world.world.buildings, cell.x, cell.z);
      setSelectedBuildingId(b ? b.id : null);
      return;
    }
    if (tool === 'building') {
      const fp = buildingFootprintAt(cell);
      const result = placeBuilding(world, {
        kind: buildingKind, x: fp.x, z: fp.z, enclosure, force: forcePlace,
      });
      if (result.ok) {
        mutate(result.state, `placed ${result.building.kind} ${result.building.id} @ ${cellAddress(fp.x, fp.z)}`);
        setSelectedBuildingId(result.building.id);
      } else {
        setStatus(`can't place: ${result.reason}`);
      }
      return;
    }
    if (tool === 'prop') {
      const { state, prop } = placeWorldProp(world, { kind: propKind, x: cell.x + 0.5, z: cell.z + 0.5 });
      mutate(state, `placed ${prop.kind} ${prop.id} @ ${cellAddress(cell.x, cell.z)}`);
      return;
    }
    if (tool === 'bulldoze') {
      const b = buildingAtCell(world.world.buildings, cell.x, cell.z);
      if (b) { mutate(removeBuilding(world, b.id), `removed building ${b.id}`); return; }
      const p = propNearPoint(world, cell.x + 0.5, cell.z + 0.5, 2);
      if (p) { mutate(removeWorldProp(world, p.id), `removed prop ${p.id}`); return; }
      setStatus('nothing to bulldoze here');
      return;
    }
  };

  const onRectCommit = (rect: CellRect) => {
    if (tool === 'tile') {
      mutate(fillTiles(world, { kind: tileKind, x: rect.x, z: rect.z, width: rect.width, depth: rect.depth }), `filled ${tileKind} ${rect.width}×${rect.depth} @ ${cellAddress(rect.x, rect.z)}`);
      return;
    }
    if (tool === 'zone') {
      mutate(defineZone(world, { name: zoneName.trim() || 'Zone', x: rect.x, z: rect.z, width: rect.width, depth: rect.depth, flags: zoneFlags }), `zone "${zoneName}" ${rect.width}×${rect.depth} @ ${cellAddress(rect.x, rect.z)}`);
      return;
    }
  };

  const goToAddress = () => {
    const parsed = parseAddress(gotoText);
    if (!parsed) { setStatus(`bad address "${gotoText}" — try e.g. DP119`); return; }
    setView((v) => ({ ...v, centerX: parsed.x + 0.5, centerZ: parsed.z + 0.5 }));
    setSelected(parsed);
    setStatus(`jumped to ${cellAddress(parsed.x, parsed.z)}`);
  };

  // Apply a face skin directly to the staged building (no command emit).
  const setFace = (role: typeof FACE_ROLES[number], skin: BuildingSkin) => {
    if (!selectedBuildingId) return;
    mutate(setBuildingFaceSkin(world, selectedBuildingId, role, skin), `${selectedBuildingId} ${role} = ${skin}`);
  };

  // Iso preview follows the map center; dist scales inversely with zoom so the
  // preview frames the same area you're editing. Memoized so the 3D preview's memo
  // holds across unrelated re-renders (hover, tool switches) — only an actual
  // center/yaw/zoom change re-solves the camera.
  const isoView: IsoView = useMemo(() => ({
    centerX: view.centerX,
    centerZ: view.centerZ,
    yawDegrees: isoYaw,
    distMeters: clamp(900 / view.pixelsPerTile, 24, 320),
  }), [view.centerX, view.centerZ, view.pixelsPerTile, isoYaw]);

  // ── Derived inspector data ──────────────────────────────────────────────
  const selKind = selected ? tileKindAtCell(world, { x: selected.x, y: 0, z: selected.z }) ?? null : null;
  const selDef = selKind ? tileKindDefinition(selKind) : null;
  const selectedBuilding = selectedBuildingId ? world.world.buildings.find((b) => b.id === selectedBuildingId) ?? null : null;
  const faceNow = selectedBuilding ? currentFaceSkins(selectedBuilding) : null;

  const activeHint = TOOLS.find((t) => t.id === tool)?.hint ?? '';

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#080d16', flexDirection: 'column' }}>
      {/* Top bar: title + tool belt + actions. */}
      <Box style={{ paddingLeft: 14, paddingRight: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1f2937', backgroundColor: '#111827', gap: 8 }}>
        <Box style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text fontSize={14} color="#f8fafc" style={{ fontWeight: 800 }}>HMSC WORLD EDITOR</Text>
            <Text fontSize={10} color={dirty ? '#fbbf24' : '#475569'} style={{ fontFamily: 'monospace' }}>{dirty ? '● uncompiled' : '○ compiled'}</Text>
          </Box>
          <Box style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <TextInput text={gotoText} onChangeText={setGotoText} placeholder="goto DP119" style={{ width: 96, backgroundColor: '#0f1a2e', borderWidth: 1, borderColor: '#334155', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3, color: '#e2e8f0', fontSize: 11 }} />
              <Pressable onPress={goToAddress} style={{ paddingVertical: 4, paddingHorizontal: 8, borderRadius: 4, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f1a2e' }}>
                <Text fontSize={10} color="#cbd5e1">Go</Text>
              </Pressable>
            </Box>
            <Pressable onPress={undo} style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 5, borderWidth: 1, borderColor: undoDepth ? '#334155' : '#1e293b', backgroundColor: '#0f1a2e' }}>
              <Text fontSize={10} color={undoDepth ? '#cbd5e1' : '#475569'} style={{ fontWeight: 700 }}>{`Undo (${undoDepth})`}</Text>
            </Pressable>
            <Pressable onPress={reset} style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 5, borderWidth: 1, borderColor: '#7f1d1d', backgroundColor: '#3d1414' }}>
              <Text fontSize={10} color="#fca5a5" style={{ fontWeight: 700 }}>Reset</Text>
            </Pressable>
            <Pressable onPress={compile} style={{ paddingVertical: 5, paddingHorizontal: 14, borderRadius: 5, borderWidth: 1, borderColor: '#22c55e', backgroundColor: dirty ? '#0f3d2e' : '#0f1a2e' }}>
              <Text fontSize={11} color={dirty ? '#86efac' : '#4ade80'} style={{ fontWeight: 800, letterSpacing: 1 }}>COMPILE</Text>
            </Pressable>
          </Box>
        </Box>
        <Box style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}>
          {TOOLS.map((t) => (
            <Chip key={t.id} label={t.label} active={tool === t.id} onPress={() => setTool(t.id)} />
          ))}
          <Text fontSize={10} color="#64748b" style={{ fontFamily: 'monospace', marginLeft: 8 }}>{activeHint}</Text>
        </Box>
      </Box>

      <Box style={{ flexGrow: 1, flexDirection: 'row', minHeight: 0 }}>
        {/* 2D placement canvas. */}
        <MapCanvas
          state={world}
          view={view}
          onView={setView}
          selected={selected}
          dragMode={dragMode}
          ghost={ghost}
          onTap={onTap}
          onPaintCell={undefined}
          onRectCommit={onRectCommit}
          onHover={onHover}
        />

        {/* Right column: iso preview + tool panel + inspector. */}
        <Box style={{ width: 360, backgroundColor: '#0b1424', borderLeftWidth: 1, borderLeftColor: '#1e293b', flexDirection: 'column', minHeight: 0 }}>
          {/* Live iso-3D preview of the staged world (the game's own renderer). */}
          <Box style={{ height: 280, borderBottomWidth: 1, borderBottomColor: '#1e293b', position: 'relative' }}>
            <IsoPreview state={world} view={isoView} />
            <Box style={{ position: 'absolute', left: 8, top: 8, flexDirection: 'row', gap: 4 }}>
              <Pressable onPress={() => setIsoYaw((y) => y - 45)} style={{ width: 26, height: 22, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b1424cc', borderWidth: 1, borderColor: '#334155' }}>
                <Text fontSize={11} color="#cbd5e1">↺</Text>
              </Pressable>
              <Pressable onPress={() => setIsoYaw((y) => y + 45)} style={{ width: 26, height: 22, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b1424cc', borderWidth: 1, borderColor: '#334155' }}>
                <Text fontSize={11} color="#cbd5e1">↻</Text>
              </Pressable>
            </Box>
            <Text fontSize={9} color="#475569" style={{ fontFamily: 'monospace', position: 'absolute', right: 8, top: 10 }}>preview · yaw {isoYaw % 360}°</Text>
          </Box>

          <ScrollView style={{ flexGrow: 1, height: '100%' }} contentContainerStyle={{ padding: 14, gap: 10 }}>
            {/* Per-tool panel. */}
            {tool === 'tile' ? (
              <Box style={{ gap: 6 }}>
                <Text fontSize={12} color="#e2e8f0" style={{ fontWeight: 800 }}>TILE FILL</Text>
                <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                  {TILE_KINDS.map((k) => (
                    <Chip key={k} small label={tileKindDefinition(k).label} active={tileKind === k} color={tileKindDefinition(k).render.color} onPress={() => setTileKind(k)} />
                  ))}
                </Box>
                <Text fontSize={9} color="#64748b" style={{ fontFamily: 'monospace' }}>drag a rectangle on the map to fill it with {tileKind}</Text>
              </Box>
            ) : null}

            {tool === 'building' ? (
              <Box style={{ gap: 6 }}>
                <Text fontSize={12} color="#e2e8f0" style={{ fontWeight: 800 }}>BUILDING</Text>
                <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                  {BUILDING_KINDS.map((k) => (
                    <Chip key={k} small label={buildingKindDefinition(k).label} active={buildingKind === k} color={swatchColorForId(`building:${k}`)} onPress={() => setBuildingKind(k)} />
                  ))}
                </Box>
                <Box style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
                  <Text fontSize={9} color="#64748b">enclosure</Text>
                  {ENCLOSURES.map((e) => (
                    <Chip key={e} small label={e} active={enclosure === e} onPress={() => setEnclosure(e)} />
                  ))}
                </Box>
                <Chip label={forcePlace ? 'force: ON (ignore road/overlap rules)' : 'force: OFF (snap to road, no overlap)'} active={forcePlace} onPress={() => setForcePlace((f) => !f)} />
                <Text fontSize={9} color="#64748b" style={{ fontFamily: 'monospace' }}>
                  {(() => { const d = buildingKindDefinition(buildingKind); return `${d.defaultWidthTiles}×${d.defaultDepthTiles}m, ${d.storeys} storey — click to place`; })()}
                </Text>
              </Box>
            ) : null}

            {tool === 'prop' ? (
              <Box style={{ gap: 6 }}>
                <Text fontSize={12} color="#e2e8f0" style={{ fontWeight: 800 }}>PROP</Text>
                <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                  {PROP_KINDS.map((k) => (
                    <Chip key={k} small label={propKindDefinition(k).label} active={propKind === k} onPress={() => setPropKind(k)} />
                  ))}
                </Box>
                <Text fontSize={9} color="#64748b" style={{ fontFamily: 'monospace' }}>click to drop a {propKindDefinition(propKind).label}</Text>
              </Box>
            ) : null}

            {tool === 'zone' ? (
              <Box style={{ gap: 6 }}>
                <Text fontSize={12} color="#e2e8f0" style={{ fontWeight: 800 }}>ZONE</Text>
                <TextInput text={zoneName} onChangeText={setZoneName} style={{ backgroundColor: '#0f1a2e', borderWidth: 1, borderColor: '#334155', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 4, color: '#e2e8f0', fontSize: 11 }} />
                <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                  {ZONE_FLAGS.map((f) => (
                    <Chip key={f} small label={f} active={zoneFlags.includes(f)} onPress={() => setZoneFlags((prev) => prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f])} />
                  ))}
                </Box>
                <Text fontSize={9} color="#64748b" style={{ fontFamily: 'monospace' }}>drag a rectangle to define the zone</Text>
              </Box>
            ) : null}

            {tool === 'bulldoze' ? (
              <Box style={{ gap: 6 }}>
                <Text fontSize={12} color="#e2e8f0" style={{ fontWeight: 800 }}>BULLDOZE</Text>
                <Text fontSize={9} color="#64748b" style={{ fontFamily: 'monospace' }}>click a building or prop on the map to remove it</Text>
              </Box>
            ) : null}

            {/* Building face editor — appears whenever a building is selected. */}
            {selectedBuilding && faceNow ? (
              <Box style={{ gap: 6, borderTopWidth: 1, borderTopColor: '#1e293b', paddingTop: 10 }}>
                <Text fontSize={12} color="#e2e8f0" style={{ fontWeight: 800 }}>BUILDING FACES</Text>
                <InfoRow label="id" value={selectedBuilding.id} />
                <InfoRow label="kind" value={`${selectedBuilding.kind} (${selectedBuilding.enclosure})`} />
                <InfoRow label="door" value={selectedBuilding.doorSide} />
                <InfoRow label="at" value={cellAddress(Math.round(selectedBuilding.x), Math.round(selectedBuilding.z))} />
                {FACE_ROLES.map((role) => (
                  <Box key={role} style={{ gap: 3 }}>
                    <Box style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text fontSize={10} color="#38bdf8" style={{ fontWeight: 700, letterSpacing: 1 }}>{role.toUpperCase()}</Text>
                      <Text fontSize={9} color="#64748b" style={{ fontFamily: 'monospace' }}>{faceNow[role]}</Text>
                    </Box>
                    <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3 }}>
                      {SKIN_NAMES.map((skin) => (
                        <Chip key={skin} small label={skin} active={faceNow[role] === skin} onPress={() => setFace(role, skin as BuildingSkin)} />
                      ))}
                    </Box>
                  </Box>
                ))}
                <Btn label="Remove building" tone="danger" onPress={() => { mutate(removeBuilding(world, selectedBuilding.id), `removed ${selectedBuilding.id}`); setSelectedBuildingId(null); }} />
              </Box>
            ) : null}

            {/* Inspector — cell diagnostics (compact). */}
            {tool === 'inspect' && selected && !selectedBuilding ? (
              <Box style={{ gap: 6, borderTopWidth: 1, borderTopColor: '#1e293b', paddingTop: 10 }}>
                <Text fontSize={12} color="#e2e8f0" style={{ fontWeight: 800 }}>CELL</Text>
                <InfoRow label="address" value={cellAddress(selected.x, selected.z)} />
                <InfoRow label="cell" value={`${selected.x}, ${selected.z}`} />
                <InfoRow label="chunk" value={chunkOfCell(selected.x, selected.z).label} />
                {selDef ? (
                  <Box style={{ gap: 4 }}>
                    <InfoRow label="kind" value={selDef.label} />
                    <InfoRow label="walkable" value={selDef.pathing.walkable ? 'yes' : 'no'} />
                    <InfoRow label="cover" value={selDef.cover.height} />
                    <InfoRow label="blocksLoS" value={selDef.visibility.blocksLineOfSight ? 'yes' : 'no'} />
                    <InfoRow label="vehSpeed×" value={fmt(selDef.surface.vehicleSpeedMultiplier)} />
                    <InfoRow label="friction" value={fmt(selDef.surface.friction)} />
                  </Box>
                ) : (
                  <Text fontSize={11} color="#64748b" style={{ fontFamily: 'monospace' }}>void — no tile here</Text>
                )}
              </Box>
            ) : null}

            {/* World summary. */}
            <Box style={{ gap: 3, borderTopWidth: 1, borderTopColor: '#1e293b', paddingTop: 10 }}>
              <Text fontSize={10} color="#64748b" style={{ letterSpacing: 1, fontWeight: 700 }}>WORLD</Text>
              <InfoRow label="layout" value={`${world.world.layout.widthCells}×${world.world.layout.depthCells}`} />
              <InfoRow label="buildings" value={String(world.world.buildings.length)} />
              <InfoRow label="props" value={String(world.world.props.length)} />
              <InfoRow label="regions" value={String(world.world.surfaceRegions.length)} />
              <InfoRow label="zones" value={String(world.world.zones.length)} />
            </Box>
          </ScrollView>

          {/* Status line. */}
          <Box style={{ paddingVertical: 6, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: '#1e293b', backgroundColor: '#0a1120' }}>
            <Text fontSize={10} color="#94a3b8" style={{ fontFamily: 'monospace' }}>{status}</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
