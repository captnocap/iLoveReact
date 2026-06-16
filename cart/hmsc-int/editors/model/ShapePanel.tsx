// editors/model/ShapePanel.tsx — the ENCODED SHAPE of the live edit mesh, in
// workspace column 3 under the UV unwrap + the RIG panel (req_1060). The user
// wants to SEE the encoded data of what's live in the editor — the same bytes
// the V20 stream persists (StoredPart.mesh = the serialized EditMesh). This is a
// pure READ-ONLY view: a structured decode (vert/face/edge counts, per-face
// loops, uv/material flags, pivot, mounts) over the exact JSON that round-trips
// through the store, recomputed on the active part's `version`.
//
// A sibling of StudioUVPanel + StudioRigPanel: it reads the SHARED studio store
// (studioModel.ts) so column 3 and column 4 (the viewport) never diverge. See
// ../MESH_EDITOR_PLAYBOOK.md Part 5 / Part 6.

import { useMemo, useState } from 'react';
import { Box, Col, Pressable, Row, Text } from '@reactjit/primitives';
import { set as clipboardSet } from '@reactjit/hooks/clipboard';
import { GAME_CHROME } from '../../game';
import { meshEdges, pivotOf, hasPivot, type EditMesh, type V3 } from './editMesh';
import { useStudioModel } from './studioModel';
import { STUDIO } from './Studio';

const T = GAME_CHROME.tokens.color;

const CARD = { padding: 8, borderRadius: 7, backgroundColor: '#0b1320cc', borderWidth: 1, borderColor: '#27364a' } as const;
const BTN = { paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3, borderRadius: 5, backgroundColor: '#13233aee', borderWidth: 1, borderColor: '#2c4a6a' } as const;

// meters → modeling units (16 u = 1 tile = 1 m), the Studio's display basis.
const u = (m: number) => (m * STUDIO.unitsPerTile).toFixed(1);
const fmtV3 = (p: V3) => `${u(p[0])}, ${u(p[1])}, ${u(p[2])}`;

function Stat(props: { label: string; value: string; tint?: string }) {
  return (
    <Col style={{ gap: 1, alignItems: 'center', minWidth: 44 }}>
      <Text fontSize={15} color={props.tint ?? T.text} style={{ fontFamily: 'monospace', fontWeight: '800' }}>{props.value}</Text>
      <Text fontSize={8} color={T.dim} style={{ fontFamily: 'monospace' }}>{props.label}</Text>
    </Col>
  );
}

