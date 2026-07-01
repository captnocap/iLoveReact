// MapPaintDock — the Map Paint chrome (MAPPAINT req_2473). React arms the tool;
// every stroke, stamp, and re-bake runs host-side in framework/game/map. This
// dock floats INSIDE the world viewport (the paint-bar convention, req_2469) and
// only ever calls the __map_* doors at UI rate.
//
// Channels surfaced here grow with the migration: TERRAIN + WATER now; TILE,
// FLORA, and ZONE arrive with their legend palettes.
import { Fragment } from 'react';
import { C } from '../workspace.cls';
import type { MapBrushProfile, MapBrushShape, MapTerrainTool } from '../../../runtime/game/map';

export type MapPaintState = {
  active: boolean;
  channel: 'terrain' | 'water';
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
};

const CHANNELS: MapPaintState['channel'][] = ['terrain', 'water'];
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
