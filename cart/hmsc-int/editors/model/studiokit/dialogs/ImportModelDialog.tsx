// editors/model/studio/dialogs/ImportModelDialog.tsx — lifted verbatim from editors/model/Studio.tsx (req_1390). No behavior change.
import { useState } from 'react';
import { Box, Col, Pressable, Row, Text, TextInput } from '@reactjit/primitives';
import { T } from '../config';
import { Z } from '../chrome/zlayers';
import { base64ToBytes, glbToEditMesh } from '../../importMesh';
import type { EditMesh } from '../../editMesh';
import { readFileBase64 } from '@reactjit/hooks/fs';


// Import a generated/external GLB (tools/genmesh output, or any .glb) as a NEW
// paintable Studio model (req_1383/req_1384). Reads the file via the fs door,
// converts triangle soup -> EditMesh + unwraps UVs (glbToEditMesh), and on success
// hands (mesh, name) to the parent which mints a fresh model + addPart. The mesh is
// unwrapped, so the pixel painter works on it immediately.
export function ImportModelDialog(props: { defaultPath: string; onCancel: () => void; onConfirm: (mesh: EditMesh, name: string) => void }) {
  const [path, setPath] = useState(props.defaultPath);
  const [err, setErr] = useState<string | null>(null);
  const doImport = () => {
    try {
      const b64 = readFileBase64(path);
      if (!b64) throw new Error(`cannot read ${path}`);
      const mesh = glbToEditMesh(base64ToBytes(b64));
      if (!mesh.faces.length) throw new Error('no triangles in GLB');
      const name = (path.split('/').pop() || 'imported').replace(/\.[^.]+$/, '');
      props.onConfirm(mesh, name);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    }
  };
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#03060caa', zIndex: Z.modal }}>
      <Col style={{ width: 460, gap: 11, padding: 16, borderRadius: 10, backgroundColor: T.panelSolid, borderWidth: 1, borderColor: '#3a2c6a' }}>
        <Text fontSize={13} color={T.text} style={{ fontWeight: '800' }}>Import 3D model (GLB)</Text>
        <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>{`a generated mesh (tools/genmesh) becomes a NEW editable, paintable model — UVs are unwrapped on import.`}</Text>
        <LCField label="GLB path">
          <Box style={{ flexGrow: 1 }}>
            <TextInput value={path} onChangeText={(t) => { setErr(null); setPath(t); }} style={{ height: 24, fontSize: 11, color: T.ink, backgroundColor: T.page, borderWidth: 1, borderColor: '#2c4a6a', borderRadius: 4, paddingHorizontal: 6, fontFamily: 'monospace' }} />
          </Box>
        </LCField>
        {err ? <Text fontSize={10} color="#ff9a9a" style={{ fontFamily: 'monospace' }}>{err}</Text> : null}
        <Row style={{ gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <Pressable onPress={props.onCancel} style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#13233aee', borderWidth: 1, borderColor: '#2c4a6a' }}><Text fontSize={11} color={T.dim}>Cancel</Text></Pressable>
          <Pressable onPress={doImport} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#2a1c4a', borderWidth: 1, borderColor: '#6a4fb0' }}><Text fontSize={11} color="#cdbcff" style={{ fontWeight: '800' }}>Import</Text></Pressable>
        </Row>
      </Col>
    </Box>
  );
}
