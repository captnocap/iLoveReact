// SECTION G — the NAMES pane (req_3884): the model's whole semantic region table as
// its own tab beside the atlas, because a name list you have to scroll six rows at a
// time inside the Model pane is not a place you can work.
//
// Clicking a row SELECTS that region's faces on the model — the point of the panel:
// names are only useful when you can see where they live. Selection goes through the
// same native region query the Seat's `region:<name>` compiles to, so there is one
// selection authority, not a viewer copy of one.
import { useState } from 'react';
import { Pressable, Row, ScrollView, TextInput } from '@reactjit/runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { REGIONS } from '../shell/regions';
import type { ModelFocusBridge } from '../stage/ModelView';
import type { ModelFocusSemanticRow, ModelFocusSemantics } from '../model/modelSemanticsFocus';

// Only resident regions have faces in the live mesh to select. The others are real
// rows worth showing (they diagnose a drop), but pressing them cannot select anything.
function selectable(row: ModelFocusSemanticRow): boolean {
  return row.presence === 'resident' && row.faces > 0;
}

function presenceLabel(row: ModelFocusSemanticRow): string {
  return row.presence === 'resident' ? `${row.faces}f · ${row.instances}x`
    : row.presence === 'not-visible' ? 'not visible'
      : row.presence === 'mount-only' ? 'mount only'
        : 'saved only';
}

function presenceTone(row: ModelFocusSemanticRow): string {
  return row.presence === 'resident' ? 'textDim'
    : row.presence === 'not-visible' ? 'textFaint'
      : 'warning';
}

export default function NamesPanel({ semantics, bridge, onRefresh }: {
  semantics: ModelFocusSemantics | null;
  bridge: ModelFocusBridge | null;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const rows = semantics?.rows ?? [];
  const needle = filter.trim().toLowerCase();
  const shown = needle ? rows.filter((row) => row.name.toLowerCase().includes(needle) || row.role.toLowerCase().includes(needle)) : rows;
  const residentRows = rows.filter(selectable);
  const namedFaces = semantics?.residentNamedFaces ?? 0;
  const totalFaces = semantics?.residentFaces ?? 0;
  const unnamed = Math.max(0, totalFaces - namedFaces);

  const select = (row: ModelFocusSemanticRow, additive: boolean) => {
    if (!selectable(row)) return;
    bridge?.selectRegion(row.id, additive);
    setSelectedId(row.id);
  };

  return (
    <C.HW_Section>
      <C.HW_SectionHead>
        <C.HW_AccentBar />
        <C.HW_SectionTitle>NAMES</C.HW_SectionTitle>
        <C.HW_Spacer />
        {residentRows.length > 1 ? (
          <C.HW_MiniVerb
            tooltip="Select every named region at once"
            onPress={() => {
              residentRows.forEach((row, index) => bridge?.selectRegion(row.id, index > 0));
              setSelectedId(null);
            }}
          >
            <Icon name="Target" size={10} color={accentFor('textDim')} />
          </C.HW_MiniVerb>
        ) : null}
        <C.HW_MiniVerb onPress={onRefresh} tooltip="Re-read semantic names from the resident native mesh">
          <Icon name="RefreshCw" size={10} color={accentFor('textDim')} />
        </C.HW_MiniVerb>
      </C.HW_SectionHead>

      <C.HW_ReadRow>
        <C.HW_FormLabel>coverage</C.HW_FormLabel>
        <C.HW_ReadValue style={{ color: accentFor(unnamed > 0 ? 'warning' : 'success') }}>
          {totalFaces === 0 ? 'no live mesh' : `${rows.length} regions · ${namedFaces}/${totalFaces} faces${unnamed > 0 ? ` · ${unnamed} unnamed` : ''}`}
        </C.HW_ReadValue>
      </C.HW_ReadRow>

      <TextInput
        value={filter}
        onChange={setFilter}
        placeholder="filter names…"
        style={{ width: '100%', height: 24, marginTop: 4, marginBottom: 4, paddingLeft: 8, paddingRight: 8, borderRadius: 'theme:radiusMd', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder', backgroundColor: 'theme:controlBg', color: 'theme:text', fontSize: 11 }}
      />

      {shown.length === 0 ? (
        <C.HW_ReadRow>
          <C.HW_FormLabel>regions</C.HW_FormLabel>
          <C.HW_ReadValue>{rows.length === 0 ? 'none yet — select faces and press N to name them' : 'no match'}</C.HW_ReadValue>
        </C.HW_ReadRow>
      ) : (
        <ScrollView style={{ width: '100%', flexGrow: 1 }} showScrollbar>
          {shown.map((row) => {
            const active = selectedId === row.id;
            const canSelect = selectable(row);
            return (
              <Row key={`name-${row.id}`} style={{ alignItems: 'center', gap: 6, height: REGIONS.grid.rowHeight, width: '100%' }}>
                <Pressable
                  onPress={(event: any) => select(row, event?.shiftKey === true)}
                  tooltip={canSelect
                    ? `Select ${row.name} on the model (${row.faces} faces) — shift-click to add to the selection`
                    : `${row.name} has no faces in the live mesh (${presenceLabel(row)})`}
                  style={{ flexGrow: 1, minWidth: 0, height: REGIONS.grid.rowHeight, flexDirection: 'row', alignItems: 'center', gap: 6, opacity: canSelect ? 1 : 0.55 }}
                >
                  <Icon name="Tag" size={10} color={accentFor(active ? 'primary' : canSelect ? 'textDim' : 'textFaint')} />
                  <C.HW_ReadValue style={{ color: accentFor(active ? 'primary' : 'text') }}>
                    {`${row.parent === null ? '' : '↳ '}${row.name}${row.role ? ` · ${row.role}` : ''}`}
                  </C.HW_ReadValue>
                  <C.HW_Spacer />
                  <C.HW_FormLabel style={{ color: accentFor(presenceTone(row)) }}>{presenceLabel(row)}</C.HW_FormLabel>
                </Pressable>
              </Row>
            );
          })}
        </ScrollView>
      )}
    </C.HW_Section>
  );
}
