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
import { Box, Pressable, ScrollView, Text, TextInput } from '@reactjit/primitives';
import { Icon } from '@reactjit/icons/Icon';
import type { TileKind } from '../../hmsc/design';
import { BUILDING_KINDS, buildingKindDefinition } from '../../hmsc/world/buildingKinds';
import { PROP_KINDS, propKindDefinition } from '../../hmsc/world/propKinds';
import { EMBEDDED_TILE_KINDS, PAINTABLE_TILE_KINDS, tileKindDefinition } from '../../hmsc/world/tileKinds';
import { buildObjectWorld, type ObjectWorld } from '../objectPreview';
import { ModelViewer } from '../ModelViewer';
import { PropertiesPanel } from '../PropertiesPanel';
import { HMSC_SHADERS, shaderSpec } from '../shaderCatalog';
import { ShaderLab } from '../ShaderLab';
import { accentFor } from '../studio.cls';
import { useAssistScene } from '../assist3d/useAssistScene';
import { AssistMeshViewer } from '../assist3d/AssistMeshViewer';
import { round, type MeshSpec } from '../assist3d/scene';

type Cat = 'building' | 'prop' | 'tile' | 'embedded' | 'shader' | 'assistant';
type Sel = { cat: Cat; kind: string };
type Group = { cat: Cat; title: string; items: { kind: string; label: string }[] };

const STOREY_M = 3;
function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

// The fixed game-kind categories. ASSISTANT is appended in-component because its
// items are live (driven by the watched scene.json).
const STATIC_GROUPS: Group[] = [
  { cat: 'building', title: 'BUILDINGS', items: BUILDING_KINDS.map((k) => ({ kind: k, label: buildingKindDefinition(k).label })) },
  { cat: 'prop', title: 'OBJECTS', items: PROP_KINDS.map((k) => ({ kind: k, label: propKindDefinition(k).label })) },
  { cat: 'tile', title: 'TILES', items: PAINTABLE_TILE_KINDS.map((k) => ({ kind: k, label: tileKindDefinition(k as TileKind).label })) },
  { cat: 'embedded', title: 'EMBEDDED', items: EMBEDDED_TILE_KINDS.map((k) => ({ kind: k, label: tileKindDefinition(k as TileKind).label })) },
  { cat: 'shader', title: 'SHADERS', items: HMSC_SHADERS.map((s) => ({ kind: s.id, label: s.label })) },
];

const isPlaceable = (cat: Cat) => cat === 'building' || cat === 'prop';

type Preview = ObjectWorld & { tile?: TileKind; baseDist: number; targetY: number };

// One-object world + camera framing for a (cat, kind). Shaders / assistant meshes
// never reach here — they render through their own surfaces.
function buildPreview(sel: Sel): Preview {
  const ow = buildObjectWorld(sel.cat as Exclude<Cat, 'shader' | 'assistant'>, sel.kind);
  if (sel.cat === 'tile' || sel.cat === 'embedded') {
    return { ...ow, tile: sel.kind as TileKind, baseDist: 16, targetY: 0.3 };
  }
  if (sel.cat === 'building') {
    const def = buildingKindDefinition(sel.kind as typeof BUILDING_KINDS[number]);
    const h = def.storeys * STOREY_M;
    return { ...ow, baseDist: clamp(Math.max(def.defaultWidthTiles, def.defaultDepthTiles, h) * 2.2, 16, 130), targetY: h * 0.5 };
  }
  const def = propKindDefinition(sel.kind as typeof PROP_KINDS[number]);
  return { ...ow, baseDist: clamp(def.heightMeters * 4 + 4, 5, 30), targetY: def.heightMeters * 0.5 };
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

export function ObjectsTab(props: { onPlace?: (cat: 'building' | 'prop', kind: string) => void }) {
  const [sel, setSel] = useState<Sel>({ cat: 'building', kind: BUILDING_KINDS[0] });
  // The category whose item list is showing in the breadcrumb. Kept apart from
  // `sel` so switching categories to browse doesn't reload the viewer until you
  // pick an item.
  const [palCat, setPalCat] = useState<Cat>('building');
  const [catOpen, setCatOpen] = useState(false);
  const [itemOpen, setItemOpen] = useState(false);

  // Live ASSISTANT category — the meshes the assistant wrote to scene.json.
  const { scene } = useAssistScene();
  const groups = useMemo<Group[]>(() => [
    ...STATIC_GROUPS,
    { cat: 'assistant', title: 'ASSISTANT', items: scene.meshes.map((m) => ({ kind: m.id, label: m.id })) },
  ], [scene]);
  const groupOf = (cat: Cat) => groups.find((g) => g.cat === cat) ?? groups[0];
  const labelOf = (cat: Cat, kind: string) => groupOf(cat).items.find((it) => it.kind === kind)?.label ?? kind;

  const isShader = sel.cat === 'shader';
  const isAssist = sel.cat === 'assistant';
  const spec = isShader ? shaderSpec(sel.kind) : undefined;
  const assistMesh = isAssist ? scene.meshes.find((m) => m.id === sel.kind) : undefined;
  const pv = useMemo(() => ((isShader || isAssist) ? null : buildPreview(sel)), [isShader, isAssist, sel.cat, sel.kind]);

  const palGroup = groupOf(palCat);
  const inspect = (cat: Cat, kind: string) => { setSel({ cat, kind }); setPalCat(cat); setCatOpen(false); setItemOpen(false); };
  const place = (cat: Cat, kind: string) => { if (isPlaceable(cat)) props.onPlace?.(cat as 'building' | 'prop', kind); };
  const pickCat = (c: Cat) => { setPalCat(c); setCatOpen(false); setItemOpen(true); };

  // Breadcrumb item value: the selected kind when it's in the browsed category,
  // else a prompt (you switched categories but haven't picked yet).
  const itemValue = sel.cat === palCat ? labelOf(sel.cat, sel.kind) : 'select…';

  return (
    <Box style={{ width: '100%', height: '100%', flexDirection: 'column', backgroundColor: accentFor('bg'), position: 'relative' }}>
      {/* viewer (+ properties for non-shaders), full width */}
      {isShader && spec ? (
        <Box style={{ flexGrow: 1, minHeight: 0 }}><ShaderLab spec={spec} /></Box>
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
            <ModelViewer
              building={pv.building} prop={pv.prop} tile={pv.tile} baseDist={pv.baseDist} targetY={pv.targetY}
              onAdd={isPlaceable(sel.cat) ? () => place(sel.cat, sel.kind) : undefined}
            />
          </Box>
          <Box style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}>
            <PropertiesPanel focus={pv.focus} world={pv.world} />
          </Box>
        </>
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
    </Box>
  );
}
