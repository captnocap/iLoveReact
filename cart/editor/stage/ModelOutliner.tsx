import { useState } from 'react';
import { Box, Col, Row, Text, TextInput, Pressable, ScrollView } from '@reactjit/runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { PRIMITIVE_MESHES } from '../data/commands';
import { modelOutlinerRoots, type ModelPartGroup } from '../data/modelOutliner';
import { REGIONS } from '../shell/regions';
import type { ModelPart, PrimitiveKind } from '../data/types';

// The model OUTLINER — the Studio concept ported to the new editor: a model is a list of
// PARTS (each its own mesh), and this panel lists them with the row verbs (select /
// visibility / duplicate / delete) plus an add-bar to drop another primitive as a new
// part or append a saved library model (cross-model reuse). Selection highlights the
// whole part in the host (via its face-group range) so the gizmo moves it.
// Housed in the Model Focus panel (Inspector) — an inline block, not a viewport overlay.
//
// Fixed-region contract (req_2627 / req_2626 II): rows are a FIXED height on the
// shared column grid — a fixed eye column at the start, the name flexing between,
// and fixed-width verb columns at the one right edge. The part list is a bounded
// NESTED scroll (explicit height, capped at PART_ROWS_VISIBLE rows) so the panel
// itself never has to scroll for it.
const PART_ROW_HEIGHT = 27;
const PART_ROWS_VISIBLE = 10;
const EMPTY_HINT_HEIGHT = 38;

/** fixed per-row control column — every row's verbs land on the same grid lines. */
const ROW_CONTROL = {
  width: REGIONS.grid.stepBtn, height: PART_ROW_HEIGHT,
  alignItems: 'center', justifyContent: 'center',
} as const;

function partListHeight(count: number): number {
  if (count === 0) return EMPTY_HINT_HEIGHT;
  return Math.min(count, PART_ROWS_VISIBLE) * PART_ROW_HEIGHT;
}

