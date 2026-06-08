// editors/workbench/characters/source.tsx — the CHARACTER WorkbenchSource
// (WBCHAR-0606, the pattern-setter). The thin JSX shell over panel.ts's
// headless core: roster/panel/actions/lenses come from characterSourceCore
// (P4-tested without the React half); this file adds the one thing the core
// can't carry — the stage.

import type { WorkbenchSource } from '../../../shell/Workbench';
import { characterSourceCore } from './panel';
import type { CharacterStore, CharacterLens } from './store';
import { CharacterStage } from './Stage';
import { paintBenchStore } from '../paint/live';

export { characterPanel, CHARACTER_LENSES } from './panel';

export function charactersSource(store?: CharacterStore): WorkbenchSource<CharacterStore> {
  const core = characterSourceCore(store, paintBenchStore());
  return {
    ...core,
    // the demonstration surface: 3D grab-sculpt (FIGURE/PART), the unwrap
    // canvas (SCULPT), the shared painter (PAINT — commit 4)
    stage: (subject, lens) => <CharacterStage store={subject} lens={lens as CharacterLens} />,
  };
}
