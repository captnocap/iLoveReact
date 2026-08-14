// SECTION G — the NAMES pane (req_3884): the model's whole semantic region table as
// its own tab beside the atlas, because a name list you have to scroll six rows at a
// time inside the Model pane is not a place you can work.
//
// Clicking a row SELECTS that face region or logical-edge path on the model — the
// point of the panel: names are only useful when you can see where they live. Both
// kinds go through their native semantic selectors, so there is one selection
// authority, not a viewer copy of one.
import { useState } from 'react';
import { Box, Pressable, Row, ScrollView, Text, TextInput } from '@reactjit/runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { REGIONS } from '../shell/regions';
import type { ModelFocusBridge } from '../stage/ModelView';
import {
  filterModelFocusSemanticRows,
  type ModelFocusSemanticRow,
  type ModelFocusSemantics,
} from '../model/modelSemanticsFocus';

/** Rows the list shows before it scrolls. The pane is this list, so it takes the
 *  column — the Model pane's six-row sliver is what this tab exists to replace.
 *  A ScrollView is excluded from proportional fallback and must carry an explicit
 *  height (flexGrow collapses it to nothing), so the height is this × rowHeight. */
const NAMES_LIST_MAX_ROWS = 22;

// Only resident semantics have geometry in the live mesh to select. The others are
// real rows worth showing (they diagnose a drop), but pressing them cannot select.
function selectable(row: ModelFocusSemanticRow): boolean {
  return row.presence === 'resident' && (row.kind === 'face' ? row.faces > 0 : row.edges > 0);
}

// Face percepts count per TRIANGLE, while edge paths carry exact authored edges. Keep
// the units explicit instead of flattening both geometry kinds into "faces".
function presenceLabel(row: ModelFocusSemanticRow): string {
  return row.presence === 'resident' ? row.kind === 'face'
    ? `${row.faces} tris · ${row.instances}x`
    : `${row.edges} edges`
    : row.presence === 'not-visible' ? 'not visible'
      : row.presence === 'mount-only' ? 'mount only'
        : 'saved only';
}

function presenceTone(row: ModelFocusSemanticRow): string {
  return row.presence === 'resident' ? 'textDim'
    : row.presence === 'not-visible' ? 'textFaint'
      : 'warning';
}

