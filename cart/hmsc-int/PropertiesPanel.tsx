// PropertiesPanel — the in-focus (top-left) panel. Whatever is in FOCUS (tile,
// building, or object) populates here. Two bands: a HEADER BANNER that gathers
// every visual indicator in one place (swatch + the bespoke "numbers that
// resonate" gauges + the profile radar), and below it a dense grouped DATA STRIP
// (the precise values as compact controls). Edits here are PER-INSTANCE.
//
// Styling is entirely classifier-driven: every colour/size comes from theme.ts
// via studio.cls (importing it seeds the studio theme). No raw UI colours here;
// the only literal colours are game DATA (a tile's render colour, a swatch fill).
// Theme tokens for the vizzes are pulled with accentFor().
//
// Graph-based vizzes (radar, friction gauge) draw as SVG-category strokes/fills
// today; the SDF/Effect substrate can swap in underneath without touching this.
//
// Face skins show a SWATCH OF WHAT IT IS — a live mini-render of the real facade
// (office glass / residential brick / plain wall). Pick a face, then a skin.

import { useMemo, useState } from 'react';
import { renderTick } from './editors/build/editLatency';
import { useRerender } from '@reactjit/runtime/hooks';
import { Box, ScrollView, Text, Graph, Pressable, StaticSurface } from '@reactjit/primitives';
import { PanelGroups, type FieldSpec, type PanelSpec } from './shell/fields';
import type { Building, BuildingSkin, GameState, TileKind, WorldProp } from './design';
import { isTileKind, tileKindDefinition } from './world/tileKinds';
import { tileAltitudeAtWorldPosition, type TileAltitudeSample } from './world/tileAltitude';
import { buildingKindDefinition } from './world/buildingKinds';
import { propKindDefinition } from './game/kinds/props';
import { GAME_BUILD } from './game';
import { buildingSkinFacade } from './render3d/buildingSkins';
import { FACE_ROLES, SKIN_NAMES, currentFaceSkins } from './buildingEditor';
import { cellAddress } from './address';
import { C, accentFor } from './studio.cls';
import {
  OVERRIDABLE, cellKey, defValue,
  type SelCell, type OverrideStore, type OverrideValue, type OverridableProp,
} from './tileOverrides';

export type Focus =
  | { kind: 'tile'; tile: TileKind; cell?: { x: number; z: number } }
  | { kind: 'tiles'; cells: SelCell[] }
  | { kind: 'building'; id: string }
  | { kind: 'prop'; id: string }
  // a BUILD piece (floor/wall/ramp/…) by catalog id — held or selected (req_1962),
  // so the panel identifies the piece you're holding instead of the tile brush.
  | { kind: 'piece'; id: string };

type Role = typeof FACE_ROLES[number];

// PROPSFOLD-0610 (structure review §5.2): the data strip renders through THE
// field renderer (shell/fields.tsx PanelGroups) — this file only EMITS a
// PanelSpec. The bespoke hero band (radar, gauges, face-skin thumbs) stays.
// Editable tile-override rows became real num fields (entry + slider, the L2
// law) with the reset rider as the clear-to-default affordance; the hand-
// rolled Row/Field/Stepper layer is gone.

// Threaded into the spec builder when a tile (or group) is in focus: apply /
// clear an override on the whole selection. Absent → read-only inspector.
type EditCtx = { onSet: (path: string, value: OverrideValue) => void; onClear: (path: string) => void };

const NEUTRAL_PERCEPTION = { high: 0 };
const PROPERTIES_SCROLL_STYLE = { flexGrow: 1, height: '100%' };
const PROPERTIES_SCROLL_CONTENT_STYLE = { paddingBottom: 14 };

function fmt(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (v == null) return '—';
  return String(v);
}
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// ── Indicator vizzes (live in the header banner) ────────────────────────────

