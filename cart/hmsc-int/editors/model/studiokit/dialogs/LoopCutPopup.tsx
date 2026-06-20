// editors/model/studio/dialogs/LoopCutPopup.tsx — lifted verbatim from editors/model/Studio.tsx (req_1390). No behavior change.
import { Box, Col, Pressable, Row, Text } from '@reactjit/primitives';
import { STEP_BTN, T } from '../config';
import { Z } from '../chrome/zlayers';
import { LCField, LCStepper } from './dialogControls';


// ── Loop-cut popup (req_0984/0985) ────────────────────────────────────────────
// The small, non-invasive Blockbench panel: Direction (which in-plane axis),
// Cuts (how many), Offset (where), Unit (size-units vs percent). Every change
// re-previews live (the parent drives the draft); Apply commits, ✕ cancels.

export function LoopCutPopup(props: {
  dir: 0 | 1; cuts: number; offset: number; unit: 'units' | 'percent'; sizeUnits: number;
  onChange: (patch: Partial<{ dir: 0 | 1; cuts: number; offset: number; unit: 'units' | 'percent' }>) => void;
  onApply: () => void; onCancel: () => void;
}) {
  const offMax = props.unit === 'percent' ? 100 : Math.max(1, Math.round(props.sizeUnits));
  return (
    <Box style={{ position: 'absolute', left: 0, right: 0, bottom: 18, alignItems: 'center', zIndex: Z.popup }}>
      <Col style={{ gap: 7, paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10, borderRadius: 9, backgroundColor: '#0b1320f2', borderWidth: 1, borderColor: '#2c4a6a', minWidth: 250 }}>
        <Row style={{ gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
          <Text fontSize={11} color={T.text} style={{ fontWeight: '800' }}>Loop Cut</Text>
          <Pressable onPress={props.onCancel} style={STEP_BTN}><Text fontSize={10} color={T.dim}>✕</Text></Pressable>
        </Row>
        <LCField label="direction"><LCStepper value={props.dir} min={0} max={1} onChange={(n) => props.onChange({ dir: (n ? 1 : 0) as 0 | 1 })} width={40} /></LCField>
        <LCField label="cuts"><LCStepper value={props.cuts} min={1} max={64} onChange={(n) => props.onChange({ cuts: Math.round(n) })} width={40} /></LCField>
        <LCField label="offset"><LCStepper value={props.offset} min={0} max={offMax} onChange={(n) => props.onChange({ offset: n })} width={54} /></LCField>
        <LCField label="unit">
          <Row style={{ gap: 4 }}>
            {(['units', 'percent'] as const).map((u) => {
              const on = props.unit === u;
              const lbl = u === 'units' ? 'Size Units' : 'Percent';
              return (
                <Pressable
                  key={u}
                  onPress={() => {
                    if (props.unit === u) return;
                    const off = u === 'percent'
                      ? (props.sizeUnits > 0 ? (props.offset / props.sizeUnits) * 100 : 0)
                      : (props.offset / 100) * props.sizeUnits;
                    props.onChange({ unit: u, offset: Math.round(off * 10) / 10 });
                  }}
                  style={{ ...STEP_BTN, backgroundColor: on ? '#2a3f5e' : '#13233aee', borderColor: on ? '#5b8fd6' : '#2c4a6a' }}
                >
                  <Text fontSize={9} color={on ? '#cfe2ff' : T.dim}>{lbl}</Text>
                </Pressable>
              );
            })}
          </Row>
        </LCField>
        <Pressable onPress={props.onApply} style={{ paddingTop: 6, paddingBottom: 6, borderRadius: 6, alignItems: 'center', backgroundColor: '#1c3a2a', borderWidth: 1, borderColor: '#2f7a4f', marginTop: 2 }}>
          <Text fontSize={11} color="#7fd6a0" style={{ fontWeight: '800' }}>Apply</Text>
        </Pressable>
      </Col>
    </Box>
  );
}
