// editor/dialogs/ImportPartDialog.tsx — the "Add From Library" picker (req_2520).
//
// The old studio's Import Part dialog, remade for the new editor: browse the saved
// model library and APPEND a pick into the OPEN model as new part(s). Studio models
// import per authored part (deep-copied seeds — never a live alias); cooked assets
// append their triangle blob; file-backed imports host-parse via __mesh_append_file.
// Pick the same model again to reuse it any number of times — that IS the reuse story.
import { useState } from 'react';
import { Box, Col, Row, Text, Pressable, ScrollView, TextInput } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import type { ModelPackage } from '../data/types';

const PANEL = '#17181b', BORDER = '#2a2c31', TEXT = '#e8e8ea', DIM = '#9a9ea6', ACCENT = '#6ea8fe', ROW = '#1d1f24';

export default function ImportPartDialog({ models, onPick, onCancel }: {
  models: ModelPackage[];
  onPick: (pkg: ModelPackage) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const rows = models
    .filter((m) => !needle || m.name.toLowerCase().includes(needle) || m.kind.includes(needle) || (m.semanticKind ?? '').includes(needle))
    .slice(0, 60);

  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(4,5,7,0.6)', alignItems: 'center', justifyContent: 'center' }}>
      <Col style={{ width: 440, maxHeight: 520, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER, borderRadius: 14, padding: 16, gap: 10 }}>
        <Row style={{ alignItems: 'center', gap: 8 }}>
          <Icon name="PackagePlus" size={16} color={ACCENT} />
          <Text style={{ color: TEXT, fontSize: 15, fontWeight: '600' }}>Add From Library</Text>
          <Box style={{ flexGrow: 1 }} />
          <Pressable onPress={onCancel}><Text style={{ color: DIM, fontSize: 12 }}>cancel</Text></Pressable>
        </Row>
        <Text style={{ color: DIM, fontSize: 11 }}>Append a saved model into the open model as new part(s). A pick is a deep copy — edit it freely; pick the same model again to reuse it.</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="filter models…"
          style={{ height: 26, paddingLeft: 8, paddingRight: 8, borderRadius: 6, borderWidth: 1, borderColor: BORDER, backgroundColor: '#0f1012', color: TEXT, fontSize: 12 }}
        />
        <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ flexDirection: 'column', gap: 4 }}>
          {rows.length === 0 ? (
            <Text style={{ color: DIM, fontSize: 11, padding: 10 }}>No models match — the library is browsed from the content panel's Models folders.</Text>
          ) : rows.map((m) => (
            <Pressable
              key={m.id}
              onPress={() => onPick(m)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 9, paddingRight: 9, paddingTop: 6, paddingBottom: 6, borderRadius: 7, backgroundColor: ROW, borderWidth: 1, borderColor: BORDER }}
            >
              <Box style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: m.color }} />
              <Col style={{ flexGrow: 1, minWidth: 0, gap: 1 }}>
                <Text numberOfLines={1} noWrap style={{ color: TEXT, fontSize: 12, fontWeight: 600 }}>{m.name}</Text>
                <Text numberOfLines={1} noWrap style={{ color: DIM, fontSize: 10 }}>{`${m.sourceKind ?? 'indexed'} · ${m.semanticKind ?? m.kind}${m.triangles > 0 ? ` · ${m.triangles} tris` : ''}`}</Text>
              </Col>
              <Icon name="Plus" size={13} color={ACCENT} />
            </Pressable>
          ))}
        </ScrollView>
      </Col>
    </Box>
  );
}
