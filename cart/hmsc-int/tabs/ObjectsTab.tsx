// ObjectsTab — the Objects right-rail tab.
//
//   ┌───────────────────────────────┐
//   │  3D viewer (full width)        │   inspected kind, real ModelViewer
//   ├───────────────────────────────┤
//   │  properties (full width)       │   shared PropertiesPanel
//   ├───────────────────────────────┤
//   │  BUILDINGS  ▸  House       ▴   │   breadcrumb foot: category ▸ item
//   └───────────────────────────────┘
//
// The foot is a BREADCRUMB TOOLBAR, not a model gallery. Two segments:
//   • CATEGORY  → popover list of the groups (switch which list you browse)
//   • ITEM      → popover list of that category's items (filterable)
// Pick a row to INSPECT it (loads the viewer + properties above); the green + on a
// placeable row PLACES it without changing what's inspected. Browse (palCat) is
// kept separate from inspect (sel) so opening the item list never disturbs the
// viewer until you actually choose.
//
// The ASSISTANT category is live: it lists the meshes from the assistant's
// scene.json (assist3d/), so whatever the /assist3d route generates shows up here
// to browse + inspect. Those are raw geometry, not game kinds — they render in a
// dedicated <AssistMeshViewer> (the game's ModelViewer only knows building/prop/
// tile kinds) and are inspect-only for now (no placement bridge yet).
//
// There is deliberately NO live 3D in the foot. An earlier build rendered every
// model in the category as a real <Scene3D> strip — a third full 3D pass redrawn
// every frame on a screen that already runs two (the viewer here + the iso
// preview). The single ModelViewer above is the only static-kind 3D this tab draws.
//
// Themed through accentFor() (theme tokens), no raw UI colours.

import { useMemo, useState } from 'react';
import { useRouteTwigState } from '../editors/twigs';
import { Box, Pressable, ScrollView, Text, TextInput } from '@reactjit/primitives';
import { Icon } from '@reactjit/icons/Icon';
import type { TileKind } from '../design';
import { PROP_KINDS, propKindDefinition } from '../game/kinds/props';
import { SCATTER_BRUSHES, SCATTER_BRUSH_IDS, isScatterBrushId, type ScatterBrushId } from '../game/kinds/scatter';
import { WATER_BODY_PRESETS, WATER_BODY_PRESET_IDS } from '../game/kinds/waterBodies';
import { EMBEDDED_TILE_KINDS, GAMEPLAY_TILE_KINDS, PAINTABLE_TILE_KINDS, tileKindDefinition } from '../world/tileKinds';
import { buildObjectWorld, type ObjectWorld } from '../objectPreview';
import { ModelViewer } from '../ModelViewer';
import { ObjectInspect3D } from '../ObjectInspect3D';
import { useKindTextures, kindTexturesFor, setKindTexture } from '../kindTextures';
import { propParts } from '../render3d/propParts';
import type { Part } from '../render3d/parts';
import { PropertiesPanel } from '../PropertiesPanel';
import { shaderSpec } from '@game/textures/shaders';
import { allTextures, textureById } from '@game/textures/registry';
import { useCustomTextures } from '@game/textures/materials';
import { TexturePreview } from '../TexturePreview';
import { ShaderLab } from '../ShaderLab';
import { accentFor } from '../studio.cls';
import { useAssistScene } from '../assist3d/useAssistScene';
import { AssistMeshViewer } from '../assist3d/AssistMeshViewer';
import { round, type MeshSpec } from '../assist3d/scene';
import { GAME_BUILD } from '@game';
import type { BuildPrefabDef, DecomposedPiece, PlacedBuildPiece } from '@game';

type Cat = 'building' | 'prop' | 'scatter' | 'marker' | 'tile' | 'embedded' | 'texture' | 'assistant' | 'water';
type Sel = { cat: Cat; kind: string };
type Group = { cat: Cat; title: string; items: { kind: string; label: string }[] };

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

