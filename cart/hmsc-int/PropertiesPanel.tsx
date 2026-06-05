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

import { useState } from 'react';
import { Box, ScrollView, Text, Graph, Pressable, StaticSurface } from '@reactjit/primitives';
import type { Building, BuildingSkin, GameState, TileKind, WorldProp } from '../hmsc/design';
import { tileKindDefinition } from '../hmsc/world/tileKinds';
import { tileAltitudeAtWorldPosition, type TileAltitudeSample } from '../hmsc/world/tileAltitude';
import { buildingKindDefinition } from '../hmsc/world/buildingKinds';
import { propKindDefinition } from '../hmsc/world/propKinds';
import { buildingSkinFacade } from '../hmsc/render3d/buildingSkins';
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
  | { kind: 'prop'; id: string };

type Role = typeof FACE_ROLES[number];

type Ctl = 'bool' | 'scalar' | 'num' | 'text' | 'color';
// A row is read-only unless it carries an `edit` prop — then its value is the
// effective (override-or-default) value and the control becomes interactive,
// writing an override across the whole selection. `overridden` accents it.
type Row = { label: string; ctl: Ctl; value: unknown; edit?: OverridableProp; overridden?: boolean };
type Group = { title: string; accent: string; rows: Row[] };
// Threaded into Field when a tile (or group) is in focus: apply / clear an override
// on the whole selection. Absent → the panel is read-only (building / prop focus).
type EditCtx = { onSet: (path: string, value: OverrideValue) => void; onClear: (path: string) => void };

const clampN = (n: number, lo?: number, hi?: number) =>
  Math.max(lo ?? -Infinity, Math.min(hi ?? Infinity, n));

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

// ── Indicator vizzes (live in the header banner) ────────────────────────────

// scalar 0–1 bar (pixel widths — % on an absolute fill isn't resolved by layout)
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
  return (
    <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <StaticSurface staticKey={`gauge-fric:${t.toFixed(3)}`} style={{ width: W, height: H }}>
        <Graph style={{ width: W, height: H }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
          <Graph.Polyline points={arcPts(cx, cy, r, Math.PI, 0)} stroke={accentFor('track')} strokeWidth={3} />
          <Graph.Polyline points={arcPts(cx, cy, r, Math.PI, ang)} stroke={zone} strokeWidth={3} />
          <Graph.Polyline points={[cx, cy, cx + Math.cos(ang) * r * 0.82, cy - Math.sin(ang) * r * 0.82]} stroke={accentFor('knob')} strokeWidth={1.5} />
        </Graph>
      </StaticSurface>
      <C.SliderValue>{v.toFixed(2)}</C.SliderValue>
    </Box>
  );
}

