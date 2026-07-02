// MapPaintBar — the Map Paint chrome, resident in the workspace ACTION BAR
// (req_2484: the toolbar above the stage is the tool's home; the viewport
// stays clean — the brush beam is the only in-world chrome). Compact by the
// bar's own conventions: cycling pills (the SNAP pattern) for shape/profile,
// swatch-only kind palettes with tooltips, tight − value + steppers.
//
// React arms the tool; every stroke/stamp/re-bake runs host-side
// (framework/game/map). All door traffic is UI-rate.
import { Fragment } from 'react';
import { C } from '../workspace.cls';
import { mapRoadCancel, mapRoadCommit, mapRoadStats, type MapBrushProfile, type MapBrushShape, type MapTerrainTool } from '../../../runtime/game/map';
import { TILE_KINDS, tileKindDefinition } from '../world/tileKinds';
import { FLORA_KIND_DEFINITIONS } from '../world/floraKinds';
import { addZonePatch, PAINTABLE_TILE_KINDS, type MapPaintChannel, type MapPaintState, saveMapFile } from './mapPaint';

const CHANNELS: MapPaintChannel[] = ['terrain', 'tile', 'water', 'flora', 'zone', 'road'];
const TERRAIN_TOOLS: MapTerrainTool[] = ['brush', 'ramp', 'slope', 'smooth'];
const SHAPES: MapBrushShape[] = ['circle', 'square', 'diamond'];
const PROFILES: MapBrushProfile[] = ['cone', 'flat', 'dome'];

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
  const Toggle = s.active ? C.HW_PillOn : C.HW_Pill;
  const ToggleText = s.active ? C.HW_PillTextOn : C.HW_PillText;
  return (
    <Fragment>
      <Toggle tooltip="Map Paint — sculpt terrain, paint ground/water/flora/zones, lay roads" onPress={() => props.onPatch({ active: !s.active })}>
        <ToggleText>PAINT</ToggleText>
      </Toggle>
      {s.active ? (
        <Fragment>
          <C.HW_OptionDivider />
          {CHANNELS.map((channel) => {
            const Pill = channel === s.channel ? C.HW_PillOn : C.HW_Pill;
            const Label = channel === s.channel ? C.HW_PillTextOn : C.HW_PillText;
            return <Pill key={channel} onPress={() => props.onPatch({ channel })}><Label>{channel.toUpperCase()}</Label></Pill>;
          })}
          <C.HW_OptionDivider />
          {s.channel !== 'road' ? (
            <CyclePill
              label="MODE"
              value={s.mode.toUpperCase()}
              tooltip="Paint or erase with the brush"
              onPress={() => props.onPatch({ mode: s.mode === 'paint' ? 'erase' : 'paint' })}
            />
          ) : null}

          {s.channel === 'terrain' ? (
            <Fragment>
              {TERRAIN_TOOLS.map((tool) => {
                const Pill = tool === s.terrainTool ? C.HW_PillOn : C.HW_Pill;
                const Label = tool === s.terrainTool ? C.HW_PillTextOn : C.HW_PillText;
                return <Pill key={tool} onPress={() => props.onPatch({ terrainTool: tool })}><Label>{tool.toUpperCase()}</Label></Pill>;
              })}
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
              <C.HW_Pill tooltip="Add a zone" onPress={() => props.onPatch(addZonePatch(s))}>
                <C.HW_PillText>+ ZONE</C.HW_PillText>
              </C.HW_Pill>
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
                const Walk = s.roadSidewalks ? C.HW_PillOn : C.HW_Pill;
                const WalkText = s.roadSidewalks ? C.HW_PillTextOn : C.HW_PillText;
                const stats = mapRoadStats();
                return (
                  <Fragment>
                    <Walk onPress={() => props.onPatch({ roadSidewalks: !s.roadSidewalks })}>
                      <WalkText>SIDEWALKS</WalkText>
                    </Walk>
                    <C.HW_OptionDivider />
                    <C.HW_PillText>{`${stats.draftPoints} PTS · ${stats.strokes} ROADS`}</C.HW_PillText>
                    {stats.planTruncated ? <C.HW_PillText>PLAN TRUNCATED</C.HW_PillText> : null}
                    <C.HW_PillOn tooltip="Compile the clicked centerline into lanes/junctions/crosswalks" onPress={() => { mapRoadCommit(); props.onPatch({}); }}>
                      <C.HW_PillTextOn>COMMIT</C.HW_PillTextOn>
                    </C.HW_PillOn>
                    <C.HW_Pill tooltip="Drop the drafted centerline" onPress={() => { mapRoadCancel(); props.onPatch({}); }}>
                      <C.HW_PillText>CANCEL</C.HW_PillText>
                    </C.HW_Pill>
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
              {(() => {
                const Dir = s.raise ? C.HW_PillOn : C.HW_Pill;
                const DirText = s.raise ? C.HW_PillTextOn : C.HW_PillText;
                return (
                  <Dir tooltip="Raise hills or dig basins" onPress={() => props.onPatch({ raise: !s.raise })}>
                    <DirText>{s.raise ? 'RAISE' : 'DIG'}</DirText>
                  </Dir>
                );
              })()}
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
          <C.HW_Pill tooltip="Save the painted map to the map file" onPress={saveMapFile}>
            <C.HW_PillText>SAVE</C.HW_PillText>
          </C.HW_Pill>
        </Fragment>
      ) : null}
    </Fragment>
  );
}
