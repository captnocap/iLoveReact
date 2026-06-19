// editors/model/studio/dialogs/BevelPopup.tsx — lifted verbatim from editors/model/Studio.tsx (req_1390). No behavior change.
import { Box, Col, Pressable, Row, Text } from '@reactjit/primitives';
import { STEP_BTN, T } from '../config';
import { Z } from '../chrome/zlayers';


// The bevel sizing popup (req_1266) — set up like the loop cut: the chamfer is
// previewed live on the model and this popup grows/shrinks its WIDTH (in modeling
// units) before you confirm. `maxUnits` is the widest the picked element allows
// (the bevel can't slide a corner past its edge), so the stepper maps 1:1.
export function BevelPopup(props: {
  kind: 'edge' | 'vertex'; width: number; maxUnits: number;
  onChange: (width: number) => void; onApply: () => void; onCancel: () => void;
}) {
  const max = Math.max(0.1, Math.round(props.maxUnits * 10) / 10);
  return (
    <Box style={{ position: 'absolute', left: 0, right: 0, bottom: 18, alignItems: 'center', zIndex: Z.popup }}>
      <Col style={{ gap: 7, paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10, borderRadius: 9, backgroundColor: '#0b1320f2', borderWidth: 1, borderColor: '#2c4a6a', minWidth: 230 }}>
        <Row style={{ gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
          <Text fontSize={11} color={T.text} style={{ fontWeight: '800' }}>Bevel {props.kind === 'edge' ? 'Edge' : 'Vertex'}</Text>
          <Pressable onPress={props.onCancel} style={STEP_BTN}><Text fontSize={10} color={T.dim}>✕</Text></Pressable>
        </Row>
        <LCField label="width"><LCStepper value={props.width} min={0.1} max={max} step={0.5} onChange={(n) => props.onChange(Math.round(n * 10) / 10)} width={54} /></LCField>
        <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace' }}>{`units · max ${max}`}</Text>
        <Pressable onPress={props.onApply} style={{ paddingTop: 6, paddingBottom: 6, borderRadius: 6, alignItems: 'center', backgroundColor: '#1c3a2a', borderWidth: 1, borderColor: '#2f7a4f', marginTop: 2 }}>
          <Text fontSize={11} color="#7fd6a0" style={{ fontWeight: '800' }}>Apply</Text>
        </Pressable>
      </Col>
    </Box>
  );
}
