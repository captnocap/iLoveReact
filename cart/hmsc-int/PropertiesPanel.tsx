// PropertiesPanel — the in-focus (top-left) panel. Whatever is in FOCUS (tile,
// building, or object) populates here as a dense, grouped "spec strip": every
// property rendered as the control matching its type (toggle / scalar bar /
// swatch / value), grouped by category. Edits here are PER-INSTANCE (the panel
// to the right edits the kind). It sizes to its content — the shell wraps it.
//
// Styling is entirely classifier-driven: every colour/size comes from theme.ts
// via studio.cls (importing it seeds the studio theme). No raw UI colours here;
// the only literal colours are game DATA (a tile's render colour, a swatch fill).
// Theme tokens needed for the bespoke vizzes are pulled with accentFor().
//
// Face skins show a SWATCH OF WHAT IT IS — a live mini-render of the real facade
// (office glass / residential brick / plain wall), via the game's own skin
// catalog. Pick a face, then pick a skin; both are visual, no text-name lists.

import { useState } from 'react';
import { Box, ScrollView } from '@reactjit/primitives';
import type { Building, BuildingSkin, GameState, TileKind, WorldProp } from '../hmsc/design';
import { tileKindDefinition } from '../hmsc/world/tileKinds';
import { buildingKindDefinition } from '../hmsc/world/buildingKinds';
import { propKindDefinition } from '../hmsc/world/propKinds';
import { buildingSkinFacade } from '../hmsc/render3d/buildingSkins';
import { FACE_ROLES, SKIN_NAMES, currentFaceSkins } from './buildingEditor';
import { cellAddress } from './address';
import { C, accentFor } from './studio.cls';

export type Focus =
  | { kind: 'tile'; tile: TileKind; cell?: { x: number; z: number } }
  | { kind: 'building'; id: string }
  | { kind: 'prop'; id: string };

type Role = typeof FACE_ROLES[number];

// Control kind + optional bespoke viz for scalars that tell a story.
type Ctl = 'bool' | 'scalar' | 'num' | 'text' | 'color';
type Viz = 'opacity' | 'light' | 'height';
type Row = { label: string; ctl: Ctl; value: unknown; viz?: Viz };
type Group = { title: string; accent: string; rows: Row[] };

const NEUTRAL_PERCEPTION = { high: 0 };
const TRACK_W = 60;

function fmt(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (v == null) return '—';
  return String(v);
}
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// ── Control atoms ──────────────────────────────────────────────────────────

function ToggleView({ on }: { on: boolean }) {
  const Track = on ? C.ToggleTrackOn : C.ToggleTrack;
  const Knob = on ? C.ToggleKnobOn : C.ToggleKnob;
  return <Track><Knob /></Track>;
}

// Scalar 0–1 bar (pixel widths — the layout engine doesn't resolve % on an
// absolutely-positioned fill, so compute from the fixed track width).
function ScalarView({ v }: { v: number }) {
  const fw = Math.round(TRACK_W * clamp01(v));
  return (
    <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <C.SliderTrack>
        <C.SliderFill style={{ width: fw }} />
        <C.SliderKnob style={{ left: Math.max(0, fw - 5) }} />
      </C.SliderTrack>
      <C.SliderValue>{v.toFixed(2)}</C.SliderValue>
    </Box>
  );
}

// opacity → literal translucency over a checker
function OpacityViz({ v }: { v: number }) {
  const a = accentFor('offTrack'), b = accentFor('controlBg');
  const cell = (c: string) => <Box style={{ width: 10, height: 10, backgroundColor: c }} />;
  return (
    <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Box style={{ width: 20, height: 20, position: 'relative', overflow: 'hidden', borderWidth: 1, borderColor: accentFor('controlBorder') }}>
        <Box style={{ flexDirection: 'row' }}>{cell(a)}{cell(b)}</Box>
        <Box style={{ flexDirection: 'row' }}>{cell(b)}{cell(a)}</Box>
        <Box style={{ position: 'absolute', left: 0, top: 0, width: 20, height: 20, backgroundColor: accentFor('valText'), opacity: clamp01(v) }} />
      </Box>
      <C.SliderValue>{v.toFixed(2)}</C.SliderValue>
    </Box>
  );
}

