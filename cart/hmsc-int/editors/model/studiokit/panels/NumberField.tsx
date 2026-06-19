// editors/model/studio/panels/NumberField.tsx — a snapped stepper+entry field
// (used by the add-mesh dialog and friends). Lifted verbatim from
// editors/model/Studio.tsx (req_1390).

import { Box, Pressable, Row, Text, TextInput } from '@reactjit/primitives';
import { STEP_BTN, T } from '../config';
import { clamp } from '../helpers';

export function NumberField(props: { label: string; value: number; onChange: (n: number) => void; min: number; max: number; step: number; snap: number; suffix?: string }) {
  const set = (n: number) => props.onChange(clamp(Math.round(n / props.snap) * props.snap, props.min, props.max));
  return (
    <Row style={{ gap: 8, alignItems: 'center' }}>
      <Text fontSize={11} color={T.dim} style={{ width: 64, fontFamily: 'monospace' }}>{props.label}</Text>
      <Pressable onPress={() => set(props.value - props.step)} style={STEP_BTN}><Text fontSize={13} color={T.text}>−</Text></Pressable>
      <Box style={{ width: 66 }}>
        <TextInput
          value={String(props.value)}
          onChangeText={(t: string) => { const n = parseFloat(t); if (Number.isFinite(n)) set(n); }}
          style={{ height: 24, fontSize: 12, color: T.ink, backgroundColor: T.page, borderWidth: 1, borderColor: '#2c4a6a', borderRadius: 4, paddingHorizontal: 6, textAlign: 'center', fontFamily: 'monospace' }}
        />
      </Box>
      <Pressable onPress={() => set(props.value + props.step)} style={STEP_BTN}><Text fontSize={13} color={T.text}>+</Text></Pressable>
      {props.suffix ? <Text fontSize={10} color={T.dim}>{props.suffix}</Text> : null}
    </Row>
  );
}
