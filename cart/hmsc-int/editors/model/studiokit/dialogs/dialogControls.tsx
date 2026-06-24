import { Box, Pressable, Row, Text, TextInput } from '@reactjit/primitives';
import { STEP_BTN, T } from '../config';
import { clamp } from '../helpers';

export function LCStepper(props: { value: number; onChange: (n: number) => void; min: number; max: number; step?: number; width?: number }) {
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

export function LCField(props: { label: string; children: any }) {
  return (
    <Row style={{ width: '100%', gap: 10, alignItems: 'center' }}>
      <Text fontSize={10} color={T.dim} style={{ width: 60, fontFamily: 'monospace' }}>{props.label}</Text>
      <Box style={{ flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
        {props.children}
      </Box>
    </Row>
  );
}