// opacity → literal translucency over a checker
function OpacityViz({ v }: { v: number }) {
  const a = accentFor('offTrack'), b = accentFor('controlBg');
  const cell = (c: string) => <Box style={{ width: 12, height: 12, backgroundColor: c }} />;
  return (
    <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Box style={{ width: 24, height: 24, position: 'relative', overflow: 'hidden', borderWidth: 1, borderColor: accentFor('controlBorder') }}>
        <Box style={{ flexDirection: 'row' }}>{cell(a)}{cell(b)}</Box>
        <Box style={{ flexDirection: 'row' }}>{cell(b)}{cell(a)}</Box>
        <Box style={{ position: 'absolute', left: 0, top: 0, width: 24, height: 24, backgroundColor: accentFor('valText'), opacity: clamp01(v) }} />
      </Box>
      <C.SliderValue>{v.toFixed(2)}</C.SliderValue>
    </Box>
  );
}

// lightThru → a dark window with an amber glow scaled by transmission
function LightViz({ v }: { v: number }) {
  return (
    <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Box style={{ width: 24, height: 24, position: 'relative', overflow: 'hidden', borderWidth: 1, borderColor: accentFor('controlBorder'), backgroundColor: accentFor('bgAlt') }}>
        <Box style={{ position: 'absolute', left: 4, top: 4, width: 16, height: 16, backgroundColor: accentFor('warning'), opacity: clamp01(v) }} />
      </Box>
      <C.SliderValue>{v.toFixed(2)}</C.SliderValue>
    </Box>
  );
}

// height (meters) → a bar against a ~2m human reference tick
function HeightViz({ m }: { m: number }) {
  const maxM = 4, H = 26;
  const fillH = Math.round(H * clamp01(m / maxM));
  const refY = Math.round(H * (Math.min(2, maxM) / maxM));
  return (
    <Box style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
      <Box style={{ width: 10, height: H, position: 'relative', justifyContent: 'flex-end', backgroundColor: accentFor('track') }}>
        <Box style={{ width: 10, height: fillH, backgroundColor: accentFor('warning') }} />
        <Box style={{ position: 'absolute', left: -2, bottom: refY, width: 14, height: 1, backgroundColor: accentFor('textDim') }} />
      </Box>
      <C.FieldValueNum>{`${fmt(m)}m`}</C.FieldValueNum>
    </Box>
  );
}

// ── Graph (SVG-category) helpers ────────────────────────────────────────────
function radarRing(cx: number, cy: number, r: number, vals: number[]): number[] {
  const out: number[] = []; const n = vals.length;
  for (let i = 0; i <= n; i++) {
    const k = i % n; const a = -Math.PI / 2 + (Math.PI * 2 * k) / n; const v = clamp01(vals[k]);
    out.push(cx + Math.cos(a) * v * r, cy + Math.sin(a) * v * r);
  }
  return out;
}
function radarSpoke(cx: number, cy: number, r: number, i: number, n: number): number[] {
  const a = -Math.PI / 2 + (Math.PI * 2 * i) / n;
  return [cx, cy, cx + Math.cos(a) * r, cy + Math.sin(a) * r];
}
function arcPts(cx: number, cy: number, r: number, a0: number, a1: number, steps = 18): number[] {
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) { const a = a0 + (a1 - a0) * i / steps; out.push(cx + Math.cos(a) * r, cy - Math.sin(a) * r); }
  return out;
}