// The fixed game-kind categories. ASSISTANT is appended in-component because its
// items are live (driven by the watched scene.json).
const STATIC_GROUPS: Group[] = [
  { cat: 'prop', title: 'OBJECTS', items: PROP_KINDS.map((k) => ({ kind: k, label: propKindDefinition(k).label })) },
  // SCATTERBRUSH-0611 (req_0642): procedural nature brushes — arm one and
  // PAINT; the stroke rolls a weighted grass/tree/rock mix per tile.
  { cat: 'scatter', title: 'SCATTER BRUSHES', items: SCATTER_BRUSH_IDS.map((id) => ({ kind: id, label: SCATTER_BRUSHES[id].label })) },
  // MARKERS — gameplay cells you PLACE one at a time (spawn / save), not paint.
  // Placeable (the + drops one), and the save↔spawn link is set on the placed
  // marker in the canvas place-rail.
  { cat: 'marker', title: 'MARKERS', items: GAMEPLAY_TILE_KINDS.map((k) => ({ kind: k, label: tileKindDefinition(k as TileKind).label })) },
  // WATER — bodies of water you DROP (a footprint + a surface level); depth is
  // derived against the terrain bed, so dig under one for a deeper pool.
  { cat: 'water', title: 'WATER', items: WATER_BODY_PRESET_IDS.map((k) => ({ kind: k, label: WATER_BODY_PRESETS[k].label })) },
  { cat: 'tile', title: 'TILES', items: PAINTABLE_TILE_KINDS.map((k) => ({ kind: k, label: tileKindDefinition(k as TileKind).label })) },
  { cat: 'embedded', title: 'EMBEDDED', items: EMBEDDED_TILE_KINDS.map((k) => ({ kind: k, label: tileKindDefinition(k as TileKind).label })) },
  // TEXTURES is appended in-component (not here): the one flat list of bakeable
  // looks is LIVE — built-ins plus the studio's saved materials (allTextures).
];

const isPlaceable = (cat: Cat) => cat === 'building' || cat === 'prop' || cat === 'marker' || cat === 'water';

type Preview = ObjectWorld & { tile?: TileKind; baseDist: number; targetY: number };

// One-object world + camera framing for a (cat, kind). Textures / assistant
// meshes never reach here — they render through their own surfaces. `partTextures`
// folds in the kind's GLOBAL textures so the inspected preview wears them.
function buildPreview(sel: Sel, partTextures?: Record<string, string>): Preview {
  const ow = buildObjectWorld(sel.cat as Exclude<Cat, 'texture' | 'assistant'>, sel.kind, undefined, partTextures);
  if (sel.cat === 'tile' || sel.cat === 'embedded' || sel.cat === 'marker') {
    return { ...ow, tile: sel.kind as TileKind, baseDist: 16, targetY: 0.3 };
  }
  if (sel.cat === 'water') {
    // Frame the whole footprint from above so the surface + the bed depth read.
    const preset = WATER_BODY_PRESETS[sel.kind];
    const span = Math.max(preset?.footW ?? 12, preset?.footD ?? 8);
    return { ...ow, tile: 'water' as TileKind, baseDist: clamp(span * 1.4 + 6, 12, 60), targetY: 0 };
  }
  const def = propKindDefinition(sel.kind as typeof PROP_KINDS[number]);
  return { ...ow, baseDist: clamp(def.heightMeters * 4 + 4, 5, 30), targetY: def.heightMeters * 0.5 };
}

// ── Building prefab → inspectable view ───────────────────────────────────────
// A prefab DECOMPOSES to its semantic pieces (no opaque blobs). We stamp it to
// real placed pieces (the same record F2/iso edit), recentre on the union
// envelope so the orbit camera frames the whole composition, and hand back the
// decomposition for the data panel.
type PrefabView = { pieces: PlacedBuildPiece[]; decomposed: DecomposedPiece[]; baseDist: number; targetY: number };

function buildPrefabView(prefab: BuildPrefabDef): PrefabView {
  const stamped = GAME_BUILD.placed
    .stamp(prefab, { x: 0, y: 0, z: 0 }, 0)
    .map((p, i) => ({ ...p, id: `prefab-view-${i}` } as PlacedBuildPiece));
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, topY = 0;
  for (const piece of stamped) {
    const b = GAME_BUILD.placed.bounds(piece);
    minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
    minZ = Math.min(minZ, b.minZ); maxZ = Math.max(maxZ, b.maxZ);
    topY = Math.max(topY, b.topY);
  }
  if (!isFinite(minX)) { minX = 0; maxX = 0; minZ = 0; maxZ = 0; }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  // Uniform translation preserves relative placement → wall joins still resolve.
  const pieces = stamped.map((p) => ({ ...p, x: p.x - cx, z: p.z - cz }));
  const radius = Math.max(maxX - minX, maxZ - minZ, topY, 4) * 0.5;
  return { pieces, decomposed: GAME_BUILD.prefabs.decompose(prefab), baseDist: clamp(radius * 3.2 + 6, 8, 60), targetY: topY * 0.45 };
}

