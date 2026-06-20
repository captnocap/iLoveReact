// PainterRail — ONE left rail of composable cards (PAINTER-0610, req_0593).
//
// The rail no longer swaps wholesale per layer (the old BrushRail / PlaceRail /
// RoadRail trio): it is the same instrument exposing different controls for the
// active target and the current selection.
//
//   ToolCard                 — Select / Paint / Erase, universal (dims per target)
//   BrushCard                — footprint shape + radius (brush-driven targets)
//   PaintSection             — tile palette            (target: tile)
//   TerrainCard              — raise/ramp/slope/smooth (target: terrain)
//   ZoneSection              — zone list + flags       (target: zone)
//   ObjectBrushCard          — armed object + recent   (target: object)
//   RoadRail                 — profile/draft/list      (target: road)
//   ObjectInspectorCard      — the SELECTED placement  (any target, selection-driven)

import { Box, Pressable, ScrollView, Text } from '@reactjit/primitives';
import type { TileKind } from './design';
import type { BrushShape } from './brush';
import { ChipGrid, RailLabel, SizeSlider, ToolBtn } from './railAtoms';
import { HeightSection, PaintSection, ZoneSection, type BrushRailSettings } from './BrushRail';
import { RoadRail } from './RoadRail';
import { painterToolUsable } from './painterBehavior';
import type { Layer, PlaceProps, Tool } from './PaintCanvas';
import type { Placement } from './placements';
import type { MapBuildFootprint } from './mapBuildPlacements';
import type { ZoneDef } from './zoneData';
import type { RoadProfile, RoadStroke } from './roadData';

const SIZE_MIN = 0, SIZE_MAX = 40;
const ROT_STEP = 15; // degrees per rotate tap

const SHAPES: { id: BrushShape; label: string; hint: string }[] = [
  { id: 'circle', label: 'circle', hint: 'o' },
  { id: 'square', label: 'square', hint: '[]' },
  { id: 'diamond', label: 'diamond', hint: '<>' },
];

const TERRAIN_MODES = [
  { id: 'brush', label: 'raise', hint: '^' },
  { id: 'ramp', label: 'ramp', hint: '/' },
  { id: 'slope', label: 'slope', hint: '~' },
  { id: 'smooth', label: 'smooth', hint: 's' },
  { id: 'water', label: 'water', hint: 'w' },
  { id: 'waterSlope', label: 'shore', hint: '≈' },
];

// Select / Paint / Erase — the whole tool surface, on every target. Erase is
// universal (PAINTER-0610): tiles/zones clear, terrain lowers, objects under the
// brush delete, the road stroke under a click deletes. A tool the target can't
// use right now (Paint on Object with nothing armed) renders dimmed.
function ToolCard(props: {
  tool: Tool;
  target: Layer;
  placeArmed: boolean;
  brushMode: BrushRailSettings['mode'];
  onTool: (t: Tool) => void;
  onBrushChange: (p: Partial<BrushRailSettings>) => void;
  grid: boolean;
  onGrid: (v: boolean) => void;
}) {
  const erasing = props.tool === 'eraser' || (props.tool === 'brush' && props.brushMode === 'erase');
  const entries: { tool: Tool; icon: string; label: string; active: boolean; press: () => void }[] = [
    { tool: 'pointer', icon: 'MousePointer', label: 'select', active: props.tool === 'pointer', press: () => props.onTool('pointer') },
    { tool: 'brush', icon: 'Brush', label: 'paint', active: props.tool === 'brush' && !erasing, press: () => { props.onTool('brush'); props.onBrushChange({ mode: 'paint' }); } },
    { tool: 'eraser', icon: 'Eraser', label: 'erase', active: erasing, press: () => { props.onTool('eraser'); props.onBrushChange(props.target === 'height' ? { mode: 'erase', heightMode: 'brush' } : { mode: 'erase' }); } },
  ];
  return (
    <Box style={{ flexDirection: 'row', gap: 5 }}>
      {entries.map((e) => {
        const usable = painterToolUsable(e.tool, props.target, props.placeArmed);
        return (
          <Box key={e.tool} style={{ alignItems: 'center', gap: 2, opacity: usable ? 1 : 0.35 }}>
            <ToolBtn icon={e.icon} active={e.active} onPress={usable ? e.press : () => {}} />
            <Text fontSize={7} color={e.active ? '#f8fafc' : '#64748b'} style={{ fontFamily: 'monospace' }}>{e.label}</Text>
          </Box>
        );
      })}
      <Box style={{ flexGrow: 1 }} />
      {/* The canvas grid toggle — a VIEW preference, parked at the row's edge
          (came home from the retired SettingsTab; the canvas owns its view). */}
      <Box style={{ alignItems: 'center', gap: 2 }}>
        <ToolBtn icon="Grid3x3" active={props.grid} onPress={() => props.onGrid(!props.grid)} />
        <Text fontSize={7} color={props.grid ? '#f8fafc' : '#64748b'} style={{ fontFamily: 'monospace' }}>grid</Text>
      </Box>
    </Box>
  );
}