// friction → slick↔grip gauge (track arc + value arc + needle). The stroke
// geometry (two 18-segment arcs + needle) is baked to a quad via StaticSurface,
// keyed on the value — so it redraws only when friction actually changes, not
// every frame. Per-segment capsule strokes are the cost we're avoiding here.
function FrictionGauge({ v }: { v: number }) {
  const t = clamp01(v), W = 50, H = 28, cx = W / 2, cy = H - 4, r = 19;
  const ang = Math.PI * (1 - t);
  const zone = t < 0.4 ? accentFor('error') : t < 0.7 ? accentFor('warning') : accentFor('success');
  const trackPoints = useMemo(() => arcPts(cx, cy, r, Math.PI, 0), [cx, cy, r]);
  const valuePoints = useMemo(() => arcPts(cx, cy, r, Math.PI, ang), [cx, cy, r, ang]);
  const needlePoints = useMemo(
    () => [cx, cy, cx + Math.cos(ang) * r * 0.82, cy - Math.sin(ang) * r * 0.82],
    [cx, cy, r, ang],
  );
  return (
    <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <StaticSurface staticKey={`gauge-fric:${t.toFixed(3)}`} style={{ width: W, height: H }}>
        <Graph style={{ width: W, height: H }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
          <Graph.Polyline points={trackPoints} stroke={accentFor('track')} strokeWidth={3} />
          <Graph.Polyline points={valuePoints} stroke={zone} strokeWidth={3} />
          <Graph.Polyline points={needlePoints} stroke={accentFor('knob')} strokeWidth={1.5} />
        </Graph>
      </StaticSurface>
      <C.SliderValue>{v.toFixed(2)}</C.SliderValue>
    </Box>
  );
}

// profile radar — the tile's character at a glance (5 gameplay axes)
function ProfileRadar({ axes }: { axes: { label: string; v: number }[] }) {
  const S = 84, CX = S / 2, CY = S / 2, R = S / 2 - 15, N = axes.length;
  const labelsKey = axes.map((a) => a.label).join('|');
  const valsKey = axes.map((a) => clamp01(a.v).toFixed(2)).join(',');
  const vals = useMemo(() => axes.map((a) => a.v), [valsKey]);
  const grid = accentFor('borderSoft'), spoke = accentFor('track'), line = accentFor('primary');
  const fill = accentFor('primary') + '44', dim = accentFor('textFaint');
  // The whole web (3 rings + N spokes + fill polygon + outline) is per-segment
  // capsule/poly geometry — baked to a quad via StaticSurface keyed on the axis
  // values, so it only re-rasterises when the profile changes, not per frame.
  const radarKey = `radar:${valsKey}`;
  const gridRings = useMemo(
    () => [0.34, 0.67, 1].map((g) => ({ key: g, points: radarRing(CX, CY, R, new Array(N).fill(g)) })),
    [CX, CY, R, N],
  );
  const spokes = useMemo(
    () => axes.map((axis, i) => ({ key: axis.label, points: radarSpoke(CX, CY, R, i, N) })),
    [labelsKey, CX, CY, R, N],
  );
  const valueRing = useMemo(() => radarRing(CX, CY, R, vals), [CX, CY, R, vals]);
  return (
    <Box style={{ width: S, height: S, position: 'relative' }}>
      <StaticSurface staticKey={radarKey} style={{ width: S, height: S }}>
        <Graph style={{ width: S, height: S }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
          {gridRings.map((g) => <Graph.Polyline key={g.key} points={g.points} stroke={grid} strokeWidth={1} />)}
          {spokes.map((s) => <Graph.Polyline key={s.key} points={s.points} stroke={spoke} strokeWidth={1} />)}
          <Graph.Polygon points={valueRing} fill={fill} />
          <Graph.Polyline points={valueRing} stroke={line} strokeWidth={1.5} />
        </Graph>
      </StaticSurface>
      {axes.map((a, i) => {
        const ang = -Math.PI / 2 + (Math.PI * 2 * i) / N;
        const lx = CX + Math.cos(ang) * (R + 9), ly = CY + Math.sin(ang) * (R + 6);
        return <Text key={a.label} style={{ position: 'absolute', left: lx - 14, top: ly - 4, width: 28, textAlign: 'center', fontSize: 7, fontFamily: 'monospace', color: dim }}>{a.label}</Text>;
      })}
    </Box>
  );
}

function Indicator({ label, children }: { label: string; children: any }) {
  return (
    <Box style={{ alignItems: 'flex-start', gap: 3 }}>
      {children}
      <C.SkinRoleLabel>{label}</C.SkinRoleLabel>
    </Box>
  );
}

// ── Strip helpers (the strip itself is shell/fields.tsx — the one renderer) ──

// `color` is game DATA (a real tile/material colour), not UI chrome — legit literal.
function Swatch({ color, size = 20 }: { color: string; size?: number }) {
  return <C.ChipSwatch style={{ width: size, height: size, backgroundColor: color }} />;
}

/** read-only value row */
function V(label: string, value: unknown): FieldSpec {
  return { k: label, t: 'val', get: () => fmt(value) };
}

// ── Header banner — identity + the consolidated visual indicators ────────────

// The banner is a row: a left column (identity + sub + the small indicators)
// and an optional `aside` (the radar) pinned top-right so its height overlaps
// the identity lines instead of stacking below them — keeps the banner short.
function HeaderBar(props: { kind: string; title: string; sub?: string; children?: any; aside?: any }) {
  return (
    <Box style={{ backgroundColor: accentFor('surface'), borderBottomWidth: 1, borderBottomColor: accentFor('border'), paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
      <Box style={{ flexGrow: 1, minWidth: 0, gap: 5 }}>
        {/* indicators ride INLINE with the title (wrapping), not a separate row
            below — keeps the banner short. */}
        <Box style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, rowGap: 6 }}>
          <C.KindChip><C.KindChipText>{props.kind}</C.KindChipText></C.KindChip>
          <C.HeroName>{props.title}</C.HeroName>
          {props.children}
        </Box>
        {props.sub ? <C.HeroSub>{props.sub}</C.HeroSub> : null}
      </Box>
      {props.aside ?? null}
    </Box>
  );
}

// ── Face skins as facade-thumbnail swatches ─────────────────────────────────

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

// The skin picker for the currently-targeted face. The faces themselves (the
// visual read — each side's current skin) live in the HEADER banner, like every
// other indicator; this strip group is just the editable control: pick a skin to
// apply to whichever face is selected up top.
// Skin chooser shown as a POPOVER over the panel when a header face is clicked —
// the swatches don't live in the strip, they appear on demand for the face.
function SkinPickerPopover(props: { building: Building; role: Role; onPick: (skin: BuildingSkin) => void; onClose: () => void }) {
  const def = buildingKindDefinition(props.building.kind);
  const faces = currentFaceSkins(props.building);
  return (
    <>
      <Pressable onPress={props.onClose} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 10 }} />
      <Box style={{ position: 'absolute', left: 12, top: 52, zIndex: 11, maxWidth: 300, backgroundColor: accentFor('bgAlt'), borderWidth: 1, borderColor: accentFor('border'), padding: 8, gap: 6 }}>
        <C.SkinRoleLabel>{`TEXTURE · ${props.role.toUpperCase()}`}</C.SkinRoleLabel>
        <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {SKIN_NAMES.map((skin) => (
            <Box key={skin} style={{ alignItems: 'center', gap: 3 }}>
              <SkinThumb skin={skin} facadeColor={def.facadeColor} on={faces[props.role] === skin} onPress={() => props.onPick(skin)} />
              <C.SkinRoleLabel>{skin}</C.SkinRoleLabel>
            </Box>
          ))}
        </Box>
      </Box>
    </>
  );
}

