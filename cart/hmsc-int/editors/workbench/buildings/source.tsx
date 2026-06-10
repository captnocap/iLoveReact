// editors/workbench/buildings/source.tsx — the BUILDING WorkbenchSource
// (BUILDSKIN-0606). A saved prefab IS a building type: the roster lists every
// prefab-building with its piece count; gutter 3 carries the generated skin
// panel (type globals + the selected piece's overrides + structure verbs);
// column 4 renders the building live from the resolved skins. Persistence is
// the V20 world stream (`prefabDefined` commits) — buildings stay live
// editable structures, never baked.

import { useEffect, useMemo, useState } from 'react';
import { Box, Pressable, Row, ScrollView, Text, TextInput } from '@reactjit/primitives';
import type { WorkbenchSource } from '../../../shell/Workbench';
import type { LensSpec } from '../../../shell/stage';
import { subscribeLiveDoors } from '../livePoll';
import { materialFamily, type MaterialChoice } from '../materials/chooser';
import { paintBenchStore } from '../paint/live';
import { PaintBench } from '../paint/PaintBench';
import { BUILD_FACE_SLOTS, catalogEntry, faceSlotLabels, type BuildFaceSlot, type BuildPieceKind } from '../../../game/build';
import { textureById } from '../../../game/textures/registry';
import { accentFor } from '../../../shell/workbench.cls';
import { buildingsActions, buildingsPanel, buildingsRoster } from './panel';
import { buildingsWorkbenchStore } from './live';
import { BuildingStage } from './Stage';
import type { BuildingPaintTarget, BuildingsStore } from './store';

const BUILDING_LENSES: LensSpec[] = [
  { id: 'model', label: 'MODEL' },
  { id: 'materials', label: 'MATERIALS' },
  { id: 'paint', label: 'PAINT' },
];

function openPaintTarget(store: ReturnType<typeof buildingsWorkbenchStore>, target: BuildingPaintTarget): void {
  const bench = paintBenchStore();
  const name = `${target.label} texture`;
  if (target.materialId) bench.open({ kind: 'material', id: target.materialId, label: name });
  else {
    bench.open({ kind: 'blank', w: 256, h: 256 });
    bench.rename(name);
    bench.commitName(name);
  }
  store.setPaintTarget(target);
  store.setLens('paint');
}

function openMaterialTarget(store: BuildingsStore, target: BuildingPaintTarget): void {
  store.setPaintTarget(target);
  store.setLens('materials');
}

function materialGroup(m: MaterialChoice): string {
  return m.group ?? materialFamily(m.id);
}

function materialBadge(m: MaterialChoice): string {
  if (m.source === 'recipe') return 'recipe';
  if (m.source === 'react') return 'react';
  if (m.source === 'stored-decal') return 'saved decal';
  if (m.source === 'stored') return 'saved';
  return materialFamily(m.id);
}

function targetKind(store: BuildingsStore, target: BuildingPaintTarget): BuildPieceKind {
  if (target.scope.kind === 'type') return target.scope.pieceKind;
  const piece = store.building(target.buildingId)?.pieces[target.scope.index];
  return piece ? catalogEntry(piece.pieceId).kind : 'wall';
}

function targetKey(target: BuildingPaintTarget | null): string {
  if (!target) return '';
  const scope = target.scope.kind === 'type' ? `type:${target.scope.pieceKind}` : `piece:${target.scope.index}`;
  return `${target.buildingId}:${scope}:${target.slot}`;
}

