// editors/workbench/characters/PaintLens.tsx — the character source's PAINT
// lens (WBCHAR-0606 → AGNOSTICPAINT-0606 §2): the DOORWAY, not a surface.
// The lens drives THE one agnostic bench (editors/workbench/paint/) to this
// character's selected part and renders the same PaintBench every other
// subject paints on — zero forked mounts. Leaving the lens and opening the
// PAINT source shows the same target, same unsaved strokes, same brush
// ("any thing at all is all just the same thing at this level").
//
// Figure saves route through the bench's MATERIALIZE wiring (the characters
// channel + the open draft adopts — K3 lives in paint/live.ts charAdopt).

import { useEffect } from 'react';
import { useRerender } from '@reactjit/runtime/hooks';
import { Col, Text } from '@reactjit/runtime/primitives';
import { GAME_CHROME } from '../../../game/chrome';
import type { PaintTargetId } from '../../../game/figure/shapes';
import { modelWorkId } from '../../cutout/models';
import { paintBenchStore } from '../paint/live';
import { PaintBench } from '../paint/PaintBench';
import type { CharacterStore } from './store';

const T = GAME_CHROME.tokens.color;

export function CharacterPaintLens(props: { store: CharacterStore }) {
  const s = props.store;
  const rerender = useRerender();
  useEffect(() => s.subscribe(rerender), [s]);

  const draftId = s.draftId;
  const part = s.view.selPart as PaintTargetId;
  const bench = paintBenchStore();

  // preload the ONE bench with this subject (an event, not a render effect:
  // open() flushes the previous target's slot + writes the open-intent slot)
  useEffect(() => {
    if (!draftId) return;
    const want = modelWorkId({ family: 'figure', docId: draftId, part });
    if (bench.work.docId !== want) {
      bench.open({ kind: 'figure-part', docId: draftId, part });
    }
  }, [draftId, part, bench]);

  // the route's own guard (Route.tsx:410), made gentler by the autosave
  if (!draftId) {
    return (
      <Col style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        <Text fontSize={12} color={T.dim}>PAINT works on the SAVED character</Text>
        <Text fontSize={10} color={T.dim}>make any edit (autosave mints a roster id) or press Save in the panel, then come back</Text>
      </Col>
    );
  }

  return <PaintBench store={bench} />;
}