// ── Per-kind bodies ──────────────────────────────────────────────────────────

// The SAME body for a kind, a single in-focus cell, or a multi-cell group — the
// format never changes (that was already right). `edit`/`group` make the
// overridable rows editable and show the effective (override-or-default) value;
// without them it's the read-only kind inspector (the active-paint-tile fallback).
function TileBody({ tile, cell, world, edit, group, onEdit }: {
  tile: TileKind;
  cell?: { x: number; z: number };
  world?: GameState;
  edit?: EditCtx;
  group?: { count: number; breakdown: string; cells: SelCell[]; overrides: OverrideStore };
  onEdit: () => void;
}) {
  if (!isTileKind(tile as string)) {
    return <HeaderBar kind="TILE" title="missing tile kind" sub={String(tile)} />;
  }
  const def = tileKindDefinition(tile);
  const altitude = summarizeAltitude(
    world,
    group?.cells ?? (cell ? [{ gx: cell.x, gz: cell.z, kind: tile }] : []),
  );
  const byPath = new Map<string, OverridableProp>();
  for (const p of OVERRIDABLE) byPath.set(p.path, p);

  // Effective value + overridden flag for an overridable path, summarised across
  // the selection (single cell → just that one). Falls back to the kind default.
  const eff = (path: string, dflt: OverrideValue): { value: unknown; overridden: boolean } => {
    if (!group) return { value: dflt, overridden: false };
    const s = summarize(byPath.get(path)!, group.cells, group.overrides);
    return { value: s.mixedOv ? NaN : (s.uniformOv ?? s.uniformDef ?? dflt), overridden: s.nOverridden > 0 };
  };
  // A finite reading for the header gauges (they can't render "mixed").
  const gv = (path: string, dflt: number) => { const v = Number(eff(path, dflt).value); return Number.isFinite(v) ? v : dflt; };
  // Field builder: editable iff a cell/group is in focus AND the path is in the
  // OVERRIDABLE table — then it is a REAL field through the one renderer
  // (num = entry + slider per L2; the reset rider is the clear-to-default).
  const F = (label: string, dflt: unknown, path?: string): FieldSpec => {
    if (edit && path && byPath.has(path)) {
      const p = byPath.get(path)!;
      const e = eff(path, dflt as OverrideValue);
      const reset = { hint: fmt(dflt), isDefault: () => !e.overridden, run: () => edit.onClear(p.path) };
      if (p.ctl === 'bool') {
        return { k: label, t: 'bool', get: () => !!e.value, set: (v: boolean) => edit.onSet(p.path, v), reset };
      }
      const step = p.step ?? 0.1;
      const fallback = Number(dflt);
      return {
        k: label, t: 'num',
        min: p.min ?? 0, max: p.max ?? 1, step,
        precision: step >= 1 ? 0 : step >= 0.1 ? 1 : 2,
        get: () => { const v = Number(e.value); return Number.isFinite(v) ? v : fallback; },
        set: (v: number) => edit.onSet(p.path, v),
        reset,
      };
    }
    return V(label, dflt);
  };

  const spec: PanelSpec = { groups: [
    { title: 'PATHING', fields: [
      F('walkable', def.pathing.walkable, 'pathing.walkable'),
      F('moveCost', def.pathing.movementCost, 'pathing.movementCost'),
      F('blocksLoS', def.pathing.blocksLineOfSight, 'pathing.blocksLineOfSight'),
    ] },
    { title: 'COVER', fields: [
      F('height', def.cover.height),
      F('protection', def.cover.protection, 'cover.protection'),
      F('conceal', def.cover.concealment, 'cover.concealment'),
      F('shootOver', def.cover.shootOver),
      F('leanAround', def.cover.leanAround),
      F('crouchReq', def.cover.crouchRequired),
    ] },
    { title: 'VISIBILITY', fields: [
      F('opacity', def.visibility.opacity, 'visibility.opacity'),
      F('conceal', def.visibility.concealment),
      F('lightThru', def.visibility.lightTransmission, 'visibility.lightTransmission'),
      F('soundOcc', def.visibility.soundOcclusion),
      F('blocksLoS', def.visibility.blocksLineOfSight),
    ] },
    { title: 'TRAVERSAL', fields: [
      F('modes', def.traversal.allowedModes),
      F('width', def.traversal.width),
      F('stepUpM', def.traversal.maxStepUpMeters),
      F('clearM', def.traversal.minClearanceMeters),
      F('slopeLim°', def.traversal.slopeLimitDegrees),
      F('crouch', def.traversal.requiresCrouch),
      F('mantle', def.traversal.requiresMantle),
      F('vehGrip×', def.traversal.vehicleGripMultiplier),
    ] },
    { title: 'SURFACE', fields: [
      F('material', def.surface.material),
      F('walk×', def.surface.walkSpeedMultiplier, 'surface.walkSpeedMultiplier'),
      F('run×', def.surface.runSpeedMultiplier, 'surface.runSpeedMultiplier'),
      F('veh×', def.surface.vehicleSpeedMultiplier, 'surface.vehicleSpeedMultiplier'),
      F('accel×', def.surface.accelerationMultiplier),
      F('friction', def.surface.friction, 'surface.friction'),
      F('latGrip', def.surface.lateralGrip, 'surface.lateralGrip'),
      F('restitution', def.surface.restitution, 'surface.restitution'),
    ] },
    { title: 'ALTITUDE', fields: [
      F('sample', def.altitude.sample),
      F('followsHF', def.altitude.followsHeightfield),
      F('offsetM', def.altitude.surfaceOffsetMeters),
      ...(altitude ? [
        F('source', altitude.source),
        F('meshY', altitudeRange(altitude, 'baseMeters')),
        F('tileY', altitudeRange(altitude, 'surfaceMeters')),
      ] : []),
    ] },
    { title: 'NPC', fields: [
      F('traversable', def.npc.traversable),
      F('walkCost', def.npc.walkCost),
      F('runCost', def.npc.runCost),
      F('vehCost', def.npc.vehicleCost),
      F('vehPref', def.npc.preferredByVehicles),
      F('cover', def.npc.cover),
      F('noise', def.npc.noise),
    ] },
  ] };
  const radarAxes = [
    { label: 'fric', v: gv('surface.friction', def.surface.friction) },
    { label: 'grip', v: gv('surface.lateralGrip', def.surface.lateralGrip) },
    { label: 'light', v: gv('visibility.lightTransmission', def.visibility.lightTransmission) },
    { label: 'cover', v: gv('cover.protection', def.cover.protection) },
    { label: 'concl', v: gv('cover.concealment', def.cover.concealment) },
  ];
  // Header identity: a group of 2+ reads as the group; one cell (or a kind) reads
  // as that tile (kind label + address) — never "1 selected".
  const isGroup = !!group && group.count > 1;
  const kindChip = isGroup ? 'TILES' : 'TILE';
  const title = isGroup ? `${group!.count} tiles` : def.label;
  const sub = isGroup ? group!.breakdown
    : cell ? `${cellAddress(cell.x, cell.z)} · ${cell.x}, ${cell.z} · ${def.render.textureKey}`
    : `kind: ${tile} · ${def.render.textureKey}`;
  return (
    <Box>
      <HeaderBar kind={kindChip} title={title} sub={sub} aside={<ProfileRadar axes={radarAxes} />}>
        <Indicator label="colour"><Swatch color={def.render.color} size={34} /></Indicator>
        <Indicator label="height"><HeightViz m={def.render.heightMeters} /></Indicator>
        {altitude ? <Indicator label="altitude"><C.FieldValueNum>{altitudeRange(altitude, 'surfaceMeters')}</C.FieldValueNum></Indicator> : null}
        <Indicator label="opacity"><OpacityViz v={gv('visibility.opacity', def.visibility.opacity)} /></Indicator>
        <Indicator label="lightThru"><LightViz v={gv('visibility.lightTransmission', def.visibility.lightTransmission)} /></Indicator>
        <Indicator label="friction"><FrictionGauge v={gv('surface.friction', def.surface.friction)} /></Indicator>
      </HeaderBar>
      <PanelGroups spec={spec} onEdit={onEdit} />
    </Box>
  );
}