function BuildingMaterialStage(props: { store: BuildingsStore; buildingId: string }) {
  const { store, buildingId } = props;
  const target = store.paintTarget();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(target?.materialId ?? '');
  const materials = store.deps.materials();
  useEffect(() => {
    if (!target) setSelected('');
    else if (target.materialId) setSelected(target.materialId);
  }, [targetKey(target), target?.materialId]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return materials
      .filter((m) => !q || m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q) || materialGroup(m).toLowerCase().includes(q) || materialBadge(m).toLowerCase().includes(q))
      .sort((a, b) => materialGroup(a).localeCompare(materialGroup(b)) || a.label.localeCompare(b.label));
  }, [materials, query]);
  const sections = useMemo(() => {
    const out: Array<{ group: string; rows: MaterialChoice[] }> = [];
    for (const row of rows) {
      const group = materialGroup(row);
      const tail = out[out.length - 1];
      if (tail?.group === group) tail.rows.push(row);
      else out.push({ group, rows: [row] });
    }
    return out;
  }, [rows]);
  const selectedDef = selected ? textureById(selected) : undefined;
  const preview = target && selected ? { target, textureId: selected } : undefined;
  const currentLabel = target ? `${target.label} · ${target.materialId ?? 'bare'}` : 'no building face target';
  const labels = target ? faceSlotLabels(targetKind(store, target)) : null;
  const faceOptions = target && labels
    ? (['all', ...BUILD_FACE_SLOTS] as Array<'all' | BuildFaceSlot>).map((slot) => ({
        id: slot,
        label: slot === 'all' ? (target.scope.kind === 'piece' ? 'override all' : 'all faces') : labels[slot],
      }))
    : [];

  const apply = (id: string) => {
    const current = store.paintTarget();
    if (!current || current.buildingId !== buildingId) return;
    store.applyPaintTargetSkin({ kind: 'material', id });
  };

  return (
    <Row style={{ flexGrow: 1, minHeight: 0, backgroundColor: accentFor('bg') }}>
      <Box style={{ width: 310, height: '100%', flexDirection: 'column', borderRightWidth: 1, borderColor: accentFor('border'), backgroundColor: accentFor('surface') }}>
        <Box style={{ padding: 10, gap: 7, borderBottomWidth: 1, borderColor: accentFor('border') }}>
          <Text fontSize={9} color={accentFor('textFaint')} style={{ fontFamily: 'monospace', fontWeight: 800, letterSpacing: 1 }}>MATERIAL TARGET</Text>
          <Text fontSize={11} color={accentFor('text')} style={{ fontFamily: 'monospace', fontWeight: 700 }}>{currentLabel}</Text>
          {faceOptions.length > 0 ? (
            <Row style={{ flexWrap: 'wrap', gap: 4 }}>
              {faceOptions.map((option) => {
                const on = target?.slot === option.id;
                return (
                  <Pressable
                    key={option.id}
                    onPress={() => store.setPaintTargetSlot(option.id)}
                    style={{
                      paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3,
                      borderWidth: 1, borderColor: on ? accentFor('primary') : accentFor('controlBorder'),
                      borderRadius: 3, backgroundColor: on ? accentFor('bgElevated') : accentFor('controlBg'),
                    }}
                  >
                    <Text fontSize={9} color={on ? accentFor('text') : accentFor('textSecondary')} style={{ fontFamily: 'monospace', fontWeight: 800 }}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </Row>
          ) : null}
          <Text fontSize={9} color={accentFor('textDim')} style={{ fontFamily: 'monospace' }}>{`${rows.length} / ${materials.length} assignable materials`}</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="search materials..."
            style={{ color: accentFor('text'), backgroundColor: accentFor('controlBg'), borderWidth: 1, borderColor: accentFor('controlBorder'), borderRadius: 3, paddingLeft: 8, paddingTop: 5, paddingBottom: 5, fontSize: 11 }}
          />
        </Box>
        <ScrollView showScrollbar style={{ flexGrow: 1, minHeight: 0 }}>
          <Box style={{ flexDirection: 'column', gap: 3, padding: 8 }}>
            {sections.map((section) => (
              <Box key={section.group} style={{ flexDirection: 'column', gap: 3, marginBottom: 6 }}>
                <Text fontSize={8} color={accentFor('textFaint')} style={{ fontFamily: 'monospace', fontWeight: 900, letterSpacing: 1 }}>{`${section.group.toUpperCase()} · ${section.rows.length}`}</Text>
                {section.rows.map((m) => {
                  const on = m.id === selected;
                  return (
                    <Pressable
                      key={m.id}
                      onPress={() => setSelected(m.id)}
                      onDoubleClick={() => apply(m.id)}
                      style={{
                        paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 6, borderRadius: 4,
                        borderWidth: 1, borderColor: on ? accentFor('primary') : accentFor('controlBorder'),
                        backgroundColor: on ? accentFor('bgElevated') : accentFor('controlBg'),
                      }}
                    >
                      <Text fontSize={11} color={on ? accentFor('text') : accentFor('textSecondary')} style={{ fontWeight: on ? 800 : 600 }} numberOfLines={1}>{m.label}</Text>
                      <Text fontSize={8} color={accentFor('textFaint')} style={{ fontFamily: 'monospace' }} numberOfLines={1}>{`${materialBadge(m)} · ${m.id}`}</Text>
                    </Pressable>
                  );
                })}
              </Box>
            ))}
          </Box>
        </ScrollView>
      </Box>
      <Box style={{ flexGrow: 1, minWidth: 0, minHeight: 0, flexDirection: 'column' }}>
        <Row style={{ alignItems: 'center', gap: 8, padding: 10, borderBottomWidth: 1, borderColor: accentFor('border'), backgroundColor: accentFor('surface') }}>
          <Text fontSize={11} color={accentFor('textSecondary')} style={{ fontFamily: 'monospace', fontWeight: 800 }} numberOfLines={1}>
            {selectedDef ? `${selectedDef.label} on building` : 'select a material to preview on the building'}
          </Text>
          <Box style={{ flexGrow: 1 }} />
          <Pressable
            onPress={() => selected && apply(selected)}
            style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderWidth: 1, borderColor: accentFor('success'), borderRadius: 4, backgroundColor: accentFor('controlBg') }}
          >
            <Text fontSize={10} color={accentFor('success')} style={{ fontWeight: 800 }}>apply to target</Text>
          </Pressable>
        </Row>
        <BuildingStage store={store} buildingId={buildingId} preview={preview} />
      </Box>
    </Row>
  );
}

export function buildingsSource(): WorkbenchSource<string> {
  const store = buildingsWorkbenchStore();
  return {
    id: 'building',
    icon: 'Building2',
    kicker: 'BUILDINGS',

    list: () => buildingsRoster(store),
    select: (rowId: string): string => rowId,
    panel: (id: string) => buildingsPanel(
      store,
      id,
      (target) => openMaterialTarget(store, target),
      (target) => openPaintTarget(store, target),
    ),
    actions: (id: string) => {
      const actions = buildingsActions(store, id);
      const target = store.paintTarget();
      if (store.lens() === 'paint' && target?.buildingId === id) {
        actions.push({
          id: 'apply-painted-material',
          label: 'Apply paint',
          icon: 'Paintbrush',
          run: () => {
            const materialId = paintBenchStore().materializeCurrent(`${target.label} material`);
            if (materialId) store.setPaintTargetSkin(target, { kind: 'material', id: materialId });
          },
        });
      }
      return actions;
    },

    lenses: () => BUILDING_LENSES,
    activeLens: () => store.lens(),
    onLens: (_id, lens) => store.setLens(lens as 'model' | 'materials' | 'paint'),

    // column 4 demonstrates (LAW 1): the resolved skins, rendered
    stage: (id: string) => (
      store.lens() === 'paint'
        ? <PaintBench store={paintBenchStore()} />
        : store.lens() === 'materials'
          ? <BuildingMaterialStage store={store} buildingId={id} />
          : <BuildingStage store={store} buildingId={id} />
    ),

    // stage picks + commits tick the store; another session's world commits
    // arrive through the shared live-doors poll
    subscribe: (fn: () => void) => {
      const offStore = store.subscribe(fn);
      const offDoors = subscribeLiveDoors(fn);
      return () => { offStore(); offDoors(); };
    },
  };
}
