// Name Faces (req_3872/req_3880): the human lane onto the semantic region table.
// Opened by the mesh-name-faces command (N in face mode) as a blocking dialog —
// the action bar is already full, so naming gets a popover, not another chip.
// Reusing an existing name extends that region; the chips below the input are
// the live table's names for exactly that reuse.
import { useState } from 'react';
import { Box, Col, Row, Text, TextInput, Pressable } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';

const PANEL = '#17181b';
const BORDER = '#2a2c31';
const TEXT = '#e8e8ea';
const DIM = '#9a9ea6';
const ACCENT = '#6ea8fe';
const MONO = 'ui-monospace';

const NAME_CHIP_LIMIT = 12;

export function parseRegionName(draft: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = draft.trim();
  if (!name) return { ok: false, error: 'Type a region name — cushion, backrest, headrest…' };
  if (name === '_') return { ok: false, error: '"_" is the anonymous escape, not a name' };
  return { ok: true, name };
}

export default function NameFacesDialog({ selectedFaces, existingNames, onCancel, onApply }: {
  selectedFaces: number;
  existingNames: string[];
  onCancel: () => void;
  onApply: (name: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const parsed = parseRegionName(draft);
  const submit = () => { if (parsed.ok) onApply(parsed.name); };
  const chips = existingNames.slice(0, NAME_CHIP_LIMIT);

  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(4,5,7,0.66)', alignItems: 'center', justifyContent: 'center' }}>
      <Col style={{ width: 380, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER, borderRadius: 14, padding: 18, gap: 12 }}>
        <Row style={{ alignItems: 'center', gap: 8 }}>
          <Icon name="Tag" size={16} color={ACCENT} />
          <Text style={{ color: TEXT, fontSize: 15, fontWeight: 700 }}>Name Faces</Text>
          <Text style={{ color: DIM, fontSize: 11, fontFamily: MONO }}>{`${selectedFaces} selected`}</Text>
          <Box style={{ flexGrow: 1 }} />
          <Pressable onPress={onCancel}><Text style={{ color: DIM, fontSize: 12 }}>cancel</Text></Pressable>
        </Row>

        <TextInput
          autoFocus
          value={draft}
          onChange={(value: string) => setDraft(value)}
          onSubmit={submit}
          onKeyDown={(event: any) => { if (String(event?.key).toLowerCase() === 'enter') submit(); }}
          placeholder="region name — cushion, backrest, bolster…"
          style={{ height: 30, paddingLeft: 9, paddingRight: 9, borderRadius: 6, borderWidth: 1, borderColor: parsed.ok ? ACCENT : BORDER, backgroundColor: '#0d1015', color: TEXT, fontSize: 12, fontFamily: MONO, fontWeight: 700 }}
        />

        {chips.length > 0 ? (
          <Row style={{ gap: 6, flexWrap: 'wrap' }}>
            {chips.map((name) => (
              <Pressable
                key={name}
                onPress={() => setDraft(name)}
                style={{ height: 25, paddingLeft: 10, paddingRight: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 5, borderWidth: 1, borderColor: draft.trim() === name ? ACCENT : BORDER, backgroundColor: draft.trim() === name ? '#24446d' : '#1f2126' }}
              >
                <Text style={{ color: TEXT, fontSize: 10, fontFamily: MONO, fontWeight: 700 }}>{name}</Text>
              </Pressable>
            ))}
          </Row>
        ) : null}

        <Text style={{ color: parsed.ok ? DIM : '#d98d8d', fontSize: 10, lineHeight: 15 }}>
          {parsed.ok
            ? 'A durable semantic region — reusing a name extends that region · rides the blob on Save · rigging and skinning read these.'
            : parsed.error}
        </Text>

        <Row style={{ gap: 8, justifyContent: 'flex-end' }}>
          <Pressable onPress={onCancel} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 7, paddingBottom: 7, borderRadius: 8, borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: DIM, fontSize: 12 }}>Cancel</Text>
          </Pressable>
          <Pressable onPress={submit} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 7, paddingBottom: 7, borderRadius: 8, backgroundColor: parsed.ok ? ACCENT : '#34373d' }}>
            <Text style={{ color: parsed.ok ? '#0d0e10' : '#777b84', fontSize: 12, fontWeight: 800 }}>Name Selection</Text>
          </Pressable>
        </Row>
      </Col>
    </Box>
  );
}
