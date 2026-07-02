// MapPaintDock — the Map Paint chrome (MAPPAINT req_2473). React arms the tool;
// every stroke, stamp, and re-bake runs host-side in framework/game/map. This
// dock floats INSIDE the world viewport (the paint-bar convention, req_2469) and
// only ever calls the __map_* doors at UI rate.
//
// All six channels: TERRAIN + TILE + WATER + FLORA + ZONE + ROAD (roads are
// CLICK-authored recipes — each click lays a centerline point, COMMIT compiles
// lanes/sidewalks/junctions/crosswalks host-side per the ruled grammar).
import { Fragment } from 'react';
import { C } from '../workspace.cls';
import { mapRoadStats, type MapBrushProfile, type MapBrushShape, type MapTerrainTool } from '../../../runtime/game/map';
import { TILE_KINDS, tileKindDefinition } from '../world/tileKinds';
import { FLORA_KIND_DEFINITIONS } from '../world/floraKinds';

export type MapZoneDef = { id: string; name: string; color: string };

export type MapPaintState = {
  active: boolean;
  channel: 'terrain' | 'tile' | 'water' | 'flora' | 'zone' | 'road';
  mode: 'paint' | 'erase';
  terrainTool: MapTerrainTool;
  shape: MapBrushShape;
  profile: MapBrushProfile;
  radiusM: number;
  /** height-brush peak, meters (signed via the RAISE/DIG toggle) */
  heightM: number;
  raise: boolean;
  rampMin: number;
  rampMax: number;
  rampWide: number;
  smoothStrength: number;
  /** armed ground tile kind — index into TILE_KINDS (the engine legend order) */
  tileKindIdx: number;
  /** armed flora kind — index into FLORA_KIND_DEFINITIONS */
  floraKindIdx: number;
  /** the zone list (names/colors are cart content; cells live host-side) */
  zones: MapZoneDef[];
  /** armed zone — index into zones */
  zoneIdx: number;
  // road draft profile (lanesB 0 = one-way)
  roadLanesF: number;
  roadLanesB: number;
  roadSidewalks: boolean;
};

export const DEFAULT_MAP_PAINT: MapPaintState = {
  active: false,
  channel: 'terrain',
  mode: 'paint',
  terrainTool: 'brush',
  shape: 'circle',
  profile: 'cone',
  radiusM: 4,
  heightM: 6,
  raise: true,
  rampMin: 0,
  rampMax: 4,
  rampWide: 3,
  smoothStrength: 0.5,
  tileKindIdx: Math.max(0, TILE_KINDS.indexOf('sidewalk')),
  floraKindIdx: 1, // 'Grass'
  zones: [],
  zoneIdx: 0,
  roadLanesF: 1,
  roadLanesB: 1,
  roadSidewalks: true,
};

// The paintable GROUND kinds for the dock's palette — kinds whose placement is
// authored ground (road-grammar kinds land with the road channel's stroke
// tools, not the hand brush).
export const PAINTABLE_TILE_KINDS: readonly number[] = TILE_KINDS
  .map((k, i) => [k, i] as const)
  .filter(([k]) => !['laneNorth', 'laneSouth', 'laneEast', 'laneWest', 'junction', 'crosswalk', 'median'].includes(k))
  .map(([, i]) => i);

const CHANNELS: MapPaintState['channel'][] = ['terrain', 'tile', 'water', 'flora', 'zone', 'road'];
const TERRAIN_TOOLS: MapTerrainTool[] = ['brush', 'ramp', 'slope', 'smooth'];
const SHAPES: MapBrushShape[] = ['circle', 'square', 'diamond'];
const PROFILES: MapBrushProfile[] = ['cone', 'flat', 'dome'];

function Stepper(props: { label: string; value: string; onDown: () => void; onUp: () => void }) {
  return (
    <Fragment>
      <C.HW_OptionLabel>{props.label}</C.HW_OptionLabel>
      <C.HW_Pill onPress={props.onDown}><C.HW_PillText>-</C.HW_PillText></C.HW_Pill>
      <C.HW_PillText>{props.value}</C.HW_PillText>
      <C.HW_Pill onPress={props.onUp}><C.HW_PillText>+</C.HW_PillText></C.HW_Pill>
    </Fragment>
  );
}

function PillRow<T extends string>(props: { items: readonly T[]; value: T; onPick: (v: T) => void }) {
  return (
    <Fragment>
      {props.items.map((item) => {
        const Pill = item === props.value ? C.HW_PillOn : C.HW_Pill;
        const Label = item === props.value ? C.HW_PillTextOn : C.HW_PillText;
        return <Pill key={item} onPress={() => props.onPick(item)}><Label>{item.toUpperCase()}</Label></Pill>;
      })}
    </Fragment>
  );
}

