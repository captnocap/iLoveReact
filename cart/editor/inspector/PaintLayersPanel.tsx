// One paint-layer panel for every Studio paint target. The model painter adapts
// its host stroke-program table into this surface; facade documents adapt their
// durable Facade.layers rows. Ordering and verbs therefore cannot drift.
import { useState } from 'react';
import { Box, Col, Pressable, Row, ScrollView, Text } from '@reactjit/runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { REGIONS } from '../shell/regions';
import { C } from '../workspace.cls';

export type PaintLayerPanelRow<Id extends string | number = string | number> = {
  id: Id;
  name: string;
  visible: boolean;
  strokes: number;
};

const ROW_HEIGHT = 27;
const ROWS_VISIBLE = 5;
const CONTROL = {
  width: REGIONS.grid.stepBtn, height: ROW_HEIGHT,
  alignItems: 'center', justifyContent: 'center',
} as const;

export default function PaintLayersPanel<Id extends string | number>(props: {
  rows: readonly PaintLayerPanelRow<Id>[]; // bottom → top
  activeId: Id;
  onAdd: () => boolean;
  onActive: (id: Id) => boolean;
  onVisible: (id: Id, visible: boolean) => boolean;
  onRename: (id: Id, name: string) => boolean;
  onMove: (id: Id, direction: 'up' | 'down') => boolean;
  onMergeDown: (id: Id) => boolean;
  onDelete: (id: Id) => boolean;
}) {
  const [hint, setHint] = useState<string | null>(null);
  if (!props.rows.length) return null;
  const rows = [...props.rows].reverse();
  const listHeight = Math.min(rows.length, ROWS_VISIBLE) * ROW_HEIGHT;
  return (
    <Col style={{ width: '100%', marginTop: 10, backgroundColor: 'rgba(12,14,20,0.55)', borderWidth: 1, borderColor: '#1d2330', borderRadius: 8, overflow: 'hidden' }}>
      <Row style={{ alignItems: 'center', gap: 6, paddingLeft: 10, paddingRight: 8, height: 30, backgroundColor: 'rgba(20,24,34,0.9)', borderBottomWidth: 1, borderColor: '#1d2330' }}>
        <Icon name="Layers" size={13} color="#8fb6c9" />
        <Text noWrap numberOfLines={1} style={{ color: '#cfe0f5', fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>PAINT LAYERS</Text>
        <Box style={{ flexGrow: 1 }} />
        <Pressable
          onPress={() => { if (props.onAdd()) setHint('New layer added on top — new strokes land on it.'); }}
          tooltip="Add a layer on top (new strokes land on it)"
          style={{ height: 20, paddingLeft: 7, paddingRight: 7, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 5, backgroundColor: '#16233aee', borderWidth: 1, borderColor: '#2c4a6a' }}
        >
          <Icon name="Plus" size={11} color="#cfe0f5" />
          <Text noWrap style={{ color: '#cfe0f5', fontSize: 10, fontWeight: 700 }}>layer</Text>
        </Pressable>
      </Row>
      <ScrollView style={{ height: listHeight }} contentContainerStyle={{ flexDirection: 'column' }}>
        {rows.map((layer) => {
          const active = layer.id === props.activeId;
          return (
            <Row key={String(layer.id)} style={{ alignItems: 'center', gap: 4, paddingLeft: 5, paddingRight: 5, height: ROW_HEIGHT, backgroundColor: active ? '#2a466e' : 'transparent', borderBottomWidth: 1, borderColor: '#161b26' }}>
              <Pressable style={CONTROL} onPress={() => props.onVisible(layer.id, !layer.visible)} tooltip={layer.visible ? 'Hide this layer\'s strokes' : 'Show this layer\'s strokes'}>
                <Icon name={layer.visible ? 'Eye' : 'EyeOff'} size={13} color={layer.visible ? '#9db4d0' : '#4a5464'} />
              </Pressable>
              {active ? (
                <C.HW_RenameInput value={layer.name} onChange={(name: string) => props.onRename(layer.id, name)} />
              ) : (
                <Pressable onPress={() => props.onActive(layer.id)} tooltip="Make this the active layer (new strokes land here)" style={{ flexGrow: 1, minWidth: 0, height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text numberOfLines={1} noWrap style={{ color: layer.visible ? '#cfe0f5' : '#6b7686', fontSize: 12, fontWeight: 500 }}>{layer.name}</Text>
                </Pressable>
              )}
              <Text noWrap style={{ color: '#5d6878', fontSize: 10, fontFamily: 'monospace' }}>{String(layer.strokes)}</Text>
              <Pressable style={CONTROL} onPress={() => props.onMove(layer.id, 'up')} tooltip="Move layer up (composites over)"><Icon name="ChevronUp" size={12} color="#6f8296" /></Pressable>
              <Pressable style={CONTROL} onPress={() => props.onMove(layer.id, 'down')} tooltip="Move layer down (composites under)"><Icon name="ChevronDown" size={12} color="#6f8296" /></Pressable>
              <Pressable style={CONTROL} onPress={() => { if (props.onMergeDown(layer.id)) setHint(`Merged ${layer.name} into the layer below.`); else setHint('Nothing below to merge into.'); }} tooltip="Merge this layer's strokes into the layer below"><Icon name="GitMerge" size={12} color="#6f8296" /></Pressable>
              <Pressable style={CONTROL} onPress={() => { if (props.onDelete(layer.id)) setHint(`Deleted ${layer.name} (${layer.strokes} strokes).`); }} tooltip="Delete this layer and its strokes"><Icon name="Trash2" size={12} color="#7d5a5a" /></Pressable>
            </Row>
          );
        })}
      </ScrollView>
      {hint ? <Row style={{ alignItems: 'center', paddingLeft: 10, paddingRight: 10, paddingTop: 3, paddingBottom: 3, backgroundColor: 'rgba(18,22,31,0.9)', borderTopWidth: 1, borderColor: '#1d2330' }}><Text numberOfLines={1} noWrap style={{ color: '#8b97a8', fontSize: 9, fontFamily: 'monospace' }}>{hint}</Text></Row> : null}
    </Col>
  );
}