// Footprint + radius — the brush is ONE brush; the target decides what a stamp
// edits. Picking a shape exits a terrain ramp/slope/smooth mode back to raise.
function BrushCard(props: {
  brush: BrushRailSettings;
  dim: boolean;
  onBrushChange: (p: Partial<BrushRailSettings>) => void;
}) {
  return (
    <Box style={{ gap: 5 }}>
      <RailLabel text="brush" />
      <ChipGrid
        items={SHAPES}
        value={props.brush.shape}
        onPick={(id) => props.onBrushChange({ shape: id as BrushShape, heightMode: 'brush' })}
        dim={props.dim}
      />
      <SizeSlider size={props.brush.size} min={SIZE_MIN} max={SIZE_MAX} onSize={(size) => props.onBrushChange({ size })} />
    </Box>
  );
}

// Terrain: the height-edit mode picker + that mode's controls (HeightSection
// branches internally: raise sliders / ramp steppers / slope / smooth).
function TerrainCard(props: {
  brush: BrushRailSettings;
  onBrushChange: (p: Partial<BrushRailSettings>) => void;
  onClearHeights: () => void;
}) {
  return (
    <Box style={{ gap: 5 }}>
      <RailLabel text="terrain" />
      <ChipGrid
        items={TERRAIN_MODES}
        value={props.brush.heightMode}
        onPick={(id) => props.onBrushChange(id === 'brush' ? { heightMode: 'brush' } : { heightMode: id as BrushRailSettings['heightMode'], mode: 'paint' })}
      />
      <HeightSection brush={props.brush} onPatch={props.onBrushChange} onClear={props.onClearHeights} />
    </Box>
  );
}

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