function BuildingBody(props: { building: Building; onSetFace?: (id: string, role: Role, skin: BuildingSkin) => void; onEdit: () => void }) {
  const b = props.building;
  const def = buildingKindDefinition(b.kind);
  const faces = currentFaceSkins(b);
  const [picking, setPicking] = useState<Role | null>(null);
  const spec: PanelSpec = { groups: [
    { title: 'IDENTITY', fields: [
      V('id', b.id), V('kind', b.kind), V('label', b.label), V('enclosure', b.enclosure),
      V('doorSide', b.doorSide), V('interiorId', b.interiorId), V('by', b.createdByCommand),
    ] },
    { title: 'FOOTPRINT', fields: [
      V('at', cellAddress(Math.round(b.x), Math.round(b.z))),
      V('x,y,z', `${fmt(b.x)}, ${fmt(b.y)}, ${fmt(b.z)}`),
      V('width', `${fmt(b.widthTiles)}m`),
      V('depth', `${fmt(b.depthTiles)}m`),
    ] },
    { title: 'KIND DEFAULTS', fields: [
      V('structure', def.structureModel), V('storeys', def.storeys), V('wallTile', def.wallTileKind),
      V('defEnclose', def.defaultEnclosure), V('default w×d', `${fmt(def.defaultWidthTiles)}×${fmt(def.defaultDepthTiles)}`),
    ] },
  ] };
  return (
    <Box style={{ position: 'relative' }}>
      <HeaderBar kind="BUILDING" title={def.label} sub={b.id}>
        <Indicator label="facade"><Swatch color={def.facadeColor} size={26} /></Indicator>
        {FACE_ROLES.map((r) => (
          <Indicator key={r} label={r}>
            <SkinThumb skin={faces[r]} facadeColor={def.facadeColor} on={picking === r} onPress={() => setPicking((p) => (p === r ? null : r))} w={30} h={22} />
          </Indicator>
        ))}
      </HeaderBar>
      <PanelGroups spec={spec} onEdit={props.onEdit} />
      {picking !== null ? (
        <SkinPickerPopover
          building={b} role={picking}
          onPick={(skin) => { if (picking) props.onSetFace?.(b.id, picking, skin); setPicking(null); }}
          onClose={() => setPicking(null)}
        />
      ) : null}
    </Box>
  );
}

