import { useState } from 'react';
import { Box, Col, Row, Text, Pressable, ScrollView, TextInput } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import type { MapDocumentSummary } from '../data/mapDocuments';

const PANEL = '#17181b';
const CARD = '#1f2126';
const BORDER = '#2a2c31';
const TEXT = '#e8e8ea';
const DIM = '#9a9ea6';
const ACCENT = '#6ea8fe';
const MONO = 'ui-monospace';

export default function MapDocumentsDialog(props: {
  current: string;
  documents: readonly MapDocumentSummary[];
  onOpen: (stem: string) => void;
  onNew: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('untitled');
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(4,5,7,0.68)', alignItems: 'center', justifyContent: 'center' }}>
      <Col style={{ width: 620, height: 540, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER, borderRadius: 14, overflow: 'hidden' }}>
        <Row style={{ height: 46, alignItems: 'center', gap: 9, paddingLeft: 14, paddingRight: 12, borderBottomWidth: 1, borderBottomColor: BORDER }}>
          <Icon name="Map" size={16} color={ACCENT} />
          <Text style={{ color: TEXT, fontSize: 14, fontWeight: '700' }}>Map Workspaces</Text>
          <Box style={{ flexGrow: 1 }} />
          <Text style={{ color: DIM, fontSize: 10, fontFamily: MONO }}>{props.documents.length} saved</Text>
          <Pressable onPress={props.onClose} style={{ padding: 6 }}><Icon name="X" size={14} color={DIM} /></Pressable>
        </Row>

        <Col style={{ padding: 14, gap: 12, flexGrow: 1, minHeight: 0 }}>
          <Col style={{ gap: 7 }}>
            <Text style={{ color: DIM, fontSize: 10, fontFamily: MONO }}>NEW MAP — the current map is flushed before the clean document opens</Text>
            <Row style={{ gap: 8, alignItems: 'center' }}>
              <TextInput
                value={name}
                onChange={setName}
                placeholder="map name"
                style={{ flexGrow: 1, height: 32, color: TEXT, backgroundColor: '#101114', borderWidth: 1, borderColor: BORDER, borderRadius: 7, paddingLeft: 10, paddingRight: 10, fontSize: 12 }}
              />
              <Pressable onPress={() => props.onNew(name)} style={{ height: 32, paddingLeft: 14, paddingRight: 14, borderRadius: 7, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#0b1018', fontSize: 11, fontWeight: '800' }}>Create clean map</Text>
              </Pressable>
            </Row>
          </Col>

          <Text style={{ color: DIM, fontSize: 10, fontFamily: MONO }}>OPEN MAP — painting, pieces, and markers switch as one document</Text>
          <ScrollView style={{ flexGrow: 1, minHeight: 0 }} showScrollbar>
            <Col style={{ gap: 6 }}>
              {props.documents.map((document) => {
                const active = document.stem === props.current;
                return (
                  <Pressable
                    key={document.stem}
                    onPress={() => { if (!active) props.onOpen(document.stem); }}
                    style={{ minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 11, paddingRight: 11, borderRadius: 8, backgroundColor: active ? '#20344f' : CARD, borderWidth: 1, borderColor: active ? ACCENT : BORDER, opacity: active ? 1 : 0.96 }}
                  >
                    <Icon name={active ? 'MapPinned' : 'Map'} size={15} color={active ? ACCENT : DIM} />
                    <Col style={{ gap: 3, flexGrow: 1 }}>
                      <Text style={{ color: TEXT, fontSize: 12, fontWeight: '700', fontFamily: MONO }}>{document.stem}</Text>
                      <Text style={{ color: DIM, fontSize: 10 }}>
                        {document.hasPainting ? 'painting' : 'fresh painting'} · {document.hasWorld ? 'pieces/props/markers save' : 'empty authored objects'}
                      </Text>
                    </Col>
                    <Text style={{ color: active ? ACCENT : DIM, fontSize: 10, fontFamily: MONO }}>{active ? 'ACTIVE' : 'OPEN'}</Text>
                  </Pressable>
                );
              })}
            </Col>
          </ScrollView>
        </Col>
      </Col>
    </Box>
  );
}
