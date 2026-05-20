// SuggestField — TextInput + '[?]' dropdown that filters a list of
// suggestions by substring. Clicking a suggestion fills the field.
//
// Used by RecipesPage to autocomplete useIFTTT trigger/action strings
// against the live IFTTT registry + concrete hint list.

import * as React from 'react';
import { Box, Col, Row, Text, Pressable, TextInput } from '../../../runtime/primitives';
import { palette } from './palette';
import { filterSuggestions } from '../ifttt/suggestions';

export function SuggestField({
  label,
  value,
  placeholder,
  suggestions,
  open,
  onToggleSuggest,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  suggestions: string[];
  open: boolean;
  onToggleSuggest: () => void;
  onChange: (v: string) => void;
}) {
  const filtered = open ? filterSuggestions(value, suggestions) : [];
  return (
    <Col style={{ gap: 0 }}>
      <Row style={{ gap: 1, paddingLeft: 6 }}>
        <Text style={{ color: palette.dim, width: 8 }}>{label}</Text>
        <Box style={{
          flexGrow: 1, borderWidth: 1, borderColor: palette.border,
          paddingLeft: 1, paddingRight: 1,
        }}>
          <TextInput
            value={value}
            placeholder={placeholder}
            onChangeText={onChange}
          />
        </Box>
        <Pressable onPress={onToggleSuggest}>
          <Text style={{
            color: open ? palette.accent : palette.dim,
            fontWeight: 'bold',
          }}>{open ? '[v]' : '[?]'}</Text>
        </Pressable>
      </Row>
      {open && filtered.length > 0 && (
        <Col style={{ paddingLeft: 15, gap: 0 }}>
          {filtered.map(s => (
            <Pressable key={s} onPress={() => { onChange(s); onToggleSuggest(); }}>
              <Text style={{ color: palette.ink }}>· {s}</Text>
            </Pressable>
          ))}
        </Col>
      )}
      {open && filtered.length === 0 && (
        <Text style={{ color: palette.dim, paddingLeft: 15 }}>(no matches)</Text>
      )}
    </Col>
  );
}
