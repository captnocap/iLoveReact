// MapPaintBar — the Map Paint chrome, resident in the workspace ACTION BAR
// (req_2484: the toolbar above the stage is the tool's home; the viewport
// stays clean — the brush beam is the only in-world chrome). Compact by the
// bar's own conventions: cycling pills (the SNAP pattern) for shape/profile,
// swatch-only kind palettes with tooltips, tight − value + steppers.
//
// React arms the tool; every stroke/stamp/re-bake runs host-side
// (framework/game/map). All door traffic is UI-rate.
import { Fragment } from 'react';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { mapRoadCancel, mapRoadCommit, mapRoadStats, type MapBrushProfile, type MapBrushShape, type MapTerrainTool } from '../../../runtime/game/map';
import { TILE_KINDS, tileKindDefinition } from '../world/tileKinds';
import { FLORA_KIND_DEFINITIONS } from '../world/floraKinds';
import { addZonePatch, PAINTABLE_TILE_KINDS, type MapPaintChannel, type MapPaintState, saveMapFile } from './mapPaint';
import { tileBindingFor } from '../render3d/groundFormula';

// BAR LAW (req_2675): verbs and mode toggles are ICONS with tooltips; text is
// reserved for VALUE READOUTS (SNAP/SIZE/HEIGHT-style label+value pills). A
// mode's name is never spelled twice in one bar. Every glyph below is verified
// against the baked SDF atlas (runtime/icons/baked-names.ts) — no tofu.
const CHANNELS: MapPaintChannel[] = ['terrain', 'tile', 'water', 'flora', 'zone', 'road'];
const CHANNEL_META: Record<MapPaintChannel, { icon: string; tooltip: string }> = {
  terrain: { icon: 'Mountain', tooltip: 'Terrain — sculpt the heightfield' },
  tile: { icon: 'Grid3x3', tooltip: 'Tile — paint ground tile kinds' },
  water: { icon: 'Waves', tooltip: 'Water — paint bodies of water' },
  flora: { icon: 'Leaf', tooltip: 'Flora — plant trees, palms and grass' },
  zone: { icon: 'LandPlot', tooltip: 'Zone — paint named zone regions' },
  road: { icon: 'Route', tooltip: 'Road — draft a centerline, commit lanes' },
};
const TERRAIN_TOOLS: MapTerrainTool[] = ['brush', 'ramp', 'slope', 'smooth'];
const TERRAIN_TOOL_META: Record<MapTerrainTool, { icon: string; tooltip: string }> = {
  brush: { icon: 'Brush', tooltip: 'Brush — stamp hills and basins' },
  ramp: { icon: 'TriangleRight', tooltip: 'Ramp — a straight low→high ramp band' },
  slope: { icon: 'MoveUpRight', tooltip: 'Slope — grade the brushed area low→high' },
  smooth: { icon: 'Blend', tooltip: 'Smooth — blend and average terrain heights' },
};
const SHAPES: MapBrushShape[] = ['circle', 'square', 'diamond'];
const PROFILES: MapBrushProfile[] = ['cone', 'flat', 'dome'];

/** The action bar's icon control (matches ToolOptions' tool buttons exactly). */
function IconButton(props: { icon: string; tooltip: string; on?: boolean; onPress: () => void }) {
  const Btn = props.on ? C.HW_IconButtonOn : C.HW_IconButton;
  return (
    <Btn tooltip={props.tooltip} onPress={props.onPress}>
      <Icon name={props.icon} size={14} color={accentFor(props.on ? 'primary' : 'textDim')} />
    </Btn>
  );
}

function cycle<T>(items: readonly T[], current: T): T {
  return items[(items.indexOf(current) + 1) % items.length]!;
}

/** The bar's compact − value + stepper. */
function Stepper(props: { label: string; value: string; onDown: () => void; onUp: () => void }) {
  return (
    <Fragment>
      <C.HW_OptionLabel>{props.label}</C.HW_OptionLabel>
      <C.HW_IconButton onPress={props.onDown}><C.HW_PillText>-</C.HW_PillText></C.HW_IconButton>
      <C.HW_PillText>{props.value}</C.HW_PillText>
      <C.HW_IconButton onPress={props.onUp}><C.HW_PillText>+</C.HW_PillText></C.HW_IconButton>
    </Fragment>
  );
}

/** A labeled cycling pill (the SNAP convention: press to advance the value). */
function CyclePill(props: { label: string; value: string; tooltip: string; onPress: () => void }) {
  return (
    <C.HW_Pill tooltip={props.tooltip} onPress={props.onPress}>
      <C.HW_OptionLabel>{props.label}</C.HW_OptionLabel>
      <C.HW_PillText>{props.value}</C.HW_PillText>
    </C.HW_Pill>
  );
}

