// LibraryPanel — browse cart/app/recipes/ ALL_RECIPES.
//
// Each recipe is a useIFTTT composition authored upstream. Toggling
// an entry adds (or removes) its bindings from the live rules list
// that the TUI's RecipesPage and App.tsx's <RuleBinding> children
// share via state.ts.
//
// Recipes whose scaffold uses function actions or is still a sentinel
// (// TODO: author scaffold) appear as non-toggleable for now —
// flagged so authors know what's pending.
//
// Row UI is COMPACT by default (one row per recipe). Click ▶ to
// expand instructions + bindings inline. 32 entries × ~5 rows each
// blew through both the visible scroll viewport AND the layout pass
// on every panel switch.

import * as React from 'react';
import { Box, Col, Row, Text, Pressable, ScrollView } from '../../../runtime/primitives';
import { palette } from '../ui/palette';
import { useSettings, setSettings } from '../state';
import {
  getLibrary,
  rulesForLibraryEntry,
  libraryRuleSlug,
  type LibraryEntry,
} from '../recipes/library';

export function LibraryPanel() {
  const { rules } = useSettings();
  const library = React.useMemo(() => getLibrary(), []);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const enabledSlugs = React.useMemo(() => {
    const s = new Set<string>();
    for (const r of rules) {
      const slug = libraryRuleSlug(r);
      if (slug) s.add(slug);
    }
    return s;
  }, [rules]);

  const toggleExpand = (slug: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });
  };

  const toggleEnabled = (entry: LibraryEntry) => {
    if (entry.unsupported) return;
    if (enabledSlugs.has(entry.slug)) {
      setSettings({
        rules: rules.filter(r => libraryRuleSlug(r) !== entry.slug),
      });
    } else {
      setSettings({
        rules: [...rules, ...rulesForLibraryEntry(entry)],
      });
    }
  };

  const supported = library.filter(e => !e.unsupported).length;

  return (
    <Col style={{ gap: 0, flexGrow: 1 }}>
      <Text style={{ color: palette.accent, fontWeight: 'bold' }}>library</Text>
      <Text style={{ color: palette.dim }}>
        {library.length} recipes · {supported} toggleable · click ▶ to expand
      </Text>
      <Text> </Text>
      <ScrollView style={{ flexGrow: 1 }}>
        {library.map((entry) => {
          const on = enabledSlugs.has(entry.slug);
          const isOpen = expanded.has(entry.slug);
          return (
            <Col key={entry.slug} style={{ gap: 0 }}>
              <Row style={{ gap: 1 }}>
                <Pressable onPress={() => toggleExpand(entry.slug)}>
                  <Text style={{ color: palette.dim, width: 1 }}>{isOpen ? '▼' : '▶'}</Text>
                </Pressable>
                <Pressable onPress={() => toggleEnabled(entry)}>
                  <Text style={{
                    color: entry.unsupported ? palette.dim : (on ? palette.good : palette.dim),
                    fontWeight: 'bold',
                  }}>
                    {entry.unsupported ? '[--]' : (on ? '[on]' : '[off]')}
                  </Text>
                </Pressable>
                <Text style={{ color: palette.ink, fontWeight: 'bold' }}>{entry.title}</Text>
                <Box style={{ flexGrow: 1 }} />
                <Text style={{ color: palette.dim }}>
                  {entry.bindings.length > 0 ? `${entry.bindings.length} bind` : 'todo'}
                </Text>
              </Row>
              {isOpen && (
                <Box style={{ paddingLeft: 5, paddingBottom: 1 }}>
                  <Text style={{ color: palette.dim }}>{entry.instructions}</Text>
                  {entry.bindings.map((b, i) => (
                    <Row key={i} style={{ gap: 1 }}>
                      <Text style={{ color: palette.info }}>{b.trigger}</Text>
                      <Text style={{ color: palette.dim }}>→</Text>
                      <Text style={{ color: palette.good }}>{b.action}</Text>
                    </Row>
                  ))}
                  <Text style={{ color: palette.dim }}>{entry.slug}</Text>
                </Box>
              )}
            </Col>
          );
        })}
      </ScrollView>
    </Col>
  );
}