function PropBody({ prop, onEdit }: { prop: WorldProp; onEdit: () => void }) {
  const p = prop;
  const def = propKindDefinition(p.kind);
  const propColor = tileKindDefinition(def.tileKind).render.color;
  const spec: PanelSpec = { groups: [
    { title: 'IDENTITY', fields: [
      V('id', p.id), V('kind', p.kind), V('label', def.label), V('by', p.createdByCommand),
    ] },
    { title: 'PLACEMENT', fields: [
      V('at', cellAddress(Math.round(p.x), Math.round(p.z))),
      V('x,y,z', `${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)}`),
      V('yaw°', p.yawDegrees),
      V('signal', p.signalOverride),
    ] },
    { title: 'KIND', fields: [
      V('solid', def.solid),
      V('footprintR', `${fmt(def.footprintRadiusMeters)}m`),
      V('borrowsTile', def.tileKind),
      V('traffic', def.trafficControl),
    ] },
  ] };
  return (
    <Box>
      <HeaderBar kind="OBJECT" title={def.label} sub={`${p.id} · borrows ${def.tileKind}`}>
        <Indicator label="tile"><Swatch color={propColor} size={34} /></Indicator>
        <Indicator label="height"><HeightViz m={def.heightMeters} /></Indicator>
      </HeaderBar>
      <PanelGroups spec={spec} onEdit={onEdit} />
    </Box>
  );
}

