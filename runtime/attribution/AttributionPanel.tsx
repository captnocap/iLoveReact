// runtime/attribution/AttributionPanel.tsx — the ONE attribution editor, shared by the
// model viewer and (later) the Studio so the experience is uniform everywhere an asset
// enters the project. Pure presentation over an Attribution entry: it owns local edit
// state and hands a patch back via onSave; storage lives in ledger.ts.
//
// Parents should mount it with `key={entry.id}` so switching assets re-seeds the fields.
import { useState } from 'react';
import { Box, Col, Row, Text, Pressable, TextInput } from '@reactjit/runtime/primitives';
import { LICENSES, type Attribution, type AttributionStatus } from './ledger';

const T = {
  bg: 'rgba(12,14,20,0.92)',
  field: '#11151d',
  frame: '#2c4a6a',
  text: '#e8edf6',
  dim: '#7d899c',
  accent: '#2a466e',
  accentEdge: '#5a86c0',
};

/** A small ✓/⚠ badge — reusable on its own (e.g. a title-bar indicator). */
export function AttributionStatusBadge({ status }: { status: AttributionStatus }) {
  const ok = status === 'accounted';
  return (
    <Box
      style={{
        paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3, borderRadius: 5,
        backgroundColor: ok ? '#1d3a24' : '#3a2a16', borderWidth: 1, borderColor: ok ? '#3f7d4f' : '#8a6a2c',
      }}
    >
      <Text style={{ color: ok ? '#9fe0ad' : '#e6c074', fontSize: 11, fontWeight: 600 }}>
        {ok ? '✓ attributed' : '⚠ needs attribution'}
      </Text>
    </Box>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <Col style={{ marginBottom: 10 }}>
      <Text style={{ color: T.dim, fontSize: 11, marginBottom: 3 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        style={{
          backgroundColor: T.field, color: T.text, borderWidth: 1, borderColor: T.frame, borderRadius: 5,
          paddingTop: 5, paddingBottom: 5, paddingLeft: 8, paddingRight: 8, fontSize: 12,
        }}
      />
    </Col>
  );
}

export interface AttributionPanelProps {
  entry: Attribution;
  onSave: (patch: Pick<Attribution, 'title' | 'author' | 'source' | 'license'>) => void;
  onExport?: () => void;
  onClose?: () => void;
}

export function AttributionPanel({ entry, onSave, onExport, onClose }: AttributionPanelProps) {
  const [title, setTitle] = useState(entry.title);
  const [author, setAuthor] = useState(entry.author);
  const [source, setSource] = useState(entry.source);
  const [license, setLicense] = useState(entry.license);

  return (
    <Col
      style={{
        position: 'absolute', top: 34, right: 0, width: 320, bottom: 0,
        backgroundColor: T.bg, borderLeftWidth: 1, borderColor: '#1d2330',
        paddingLeft: 16, paddingRight: 16, paddingTop: 14, paddingBottom: 14,
      }}
    >
      <Row style={{ alignItems: 'center', marginBottom: 12 }}>
        <Text style={{ color: T.text, fontSize: 14, fontWeight: 600 }}>Attribution</Text>
        <Box style={{ flexGrow: 1 }} />
        <AttributionStatusBadge status={entry.status} />
      </Row>

      <Field label="Title" value={title} onChange={setTitle} placeholder="model name" />
      <Field label="Author / Creator" value={author} onChange={setAuthor} placeholder="who made it" />
      <Field label="Source" value={source} onChange={setSource} placeholder="URL or origin" />

      <Text style={{ color: T.dim, fontSize: 11, marginBottom: 4 }}>License</Text>
      <Row style={{ flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {LICENSES.map((l) => {
          const on = license === l;
          return (
            <Pressable
              key={l}
              onPress={() => setLicense(l)}
              style={{
                paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 5,
                backgroundColor: on ? T.accent : T.field, borderWidth: 1, borderColor: on ? T.accentEdge : T.frame,
              }}
            >
              <Text style={{ color: on ? '#eaf2ff' : T.dim, fontSize: 11, fontWeight: 600 }}>{l}</Text>
            </Pressable>
          );
        })}
      </Row>
      <Field label="License (custom)" value={license} onChange={setLicense} placeholder="e.g. CC-BY-4.0" />

      {entry.note ? (
        <Col style={{ marginBottom: 10 }}>
          <Text style={{ color: T.dim, fontSize: 11, marginBottom: 3 }}>Detected</Text>
          <Text style={{ color: '#6b7689', fontSize: 11, fontFamily: 'monospace' }}>{entry.note.slice(0, 220)}</Text>
        </Col>
      ) : null}

      <Box style={{ flexGrow: 1 }} />

      <Pressable
        onPress={() => onSave({ title, author, source, license })}
        style={{ height: 34, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1d3a5f', borderWidth: 1, borderColor: '#3a5f8a', marginBottom: 8 }}
      >
        <Text style={{ color: '#e6f0fb', fontSize: 13, fontWeight: 600 }}>Save attribution</Text>
      </Pressable>
      <Row style={{ gap: 8 }}>
        {onExport ? (
          <Pressable
            onPress={onExport}
            style={{ flexGrow: 1, height: 30, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: T.field, borderWidth: 1, borderColor: T.frame }}
          >
            <Text style={{ color: '#cfe0f5', fontSize: 12, fontWeight: 600 }}>Export credits…</Text>
          </Pressable>
        ) : null}
        {onClose ? (
          <Pressable
            onPress={onClose}
            style={{ width: 64, height: 30, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: T.field, borderWidth: 1, borderColor: T.frame }}
          >
            <Text style={{ color: T.dim, fontSize: 12, fontWeight: 600 }}>Close</Text>
          </Pressable>
        ) : null}
      </Row>
    </Col>
  );
}