// The armed object + rotation + recently-used grid (target: object, Paint tool).
function ObjectBrushCard(props: { place: PlaceProps; onTool: (t: Tool) => void }) {
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
  return (
    <Box style={{ gap: 5 }}>
      <RailLabel text="object" />
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
}

// The SELECTED placement / build piece — selection-driven, mounts on ANY target
// (the universal Select can pick an object from anywhere).
function ObjectInspectorCard(props: { sel: Placement | null; buildSel: MapBuildFootprint | null; place: PlaceProps }) {
  const { sel, buildSel } = props;
  if (buildSel) {
    return (
      <Box style={{ gap: 6 }}>
        <Box style={{ height: 1, backgroundColor: '#1e293b' }} />
        <Text fontSize={8} color="#cbd5e1" style={{ fontFamily: 'monospace' }}>{buildSel.label}</Text>
        <Text fontSize={8} color="#64748b" style={{ fontFamily: 'monospace' }}>{`${buildSel.pieceIds.length} build pieces`}</Text>
        <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
          <ToolBtn icon="Trash2" active={false} onPress={() => props.place.onDeleteBuild?.(buildSel.id)} />
        </Box>
      </Box>
    );
  }
  if (!sel) return null;
  const set = (patch: Partial<Placement>) => props.place.onUpdate(sel.id, patch);
  return (
    <Box style={{ gap: 6 }}>
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

/** Everything RoadRail needs, bundled so PainterRail's prop list stays flat. */
export interface RoadCardProps {
  profile: RoadProfile;
  onProfile: (patch: Partial<RoadProfile>) => void;
  editingLabel: string | null;
  draftCount: number;
  onFinish: () => void;
  onCancel: () => void;
  onUndoPoint: () => void;
  roads: RoadStroke[];
  selId: string | null;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => void;
  onName: (name: string) => void;
  wires: boolean;
  onWires: (on: boolean) => void;
  arrows: boolean;
  onArrows: (on: boolean) => void;
}

export function PainterRail(props: {
  tool: Tool;
  onTool: (t: Tool) => void;
  target: Layer;
  tile: TileKind;
  onTile: (k: TileKind) => void;
  brush: BrushRailSettings;
  onBrushChange: (p: Partial<BrushRailSettings>) => void;
  onClearHeights: () => void;
  zones: ZoneDef[];
  activeZone: number;
  onActiveZone: (i: number) => void;
  onAddZone: () => void;
  onUpdateZone: (i: number, patch: Partial<ZoneDef>) => void;
  onDeleteZone: (i: number) => void;
  place: PlaceProps;
  selPlacement: Placement | null;
  selBuild: MapBuildFootprint | null;
  road: RoadCardProps;
  grid: boolean;
  onGrid: (v: boolean) => void;
}) {
  const { target, tool } = props;
  const onPaint = () => { props.onBrushChange({ mode: 'paint' }); props.onTool('brush'); };
  // The brush footprint matters wherever a stroke sweeps cells — including the
  // object eraser (its delete radius IS the brush radius). Road clicks and the
  // object stamp (footprint = the object) don't use it.
  const usesBrush = target === 'paint' || target === 'zone' || target === 'height' || (target === 'place' && tool === 'eraser');
  const inspector = <ObjectInspectorCard sel={props.selPlacement} buildSel={props.selBuild} place={props.place} />;

  return (
    <Box style={{ width: '100%', height: '100%', gap: 7 }}>
      <ToolCard tool={tool} target={target} placeArmed={!!props.place.active} brushMode={props.brush.mode} onTool={props.onTool} onBrushChange={props.onBrushChange} grid={props.grid} onGrid={props.onGrid} />
      <Box style={{ height: 1, backgroundColor: '#1e293b' }} />
      {target === 'road' ? (
        <>
          {/* RoadRail owns the remaining height (its roads list scrolls itself). */}
          <RoadRail tool={tool} {...props.road} />
          {inspector}
        </>
      ) : (
        <ScrollView showScrollbar style={{ width: '100%', flexGrow: 1, minHeight: 0 }} contentContainerStyle={{ gap: 7, paddingBottom: 10 }}>
          {usesBrush ? <BrushCard brush={props.brush} dim={props.brush.mode === 'erase' || tool === 'eraser'} onBrushChange={props.onBrushChange} /> : null}
          {target === 'paint' ? <PaintSection tile={props.tile} onTile={props.onTile} onPaint={onPaint} /> : null}
          {target === 'height' ? <TerrainCard brush={props.brush} onBrushChange={props.onBrushChange} onClearHeights={props.onClearHeights} /> : null}
          {target === 'zone' ? <ZoneSection zones={props.zones} activeZone={props.activeZone} onActiveZone={props.onActiveZone} onAddZone={props.onAddZone} onUpdateZone={props.onUpdateZone} onDeleteZone={props.onDeleteZone} onPaint={onPaint} /> : null}
          {target === 'place' && tool !== 'eraser' ? <ObjectBrushCard place={props.place} onTool={props.onTool} /> : null}
          {inspector}
        </ScrollView>
      )}
    </Box>
  );
}