// The building's DATA as a BILL OF MATERIALS (BOM-0610, review §10.1). The old
// panel mapped decompose() straight to one row per piece — 281 near-identical
// rects, "the outer product instead of the factors" (user: "its all just
// literal noise"). The BOM is the factored sum: one row per distinct
// (kind, material, label) class with a count and its edit-variant tally, under
// a rollup header (footprint, levels, distinct materials). The flat per-piece
// dump survives only behind a "show all N" disclosure — it is debugging
// output, not authoring surface. (Click-a-class→highlight in the inspect view
// joins when the in-focus panel lands on the one renderer, §5.2.)

type BomClass = { label: string; kind: string; material: string; count: number; edits: { edit: string; count: number }[] };
type BomRollup = { classes: BomClass[]; tilesW: number; tilesD: number; levels: number; materials: string[] };

function prefabBillOfMaterials(decomposed: DecomposedPiece[]): BomRollup {
  const byClass = new Map<string, BomClass>();
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const ys = new Set<number>();
  const materials = new Set<string>();
  for (const piece of decomposed) {
    const key = `${piece.def.kind}|${piece.def.material}|${piece.def.label}`;
    let cls = byClass.get(key);
    if (!cls) { cls = { label: piece.def.label, kind: piece.def.kind, material: piece.def.material, count: 0, edits: [] }; byClass.set(key, cls); }
    cls.count += 1;
    if (piece.edit) {
      const e = cls.edits.find((x) => x.edit === piece.edit);
      if (e) e.count += 1; else cls.edits.push({ edit: piece.edit, count: 1 });
    }
    minX = Math.min(minX, piece.x); maxX = Math.max(maxX, piece.x);
    minZ = Math.min(minZ, piece.z); maxZ = Math.max(maxZ, piece.z);
    ys.add(piece.y);
    materials.add(piece.def.material);
  }
  const classes = [...byClass.values()].sort((a, b) => b.count - a.count);
  return {
    classes,
    tilesW: isFinite(minX) ? Math.round(maxX - minX) + 1 : 0,
    tilesD: isFinite(minZ) ? Math.round(maxZ - minZ) + 1 : 0,
    levels: ys.size,
    materials: [...materials].sort(),
  };
}

function PrefabInfo(props: { prefab: BuildPrefabDef; decomposed: DecomposedPiece[] }) {
  const { prefab, decomposed } = props;
  const bom = useMemo(() => prefabBillOfMaterials(decomposed), [decomposed]);
  // disclosure state is a twig (TWIGSWEEP-0610), like every other panel state
  const [showAll, setShowAll] = useRouteTwigState('/objects-tab', 'bomShowAll', false);
  return (
    <Box style={{ width: '100%', height: '100%', flexDirection: 'column', backgroundColor: accentFor('bg') }}>
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, paddingRight: 12, paddingTop: 9, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: accentFor('border') }}>
        <Text fontSize={10} color={accentFor('textDim')} style={{ fontFamily: 'monospace', fontWeight: 700 }}>theme</Text>
        <Text fontSize={10} color={accentFor('text')} style={{ fontFamily: 'monospace' }}>{prefab.theme}</Text>
        <Box style={{ flexGrow: 1 }} />
        <Text fontSize={10} color={accentFor('textFaint')} style={{ fontFamily: 'monospace' }}>
          {`${bom.tilesW}×${bom.tilesD} tiles · ${bom.levels} level${bom.levels === 1 ? '' : 's'} · ${decomposed.length} pieces`}
        </Text>
      </Box>
      <ScrollView style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }} contentContainerStyle={{ paddingTop: 4, paddingBottom: 8 }}>
        {bom.classes.map((cls) => (
          <Box key={`${cls.kind}-${cls.material}-${cls.label}`} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingLeft: 12, paddingRight: 12, paddingTop: 4, paddingBottom: 4 }}>
            <Text fontSize={12} color={accentFor('text')} style={{ fontFamily: 'monospace', fontWeight: 700 }}>{`${cls.count}×`}</Text>
            <Text fontSize={11} color={accentFor('text')} style={{ fontFamily: 'monospace' }}>{cls.label}</Text>
            <Text fontSize={9} color={accentFor('textDim')} style={{ fontFamily: 'monospace' }}>{`${cls.kind}·${cls.material}`}</Text>
            <Box style={{ flexGrow: 1 }} />
            {cls.edits.length ? (
              <Text fontSize={9} color={accentFor('primary')} style={{ fontFamily: 'monospace' }}>
                {cls.edits.map((e) => `${e.count} ${e.edit}`).join(' · ')}
              </Text>
            ) : null}
          </Box>
        ))}
        <Box style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 2 }}>
          <Text fontSize={9} color={accentFor('textDim')} style={{ fontFamily: 'monospace', fontWeight: 700 }}>materials</Text>
          <Text fontSize={9} color={accentFor('textFaint')} style={{ fontFamily: 'monospace' }}>{bom.materials.join(' · ')}</Text>
        </Box>
        <Pressable onPress={() => setShowAll((v: boolean) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 4 }}>
          <Icon name={showAll ? 'ChevronDown' : 'ChevronRight'} size={10} color={accentFor('textFaint')} />
          <Text fontSize={9} color={accentFor('textFaint')} style={{ fontFamily: 'monospace' }}>{showAll ? `hide the ${decomposed.length}-piece listing` : `show all ${decomposed.length} pieces`}</Text>
        </Pressable>
        {showAll ? decomposed.map((piece, i) => (
          <Box key={`${piece.pieceId}-${i}`} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingLeft: 20, paddingRight: 12, paddingTop: 2, paddingBottom: 2 }}>
            <Text fontSize={10} color={accentFor('textDim')} style={{ fontFamily: 'monospace' }}>{piece.def.label}</Text>
            {piece.edit ? <Text fontSize={9} color={accentFor('primary')} style={{ fontFamily: 'monospace' }}>{piece.edit}</Text> : null}
            <Box style={{ flexGrow: 1 }} />
            <Text fontSize={9} color={accentFor('textFaint')} style={{ fontFamily: 'monospace' }}>{`(${piece.x},${piece.z})${piece.yawDegrees ? ` ${piece.yawDegrees}°` : ''}`}</Text>
          </Box>
        )) : null}
      </ScrollView>
    </Box>
  );
}

