// ObjectsTab — the first right-rail tab: a file-tree explorer of every placeable
// object, with a live 3D model viewer and its full property sheet.
//
//   <row> <col>file tree</col> <col> model viewer / model properties </col> </row>
//
// The tree groups the real kind registries (Buildings / Objects / Tiles). Picking
// a leaf builds the object through the SAME mutators the editor uses, hands the
// single record to ModelViewer (a clean studio viewer — no sky/fog, drag-orbit +
// scroll-zoom) and the staged world to the shared PropertiesPanel — so the model
// is exactly what the game draws and the properties are complete.

import { useMemo, useState } from 'react';
import { Box, Pressable, ScrollView, Text } from '@reactjit/primitives';
import type { TileKind } from '../../hmsc/design';
import { BUILDING_KINDS, buildingKindDefinition } from '../../hmsc/world/buildingKinds';
import { PROP_KINDS, propKindDefinition } from '../../hmsc/world/propKinds';
import { EMBEDDED_TILE_KINDS, PAINTABLE_TILE_KINDS, tileKindDefinition } from '../../hmsc/world/tileKinds';
import { buildObjectWorld, type ObjectWorld } from '../objectPreview';
import { ModelViewer } from '../ModelViewer';
import { PropertiesPanel } from '../PropertiesPanel';
import { HMSC_SHADERS, shaderSpec } from '../shaderCatalog';
import { ShaderLab } from '../ShaderLab';

type Cat = 'building' | 'prop' | 'tile' | 'embedded' | 'shader';
type Sel = { cat: Cat; kind: string };

const STOREY_M = 3; // wall height per storey, for framing the camera

const GROUPS: { cat: Cat; title: string; items: { kind: string; label: string }[] }[] = [
  { cat: 'building', title: 'BUILDINGS', items: BUILDING_KINDS.map((k) => ({ kind: k, label: buildingKindDefinition(k).label })) },
  { cat: 'prop', title: 'OBJECTS', items: PROP_KINDS.map((k) => ({ kind: k, label: propKindDefinition(k).label })) },
  { cat: 'tile', title: 'TILES', items: PAINTABLE_TILE_KINDS.map((k) => ({ kind: k, label: tileKindDefinition(k as TileKind).label })) },
  { cat: 'embedded', title: 'EMBEDDED TILES', items: EMBEDDED_TILE_KINDS.map((k) => ({ kind: k, label: tileKindDefinition(k as TileKind).label })) },
  { cat: 'shader', title: 'SHADERS', items: HMSC_SHADERS.map((s) => ({ kind: s.id, label: s.label })) },
];

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

type Preview = ObjectWorld & { tile?: TileKind; baseDist: number; targetY: number };

