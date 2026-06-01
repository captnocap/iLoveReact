// PropertiesPanel — the top-left quadrant. Whatever is in FOCUS populates here:
// a tile, a building, or an object (prop). It is a wide, double-column face that
// lists every property the focused thing carries, grouped by category, plus the
// texture / skin swatches that drive its appearance.
//
// "Focus" is a separate concern (the canvas pointer will set it). This component
// only renders a Focus descriptor + the staged world it resolves ids against, so
// it stays a pure display surface — hand it a focus and it populates.

import { Box, Pressable, ScrollView, Text } from '@reactjit/primitives';
import type { Building, BuildingSkin, GameState, TileKind, WorldProp } from '../hmsc/design';
import { tileKindDefinition } from '../hmsc/world/tileKinds';
import { buildingKindDefinition } from '../hmsc/world/buildingKinds';
import { propKindDefinition } from '../hmsc/world/propKinds';
import { FACE_ROLES, SKIN_NAMES, currentFaceSkins } from './buildingEditor';
import { cellAddress } from './address';

// What is being inspected. The pointer tool will produce these; for now the cart
// can hand a tile focus straight from the active paint tile.
export type Focus =
  | { kind: 'tile'; tile: TileKind; cell?: { x: number; z: number } }
  | { kind: 'building'; id: string }
  | { kind: 'prop'; id: string };

type Row = [label: string, value: string];
type Group = { title: string; rows: Row[] };

function fmt(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (v == null) return '—';
  return String(v);
}

// ── Atoms ────────────────────────────────────────────────────────────────────

function Swatch(props: { color: string; size?: number; active?: boolean }) {
  const s = props.size ?? 22;
  return <Box style={{ width: s, height: s, borderRadius: 3, backgroundColor: props.color, borderWidth: props.active ? 2 : 1, borderColor: props.active ? '#f8fafc' : '#1e293b' }} />;
}

function PropRow(props: { label: string; value: string }) {
  return (
    <Box style={{ flexBasis: '48%', flexGrow: 1, minWidth: 118, flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
      <Text fontSize={10} color="#64748b" style={{ fontFamily: 'monospace', flexShrink: 0 }}>{props.label}</Text>
      <Text fontSize={10} color="#cbd5e1" style={{ fontFamily: 'monospace', flexShrink: 1, textAlign: 'right' }}>{props.value}</Text>
    </Box>
  );
}

function Section(props: { title: string; rows: Row[] }) {
  if (!props.rows.length) return null;
  return (
    <Box style={{ gap: 5, borderTopWidth: 1, borderTopColor: '#16202f', paddingTop: 8 }}>
      <Text fontSize={9} color="#38bdf8" style={{ fontWeight: 800, letterSpacing: 1 }}>{props.title}</Text>
      <Box style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 5 }}>
        {props.rows.map(([label, value]) => <PropRow key={label} label={label} value={value} />)}
      </Box>
    </Box>
  );
}

function Header(props: { kind: string; title: string; sub?: string }) {
  return (
    <Box style={{ gap: 2 }}>
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text fontSize={9} color="#0b1320" style={{ fontWeight: 800, letterSpacing: 1, backgroundColor: '#38bdf8', paddingLeft: 5, paddingRight: 5, paddingTop: 1, paddingBottom: 1, borderRadius: 3 }}>{props.kind}</Text>
        <Text fontSize={13} color="#f8fafc" style={{ fontWeight: 800 }}>{props.title}</Text>
      </Box>
      {props.sub ? <Text fontSize={9} color="#475569" style={{ fontFamily: 'monospace' }}>{props.sub}</Text> : null}
    </Box>
  );
}

// ── Per-kind bodies ──────────────────────────────────────────────────────────