export default function NamesPanel({ semantics, bridge, onRefresh, onStatus, onRegionRemoved }: {
  semantics: ModelFocusSemantics | null;
  bridge: ModelFocusBridge | null;
  onRefresh: () => void;
  /** Refusals must be visible: a rename that silently does nothing is the same
   *  dead end as having no rename at all (req_3894). */
  onStatus: (message: string) => void;
  /** A removal happened — the shell mints the save capability that lets an emptied
   *  table be committed (req_3898). */
  onRegionRemoved: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const rows = semantics?.rows ?? [];
  const needle = filter.trim().toLowerCase();
  const allGroups = filterModelFocusSemanticRows(rows, '');
  const shown = filterModelFocusSemanticRows(rows, filter);
  const residentFaces = allGroups.faces.filter(selectable);
  const residentEdges = allGroups.edges.filter(selectable);
  const namedFaces = semantics?.residentNamedFaces ?? 0;
  const totalFaces = semantics?.residentFaces ?? 0;
  const unnamed = Math.max(0, totalFaces - namedFaces);
  const namedEdges = allGroups.edges.reduce((sum, row) => sum + row.edges, 0);
  const visibleSlots = 2 + Math.max(1, shown.faces.length) + Math.max(1, shown.edges.length);

  const select = (row: ModelFocusSemanticRow, additive: boolean) => {
    if (!selectable(row)) return;
    const result = row.kind === 'face'
      ? bridge?.selectRegion(row.id, additive)
      : bridge?.selectEdgeRegion(row.id, additive);
    if (result) setSelectedId(row.id);
  };

  const selectAll = (kind: 'face' | 'edge') => {
    const group = kind === 'face' ? residentFaces : residentEdges;
    group.forEach((row, index) => {
      if (kind === 'face') bridge?.selectRegion(row.id, index > 0);
      else bridge?.selectEdgeRegion(row.id, index > 0);
    });
    setSelectedId(null);
  };

  const beginRename = (row: ModelFocusSemanticRow) => {
    setRenamingId(row.id);
    setRenameDraft(row.name);
  };
  const commitRename = (row: ModelFocusSemanticRow) => {
    const name = renameDraft.trim();
    setRenamingId(null);
    if (!name || name === row.name) return;
    const result = row.kind === 'face'
      ? bridge?.editRegion(row.id, { name })
      : bridge?.editEdgeRegion(row.id, { name });
    onStatus(result
      ? `renamed "${row.name}" to "${name}" — save to make it durable`
      : `rename refused — "${name}" is empty, reserved, or already another region's name`);
    onRefresh();
  };
  const removeRegion = (row: ModelFocusSemanticRow) => {
    const result = row.kind === 'face'
      ? bridge?.editRegion(row.id, { remove: true })
      : bridge?.editEdgeRegion(row.id, { remove: true });
    if (selectedId === row.id) setSelectedId(null);
    if (result) onRegionRemoved();
    onStatus(result
      ? row.kind === 'face'
        ? `removed face region "${row.name}" — ${result.changed} faces are unnamed again (Ctrl+Z restores it)`
        : `removed edge path "${row.name}" (Ctrl+Z restores it)`
      : `could not remove "${row.name}" — the resident mesh refused the edit`);
    onRefresh();
  };

  const renderSection = (kind: 'face' | 'edge', group: ModelFocusSemanticRow[]) => {
    const face = kind === 'face';
    const resident = face ? residentFaces : residentEdges;
    return (
      <Box key={`names-${kind}`} style={{ width: '100%' }}>
        <Row style={{ width: '100%', height: REGIONS.grid.rowHeight, alignItems: 'center', gap: 6, paddingLeft: 12, paddingRight: 12, borderTopWidth: 1, borderTopColor: accentFor('borderSoft') }}>
          <Icon name={face ? 'Tag' : 'Spline'} size={10} color={accentFor(face ? 'primary' : 'active')} />
          <Text noWrap numberOfLines={1} style={{ flexGrow: 1, minWidth: 0, color: accentFor('textDim'), fontSize: 9, fontFamily: 'ui-monospace', fontWeight: 900, letterSpacing: 0.8 }}>
            {face ? 'FACE REGIONS' : 'EDGE PATHS'}
          </Text>
          <Text noWrap numberOfLines={1} style={{ color: accentFor('textFaint'), fontSize: 9, fontFamily: 'ui-monospace', fontWeight: 800 }}>
            {face ? allGroups.faces.length : allGroups.edges.length}
          </Text>
          {resident.length > 1 ? (
            <C.HW_MiniVerb
              tooltip={`Select every resident ${face ? 'face region' : 'edge path'}`}
              onPress={() => selectAll(kind)}
            >
              <Icon name="Target" size={10} color={accentFor('textDim')} />
            </C.HW_MiniVerb>
          ) : null}
        </Row>
        {group.length === 0 ? (
          <Row style={{ width: '100%', height: REGIONS.grid.rowHeight, alignItems: 'center', paddingLeft: 28, paddingRight: 12, overflow: 'hidden' }}>
            <Text noWrap numberOfLines={1} style={{ flexGrow: 1, minWidth: 0, color: accentFor('textFaint'), fontSize: 10, fontFamily: 'ui-monospace' }}>
              {needle ? 'No matches' : face ? 'No face names' : 'No edge names'}
            </Text>
          </Row>
        ) : group.map((row) => {
          const active = selectedId === row.id;
          const canSelect = selectable(row);
          return (
            <Row key={`name-${row.kind}-${row.id}`} style={{ alignItems: 'center', gap: 4, height: REGIONS.grid.rowHeight, width: '100%', paddingLeft: 12 }}>
              {renamingId === row.id ? (
                <TextInput
                  autoFocus
                  value={renameDraft}
                  onChange={setRenameDraft}
                  onSubmit={() => commitRename(row)}
                  onKeyDown={(event: any) => {
                    const key = String(event?.key).toLowerCase();
                    if (key === 'enter') commitRename(row);
                    if (key === 'escape') setRenamingId(null);
                  }}
                  style={{ flexGrow: 1, minWidth: 0, height: 21, paddingLeft: 6, paddingRight: 6, borderRadius: 4, borderWidth: 1, borderColor: accentFor('primary'), backgroundColor: 'theme:controlBg', color: 'theme:text', fontSize: 11 }}
                />
              ) : (
                <Pressable
                  onPress={(event: any) => select(row, event?.shiftKey === true)}
                  tooltip={canSelect
                    ? row.kind === 'face'
                      ? `Select face region ${row.name} (${row.faces} triangles) — shift-click to add`
                      : `Select edge path ${row.name} (${row.edges} edges · ${row.role} · ${row.closed ? 'closed' : 'open'}) — shift-click to add`
                    : `${row.name} is not selectable (${presenceLabel(row)})`}
                  style={{ flexGrow: 1, minWidth: 0, height: REGIONS.grid.rowHeight, flexDirection: 'row', alignItems: 'center', gap: 6, opacity: canSelect ? 1 : 0.55, overflow: 'hidden' }}
                >
                  <Icon name={row.kind === 'face' ? 'Tag' : 'Spline'} size={10} color={accentFor(active ? 'primary' : canSelect ? 'textDim' : 'textFaint')} />
                  <C.HW_ReadValue style={{ flexGrow: 1, minWidth: 0, color: accentFor(active ? 'primary' : 'text') }}>
                    {`${row.kind === 'face' && row.parent !== null ? '↳ ' : ''}${row.name}${row.role && row.role !== 'authored' ? ` · ${row.role}` : ''}`}
                  </C.HW_ReadValue>
                  <C.HW_FormLabel style={{ flexShrink: 0, minWidth: 0, color: accentFor(presenceTone(row)) }}>{presenceLabel(row)}</C.HW_FormLabel>
                </Pressable>
              )}
              <C.HW_MiniVerb onPress={() => beginRename(row)} tooltip={`Rename ${row.kind === 'face' ? 'face region' : 'edge path'} ${row.name}`}>
                <Icon name="Pencil" size={10} color={accentFor('textDim')} />
              </C.HW_MiniVerb>
              <C.HW_MiniVerb onPress={() => removeRegion(row)} tooltip={`Remove ${row.kind === 'face' ? 'face region' : 'edge path'} ${row.name} (Ctrl+Z restores it)`}>
                <Icon name="Trash2" size={10} color={accentFor('textDim')} />
              </C.HW_MiniVerb>
            </Row>
          );
        })}
      </Box>
    );
  };

  return (
    <C.HW_Section>
      <C.HW_SectionHead>
        <C.HW_AccentBar />
        <C.HW_SectionTitle>NAMES</C.HW_SectionTitle>
        <C.HW_Spacer />
        <C.HW_MiniVerb onPress={onRefresh} tooltip="Re-read semantic names from the resident native mesh">
          <Icon name="RefreshCw" size={10} color={accentFor('textDim')} />
        </C.HW_MiniVerb>
      </C.HW_SectionHead>

      <C.HW_ReadRow style={{ width: '100%', overflow: 'hidden' }}>
        <C.HW_FormLabel>faces</C.HW_FormLabel>
        <C.HW_ReadValue style={{ flexGrow: 1, minWidth: 0, color: accentFor(unnamed > 0 ? 'warning' : 'success') }}>
          {totalFaces === 0 ? 'no live mesh' : `${allGroups.faces.length} regions · ${namedFaces}/${totalFaces} tris`}
        </C.HW_ReadValue>
      </C.HW_ReadRow>
      <C.HW_ReadRow style={{ width: '100%', overflow: 'hidden' }}>
        <C.HW_FormLabel>edges</C.HW_FormLabel>
        <C.HW_ReadValue style={{ flexGrow: 1, minWidth: 0, color: accentFor(allGroups.edges.length > 0 ? 'success' : 'textSecondary') }}>
          {`${allGroups.edges.length} paths · ${namedEdges} edges`}
        </C.HW_ReadValue>
      </C.HW_ReadRow>

      <TextInput
        value={filter}
        onChange={setFilter}
        placeholder="filter names…"
        style={{ width: '100%', height: 24, marginTop: 4, marginBottom: 4, paddingLeft: 8, paddingRight: 8, borderRadius: 'theme:radiusMd', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder', backgroundColor: 'theme:controlBg', color: 'theme:text', fontSize: 11 }}
      />

      <ScrollView style={{ width: '100%', height: Math.min(visibleSlots, NAMES_LIST_MAX_ROWS) * REGIONS.grid.rowHeight }} showScrollbar>
        {renderSection('face', shown.faces)}
        {renderSection('edge', shown.edges)}
      </ScrollView>
    </C.HW_Section>
  );
}
