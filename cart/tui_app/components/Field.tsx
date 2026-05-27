import * as React from 'react';
import { Box, Col, Row, Text, TextInput, Pressable } from '@reactjit/runtime/primitives';

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Col style={{ width: '100%', gap: 0, paddingBottom: 1 }}>
      <Text style={{ color: '#94a3b8' }}>{label}</Text>
      {children}
    </Col>
  );
}

export function Input({ value, onChange, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder || ''}
      style={{
        width: '100%',
        color: '#e7eaff',
        backgroundColor: '#0b1020',
        borderWidth: 1,
        borderColor: '#334155',
        paddingLeft: 1,
        paddingRight: 1,
      }}
    />
  );
}

export function Button({ label, onPress, tone = 'primary' }: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'muted' | 'danger';
}) {
  const bg = tone === 'primary' ? '#22d3ee' : tone === 'danger' ? '#7f1d1d' : '#1f2937';
  const fg = tone === 'primary' ? '#000000' : tone === 'danger' ? '#fecaca' : '#e7eaff';
  return (
    <Pressable onPress={onPress}>
      <Box style={{ paddingLeft: 2, paddingRight: 2, backgroundColor: bg }}>
        <Text style={{ color: fg, fontWeight: tone === 'primary' ? 'bold' : 'normal' }}>{label}</Text>
      </Box>
    </Pressable>
  );
}

export function KeyValue({ label, value, color = '#e7eaff' }: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <Row style={{ gap: 2, paddingLeft: 2 }}>
      <Text style={{ color: '#94a3b8' }}>{label}</Text>
      <Text style={{ color }}>{value}</Text>
    </Row>
  );
}

