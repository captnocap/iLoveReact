// editor/world/worldTool.ts — the active world-editor tool, derived from the armed command.
//
// The world viewport is MODAL: the armed tool owns the click (req_2550). Before this, the
// viewport was always armed to place a floor, so placement fired on every click regardless of
// which tool was active — turning on Focus didn't stop you dropping pieces. This maps the armed
// command id to the one tool that gets the click, so exactly one behaviour is live at a time.
export type WorldTool = 'select' | 'place' | 'move' | 'focus' | 'paintFace' | 'sticker' | 'drawWall';

export function worldToolFor(activeCommandId: string): WorldTool {
  switch (activeCommandId) {
    case 'place-piece': return 'place';
    // Draw Wall (req_4473): click-click commits one semantic wall span; the
    // native engine builds the geometry. Never places a catalog piece.
    case 'draw-wall': return 'drawWall';
    case 'move-selection': return 'move';
    case 'focus-selection': return 'focus';
    // Paint Faces (req_2879): touching a face applies the active material to that
    // face's slot; a drag sweeps. The click never places or re-selects.
    case 'paint-faces': return 'paintFace';
    // Place Sticker (req_3025): a click stamps the armed sticker on the face hit.
    case 'place-sticker': return 'sticker';
    // 'select-tool' and anything that isn't a viewport click-mode (Color Studio, floor
    // controls, etc.) fall to Select: a click picks the piece under it and never places.
    default: return 'select';
  }
}