// One-object world (shared builder) + camera framing for the preview. Shaders
// are NOT built here — they render through ShaderLab, not the 3D ModelViewer.
function buildPreview(sel: Sel): Preview {
  const ow = buildObjectWorld(sel.cat as Exclude<Cat, 'shader'>, sel.kind);
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

// A tree leaf. Hovering reveals a + (when placeable) — clicking it is additive
// (drops the object into the place layer); clicking the row selects it.
//
// Hover is tracked by onMouseEnter ONLY (the parent records which row). We never
// clear on the leaf's own leave — that's the trap: moving the cursor onto the
// child + would fire the leaf's leave and unmount the + before it can be clicked.
// Instead the hover key only changes when ANOTHER row/header is entered (or the
// tree is left), so the + stays put under the cursor and stays clickable.
function Leaf(props: { label: string; active: boolean; hovered: boolean; onPress: () => void; onEnter: () => void; onAdd?: () => void }) {
  return (
    <Pressable
      onPress={props.onPress}
      onMouseEnter={props.onEnter}
      // FIXED height so the highlight never grows when the + mounts on hover.
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, height: 22, paddingLeft: 18, paddingRight: 6, backgroundColor: props.active ? '#1e293b' : props.hovered ? '#10203a' : 'transparent', borderLeftWidth: 2, borderLeftColor: props.active ? '#38bdf8' : 'transparent' }}
    >
      <Text fontSize={11} color={props.active ? '#f8fafc' : '#94a3b8'} style={{ fontFamily: 'monospace', fontWeight: props.active ? 700 : 500 }}>{props.label}</Text>
      {props.onAdd && props.hovered ? (
        <Pressable onPress={props.onAdd} style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 3, borderWidth: 1, borderColor: '#22c55e', backgroundColor: '#0f3d2e' }}>
          <Text fontSize={11} color="#86efac" style={{ fontWeight: 800 }}>+</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

export function ObjectsTab(props: { onPlace?: (cat: 'building' | 'prop', kind: string) => void }) {
  const [sel, setSel] = useState<Sel>({ cat: 'building', kind: BUILDING_KINDS[0] });
  const [open, setOpen] = useState<Record<Cat, boolean>>({ building: true, prop: false, tile: false, embedded: false, shader: false });
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const isShader = sel.cat === 'shader';
  const spec = isShader ? shaderSpec(sel.kind) : undefined;
  // Only the 3D path needs a built world; shaders render through ShaderLab.
  const pv = useMemo(() => (isShader ? null : buildPreview(sel)), [isShader, sel.cat, sel.kind]);

  return (
    <Box style={{ width: '100%', height: '100%', flexDirection: 'row' }}>
      {/* File tree. onMouseLeave on the container clears the hover key when the
          cursor leaves the tree entirely; moving within it only fires the rows'
          onMouseEnter, so the + never flickers. */}
      <Box style={{ width: '42%', height: '100%', borderRightWidth: 1, borderRightColor: '#16202f', backgroundColor: '#0a111d' }} onMouseLeave={() => setHoverKey(null)}>
        <ScrollView style={{ flexGrow: 1, height: '100%' }} contentContainerStyle={{ paddingTop: 6, paddingBottom: 10 }}>
          {GROUPS.map((g) => (
            <Box key={g.cat} style={{ gap: 1 }}>
              <Pressable onPress={() => setOpen((o) => ({ ...o, [g.cat]: !o[g.cat] }))} onMouseEnter={() => setHoverKey(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 6, paddingRight: 8, paddingTop: 4, paddingBottom: 4 }}>
                <Text fontSize={9} color="#64748b" style={{ width: 8 }}>{open[g.cat] ? '▾' : '▸'}</Text>
                <Text fontSize={10} color="#cbd5e1" style={{ fontWeight: 800, letterSpacing: 1 }}>{g.title}</Text>
                <Text fontSize={8} color="#3a4a63" style={{ fontFamily: 'monospace' }}>{g.items.length}</Text>
              </Pressable>
              {open[g.cat] ? g.items.map((it) => {
                const key = `${g.cat}:${it.kind}`;
                return (
                  <Leaf
                    key={it.kind}
                    label={it.label}
                    active={sel.cat === g.cat && sel.kind === it.kind}
                    hovered={hoverKey === key}
                    onEnter={() => setHoverKey(key)}
                    onPress={() => setSel({ cat: g.cat, kind: it.kind })}
                    onAdd={props.onPlace && (g.cat === 'building' || g.cat === 'prop') ? () => props.onPlace!(g.cat as 'building' | 'prop', it.kind) : undefined}
                  />
                );
              }) : null}
            </Box>
          ))}
        </ScrollView>
      </Box>

      {/* Preview pane: a shader gets the live ShaderLab (flat quad + sliders);
          everything else gets the 3D model viewer + its property sheet. */}
      {isShader && spec ? (
        <Box style={{ flexGrow: 1, height: '100%' }}>
          <ShaderLab spec={spec} />
        </Box>
      ) : pv ? (
        <Box style={{ flexGrow: 1, height: '100%', flexDirection: 'column' }}>
          <Box style={{ height: '46%', borderBottomWidth: 1, borderBottomColor: '#16202f' }}>
            <ModelViewer building={pv.building} prop={pv.prop} tile={pv.tile} baseDist={pv.baseDist} targetY={pv.targetY} />
          </Box>
          <Box style={{ flexGrow: 1, minHeight: 0 }}>
            <PropertiesPanel focus={pv.focus} world={pv.world} />
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}
