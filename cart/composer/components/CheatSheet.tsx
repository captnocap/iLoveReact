// CheatSheet — docked reference rail for the composer sandbox API.
//
// Triggered by the "ref" button in TopBar or the '?' key. Renders the
// hand-maintained list in ../api-cheatsheet.ts as a scrollable rail next
// to the editor, so the user can consult examples while typing.
//
// Esc closes the rail. Example rows insert snippets into the editor;
// the small copy button keeps the clipboard fallback available.

import { Box, Col, Row, Text, Pressable, ScrollView } from '@reactjit/runtime/primitives';
import { useIFTTT } from '@reactjit/runtime/hooks/useIFTTT';
import { set as setClipboard } from '@reactjit/runtime/hooks/clipboard';
import { COLORS } from '../theme';
import { API_CATEGORIES, type ApiEntry, type ApiKind } from '../api-cheatsheet';

interface Props {
  open: boolean;
  onClose: () => void;
  onInsertExample: (snippet: string) => void;
}

export function CheatSheet({ open, onClose, onInsertExample }: Props) {
  useIFTTT('key:escape', () => { if (open) onClose(); });

  if (!open) return null;

  return (
    <Col style={{
      width: 320,
      minWidth: 280,
      height: '100%',
      backgroundColor: COLORS.panel,
      borderLeftWidth: 1,
      borderLeftColor: COLORS.border,
    }}>
      <Row style={{
        height: 36,
        alignItems: 'center',
        paddingLeft: 12,
        paddingRight: 8,
        gap: 8,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.border,
        backgroundColor: COLORS.panelAlt,
      }}>
        <Text style={{ color: COLORS.inkDim, fontSize: 11, fontWeight: '600', letterSpacing: 1 }}>
          REFERENCE
        </Text>
        <Text style={{ color: COLORS.inkMuted, fontSize: 10 }}>
          click example to insert
        </Text>
        <Box style={{ flexGrow: 1 }} />
        <Pressable
          onPress={onClose}
          style={{
            width: 24,
            height: 24,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 4,
            backgroundColor: COLORS.bgSoft,
          }}
        >
          <Text style={{ color: COLORS.ink, fontSize: 13 }}>×</Text>
        </Pressable>
      </Row>

      <ScrollView style={{ flexGrow: 1, flexBasis: 0 }}>
        <Col style={{ padding: 10, gap: 14 }}>
          {API_CATEGORIES.map((cat) => (
            <Col key={cat.name} style={{ gap: 6 }}>
              <Text style={{
                color: COLORS.inkDim,
                fontSize: 10,
                letterSpacing: 1.3,
                fontWeight: '600',
              }}>
                {cat.name.toUpperCase()}
              </Text>
              <Col style={{ gap: 6 }}>
                {cat.entries.map((entry) => (
                  <EntryCard
                    key={`${cat.name}:${entry.name}`}
                    entry={entry}
                    onInsertExample={onInsertExample}
                  />
                ))}
              </Col>
            </Col>
          ))}
        </Col>
      </ScrollView>
    </Col>
  );
}

function EntryCard({
  entry,
  onInsertExample,
}: {
  entry: ApiEntry;
  onInsertExample: (snippet: string) => void;
}) {
  const accent = entryAccent(entry.kind);
  return (
    <Col style={{
      backgroundColor: COLORS.panelAlt,
      borderRadius: 5,
      borderLeftWidth: 3,
      borderLeftColor: accent,
      paddingLeft: 12,
      paddingRight: 12,
      paddingTop: 8,
      paddingBottom: 8,
      gap: 4,
    }}>
      <Row style={{ alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <Text style={{ color: accent, fontFamily: 'monospace', fontSize: 13, fontWeight: '600' }}>
          {entry.name}
        </Text>
        <Text style={{ color: COLORS.inkDim, fontFamily: 'monospace', fontSize: 11 }}>
          {entry.signature}
        </Text>
      </Row>
      <Text style={{ color: COLORS.ink, fontSize: 11, lineHeight: 16 }}>
        {entry.description}
      </Text>
      <Row style={{ gap: 5, alignItems: 'stretch', marginTop: 2 }}>
        <Pressable
          onPress={() => { onInsertExample(entry.example); }}
          style={{
            flexGrow: 1,
            flexBasis: 0,
            backgroundColor: COLORS.bg,
            borderRadius: 3,
            paddingLeft: 8,
            paddingRight: 8,
            paddingTop: 5,
            paddingBottom: 5,
          }}
        >
          <Text style={{
            color: COLORS.tokString,
            fontFamily: 'monospace',
            fontSize: 11,
            lineHeight: 15,
          }}>
            {entry.example}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => { setClipboard(entry.example); }}
          style={{
            width: 34,
            backgroundColor: COLORS.bgSoft,
            borderRadius: 3,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: COLORS.inkDim, fontSize: 10 }}>
            copy
          </Text>
        </Pressable>
      </Row>
    </Col>
  );
}

function entryAccent(kind: ApiKind): string {
  switch (kind) {
    case 'fn':    return COLORS.tokBuiltin;
    case 'const': return COLORS.tokSynth;
    case 'note':  return COLORS.tokKeyword;
  }
}