// ── Popovers (open upward from the foot) ─────────────────────────────────────

// The CATEGORY segment's list: pick which group the item list browses.
function CatPop(props: { groups: Group[]; palCat: Cat; onPick: (c: Cat) => void }) {
  return (
    <Box style={{ position: 'absolute', left: 0, bottom: 28, width: 200, zIndex: 20, borderWidth: 1, borderColor: accentFor('border'), backgroundColor: accentFor('bgAlt') }}>
      {props.groups.map((g) => {
        const on = g.cat === props.palCat;
        return (
          <Pressable key={g.cat} onPress={() => props.onPick(g.cat)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 30, paddingLeft: 10, paddingRight: 10, backgroundColor: on ? accentFor('bgElevated') : 'transparent' }}>
            <Text fontSize={11} color={on ? accentFor('text') : accentFor('textDim')} style={{ fontFamily: 'monospace', fontWeight: 700 }}>{g.title}</Text>
            <Box style={{ flexGrow: 1 }} />
            <Text fontSize={8} color={accentFor('textFaint')} style={{ fontFamily: 'monospace' }}>{String(g.items.length)}</Text>
          </Pressable>
        );
      })}
    </Box>
  );
}

// The ITEM segment's list: every item in the browsed category, with a filter.
// Click a row to inspect; the + (placeable categories only) drops it into the map.
function ItemPop(props: {
  title: string; cat: Cat; items: { kind: string; label: string }[]; selKind: string | null;
  onInspect: (kind: string) => void; onPlace?: (kind: string) => void;
}) {
  const [q, setQ] = useState('');
  const f = q.trim().toLowerCase();
  const items = props.items.filter((it) => !f || it.label.toLowerCase().includes(f) || it.kind.toLowerCase().includes(f));
  return (
    <Box style={{ position: 'absolute', left: 0, right: 0, bottom: 28, maxHeight: 360, zIndex: 20, borderWidth: 1, borderColor: accentFor('border'), backgroundColor: accentFor('bgAlt') }}>
      <Box style={{ padding: 8, borderBottomWidth: 1, borderBottomColor: accentFor('border') }}>
        <TextInput value={q} onChangeText={setQ} placeholder={`search ${props.title.toLowerCase()}…`} style={{ backgroundColor: accentFor('bg'), borderWidth: 1, borderColor: accentFor('controlBorder'), color: accentFor('text'), paddingLeft: 8, paddingRight: 8, paddingTop: 7, paddingBottom: 7 }} />
      </Box>
      <ScrollView style={{ flexGrow: 1, maxHeight: 312 }} contentContainerStyle={{ paddingTop: 4, paddingBottom: 6 }}>
        {items.map((it) => {
          const on = props.selKind === it.kind;
          return (
            <Pressable key={it.kind} onPress={() => props.onInspect(it.kind)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 26, paddingLeft: 14, paddingRight: 8, backgroundColor: on ? accentFor('bgElevated') : 'transparent', borderLeftWidth: 2, borderLeftColor: on ? accentFor('primary') : '#00000000' }}>
              <Text fontSize={11} color={on ? accentFor('text') : accentFor('textDim')} style={{ fontFamily: 'monospace', fontWeight: on ? 700 : 500 }}>{it.label}</Text>
              <Box style={{ flexGrow: 1 }} />
              {props.onPlace ? (
                <Pressable onPress={() => props.onPlace!(it.kind)} style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: accentFor('success'), backgroundColor: '#0f3d2e' }}>
                  <Text fontSize={11} color="#86efac" style={{ fontWeight: 800 }}>+</Text>
                </Pressable>
              ) : null}
            </Pressable>
          );
        })}
        {items.length === 0 ? (
          <Text fontSize={10} color={accentFor('textFaint')} style={{ fontFamily: 'monospace', paddingLeft: 14, paddingTop: 8 }}>no matches</Text>
        ) : null}
      </ScrollView>
    </Box>
  );
}