function Empty() {
  return (
    <C.EmptyState>
      <C.EmptyTitle>NOTHING IN FOCUS</C.EmptyTitle>
      <C.EmptyHint>pick the pointer ▸ and click a tile (ctrl-click to add more), building, or object</C.EmptyHint>
    </C.EmptyState>
  );
}

// ── Group-selection helpers ──────────────────────────────────────────────────
//
// A group selection (possibly mixed kinds) is edited as one — set a property on
// every selected cell at once. summarize() collapses the selection's overrides +
// kind defaults for a path into one effective reading (uniform / mixed) that
// TileBody renders. An override PATCHES the property only; the tile kind is never
// changed, so a mix of grass + mud stays grass + mud, just with a shared value.

interface PropSummary {
  count: number;
  nOverridden: number;
  uniformOv?: OverrideValue;   // override value if every override agrees
  uniformDef?: OverrideValue;  // kind default if every selected kind agrees
  mixedOv: boolean;            // overrides disagree across the selection
}

function summarize(p: OverridableProp, cells: SelCell[], overrides: OverrideStore): PropSummary {
  const ov = new Set<OverrideValue>(); const df = new Set<OverrideValue>();
  let nOverridden = 0;
  for (const c of cells) {
    const o = overrides.get(cellKey(c.gx, c.gz))?.[p.path];
    if (o !== undefined) { nOverridden++; ov.add(o); }
    if (c.kind) { const d = defValue(c.kind, p.path); if (d !== undefined) df.add(d); }
  }
  return {
    count: cells.length, nOverridden,
    uniformOv: ov.size === 1 ? [...ov][0] : undefined,
    uniformDef: df.size === 1 ? [...df][0] : undefined,
    mixedOv: ov.size > 1,
  };
}

// A selection's kind breakdown for the group header, e.g. "grass×6  mud×4".
function kindBreakdown(cells: SelCell[]): string {
  const counts = new Map<string, number>();
  for (const c of cells) { const k = c.kind ?? 'empty'; counts.set(k, (counts.get(k) ?? 0) + 1); }
  return [...counts.entries()].map(([k, n]) => `${k}×${n}`).join('  ');
}

type AltitudeSummary = {
  source: string;
  samples: TileAltitudeSample[];
};

function summarizeAltitude(world: GameState | undefined, cells: SelCell[]): AltitudeSummary | null {
  if (!world || !cells.length) return null;
  const samples: TileAltitudeSample[] = [];
  const c = world.world.cellSizeMeters;
  for (const cell of cells) {
    if (!cell.kind) continue;
    samples.push(tileAltitudeAtWorldPosition(
      world,
      cell.kind,
      (cell.gx + 0.5) * c,
      (cell.gz + 0.5) * c,
      0,
    ));
  }
  if (!samples.length) return null;
  const sources = new Set(samples.map((s) => s.source));
  return { source: sources.size === 1 ? samples[0].source : 'mixed', samples };
}