export default function MapPaintDock(props: {
  state: MapPaintState;
  onPatch: (patch: Partial<MapPaintState>) => void;
  onAddZone: () => void;
  onRoadCommit: () => void;
  onRoadCancel: () => void;
}) {
  const s = props.state;
  const Toggle = s.active ? C.HW_PillOn : C.HW_Pill;
  const ToggleText = s.active ? C.HW_PillTextOn : C.HW_PillText;
  return (
    <C.HW_MapPaintDock>
      <Toggle onPress={() => props.onPatch({ active: !s.active })}>
        <ToggleText>PAINT</ToggleText>
      </Toggle>
      {s.active ? (
        <Fragment>
          <C.HW_OptionDivider />
          <PillRow items={CHANNELS} value={s.channel} onPick={(channel) => props.onPatch({ channel })} />
          <C.HW_OptionDivider />
          <PillRow
            items={['paint', 'erase'] as const}
            value={s.mode}
            onPick={(mode) => props.onPatch({ mode })}
          />
          {s.channel === 'terrain' ? (
            <Fragment>
              <C.HW_OptionDivider />
              <PillRow items={TERRAIN_TOOLS} value={s.terrainTool} onPick={(terrainTool) => props.onPatch({ terrainTool })} />
            </Fragment>
          ) : null}
          {s.channel === 'tile' ? (
            <Fragment>
              <C.HW_OptionDivider />
              {PAINTABLE_TILE_KINDS.map((idx) => {
                const kind = TILE_KINDS[idx]!;
                const def = tileKindDefinition(kind);
                const Pill = idx === s.tileKindIdx ? C.HW_PillOn : C.HW_Pill;
                const Label = idx === s.tileKindIdx ? C.HW_PillTextOn : C.HW_PillText;
                return (
                  <Pill key={kind} tooltip={def.label} onPress={() => props.onPatch({ tileKindIdx: idx, mode: 'paint' })}>
                    <C.HW_TileSwatch style={{ backgroundColor: def.render.color }} />
                    <Label>{def.label.toUpperCase()}</Label>
                  </Pill>
                );
              })}
            </Fragment>
          ) : null}
          {s.channel === 'flora' ? (
            <Fragment>
              <C.HW_OptionDivider />
              {FLORA_KIND_DEFINITIONS.map((def, idx) => {
                const Pill = idx === s.floraKindIdx ? C.HW_PillOn : C.HW_Pill;
                const Label = idx === s.floraKindIdx ? C.HW_PillTextOn : C.HW_PillText;
                return (
                  <Pill key={def.kind} tooltip={`${def.label} (${def.lane} lane)`} onPress={() => props.onPatch({ floraKindIdx: idx, mode: 'paint' })}>
                    <C.HW_TileSwatch style={{ backgroundColor: def.color }} />
                    <Label>{def.label.toUpperCase()}</Label>
                  </Pill>
                );
              })}
            </Fragment>
          ) : null}
          {s.channel === 'zone' ? (
            <Fragment>
              <C.HW_OptionDivider />
              {s.zones.map((zone, idx) => {
                const Pill = idx === s.zoneIdx ? C.HW_PillOn : C.HW_Pill;
                const Label = idx === s.zoneIdx ? C.HW_PillTextOn : C.HW_PillText;
                return (
                  <Pill key={zone.id} tooltip={zone.name} onPress={() => props.onPatch({ zoneIdx: idx, mode: 'paint' })}>
                    <C.HW_TileSwatch style={{ backgroundColor: zone.color }} />
                    <Label>{zone.name.toUpperCase()}</Label>
                  </Pill>
                );
              })}
              <C.HW_Pill tooltip="Add a zone" onPress={props.onAddZone}>
                <C.HW_PillText>+ ZONE</C.HW_PillText>
              </C.HW_Pill>
            </Fragment>
          ) : null}
          {s.channel === 'road' ? (
            <Fragment>
              <C.HW_OptionDivider />
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
                return (
                  <Walk onPress={() => props.onPatch({ roadSidewalks: !s.roadSidewalks })}>
                    <WalkText>SIDEWALKS</WalkText>
                  </Walk>
                );
              })()}
              <C.HW_OptionDivider />
              {(() => {
                const stats = mapRoadStats();
                return (
                  <Fragment>
                    <C.HW_PillText>{`${stats.draftPoints} PTS · ${stats.strokes} ROADS`}</C.HW_PillText>
                    {stats.planTruncated ? <C.HW_PillText>PLAN TRUNCATED — TOO MANY ROAD CELLS</C.HW_PillText> : null}
                    <C.HW_PillOn onPress={props.onRoadCommit}><C.HW_PillTextOn>COMMIT</C.HW_PillTextOn></C.HW_PillOn>
                    <C.HW_Pill onPress={props.onRoadCancel}><C.HW_PillText>CANCEL</C.HW_PillText></C.HW_Pill>
                  </Fragment>
                );
              })()}
            </Fragment>
          ) : null}
          {s.channel !== 'road' ? (
            <Fragment>
              <C.HW_OptionDivider />
              <PillRow items={SHAPES} value={s.shape} onPick={(shape) => props.onPatch({ shape })} />
              <PillRow items={PROFILES} value={s.profile} onPick={(profile) => props.onPatch({ profile })} />
              <C.HW_OptionDivider />
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
                  <Dir onPress={() => props.onPatch({ raise: !s.raise })}>
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
              label="STRENGTH"
              value={s.smoothStrength.toFixed(1)}
              onDown={() => props.onPatch({ smoothStrength: Math.max(0.1, Math.round((s.smoothStrength - 0.1) * 10) / 10) })}
              onUp={() => props.onPatch({ smoothStrength: Math.min(1, Math.round((s.smoothStrength + 0.1) * 10) / 10) })}
            />
          ) : null}
        </Fragment>
      ) : null}
    </C.HW_MapPaintDock>
  );
}
