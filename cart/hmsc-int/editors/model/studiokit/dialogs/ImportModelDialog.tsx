// editors/model/studio/dialogs/ImportModelDialog.tsx — lifted verbatim from editors/model/Studio.tsx (req_1390). No behavior change.
import { useState } from 'react';
import { Box, Col, Pressable, Row, Text } from '@reactjit/primitives';
import { T } from '../config';
import { Z } from '../chrome/zlayers';
import { base64ToBytes, glbToEditMesh, objToEditMesh } from '../../importMesh';
import type { EditMesh } from '../../editMesh';
import { readFile, readFileBase64 } from '@reactjit/hooks/fs';
import { pickModelFile } from '../../pickModelFile';


// Import a generated/external mesh (tools/genmesh output, or any .glb / .obj) as
// a NEW paintable Studio model (req_1383/req_1384). The file is chosen with the
// native OS picker (req_1617 — the same zenity door the image upload uses, no
// typing a path), read via the fs door, converted to an EditMesh + UV-unwrapped,
// and on success handed (mesh, name) to the parent which mints a fresh model +
// addPart. The mesh is unwrapped, so the pixel painter works on it immediately.
// OBJ support (req_1615): InstantMesh emits a plain-text .obj.
export function ImportModelDialog(props: { defaultPath: string; onCancel: () => void; onConfirm: (mesh: EditMesh, name: string) => void }) {
  const [path, setPath] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // The generated-models folder seeds the picker so it opens where fresh meshes land.
  const startDir = props.defaultPath.replace(/\/[^/]*$/, '');
  const doChoose = async () => {
    setErr(null);
    const picked = await pickModelFile('Pick a 3D model (.glb / .obj)', startDir);
    if (picked) setPath(picked);
  };
  const doImport = () => {
    if (!path) return;
    try {
      // .obj is plain text (InstantMesh emits OBJ); .glb is binary (base64).
      let mesh: EditMesh;
      if (path.toLowerCase().endsWith('.obj')) {
        const text = readFile(path);
        if (!text) throw new Error(`cannot read ${path}`);
        mesh = objToEditMesh(text);
      } else {
        const b64 = readFileBase64(path);
        if (!b64) throw new Error(`cannot read ${path}`);
        mesh = glbToEditMesh(base64ToBytes(b64));
      }
      if (!mesh.faces.length) throw new Error('no triangles in mesh');
      const name = (path.split('/').pop() || 'imported').replace(/\.[^.]+$/, '');
      props.onConfirm(mesh, name);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    }
  };
  const chosenName = path ? (path.split('/').pop() || path) : null;
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#03060caa', zIndex: Z.modal }}>
      <Col style={{ width: 460, gap: 11, padding: 16, borderRadius: 10, backgroundColor: T.panelSolid, borderWidth: 1, borderColor: '#3a2c6a' }}>
        <Text fontSize={13} color={T.text} style={{ fontWeight: '800' }}>Import 3D model (GLB / OBJ)</Text>
        <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>{`a generated mesh (.glb or .obj — e.g. InstantMesh) becomes a NEW editable, paintable model — UVs are unwrapped on import.`}</Text>
        <Row style={{ gap: 8, alignItems: 'center' }}>
          <Pressable onPress={doChoose} style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#13233aee', borderWidth: 1, borderColor: '#2c4a6a' }}><Text fontSize={11} color={T.text}>Choose file…</Text></Pressable>
          <Box style={{ flexGrow: 1, flexShrink: 1 }}>
            <Text fontSize={11} color={chosenName ? T.text : T.dim} style={{ fontFamily: 'monospace' }}>{chosenName ?? 'no file chosen'}</Text>
          </Box>
        </Row>
        {err ? <Text fontSize={10} color="#ff9a9a" style={{ fontFamily: 'monospace' }}>{err}</Text> : null}
        <Row style={{ gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <Pressable onPress={props.onCancel} style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#13233aee', borderWidth: 1, borderColor: '#2c4a6a' }}><Text fontSize={11} color={T.dim}>Cancel</Text></Pressable>
          <Pressable onPress={doImport} disabled={!path} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: path ? '#2a1c4a' : '#1a1530', borderWidth: 1, borderColor: path ? '#6a4fb0' : '#3a3060', opacity: path ? 1 : 0.5 }}><Text fontSize={11} color="#cdbcff" style={{ fontWeight: '800' }}>Import</Text></Pressable>
        </Row>
      </Col>
    </Box>
  );
}
