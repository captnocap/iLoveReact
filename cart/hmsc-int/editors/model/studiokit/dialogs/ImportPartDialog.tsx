// editors/model/studiokit/dialogs/ImportPartDialog.tsx — pull a PART from another
// library model into the open one (req_1583, USER: "make one piece and pull it into
// another"). The parts library is cross-model: every saved model carries its parts
// inline, so this browses the OTHER models and clones a chosen part into the open
// model via `addPart`. The clone is DEEP (`cloneMesh`) so the import is independently
// editable, never a live alias of the source. Geometry + UV + mounts + pivot ride
// along; the model-level PIXEL paint texture does NOT (it's packed per-model) — the
// imported part keeps its shape and re-paints in its new home.

import { useState } from 'react';
import { Box, Col, Pressable, Row, ScrollView, Text } from '@reactjit/primitives';
import { T } from '../config';
import { Z } from '../chrome/zlayers';
import { cloneMesh, type EditMesh } from '../../editMesh';
import { studioModelsList, studioOpenModelId } from '../../studioModel';
import type { StoredModel, StoredPart } from '../../modelStream';

export function ImportPartDialog(props: {
  onClose: () => void;
  /** clone-into-open: the dialog hands a fresh deep copy + the source name/lift. */
  onImport: (mesh: EditMesh, name: string, lift: number) => void;
}) {
  const openId = studioOpenModelId();
  const others: StoredModel[] = studioModelsList().filter((m) => m.id !== openId);
  // a brief "✓ imported" flash on the last-picked part (the part lands in the open
  // model's outliner; this just confirms the click landed without closing the picker).
  const [flash, setFlash] = useState<string | null>(null);
  const partsOf = (m: StoredModel): StoredPart[] => m.order.map((id) => m.parts[id]).filter(Boolean);
  const pick = (m: StoredModel, p: StoredPart) => {
    props.onImport(cloneMesh(p.mesh), p.name, p.lift);
    setFlash(`${m.id}:${p.id}`);
  };
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#03060caa', zIndex: Z.modal }}>
      <Col style={{ width: 420, maxHeight: '80%', gap: 11, padding: 16, borderRadius: 10, backgroundColor: T.panelSolid, borderWidth: 1, borderColor: '#2c4a6a' }}>
        <Text fontSize={13} color={T.text} style={{ fontWeight: '800' }}>Import part from another model</Text>
        <Text fontSize={10} color={T.dim}>Click a part to drop a copy into this model. Shape, UV, mounts &amp; pivot copy over — paint is re-done in the new model.</Text>
        {others.length === 0 ? (
          <Text fontSize={11} color={T.dim} style={{ paddingTop: 6, paddingBottom: 6 }}>No other models yet — save a second model to pull parts between them.</Text>
        ) : (
          <ScrollView style={{ flexGrow: 1, flexBasis: 0, minHeight: 0, maxHeight: 420 }}>
            <Col style={{ gap: 10 }}>
              {others.map((m) => {
                const parts = partsOf(m);
                return (
                  <Col key={m.id} style={{ gap: 5 }}>
                    <Text fontSize={10} color={T.dim} style={{ fontWeight: '800', letterSpacing: 1 }}>{`${m.name} (${parts.length})`}</Text>
                    {parts.length === 0 ? (
                      <Text fontSize={10} color={T.dim} style={{ fontStyle: 'italic' }}>empty</Text>
                    ) : parts.map((p) => {
                      const lit = flash === `${m.id}:${p.id}`;
                      return (
                        <Pressable key={p.id} onPress={() => pick(m, p)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: lit ? '#1c3a2a' : '#13233aee', borderWidth: 1, borderColor: lit ? '#2f7a4f' : '#2c4a6a' }}>
                          <Box style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: p.color }} />
                          <Text fontSize={11} color={lit ? '#7fd6a0' : T.text} style={{ flexGrow: 1 }}>{p.name}</Text>
                          <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace' }}>{`${p.mesh.verts.length}v · ${p.mesh.faces.length}f`}</Text>
                          <Text fontSize={10} color={lit ? '#7fd6a0' : '#5b8fd6'} style={{ fontWeight: '800' }}>{lit ? '✓' : '+'}</Text>
                        </Pressable>
                      );
                    })}
                  </Col>
                );
              })}
            </Col>
          </ScrollView>
        )}
        <Row style={{ gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <Pressable onPress={props.onClose} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#13233aee', borderWidth: 1, borderColor: '#2c4a6a' }}><Text fontSize={11} color={T.text} style={{ fontWeight: '800' }}>Done</Text></Pressable>
        </Row>
      </Col>
    </Box>
  );
}
