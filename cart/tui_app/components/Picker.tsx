import { Box, Row, Text, Pressable } from '@reactjit/runtime/primitives';

export function Picker<T extends string>({ value, options, labels, onChange }: {
  value: T;
  options: T[];
  labels?: Partial<Record<T, string>>;
  onChange: (v: T) => void;
}) {
  return (
    <Row style={{ gap: 1, flexWrap: 'wrap' }}>
      {options.map((opt) => {
        const active = opt === value;
        return (
          <Pressable key={opt} onPress={() => onChange(opt)}>
            <Box style={{
              paddingLeft: 1,
              paddingRight: 1,
              backgroundColor: active ? '#fbbf24' : '#1f2937',
            }}>
              <Text style={{ color: active ? '#000000' : '#94a3b8', fontWeight: active ? 'bold' : 'normal' }}>
                {labels?.[opt] || opt}
              </Text>
            </Box>
          </Pressable>
        );
      })}
    </Row>
  );
}

