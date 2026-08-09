# Editor saved camera views (Store View / Recall View)

Active surface: `cart/editor/` world document + its iso build viewport.
Last verified: 2026-08-09. USER ASK req_4168.

## In one sentence

A saved view pins the whole iso authoring context — orbit centre, facing, tilt,
zoom, AND the active storey — under a name you can jump back to from the VIEWS
card, the `H` key, or a gold pin on the linked city map.

## Why it exists

The user's ask (req_4168), immediately after the draw-distance fix that made a
big map visible at all: *"be able to store camera positions to recall since on a
625 chunk map that becomes necessary."*

625 chunks is 25×25 at the 120 m chunk module — **3 km on a side**. At that
scale, returning to the block you were working on by panning is not navigation,
it is a search. The iso camera's own zoom range (`isoStage.ts`: `BASE_DIST 90`,
zoom `0.12`–`10`, so 9 m to 750 m from the target) spans four orders of
magnitude of framing, and none of it is addressable without pins.

The **storey** is part of the pin on purpose. `floorIndex` is a separate
authoring context from the camera (the action bar owns it), and a recall that
restored the camera but not the floor would land you looking at the right block
from the wrong level — which is the exact miss the pin exists to prevent.

## The model surface already had this — same vocabulary, different lifetime

`stage/ModelView.tsx` pins mesh-editor orbit poses (`camMarks`, req_3067/3074)
with Store View / Recall View / a VIEWS list in the focus panel. The world
surface reuses that vocabulary verbatim (V25: pinned conventions beat divergence
— one editor, one bookmark language), including the `H` recall key and the
"number past the highest `View N`" naming rule.

The difference is **lifetime**. A model bookmark lives in the tool hot twig and
a cold start drops it. A world view rides `world.json`, because a map you come
back to next week is exactly the map that needed the pin.

## Mechanism (host fn vs JS, file:line)

- `cart/editor/world/worldViews.ts` — the pure module: the `WorldView` shape
  (`id`, `name`, `centerX/centerZ`, `yaw`, `pitch`, `zoom`, `floor`),
  `WORLD_VIEW_LIMITS` (64 per map, 48-char names, bounded coordinates),
  `validWorldView` + `validateUniqueViewIds` (the persistence gate),
  `worldViewPoseFrom` / `isoPoseFrom` (capture and apply), `storeWorldView` /
  `removeWorldView` / `renameWorldView`, and `activeWorldView` (what a bare
  Recall targets). No React, no I/O.
- `cart/editor/world/isoStage.ts` — `IsoStage.restore(pose)` applies a whole
  pose at once, **clamping** pitch/zoom/level on the way in: a pose read from
  disk has outlived the limits it was written under and must land somewhere
  legal.
- `cart/editor/world/WorldViewport.tsx` — `liveIsoPose()` exports the pose the
  viewport is showing right now by reading the `editor:isopose:v1` hot twig that
  every camera push already writes (req_2898). That is what Store pins, so no
  second channel and no ref is handed upward. The recall effect sits **after**
  the floor effect and keys on a nonce, with `appliedRecallRef` seeded at mount
  so a hot reload never re-fires the last recall.
- `cart/editor/data/worldStore.ts` — `WorldSave.views`, parsed as a bounded
  optional array (a pre-req_4168 `world.json` loads with `[]`, no version bump),
  and threaded through `snapshot` / `scheduleWorldSave` / `flushWorldSave` so
  views ride the ordinary micro-save and both explicit flush boundaries.
- `cart/editor/data/commands.ts` / `keymap.ts` — `world-view-store` (View menu,
  `BookmarkPlus`) and `world-view-recall` (`H`, `Bookmark`), both `scope: 'world'`
  and `undoable: false`. Views are navigation, not an edit: `worldViews` is
  deliberately NOT in `WORLD_UNDO_KEYS`.
- `cart/editor/shell/AppFrame.tsx` — Store reads `liveIsoPose()` + `floorIndex`
  and mints `view-<seq>`; Recall sets `activeWorldViewId`, `floorIndex`, and
  bumps `worldViewRecallNonce` — one pure state transition, no side effect
  inside the updater. The live request handed down is derived
  (`activeWorldViewPin` + nonce), so a removed or renamed pin can never leave a
  stale copy queued at the viewport.
- `cart/editor/inspector/Inspector.tsx` — `WorldViewsSection`, the VIEWS card
  under PIECE FOCUS/BUILD: `BookmarkPlus` stores, a row click jumps, the trash
  verb removes, and the active pin carries the primary accent.
- `cart/editor/stage/MiniMap.tsx` — each view draws as a gold world-metre ring
  plus a labelled `Canvas.Node` that recalls on click. On a 3 km map the
  overview is where you actually reach for a pin, so it renders under the cyan
  camera marker (the live view is never hidden by a pin).

## Reach

- **Per map, by design.** A pin on one map means nothing on another, so views
  live in that document's `world.json` and `activeWorldViewId` resets across a
  document switch (`data/persistView.ts`).
- **Auto-named `View N`.** `renameWorldView` exists and is covered, but no UI
  reaches it yet — the VIEWS row has no text field. Naming a pin "Downtown core"
  is the obvious next increment.
- **No numbered hotkey slots.** `H` recalls the ACTIVE pin (last stored or
  clicked); direct access to a specific pin is a panel/minimap click. A
  `Ctrl+1..9` set / `1..9` jump scheme was considered and not built — it would
  be a second vocabulary the model surface does not share.
- **Editor-only.** A view is authoring navigation; it is not a `camera_marker`
  WorldMarker (V24) and never bakes into cinematic shots.

## Tests

`cart/editor/world/worldViews.test.ts` — capture keeps the storey (and prefers
the action bar's floor over the stage's mirror), naming numbers past removals,
the cap refuses without faking an edit, recall falls back from a stale active
id, the applied pose keeps every field, rename trims and refuses empty, and the
persistence gate rejects zero/NaN zoom, fractional or negative storeys, empty
and overlong names, out-of-world centres, and duplicate ids.
