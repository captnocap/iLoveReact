import { useEffect, useMemo, useState } from 'react';
import { Box, Col, Row, Text, Pressable, ScrollView } from '@reactjit/runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { accentFor } from '../workspace.cls';
import {
  buildWorldOutliner,
  outlinerExpansionForSelection,
  selectedOutlinerKeys,
  type WorldOutlinerFocus,
  type WorldOutlinerRow,
  type WorldOutlinerSection,
  type WorldOutlinerTarget,
} from '../world/worldOutliner';
import type { ArchitectureSelection, ArchitectureSource } from '../world/architecture';
import type { PlacedPiece } from '../world/pieces';
import type { WorldFloraPatch } from '../world/surfaceFlora';
import type { AuthoredFloraSpecies } from '../world/floraSpecies';

// The WORLD OUTLINER (req_4737): everything placed on the active map as one
// grouped tree — buildings (connected walls), structures (touching pieces),
// props, and flora (species → patch → derived plants). Rows select through the
// SAME world selection state the viewport renders, and viewport picks light and
// auto-expand their row — two views over one selection, never a second store.
//
// Same row vocabulary as the model outliner: verbs appear on hover/selection
// only; the one v1 verb is Locate (recenter the camera on the row's entity).
const ROW_HEIGHT = 24;
const LEAF_ROW_HEIGHT = 20;

export type WorldOutlinerHandlers = {
  onSelectPiece: (id: string) => void;
  onSelectPieces: (ids: readonly string[]) => void;
  onSelectWall: (edgeId: string) => void;
  onSelectOpening: (edgeId: string, openingId: string) => void;
  onSelectFloraPatch: (id: string) => void;
  /** Recenter the world camera on a row's entity (keeps the current orbit). */
  onLocate: (focus: WorldOutlinerFocus) => void;
};

