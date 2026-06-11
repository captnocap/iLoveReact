// painterBehavior.ts — which input behavior the ONE painter overlay runs
// (PAINTER-0610, req_0593). Pure: tool × target → behavior, no canvas state.
//
// The model: one active tool (Select/Paint/Erase), one active target (the
// existing Layer union), many visible channels. The overlay is a single
// screen-space Pressable; this resolver decides what its events mean — or that
// no overlay should mount at all ('none': Object target + Select keeps the
// native Canvas.Node click/drag path, which a covering overlay would shadow).

import type { Layer, Tool } from './PaintCanvas';

export type PainterBehavior =
  | 'stroke'  // brush lifecycle: down begins, move samples (interpolated), up ends
  | 'click'   // discrete clicks: road point laying / road erase
  | 'select'  // universal selection: object → road → cell, most specific wins
  | 'none';   // no overlay — native Canvas.Node interaction owns the pointer

export function resolvePainterBehavior(args: {
  tool: Tool;
  target: Layer;
  /** an object is armed for stamping (place.active) */
  placeArmed: boolean;
}): PainterBehavior {
  const { tool, target, placeArmed } = args;
  if (tool === 'pointer') {
    // Select is universal — except on the Object target, where the placements
    // are live Canvas.Nodes (native click/drag writes canvas_gx engine-side);
    // an overlay would steal their pointer, so none mounts.
    return target === 'place' ? 'none' : 'select';
  }
  if (target === 'road') return 'click'; // paint lays centerline points, erase deletes the stroke under the cursor
  if (target === 'place') {
    if (tool === 'eraser') return 'stroke'; // brush-erase placements under the footprint
    return placeArmed ? 'stroke' : 'none';  // stamp the armed object; nothing armed → native nodes
  }
  return 'stroke'; // tile / terrain / zone brushes (paint + erase)
}

/** Whether this tool does anything on this target — drives ToolBtn dimming. */
export function painterToolUsable(tool: Tool, target: Layer, placeArmed: boolean): boolean {
  if (tool === 'pointer') return true;          // select everywhere (native on object)
  if (tool === 'eraser') return true;           // erase everywhere (PAINTER-0610 ruling)
  if (target === 'place') return placeArmed;    // paint needs an armed object
  return true;
}