// ── Breadcrumb segment ───────────────────────────────────────────────────────

function Crumb(props: { value: string; count?: number; grow?: boolean; muted?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={props.onPress}
      style={{ flexGrow: props.grow ? 1 : 0, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 9, paddingRight: 9 }}
    >
      <Text fontSize={10} color={props.muted ? accentFor('textDim') : accentFor('text')} style={{ fontFamily: 'monospace', fontWeight: 700 }} numberOfLines={1}>{props.value}</Text>
      {props.count != null ? <Text fontSize={8} color={accentFor('textFaint')} style={{ fontFamily: 'monospace' }}>{String(props.count)}</Text> : null}
      <Icon name="ArrowUp" size={9} color={accentFor('textFaint')} />
    </Pressable>
  );
}

// ── Assistant-mesh inspect panel (raw geometry, not a game kind) ──────────────

function AssistInspect(props: { mesh: MeshSpec }) {
  const m = props.mesh;
  const Row = (r: { label: string; value: string }) => (
    <Box style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, paddingTop: 2, paddingBottom: 2 }}>
      <Text fontSize={11} color={accentFor('textDim')}>{r.label}</Text>
      <Text fontSize={11} color={accentFor('text')} style={{ fontFamily: 'monospace' }}>{r.value}</Text>
    </Box>
  );
  return (
    <Box style={{ width: '100%', height: '100%', paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10, backgroundColor: accentFor('bg') }}>
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Box style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: m.material, borderWidth: 1, borderColor: accentFor('border') }} />
        <Text fontSize={13} color={accentFor('text')} style={{ fontWeight: 'bold' }}>{m.id}</Text>
      </Box>
      <Row label="geometry" value={m.geometry} />
      <Row label="material" value={m.material} />
      <Row label="position" value={`[${m.position.map(round).join(', ')}]`} />
      {Object.entries(m.params).map(([k, v]) => <Row key={k} label={k} value={String(round(Number(v)))} />)}
    </Box>
  );
}

// ── Tab ──────────────────────────────────────────────────────────────────────
// (Texture previewing lives in the shared ../TexturePreview — both authoring
// kinds; a catalog recipe with a lab spec opens ShaderLab instead.)