function TileBody(props: { tile: TileKind; cell?: { x: number; z: number } }) {
  const def = tileKindDefinition(props.tile);
  const groups: Group[] = [
    { title: 'RENDER', rows: [
      ['color', def.render.color],
      ['texture', def.render.textureKey],
      ['heightM', fmt(def.render.heightMeters)],
    ] },
    { title: 'PATHING', rows: [
      ['walkable', fmt(def.pathing.walkable)],
      ['moveCost', fmt(def.pathing.movementCost)],
      ['blocksLoS', fmt(def.pathing.blocksLineOfSight)],
    ] },
    { title: 'COVER', rows: [
      ['height', def.cover.height],
      ['protection', fmt(def.cover.protection)],
      ['conceal', fmt(def.cover.concealment)],
      ['shootOver', fmt(def.cover.shootOver)],
      ['leanAround', fmt(def.cover.leanAround)],
      ['crouchReq', fmt(def.cover.crouchRequired)],
    ] },
    { title: 'VISIBILITY', rows: [
      ['opacity', fmt(def.visibility.opacity)],
      ['conceal', fmt(def.visibility.concealment)],
      ['lightThru', fmt(def.visibility.lightTransmission)],
      ['soundOcc', fmt(def.visibility.soundOcclusion)],
      ['blocksLoS', fmt(def.visibility.blocksLineOfSight)],
    ] },
    { title: 'TRAVERSAL', rows: [
      ['modes', fmt(def.traversal.allowedModes)],
      ['width', def.traversal.width],
      ['stepUpM', fmt(def.traversal.maxStepUpMeters)],
      ['clearM', fmt(def.traversal.minClearanceMeters)],
      ['slopeLim°', fmt(def.traversal.slopeLimitDegrees)],
      ['crouch', fmt(def.traversal.requiresCrouch)],
      ['mantle', fmt(def.traversal.requiresMantle)],
      ['vehGrip×', fmt(def.traversal.vehicleGripMultiplier)],
    ] },
    { title: 'SURFACE', rows: [
      ['material', def.surface.material],
      ['walk×', fmt(def.surface.walkSpeedMultiplier)],
      ['run×', fmt(def.surface.runSpeedMultiplier)],
      ['veh×', fmt(def.surface.vehicleSpeedMultiplier)],
      ['accel×', fmt(def.surface.accelerationMultiplier)],
      ['friction', fmt(def.surface.friction)],
      ['latGrip', fmt(def.surface.lateralGrip)],
      ['restitution', fmt(def.surface.restitution)],
    ] },
    { title: 'NPC', rows: [
      ['traversable', fmt(def.npc.traversable)],
      ['walkCost', fmt(def.npc.walkCost)],
      ['runCost', fmt(def.npc.runCost)],
      ['vehCost', fmt(def.npc.vehicleCost)],
      ['vehPref', fmt(def.npc.preferredByVehicles)],
      ['cover', def.npc.cover],
      ['noise', fmt(def.npc.noise)],
    ] },
  ];
  return (
    <Box style={{ gap: 8 }}>
      <Header kind="TILE" title={def.label} sub={props.cell ? `${cellAddress(props.cell.x, props.cell.z)} · ${props.cell.x}, ${props.cell.z}` : `kind: ${props.tile}`} />
      {/* Texture swatch */}
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Swatch color={def.render.color} size={34} />
        <Box style={{ gap: 1 }}>
          <Text fontSize={9} color="#64748b" style={{ fontFamily: 'monospace' }}>texture</Text>
          <Text fontSize={10} color="#cbd5e1" style={{ fontFamily: 'monospace' }}>{def.render.textureKey}</Text>
        </Box>
      </Box>
      {groups.map((g) => <Section key={g.title} title={g.title} rows={g.rows} />)}
    </Box>
  );
}

