// editors/model/studiokit/chrome/zlayers.ts — the Studio viewport's z-index
// TOKEN SCALE (req_1427, plan §4.1).
//
// Before this, the whole viewport had EXACTLY ONE zIndex in ~1,000 lines of JSX,
// so its ~13 absolute overlays stacked by accident of mount order and collided
// (the paint-diag readout covered the compass by brute force; undo/redo landed on
// the tier-1 info strip). Stacking is now a fixed, named scale: every overlay
// declares which tier it lives in, so "is this on top of that?" has one answer
// and adding an overlay never silently lands it under (or over) another.
//
// One layer per CONCERN, low → high:
//   scene     the 3D viewport itself (the <Scene3D>)
//   overlay   projected gizmos + on-screen readouts (size / paint / toasts)
//   chrome    the docked toolbars, camera dock, status — the persistent UI frame
//   floating  live drag readouts that ride the gizmo and must clear the chrome
//   popup     the small in-context popups (loop-cut / bevel / concave-fix)
//   modal     full dialogs + their scrim — always on top of everything
export const Z = {
  scene: 0,
  overlay: 10,
  chrome: 20,
  floating: 30,
  popup: 40,
  modal: 50,
} as const;

export type ZLayer = keyof typeof Z;