export default function MapPaintBar(props: {
  state: MapPaintState;
  onPatch: (patch: Partial<MapPaintState>) => void;
}) {
  const s = props.state;
  return (
    <Fragment>
      <IconButton
        icon="Paintbrush"
        tooltip="Map Paint — sculpt terrain, paint ground/water/flora/zones, lay roads"
        on={s.active}
        onPress={() => props.onPatch({ active: !s.active })}
      />
      {s.active ? (
        <Fragment>
          <C.HW_OptionDivider />
          {CHANNELS.map((channel) => (
            <IconButton
              key={channel}
              icon={CHANNEL_META[channel].icon}
              tooltip={CHANNEL_META[channel].tooltip}
              on={channel === s.channel}
              onPress={() => props.onPatch({ channel })}
            />
          ))}
          <C.HW_OptionDivider />
          {/* Erase is the exceptional mode — one icon toggle arms it; off = paint.
              The mode is never spelled out next to itself (req_2675). */}
          {s.channel !== 'road' ? (
            <IconButton
              icon="Eraser"
              tooltip="Erase mode — strokes remove instead of paint"
              on={s.mode === 'erase'}
              onPress={() => props.onPatch({ mode: s.mode === 'paint' ? 'erase' : 'paint' })}
            />
          ) : null}

          {s.channel === 'terrain' ? (
            <Fragment>
              {TERRAIN_TOOLS.map((tool) => (
                <IconButton
                  key={tool}
                  icon={TERRAIN_TOOL_META[tool].icon}
                  tooltip={TERRAIN_TOOL_META[tool].tooltip}
                  on={tool === s.terrainTool}
                  onPress={() => props.onPatch({ terrainTool: tool })}
                />
              ))}
            </Fragment>
          ) : null}

          {s.channel === 'tile' ? (
            <Fragment>
              {PAINTABLE_TILE_KINDS.map((idx) => {
                const def = tileKindDefinition(TILE_KINDS[idx]!);
                const Swatch = idx === s.tileKindIdx ? C.HW_SwatchButtonOn : C.HW_SwatchButton;
                return (
                  <Swatch key={def.kind} tooltip={def.label} onPress={() => props.onPatch({ tileKindIdx: idx, mode: 'paint' })}>
                    <C.HW_TileSwatch style={{ backgroundColor: def.render.color }} />
                  </Swatch>
                );
              })}
              {/* Bind the armed kind's LOOK to any catalog material — the picker
                  popover (MapTexturePicker, rendered late by AppFrame). */}
              {(() => {
                const kind = TILE_KINDS[s.tileKindIdx] ?? 'sidewalk';
                const binding = tileBindingFor(kind, s.tileMaterialOverrides);
                const Pill = s.texturePickerOpen ? C.HW_PillOn : C.HW_Pill;
                const Label = s.texturePickerOpen ? C.HW_PillTextOn : C.HW_PillText;
                return (
                  <Pill tooltip="Pick which material this kind paints" onPress={() => props.onPatch({ texturePickerOpen: !s.texturePickerOpen })}>
                    <C.HW_OptionLabel>TEXTURE</C.HW_OptionLabel>
                    <Label>{binding.fn.replace(/_/g, ' ').toUpperCase()}</Label>
                  </Pill>
                );
              })()}
            </Fragment>
          ) : null}

          {s.channel === 'flora' ? (
            <Fragment>
              {FLORA_KIND_DEFINITIONS.map((def, idx) => {
                const Swatch = idx === s.floraKindIdx ? C.HW_SwatchButtonOn : C.HW_SwatchButton;
                return (
                  <Swatch key={def.kind} tooltip={`${def.label} (${def.lane} lane)`} onPress={() => props.onPatch({ floraKindIdx: idx, mode: 'paint' })}>
                    <C.HW_TileSwatch style={{ backgroundColor: def.color }} />
                  </Swatch>
                );
              })}
            </Fragment>
          ) : null}

          {s.channel === 'zone' ? (
            <Fragment>
              {s.zones.map((zone, idx) => {
                const Swatch = idx === s.zoneIdx ? C.HW_SwatchButtonOn : C.HW_SwatchButton;
                return (
                  <Swatch key={zone.id} tooltip={zone.name} onPress={() => props.onPatch({ zoneIdx: idx, mode: 'paint' })}>
                    <C.HW_TileSwatch style={{ backgroundColor: zone.color }} />
                  </Swatch>
                );
              })}
              <IconButton icon="Plus" tooltip="Add a zone" onPress={() => props.onPatch(addZonePatch(s))} />
            </Fragment>
          ) : null}

          {s.channel === 'road' ? (
            <Fragment>
              <Stepper
                label="LANES→"
                value={String(s.roadLanesF)}
                onDown={() => props.onPatch({ roadLanesF: Math.max(1, s.roadLanesF - 1) })}
                onUp={() => props.onPatch({ roadLanesF: Math.min(3, s.roadLanesF + 1) })}
              />
              <Stepper
                label="←LANES"
                value={s.roadLanesB === 0 ? '1-WAY' : String(s.roadLanesB)}
                onDown={() => props.onPatch({ roadLanesB: Math.max(0, s.roadLanesB - 1) })}
                onUp={() => props.onPatch({ roadLanesB: Math.min(3, s.roadLanesB + 1) })}
              />
              {(() => {
                const stats = mapRoadStats();
                return (
                  <Fragment>
                    <IconButton
                      icon="Footprints"
                      tooltip="Sidewalks — flank the committed road with sidewalks"
                      on={s.roadSidewalks}
                      onPress={() => props.onPatch({ roadSidewalks: !s.roadSidewalks })}
                    />
                    <C.HW_OptionDivider />
                    <C.HW_PillText>{`${stats.draftPoints} PTS · ${stats.strokes} ROADS`}</C.HW_PillText>
                    {stats.planTruncated ? <C.HW_PillText>PLAN TRUNCATED</C.HW_PillText> : null}
                    <IconButton
                      icon="Check"
                      tooltip="Commit road — compile the clicked centerline into lanes/junctions/crosswalks"
                      on
                      onPress={() => { mapRoadCommit(); props.onPatch({}); }}
                    />
                    <IconButton
                      icon="X"
                      tooltip="Cancel road — drop the drafted centerline"
                      onPress={() => { mapRoadCancel(); props.onPatch({}); }}
                    />
                  </Fragment>
                );
              })()}
            </Fragment>
          ) : null}

          {s.channel !== 'road' ? (
            <Fragment>
              <C.HW_OptionDivider />
              <CyclePill
                label="SHAPE"
                value={s.shape.toUpperCase()}
                tooltip="Brush footprint — circle · square · diamond"
                onPress={() => props.onPatch({ shape: cycle(SHAPES, s.shape) })}
              />
              {s.channel === 'terrain' || s.channel === 'water' ? (
                <CyclePill
                  label="PROF"
                  value={s.profile.toUpperCase()}
                  tooltip="Brush cross-section — cone · flat plateau · dome"
                  onPress={() => props.onPatch({ profile: cycle(PROFILES, s.profile) })}
                />
              ) : null}
              <Stepper
                label="SIZE"
                value={`${s.radiusM}m`}
                onDown={() => props.onPatch({ radiusM: Math.max(1, s.radiusM - 1) })}
                onUp={() => props.onPatch({ radiusM: Math.min(40, s.radiusM + 1) })}
              />
            </Fragment>
          ) : null}

          {s.channel === 'terrain' && s.terrainTool === 'brush' ? (
            <Fragment>
              <Stepper
                label="HEIGHT"
                value={`${s.heightM}m`}
                onDown={() => props.onPatch({ heightM: Math.max(1, s.heightM - 1) })}
                onUp={() => props.onPatch({ heightM: Math.min(64, s.heightM + 1) })}
              />
              {/* Direction is a VALUE the brush carries (like SHAPE/PROF), not a
                  mode name — it reads as the bar's labeled cycle readout. */}
              <CyclePill
                label="DIR"
                value={s.raise ? 'RAISE' : 'DIG'}
                tooltip="Raise hills or dig basins"
                onPress={() => props.onPatch({ raise: !s.raise })}
              />
            </Fragment>
          ) : null}
          {s.channel === 'terrain' && (s.terrainTool === 'ramp' || s.terrainTool === 'slope') ? (
            <Fragment>
              <Stepper
                label="LOW"
                value={`${s.rampMin}m`}
                onDown={() => props.onPatch({ rampMin: Math.max(-64, s.rampMin - 1) })}
                onUp={() => props.onPatch({ rampMin: Math.min(64, s.rampMin + 1) })}
              />
              <Stepper
                label="HIGH"
                value={`${s.rampMax}m`}
                onDown={() => props.onPatch({ rampMax: Math.max(-64, s.rampMax - 1) })}
                onUp={() => props.onPatch({ rampMax: Math.min(64, s.rampMax + 1) })}
              />
              {s.terrainTool === 'ramp' ? (
                <Stepper
                  label="WIDE"
                  value={`${s.rampWide}m`}
                  onDown={() => props.onPatch({ rampWide: Math.max(1, s.rampWide - 1) })}
                  onUp={() => props.onPatch({ rampWide: Math.min(40, s.rampWide + 1) })}
                />
              ) : null}
            </Fragment>
          ) : null}
          {s.channel === 'terrain' && s.terrainTool === 'smooth' ? (
            <Stepper
              label="STR"
              value={s.smoothStrength.toFixed(1)}
              onDown={() => props.onPatch({ smoothStrength: Math.max(0.1, Math.round((s.smoothStrength - 0.1) * 10) / 10) })}
              onUp={() => props.onPatch({ smoothStrength: Math.min(1, Math.round((s.smoothStrength + 0.1) * 10) / 10) })}
            />
          ) : null}

          <C.HW_Spacer />
          <IconButton icon="Save" tooltip="Save the painted map to the map file" onPress={saveMapFile} />
        </Fragment>
      ) : null}
    </Fragment>
  );
}
