// editors/model/studio/dialogs/ConcaveFixPopup.tsx — the concave Auto-Fix alert
// (req_0949/req_1016). Lifted verbatim from editors/model/Studio.tsx (req_1390).
//
// An edit buckled a quad into a non-convex (reflex-corner) face. The mesh is NOT
// silently triangulated — this LOUD dialog (the buckled face still previewed
// behind it) makes the user choose: Split Quads (the recommended fix) / Ignore
// (commit it concave) / Revert (drop it).

import { Box, Col, Pressable, Row, Text } from '@reactjit/primitives';
import { T } from '../config';
import { Z } from '../chrome/zlayers';

export function ConcaveFixPopup(props: { count: number; onResolve: (a: 'split' | 'ignore' | 'revert') => void }) {
  return (
    <Box style={{ position: 'absolute', left: 0, right: 0, bottom: 18, alignItems: 'center', zIndex: Z.popup }}>
      <Col style={{ gap: 8, paddingLeft: 14, paddingRight: 14, paddingTop: 11, paddingBottom: 11, borderRadius: 9, backgroundColor: '#1a1206f2', borderWidth: 1, borderColor: '#a86a2c', minWidth: 280 }}>
        <Row style={{ gap: 8, alignItems: 'center' }}>
          <Text fontSize={12} color="#ffb454" style={{ fontWeight: '800' }}>⚠ Concave face</Text>
          <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>
            {`${props.count} face${props.count === 1 ? '' : 's'} buckled — not convex`}
          </Text>
        </Row>
        <Row style={{ gap: 6 }}>
          <Pressable onPress={() => props.onResolve('split')} style={{ flexGrow: 1, paddingTop: 6, paddingBottom: 6, borderRadius: 6, alignItems: 'center', backgroundColor: '#1c3a2a', borderWidth: 1, borderColor: '#2f7a4f' }}>
            <Text fontSize={11} color="#7fd6a0" style={{ fontWeight: '800' }}>Split Quads</Text>
          </Pressable>
          <Pressable onPress={() => props.onResolve('ignore')} style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: 6, alignItems: 'center', backgroundColor: '#13233aee', borderWidth: 1, borderColor: '#2c4a6a' }}>
            <Text fontSize={11} color={T.dim}>Ignore</Text>
          </Pressable>
          <Pressable onPress={() => props.onResolve('revert')} style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: 6, alignItems: 'center', backgroundColor: '#3a1c1c', borderWidth: 1, borderColor: '#7a2f2f' }}>
            <Text fontSize={11} color="#e08a8a">Revert</Text>
          </Pressable>
        </Row>
        <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace' }}>Split Quads is recommended — keeps the surface valid.</Text>
      </Col>
    </Box>
  );
}