function altitudeRange(summary: AltitudeSummary, key: 'baseMeters' | 'surfaceMeters'): string {
  let lo = Infinity;
  let hi = -Infinity;
  for (const sample of summary.samples) {
    lo = Math.min(lo, sample[key]);
    hi = Math.max(hi, sample[key]);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return '—';
  return Math.abs(lo - hi) < 0.005 ? `${fmt(lo)}m` : `${fmt(lo)}-${fmt(hi)}m`;
}

// A held/selected BUILD piece (floor/wall/ramp/…) by catalog id — names what
// you're holding (label + kind + theme + footprint) instead of the tile brush
// leaking through as 'asphalt' (req_1962). Build pieces have no tile/prop focus,
// so this is a compact identity banner, not the full hero band.
function PieceBody(props: { id: string }) {
  let def: any = null;
  try { def = GAME_BUILD.catalog.get(props.id); } catch { def = null; }
  if (!def) return <HeaderBar kind="PIECE" title={props.id} sub="unknown piece" />;
  const s = def.size;
  const dims = s ? `${s.widthMeters}×${s.depthMeters}×${s.heightMeters}m` : '';
  return <HeaderBar kind={String(def.kind).toUpperCase()} title={def.label} sub={`${def.theme}${dims ? ` · ${dims}` : ''}`} />;
}

// ── Panel ────────────────────────────────────────────────────────────────────

export function PropertiesPanel(props: {
  focus: Focus | null;
  world: GameState;
  onSetFace?: (id: string, role: Role, skin: BuildingSkin) => void;
  // Tile-group overrides (the 'tiles' focus). overrides is the live store; the two
  // callbacks apply / clear a property across the whole current selection.
  overrides?: OverrideStore;
  onOverride?: (path: string, value: OverrideValue) => void;
  onClearOverride?: (path: string) => void;
}) {
  renderTick('PropertiesPanel'); // req_1968 diag
  const { focus, world } = props;
  // PanelGroups' controls read through get()/set() closures; onEdit is the
  // re-render after a write (the Workbench's own idiom).
  const onEdit = useRerender();

  let body: React.ReactNode;
  if (!focus) {
    body = <Empty />;
  } else if (focus.kind === 'tile') {
    body = <TileBody tile={focus.tile} cell={focus.cell} world={world} onEdit={onEdit} />;
  } else if (focus.kind === 'tiles') {
    const cells = focus.cells;
    if (!cells.length || !props.overrides || !props.onOverride || !props.onClearOverride) {
      body = <Empty />;
    } else {
      // Representative kind for the read-only viz (radar/gauges/material): the first
      // selected cell's kind. Editable rows show the EFFECTIVE value across the group.
      const repKind = (cells.find((c) => c.kind)?.kind ?? cells[0].kind ?? 'sidewalk') as TileKind;
      const single = cells.length === 1 ? cells[0] : null;
      body = (
        <TileBody
          tile={repKind}
          cell={single ? { x: single.gx, z: single.gz } : undefined}
          world={world}
          edit={{ onSet: props.onOverride, onClear: props.onClearOverride }}
          group={{ count: cells.length, breakdown: kindBreakdown(cells), cells, overrides: props.overrides }}
          onEdit={onEdit}
        />
      );
    }
  } else if (focus.kind === 'building') {
    body = <HeaderBar kind="BUILDING" title="legacy layer removed" sub={focus.id} />;
  } else if (focus.kind === 'piece') {
    body = <PieceBody id={focus.id} />;
  } else {
    const p = world.world.props.find((x) => x.id === focus.id);
    body = p ? <PropBody prop={p} onEdit={onEdit} /> : <HeaderBar kind="OBJECT" title="missing" sub={focus.id} />;
  }

  return (
    <C.StudioBg>
      <C.StatusBar><C.StatusKicker>PROPERTIES</C.StatusKicker></C.StatusBar>
      <ScrollView style={PROPERTIES_SCROLL_STYLE} contentContainerStyle={PROPERTIES_SCROLL_CONTENT_STYLE}>
        {body}
      </ScrollView>
    </C.StudioBg>
  );
}
