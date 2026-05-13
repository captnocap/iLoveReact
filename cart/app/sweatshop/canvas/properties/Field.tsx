// Small inspector field building blocks. Kept lean — the goal is a
// readable two-column "label / value" rail, not the composer's full
// inspector. As the canvas content layer lands and we know which knobs
// the user actually reaches for, these get specialized (color swatch
// row, step slider, etc.).

import { Box, Col, Row, Text, TextInput } from '@reactjit/runtime/primitives';

export function Section({ label, children }: { label: string; children: any }) {
  return (
    <Col style={{ gap: 4, paddingBottom: 6 }}>
      <Text size={9} color="theme:inkDim" bold>{label.toUpperCase()}</Text>
      <Col style={{ gap: 4 }}>{children}</Col>
    </Col>
  );
}

export function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <Row style={{ gap: 6, alignItems: 'center' }}>
      <Box style={{ width: 64 }}>
        <Text size={9} color="theme:inkDim">{label}</Text>
      </Box>
      <Text size={10} color="theme:ink">{value}</Text>
    </Row>
  );
}

export function TextField({ label, value, placeholder, onChange }: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <Row style={{ gap: 6, alignItems: 'center' }}>
      <Box style={{ width: 64 }}>
        <Text size={9} color="theme:inkDim">{label}</Text>
      </Box>
      <Box style={{ flexGrow: 1, minWidth: 160 }}>
        <TextInput
          value={value}
          placeholder={placeholder}
          onChange={onChange}
          style={{
            width: '100%',
            minWidth: 160,
            paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3,
            borderWidth: 1, borderColor: 'theme:rule',
            backgroundColor: 'theme:bg2',
            color: 'theme:ink',
            fontSize: 10,
          }}
        />
      </Box>
    </Row>
  );
}

export function NumberField({ label, value, onChange }: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <TextField
      label={label}
      value={value === undefined ? '' : String(value)}
      onChange={(s) => {
        const trimmed = s.trim();
        if (trimmed === '') return onChange(undefined);
        const n = Number(trimmed);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}
