import { useState } from 'react';
import { Box, Col, Pressable, Row, Text, TextInput } from '../../../runtime/primitives';

const PANEL = '#17181b';
const BORDER = '#2a2c31';
const TEXT = '#e8e8ea';
const DIM = '#9a9ea6';
const ACCENT = '#6ea8fe';

export default function PrefabDialog(props: {
  pieceCount: number;
  onCancel: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState('New Building');
  const submit = () => { if (name.trim()) props.onCreate(name.trim()); };
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(4,5,7,0.6)', alignItems: 'center', justifyContent: 'center' }}>
      <Col style={{ width: 380, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER, borderRadius: 14, padding: 18, gap: 12 }}>
        <Row style={{ alignItems: 'center', gap: 8 }}>
          <Text style={{ color: TEXT, fontSize: 15, fontWeight: '600' }}>Create Prefab</Text>
          <Box style={{ flexGrow: 1 }} />
          <Pressable onPress={props.onCancel}><Text style={{ color: DIM, fontSize: 12 }}>cancel</Text></Pressable>
        </Row>
        <Text style={{ color: DIM, fontSize: 11 }}>{props.pieceCount} selected piece{props.pieceCount === 1 ? '' : 's'} will become one reusable palette action. Stamps stay individually editable.</Text>
        <TextInput
          value={name}
          onChange={setName}
          onSubmit={submit}
          placeholder="Prefab name"
          style={{ height: 34, paddingLeft: 10, paddingRight: 10, borderRadius: 7, borderWidth: 1, borderColor: BORDER, backgroundColor: '#0f1012', color: TEXT, fontSize: 12 }}
        />
        <Row style={{ gap: 8, justifyContent: 'flex-end' }}>
          <Pressable onPress={props.onCancel} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 7, paddingBottom: 7, borderRadius: 8, borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: DIM, fontSize: 12 }}>Cancel</Text>
          </Pressable>
          <Pressable onPress={submit} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 7, paddingBottom: 7, borderRadius: 8, backgroundColor: ACCENT }}>
            <Text style={{ color: '#0d0e10', fontSize: 12, fontWeight: '700' }}>Create &amp; Arm</Text>
          </Pressable>
        </Row>
      </Col>
    </Box>
  );
}