export default function ModelOutliner({ parts, activeId, selectedIds, onSelect, onRename, onToggleVisible, onDuplicate, onDelete, onSelectGroup, onRenameGroup, onToggleVisibleGroup, onDuplicateGroup, onDissolveGroup, onGroupSelected, onUngroupSelected, onAdd, onImportModel }: {
  parts: ModelPart[];
  activeId: string | null;
  // Multi-select set (req_2659, shift-click accumulate): members highlight; the PRIMARY
  // (activeId) keeps the strong row. Optional — absent reads as single-select.
  selectedIds?: string[];
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onToggleVisible: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onSelectGroup: (groupId: string) => void;
  onRenameGroup: (groupId: string, name: string) => void;
  onToggleVisibleGroup: (groupId: string) => void;
  onDuplicateGroup: (groupId: string) => void;
  onDissolveGroup: (groupId: string) => void;
  onGroupSelected: () => void;
  onUngroupSelected: () => void;
  onAdd: (kind: PrimitiveKind) => void;
  onImportModel: () => void;
}) {
  const [renaming, setRenaming] = useState<{ kind: 'part' | 'group'; id: string } | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<string[]>([]);
  const roots = modelOutlinerRoots(parts);
  const collapsed = new Set(collapsedGroupIds);
  const visibleRows = roots.reduce((count, root) => count + (root.kind === 'group' && !collapsed.has(root.group.id) ? 1 + root.group.parts.length : 1), 0);

  const startRename = (part: ModelPart) => {
    setRenaming({ kind: 'part', id: part.id });
    setRenameDraft(part.name);
  };
  const commitRename = (part: ModelPart) => {
    const name = renameDraft.trim();
    if (name && name !== part.name) onRename(part.id, name);
    setRenaming(null);
    setRenameDraft('');
  };
  const startGroupRename = (group: ModelPartGroup) => {
    setRenaming({ kind: 'group', id: group.id });
    setRenameDraft(group.name);
  };
  const commitGroupRename = (group: ModelPartGroup) => {
    const name = renameDraft.trim();
    if (name && name !== group.name) onRenameGroup(group.id, name);
    setRenaming(null);
    setRenameDraft('');
  };
  const cancelRename = () => { setRenaming(null); setRenameDraft(''); };
  const toggleCollapsed = (groupId: string) => setCollapsedGroupIds((current) => (
    current.includes(groupId) ? current.filter((id) => id !== groupId) : [...current, groupId]
  ));

  const renderPart = (part: ModelPart, nested: boolean) => {
    const active = part.id === activeId;
    // Set member but not primary: a dimmer tint of the active blue (req_2659).
    const inSet = !active && Boolean(selectedIds?.includes(part.id));
    const isRenaming = renaming?.kind === 'part' && renaming.id === part.id;
    return (
      <Row
        key={part.id}
        style={{
          alignItems: 'center', gap: 4, paddingLeft: nested ? 17 : 5, paddingRight: 5, height: PART_ROW_HEIGHT,
          backgroundColor: active ? '#2a466e' : inSet ? '#20344f' : 'transparent',
          borderBottomWidth: 1, borderColor: '#161b26',
        }}
      >
        <Pressable style={ROW_CONTROL} onPress={() => onToggleVisible(part.id)} tooltip={part.visible ? 'Hide part' : 'Show part'}>
          <Icon name={part.visible ? 'Eye' : 'EyeOff'} size={13} color={part.visible ? '#9db4d0' : '#4a5464'} />
        </Pressable>
        {isRenaming ? (
          <Row style={{ flexGrow: 1, minWidth: 0, height: PART_ROW_HEIGHT, alignItems: 'center', gap: 6 }}>
            <Box style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: part.color }} />
            <TextInput
              value={renameDraft}
              onChange={setRenameDraft}
              onKeyDown={(event: any) => {
                if (event?.key === 'Enter') commitRename(part);
                if (event?.key === 'Escape') cancelRename();
              }}
              placeholder={part.name}
              style={{ flexGrow: 1, minWidth: 0, height: 21, paddingLeft: 6, paddingRight: 6, borderRadius: 4, borderWidth: 1, borderColor: '#5a86c0', backgroundColor: '#111a29', color: '#eaf2ff', fontSize: 11 }}
            />
          </Row>
        ) : (
          <Pressable onPress={() => onSelect(part.id)} style={{ flexGrow: 1, minWidth: 0, height: PART_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Box style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: part.color }} />
            <Text numberOfLines={1} noWrap style={{ color: active ? '#eaf2ff' : (part.visible ? '#cfe0f5' : '#6b7686'), fontSize: 12, fontWeight: active ? 700 : 500 }}>{part.name}</Text>
          </Pressable>
        )}
        <Pressable
          style={ROW_CONTROL}
          onPress={() => (isRenaming ? commitRename(part) : startRename(part))}
          tooltip={isRenaming ? 'Save part name' : 'Rename part'}
        >
          <Icon name={isRenaming ? 'Check' : 'Pencil'} size={12} color={isRenaming ? '#9fc1ee' : '#6f8296'} />
        </Pressable>
        <Pressable style={ROW_CONTROL} onPress={() => onDuplicate(part.id)} tooltip="Duplicate part (paint carries; Mirror lives in the right-click menu)">
          <Icon name="CopyPlus" size={12} color="#6f8296" />
        </Pressable>
        <Pressable style={ROW_CONTROL} onPress={() => onDelete(part.id)} tooltip="Delete part">
          <Icon name="Trash2" size={12} color="#7d5a5a" />
        </Pressable>
      </Row>
    );
  };

  const renderGroup = (group: ModelPartGroup) => {
    const isCollapsed = collapsed.has(group.id);
    const anyVisible = group.parts.some((part) => part.visible);
    const active = group.parts.some((part) => part.id === activeId);
    const inSet = group.parts.some((part) => selectedIds?.includes(part.id));
    const isRenaming = renaming?.kind === 'group' && renaming.id === group.id;
    return (
      <Col key={group.id} style={{ width: '100%' }}>
        <Row style={{ alignItems: 'center', gap: 3, paddingLeft: 4, paddingRight: 5, height: PART_ROW_HEIGHT, backgroundColor: active ? '#253e61' : inSet ? '#1c3049' : '#121a26', borderBottomWidth: 1, borderColor: '#1c2a3b' }}>
          <Pressable style={ROW_CONTROL} onPress={() => toggleCollapsed(group.id)} tooltip={isCollapsed ? 'Expand group' : 'Collapse group'}>
            <Icon name={isCollapsed ? 'ChevronRight' : 'ChevronDown'} size={12} color="#7890aa" />
          </Pressable>
          <Pressable style={ROW_CONTROL} onPress={() => onToggleVisibleGroup(group.id)} tooltip={anyVisible ? 'Hide every visible part in group' : 'Show every part in group'}>
            <Icon name={anyVisible ? 'Eye' : 'EyeOff'} size={13} color={anyVisible ? '#9db4d0' : '#4a5464'} />
          </Pressable>
          {isRenaming ? (
            <TextInput
              value={renameDraft}
              onChange={setRenameDraft}
              onKeyDown={(event: any) => {
                if (event?.key === 'Enter') commitGroupRename(group);
                if (event?.key === 'Escape') cancelRename();
              }}
              placeholder={group.name}
              style={{ flexGrow: 1, minWidth: 0, height: 21, paddingLeft: 6, paddingRight: 6, borderRadius: 4, borderWidth: 1, borderColor: '#5a86c0', backgroundColor: '#111a29', color: '#eaf2ff', fontSize: 11 }}
            />
          ) : (
            <Pressable onPress={() => onSelectGroup(group.id)} style={{ flexGrow: 1, minWidth: 0, height: PART_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name={isCollapsed ? 'Folder' : 'FolderOpen'} size={13} color="#b6a56f" />
              <Text numberOfLines={1} noWrap style={{ color: active ? '#eaf2ff' : '#c7d5e7', fontSize: 12, fontWeight: 700 }}>{group.name}</Text>
              <Text style={{ color: '#617086', fontSize: 10, fontFamily: 'monospace' }}>{`${group.parts.length}`}</Text>
            </Pressable>
          )}
          <Pressable style={ROW_CONTROL} onPress={() => (isRenaming ? commitGroupRename(group) : startGroupRename(group))} tooltip={isRenaming ? 'Save group name' : 'Rename group'}>
            <Icon name={isRenaming ? 'Check' : 'Pencil'} size={12} color={isRenaming ? '#9fc1ee' : '#6f8296'} />
          </Pressable>
          <Pressable style={ROW_CONTROL} onPress={() => onDuplicateGroup(group.id)} tooltip="Duplicate group — copies every member into a new focused group">
            <Icon name="CopyPlus" size={12} color="#6f8296" />
          </Pressable>
          <Pressable style={ROW_CONTROL} onPress={() => onDissolveGroup(group.id)} tooltip="Dissolve group — keeps every member part">
            <Icon name="FolderMinus" size={12} color="#8c735f" />
          </Pressable>
        </Row>
        {!isCollapsed ? group.parts.map((part) => renderPart(part, true)) : null}
      </Col>
    );
  };

  return (
    <Col
      style={{
        width: '100%', marginTop: 10,
        backgroundColor: 'rgba(12,14,20,0.55)', borderWidth: 1, borderColor: '#1d2330',
        borderRadius: 8, overflow: 'hidden',
      }}
    >
      <Row style={{ alignItems: 'center', gap: 6, paddingLeft: 10, paddingRight: 8, height: 30, backgroundColor: 'rgba(20,24,34,0.9)', borderBottomWidth: 1, borderColor: '#1d2330' }}>
        <Icon name="ListTree" size={13} color="#8fb6c9" />
        <Text noWrap numberOfLines={1} style={{ color: '#cfe0f5', fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>OUTLINER</Text>
        <Box style={{ flexGrow: 1 }} />
        <Text style={{ color: '#5d6878', fontSize: 11, fontFamily: 'monospace' }}>{`${parts.length}`}</Text>
        <Pressable style={{ width: 21, height: 21, alignItems: 'center', justifyContent: 'center' }} onPress={onGroupSelected} tooltip="Group selected parts — Shift-click rows to build the set">
          <Icon name="FolderPlus" size={13} color="#90b7a0" />
        </Pressable>
        <Pressable style={{ width: 21, height: 21, alignItems: 'center', justifyContent: 'center' }} onPress={onUngroupSelected} tooltip="Remove selected parts from their groups — geometry is kept">
          <Icon name="Ungroup" size={13} color="#8b96a7" />
        </Pressable>
      </Row>

      <ScrollView style={{ height: partListHeight(visibleRows) }} contentContainerStyle={{ flexDirection: 'column' }}>
        {parts.length === 0 ? (
          <Text style={{ color: '#5d6878', fontSize: 11, padding: 12 }}>No parts yet — add one below.</Text>
        ) : roots.map((root) => (root.kind === 'group' ? renderGroup(root.group) : renderPart(root.part, false)))}
      </ScrollView>

      <Row style={{ alignItems: 'center', gap: 4, padding: 6, backgroundColor: 'rgba(18,22,31,0.9)', borderTopWidth: 1, borderColor: '#1d2330' }}>
        {PRIMITIVE_MESHES.map((p) => (
          <Pressable
            key={p.kind}
            onPress={() => onAdd(p.kind)}
            tooltip={`Add ${p.name}`}
            style={{ width: 26, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 5, backgroundColor: '#16233aee', borderWidth: 1, borderColor: '#2c4a6a' }}
          >
            <Icon name={p.icon} size={13} color="#cfe0f5" />
          </Pressable>
        ))}
        <Box style={{ flexGrow: 1 }} />
        <Pressable
          onPress={onImportModel}
          tooltip="Add from library — append a saved model as part(s); pick it again to reuse it"
          style={{ width: 26, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 5, backgroundColor: '#1a2c1fee', borderWidth: 1, borderColor: '#2f5a3a' }}
        >
          <Icon name="PackagePlus" size={13} color="#bfe0c8" />
        </Pressable>
      </Row>
    </Col>
  );
}
