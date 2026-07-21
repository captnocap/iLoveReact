import { useState } from 'react';
import { Box, Col, Row, Text, TextInput, Pressable } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { parseScaleByFactor, SCALE_BY_TUNING } from '../data/scaleBy';

const PANEL = '#17181b';
const BORDER = '#2a2c31';
const TEXT = '#e8e8ea';
const DIM = '#9a9ea6';
const ACCENT = '#6ea8fe';
const MONO = 'ui-monospace';

function factorLabel(factor: number): string {
  return Number.isInteger(factor) ? String(factor) : String(factor).replace(/0+$/, '').replace(/\.$/, '');
}
export default function ScaleByDialog({ onCancel, onApply }: {
  onCancel: () => void;
  onApply: (factor: number) => void;
}) {
  const [draft, setDraft] = useState(String(SCALE_BY_TUNING.defaultFactor));
  const parsed = parseScaleByFactor(draft);
  const submit = () => { if (parsed.ok) onApply(parsed.factor); };

  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(4,5,7,0.66)', alignItems: 'center', justifyContent: 'center' }}>
      <Col style={{ width: 360, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER, borderRadius: 14, padding: 18, gap: 12 }}>
        <Row style={{ alignItems: 'center', gap: 8 }}>
          <Icon name="Scale3d" size={16} color={ACCENT} />
          <Text style={{ color: TEXT, fontSize: 15, fontWeight: 700 }}>Scale By</Text>
          <Box style={{ flexGrow: 1 }} />
          <Pressable onPress={onCancel}><Text style={{ color: DIM, fontSize: 12 }}>cancel</Text></Pressable>
        </Row>

        <Row style={{ alignItems: 'center', gap: 8 }}>
          <Text style={{ width: 62, color: TEXT, fontSize: 11 }}>Factor</Text>
          <Text style={{ color: ACCENT, fontSize: 13, fontFamily: MONO, fontWeight: 800 }}>×</Text>
          <TextInput
            autoFocus
            value={draft}
            onChange={(value: string) => setDraft(value)}
            onSubmit={submit}
            onKeyDown={(event: any) => { if (String(event?.key).toLowerCase() === 'enter') submit(); }}
            style={{ flexGrow: 1, minWidth: 0, height: 30, paddingLeft: 9, paddingRight: 9, borderRadius: 6, borderWidth: 1, borderColor: parsed.ok ? ACCENT : '#744a4a', backgroundColor: '#0d1015', color: TEXT, fontSize: 12, fontFamily: MONO, fontWeight: 700 }}
          />
        </Row>

        <Row style={{ gap: 6, paddingLeft: 70 }}>
          {SCALE_BY_TUNING.presets.map((factor) => (
            <Pressable
              key={factor}
              onPress={() => setDraft(String(factor))}
              style={{ minWidth: 52, height: 25, alignItems: 'center', justifyContent: 'center', borderRadius: 5, borderWidth: 1, borderColor: Number(draft) === factor ? ACCENT : BORDER, backgroundColor: Number(draft) === factor ? '#24446d' : '#1f2126' }}
            >
              <Text style={{ color: TEXT, fontSize: 10, fontFamily: MONO, fontWeight: 700 }}>×{factorLabel(factor)}</Text>
            </Pressable>
          ))}
        </Row>

        <Text style={{ color: parsed.ok ? DIM : '#d98d8d', fontSize: 10, lineHeight: 15 }}>
          {parsed.ok
            ? (parsed.factor < 0
              ? 'Negative scale mirrors through the selection pivot · one Undo · camera reframes unless locked.'
              : 'Uniform around the current selection pivot · one Undo · camera reframes unless locked.')
            : parsed.error}
        </Text>

        <Row style={{ gap: 8, justifyContent: 'flex-end' }}>
          <Pressable onPress={onCancel} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 7, paddingBottom: 7, borderRadius: 8, borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: DIM, fontSize: 12 }}>Cancel</Text>
          </Pressable>
          <Pressable onPress={submit} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 7, paddingBottom: 7, borderRadius: 8, backgroundColor: parsed.ok ? ACCENT : '#34373d' }}>
            <Text style={{ color: parsed.ok ? '#0d0e10' : '#777b84', fontSize: 12, fontWeight: 800 }}>Scale Selection</Text>
          </Pressable>
        </Row>
      </Col>
    </Box>
  );
}
