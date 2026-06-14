// editors/workbench/story/StoryBoard.tsx — the STORYLINE BOARD stage: the
// conditional state machine, laid out. Each QUESTLINE is a horizontal band; in
// it, quests sit in COLUMNS by dependency depth (a quest is one column right of
// its deepest prerequisite), so reading left→right is reading the unlock order.
// Edges are carried as flag chips on each card (← gates that open it, → gates
// it opens) — free-form SVG edges are the declared follow-up; the topological
// columns already make the machine legible and every card is clickable.
//
// LAW 1 (the workbench contract): the stage receives values and SELECTS; it
// never edits. Clicking a card selects it; the panel (gutter 3) does the edits.

import { Box, Pressable, ScrollView, Text } from '@reactjit/primitives';
import { accentFor } from '../../../shell/workbench.cls';
import type { StoryStore } from './store';
import type { QuestNode } from './model';

const MONO = 'monospace';

function bindingTone(binding: QuestNode['binding']): string {
  if (binding === 'person') return accentFor('warning');
  if (binding === 'position') return accentFor('info');
  return accentFor('textDim'); // job
}

function Chip(props: { text: string; color: string; faint?: boolean }) {
  return (
    <Box style={{ paddingLeft: 5, paddingRight: 5, paddingTop: 1, paddingBottom: 1, borderRadius: 3, borderWidth: 1, borderColor: props.color, marginRight: 4, marginTop: 2 }}>
      <Text fontSize={9} color={props.faint ? accentFor('textFaint') : props.color} style={{ fontFamily: MONO }}>{props.text}</Text>
    </Box>
  );
}

function QuestCard(props: { node: QuestNode; selected: boolean; onPick: () => void }) {
  const { node, selected } = props;
  return (
    <Pressable onPress={props.onPick}>
      <Box style={{
        width: 188, marginBottom: 10, padding: 8, borderRadius: 6,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? accentFor('accent') : accentFor('controlBorder'),
        backgroundColor: selected ? accentFor('surfaceHover') : accentFor('surface'),
      }}>
        <Text fontSize={12} color={accentFor('text')} style={{ fontFamily: MONO, fontWeight: 800 }}>{node.title}</Text>
        <Box style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 3 }}>
          <Chip text={node.verb} color={accentFor('accent')} />
          <Chip text={node.binding === 'job' ? 'job' : `${node.binding}:${node.bindingId || '?'}`} color={bindingTone(node.binding)} />
        </Box>
        {node.requiresFlags.length > 0 && (
          <Box style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }}>
            {node.requiresFlags.map((f) => <Chip key={`in-${f}`} text={`← ${f}`} color={accentFor('warning')} />)}
          </Box>
        )}
        {node.providesFlags.length > 0 && (
          <Box style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 }}>
            {node.providesFlags.map((f) => <Chip key={`out-${f}`} text={`→ ${f}`} color={accentFor('success')} />)}
          </Box>
        )}
        <Text fontSize={9} color={accentFor('textFaint')} style={{ fontFamily: MONO, marginTop: 4 }}>{node.client}</Text>
      </Box>
    </Pressable>
  );
}

export function StoryBoard(props: { store: StoryStore }) {
  const { store } = props;
  const g = store.graph();
  const selected = store.selectedKey();

  // group nodes by questline, then by depth column
  const lines = new Map<number, QuestNode[]>();
  for (const n of g.nodes) {
    const list = lines.get(n.questline) ?? [];
    list.push(n);
    lines.set(n.questline, list);
  }
  const questlineIds = [...lines.keys()].sort((a, b) => a - b);

  return (
    <ScrollView style={{ width: '100%', height: '100%', backgroundColor: accentFor('bg') }}>
      <Box style={{ padding: 12 }}>
        <Text fontSize={13} color={accentFor('text')} style={{ fontFamily: MONO, fontWeight: 800 }}>STORYLINE — conditional state machine</Text>
        <Text fontSize={10} color={accentFor('textDim')} style={{ fontFamily: MONO, marginTop: 2, marginBottom: 8 }}>
          {`${g.nodes.length} quests · ${g.edges.length} gates · ${g.external.length} external`}
        </Text>

        {questlineIds.map((qid) => {
          const nodes = lines.get(qid)!;
          const maxDepth = nodes.reduce((m, n) => Math.max(m, n.depth), 0);
          const columns = Array.from({ length: maxDepth + 1 }, (_, depth) =>
            nodes.filter((n) => n.depth === depth).sort((a, b) => a.lane - b.lane));
          return (
            <Box key={`ql-${qid}`} style={{ marginBottom: 16 }}>
              <Text fontSize={11} color={accentFor('info')} style={{ fontFamily: MONO, fontWeight: 800, marginBottom: 6 }}>{`QUESTLINE ${qid + 1}`}</Text>
              <Box style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                {columns.map((col, depth) => (
                  <Box key={`col-${qid}-${depth}`} style={{ marginRight: 18 }}>
                    {col.map((n) => (
                      <QuestCard key={n.key} node={n} selected={n.key === selected} onPick={() => store.select(n.key)} />
                    ))}
                  </Box>
                ))}
              </Box>
            </Box>
          );
        })}

        {g.external.length > 0 && (
          <Box style={{ marginTop: 8, padding: 8, borderRadius: 6, borderWidth: 1, borderColor: accentFor('warning') }}>
            <Text fontSize={10} color={accentFor('warning')} style={{ fontFamily: MONO, fontWeight: 800 }}>EXTERNAL GATES (opened by arcs / other systems)</Text>
            {g.external.map((x, i) => (
              <Text key={`ext-${i}`} fontSize={10} color={accentFor('textDim')} style={{ fontFamily: MONO, marginTop: 2 }}>
                {`${x.flag}  →  ${g.nodes.find((n) => n.key === x.to)?.title ?? x.to}`}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    </ScrollView>
  );
}