// lightThru → a dark window with an amber glow scaled by transmission
function LightViz({ v }: { v: number }) {
  return (
    <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Box style={{ width: 20, height: 20, position: 'relative', overflow: 'hidden', borderWidth: 1, borderColor: accentFor('controlBorder'), backgroundColor: accentFor('bgAlt') }}>
        <Box style={{ position: 'absolute', left: 3, top: 3, width: 14, height: 14, backgroundColor: accentFor('warning'), opacity: clamp01(v) }} />
      </Box>
      <C.SliderValue>{v.toFixed(2)}</C.SliderValue>
    </Box>
  );
}

// height (meters) → a bar against a ~2m human reference tick
function HeightViz({ m }: { m: number }) {
  const maxM = 4, H = 24;
  const fillH = Math.round(H * clamp01(m / maxM));
  const refY = Math.round(H * (Math.min(2, maxM) / maxM));
  return (
    <Box style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
      <Box style={{ width: 10, height: H, position: 'relative', justifyContent: 'flex-end', overflow: 'visible', backgroundColor: accentFor('track') }}>
        <Box style={{ width: 10, height: fillH, backgroundColor: accentFor('warning') }} />
        <Box style={{ position: 'absolute', left: -2, bottom: refY, width: 14, height: 1, backgroundColor: accentFor('textDim') }} />
      </Box>
      <C.FieldValueNum>{`${fmt(m)}m`}</C.FieldValueNum>
    </Box>
  );
}

// `color` is game DATA (a real tile/material colour), not UI chrome — legit literal.
function Swatch({ color, size = 20 }: { color: string; size?: number }) {
  return <C.ChipSwatch style={{ width: size, height: size, backgroundColor: color }} />;
}

function Field({ row }: { row: Row }) {
  const ctl =
    row.viz === 'opacity' ? <OpacityViz v={Number(row.value)} />
    : row.viz === 'light' ? <LightViz v={Number(row.value)} />
    : row.viz === 'height' ? <HeightViz m={Number(row.value)} />
    : row.ctl === 'bool' ? <ToggleView on={!!row.value} />
    : row.ctl === 'scalar' ? <ScalarView v={Number(row.value)} />
    : row.ctl === 'color' ? (
        <>
          <Swatch color={String(row.value)} size={16} />
          <C.FieldValue>{String(row.value)}</C.FieldValue>
        </>
      )
    : row.ctl === 'num' ? <C.FieldValueNum>{fmt(row.value)}</C.FieldValueNum>
    : <C.FieldValue>{fmt(row.value)}</C.FieldValue>;
  return (
    <C.Field>
      <C.FieldLabel>{row.label}</C.FieldLabel>
      {ctl}
    </C.Field>
  );
}

function GroupView({ group }: { group: Group }) {
  if (!group.rows.length) return null;
  const accent = accentFor(group.accent);
  return (
    <C.Group>
      <C.GroupHead>
        <C.GroupAccentBar style={{ backgroundColor: accent }} />
        <C.GroupTitle color={accent}>{group.title}</C.GroupTitle>
        <C.GroupRule />
        <C.GroupCount>{String(group.rows.length)}</C.GroupCount>
      </C.GroupHead>
      <C.FieldStrip>
        {group.rows.map((r) => <Field key={r.label} row={r} />)}
      </C.FieldStrip>
    </C.Group>
  );
}

function Header(props: { kind: string; title: string; sub?: string }) {
  return (
    <Box style={{ gap: 3, paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 6 }}>
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <C.KindChip><C.KindChipText>{props.kind}</C.KindChipText></C.KindChip>
        <C.HeroName>{props.title}</C.HeroName>
      </Box>
      {props.sub ? <C.HeroSub>{props.sub}</C.HeroSub> : null}
    </Box>
  );
}

function HeroSwatch(props: { color: string; label: string; value: string }) {
  return (
    <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, paddingRight: 12, paddingBottom: 6 }}>
      <Swatch color={props.color} size={34} />
      <Box style={{ gap: 1 }}>
        <C.FieldLabel>{props.label}</C.FieldLabel>
        <C.FieldValue>{props.value}</C.FieldValue>
      </Box>
    </Box>
  );
}

// ── Face skins as facade-thumbnail swatches ─────────────────────────────────

