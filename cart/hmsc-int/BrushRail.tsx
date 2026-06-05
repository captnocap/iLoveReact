import { Box, Pressable, ScrollView, Text, TextInput } from '@reactjit/primitives';
import type { TileKind, ZoneFlag } from '../hmsc/design';
import { TILE_KINDS, tileKindDefinition } from '../hmsc/world/tileKinds';
import { ZONE_FLAGS } from '../hmsc/world/zones';
import { HEIGHT_LIMIT, type BrushProfile } from './heightData';
import type { BrushMode, BrushShape } from './brush';
import { ChipGrid, MiniStepper, RailLabel, RailSlider, SizeSlider, Swatch, ToolBtn, RAIL_CELL } from './railAtoms';
import type { ZoneDef } from './zoneData';

type BrushLayer = 'paint' | 'height' | 'zone';
type Tool = 'pointer' | 'brush' | 'eraser';
type HeightMode = 'brush' | 'ramp';

export type BrushRailSettings = {
  size: number;
  mode: BrushMode;
  shape: BrushShape;
  profile: BrushProfile;
  centerZ: number;
  heightMode: HeightMode;
  rampMin: number;
  rampMax: number;
  rampWide: number;
  rampLong: number;
  rampAngle: number;
};

const SIZE_MIN = 0, SIZE_MAX = 40;
const Z_STEP = 1;
const RAMP_SIZE_MIN = 1, RAMP_SIZE_MAX = 120, RAMP_STEP = 1, ANGLE_STEP = 15;
const FLAG_TAG: Record<ZoneFlag, string> = { private: 'PV', safe: 'SF', hostile: 'HO', restricted: 'RS', interior: 'IN' };

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function wrapAngle(deg: number): number {
  return ((Math.round(deg) % 360) + 360) % 360;
}

const FOOTPRINTS: { id: BrushShape | 'ramp'; label: string; hint: string }[] = [
  { id: 'circle', label: 'circle', hint: 'o' },
  { id: 'square', label: 'square', hint: '[]' },
  { id: 'diamond', label: 'diamond', hint: '<>' },
  { id: 'ramp', label: 'ramp', hint: '/' },
];

const PROFILES: { id: BrushProfile; label: string; hint: string }[] = [
  { id: 'cone', label: 'cone', hint: '^' },
  { id: 'flat', label: 'flat', hint: '-' },
  { id: 'dome', label: 'dome', hint: ')' },
];

function ModeBar(props: {
  layer: BrushLayer;
  tool: Tool;
  mode: BrushMode;
  heightMode: HeightMode;
  onTool: (t: Tool) => void;
  onPatch: (p: Partial<BrushRailSettings>) => void;
}) {
  const setPaint = () => { props.onPatch({ mode: 'paint' }); if (props.layer !== 'height') props.onTool('brush'); };
  const setErase = () => { props.onPatch({ mode: 'erase', heightMode: props.layer === 'height' ? 'brush' : props.heightMode }); if (props.layer !== 'height') props.onTool('brush'); };
  const setSelect = () => props.onTool('pointer');
  const isSelect = props.layer !== 'height' && props.tool === 'pointer';
  return (
    <Box style={{ flexDirection: 'row', gap: 5 }}>
      {props.layer !== 'height' ? <ToolBtn icon="MousePointer" active={isSelect} onPress={setSelect} /> : null}
      <ToolBtn icon="Brush" active={!isSelect && props.mode === 'paint'} onPress={setPaint} />
      <ToolBtn icon="Eraser" active={!isSelect && props.mode === 'erase'} onPress={setErase} />
    </Box>
  );
}

function PaintSection(props: { tile: TileKind; onTile: (k: TileKind) => void; onPaint: () => void }) {
  return (
    <Box style={{ gap: 5 }}>
      <RailLabel text="tiles" />
      <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {TILE_KINDS.map((k) => <Swatch key={k} color={tileKindDefinition(k).render.color} active={props.tile === k} onPress={() => { props.onTile(k); props.onPaint(); }} />)}
      </Box>
    </Box>
  );
}

function RampSection(props: { brush: BrushRailSettings; onPatch: (p: Partial<BrushRailSettings>) => void }) {
  const b = props.brush;
  const set = props.onPatch;
  return (
    <Box style={{ gap: 5 }}>
      <RailLabel text="ramp" />
      <MiniStepper label="min z" value={b.rampMin.toFixed(1)} onDec={() => set({ rampMin: clamp(b.rampMin - Z_STEP, -HEIGHT_LIMIT, HEIGHT_LIMIT) })} onInc={() => set({ rampMin: clamp(b.rampMin + Z_STEP, -HEIGHT_LIMIT, HEIGHT_LIMIT) })} />
      <MiniStepper label="max z" value={b.rampMax.toFixed(1)} onDec={() => set({ rampMax: clamp(b.rampMax - Z_STEP, -HEIGHT_LIMIT, HEIGHT_LIMIT) })} onInc={() => set({ rampMax: clamp(b.rampMax + Z_STEP, -HEIGHT_LIMIT, HEIGHT_LIMIT) })} />
      <MiniStepper label="wide" value={`${Math.round(b.rampWide)}t`} onDec={() => set({ rampWide: clamp(b.rampWide - RAMP_STEP, RAMP_SIZE_MIN, RAMP_SIZE_MAX) })} onInc={() => set({ rampWide: clamp(b.rampWide + RAMP_STEP, RAMP_SIZE_MIN, RAMP_SIZE_MAX) })} />
      <MiniStepper label="long" value={`${Math.round(b.rampLong)}t`} onDec={() => set({ rampLong: clamp(b.rampLong - RAMP_STEP, RAMP_SIZE_MIN, RAMP_SIZE_MAX) })} onInc={() => set({ rampLong: clamp(b.rampLong + RAMP_STEP, RAMP_SIZE_MIN, RAMP_SIZE_MAX) })} />
      <MiniStepper label="angle" value={`${wrapAngle(b.rampAngle)}deg`} onDec={() => set({ rampAngle: wrapAngle(b.rampAngle - ANGLE_STEP) })} onInc={() => set({ rampAngle: wrapAngle(b.rampAngle + ANGLE_STEP) })} />
    </Box>
  );
}

