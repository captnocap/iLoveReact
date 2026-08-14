import { useRef, useState } from 'react';
import { Box, Col, Row, Text, TextInput, Pressable, ScrollView } from '@reactjit/runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { PRIMITIVE_MESHES } from '../data/commands';
import {
  modelOutlinerRoots,
  type ModelOutlinerDragItem,
  type ModelOutlinerDropTarget,
  type ModelOutlinerRoot,
  type ModelPartGroup,
} from '../data/modelOutliner';
import { outlinerFocusTree, outlinerHeaderCounts, partAttachments, type OutlinerAttachment } from '../data/outlinerFocusTree';
import { REGIONS } from '../shell/regions';
import { accentFor } from '../workspace.cls';
import type { ModelFocusBridge } from './ModelView';
import type { ModelFocusSemantics } from '../model/modelSemanticsFocus';
import type { ModelPart, PrimitiveKind } from '../data/types';
import type { RoleContractId } from '../data/roleNamer';

// The model OUTLINER, rebuilt to the Model Focus Handoff design (req_4392): ONE
// tree owns everything per part — the part rows (each its own mesh), their named
// face regions (dim tag icon), their logical edge paths (green), and the
// mechanical-rig lane (hinge/mount/contact edge roles, purple). Bone skeletons
// are NOT here; they stay in the RIG tab. Attribution comes from the pure
// outlinerFocusTree join — exact or unattributed, never guessed.
//
// Row verbs (rename / duplicate / delete / drag) appear ONLY on hover and on
// the selected row — never at rest. Collapsed part rows compress their
// attachments into a counts summary. The old 12-button primitive strip is gone:
// "+ ADD" opens a dropdown listing the primitives and library import, and the
// region/edge/rig legend stays pinned at the outliner's foot.
//
// The outliner flex-fills all height the other focus-panel sections leave over
// (the handoff's one flexing section); the part list scrolls inside it.
const PART_ROW_HEIGHT = 24;
const LEAF_ROW_HEIGHT = 20;
const FOOT_ROW_HEIGHT = 32;

const RIG_TINT = '#c3b8ff';
const EDGE_TINT = '#8fd8ac';

/** fixed per-row control column — every row's verbs land on the same grid lines. */
const ROW_CONTROL = {
  width: REGIONS.grid.stepBtn, height: PART_ROW_HEIGHT,
  alignItems: 'center', justifyContent: 'center',
} as const;

function AttachmentRow({ attachment, onLocate }: {
  attachment: OutlinerAttachment;
  /** Select the attachment's geometry on the model — a row you cannot locate
   *  is not actionable (the req_3883/req_3884 law, carried into the tree). */
  onLocate?: () => void;
}) {
  const tint = attachment.kind === 'rig' ? RIG_TINT : attachment.kind === 'edge' ? EDGE_TINT : accentFor('textSecondary');
  const icon = attachment.kind === 'rig' ? 'Bone' : attachment.kind === 'edge' ? 'Spline' : 'Tag';
  const iconColor = attachment.kind === 'rig' ? accentFor('info') : attachment.kind === 'edge' ? accentFor('success') : accentFor('textDim');
  return (
    <Pressable
      onPress={onLocate}
      tooltip={onLocate ? `Select ${attachment.name} on the model` : undefined}
      style={{ height: LEAF_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 5, paddingRight: 5, borderRadius: 3 }}
    >
      <Icon name={icon} size={10} color={iconColor} />
      <Text noWrap numberOfLines={1} style={{ flexShrink: 1, minWidth: 0, fontSize: 10, fontWeight: 700, color: tint }}>{attachment.name}</Text>
      <Box style={{ flexGrow: 1 }} />
      <Text noWrap style={{ fontSize: 8.5, color: accentFor('textFaint') }}>{attachment.meta}</Text>
    </Pressable>
  );
}

