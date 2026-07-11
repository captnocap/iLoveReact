// MapPaintDock — the bottom viewport palette for active Map Paint.
//
// Build mode uses BuildBar: category row on top, preview tray underneath. Map
// Paint gets the same muscle memory, but its categories are paint channels and
// its tray holds mode brushes, swatches, and value controls.
import { Fragment, useEffect, useState } from 'react';
import { Box, Row, Slider, TextInput } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { mapPathCancel, mapPathCommit, mapPathControlDelete, mapPathDelete, mapPathStats, mapPathUndoPoint, type MapPathStats } from '../../../runtime/game/map';
import { TILE_KINDS, tileKindDefinition } from '../world/tileKinds';
import { FLORA_KIND_DEFINITIONS } from '../world/floraKinds';
import { GROUND_MATERIALS, tileBindingFor } from '../render3d/groundFormula';
import { addZonePatch, PAINTABLE_TILE_KINDS, saveMapFile, type MapPaintChannel, type MapPaintState } from './mapPaint';
import { CHANNELS, CHANNEL_META, cycle, GIZMOS, GIZMO_META, PROFILES, SHAPES, TERRAIN_TOOLS, TERRAIN_TOOL_META } from './mapPaintUi';
import { PATH_CURVE_TUNING, PATH_KIND_META, PATH_KIND_ORDER, pathInvalidLabel, pathKindPatch, pathLevelLabel } from './transportPathUi';

const ICON_PANEL = '#101923';
const ICON_PANEL_ON = '#12283a';
const PANEL_LINE = '#253241';
const TRACK = '#1a2532';
const FIELD_BG = '#0b121b';
const HALF_STEP = 0.5;
const NOTCHES = Array.from({ length: 9 }, (_, i) => i);
const SHAPE_META: Record<(typeof SHAPES)[number], { icon: string; label: string }> = {
  circle: { icon: 'Circle', label: 'Circle' },
  square: { icon: 'Square', label: 'Square' },
  diamond: { icon: 'Diamond', label: 'Diamond' },
};
const PROFILE_META: Record<(typeof PROFILES)[number], { icon: string; label: string }> = {
  cone: { icon: 'Cone', label: 'Cone' },
  flat: { icon: 'Square', label: 'Flat' },
  dome: { icon: 'Circle', label: 'Dome' },
};

function MiniIcon(props: { icon: string; tooltip: string; on?: boolean; onPress: () => void }) {
  const Btn = props.on ? C.HW_IconButtonOn : C.HW_IconButton;
  return (
    <Btn tooltip={props.tooltip} onPress={props.onPress}>
      <Icon name={props.icon} size={14} color={accentFor(props.on ? 'primary' : 'textDim')} />
    </Btn>
  );
}

function OptionTile(props: { icon: string; label: string; tooltip: string; on?: boolean; onPress: () => void }) {
  const Tile = props.on ? C.HW_BuildPieceTileOn : C.HW_BuildPieceTile;
  const Label = props.on ? C.HW_BuildPieceTileLabelOn : C.HW_BuildPieceTileLabel;
  return (
    <Tile tooltip={props.tooltip} onPress={props.onPress}>
      <C.HW_BuildPieceThumb style={{ alignItems: 'center', justifyContent: 'center', backgroundColor: props.on ? ICON_PANEL_ON : ICON_PANEL }}>
        <Icon name={props.icon} size={18} color={accentFor(props.on ? 'primary' : 'textDim')} />
      </C.HW_BuildPieceThumb>
      <C.HW_BuildPieceTileLabelBox><Label>{props.label}</Label></C.HW_BuildPieceTileLabelBox>
    </Tile>
  );
}

function SwatchTile(props: { color: string; label: string; tooltip: string; on?: boolean; onPress: () => void }) {
  const Tile = props.on ? C.HW_BuildPieceTileOn : C.HW_BuildPieceTile;
  const Label = props.on ? C.HW_BuildPieceTileLabelOn : C.HW_BuildPieceTileLabel;
  return (
    <Tile tooltip={props.tooltip} onPress={props.onPress}>
      <C.HW_BuildPieceThumb style={{ backgroundColor: props.color, borderWidth: 1, borderColor: PANEL_LINE }} />
      <C.HW_BuildPieceTileLabelBox><Label>{props.label}</Label></C.HW_BuildPieceTileLabelBox>
    </Tile>
  );
}