// A swatch IS the skin: render the real facade small (office glass, brick, …).
// 'plain' has no facade panel → the bare wall colour.
function SkinThumb(props: { skin: BuildingSkin; facadeColor: string; w?: number; h?: number; on?: boolean; onPress?: () => void }) {
  const w = props.w ?? 42, h = props.h ?? 30;
  const facade = buildingSkinFacade(props.skin);
  const inner = facade
    ? facade({ skin: props.skin, cols: 2, floors: 3, widthMeters: 6, heightMeters: 9, perception: NEUTRAL_PERCEPTION })
    : <Box style={{ width: '100%', height: '100%', backgroundColor: props.facadeColor }} />;
  return (
    <C.SkinSwatch
      onPress={props.onPress}
      style={{ width: w, height: h, overflow: 'hidden', borderColor: props.on ? accentFor('knob') : accentFor('controlBorder'), borderWidth: props.on ? 2 : 1 }}
    >
      {inner}
    </C.SkinSwatch>
  );
}

function FaceSkins(props: { building: Building; onSetFace?: (id: string, role: Role, skin: BuildingSkin) => void }) {
  const b = props.building;
  const def = buildingKindDefinition(b.kind);
  const faces = currentFaceSkins(b);
  const [role, setRole] = useState<Role>('front');
  const accent = accentFor('success');
  return (
    <C.Group>
      <C.GroupHead>
        <C.GroupAccentBar style={{ backgroundColor: accent }} />
        <C.GroupTitle color={accent}>FACE SKINS</C.GroupTitle>
        <C.GroupRule />
        <C.GroupCount>{faces[role]}</C.GroupCount>
      </C.GroupHead>

      {/* the five faces, each showing its current skin; tap one to target it */}
      <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingLeft: 12, paddingRight: 12, paddingTop: 2 }}>
        {FACE_ROLES.map((r) => (
          <Box key={r} style={{ alignItems: 'center', gap: 3 }}>
            <SkinThumb skin={faces[r]} facadeColor={def.facadeColor} on={r === role} onPress={() => setRole(r)} />
            <C.SkinRoleLabel>{r.toUpperCase()}</C.SkinRoleLabel>
          </Box>
        ))}
      </Box>

      {/* skin palette — pick one to apply to the targeted face */}
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 12, paddingRight: 12, paddingTop: 8 }}>
        <C.SkinRoleLabel>{`APPLY TO ${role.toUpperCase()} →`}</C.SkinRoleLabel>
      </Box>
      <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingLeft: 12, paddingRight: 12, paddingTop: 4 }}>
        {SKIN_NAMES.map((skin) => (
          <Box key={skin} style={{ alignItems: 'center', gap: 3 }}>
            <SkinThumb
              skin={skin}
              facadeColor={def.facadeColor}
              on={faces[role] === skin}
              onPress={() => props.onSetFace?.(b.id, role, skin)}
            />
            <C.SkinRoleLabel>{skin}</C.SkinRoleLabel>
          </Box>
        ))}
      </Box>
    </C.Group>
  );
}

// ── Per-kind bodies ──────────────────────────────────────────────────────────