// profile radar — the tile's character at a glance (5 gameplay axes)
function ProfileRadar({ axes }: { axes: { label: string; v: number }[] }) {
  const S = 84, CX = S / 2, CY = S / 2, R = S / 2 - 15, N = axes.length;
  const vals = axes.map((a) => a.v);
  const grid = accentFor('borderSoft'), spoke = accentFor('track'), line = accentFor('primary');
  const fill = accentFor('primary') + '44', dim = accentFor('textFaint');
  // The whole web (3 rings + N spokes + fill polygon + outline) is per-segment
  // capsule/poly geometry — baked to a quad via StaticSurface keyed on the axis
  // values, so it only re-rasterises when the profile changes, not per frame.
  const radarKey = `radar:${vals.map((v) => clamp01(v).toFixed(2)).join(',')}`;
  return (
    <Box style={{ width: S, height: S, position: 'relative' }}>
      <StaticSurface staticKey={radarKey} style={{ width: S, height: S }}>
        <Graph style={{ width: S, height: S }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
          {[0.34, 0.67, 1].map((g) => <Graph.Polyline key={g} points={radarRing(CX, CY, R, new Array(N).fill(g))} stroke={grid} strokeWidth={1} />)}
          {axes.map((_, i) => <Graph.Polyline key={i} points={radarSpoke(CX, CY, R, i, N)} stroke={spoke} strokeWidth={1} />)}
          <Graph.Polygon points={radarRing(CX, CY, R, vals)} fill={fill} />
          <Graph.Polyline points={radarRing(CX, CY, R, vals)} stroke={line} strokeWidth={1.5} />
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

// ── Strip controls ───────────────────────────────────────────────────────────

function ToggleView({ on }: { on: boolean }) {
  const Track = on ? C.ToggleTrackOn : C.ToggleTrack;
  const Knob = on ? C.ToggleKnobOn : C.ToggleKnob;
  return <Track><Knob /></Track>;
}

// `color` is game DATA (a real tile/material colour), not UI chrome — legit literal.
function Swatch({ color, size = 20 }: { color: string; size?: number }) {
  return <C.ChipSwatch style={{ width: size, height: size, backgroundColor: color }} />;
}

// The clear-to-default ✕ — only when an override is live on the row.
function ClearOverride({ onPress }: { onPress: () => void }) {
  return <C.ClearBtn onPress={onPress}><C.ClearBtnText>✕</C.ClearBtnText></C.ClearBtn>;
}

// An editable numeric / scalar — the sheet's existing Stepper, accented when set.
function EditNum({ row, edit }: { row: Row; edit: EditCtx }) {
  const p = row.edit!;
  const cur = Number(row.value);
  const has = Number.isFinite(cur);
  const Root = row.overridden ? C.StepperOn : C.Stepper;
  const Val = row.overridden ? C.StepperValueOn : C.StepperValue;
  const set = (d: number) => edit.onSet(p.path, clampN(Number(((has ? cur : 0) + d).toFixed(4)), p.min, p.max));
  return (
    <Root>
      <C.StepperBtn onPress={() => set(-(p.step ?? 0.1))}><C.StepperBtnText>−</C.StepperBtnText></C.StepperBtn>
      <Val>{has ? cur.toFixed(2) : '—'}</Val>
      <C.StepperBtn onPress={() => set(p.step ?? 0.1)}><C.StepperBtnText>+</C.StepperBtnText></C.StepperBtn>
    </Root>
  );
}

function Field({ row, edit }: { row: Row; edit?: EditCtx }) {
  // Editable (a tile/group is in focus and this property is overridable).
  if (edit && row.edit) {
    const p = row.edit;
    const control = p.ctl === 'bool'
      ? <Pressable onPress={() => edit.onSet(p.path, !row.value)}><ToggleView on={!!row.value} /></Pressable>
      : <EditNum row={row} edit={edit} />;
    return (
      <C.Field>
        <C.FieldLabel>{row.label}</C.FieldLabel>
        {control}
        {row.overridden ? <ClearOverride onPress={() => edit.onClear(p.path)} /> : null}
      </C.Field>
    );
  }
  // Read-only.
  const ctl =
    row.ctl === 'bool' ? <ToggleView on={!!row.value} />
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

function GroupView({ group, edit }: { group: Group; edit?: EditCtx }) {
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
        {group.rows.map((r) => <Field key={r.label} row={r} edit={edit} />)}
      </C.FieldStrip>
    </C.Group>
  );
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
function TileBody({ tile, cell, world, edit, group }: {
  tile: TileKind;
  cell?: { x: number; z: number };
  world?: GameState;
  edit?: EditCtx;
  group?: { count: number; breakdown: string; cells: SelCell[]; overrides: OverrideStore };
}) {
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
  // Row builder: editable iff a cell/group is in focus AND the path is overridable.
  const R = (label: string, ctl: Ctl, dflt: unknown, path?: string): Row => {
    if (edit && path && byPath.has(path)) {
      const p = byPath.get(path)!;
      const e = eff(path, dflt as OverrideValue);
      return { label, ctl: p.ctl, value: e.value, edit: p, overridden: e.overridden };
    }
    return { label, ctl, value: dflt };
  };

  const groups: Group[] = [
    { title: 'PATHING', accent: 'info', rows: [
      R('walkable', 'bool', def.pathing.walkable, 'pathing.walkable'),
      R('moveCost', 'num', def.pathing.movementCost, 'pathing.movementCost'),
      R('blocksLoS', 'bool', def.pathing.blocksLineOfSight, 'pathing.blocksLineOfSight'),
    ] },
    { title: 'COVER', accent: 'error', rows: [
      R('height', 'text', def.cover.height),
      R('protection', 'scalar', def.cover.protection, 'cover.protection'),
      R('conceal', 'scalar', def.cover.concealment, 'cover.concealment'),
      R('shootOver', 'bool', def.cover.shootOver),
      R('leanAround', 'bool', def.cover.leanAround),
      R('crouchReq', 'bool', def.cover.crouchRequired),
    ] },
    { title: 'VISIBILITY', accent: 'accentTeal', rows: [
      R('opacity', 'num', def.visibility.opacity, 'visibility.opacity'),
      R('conceal', 'scalar', def.visibility.concealment),
      R('lightThru', 'num', def.visibility.lightTransmission, 'visibility.lightTransmission'),
      R('soundOcc', 'scalar', def.visibility.soundOcclusion),
      R('blocksLoS', 'bool', def.visibility.blocksLineOfSight),
    ] },
    { title: 'TRAVERSAL', accent: 'info', rows: [
      R('modes', 'text', def.traversal.allowedModes),
      R('width', 'text', def.traversal.width),
      R('stepUpM', 'num', def.traversal.maxStepUpMeters),
      R('clearM', 'num', def.traversal.minClearanceMeters),
      R('slopeLim°', 'num', def.traversal.slopeLimitDegrees),
      R('crouch', 'bool', def.traversal.requiresCrouch),
      R('mantle', 'bool', def.traversal.requiresMantle),
      R('vehGrip×', 'num', def.traversal.vehicleGripMultiplier),
    ] },
    { title: 'SURFACE', accent: 'warning', rows: [
      R('material', 'text', def.surface.material),
      R('walk×', 'num', def.surface.walkSpeedMultiplier, 'surface.walkSpeedMultiplier'),
      R('run×', 'num', def.surface.runSpeedMultiplier, 'surface.runSpeedMultiplier'),
      R('veh×', 'num', def.surface.vehicleSpeedMultiplier, 'surface.vehicleSpeedMultiplier'),
      R('accel×', 'num', def.surface.accelerationMultiplier),
      R('friction', 'num', def.surface.friction, 'surface.friction'),
      R('latGrip', 'scalar', def.surface.lateralGrip, 'surface.lateralGrip'),
      R('restitution', 'scalar', def.surface.restitution, 'surface.restitution'),
    ] },
    { title: 'ALTITUDE', accent: 'info', rows: [
      R('sample', 'text', def.altitude.sample),
      R('followsHF', 'bool', def.altitude.followsHeightfield),
      R('offsetM', 'num', def.altitude.surfaceOffsetMeters),
      ...(altitude ? [
        R('source', 'text', altitude.source),
        R('meshY', 'text', altitudeRange(altitude, 'baseMeters')),
        R('tileY', 'text', altitudeRange(altitude, 'surfaceMeters')),
      ] : []),
    ] },
    { title: 'NPC', accent: 'success', rows: [
      R('traversable', 'bool', def.npc.traversable),
      R('walkCost', 'num', def.npc.walkCost),
      R('runCost', 'num', def.npc.runCost),
      R('vehCost', 'num', def.npc.vehicleCost),
      R('vehPref', 'bool', def.npc.preferredByVehicles),
      R('cover', 'text', def.npc.cover),
      R('noise', 'scalar', def.npc.noise),
    ] },
  ];
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
      {groups.map((g) => <GroupView key={g.title} group={g} edit={edit} />)}
    </Box>
  );
}

function BuildingBody(props: { building: Building; onSetFace?: (id: string, role: Role, skin: BuildingSkin) => void }) {
  const b = props.building;
  const def = buildingKindDefinition(b.kind);
  const faces = currentFaceSkins(b);
  const [picking, setPicking] = useState<Role | null>(null);
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
    <Box style={{ position: 'relative' }}>
      <HeaderBar kind="BUILDING" title={def.label} sub={b.id}>
        <Indicator label="facade"><Swatch color={def.facadeColor} size={26} /></Indicator>
        {FACE_ROLES.map((r) => (
          <Indicator key={r} label={r}>
            <SkinThumb skin={faces[r]} facadeColor={def.facadeColor} on={picking === r} onPress={() => setPicking((p) => (p === r ? null : r))} w={30} h={22} />
          </Indicator>
        ))}
      </HeaderBar>
      {groups.map((g) => <GroupView key={g.title} group={g} />)}
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

function PropBody({ prop }: { prop: WorldProp }) {
  const p = prop;
  const def = propKindDefinition(p.kind);
  const propColor = tileKindDefinition(def.tileKind).render.color;
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
      { label: 'borrowsTile', ctl: 'text', value: def.tileKind },
      { label: 'traffic', ctl: 'text', value: def.trafficControl },
    ] },
  ];
  return (
    <Box>
      <HeaderBar kind="OBJECT" title={def.label} sub={`${p.id} · borrows ${def.tileKind}`}>
        <Indicator label="tile"><Swatch color={propColor} size={34} /></Indicator>
        <Indicator label="height"><HeightViz m={def.heightMeters} /></Indicator>
      </HeaderBar>
      {groups.map((g) => <GroupView key={g.title} group={g} />)}
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
  const { focus, world } = props;

  let body: React.ReactNode;
  if (!focus) {
    body = <Empty />;
  } else if (focus.kind === 'tile') {
    body = <TileBody tile={focus.tile} cell={focus.cell} world={world} />;
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
        />
      );
    }
  } else if (focus.kind === 'building') {
    const b = world.world.buildings.find((x) => x.id === focus.id);
    body = b ? <BuildingBody building={b} onSetFace={props.onSetFace} /> : <HeaderBar kind="BUILDING" title="missing" sub={focus.id} />;
  } else {
    const p = world.world.props.find((x) => x.id === focus.id);
    body = p ? <PropBody prop={p} /> : <HeaderBar kind="OBJECT" title="missing" sub={focus.id} />;
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
