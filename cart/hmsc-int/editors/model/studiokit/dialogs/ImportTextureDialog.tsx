// editors/model/studio/dialogs/ImportTextureDialog.tsx — lifted verbatim from editors/model/Studio.tsx (req_1390). No behavior change.
import { useState } from 'react';
import { Box, Col, Pressable, Row, Text, TextInput } from '@reactjit/primitives';
import { T } from '../config';
import { Z } from '../chrome/zlayers';
import type { RasterSlice } from '../../textureize';
import { LCField } from './dialogControls';


// ── Import Texture dialog (req_1079) ──────────────────────────────────────────
// Re-upload an edited / AI-generated PNG so the model captures the visual changes.
// Just a PNG path (pre-filled with this scene's export path, so the round-trip —
// export → edit → import — is one click); the model samples it through the existing
// UVs, so the cookie cutter is automatic (overshoot outside the islands is ignored).

export function ImportTextureDialog(props: { slice?: RasterSlice; defaultPath: string; onCancel: () => void; onConfirm: (path: string) => void }) {
  const [path, setPath] = useState(props.defaultPath);
  const target = props.slice ? `face ${props.slice.faceIndex} (slice)` : 'the whole sprite sheet';
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#03060caa', zIndex: Z.modal }}>
      <Col style={{ width: 460, gap: 11, padding: 16, borderRadius: 10, backgroundColor: T.panelSolid, borderWidth: 1, borderColor: '#3a2c6a' }}>
        <Text fontSize={13} color={T.text} style={{ fontWeight: '800' }}>Import Texture</Text>
        <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>{`re-upload a PNG onto ${target} — it slips back via the UVs (cookie cutter).`}</Text>
        <LCField label="PNG path">
          <Box style={{ flexGrow: 1 }}>
            <TextInput value={path} onChangeText={setPath} style={{ height: 24, fontSize: 11, color: T.ink, backgroundColor: T.page, borderWidth: 1, borderColor: '#2c4a6a', borderRadius: 4, paddingHorizontal: 6, fontFamily: 'monospace' }} />
          </Box>
        </LCField>
        <Row style={{ gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <Pressable onPress={props.onCancel} style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#13233aee', borderWidth: 1, borderColor: '#2c4a6a' }}><Text fontSize={11} color={T.dim}>Cancel</Text></Pressable>
          <Pressable onPress={() => props.onConfirm(path)} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#2a1c4a', borderWidth: 1, borderColor: '#6a4fb0' }}><Text fontSize={11} color="#cdbcff" style={{ fontWeight: '800' }}>Import</Text></Pressable>
        </Row>
      </Col>
    </Box>
  );
}
