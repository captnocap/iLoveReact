// editors/workbench/characters/clothingSource.tsx — the CLOTHING
// WorkbenchSource (CLOTHSPLIT-0606 phase 2, USER RULING req_0040): the
// wardrobe ATTACHMENT context. Thin JSX shell over panel.ts's headless
// clothingSourceCore; the stage is the DRESSED figure (mesh + attachOutfit)
// on the current body, static pose — the panel dresses, the stage shows.

import type { WorkbenchSource } from '../../../shell/Workbench';
import { clothingSourceCore } from './panel';
import type { CharacterStore } from './store';
import { DressedStage } from './DressedStage';

export function clothingSource(store?: CharacterStore): WorkbenchSource<CharacterStore> {
  const core = clothingSourceCore(store);
  return {
    ...core,
    stage: (subject) => (
      <DressedStage
        store={subject}
        animate={false}
        caption="DRESSED FIGURE · OUTFIT"
        camRoute="/clothing"
        idleHint="pick clothes, extras, and the held prop in the panel — the figure wears them live"
      />
    ),
  };
}
