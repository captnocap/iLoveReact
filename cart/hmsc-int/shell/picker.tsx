// shell/picker.tsx — THE chooser (REQ req_0184, the user's verdict on the
// chip walls: "the side menu is an actual joke"). One compact control per
// row; clicking it opens ONE chooser — searchable, grouped, counted — shared
// by every consumer through the `pick` field type (fields.tsx). Nothing is
// ever inlined as a full-roster chip wall again.
//
// Shell stays generic (the LabsRoute rule): options arrive as DATA
// ({ id, label, group? }); the material registry, a piece list, a catalog —
// all the same chooser. COORDINATION (via supervisor): this is intended as
// THE material-picking component — the materials source consumes the same
// `pick` field/chooser; exactly one implementation in the app.

import { useState } from 'react';
import { Box, Pressable, ScrollView, Text, TextInput } from '@reactjit/primitives';
import { C, accentFor } from './workbench.cls';

export type PickOption = { id: string; label: string; group?: string };

const OTHER_GROUP = 'other';

/** insertion-ordered groups; ungrouped options pool under 'other' (last) */
function groupOptions(options: PickOption[]): Array<{ group: string; options: PickOption[] }> {
  const byGroup = new Map<string, PickOption[]>();
  for (const option of options) {
    const key = option.group ?? OTHER_GROUP;
    const list = byGroup.get(key);
    if (list) list.push(option);
    else byGroup.set(key, [option]);
  }
  const groups = [...byGroup.entries()].map(([group, opts]) => ({ group, options: opts }));
  const other = groups.findIndex((g) => g.group === OTHER_GROUP);
  if (other >= 0) groups.push(groups.splice(other, 1)[0]);
  return groups;
}

export function PickerChooser(props: {
  options: PickOption[];
  current: string | null;
  /** the null-pick row's label ('bare', 'building', …); absent = no clear row */
  clearLabel?: string;
  onPick(id: string | null): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = q
    ? props.options.filter((o) => o.label.toLowerCase().includes(q) || o.id.toLowerCase().includes(q))
    : props.options;
  const groups = groupOptions(shown);

  return (
    <Box style={{ width: '100%', maxWidth: '100%', minWidth: 0, flexDirection: 'column', gap: 4, borderWidth: 1, borderColor: accentFor('borderFocus'), borderRadius: 6, backgroundColor: accentFor('bgElevated'), padding: 6, overflow: 'hidden' }}>
      <Box style={{ width: '100%', minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="search…"
          style={{ flexGrow: 1, minWidth: 0, paddingLeft: 8, paddingTop: 4, paddingBottom: 4, borderWidth: 1, borderColor: accentFor('controlBorder'), borderRadius: 4, backgroundColor: accentFor('controlBg'), color: accentFor('text'), fontSize: 11 }}
        />
        <Pressable onPress={props.onClose} style={{ paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2 }}>
          <Text fontSize={11} color={accentFor('textDim')} style={{ fontWeight: 800 }}>✕</Text>
        </Pressable>
      </Box>
      <ScrollView showScrollbar style={{ width: '100%', maxHeight: 220, minHeight: 0 }}>
        <Box style={{ width: '100%', minWidth: 0, flexDirection: 'column', gap: 5, paddingBottom: 4 }}>
          {props.clearLabel ? (
            <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3, rowGap: 3, maxWidth: '100%' }}>
              <Pressable
                onPress={() => props.onPick(null)}
                style={{ maxWidth: '100%', paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3, borderRadius: 3, borderWidth: 1, borderColor: accentFor('controlBorder'), backgroundColor: accentFor('controlBg') }}
              >
                <Text fontSize={9} color={accentFor('textDim')} style={{ fontFamily: 'monospace', fontWeight: 700 }} numberOfLines={1}>{`(${props.clearLabel})`}</Text>
              </Pressable>
            </Box>
          ) : null}
          {groups.map(({ group, options }) => (
            <Box key={group} style={{ width: '100%', minWidth: 0, flexDirection: 'column', gap: 2 }}>
              <Text fontSize={9} color={accentFor('textFaint')} style={{ fontFamily: 'monospace', fontWeight: 800, letterSpacing: 1 }}>
                {`${group.toUpperCase()} · ${options.length}`}
              </Text>
              <Box style={{ width: '100%', minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', gap: 3, rowGap: 3 }}>
                {options.map((o) => {
                  const on = o.id === props.current;
                  return (
                    <Pressable
                      key={o.id}
                      onPress={() => props.onPick(o.id)}
                      style={{
                        maxWidth: '100%',
                        paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3,
                        borderRadius: 3, borderWidth: 1,
                        borderColor: on ? accentFor('primary') : accentFor('controlBorder'),
                        backgroundColor: on ? accentFor('segActiveBg') : accentFor('controlBg'),
                      }}
                    >
                      <Text fontSize={9} color={on ? accentFor('segActiveText') : accentFor('textDim')} style={{ fontFamily: 'monospace', fontWeight: 700 }} numberOfLines={1}>
                        {o.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </Box>
            </Box>
          ))}
          {groups.length === 0 ? (
            <Text fontSize={10} color={accentFor('textFaint')} style={{ fontFamily: 'monospace' }}>no matches</Text>
          ) : null}
        </Box>
      </ScrollView>
    </Box>
  );
}