function StepperPanel(props: { label: string; value: string; onDown: () => void; onUp: () => void }) {
  return (
    <Box style={{ height: 60, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 8, paddingRight: 8, borderRadius: 6, backgroundColor: ICON_PANEL, borderWidth: 1, borderColor: PANEL_LINE }}>
      <C.HW_OptionLabel>{props.label}</C.HW_OptionLabel>
      <C.HW_IconButton onPress={props.onDown}><C.HW_PillText>-</C.HW_PillText></C.HW_IconButton>
      <C.HW_PillText>{props.value}</C.HW_PillText>
      <C.HW_IconButton onPress={props.onUp}><C.HW_PillText>+</C.HW_PillText></C.HW_IconButton>
    </Box>
  );
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function snapValue(value: number, step: number): number {
  return Math.round(Math.round(value / step) * step * 1000) / 1000;
}

function coerceScalar(value: number, min: number, max: number, step: number): number {
  return clampValue(snapValue(value, step), min, max);
}

function formatScalar(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function parseScalar(raw: string): number | null {
  const cleaned = raw.trim().replace(/m$/i, '');
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function ScalarPanel(props: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onValue: (value: number) => void }) {
  const step = props.step ?? HALF_STEP;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(formatScalar(props.value));

  useEffect(() => {
    if (!editing) setDraft(formatScalar(props.value));
  }, [editing, props.value]);

  const commitValue = (value: number) => {
    const next = coerceScalar(value, props.min, props.max, step);
    setDraft(formatScalar(next));
    props.onValue(next);
  };

  const commitDraft = () => {
    setEditing(false);
    const parsed = parseScalar(draft);
    if (parsed == null) {
      setDraft(formatScalar(props.value));
      return;
    }
    commitValue(parsed);
  };

  return (
    <Box style={{ height: 70, width: 158, flexDirection: 'column', gap: 3, paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 5, borderRadius: 6, backgroundColor: ICON_PANEL, borderWidth: 1, borderColor: PANEL_LINE }}>
      <Row style={{ alignItems: 'center', gap: 6 }}>
        <C.HW_OptionLabel>{props.label}</C.HW_OptionLabel>
        <Box style={{ flexGrow: 1 }} />
        <TextInput
          value={draft}
          onMouseDown={() => { setEditing(true); setDraft(formatScalar(props.value)); }}
          onChangeText={(value: string) => { setEditing(true); setDraft(value); }}
          onSubmit={commitDraft}
          onSubmitEditing={commitDraft}
          onBlur={commitDraft}
          style={{ width: 48, height: 20, paddingLeft: 5, paddingRight: 5, borderRadius: 4, borderWidth: 1, borderColor: PANEL_LINE, backgroundColor: FIELD_BG, color: accentFor('text'), fontSize: 10, fontFamily: 'ui-monospace', fontWeight: 800, textAlign: 'right' }}
        />
        {props.unit ? <C.HW_PillText>{props.unit}</C.HW_PillText> : null}
      </Row>
      <Slider
        value={props.value}
        min={props.min}
        max={props.max}
        step={step}
        onChange={(value: number) => setDraft(formatScalar(coerceScalar(value, props.min, props.max, step)))}
        onCommit={commitValue}
        style={{ height: 22, backgroundColor: TRACK, color: accentFor('primary') }}
      />
      <Row style={{ height: 5, alignItems: 'center', justifyContent: 'space-between', paddingLeft: 6, paddingRight: 6 }}>
        {NOTCHES.map((idx) => <Box key={idx} style={{ width: 1, height: idx === 0 || idx === NOTCHES.length - 1 || idx === 4 ? 5 : 3, backgroundColor: idx === 4 ? accentFor('textDim') : PANEL_LINE }} />)}
      </Row>
    </Box>
  );
}

function FactPanel(props: { label: string; value: string }) {
  return (
    <Box style={{ height: 60, minWidth: 94, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, paddingLeft: 8, paddingRight: 8, borderRadius: 6, backgroundColor: ICON_PANEL, borderWidth: 1, borderColor: PANEL_LINE }}>
      <C.HW_OptionLabel>{props.label}</C.HW_OptionLabel>
      <C.HW_PillText>{props.value}</C.HW_PillText>
    </Box>
  );
}

function materialLabel(state: MapPaintState): string {
  const kind = TILE_KINDS[state.tileKindIdx] ?? 'sidewalk';
  const binding = (state.tileBindIdx >= 0 ? state.tileBindings[state.tileBindIdx] : undefined) ?? tileBindingFor(kind);
  const material = GROUND_MATERIALS.find((item) => item.fn === binding.fn);
  const variant = material?.variantLabels[binding.variant];
  return [material?.name ?? binding.fn, variant && variant !== 'Std' ? variant : ''].filter(Boolean).join(' ');
}

function channelCount(state: MapPaintState, channel: MapPaintChannel): string {
  if (channel === 'terrain') return String(TERRAIN_TOOLS.length);
  if (channel === 'tile') return String(PAINTABLE_TILE_KINDS.length);
  if (channel === 'flora') return String(FLORA_KIND_DEFINITIONS.length);
  if (channel === 'zone') return String(state.zones.length);
  if (channel === 'road') return String(mapPathStats().paths);
  return '1';
}

function ShapeTile(props: { state: MapPaintState; onPatch: (patch: Partial<MapPaintState>) => void }) {
  const meta = SHAPE_META[props.state.shape];
  return (
    <OptionTile
      icon={meta.icon}
      label={meta.label}
      tooltip="Brush footprint - circle, square, diamond"
      on
      onPress={() => props.onPatch({ shape: cycle(SHAPES, props.state.shape) })}
    />
  );
}

function ProfileTile(props: { state: MapPaintState; onPatch: (patch: Partial<MapPaintState>) => void }) {
  const meta = PROFILE_META[props.state.profile];
  return (
    <OptionTile
      icon={meta.icon}
      label={meta.label}
      tooltip="Brush cross-section - cone, flat plateau, dome"
      on
      onPress={() => props.onPatch({ profile: cycle(PROFILES, props.state.profile) })}
    />
  );
}

function BrushControls(props: { state: MapPaintState; onPatch: (patch: Partial<MapPaintState>) => void }) {
  const s = props.state;
  const activeGizmo = s.gizmo ?? 'profile';
  return (
    <Fragment>
      {GIZMOS.map((gizmo) => (
        <OptionTile
          key={gizmo}
          icon={GIZMO_META[gizmo].icon}
          label={GIZMO_META[gizmo].label}
          tooltip={GIZMO_META[gizmo].tooltip}
          on={gizmo === activeGizmo}
          onPress={() => props.onPatch({ gizmo })}
        />
      ))}
      <ShapeTile state={s} onPatch={props.onPatch} />
      {s.channel === 'terrain' || s.channel === 'water' ? <ProfileTile state={s} onPatch={props.onPatch} /> : null}
      <OptionTile
        icon="Eraser"
        label="Erase"
        tooltip="Erase mode - strokes remove from the active paint channel"
        on={s.mode === 'erase'}
        onPress={() => props.onPatch({ mode: s.mode === 'paint' ? 'erase' : 'paint' })}
      />
      <ScalarPanel
        label="SIZE"
        value={s.radiusM}
        min={1}
        max={40}
        step={HALF_STEP}
        unit="m"
        onValue={(radiusM) => props.onPatch({ radiusM })}
      />
    </Fragment>
  );
}

function TerrainTray(props: { state: MapPaintState; onPatch: (patch: Partial<MapPaintState>) => void }) {
  const s = props.state;
  return (
    <Fragment>
      {TERRAIN_TOOLS.map((tool) => (
        <OptionTile
          key={tool}
          icon={TERRAIN_TOOL_META[tool].icon}
          label={TERRAIN_TOOL_META[tool].label}
          tooltip={TERRAIN_TOOL_META[tool].tooltip}
          on={tool === s.terrainTool}
          onPress={() => props.onPatch({ terrainTool: tool, mode: 'paint' })}
        />
      ))}
      {s.terrainTool === 'brush' ? (
        <Fragment>
          <ScalarPanel
            label="HEIGHT"
            value={s.heightM}
            min={1}
            max={64}
            step={HALF_STEP}
            unit="m"
            onValue={(heightM) => props.onPatch({ heightM })}
          />
          <OptionTile
            icon="MoveUpRight"
            label={s.raise ? 'Raise' : 'Dig'}
            tooltip="Raise hills or dig basins"
            on={s.raise}
            onPress={() => props.onPatch({ raise: !s.raise })}
          />
        </Fragment>
      ) : null}
      {s.terrainTool === 'ramp' || s.terrainTool === 'slope' ? (
        <Fragment>
          <ScalarPanel
            label="LOW"
            value={s.rampMin}
            min={-64}
            max={64}
            step={HALF_STEP}
            unit="m"
            onValue={(rampMin) => props.onPatch({ rampMin })}
          />
          <ScalarPanel
            label="HIGH"
            value={s.rampMax}
            min={-64}
            max={64}
            step={HALF_STEP}
            unit="m"
            onValue={(rampMax) => props.onPatch({ rampMax })}
          />
          {s.terrainTool === 'ramp' ? (
            <ScalarPanel
              label="WIDE"
              value={s.rampWide}
              min={1}
              max={40}
              step={HALF_STEP}
              unit="m"
              onValue={(rampWide) => props.onPatch({ rampWide })}
            />
          ) : null}
        </Fragment>
      ) : null}
      {s.terrainTool === 'smooth' ? (
        <ScalarPanel
          label="STR"
          value={s.smoothStrength}
          min={0.1}
          max={1}
          step={0.1}
          onValue={(smoothStrength) => props.onPatch({ smoothStrength })}
        />
      ) : null}
    </Fragment>
  );
}

function TileTray(props: { state: MapPaintState; onPatch: (patch: Partial<MapPaintState>) => void }) {
  const s = props.state;
  return (
    <Fragment>
      {PAINTABLE_TILE_KINDS.map((idx) => {
        const def = tileKindDefinition(TILE_KINDS[idx]!);
        return (
          <SwatchTile
            key={def.kind}
            color={def.render.color}
            label={def.label}
            tooltip={def.label}
            on={idx === s.tileKindIdx}
            onPress={() => props.onPatch({ tileKindIdx: idx, mode: 'paint' })}
          />
        );
      })}
      <OptionTile
        icon="SwatchBook"
        label="Texture"
        tooltip={`Pick which material the brush paints: ${materialLabel(s)}`}
        on={s.texturePickerOpen}
        onPress={() => props.onPatch({ texturePickerOpen: !s.texturePickerOpen })}
      />
    </Fragment>
  );
}

function FloraTray(props: { state: MapPaintState; onPatch: (patch: Partial<MapPaintState>) => void }) {
  const s = props.state;
  return (
    <Fragment>
      {FLORA_KIND_DEFINITIONS.map((def, idx) => (
        <SwatchTile
          key={def.kind}
          color={def.color}
          label={def.label}
          tooltip={`${def.label} (${def.lane} lane)`}
          on={idx === s.floraKindIdx}
          onPress={() => props.onPatch({ floraKindIdx: idx, mode: 'paint' })}
        />
      ))}
    </Fragment>
  );
}

function ZoneTray(props: { state: MapPaintState; onPatch: (patch: Partial<MapPaintState>) => void }) {
  const s = props.state;
  return (
    <Fragment>
      {s.zones.map((zone, idx) => (
        <SwatchTile
          key={zone.id}
          color={zone.color}
          label={zone.name}
          tooltip={zone.name}
          on={idx === s.zoneIdx}
          onPress={() => props.onPatch({ zoneIdx: idx, mode: 'paint' })}
        />
      ))}
      <OptionTile icon="Plus" label="Add" tooltip="Add a zone" onPress={() => props.onPatch(addZonePatch(s))} />
    </Fragment>
  );
}

function pathStatsKey(stats: MapPathStats): string {
  return [stats.paths, stats.roads, stats.rails, stats.draftPoints, stats.planTruncated ? 1 : 0,
    stats.draftKind ?? '-', stats.valid ? 1 : 0, stats.invalidReason,
    stats.minCurveM ?? '-', stats.lastPathId, stats.curveRadiusM, stats.maxGrade,
    stats.controls, stats.lastControlId, stats.controlPreviewPathId ?? '-',
    stats.controlPreviewDistanceM ?? '-', stats.controlPreviewValid ? 1 : 0,
    stats.authoringTool, stats.level].join('|');
}

/** Native clicks do not traverse React. Poll this tiny diagnostics record at UI
 * rate so Finish/Undo and the point count follow the path under the cursor. */
function usePathStats(): MapPathStats {
  const [stats, setStats] = useState(mapPathStats);
  useEffect(() => {
    const refresh = () => {
      const next = mapPathStats();
      setStats((current) => pathStatsKey(current) === pathStatsKey(next) ? current : next);
    };
    const timer = setInterval(refresh, 100);
    return () => clearInterval(timer);
  }, []);
  return stats;
}

function PathTray(props: { state: MapPaintState; onPatch: (patch: Partial<MapPaintState>) => void }) {
  const s = props.state;
  const stats = usePathStats();
  const stopping = s.pathTool === 'stop';
  const isRoad = s.pathKind === 'road';
  const invalid = stats.draftPoints > 0 && !stats.valid
    ? pathInvalidLabel(stats.invalidReason, stats.minCurveM, stats.maxGrade)
    : '';
  return (
    <Fragment>
      {PATH_KIND_ORDER.map((kind) => (
        <OptionTile
          key={kind}
          icon={PATH_KIND_META[kind].icon}
          label={PATH_KIND_META[kind].label}
          tooltip={PATH_KIND_META[kind].tooltip}
          on={!stopping && s.pathKind === kind}
          onPress={() => props.onPatch(pathKindPatch(kind))}
        />
      ))}
      <OptionTile
        icon="CircleStop"
        label="TC Stop"
        tooltip="TC Stop — hover a committed rail alignment to preview, then click to attach a train stop control"
        on={stopping}
        onPress={() => props.onPatch({ pathTool: 'stop' })}
      />
      {stopping ? (
        <Fragment>
          <FactPanel label="STOPS" value={String(stats.controls)} />
          <FactPanel
            label="TARGET"
            value={stats.controlPreviewPathId == null
              ? 'move onto rail'
              : stats.controlPreviewValid
                ? `#${stats.controlPreviewPathId} · ${stats.controlPreviewDistanceM?.toFixed(1) ?? '0.0'}m`
                : 'already occupied'}
          />
          {stats.lastControlId > 0 ? (
            <OptionTile
              icon="Trash2"
              label="Last Stop"
              tooltip={`Delete the last committed TC Stop (#${stats.lastControlId})`}
              onPress={() => { mapPathControlDelete(stats.lastControlId); props.onPatch({}); }}
            />
          ) : null}
        </Fragment>
      ) : isRoad ? (
        <Fragment>
          <StepperPanel
            label="LANES F"
            value={String(s.roadLanesF)}
            onDown={() => props.onPatch({ roadLanesF: Math.max(1, s.roadLanesF - 1) })}
            onUp={() => props.onPatch({ roadLanesF: Math.min(3, s.roadLanesF + 1) })}
          />
          <StepperPanel
            label="LANES B"
            value={s.roadLanesB === 0 ? '1-WAY' : String(s.roadLanesB)}
            onDown={() => props.onPatch({ roadLanesB: Math.max(0, s.roadLanesB - 1) })}
            onUp={() => props.onPatch({ roadLanesB: Math.min(3, s.roadLanesB + 1) })}
          />
          <OptionTile
            icon="Footprints"
            label="Walks"
            tooltip="Sidewalks — flank the committed road with the locked two-tile ring"
            on={s.roadSidewalks}
            onPress={() => props.onPatch({ roadSidewalks: !s.roadSidewalks })}
          />
        </Fragment>
      ) : (
        <Fragment>
          <StepperPanel
            label="TRACKS"
            value={String(s.railTracks)}
            onDown={() => props.onPatch({ railTracks: Math.max(PATH_CURVE_TUNING.railTracksMin, s.railTracks - 1) })}
            onUp={() => props.onPatch({ railTracks: Math.min(PATH_CURVE_TUNING.railTracksMax, s.railTracks + 1) })}
          />
          <StepperPanel
            label="LEVEL"
            value={pathLevelLabel(s.pathLevel)}
            onDown={() => props.onPatch({ pathLevel: Math.max(PATH_CURVE_TUNING.levelMin, s.pathLevel - 1) })}
            onUp={() => props.onPatch({ pathLevel: Math.min(PATH_CURVE_TUNING.levelMax, s.pathLevel + 1) })}
          />
        </Fragment>
      )}
      {!stopping ? (
        <Fragment>
          <ScalarPanel
            label="CURVE"
            value={s.pathCurveRadiusM}
            min={PATH_CURVE_TUNING.minM}
            max={PATH_CURVE_TUNING.maxM}
            step={PATH_CURVE_TUNING.stepM}
            unit="m"
            onValue={(pathCurveRadiusM) => props.onPatch({ pathCurveRadiusM })}
          />
          <FactPanel label="DRAFT" value={`${stats.draftPoints} pts`} />
          <FactPanel label="GRADE" value={`${(stats.maxGrade * 100).toFixed(1)}%`} />
          <FactPanel label="PATHS" value={stats.planTruncated ? 'truncated' : `${stats.roads}r · ${stats.rails}t`} />
          {invalid ? <FactPanel label="ADJUST" value={invalid} /> : null}
          <OptionTile
            icon="Check"
            label="Finish"
            tooltip={stats.valid
              ? 'Finish path — roads compile their lane grid; rail persists and renders from the 3D curve'
              : invalid || 'Place two anchors before finishing'}
            on={stats.valid}
            onPress={() => { if (stats.valid) mapPathCommit(); props.onPatch({}); }}
          />
          <OptionTile
            icon="Undo"
            label="Point"
            tooltip="Undo the last accepted path point; the live hover piece remains editable"
            onPress={() => { mapPathUndoPoint(); props.onPatch({}); }}
          />
          <OptionTile
            icon="X"
            label="Cancel"
            tooltip="Cancel this path draft without changing committed roads or rail"
            onPress={() => { mapPathCancel(); props.onPatch({}); }}
          />
          {stats.lastPathId > 0 ? (
            <OptionTile
              icon="Trash2"
              label="Last"
              tooltip={`Delete the last committed path (#${stats.lastPathId})`}
              onPress={() => { mapPathDelete(stats.lastPathId); props.onPatch({}); }}
            />
          ) : null}
        </Fragment>
      ) : null}
    </Fragment>
  );
}

function WaterTray(props: { state: MapPaintState; onPatch: (patch: Partial<MapPaintState>) => void }) {
  const s = props.state;
  return (
    <ScalarPanel
      label="DEPTH"
      value={s.heightM}
      min={1}
      max={64}
      step={HALF_STEP}
      unit="m"
      onValue={(heightM) => props.onPatch({ heightM })}
    />
  );
}

function ChannelTray(props: { state: MapPaintState; onPatch: (patch: Partial<MapPaintState>) => void }) {
  if (props.state.channel === 'terrain') return <TerrainTray {...props} />;
  if (props.state.channel === 'tile') return <TileTray {...props} />;
  if (props.state.channel === 'water') return <WaterTray {...props} />;
  if (props.state.channel === 'flora') return <FloraTray {...props} />;
  if (props.state.channel === 'zone') return <ZoneTray {...props} />;
  return <PathTray {...props} />;
}

function Tray(props: { state: MapPaintState; onPatch: (patch: Partial<MapPaintState>) => void }) {
  return (
    <Fragment>
      {props.state.channel !== 'road' ? <BrushControls {...props} /> : null}
      <ChannelTray {...props} />
    </Fragment>
  );
}

export default function MapPaintDock(props: {
  state: MapPaintState;
  onPatch: (patch: Partial<MapPaintState>) => void;
}) {
  const s = props.state;
  return (
    // The active world brush claims raw pointer input under normal chrome.
    // Mark the dock as a pointer blocker so clicks in its empty gaps don't
    // fall through to the terrain painter; child Pressables still hit first.
    <C.HW_BuildBar blocksPointerEvents>
      <C.HW_BuildBarRow>
        {CHANNELS.map((channel) => {
          const on = channel === s.channel;
          const Cat = on ? C.HW_BuildCatOn : C.HW_BuildCat;
          const Txt = on ? C.HW_BuildCatTextOn : C.HW_BuildCatText;
          return (
            <Cat key={channel} tooltip={CHANNEL_META[channel].tooltip} onPress={() => props.onPatch({ channel })}>
              <Icon name={CHANNEL_META[channel].icon} size={12} color={accentFor(on ? 'primary' : 'textDim')} />
              <Txt>{CHANNEL_META[channel].label}</Txt>
              <C.HW_BuildCatCount>{channelCount(s, channel)}</C.HW_BuildCatCount>
            </Cat>
          );
        })}
        <C.HW_Spacer />
        <MiniIcon icon="Save" tooltip="Save the painted map to the map file" onPress={saveMapFile} />
      </C.HW_BuildBarRow>
      <C.HW_BuildTray>
        <Tray state={s} onPatch={props.onPatch} />
      </C.HW_BuildTray>
    </C.HW_BuildBar>
  );
}