function TileBody({ tile, cell }: { tile: TileKind; cell?: { x: number; z: number } }) {
  const def = tileKindDefinition(tile);
  // RENDER no longer repeats colour/texture — the hero swatch already shows them.
  const groups: Group[] = [
    { title: 'RENDER', accent: 'primary', rows: [
      { label: 'heightM', ctl: 'num', value: def.render.heightMeters, viz: 'height' },
    ] },
    { title: 'PATHING', accent: 'info', rows: [
      { label: 'walkable', ctl: 'bool', value: def.pathing.walkable },
      { label: 'moveCost', ctl: 'num', value: def.pathing.movementCost },
      { label: 'blocksLoS', ctl: 'bool', value: def.pathing.blocksLineOfSight },
    ] },
    { title: 'COVER', accent: 'error', rows: [
      { label: 'height', ctl: 'text', value: def.cover.height },
      { label: 'protection', ctl: 'scalar', value: def.cover.protection },
      { label: 'conceal', ctl: 'scalar', value: def.cover.concealment },
      { label: 'shootOver', ctl: 'bool', value: def.cover.shootOver },
      { label: 'leanAround', ctl: 'bool', value: def.cover.leanAround },
      { label: 'crouchReq', ctl: 'bool', value: def.cover.crouchRequired },
    ] },
    { title: 'VISIBILITY', accent: 'accentTeal', rows: [
      { label: 'opacity', ctl: 'scalar', value: def.visibility.opacity, viz: 'opacity' },
      { label: 'conceal', ctl: 'scalar', value: def.visibility.concealment },
      { label: 'lightThru', ctl: 'scalar', value: def.visibility.lightTransmission, viz: 'light' },
      { label: 'soundOcc', ctl: 'scalar', value: def.visibility.soundOcclusion },
      { label: 'blocksLoS', ctl: 'bool', value: def.visibility.blocksLineOfSight },
    ] },
    { title: 'TRAVERSAL', accent: 'info', rows: [
      { label: 'modes', ctl: 'text', value: def.traversal.allowedModes },
      { label: 'width', ctl: 'text', value: def.traversal.width },
      { label: 'stepUpM', ctl: 'num', value: def.traversal.maxStepUpMeters },
      { label: 'clearM', ctl: 'num', value: def.traversal.minClearanceMeters },
      { label: 'slopeLim°', ctl: 'num', value: def.traversal.slopeLimitDegrees },
      { label: 'crouch', ctl: 'bool', value: def.traversal.requiresCrouch },
      { label: 'mantle', ctl: 'bool', value: def.traversal.requiresMantle },
      { label: 'vehGrip×', ctl: 'num', value: def.traversal.vehicleGripMultiplier },
    ] },
    { title: 'SURFACE', accent: 'warning', rows: [
      { label: 'material', ctl: 'text', value: def.surface.material },
      { label: 'walk×', ctl: 'num', value: def.surface.walkSpeedMultiplier },
      { label: 'run×', ctl: 'num', value: def.surface.runSpeedMultiplier },
      { label: 'veh×', ctl: 'num', value: def.surface.vehicleSpeedMultiplier },
      { label: 'accel×', ctl: 'num', value: def.surface.accelerationMultiplier },
      { label: 'friction', ctl: 'scalar', value: def.surface.friction },
      { label: 'latGrip', ctl: 'scalar', value: def.surface.lateralGrip },
      { label: 'restitution', ctl: 'scalar', value: def.surface.restitution },
    ] },
    { title: 'NPC', accent: 'success', rows: [
      { label: 'traversable', ctl: 'bool', value: def.npc.traversable },
      { label: 'walkCost', ctl: 'num', value: def.npc.walkCost },
      { label: 'runCost', ctl: 'num', value: def.npc.runCost },
      { label: 'vehCost', ctl: 'num', value: def.npc.vehicleCost },
      { label: 'vehPref', ctl: 'bool', value: def.npc.preferredByVehicles },
      { label: 'cover', ctl: 'text', value: def.npc.cover },
      { label: 'noise', ctl: 'scalar', value: def.npc.noise },
    ] },
  ];
  return (
    <Box>
      <Header kind="TILE" title={def.label} sub={cell ? `${cellAddress(cell.x, cell.z)} · ${cell.x}, ${cell.z}` : `kind: ${tile}`} />
      <HeroSwatch color={def.render.color} label="texture" value={def.render.textureKey} />
      {groups.map((g) => <GroupView key={g.title} group={g} />)}
    </Box>
  );
}

function BuildingBody(props: { building: Building; onSetFace?: (id: string, role: Role, skin: BuildingSkin) => void }) {
  const b = props.building;
  const def = buildingKindDefinition(b.kind);
  const groups: Group[] = [
    { title: 'IDENTITY', accent: 'primary', rows: [
      { label: 'id', ctl: 'text', value: b.id },
      { label: 'kind', ctl: 'text', value: b.kind },
      { label: 'label', ctl: 'text', value: b.label },
      { label: 'enclosure', ctl: 'text', value: b.enclosure },
      { label: 'doorSide', ctl: 'text', value: b.doorSide },
      { label: 'interiorId', ctl: 'text', value: b.interiorId },
      { label: 'by', ctl: 'text', value: b.createdByCommand },
    ] },
    { title: 'FOOTPRINT', accent: 'info', rows: [
      { label: 'at', ctl: 'text', value: cellAddress(Math.round(b.x), Math.round(b.z)) },
      { label: 'x,y,z', ctl: 'text', value: `${fmt(b.x)}, ${fmt(b.y)}, ${fmt(b.z)}` },
      { label: 'width', ctl: 'text', value: `${fmt(b.widthTiles)}m` },
      { label: 'depth', ctl: 'text', value: `${fmt(b.depthTiles)}m` },
    ] },
    { title: 'KIND DEFAULTS', accent: 'warning', rows: [
      { label: 'structure', ctl: 'text', value: def.structureModel },
      { label: 'storeys', ctl: 'num', value: def.storeys },
      { label: 'wallTile', ctl: 'text', value: def.wallTileKind },
      { label: 'defEnclose', ctl: 'text', value: def.defaultEnclosure },
      { label: 'default w×d', ctl: 'text', value: `${fmt(def.defaultWidthTiles)}×${fmt(def.defaultDepthTiles)}` },
    ] },
  ];
  return (
    <Box>
      <Header kind="BUILDING" title={def.label} sub={b.id} />
      <HeroSwatch color={def.facadeColor} label="facade" value={def.facadeColor} />
      {groups.map((g) => <GroupView key={g.title} group={g} />)}
      <FaceSkins building={b} onSetFace={props.onSetFace} />
    </Box>
  );
}