export default function ModelOutliner({ parts, activeId, selectedIds, stageFocusEnabled, semantics, bridge, onToggleStageFocus, onSelect, onFocusSelectionOwner, onRename, onToggleVisible, onDuplicate, onDelete, onSelectGroup, onRenameGroup, onToggleVisibleGroup, onDuplicateGroup, onDissolveGroup, onGroupSelected, onUngroupSelected, onMoveItem, onAdd, onImportModel, roleNamer, onStartRoleNamer, onSkipRole, onCancelRoleNamer }: {
  parts: ModelPart[];
  activeId: string | null;
  // Multi-select set (req_2659, shift-click accumulate): members highlight; the PRIMARY
  // (activeId) keeps the strong row. Optional — absent reads as single-select.
  selectedIds?: string[];
  /** When off, only this outliner's rows can change its active part. */
  stageFocusEnabled: boolean;
  /** The focus bridge's semantic rows — the tree's region/edge/rig lanes. */
  semantics?: ModelFocusSemantics | null;
  bridge?: ModelFocusBridge | null;
  onToggleStageFocus: () => void;
  // Guided role naming (req_3263): while a session is live, row clicks assign the
  // shown role (AppFrame owns that swap); this panel renders the ask strip.
  roleNamer?: { role: string; done: number; total: number; contract: string } | null;
  onStartRoleNamer?: (contract: RoleContractId) => void;
  onSkipRole?: () => void;
  onCancelRoleNamer?: () => void;
  onSelect: (id: string) => void;
  /** Locate selected mesh topology in the Outliner without dropping the selection. */
  onFocusSelectionOwner: () => void;
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
  onMoveItem: (item: ModelOutlinerDragItem, target: ModelOutlinerDropTarget) => void;
  onAdd: (kind: PrimitiveKind) => void;
  onImportModel: () => void;
}) {
  const [renaming, setRenaming] = useState<{ kind: 'part' | 'group'; id: string } | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<string[]>([]);
  const [expandedPartIds, setExpandedPartIds] = useState<string[]>([]);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [dragging, setDragging] = useState<ModelOutlinerDragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<ModelOutlinerDropTarget | null>(null);
  const dragRef = useRef<ModelOutlinerDragItem | null>(null);
  const listRectRef = useRef({ x: 0, y: 0, width: 1, height: 1 });
  const scrollYRef = useRef(0);
  const roots = modelOutlinerRoots(parts);
  const collapsed = new Set(collapsedGroupIds);
  const expanded = new Set(expandedPartIds);
  const tree = outlinerFocusTree(parts, semantics?.rows ?? []);
  const flatRows: { item: ModelOutlinerDragItem; depth: number }[] = [];
  const flatten = (nodes: readonly ModelOutlinerRoot[], depth: number) => {
    for (const node of nodes) {
      if (node.kind === 'part') flatRows.push({ item: { kind: 'part', id: node.part.id }, depth });
      else {
        flatRows.push({ item: { kind: 'group', id: node.group.id }, depth });
        if (!collapsed.has(node.group.id)) flatten(node.group.children, depth + 1);
      }
    }
  };
  flatten(roots, 0);

  // Drag targeting works over the PART/GROUP rows only; expanded attachment
  // leaves live between rows, so targeting is looked up by row identity rather
  // than a straight y/rowHeight division.
  const rowIndexAt = (contentY: number): number => Math.floor(contentY / PART_ROW_HEIGHT);
  const targetAt = (event: any): ModelOutlinerDropTarget => {
    const rect = listRectRef.current;
    const contentY = Number(event?.y ?? rect.y) - rect.y + scrollYRef.current;
    const index = rowIndexAt(contentY);
    const row = flatRows[index];
    if (!row) return { kind: 'root' };
    const rowY = index * PART_ROW_HEIGHT;
    const lowerHalf = contentY - rowY >= PART_ROW_HEIGHT / 2;
    if (row.item.kind === 'group') {
      // The folder/name side is the natural "put inside" target; its narrow
      // left gutter remains a before/after reorder lane.
      const inside = Number(event?.x ?? rect.x) >= rect.x + 48 + row.depth * 14;
      return { ...row.item, position: inside ? 'inside' : (lowerHalf ? 'after' : 'before') };
    }
    return { ...row.item, position: lowerHalf ? 'after' : 'before' };
  };
  const beginDrag = (item: ModelOutlinerDragItem) => {
    dragRef.current = item;
    setDragging(item);
    setDropTarget(null);
  };
  const updateDrag = (event: any) => {
    if (!dragRef.current) return;
    setDropTarget(targetAt(event));
  };
  const finishDrag = (event: any) => {
    const item = dragRef.current;
    const target = targetAt(event);
    dragRef.current = null;
    setDragging(null);
    setDropTarget(null);
    if (item) onMoveItem(item, target);
  };
  const isDrop = (kind: 'part' | 'group', id: string) => dropTarget?.kind === kind && dropTarget.id === id;

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
  const togglePartExpanded = (partId: string) => setExpandedPartIds((current) => (
    current.includes(partId) ? current.filter((id) => id !== partId) : [...current, partId]
  ));
  const locate = (attachment: OutlinerAttachment): (() => void) | undefined => {
    if (!bridge) return undefined;
    return attachment.kind === 'region'
      ? () => bridge.selectRegion(attachment.id)
      : () => bridge.selectEdgeRegion(attachment.id);
  };

  const renderAttachments = (partId: string) => {
    const bag = partAttachments(tree, partId);
    const leaves = [...bag.rigs, ...bag.regions, ...bag.edges];
    if (leaves.length === 0) return null;
    return (
      <Col style={{ marginLeft: 21, marginTop: 1, marginBottom: 4, borderLeftWidth: 1, borderColor: '#1c2833', paddingLeft: 8, paddingTop: 2, paddingBottom: 2, gap: 1 }}>
        {leaves.map((leaf) => (
          <AttachmentRow key={`${leaf.kind}-${leaf.id}`} attachment={leaf} onLocate={locate(leaf)} />
        ))}
      </Col>
    );
  };

  const renderPart = (part: ModelPart, depth: number) => {
    const active = part.id === activeId;
    // Set member but not primary: a dimmer tint of the active blue (req_2659).
    const inSet = !active && Boolean(selectedIds?.includes(part.id));
    const isRenaming = renaming?.kind === 'part' && renaming.id === part.id;
    const bag = partAttachments(tree, part.id);
    const hasLeaves = bag.rigs.length + bag.regions.length + bag.edges.length > 0;
    // Attachment leaves fold away during a drag so the drop-target math keeps
    // its one-row-height invariant (targetAt divides by PART_ROW_HEIGHT).
    const isExpanded = hasLeaves && expanded.has(part.id) && !dragging;
    const hovered = hoveredKey === `part-${part.id}`;
    const showVerbs = hovered || active || isRenaming;
    return (
      <Col key={part.id} style={{ width: '100%' }}>
        <Row
          onMouseEnter={() => setHoveredKey(`part-${part.id}`)}
          onMouseLeave={() => setHoveredKey((key) => (key === `part-${part.id}` ? null : key))}
          style={{
            alignItems: 'center', gap: 4, paddingLeft: 5 + depth * 14, paddingRight: 5, height: PART_ROW_HEIGHT,
            borderRadius: 3,
            backgroundColor: isDrop('part', part.id) ? '#315a49' : active ? accentFor('segActiveBg') : inSet ? '#0e2429' : 'transparent',
            borderWidth: 1, borderColor: isDrop('part', part.id) ? '#315a49' : active ? '#2a5a63' : 'transparent',
          }}
        >
          <Pressable
            style={{ width: 12, height: PART_ROW_HEIGHT, alignItems: 'center', justifyContent: 'center' }}
            onPress={hasLeaves ? () => togglePartExpanded(part.id) : undefined}
            tooltip={hasLeaves ? (isExpanded ? 'Collapse regions/edges/rig' : 'Expand regions/edges/rig') : undefined}
          >
            <Text style={{ fontSize: 8, color: accentFor('textFaint') }}>{hasLeaves ? (isExpanded ? '▾' : '▸') : '·'}</Text>
          </Pressable>
          <Pressable style={ROW_CONTROL} onPress={() => onToggleVisible(part.id)} tooltip={part.visible ? 'Hide part' : 'Show part'}>
            <Icon name={part.visible ? 'Eye' : 'EyeOff'} size={12} color={part.visible ? accentFor('textDim') : '#4a5464'} />
          </Pressable>
          {isRenaming ? (
            <Row style={{ flexGrow: 1, minWidth: 0, height: PART_ROW_HEIGHT, alignItems: 'center', gap: 6 }}>
              <Box style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: part.color }} />
              <TextInput
                value={renameDraft}
                onChange={setRenameDraft}
                autoFocus
                onKeyDown={(event: any) => {
                  if (event?.key === 'Enter') commitRename(part);
                  if (event?.key === 'Escape') cancelRename();
                }}
                placeholder={part.name}
                style={{ flexGrow: 1, minWidth: 0, height: 20, paddingLeft: 6, paddingRight: 6, borderRadius: 3, borderWidth: 1, borderColor: accentFor('primary'), backgroundColor: accentFor('controlBg'), color: accentFor('text'), fontSize: 11 }}
              />
            </Row>
          ) : (
            <Pressable onPress={() => onSelect(part.id)} style={{ flexGrow: 1, minWidth: 0, height: PART_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Box style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: part.color }} />
              <Text numberOfLines={1} noWrap style={{ flexShrink: 1, minWidth: 0, color: active ? accentFor('segActiveText') : (part.visible ? accentFor('textSecondary') : '#6b7686'), fontSize: 11, fontWeight: 700 }}>{part.name}</Text>
            </Pressable>
          )}
          {showVerbs ? (
            <>
              <Pressable
                style={{ width: 12, height: PART_ROW_HEIGHT, alignItems: 'center', justifyContent: 'center' }}
                onMouseDown={() => beginDrag({ kind: 'part', id: part.id })}
                onMouseMove={updateDrag}
                onMouseUp={finishDrag}
                tooltip="Drag to reorder, into a folder, or to ROOT"
              >
                <Icon name="GripVertical" size={10} color={dragging?.id === part.id ? '#bde6cf' : '#536174'} />
              </Pressable>
              <Pressable style={ROW_CONTROL} onPress={() => (isRenaming ? commitRename(part) : startRename(part))} tooltip={isRenaming ? 'Save part name' : 'Rename part'}>
                <Icon name={isRenaming ? 'Check' : 'Pencil'} size={11} color={isRenaming ? '#9fc1ee' : '#6f8296'} />
              </Pressable>
              <Pressable style={ROW_CONTROL} onPress={() => onDuplicate(part.id)} tooltip="Duplicate part (paint carries; Mirror lives in the right-click menu)">
                <Icon name="CopyPlus" size={11} color="#6f8296" />
              </Pressable>
              <Pressable style={ROW_CONTROL} onPress={() => onDelete(part.id)} tooltip="Delete part">
                <Icon name="Trash2" size={11} color="#7d5a5a" />
              </Pressable>
            </>
          ) : (
            <Text noWrap style={{ fontSize: 8.5, color: accentFor('textFaint') }}>{bag.summary}</Text>
          )}
        </Row>
        {isExpanded ? renderAttachments(part.id) : null}
      </Col>
    );
  };

  const renderGroup = (group: ModelPartGroup, depth: number) => {
    const isCollapsed = collapsed.has(group.id);
    const anyVisible = group.parts.some((part) => part.visible);
    const active = group.parts.some((part) => part.id === activeId);
    const inSet = group.parts.some((part) => selectedIds?.includes(part.id));
    const isRenaming = renaming?.kind === 'group' && renaming.id === group.id;
    const hovered = hoveredKey === `group-${group.id}`;
    const showVerbs = hovered || isRenaming;
    return (
      <Col key={group.id} style={{ width: '100%' }}>
        <Row
          onMouseEnter={() => setHoveredKey(`group-${group.id}`)}
          onMouseLeave={() => setHoveredKey((key) => (key === `group-${group.id}` ? null : key))}
          style={{ alignItems: 'center', gap: 3, paddingLeft: 4 + depth * 14, paddingRight: 5, height: PART_ROW_HEIGHT, borderRadius: 3, backgroundColor: isDrop('group', group.id) ? '#315a49' : active ? '#12242e' : inSet ? '#0e1d26' : '#0c141d' }}
        >
          <Pressable style={ROW_CONTROL} onPress={() => toggleCollapsed(group.id)} tooltip={isCollapsed ? 'Expand group' : 'Collapse group'}>
            <Icon name={isCollapsed ? 'ChevronRight' : 'ChevronDown'} size={12} color="#7890aa" />
          </Pressable>
          <Pressable style={ROW_CONTROL} onPress={() => onToggleVisibleGroup(group.id)} tooltip={anyVisible ? 'Hide every visible part in group' : 'Show every part in group'}>
            <Icon name={anyVisible ? 'Eye' : 'EyeOff'} size={12} color={anyVisible ? accentFor('textDim') : '#4a5464'} />
          </Pressable>
          {isRenaming ? (
            <TextInput
              value={renameDraft}
              onChange={setRenameDraft}
              autoFocus
              onKeyDown={(event: any) => {
                if (event?.key === 'Enter') commitGroupRename(group);
                if (event?.key === 'Escape') cancelRename();
              }}
              placeholder={group.name}
              style={{ flexGrow: 1, minWidth: 0, height: 20, paddingLeft: 6, paddingRight: 6, borderRadius: 3, borderWidth: 1, borderColor: accentFor('primary'), backgroundColor: accentFor('controlBg'), color: accentFor('text'), fontSize: 11 }}
            />
          ) : (
            <Pressable onPress={() => onSelectGroup(group.id)} style={{ flexGrow: 1, minWidth: 0, height: PART_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name={isCollapsed ? 'Folder' : 'FolderOpen'} size={12} color="#b6a56f" />
              <Text numberOfLines={1} noWrap style={{ flexShrink: 1, minWidth: 0, color: active ? accentFor('text') : accentFor('textSecondary'), fontSize: 11, fontWeight: 700 }}>{group.name}</Text>
              <Text style={{ color: accentFor('textFaint'), fontSize: 9, fontFamily: 'monospace' }}>{`${group.parts.length}`}</Text>
            </Pressable>
          )}
          {showVerbs ? (
            <>
              <Pressable
                style={{ width: 12, height: PART_ROW_HEIGHT, alignItems: 'center', justifyContent: 'center' }}
                onMouseDown={() => beginDrag({ kind: 'group', id: group.id })}
                onMouseMove={updateDrag}
                onMouseUp={finishDrag}
                tooltip="Drag folder to reorder or nest it"
              >
                <Icon name="GripVertical" size={10} color={dragging?.id === group.id ? '#bde6cf' : '#536174'} />
              </Pressable>
              <Pressable style={ROW_CONTROL} onPress={() => (isRenaming ? commitGroupRename(group) : startGroupRename(group))} tooltip={isRenaming ? 'Save group name' : 'Rename group'}>
                <Icon name={isRenaming ? 'Check' : 'Pencil'} size={11} color={isRenaming ? '#9fc1ee' : '#6f8296'} />
              </Pressable>
              <Pressable style={ROW_CONTROL} onPress={() => onDuplicateGroup(group.id)} tooltip="Duplicate group — copies every member into a new focused group">
                <Icon name="CopyPlus" size={11} color="#6f8296" />
              </Pressable>
              <Pressable style={ROW_CONTROL} onPress={() => onDissolveGroup(group.id)} tooltip="Dissolve group — keeps every member part">
                <Icon name="FolderMinus" size={11} color="#8c735f" />
              </Pressable>
            </>
          ) : null}
        </Row>
        {!isCollapsed ? group.children.map((child) => (
          child.kind === 'group' ? renderGroup(child.group, depth + 1) : renderPart(child.part, depth + 1)
        )) : null}
      </Col>
    );
  };

  const legend = (label: string, color: string, textColor: string) => (
    <Row style={{ alignItems: 'center', gap: 4 }}>
      <Box style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: color }} />
      <Text style={{ fontSize: 8.5, color: textColor }}>{label}</Text>
    </Row>
  );

  return (
    <Col
      style={{
        width: '100%', marginTop: 10, flexGrow: 1, minHeight: 120, position: 'relative',
        backgroundColor: 'rgba(12,14,20,0.55)', borderWidth: 1, borderColor: '#1d2330',
        borderRadius: 8, overflow: 'hidden',
      }}
    >
      <Row style={{ alignItems: 'center', gap: 6, paddingLeft: 10, paddingRight: 8, height: 30, backgroundColor: 'rgba(20,24,34,0.9)', borderBottomWidth: 1, borderColor: '#1d2330' }}>
        <Icon name="ListTree" size={13} color={accentFor('primary')} />
        <Text noWrap numberOfLines={1} style={{ color: accentFor('text'), fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>OUTLINER</Text>
        <Text noWrap style={{ color: accentFor('textFaint'), fontSize: 9, fontFamily: 'monospace' }}>{outlinerHeaderCounts(parts.length, tree)}</Text>
        <Box style={{ flexGrow: 1 }} />
        <Pressable
          style={{ width: 21, height: 21, alignItems: 'center', justifyContent: 'center' }}
          onPress={onFocusSelectionOwner}
          tooltip="Selection surgery — focus the Outliner part that owns the selected vertices, edges, or faces; mixed owners cycle one at a time"
        >
          <Icon name="LocateFixed" size={12} color="#d5aa69" />
        </Pressable>
        <Pressable
          style={{ width: 21, height: 21, alignItems: 'center', justifyContent: 'center' }}
          onPress={onToggleStageFocus}
          tooltip={stageFocusEnabled ? 'Stage selection on — clicking another part in the viewport changes focus' : 'Stage selection locked — only outliner rows can change focus'}
        >
          <Icon name={stageFocusEnabled ? 'LockOpen' : 'Lock'} size={12} color={stageFocusEnabled ? '#79b8d8' : '#d5aa69'} />
        </Pressable>
        <Pressable style={{ width: 21, height: 21, alignItems: 'center', justifyContent: 'center' }} onPress={onGroupSelected} tooltip="Group selected parts — Shift-click rows to build the set">
          <Icon name="FolderPlus" size={13} color="#90b7a0" />
        </Pressable>
        <Pressable style={{ width: 21, height: 21, alignItems: 'center', justifyContent: 'center' }} onPress={onUngroupSelected} tooltip="Remove selected parts from their groups — geometry is kept">
          <Icon name="Ungroup" size={13} color="#8b96a7" />
        </Pressable>
        {onStartRoleNamer ? (
          <Pressable
            style={{ width: 21, height: 21, alignItems: 'center', justifyContent: 'center' }}
            onPress={() => (roleNamer ? onCancelRoleNamer?.() : onStartRoleNamer('car'))}
            tooltip="Name vehicle parts by role, then click each part it asks for"
          >
            <Icon name="Wand2" size={13} color={roleNamer ? '#d9c26b' : '#8b96a7'} />
          </Pressable>
        ) : null}
      </Row>

      {roleNamer ? (
        // The live ask: click the part row that IS this role. Skip = model
        // doesn't have one. The wand (or ✕ here) ends the session early.
        <Row style={{ alignItems: 'center', gap: 6, paddingLeft: 10, paddingRight: 6, height: 26, backgroundColor: '#2b2413', borderBottomWidth: 1, borderColor: '#4a3f1c' }}>
          <Icon name="Wand2" size={12} color="#d9c26b" />
          <Text noWrap style={{ color: '#b3a26b', fontSize: 10 }}>click the part that is</Text>
          <Text noWrap style={{ color: '#f2df9c', fontSize: 11, fontWeight: 800, fontFamily: 'monospace' }}>{roleNamer.role}</Text>
          <Box style={{ flexGrow: 1 }} />
          <Text style={{ color: '#8d7f52', fontSize: 9, fontFamily: 'monospace' }}>{`${roleNamer.done + 1}/${roleNamer.total} · ${roleNamer.contract}`}</Text>
          <Pressable style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }} onPress={() => onSkipRole?.()} tooltip="Skip — this model has no such part">
            <Icon name="SkipForward" size={12} color="#b3a26b" />
          </Pressable>
          <Pressable style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }} onPress={() => onCancelRoleNamer?.()} tooltip="Stop role naming">
            <Icon name="X" size={12} color="#b3a26b" />
          </Pressable>
        </Row>
      ) : null}

      <ScrollView
        style={{ flexGrow: 1, minHeight: 0 }}
        contentContainerStyle={{ flexDirection: 'column', paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2 }}
        onLayout={(rect: any) => { listRectRef.current = rect; }}
        onScroll={(event: any) => { if (Number.isFinite(event?.scrollY)) scrollYRef.current = event.scrollY; }}
      >
        {parts.length === 0 ? (
          <Text style={{ color: accentFor('textFaint'), fontSize: 11, padding: 12 }}>No parts yet — + ADD below.</Text>
        ) : roots.map((root) => (root.kind === 'group' ? renderGroup(root.group, 0) : renderPart(root.part, 0)))}
        {tree.unattributed.length > 0 ? (
          <Col style={{ marginTop: 4, paddingTop: 3, borderTopWidth: 1, borderColor: '#1c2833' }}>
            <Text style={{ fontSize: 8.5, color: accentFor('textFaint'), paddingLeft: 5, height: 14 }}>unattributed — spans several parts or an older host</Text>
            {tree.unattributed.map((leaf) => (
              <AttachmentRow key={`loose-${leaf.kind}-${leaf.id}`} attachment={leaf} onLocate={locate(leaf)} />
            ))}
          </Col>
        ) : null}
        {dragging ? (
          <Row style={{ height: PART_ROW_HEIGHT, alignItems: 'center', paddingLeft: 10, gap: 6, backgroundColor: dropTarget?.kind === 'root' ? '#315a49' : '#111722', borderTopWidth: 1, borderColor: '#294637' }}>
            <Icon name="CornerDownLeft" size={11} color="#88b99b" />
            <Text style={{ color: '#88b99b', fontSize: 10, fontWeight: 700 }}>ROOT</Text>
          </Row>
        ) : null}
      </ScrollView>

      {addOpen ? (
        <Col style={{ position: 'absolute', left: 6, bottom: FOOT_ROW_HEIGHT + 2, width: 190, borderRadius: 6, backgroundColor: accentFor('bgAlt'), borderWidth: 1, borderColor: accentFor('controlBorder'), paddingTop: 3, paddingBottom: 3, overflow: 'hidden' }}>
          {PRIMITIVE_MESHES.map((p) => (
            <Pressable
              key={p.kind}
              onPress={() => { setAddOpen(false); onAdd(p.kind); }}
              style={{ height: 22, flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 9, paddingRight: 9 }}
              hoverStyle={{ backgroundColor: accentFor('surfaceHover') }}
            >
              <Icon name={p.icon} size={12} color={accentFor('textSecondary')} />
              <Text noWrap style={{ fontSize: 10, color: accentFor('textSecondary'), fontWeight: 700 }}>{p.name}</Text>
            </Pressable>
          ))}
          <Box style={{ height: 1, backgroundColor: accentFor('borderSoft'), marginTop: 3, marginBottom: 3 }} />
          <Pressable
            onPress={() => { setAddOpen(false); onImportModel(); }}
            style={{ height: 22, flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 9, paddingRight: 9 }}
            hoverStyle={{ backgroundColor: accentFor('surfaceHover') }}
          >
            <Icon name="PackagePlus" size={12} color="#bfe0c8" />
            <Text noWrap style={{ fontSize: 10, color: '#bfe0c8', fontWeight: 700 }}>Import mesh…</Text>
          </Pressable>
        </Col>
      ) : null}

      <Row style={{ alignItems: 'center', gap: 10, paddingLeft: 8, paddingRight: 10, height: FOOT_ROW_HEIGHT, backgroundColor: 'rgba(18,22,31,0.9)', borderTopWidth: 1, borderColor: '#1d2330' }}>
        <Pressable
          onPress={() => setAddOpen((open) => !open)}
          tooltip="Add a primitive part or import a saved model"
          style={{ height: 20, flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 8, paddingRight: 8, borderRadius: 3, backgroundColor: accentFor('controlBg'), borderWidth: 1, borderColor: addOpen ? accentFor('primary') : accentFor('controlBorder') }}
        >
          <Text style={{ fontSize: 12, fontWeight: 700, color: accentFor('primaryHover') }}>+</Text>
          <Text style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: accentFor('textDim') }}>ADD</Text>
        </Pressable>
        <Box style={{ flexGrow: 1 }} />
        {legend('region', accentFor('textDim'), accentFor('textDim'))}
        {legend('edge', accentFor('success'), EDGE_TINT)}
        {legend('rig', accentFor('info'), RIG_TINT)}
      </Row>
    </Col>
  );
}
