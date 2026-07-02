import { Box, Col, Row, Text, Pressable, ScrollView } from '@reactjit/runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { PRIMITIVE_MESHES } from '../data/commands';
import type { ModelPart, PrimitiveKind } from '../data/types';

// The model OUTLINER — the Studio concept ported to the new editor: a model is a list of
// PARTS (each its own mesh), and this panel lists them with the row verbs (select /
// visibility / duplicate / delete) plus an add-bar to drop another primitive as a new
// part or append a saved library model (cross-model reuse). Selection highlights the
// whole part in the host (via its face-group range) so the gizmo moves it.
// Housed in the Model Focus panel (Inspector) — an inline block, not a viewport overlay.
export default function ModelOutliner({ parts, activeId, onSelect, onToggleVisible, onDuplicate, onDelete, onAdd, onImportModel }: {
  parts: ModelPart[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: (kind: PrimitiveKind) => void;
  onImportModel: () => void;
}) {
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
        <Text style={{ color: '#cfe0f5', fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>OUTLINER</Text>
        <Box style={{ flexGrow: 1 }} />
        <Text style={{ color: '#5d6878', fontSize: 11, fontFamily: 'monospace' }}>{`${parts.length}`}</Text>
      </Row>

      <ScrollView style={{ maxHeight: 300 }} contentContainerStyle={{ flexDirection: 'column' }}>
        {parts.length === 0 ? (
          <Text style={{ color: '#5d6878', fontSize: 11, padding: 12 }}>No parts yet — add one below.</Text>
        ) : parts.map((part) => {
          const active = part.id === activeId;
          return (
            <Row
              key={part.id}
              style={{
                alignItems: 'center', gap: 7, paddingLeft: 9, paddingRight: 7, height: 27,
                backgroundColor: active ? '#2a466e' : 'transparent',
                borderBottomWidth: 1, borderColor: '#161b26',
              }}
            >
              <Pressable onPress={() => onToggleVisible(part.id)} tooltip={part.visible ? 'Hide part' : 'Show part'}>
                <Icon name={part.visible ? 'Eye' : 'EyeOff'} size={13} color={part.visible ? '#9db4d0' : '#4a5464'} />
              </Pressable>
              <Pressable onPress={() => onSelect(part.id)} style={{ flexGrow: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Box style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: part.color }} />
                <Text numberOfLines={1} noWrap style={{ color: active ? '#eaf2ff' : (part.visible ? '#cfe0f5' : '#6b7686'), fontSize: 12, fontWeight: active ? 700 : 500 }}>{part.name}</Text>
              </Pressable>
              <Pressable onPress={() => onDuplicate(part.id)} tooltip="Duplicate part (paint carries; Mirror lives in the right-click menu)">
                <Icon name="CopyPlus" size={12} color="#6f8296" />
              </Pressable>
              <Pressable onPress={() => onDelete(part.id)} tooltip="Delete part">
                <Icon name="Trash2" size={12} color="#7d5a5a" />
              </Pressable>
            </Row>
          );
        })}
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