function BuildingBody(props: { building: Building; onSetFace?: (id: string, role: typeof FACE_ROLES[number], skin: BuildingSkin) => void }) {
  const b = props.building;
  const def = buildingKindDefinition(b.kind);
  const faces = currentFaceSkins(b);
  const groups: Group[] = [
    { title: 'IDENTITY', rows: [
      ['id', b.id],
      ['kind', b.kind],
      ['label', b.label],
      ['enclosure', b.enclosure],
      ['doorSide', b.doorSide],
      ['interiorId', fmt(b.interiorId)],
      ['by', b.createdByCommand],
    ] },
    { title: 'FOOTPRINT', rows: [
      ['at', cellAddress(Math.round(b.x), Math.round(b.z))],
      ['x,y,z', `${fmt(b.x)}, ${fmt(b.y)}, ${fmt(b.z)}`],
      ['width', `${fmt(b.widthTiles)}m`],
      ['depth', `${fmt(b.depthTiles)}m`],
    ] },
    { title: 'KIND DEFAULTS', rows: [
      ['structure', def.structureModel],
      ['storeys', fmt(def.storeys)],
      ['wallTile', def.wallTileKind],
      ['defEnclose', def.defaultEnclosure],
      ['defSkin', def.defaultSkin],
      ['default w×d', `${fmt(def.defaultWidthTiles)}×${fmt(def.defaultDepthTiles)}`],
    ] },
  ];
  return (
    <Box style={{ gap: 8 }}>
      <Header kind="BUILDING" title={def.label} sub={b.id} />
      {/* Facade fallback color swatch */}
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Swatch color={def.facadeColor} size={34} />
        <Box style={{ gap: 1 }}>
          <Text fontSize={9} color="#64748b" style={{ fontFamily: 'monospace' }}>facade</Text>
          <Text fontSize={10} color="#cbd5e1" style={{ fontFamily: 'monospace' }}>{def.facadeColor}</Text>
        </Box>
      </Box>
      {groups.map((g) => <Section key={g.title} title={g.title} rows={g.rows} />)}
      {/* Per-face skin swatches — the building's "textures". */}
      <Box style={{ gap: 6, borderTopWidth: 1, borderTopColor: '#16202f', paddingTop: 8 }}>
        <Text fontSize={9} color="#38bdf8" style={{ fontWeight: 800, letterSpacing: 1 }}>FACE SKINS</Text>
        {FACE_ROLES.map((role) => (
          <Box key={role} style={{ gap: 3 }}>
            <Box style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text fontSize={9} color="#94a3b8" style={{ fontWeight: 700, letterSpacing: 1 }}>{role.toUpperCase()}</Text>
              <Text fontSize={9} color="#64748b" style={{ fontFamily: 'monospace' }}>{faces[role]}</Text>
            </Box>
            <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3 }}>
              {SKIN_NAMES.map((skin) => {
                const on = faces[role] === skin;
                return (
                  <Pressable
                    key={skin}
                    onPress={() => props.onSetFace?.(b.id, role, skin as BuildingSkin)}
                    style={{ paddingLeft: 5, paddingRight: 5, paddingTop: 2, paddingBottom: 2, borderRadius: 3, borderWidth: on ? 2 : 1, borderColor: on ? '#f8fafc' : '#27364a', backgroundColor: on ? '#1e293b' : '#0f1a2e' }}
                  >
                    <Text fontSize={8} color={on ? '#f8fafc' : '#94a3b8'} style={{ fontWeight: on ? 700 : 500 }}>{skin}</Text>
                  </Pressable>
                );
              })}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function PropBody(props: { prop: WorldProp }) {
  const p = props.prop;
  const def = propKindDefinition(p.kind);
  const groups: Group[] = [
    { title: 'IDENTITY', rows: [
      ['id', p.id],
      ['kind', p.kind],
      ['label', def.label],
      ['by', p.createdByCommand],
    ] },
    { title: 'PLACEMENT', rows: [
      ['at', cellAddress(Math.round(p.x), Math.round(p.z))],
      ['x,y,z', `${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)}`],
      ['yaw°', fmt(p.yawDegrees)],
      ['signal', fmt(p.signalOverride)],
    ] },
    { title: 'KIND', rows: [
      ['solid', fmt(def.solid)],
      ['footprintR', `${fmt(def.footprintRadiusMeters)}m`],
      ['heightM', fmt(def.heightMeters)],
      ['borrowsTile', def.tileKind],
      ['traffic', fmt(def.trafficControl)],
    ] },
  ];
  // Props have no swatch color of their own — they borrow a tile's gameplay
  // bundle, so show that tile's color as the appearance proxy.
  const propColor = tileKindDefinition(def.tileKind).render.color;
  return (
    <Box style={{ gap: 8 }}>
      <Header kind="OBJECT" title={def.label} sub={p.id} />
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Swatch color={propColor} size={34} />
        <Box style={{ gap: 1 }}>
          <Text fontSize={9} color="#64748b" style={{ fontFamily: 'monospace' }}>borrows tile</Text>
          <Text fontSize={10} color="#cbd5e1" style={{ fontFamily: 'monospace' }}>{def.tileKind}</Text>
        </Box>
      </Box>
      {groups.map((g) => <Section key={g.title} title={g.title} rows={g.rows} />)}
    </Box>
  );
}

function Empty() {
  return (
    <Box style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 20 }}>
      <Text fontSize={11} color="#475569" style={{ fontWeight: 700, letterSpacing: 1 }}>NOTHING IN FOCUS</Text>
      <Text fontSize={9} color="#3a4a63" style={{ fontFamily: 'monospace', textAlign: 'center' }}>pick the pointer ▸ and click a tile, building, or object</Text>
    </Box>
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────

export function PropertiesPanel(props: {
  focus: Focus | null;
  world: GameState;
  onSetFace?: (id: string, role: typeof FACE_ROLES[number], skin: BuildingSkin) => void;
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
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0b1320', flexDirection: 'column' }}>
      <Box style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: '#16202f' }}>
        <Text fontSize={10} color="#64748b" style={{ fontWeight: 800, letterSpacing: 1 }}>PROPERTIES</Text>
      </Box>
      <ScrollView style={{ flexGrow: 1, height: '100%' }} contentContainerStyle={{ paddingLeft: 10, paddingRight: 10, paddingTop: 8, paddingBottom: 14, gap: 8 }}>
        {body}
      </ScrollView>
    </Box>
  );
}