export function StudioShapePanel() {
  const model = useStudioModel();
  const part = model.activePart;
  const [showJson, setShowJson] = useState(false);
  const [copied, setCopied] = useState(false);

  // Recompute the decode ONLY when the active part's mesh changes (id+version) —
  // the same key the UV panel uses, so a geometry edit refreshes it but an
  // unrelated re-render doesn't re-walk the mesh.
  const decode = useMemo(() => {
    if (!part) return null;
    const m: EditMesh = part.mesh;
    const edges = meshEdges(m);
    const uvFaces = m.faces.filter((f) => f.uv && f.uv.length).length;
    // the exact persisted bytes: StoredPart.mesh, serialized as it round-trips
    // through V20. Pretty-printed for reading; this IS the encoded shape.
    const json = JSON.stringify(m, (_k, v) => (typeof v === 'number' ? Number(v.toFixed(4)) : v), 1);
    return { m, edges, uvFaces, json, bytes: json.length };
  }, [part?.id, part?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!part || !decode) {
    return (
      <Box style={{ padding: 14, borderRadius: 8, backgroundColor: '#0b1320aa', borderWidth: 1, borderColor: '#27364a' }}>
        <Text fontSize={11} color={T.dim} style={{ fontFamily: 'monospace' }}>select a part to see its encoded shape</Text>
      </Box>
    );
  }

  const { m, edges, uvFaces, json } = decode;
  const mounts = m.mounts ?? [];

  return (
    <Col style={{ gap: 8, width: '100%' }}>
      {/* the counts — V / F / E (verts, faces, edges), the encoded topology. */}
      <Row style={{ gap: 4, justifyContent: 'space-around', ...CARD }}>
        <Stat label="verts" value={`${m.verts.length}`} tint="#e0584e" />
        <Stat label="faces" value={`${m.faces.length}`} tint="#5ec26a" />
        <Stat label="edges" value={`${edges.length}`} tint="#4aa3ff" />
        <Stat label="uv'd" value={`${uvFaces}/${m.faces.length}`} />
        <Stat label="mounts" value={`${mounts.length}`} tint="#ff8a3d" />
      </Row>

      {/* pivot — the encoded rotation origin (absent unless opted in, req_1054). */}
      <Row style={{ gap: 6, alignItems: 'center', ...CARD }}>
        <Box style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: hasPivot(m) ? '#ff8a3d' : '#3a4a5e' }} />
        <Text fontSize={10} color={hasPivot(m) ? '#ffb37d' : T.dim} style={{ fontFamily: 'monospace', fontWeight: '800' }}>pivot</Text>
        <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace' }}>
          {hasPivot(m) ? `${fmtV3(pivotOf(m))} u` : `none · bounds center ${fmtV3(pivotOf(m))} u`}
        </Text>
      </Row>

      {/* per-face loops — the vertex-index loop of every face, the n-gon topology. */}
      <Col style={{ gap: 3, ...CARD }}>
        <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace', fontWeight: '800' }}>faces · vertex loops</Text>
        {m.faces.map((f, i) => (
          <Row key={i} style={{ gap: 6, alignItems: 'center' }}>
            <Text fontSize={9} color={T.dim} style={{ width: 20, fontFamily: 'monospace', textAlign: 'right' }}>{i}</Text>
            <Text fontSize={9} color={T.text} style={{ flexGrow: 1, fontFamily: 'monospace' }}>
              {`[${f.loop.join(' ')}]`}
            </Text>
            <Text fontSize={8} color={f.uv && f.uv.length ? '#5ec26a' : '#3a4a5e'} style={{ fontFamily: 'monospace' }}>
              {f.uv && f.uv.length ? 'uv' : '—'}
            </Text>
            {f.material != null ? <Text fontSize={8} color="#b49bc9" style={{ fontFamily: 'monospace' }}>{`m${f.material}`}</Text> : null}
          </Row>
        ))}
      </Col>

      {/* mounts — the named joints/sockets encoded on the mesh (req_1025). */}
      {mounts.length ? (
        <Col style={{ gap: 3, ...CARD }}>
          <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace', fontWeight: '800' }}>mounts</Text>
          {mounts.map((mt) => (
            <Row key={mt.name} style={{ gap: 6, alignItems: 'center' }}>
              <Text fontSize={9} color="#ffb37d" style={{ fontFamily: 'monospace', fontWeight: '800' }}>{mt.name}</Text>
              <Text fontSize={9} color={T.dim} style={{ flexGrow: 1, fontFamily: 'monospace' }}>{mt.kind}</Text>
              <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace' }}>{`${fmtV3(mt.position)} u`}</Text>
            </Row>
          ))}
        </Col>
      ) : null}

      {/* the raw encoded JSON — the EXACT bytes StoredPart.mesh persists, on demand. */}
      <Row style={{ gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace' }}>{`encoded · ${json.length} B`}</Text>
        <Row style={{ gap: 6, alignItems: 'center' }}>
          {/* copy the encoded mesh JSON to the system clipboard (the data face) */}
          <Pressable
            onPress={() => { clipboardSet(json); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
            style={{ ...BTN, backgroundColor: copied ? '#1c3a2a' : '#13233aee', borderColor: copied ? '#2f7a4f' : '#2c4a6a' }}
          >
            <Text fontSize={10} color={copied ? '#7fd6a0' : T.text} style={{ fontFamily: 'monospace' }}>{copied ? 'copied ✓' : 'copy'}</Text>
          </Pressable>
          <Pressable onPress={() => setShowJson((v) => !v)} style={BTN}>
            <Text fontSize={10} color={T.text} style={{ fontFamily: 'monospace' }}>{showJson ? 'hide json ▴' : 'show json ▾'}</Text>
          </Pressable>
        </Row>
      </Row>
      {showJson ? (
        <Box style={{ padding: 8, borderRadius: 6, backgroundColor: '#070b12', borderWidth: 1, borderColor: '#27364a' }}>
          <Text fontSize={8} color={T.text} style={{ fontFamily: 'monospace', width: '100%' }}>{json}</Text>
        </Box>
      ) : null}
    </Col>
  );
}