export function ObjectsTab(props: {
  buildingPrefabs?: BuildPrefabDef[];
  onPlace?: (cat: 'building' | 'prop' | 'marker', kind: string) => void;
  activePlaceable?: { cat: 'building' | 'prop' | 'marker'; kind: string } | null;
  onArmPlaceable?: (cat: 'building' | 'prop' | 'marker', kind: string) => void;
  onArmScatter?: (id: ScatterBrushId) => void;
}) {
  const firstBuilding = props.buildingPrefabs?.[0]?.id;
  // TWIGSWEEP-0610 (structure review §4): every selection/disclosure here is a
  // TWIG, never bare useState — a hot reload used to snap the palette back to
  // "first building, prop category, everything collapsed" (the literal "menus
  // that reset" complaint). Stale twig ids degrade gracefully: a deleted kind
  // just renders the not-found viewer until the next pick.
  const [sel, setSel] = useRouteTwigState<Sel>('/objects-tab', 'sel', firstBuilding ? { cat: 'building', kind: firstBuilding } : { cat: 'prop', kind: PROP_KINDS[0] });
  // The category whose item list is showing in the breadcrumb. Kept apart from
  // `sel` so switching categories to browse doesn't reload the viewer until you
  // pick an item.
  const [palCat, setPalCat] = useRouteTwigState<Cat>('/objects-tab', 'palCat', 'prop');
  const [catOpen, setCatOpen] = useRouteTwigState('/objects-tab', 'catOpen', false);
  const [itemOpen, setItemOpen] = useRouteTwigState('/objects-tab', 'itemOpen', false);
  // The model PART selected in the 3D inspector (click-to-pick), and whether the
  // texture-apply popover is open for it. Cleared when the inspected kind changes.
  const [selPart, setSelPart] = useRouteTwigState<string | null>('/objects-tab', 'selPart', null);
  const [texOpen, setTexOpen] = useRouteTwigState('/objects-tab', 'texOpen', false);

  // GLOBAL per-kind textures (the right-rail scope): editing here re-skins EVERY
  // instance of the kind. Folded into the preview so the inspector wears them.
  const kindTex = useKindTextures();

  // Live ASSISTANT category — the meshes the assistant wrote to scene.json.
  const { scene } = useAssistScene();
  // The LIVE texture list: built-ins + the studio's saved materials. Re-pulled
  // when the custom store fires (a Materialize in /textures shows up here).
  const customs = useCustomTextures();
  const textureItems = useMemo(() => allTextures().map((t) => ({ kind: t.id, label: t.label })), [customs]);
  const groups = useMemo<Group[]>(() => [
    { cat: 'building', title: 'BUILDINGS', items: (props.buildingPrefabs ?? []).map((p) => ({ kind: p.id, label: p.label })) },
    ...STATIC_GROUPS,
    { cat: 'texture', title: 'TEXTURES', items: textureItems },
    { cat: 'assistant', title: 'ASSISTANT', items: scene.meshes.map((m) => ({ kind: m.id, label: m.id })) },
  ], [props.buildingPrefabs, scene, textureItems]);
  const groupOf = (cat: Cat) => groups.find((g) => g.cat === cat) ?? groups[0];
  const labelOf = (cat: Cat, kind: string) => groupOf(cat).items.find((it) => it.kind === kind)?.label ?? kind;

  const isTexture = sel.cat === 'texture';
  const isAssist = sel.cat === 'assistant';
  const isBuildingPrefab = sel.cat === 'building';
  const buildingPrefab = isBuildingPrefab ? props.buildingPrefabs?.find((p) => p.id === sel.kind) : undefined;
  const texDef = isTexture ? textureById(sel.kind) : undefined;
  // A shader-authored texture opens its slider lab; a react-authored one previews.
  const spec = texDef?.source.kind === 'shader' ? shaderSpec(sel.kind) : undefined;
  const assistMesh = isAssist ? scene.meshes.find((m) => m.id === sel.kind) : undefined;
  // The inspected kind's GLOBAL part textures (prop only). Stable identity
  // across renders (changes only when the store fires), so the preview memo holds.
  const inspectedTextures = useMemo<Record<string, string> | undefined>(
    () => (sel.cat === 'prop' ? kindTexturesFor(sel.cat, sel.kind) : undefined),
    [kindTex, sel.cat, sel.kind],
  );
  const isScatter = sel.cat === 'scatter';
  const scatterBrush = isScatter && isScatterBrushId(sel.kind) ? SCATTER_BRUSHES[sel.kind] : undefined;
  const pv = useMemo(() => ((isTexture || isAssist || isBuildingPrefab || isScatter) ? null : buildPreview(sel, inspectedTextures)), [isTexture, isAssist, isBuildingPrefab, isScatter, sel.cat, sel.kind, inspectedTextures]);
  // The decomposed 3D view of the inspected building prefab (its semantic pieces).
  const prefabView = useMemo(() => (buildingPrefab ? buildPrefabView(buildingPrefab) : null), [buildingPrefab]);

  // The inspected object's pickable parts (for the selected-part label) + the
  // texture currently on the selected part.
  const partsList = useMemo<Part[]>(() => (pv?.prop ? propParts(pv.prop) : []), [pv]);
  const selPartLabel = selPart ? (partsList.find((p) => p.id === selPart)?.label ?? selPart) : null;
  const curTexId = selPart ? inspectedTextures?.[selPart] : undefined;
  const applyTexture = (textureId: string | null) => { if (selPart) setKindTexture(sel.cat, sel.kind, selPart, textureId); setTexOpen(false); };

  const palGroup = groupOf(palCat);
  const arm = (cat: Cat, kind: string) => {
    if (cat === 'scatter') { if (isScatterBrushId(kind)) props.onArmScatter?.(kind); return; }
    if (isPlaceable(cat)) props.onArmPlaceable?.(cat as 'building' | 'prop' | 'marker', kind);
  };
  const inspect = (cat: Cat, kind: string) => { setSel({ cat, kind }); setPalCat(cat); setCatOpen(false); setItemOpen(false); setSelPart(null); setTexOpen(false); arm(cat, kind); };
  const place = (cat: Cat, kind: string) => { if (isPlaceable(cat)) { arm(cat, kind); props.onPlace?.(cat as 'building' | 'prop' | 'marker', kind); } };
  const pickCat = (c: Cat) => { setPalCat(c); setCatOpen(false); setItemOpen(true); };

  // Breadcrumb item value: the selected kind when it's in the browsed category,
  // else a prompt (you switched categories but haven't picked yet).
  const itemValue = sel.cat === palCat ? labelOf(sel.cat, sel.kind) : 'select…';

  return (
    <Box style={{ width: '100%', height: '100%', flexDirection: 'column', backgroundColor: accentFor('bg'), position: 'relative' }}>
      {/* viewer (+ properties for placeable/tile kinds), full width */}
      {isBuildingPrefab ? (
        buildingPrefab && prefabView ? (
          // A building inspects like any object: the decomposed pieces in the
          // orbit viewer (the + drops the prefab), its data in the panel below.
          <>
            <Box style={{ flexGrow: 1, flexBasis: 0, minHeight: 0, borderBottomWidth: 1, borderBottomColor: accentFor('border') }}>
              <ModelViewer
                pieces={prefabView.pieces} baseDist={prefabView.baseDist} targetY={prefabView.targetY}
                onAdd={() => place('building', buildingPrefab.id)}
              />
            </Box>
            <Box style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}>
              <PrefabInfo prefab={buildingPrefab} decomposed={prefabView.decomposed} />
            </Box>
          </>
        ) : (
          <Box style={{ flexGrow: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <Text fontSize={11} color={accentFor('textDim')} style={{ fontFamily: 'monospace', textAlign: 'center' }}>
              {(props.buildingPrefabs?.length ?? 0) === 0 ? 'No saved buildings yet — author one in the build pane and clone it into a prefab.' : 'Pick a building from the list below.'}
            </Text>
          </Box>
        )
      ) : isTexture ? (
        spec ? (
          <Box style={{ flexGrow: 1, minHeight: 0 }}><ShaderLab spec={spec} /></Box>
        ) : texDef ? (
          <TexturePreview def={texDef} />
        ) : null
      ) : isScatter ? (
        <Box style={{ flexGrow: 1, minHeight: 0, padding: 16, gap: 8 }}>
          <Text fontSize={12} color={accentFor('text')} style={{ fontFamily: 'monospace', fontWeight: 700 }}>{scatterBrush?.label ?? 'Scatter brush'}</Text>
          <Text fontSize={10} color={accentFor('textDim')} style={{ fontFamily: 'monospace' }}>
            {'Procedural nature brush — it is ARMED: paint the map and it rolls the mix below per tile. Re-painting the same ground never double-fills.'}
          </Text>
          {scatterBrush ? (
            <Box style={{ gap: 3 }}>
              <Text fontSize={10} color={accentFor('textDim')} style={{ fontFamily: 'monospace', fontWeight: 700 }}>{`density ${(scatterBrush.density * 100).toFixed(0)}% of painted tiles`}</Text>
              {scatterBrush.entries.map((e) => (
                <Text key={e.kind} fontSize={10} color={accentFor('text')} style={{ fontFamily: 'monospace' }}>
                  {`· ${propKindDefinition(e.kind).label}  ×${e.weight}`}
                </Text>
              ))}
            </Box>
          ) : null}
        </Box>
      ) : isAssist ? (
        assistMesh ? (
          <>
            <Box style={{ flexGrow: 1, flexBasis: 0, minHeight: 0, borderBottomWidth: 1, borderBottomColor: accentFor('border') }}>
              <AssistMeshViewer mesh={assistMesh} background={scene.background} />
            </Box>
            <Box style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}>
              <AssistInspect mesh={assistMesh} />
            </Box>
          </>
        ) : (
          <Box style={{ flexGrow: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <Text fontSize={11} color={accentFor('textDim')} style={{ fontFamily: 'monospace', textAlign: 'center' }}>
              {scene.meshes.length === 0 ? 'No assistant meshes yet — open the Sparkles ✦ surface and generate a scene.' : 'Pick a mesh from the list below.'}
            </Text>
          </Box>
        )
      ) : pv ? (
        <>
          <Box style={{ flexGrow: 1, flexBasis: 0, minHeight: 0, borderBottomWidth: 1, borderBottomColor: accentFor('border') }}>
            {pv.building || pv.prop ? (
              // Buildings + props inspect through the click-to-pick viewer: orbit,
              // click a PART, then a texture in the bar below skins it globally.
              <ObjectInspect3D
                building={pv.building} prop={pv.prop} baseDist={pv.baseDist} targetY={pv.targetY}
                selectedPartId={selPart}
                onPick={(id) => { setSelPart(id); setTexOpen(!!id); }}
                onAdd={isPlaceable(sel.cat) ? () => place(sel.cat, sel.kind) : undefined}
              />
            ) : (
              // Tiles / embedded / markers have no parts — the plain orbit viewer.
              <ModelViewer
                building={pv.building} prop={pv.prop} tile={pv.tile} baseDist={pv.baseDist} targetY={pv.targetY}
                onAdd={isPlaceable(sel.cat) ? () => place(sel.cat, sel.kind) : undefined}
              />
            )}
          </Box>
          <Box style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}>
            <PropertiesPanel focus={pv.focus} world={pv.world} />
          </Box>
        </>
      ) : null}

      {/* Texture-apply bar — shown when a model part is selected. Picking a texture
          here writes the kind's GLOBAL part texture (every instance follows). */}
      {(pv?.building || pv?.prop) && selPart ? (
        <Box style={{ height: 30, flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 10, paddingRight: 8, borderTopWidth: 1, borderTopColor: accentFor('border'), backgroundColor: accentFor('controlBg') }}>
          <Text fontSize={10} color={accentFor('textDim')} style={{ fontFamily: 'monospace', fontWeight: 700 }}>{`TEXTURE · ${selPartLabel}`}</Text>
          <Box style={{ flexGrow: 1 }} />
          <Pressable onPress={() => setTexOpen((o) => !o)} style={{ paddingLeft: 9, paddingRight: 9, paddingTop: 4, paddingBottom: 4, borderWidth: 1, borderColor: accentFor('controlBorder'), backgroundColor: accentFor('bg') }}>
            <Text fontSize={10} color={accentFor('text')} style={{ fontFamily: 'monospace' }}>{curTexId ? (textureById(curTexId)?.label ?? curTexId) : 'pick texture…'}</Text>
          </Pressable>
          {curTexId ? (
            <Pressable onPress={() => applyTexture(null)} style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderWidth: 1, borderColor: accentFor('border') }}>
              <Text fontSize={10} color={accentFor('textDim')} style={{ fontFamily: 'monospace' }}>clear</Text>
            </Pressable>
          ) : null}
        </Box>
      ) : null}

      {/* breadcrumb foot: CATEGORY ▸ ITEM — one compact row */}
      <Box style={{ height: 28, flexShrink: 0, flexDirection: 'row', alignItems: 'stretch', borderTopWidth: 1, borderTopColor: accentFor('border'), backgroundColor: accentFor('bgAlt') }}>
        <Box style={{ borderRightWidth: 1, borderRightColor: accentFor('border'), backgroundColor: accentFor('controlBg'), justifyContent: 'center' }}>
          <Crumb value={palGroup.title} count={palGroup.items.length} onPress={() => { setItemOpen(false); setCatOpen((o) => !o); }} />
        </Box>
        <Box style={{ width: 16, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="ArrowRight" size={10} color={accentFor('textFaint')} />
        </Box>
        <Crumb value={itemValue} grow muted={sel.cat !== palCat} onPress={() => { setCatOpen(false); setItemOpen((o) => !o); }} />
      </Box>

      {catOpen ? <CatPop groups={groups} palCat={palCat} onPick={pickCat} /> : null}
      {itemOpen ? (
        <ItemPop
          title={palGroup.title}
          cat={palCat}
          items={palGroup.items}
          selKind={sel.cat === palCat ? sel.kind : null}
          onInspect={(kind) => inspect(palCat, kind)}
          onPlace={isPlaceable(palCat) ? (kind) => place(palCat, kind) : undefined}
        />
      ) : null}
      {/* The selected part's texture picker. Last child so its hit area sits on top
          of the foot/viewer (hit-test is sibling/paint order, not zIndex). */}
      {texOpen && selPart ? (
        <ItemPop
          title={`TEXTURE · ${selPartLabel}`}
          cat="texture"
          items={textureItems}
          selKind={curTexId ?? null}
          onInspect={(textureId) => applyTexture(textureId)}
        />
      ) : null}
    </Box>
  );
}