function HeightSection(props: { brush: BrushRailSettings; onPatch: (p: Partial<BrushRailSettings>) => void; onClear: () => void }) {
  const b = props.brush;
  const dim = b.mode === 'erase';
  return (
    <Box style={{ gap: 6 }}>
      {b.heightMode === 'ramp' ? (
        <RampSection brush={b} onPatch={props.onPatch} />
      ) : (
        <>
          <RailLabel text="profile" />
          <ChipGrid items={PROFILES} value={b.profile} onPick={(profile) => props.onPatch({ profile: profile as BrushProfile })} dim={dim} />
          <RailSlider
            label="height"
            value={b.centerZ}
            min={-HEIGHT_LIMIT}
            max={HEIGHT_LIMIT}
            step={0.5}
            valueText="z"
            formatDraft={(n) => n.toFixed(1)}
            inputWidth={42}
            onValue={(centerZ) => props.onPatch({ centerZ: clamp(centerZ, -HEIGHT_LIMIT, HEIGHT_LIMIT) })}
          />
        </>
      )}
      <Pressable onPress={props.onClear} style={{ alignItems: 'center', paddingTop: 4, paddingBottom: 4, borderRadius: 4, borderWidth: 1, borderColor: '#7f1d1d', backgroundColor: '#3d1414' }}>
        <Text fontSize={8} color="#fca5a5" style={{ fontWeight: 700 }}>clear focused</Text>
      </Pressable>
    </Box>
  );
}

function ZoneSection(props: {
  zones: ZoneDef[];
  activeZone: number;
  onActiveZone: (i: number) => void;
  onAddZone: () => void;
  onUpdateZone: (i: number, patch: Partial<ZoneDef>) => void;
  onDeleteZone: (i: number) => void;
  onPaint: () => void;
}) {
  const z = props.zones[props.activeZone];
  return (
    <Box style={{ gap: 6 }}>
      <RailLabel text="zones" />
      <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {props.zones.map((zz, i) => (
          <Pressable key={zz.id} onPress={() => { props.onActiveZone(i); props.onPaint(); }} style={{ width: RAIL_CELL, height: RAIL_CELL, borderRadius: 3, borderWidth: i === props.activeZone ? 2 : 1, borderColor: i === props.activeZone ? '#f8fafc' : '#1e293b', backgroundColor: zz.color }} />
        ))}
        <Pressable onPress={props.onAddZone} style={{ width: RAIL_CELL, height: RAIL_CELL, borderRadius: 3, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f1a2e', alignItems: 'center', justifyContent: 'center' }}>
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

export function BrushRail(props: {
  layer: BrushLayer;
  tool: Tool;
  tile: TileKind;
  onTool: (t: Tool) => void;
  onTile: (k: TileKind) => void;
  brush: BrushRailSettings;
  onBrushChange: (patch: Partial<BrushRailSettings>) => void;
  onClearHeights: () => void;
  zones: ZoneDef[];
  activeZone: number;
  onActiveZone: (i: number) => void;
  onAddZone: () => void;
  onUpdateZone: (i: number, patch: Partial<ZoneDef>) => void;
  onDeleteZone: (i: number) => void;
}) {
  const b = props.brush;
  const shapeItems = props.layer === 'height' ? FOOTPRINTS : FOOTPRINTS.filter((it) => it.id !== 'ramp');
  const shapeValue = props.layer === 'height' && b.heightMode === 'ramp' ? 'ramp' : b.shape;
  const onShape = (id: string) => {
    if (id === 'ramp') props.onBrushChange({ heightMode: 'ramp', mode: 'paint' });
    else props.onBrushChange({ shape: id as BrushShape, heightMode: 'brush' });
    if (props.layer !== 'height') props.onTool('brush');
  };
  const onPaint = () => { props.onBrushChange({ mode: 'paint' }); props.onTool('brush'); };

  return (
    <ScrollView showScrollbar style={{ width: '100%', height: '100%' }} contentContainerStyle={{ gap: 7, paddingBottom: 10 }}>
      <RailLabel text="brush" />
      <ChipGrid items={shapeItems} value={shapeValue} onPick={onShape} dim={b.mode === 'erase'} />
      <SizeSlider size={b.size} min={SIZE_MIN} max={SIZE_MAX} onSize={(size) => props.onBrushChange({ size })} />
      <ModeBar layer={props.layer} tool={props.tool} mode={b.mode} heightMode={b.heightMode} onTool={props.onTool} onPatch={props.onBrushChange} />
      <Box style={{ height: 1, backgroundColor: '#1e293b' }} />
      {props.layer === 'paint' ? <PaintSection tile={props.tile} onTile={props.onTile} onPaint={onPaint} /> : null}
      {props.layer === 'height' ? <HeightSection brush={b} onPatch={props.onBrushChange} onClear={props.onClearHeights} /> : null}
      {props.layer === 'zone' ? <ZoneSection zones={props.zones} activeZone={props.activeZone} onActiveZone={props.onActiveZone} onAddZone={props.onAddZone} onUpdateZone={props.onUpdateZone} onDeleteZone={props.onDeleteZone} onPaint={onPaint} /> : null}
    </ScrollView>
  );
}
