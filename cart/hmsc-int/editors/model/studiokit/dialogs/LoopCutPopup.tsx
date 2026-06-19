// editors/model/studio/dialogs/LoopCutPopup.tsx — lifted verbatim from editors/model/Studio.tsx (req_1390). No behavior change.
import { Box, Col, Pressable, Row, Text, TextInput } from '@reactjit/primitives';
import { STEP_BTN, T } from '../config';
import { clamp } from '../helpers';


// ── Loop-cut popup (req_0984/0985) ────────────────────────────────────────────
// The small, non-invasive Blockbench panel: Direction (which in-plane axis),
// Cuts (how many), Offset (where), Unit (size-units vs percent). Every change
// re-previews live (the parent drives the draft); Apply commits, ✕ cancels.

function LCStepper(props: { value: number; onChange: (n: number) => void; min: number; max: number; step?: number; width?: number }) {
  const step = props.step ?? 1;
  const set = (n: number) => props.onChange(clamp(n, props.min, props.max));
  return (
    <Row style={{ gap: 4, alignItems: 'center' }}>
      <Pressable onPress={() => set(props.value - step)} style={STEP_BTN}><Text fontSize={12} color={T.text}>−</Text></Pressable>
      <Box style={{ width: props.width ?? 54 }}>
        <TextInput
          value={String(props.value)}
          onChangeText={(t: string) => { const n = parseFloat(t); if (Number.isFinite(n)) set(n); }}
          style={{ height: 22, fontSize: 11, color: T.ink, backgroundColor: T.page, borderWidth: 1, borderColor: '#2c4a6a', borderRadius: 4, paddingHorizontal: 6, textAlign: 'center', fontFamily: 'monospace' }}
        />
      </Box>
      <Pressable onPress={() => set(props.value + step)} style={STEP_BTN}><Text fontSize={12} color={T.text}>+</Text></Pressable>
    </Row>
  );
}

function LCField(props: { label: string; children: any }) {
  return (
    <Row style={{ gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
      <Text fontSize={10} color={T.dim} style={{ width: 60, fontFamily: 'monospace' }}>{props.label}</Text>
      {props.children}
    </Row>
  );
}

export function LoopCutPopup(props: {
  dir: 0 | 1; cuts: number; offset: number; unit: 'units' | 'percent'; sizeUnits: number;
  onChange: (patch: Partial<{ dir: 0 | 1; cuts: number; offset: number; unit: 'units' | 'percent' }>) => void;
  onApply: () => void; onCancel: () => void;
}) {
  const offMax = props.unit === 'percent' ? 100 : Math.max(1, Math.round(props.sizeUnits));
  return (
    <Box style={{ position: 'absolute', left: 0, right: 0, bottom: 18, alignItems: 'center' }}>
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