export default function WorldOutliner({ architecture, pieces, worldFlora, floraSpecies, selectedPieceIds, architectureSelection, selectedFloraPatchId, handlers }: {
  architecture: ArchitectureSource;
  pieces: readonly PlacedPiece[];
  worldFlora: readonly WorldFloraPatch[];
  floraSpecies: readonly AuthoredFloraSpecies[];
  selectedPieceIds: readonly string[];
  architectureSelection: ArchitectureSelection;
  selectedFloraPatchId: string | null;
  handlers: WorldOutlinerHandlers;
}) {
  const sections = useMemo(
    () => buildWorldOutliner({ architecture, pieces, worldFlora, floraSpecies }),
    [architecture, pieces, worldFlora, floraSpecies],
  );
  const selectedKeys = useMemo(
    () => selectedOutlinerKeys({ selectedPieceIds, architectureSelection, selectedFloraPatchId }),
    [selectedPieceIds, architectureSelection, selectedFloraPatchId],
  );
  // Groups start folded — mass is the whole reason the tree groups (req_4737).
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  // The reverse direction of the two-way contract: a viewport pick unfolds the
  // path to its row so the highlight is actually visible.
  const selectionSignature = [...selectedKeys].sort().join('|');
  useEffect(() => {
    if (selectedKeys.size === 0) return;
    const path = outlinerExpansionForSelection(sections, selectedKeys);
    if (path.size === 0) return;
    setExpandedKeys((current) => {
      const merged = new Set(current);
      for (const key of path) merged.add(key);
      return merged.size === current.length ? current : [...merged];
    });
  }, [selectionSignature, sections]);
  const expanded = new Set(expandedKeys);
  const toggleExpanded = (key: string) => setExpandedKeys((current) => (
    current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]
  ));

  const select = (target: WorldOutlinerTarget) => {
    if (target.kind === 'piece') handlers.onSelectPiece(target.id);
    else if (target.kind === 'pieceGroup') handlers.onSelectPieces(target.ids);
    else if (target.kind === 'wallEdge') handlers.onSelectWall(target.edgeId);
    // A building has no single selection record yet — selecting it means its
    // first wall; the group highlight comes from expansion + member rows.
    else if (target.kind === 'building') handlers.onSelectWall(target.edgeIds[0]!);
    else if (target.kind === 'wallOpening') handlers.onSelectOpening(target.edgeId, target.openingId);
    else if (target.kind === 'floraPatch') handlers.onSelectFloraPatch(target.id);
  };

  const renderRow = (row: WorldOutlinerRow, depth: number): any => {
    const hasChildren = row.children.length > 0;
    const isExpanded = hasChildren && expanded.has(row.key);
    const isSelected = selectedKeys.has(row.key);
    const containsSelection = !isSelected && hasChildren && rowContainsSelection(row, selectedKeys);
    const hovered = hoveredKey === row.key;
    const leaf = !hasChildren && depth > 0;
    return (
      <Col key={row.key} style={{ width: '100%' }}>
        <Row
          onMouseEnter={() => setHoveredKey(row.key)}
          onMouseLeave={() => setHoveredKey((key) => (key === row.key ? null : key))}
          style={{
            alignItems: 'center', gap: 4, paddingLeft: 5 + depth * 14, paddingRight: 5,
            height: leaf ? LEAF_ROW_HEIGHT : ROW_HEIGHT, borderRadius: 3,
            backgroundColor: isSelected ? accentFor('segActiveBg') : containsSelection ? '#0e2429' : 'transparent',
            borderWidth: 1, borderColor: isSelected ? '#2a5a63' : 'transparent',
          }}
        >
          <Pressable
            style={{ width: 12, height: ROW_HEIGHT, alignItems: 'center', justifyContent: 'center' }}
            onPress={hasChildren ? () => toggleExpanded(row.key) : undefined}
            tooltip={hasChildren ? (isExpanded ? 'Collapse' : 'Expand') : undefined}
          >
            <Text style={{ fontSize: 8, color: accentFor('textFaint') }}>{hasChildren ? (isExpanded ? '▾' : '▸') : '·'}</Text>
          </Pressable>
          <Pressable
            onPress={row.target ? () => select(row.target!) : hasChildren ? () => toggleExpanded(row.key) : undefined}
            tooltip={row.target ? `Select ${row.label} in the world` : undefined}
            style={{ flexGrow: 1, minWidth: 0, height: leaf ? LEAF_ROW_HEIGHT : ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Icon name={row.icon} size={leaf ? 10 : 12} color={isSelected ? accentFor('segActiveText') : accentFor('textDim')} />
            <Text numberOfLines={1} noWrap style={{ flexShrink: 1, minWidth: 0, color: isSelected ? accentFor('segActiveText') : accentFor('textSecondary'), fontSize: leaf ? 10 : 11, fontWeight: 700 }}>{row.label}</Text>
          </Pressable>
          {(hovered || isSelected) && row.focus ? (
            <Pressable
              style={{ width: 18, height: ROW_HEIGHT, alignItems: 'center', justifyContent: 'center' }}
              onPress={() => handlers.onLocate(row.focus!)}
              tooltip={`Jump the camera to ${row.focus.label}`}
            >
              <Icon name="LocateFixed" size={11} color="#d5aa69" />
            </Pressable>
          ) : (
            <Text noWrap style={{ fontSize: 8.5, color: accentFor('textFaint') }}>{row.meta}</Text>
          )}
        </Row>
        {isExpanded ? row.children.map((child) => renderRow(child, depth + 1)) : null}
      </Col>
    );
  };

  const renderSection = (section: WorldOutlinerSection) => {
    const key = `section:${section.key}`;
    // Sections default OPEN, rows default CLOSED, in the one expandedKeys list:
    // a section's key present means the user folded it away.
    const isCollapsed = expanded.has(key);
    return (
      <Col key={key} style={{ width: '100%', marginBottom: 4 }}>
        <Pressable
          onPress={() => toggleExpanded(key)}
          style={{ height: 22, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 5, paddingRight: 6, borderRadius: 3, backgroundColor: '#0c141d' }}
          tooltip={isCollapsed ? `Expand ${section.label.toLowerCase()}` : `Collapse ${section.label.toLowerCase()}`}
        >
          <Icon name={isCollapsed ? 'ChevronRight' : 'ChevronDown'} size={12} color="#7890aa" />
          <Icon name={section.icon} size={11} color={accentFor('textDim')} />
          <Text noWrap style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 1, color: accentFor('textSecondary') }}>{section.label}</Text>
          <Box style={{ flexGrow: 1 }} />
          <Text noWrap style={{ fontSize: 9, fontFamily: 'monospace', color: accentFor('textFaint') }}>{`${section.count}`}</Text>
        </Pressable>
        {!isCollapsed ? (
          section.rows.length === 0
            ? <Text style={{ color: accentFor('textFaint'), fontSize: 10, paddingLeft: 19, paddingTop: 3, paddingBottom: 3 }}>nothing placed yet</Text>
            : section.rows.map((row) => renderRow(row, 0))
        ) : null}
      </Col>
    );
  };

  const totalPlaced = sections.reduce((sum, section) => sum + section.count, 0);
  return (
    <Col
      style={{
        width: '100%', flexGrow: 1, minHeight: 120,
        backgroundColor: 'rgba(12,14,20,0.55)', borderWidth: 1, borderColor: '#1d2330',
        borderRadius: 8, overflow: 'hidden',
      }}
    >
      <Row style={{ alignItems: 'center', gap: 6, paddingLeft: 10, paddingRight: 8, height: 30, backgroundColor: 'rgba(20,24,34,0.9)', borderBottomWidth: 1, borderColor: '#1d2330' }}>
        <Icon name="ListTree" size={13} color={accentFor('primary')} />
        <Text noWrap numberOfLines={1} style={{ color: accentFor('text'), fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>WORLD</Text>
        <Text noWrap style={{ color: accentFor('textFaint'), fontSize: 9, fontFamily: 'monospace' }}>{`${totalPlaced} placed`}</Text>
        <Box style={{ flexGrow: 1 }} />
      </Row>
      <ScrollView
        style={{ flexGrow: 1, minHeight: 0 }}
        contentContainerStyle={{ flexDirection: 'column', paddingLeft: 4, paddingRight: 4, paddingTop: 4, paddingBottom: 4 }}
      >
        {totalPlaced === 0 ? (
          <Text style={{ color: accentFor('textFaint'), fontSize: 11, padding: 12 }}>
            Nothing placed on this map yet — walls, pieces, and painted flora all list here.
          </Text>
        ) : sections.map(renderSection)}
      </ScrollView>
    </Col>
  );
}

function rowContainsSelection(row: WorldOutlinerRow, selectedKeys: ReadonlySet<string>): boolean {
  return row.children.some((child) => selectedKeys.has(child.key) || rowContainsSelection(child, selectedKeys));
}
