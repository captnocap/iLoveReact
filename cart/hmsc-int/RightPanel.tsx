// RightPanel — the top-right quadrant. The PAINT panel (FacePainter) is the ONLY
// surface now (req_1959: the user removed the OBJ / NOTE / CHAT nav rail —
// "i only use the one paint tab"). This is just the face painter, full width.

import { Box } from '@reactjit/primitives';
import { renderTick } from './editors/build/editLatency';
import { FacePainter, type SkinDraft } from './editors/build/FacePainter';
import type { Armed, PieceLook } from './buildArmed';
import type { BuildEditEvent, PlacedBuildPiece } from '@game';

// Tab ids retained for the session/placement layers (useMapSession / usePlacements
// persist + auto-switch a `tab`), even though PAINT is the only rendered surface.
export type TabId = 'paint' | 'objects' | 'notes' | 'chat';

export function RightPanel(props: {
  // PAINT (req_0702): the build pieces + the iso pane's mirrored selection + the
  // cart's batched commit — what the face painter edits.
  paintPieces: readonly PlacedBuildPiece[];
  paintSelectedIds: ReadonlySet<string>;
  onPaintCommit: (items: ReadonlyArray<{ event: BuildEditEvent; label: string }>) => void;
  // req_1937/1943: the HELD item before placement + its staged skin draft.
  armed?: Armed;
  armedDraft?: SkinDraft | null;
  onArmedDraftChange?: (draft: SkinDraft) => void;
  // req_2077: copy the selected piece's look → arm the skin brush (stamp on click).
  onArmSkin?: (look: PieceLook | null) => void;
  // req_0749: the "paint a texture…" door → the /workbench painter.
  onOpenPainter?: () => void;
}) {
  renderTick('RightPanel'); // req_1968 diag
  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0b1320' }}>
      <FacePainter
        pieces={props.paintPieces}
        selectedIds={props.paintSelectedIds}
        armed={props.armed}
        armedDraft={props.armedDraft}
        onArmedDraftChange={props.onArmedDraftChange}
        commitBatch={props.onPaintCommit}
        onArmSkin={props.onArmSkin}
        onOpenPainter={props.onOpenPainter}
      />
    </Box>
  );
}
