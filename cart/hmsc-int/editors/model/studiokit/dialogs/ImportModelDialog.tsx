// editors/model/studiokit/dialogs/ImportModelDialog.tsx
//
// Import a generated/external mesh (tools/genmesh output, or any .glb / .obj) as a
// NEW paintable Studio model (req_1383/req_1384). The file is chosen with the native
// OS picker (req_1617), parsed to a flat MeshSoup, and shown with a DETAIL slider
// (req_2078): the source can be a million-triangle scan/sculpt, but a Studio model is
// an editable+paintable+undoable EditMesh living in a 4MB localstore value, so we
// vertex-cluster it down to an editable triangle budget the user dials live. Without
// this the naive lift OOM-killed V8 on a 9–14MB file. On Import the decimated soup
// becomes a UV-unwrapped EditMesh handed to the parent, which mints a fresh model +
// addPart. OBJ support (req_1615): InstantMesh emits a plain-text .obj.
import { useRef, useState } from 'react';
import { Box, Col, Pressable, Row, Text, Slider } from '@reactjit/primitives';
import { T } from '../config';
import { Z } from '../chrome/zlayers';
import {
  base64ToBytes, glbToSoup, objToSoup, decimateSoup, soupToEditMesh, soupTriCount,
  gridForTargetTris, normalizeStudioImport, MAX_IMPORT_TRIS, type MeshSoup,
} from '../../importMesh';
import { unwrap, type EditMesh } from '../../editMesh';
import { readFile, readFileBase64 } from '@reactjit/hooks/fs';
import { pickModelFile } from '../../pickModelFile';

// Slider maps to the clustering grid resolution; these bound the UI travel. Low =
// chunky/low-poly, high = fine. GRID_MAX is high enough that the top of the slider
// recovers most of a mesh's detail (up to MAX_IMPORT_TRIS); gridForTargetTris seeds
// the default low so the FIRST import is snappy — drag right for more.
const GRID_MIN = 6;
const GRID_MAX = 512;
const DEFAULT_TARGET_TRIS = 25_000;
const num = (n: number) => n.toLocaleString();

export function ImportModelDialog(props: { defaultPath: string; onCancel: () => void; onConfirm: (mesh: EditMesh, name: string) => void }) {
  const [path, setPath] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fullTris, setFullTris] = useState<number | null>(null);
  const [outTris, setOutTris] = useState<number | null>(null);
  const [grid, setGrid] = useState(GRID_MAX);
  const soupRef = useRef<MeshSoup | null>(null);
  // The generated-models folder seeds the picker so it opens where fresh meshes land.
  const startDir = props.defaultPath.replace(/\/[^/]*$/, '');

  const previewAt = (g: number) => {
    const soup = soupRef.current;
    if (!soup) return;
    setGrid(g);
    setOutTris(soupTriCount(decimateSoup(soup, g)));
  };

  const doChoose = async () => {
    setErr(null);
    const picked = await pickModelFile('Pick a 3D model (.glb / .obj)', startDir);
    if (!picked) return;
    setPath(picked);
    soupRef.current = null;
    setFullTris(null);
    setOutTris(null);
    try {
      // .obj is plain text (InstantMesh emits OBJ); .glb is binary (base64).
      let soup: MeshSoup;
      if (picked.toLowerCase().endsWith('.obj')) {
        const text = readFile(picked);
        if (!text) throw new Error(`cannot read ${picked}`);
        soup = objToSoup(text);
      } else {
        const b64 = readFileBase64(picked);
        if (!b64) throw new Error(`cannot read ${picked}`);
        soup = glbToSoup(base64ToBytes(b64));
      }
      const full = soupTriCount(soup);
      if (!full) throw new Error('no triangles in mesh');
      soupRef.current = soup;
      setFullTris(full);
      // Seed the slider so the default import is a clean low-poly mesh under budget.
      const g = Math.max(GRID_MIN, Math.min(GRID_MAX, gridForTargetTris(soup, Math.min(full, DEFAULT_TARGET_TRIS))));
      previewAt(g);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    }
  };

  const doImport = () => {
    const soup = soupRef.current;
    if (!soup || !path) return;
    try {
      // decimate → guard budget → sanitize+center+scale into the Studio frame → unwrap
      const mesh = unwrap(normalizeStudioImport(soupToEditMesh(decimateSoup(soup, grid))));
      if (!mesh.faces.length) throw new Error('no triangles in mesh');
      const name = (path.split('/').pop() || 'imported').replace(/\.[^.]+$/, '');
      props.onConfirm(mesh, name);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    }
  };

  const chosenName = path ? (path.split('/').pop() || path) : null;
  const overBudget = outTris != null && outTris > MAX_IMPORT_TRIS;
  const canImport = !!soupRef.current && outTris != null && outTris > 0 && !overBudget;
  const reduced = fullTris != null && outTris != null && outTris < fullTris;

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

        {fullTris != null ? (
          <Col style={{ gap: 7, paddingTop: 2, paddingBottom: 2 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>{`source: ${num(fullTris)} triangles`}</Text>
              <Text fontSize={11} color={overBudget ? '#ff9a9a' : '#7fd6a0'} style={{ fontFamily: 'monospace', fontWeight: '800' }}>{`import: ${num(outTris ?? 0)} tris`}</Text>
            </Row>
            <Row style={{ gap: 8, alignItems: 'center' }}>
              <Text fontSize={10} color={T.dim} style={{ width: 40 }}>Detail</Text>
              <Box style={{ flexGrow: 1 }}>
                <Slider value={grid} min={GRID_MIN} max={GRID_MAX} step={1} onCommit={(g: number) => previewAt(Math.round(g))} style={{ backgroundColor: '#1a1530', color: '#6a4fb0' }} />
              </Box>
            </Row>
            <Text fontSize={9} color={overBudget ? '#ff9a9a' : T.dim} style={{ fontFamily: 'monospace' }}>
              {overBudget
                ? `over budget — max ${num(MAX_IMPORT_TRIS)} editable tris; lower Detail`
                : reduced
                  ? `simplified to fit an editable, paintable model (drag for more/less detail)`
                  : `mesh fits as-is — drag left to simplify`}
            </Text>
          </Col>
        ) : null}

        {err ? <Text fontSize={10} color="#ff9a9a" style={{ fontFamily: 'monospace' }}>{err}</Text> : null}
        <Row style={{ gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <Pressable onPress={props.onCancel} style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#13233aee', borderWidth: 1, borderColor: '#2c4a6a' }}><Text fontSize={11} color={T.dim}>Cancel</Text></Pressable>
          <Pressable onPress={doImport} disabled={!canImport} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: canImport ? '#2a1c4a' : '#1a1530', borderWidth: 1, borderColor: canImport ? '#6a4fb0' : '#3a3060', opacity: canImport ? 1 : 0.5 }}><Text fontSize={11} color="#cdbcff" style={{ fontWeight: '800' }}>Import</Text></Pressable>
        </Row>
      </Col>
    </Box>
  );
}