function PropBody({ prop }: { prop: WorldProp }) {
  const p = prop;
  const def = propKindDefinition(p.kind);
  const groups: Group[] = [
    { title: 'IDENTITY', accent: 'primary', rows: [
      { label: 'id', ctl: 'text', value: p.id },
      { label: 'kind', ctl: 'text', value: p.kind },
      { label: 'label', ctl: 'text', value: def.label },
      { label: 'by', ctl: 'text', value: p.createdByCommand },
    ] },
    { title: 'PLACEMENT', accent: 'info', rows: [
      { label: 'at', ctl: 'text', value: cellAddress(Math.round(p.x), Math.round(p.z)) },
      { label: 'x,y,z', ctl: 'text', value: `${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)}` },
      { label: 'yaw°', ctl: 'num', value: p.yawDegrees },
      { label: 'signal', ctl: 'text', value: p.signalOverride },
    ] },
    { title: 'KIND', accent: 'warning', rows: [
      { label: 'solid', ctl: 'bool', value: def.solid },
      { label: 'footprintR', ctl: 'text', value: `${fmt(def.footprintRadiusMeters)}m` },
      { label: 'heightM', ctl: 'num', value: def.heightMeters, viz: 'height' },
      { label: 'borrowsTile', ctl: 'text', value: def.tileKind },
      { label: 'traffic', ctl: 'text', value: def.trafficControl },
    ] },
  ];
  const propColor = tileKindDefinition(def.tileKind).render.color;
  return (
    <Box>
      <Header kind="OBJECT" title={def.label} sub={p.id} />
      <HeroSwatch color={propColor} label="borrows tile" value={def.tileKind} />
      {groups.map((g) => <GroupView key={g.title} group={g} />)}
    </Box>
  );
}

function Empty() {
  return (
    <C.EmptyState>
      <C.EmptyTitle>NOTHING IN FOCUS</C.EmptyTitle>
      <C.EmptyHint>pick the pointer ▸ and click a tile, building, or object</C.EmptyHint>
    </C.EmptyState>
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────

export function PropertiesPanel(props: {
  focus: Focus | null;
  world: GameState;
  onSetFace?: (id: string, role: Role, skin: BuildingSkin) => void;
}) {
  const { focus, world } = props;

  let body: React.ReactNode;
  if (!focus) {
    body = <Empty />;
  } else if (focus.kind === 'tile') {
    body = <TileBody tile={focus.tile} cell={focus.cell} />;
  } else if (focus.kind === 'building') {
    const b = world.world.buildings.find((x) => x.id === focus.id);
    body = b ? <BuildingBody building={b} onSetFace={props.onSetFace} /> : <Header kind="BUILDING" title="missing" sub={focus.id} />;
  } else {
    const p = world.world.props.find((x) => x.id === focus.id);
    body = p ? <PropBody prop={p} /> : <Header kind="OBJECT" title="missing" sub={focus.id} />;
  }

  return (
    <C.StudioBg>
      <C.StatusBar><C.StatusKicker>PROPERTIES</C.StatusKicker></C.StatusBar>
      <ScrollView style={{ flexGrow: 1, height: '100%' }} contentContainerStyle={{ paddingBottom: 14 }}>
        {body}
      </ScrollView>
    </C.StudioBg>
  );
}
