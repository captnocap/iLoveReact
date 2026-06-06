// editors/workbench/characters/animationSource.tsx — the ANIMATION
// WorkbenchSource (CLOTHSPLIT-0606 phase 2, USER RULING req_0040): the
// rig/posing context — where animation commands live. Thin JSX shell over
// panel.ts's headless animationSourceCore; the stage is the dressed,
// ANIMATING figure (all three clocks tick here and only here — the mesh
// context never animates).

import type { WorkbenchSource } from '../../../shell/Workbench';
import { animationSourceCore } from './panel';
import type { CharacterStore } from './store';
import { DressedStage } from './DressedStage';

export function animationSource(store?: CharacterStore): WorkbenchSource<CharacterStore> {
  const core = animationSourceCore(store);
  return {
    ...core,
    stage: (subject) => (
      <DressedStage
        store={subject}
        animate={true}
        caption="ANIMATING FIGURE"
        camRoute="/animation"
        idleHint="pose the rig, toggle anim, or play a script — the figure animates here"
      />
    ),
  };
}
