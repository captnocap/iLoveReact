// editors/workbench/story/StoryStage.tsx — the MAIN panel (gutter 4). Per the
// user's restructure (req_0926) the main panel is the AUTHORING surface, not a
// demonstration: when a MISSION is selected it hosts the authoring canvas
// (world-trigger steps, the cast, the dialog script) through the same field
// renderer the side uses, just with the authoring groups; when a QUESTLINE is
// selected it shows the dependency board (the proto scene-graph for the line —
// the full node graph is the deferred follow-up). The side panel (gutter 3) is
// now metadata (last updated, previous mission, …).

import { useState } from 'react';
import { Box, ScrollView, Text } from '@reactjit/primitives';
import { PanelGroups } from '../../../shell/fields';
import { accentFor } from '../../../shell/workbench.cls';
import { StoryBoard } from './StoryBoard';
import { missionStagePanel } from './panel';
import type { StoryStore } from './store';

const MONO = 'monospace';

function Banner(props: { title: string; hint: string }) {
  return (
    <Box style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: accentFor('bg') }}>
      <Text fontSize={13} color={accentFor('textDim')} style={{ fontFamily: MONO, fontWeight: 800 }}>{props.title}</Text>
      <Text fontSize={10} color={accentFor('textFaint')} style={{ fontFamily: MONO, marginTop: 6 }}>{props.hint}</Text>
    </Box>
  );
}

export function StoryStage(props: { store: StoryStore }) {
  const { store } = props;
  const [, force] = useState(0);
  const onEdit = () => force((n) => n + 1);

  const key = store.selectedKey();
  if (key && store.draft(key)) {
    const d = store.draft(key)!;
    return (
      <ScrollView style={{ width: '100%', height: '100%', backgroundColor: accentFor('bg') }}>
        <Box style={{ padding: 12 }}>
          <Text fontSize={13} color={accentFor('text')} style={{ fontFamily: MONO, fontWeight: 800 }}>{d.title || '(untitled mission)'}</Text>
          <Text fontSize={10} color={accentFor('textDim')} style={{ fontFamily: MONO, marginTop: 2, marginBottom: 8 }}>MISSION AUTHORING — the spine, the cast, the script</Text>
          <PanelGroups spec={missionStagePanel(store, key)} onEdit={onEdit} />
        </Box>
      </ScrollView>
    );
  }

  const lineId = store.selectedLineId();
  if (lineId && store.line(lineId)) return <StoryBoard store={store} />;

  return <Banner title="STORYLINE" hint="pick or create a questline to begin — every quest lives in a line" />;
}
