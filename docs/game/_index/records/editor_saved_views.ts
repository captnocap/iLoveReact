import type { DocIndex } from '../types';

export const editor_saved_views: DocIndex = {
  name: 'editor_saved_views',
  file: 'editor_saved_views.md',
  cart: 'cart/editor/world/worldViews.ts',
  purpose: ['building', 'camera', 'ui'],
  summary:
    'Saved camera views (req_4168): a pin captures the WHOLE iso authoring context — orbit centre, facing, tilt, zoom, and the active storey — and Recall restores all of it. Asked for at 625 chunks (25x25 at the 120m module = 3km a side), where returning to a block by panning is a search, not navigation. Same Store View / Recall View / VIEWS-list vocabulary as the model surface bookmarks (req_3067/3074) per V25, including the H key; the difference is lifetime — model pins live in a hot twig, world views ride world.json. Reachable from the VIEWS card, H, and gold pins on the linked city map.',
  interfaces: [
    {
      name: 'worldViews.ts (the pure view model)',
      purpose: ['building', 'camera'],
      kind: 'utility',
      sourceFile: 'cart/editor/world/worldViews.ts',
      description:
        'WorldView = { id, name, centerX, centerZ, yaw, pitch, zoom, floor }. WORLD_VIEW_LIMITS bounds the list (64/map), names (48 chars) and coordinates. validWorldView + validateUniqueViewIds are the world.json gate. worldViewPoseFrom captures from an IsoPose plus the ACTION BAR floor (floorIndex is the authority, not the stage mirror); isoPoseFrom applies back. storeWorldView numbers past the highest "View N" so a removed pin never reissues its name, and refuses at the cap by returning the SAME list reference so it cannot masquerade as an edit. activeWorldView resolves what a bare Recall targets, falling back to the newest pin.',
      dependsOn: ['cart/editor/world/isoStage.ts IsoPose'],
      consumers: ['cart/editor/data/worldStore.ts', 'cart/editor/shell/AppFrame.tsx', 'cart/editor/world/WorldViewport.tsx', 'cart/editor/inspector/Inspector.tsx', 'cart/editor/stage/MiniMap.tsx'],
      status: 'live',
    },
    {
      name: 'liveIsoPose() + IsoStage.restore()',
      purpose: ['camera', 'building'],
      kind: 'utility',
      sourceFile: 'cart/editor/world/WorldViewport.tsx',
      description:
        'Store reads the pose the viewport is showing through liveIsoPose(), which returns the editor:isopose:v1 hot twig every camera push already writes (req_2898) — so no second channel and no ref is handed up to AppFrame; null when the mirror is absent or partial. Recall lands through IsoStage.restore(), which clamps pitch/zoom/level because a pose read from disk has outlived the limits it was written under. The viewport recall effect sits AFTER the floor effect and keys on a nonce, with appliedRecallRef seeded at mount so a hot reload cannot re-fire the last recall and yank the camera off wherever you had panned to.',
      dependsOn: ['framework/state/hotstate.zig', 'cart/editor/world/isoStage.ts'],
      consumers: ['cart/editor/shell/AppFrame.tsx'],
      status: 'live',
    },
    {
      name: 'WorldSave.views (world.json persistence)',
      purpose: ['building', 'ui'],
      kind: 'utility',
      sourceFile: 'cart/editor/data/worldStore.ts',
      description:
        'Views persist per map document as a bounded optional array — a pre-req_4168 world.json parses with views: [] and needs no version bump, matching how facades/prefabs/worldFlora joined. Threaded through snapshot / scheduleWorldSave / flushWorldSave so pins ride the ordinary debounced micro-save and both explicit flush boundaries (Save, and the document switch). activeWorldViewId resets across a document switch in data/persistView.ts, because view ids are per-map.',
      dependsOn: ['cart/editor/world/worldViews.ts validWorldView'],
      consumers: ['cart/editor/data/persistView.ts', 'cart/editor/shell/AppFrame.tsx'],
      status: 'live',
    },
    {
      name: 'world-view-store / world-view-recall (View menu, H)',
      purpose: ['ui', 'camera'],
      kind: 'utility',
      sourceFile: 'cart/editor/data/commands.ts',
      description:
        'Both scope: world, undoable: false — a pin is navigation, not an edit, so worldViews is deliberately absent from WORLD_UNDO_KEYS. H recalls the ACTIVE pin, matching the model surface Recall View key exactly. AppFrame Recall is one pure state transition (activeWorldViewId + floorIndex + worldViewRecallNonce) with no side effect inside the setState updater; the request handed to the viewport is DERIVED from the live list, so a removed or renamed pin cannot leave a stale copy queued.',
      dependsOn: ['cart/editor/data/keymap.ts WORLD_KEYS'],
      consumers: ['cart/editor/shell/AppFrame.tsx', 'cart/editor/inspector/Inspector.tsx'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'a saved view carries the whole authoring context, not just a position',
      purpose: ['camera', 'building'],
      description:
        'The active storey is a separate authoring context from the camera (the action bar owns floorIndex), so a recall that restored the camera alone would land you on the right block at the wrong level — the exact miss the pin exists to prevent. Any future "jump somewhere" affordance carries every context the jump invalidates.',
      examples: ['editor_saved_views'],
      status: 'recurring',
    },
    {
      name: 'a request prop needs a nonce AND a mount-seeded applied marker',
      purpose: ['ui'],
      description:
        'Recalling the pin you are already active on must re-fire after a pan, so the request carries a nonce rather than relying on value identity. But an effect keyed on a nonce ALSO fires on remount — a hot reload replayed the last recall until appliedRecallRef was seeded with the nonce present at mount.',
      examples: ['editor_saved_views', 'editor_hot_reload'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'views are auto-named View N with no rename UI',
      purpose: ['ui'],
      description:
        'renameWorldView exists in the pure module and is covered by the suite, but nothing reaches it — the VIEWS row has no text field. On a 3km map "View 7" stops meaning anything quickly; naming a pin after its place is the owed increment.',
      evidence: ['docs/game/editor_saved_views.md "Reach"'],
      severity: 'low',
    },
    {
      name: 'no numbered hotkey slots',
      purpose: ['ui', 'camera'],
      description:
        'H recalls only the ACTIVE pin; reaching a specific one is a panel or minimap click. A Ctrl+1..9 store / 1..9 jump scheme was considered and rejected for now because it would be a second bookmark vocabulary the model surface does not share (V25). If muscle-memory slots are wanted, add them to BOTH surfaces.',
      evidence: ['docs/game/editor_saved_views.md "Reach"'],
      severity: 'low',
    },
  ],
};
