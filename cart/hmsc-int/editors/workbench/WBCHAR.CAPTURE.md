# WBCHAR-0606 CAPTURE — the character source's capability parity table

The COVERAGE LAW deliverable: every interaction, affordance, hotkey, mode,
persistence behavior, deep-link, and edge affordance in the /characters route,
line-referenced, with its workbench landing. Sources audited end to end:

- `editors/characters/CharactersRoute.tsx` (1142 lines — every line read)
- `editors/characters/preview.tsx` (render components — reused verbatim)
- `editors/characters/controls.tsx` (ChipRow / RegionSliderRow / SwatchRow)
- `editors/characters/{draft,roster,generate,regions,paintKit,grabKit,animPresets}.ts`
- `editors/paint/` (the shared painter the PAINT lens mounts)
- `editors/cutout/CutoutRoute.tsx:460-549` (the model-target machinery the
  PAINT lens reuses: openModelTarget / saveModelPaint / applyBodyPaint)

Landing legend — **R** roster (gutter 2) · **P** panel (gutter 3, group named)
· **S** stage (column 4) · **L** lens (preview bar) · **A** action (hero bar)
· **K** hotkey/route-level · **DEFERRED** needs a ruling, listed never dropped.

The lens set: **FIGURE ⇄ PART ⇄ SCULPT ⇄ PAINT** (figure/part = the 3D views,
grab-sculpt live in both; SCULPT = the unwrap/outline canvas beside the 3D;
PAINT = the shared painter on the selected part, in-page).

## A. Persistence / session / roster

| # | source | capability | landing |
|---|---|---|---|
| A1 | Route.tsx:159-171 | V20 session on the 'characters' channel (editorSessions().open), closed on unmount | **WORKBENCH** — store opens the same channel/session at source init; every commit identical |
| A2 | Route.tsx:185-211 | AUTOSAVE-0605: every draft mutation debounce-commits `authored` (label `autosave · name`), mints id if none, skip-flag on installs | **WORKBENCH** — store-level; all panel/stage edits flow through the same editDraft door |
| A3 | Route.tsx:273-286 | mount restore: last roster entry IS the working draft | **WORKBENCH** — source init + `defaultRow()` = last entry |
| A4 | Route.tsx:567-577 | save to roster (commit + snapshot materialize, label `name: saved`) | **A** save |
| A5 | Route.tsx:579-588 | load a roster entry (install draft, history commit, view figure) | **R** row click → `onPick` |
| A6 | Route.tsx:590-596 | remove from roster (history stays in log) | **A** remove (current entry) |
| A7 | Route.tsx:819-831 | roster chips with active highlight + empty hint | **R** (frame roster; active = selected row) |
| A8 | roster.ts:55-58 | mintCharacterId (time-sortable) | **WORKBENCH** — store (unchanged import) |
| A9 | Route.tsx:241-271 | within-tool undo/redo over the draft (PAINT.createPaintHistory, 50-deep, coalesce; restores autosave) | **WORKBENCH** — store; chips in stage (I7), hotkeys K1 |
| K1 | Route.tsx:269-271 | ctrl+z / ctrl+y / ctrl+shift+z | **K** — useIFTTT in the stage mount (only live while /workbench + character source shown) |

## B. Identity / generation / export

| # | source | capability | landing |
|---|---|---|---|
| B1 | Route.tsx:832-839 | character name TextInput | **P** IDENTITY · text field (new `text` FieldSpec — named fields.tsx addition) |
| B2 | Route.tsx:553-565 | generate whole character (new id, name, figure view, status) | **A** generate |
| B3 | Route.tsx:605-610 | export .body.json → cart/heads/ | **A** export .body |
| B4 | Route.tsx:598-603 | export .hed.json (head document) | **P** FACE · act field (contextual to head, like the route) |
| B5 | Route.tsx:548-551 | generate face only (seeded, applyFaceDoc) | **P** FACE · act field |
| B6 | Route.tsx:1026 | remove face (clears anim + status) | **P** FACE · act field (shown when face present) |
| B7 | Route.tsx:125,812-816 | status line (contextual hints + action feedback) | **S** — thin status strip at the stage bottom (every store status lands there) |

## C. Subject structure: part + view

| # | source | capability | landing |
|---|---|---|---|
| C1 | Route.tsx:845-848 | part tabs (PART_IDS: head/torso/arms/legs) | **P** PART · enum field `part` (drives region group, sculpt canvas, 3D focus — selection, not a property; setter is view-state) |
| C2 | Route.tsx:850 | part ⇄ figure view toggle | **L** FIGURE / PART lenses |
| C3 | Route.tsx:692 | grabbing a part in figure view selects it (two views, one truth) | **S** — grab-down calls the same part setter |
| C4 | twigs (Route.tsx:107-123,147) | view state persisted per route twig keys (selPart, view, editTab, mode, mirror, brush, strength, photo, photoScale, photoY, hitboxes, faceAnim, rigAnim, script, playing, grabGrid) | **WORKBENCH** — same twig KEYS ('/characters' route key) so saved view state carries across |

## D. Sculpt (the SCULPT lens: unwrap canvas + outline lathe)

| # | source | capability | landing |
|---|---|---|---|
| D1 | Route.tsx:384-444,979-1004 | depth-paint canvas: stroke-engine dabs (gap-free, pressure→radius, mirror twins), release readback → grid → re-sculpt, session note | **S** SCULPT lens canvas (same usePaintable + PAINT.createStrokeEngine wires) |
| D2 | Route.tsx:997-1002 | depth overlay Effect (paint texture + relief contours) | **S** SCULPT lens (DEPTH_OVERLAY_WGSL unchanged) |
| D3 | Route.tsx:986-996 | UnwrapContent under the overlay (skin, photo, face layers, painted overlay) | **S** SCULPT lens (component reused) |
| D4 | Route.tsx:1008-1012 | mode chips raise / carve in / flatten | **S** SCULPT tool rail (tool state, not subject property — in-stage by contract) |
| D5 | Route.tsx:1013-1018 | fill · soften · mirror · clear | **S** SCULPT tool rail |
| D6 | Route.tsx:1041-1042 | brush size + strength knobs (shared with grab stamp radius) | **S** SCULPT tool rail (tool state) |
| D7 | Route.tsx:490-536,960-978 | outline lathe (latch-preview rows, smooth-neighbor carve, commit on release) + reset outline | **S** SCULPT lens, outline ⇄ detail tab in the tool rail (Route.tsx:938-944 wording kept: 'sculpt detail') |
| D8 | Route.tsx:477-488 | reset part (grid + outline + regions + texture, one chip, undoable) | **S** SCULPT tool rail + **P** PART · act field (both fire the same store fn) |
| D9 | Route.tsx:1043 | depth amount knob (draft.amount, coalesced) | **P** SCULPT GROUP · num field |
| D10 | paintKit.ts | TUNE dims/knob specs/bytes↔grid/keys | **WORKBENCH** — imported unchanged |

## E. Face / head (head part selected)

| # | source | capability | landing |
|---|---|---|---|
| E1 | Route.tsx:633-635 | image drop → face photo (sets head part) | **S** — useFileDrop in stage mount (active only while shown) |
| E2 | Route.tsx:1047-1048 | photo size / photo up-down knobs | **P** FACE · slider fields (twig view state) |
| E3 | Route.tsx:1046 | skull stretch knob (draft.headScaleY, coalesced) | **P** FACE · num field |
| E4 | Route.tsx:1029-1035 | face animate chips talk/chew/cry/yell (toggle; 150ms clock) | **P** ANIMATION · enum `face anim` (off/talk/chew/cry/yell); clock in stage |
| E5 | Route.tsx:316-329 | script-driven mouth override (scriptMouth beats manual anim) | **WORKBENCH** — store-computed shownDoc identical |
| E6 | Route.tsx:539-546 | applyFaceDoc (face install: coherence law via draftWithFace, head selected, status) | **WORKBENCH** — store fn behind B5/E1/J2 |

## F. Wardrobe / body

| # | source | capability | landing |
|---|---|---|---|
| F1 | Route.tsx:853-857 | body shape chips (sets figure view) | **P** BODY · enum (setter also flips lens to FIGURE — the route's gesture kept) |
| F2 | Route.tsx:858-862 | clothes chips (+ DEFAULT_BOTTOMS coupling) | **P** BODY · enum (coupling in setter) |
| F3 | Route.tsx:863-867 | bottoms chips | **P** BODY · enum |
| F4 | Route.tsx:868-872 | print (clothingSkin) chips | **P** BODY · enum |
| F5 | Route.tsx:873-891 | extras: per-accessory toggle, cap⇄beanie exclusivity | **P** EXTRAS · bool field per accessory (exclusivity in setter) |
| F6 | Route.tsx:1037-1039 | skin swatch row (DRAFT_DEFAULTS.skins) | **P** IDENTITY · color field with palette opts (named fields.tsx addition: color picker swatches) |
| F7 | Route.tsx:892-900 | held prop chips: none + GAME_ITEMS + ◆ sculpted /items entries | **P** PROP · enum (opts from GAME_ITEMS + itemsStream read, ◆ prefix kept) |

## G. Pose / animation

| # | source | capability | landing |
|---|---|---|---|
| G1 | Route.tsx:901-904 | rig pose chips (BODY_POSES) | **P** ANIMATION · enum |
| G2 | Route.tsx:905 | body rig anim toggle (90ms clock) | **P** ANIMATION · bool; clock in stage |
| G3 | Route.tsx:906 | hitboxes toggle | **S** viewport chip (view option, stage-owned like the route) |
| G4 | Route.tsx:909-919 | anim script TextInput (error border on parse fail) + play/stop + reset | **P** ANIMATION · text field + play bool + reset act |
| G5 | Route.tsx:920-936 | anim preset chips (apply + autoplay) | **P** ANIMATION · act field per preset |
| G6 | Route.tsx:299-314 | 50ms script clock, non-looping auto-stop | **S** stage clocks (GAME_ANIMATION.parse/sample identical) |

## H. Region sliders

| # | source | capability | landing |
|---|---|---|---|
| H1 | Route.tsx:1052-1066 + controls.tsx:61-116 | per-part SHAPE_REGIONS sliders, −1..1, drag previews cheap / COMMIT ON RELEASE (re-sculpt once), coalesced undo, session note | **P** REGION(part) · slider fields. fields.tsx slider gains commit-on-release semantics (named addition — live per-move set() would re-sculpt every tick) |
| H2 | Route.tsx:1055 | regions reset chip | **P** REGION · act field |

## I. The 3D stage (FIGURE / PART lenses)

| # | source | capability | landing |
|---|---|---|---|
| I1 | Route.tsx:637-650 | useSculptCamera: orbit/fly, twig-persisted poses, zoom-to-cursor wheel via mesh pick | **S** (same hook, same '/characters' twig keys — saved poses carry) |
| I2 | Route.tsx:652-756 | grab-sculpt: lazy clouds, pick/hover (cell-snap state), drag axis → raise/carve, live-throttle sync, click-no-drag revert, pre-drag undo entry, one-truth texture upload, session note | **S** (grabKit unchanged; input handlers inside the stage per LAW 1) |
| I3 | Route.tsx:761-774 | grab-beats-orbit input layering on one Pressable | **S** |
| I4 | Route.tsx:779-791 | grab marker derived from live mesh params (rides the surface) | **S** (GrabMarker reused) |
| I5 | Route.tsx:1079-1091 | Scene3D: nativeCamera boot frame, LabEnvironment studio ground=false (pole-to-pole orbit), PartMeshes / HeldItemMeshes / GrabGridMeshes / GrabMarker | **S** (components reused verbatim) |
| I6 | Route.tsx:1094-1100 | viewport chips: grid · mirror · fly · undo ⌃Z · redo ⌃Y | **S** viewport chips (workspace controls) |
| I7 | Route.tsx:1101-1111 | fly help text ⇄ orbit zoom knob (reflected: + = closer) | **S** |
| I8 | Route.tsx:1117-1122 | offscreen Paintables (per-part + relief) outside flex flow | **S** (same absolute offscreen mount) |
| I9 | Route.tsx:1123-1138 | CharacterEditorCaptures (head/skin/bare keys, LIMBPAINT bare captures) + GrabGridCapture | **S** (reused verbatim) |
| I10 | Route.tsx:332-382 | regioned grids, face depth fold, content-addressed tex/dyn keys, paint stamps, rig frame | **WORKBENCH** — store/stage compute, helpers imported unchanged |

## J. Deep links / drops / cross-route

| # | source | capability | landing |
|---|---|---|---|
| J1 | Route.tsx:612-625 | .body.json drop → import whole character (new draft, autosaved) | **S** useFileDrop (same handler chain) |
| J2 | Route.tsx:626-631 | .hed.json drop → face install | **S** useFileDrop |
| J3 | Route.tsx:409-414,946,954 | paint texture → /cutout (setPendingModelTarget mailbox + nav; requires saved id) | **FOLDS into the PAINT lens** (K below) — in-page, no route hop. The /cutout mailbox door itself is untouched (old route keeps working) |
| J4 | Route.tsx:176-183 | sculpted /items registry read for prop chips | **P** PROP enum opts (same read) |

## K. The PAINT lens (the parity bar's "+": paint without leaving the page)

| # | source | capability | landing |
|---|---|---|---|
| K1 | Cutout:464-505 openModelTarget | part target resolve: saved model doc, TATTOODRAFT slot resume, overlay reopen, head face-layer underlay, canvas dims/bg | **L** PAINT — same machinery against `{family:'figure', docId, part}`; requires a saved id (autosave mints one — until then the lens shows the route's own guard message Route.tsx:410) |
| K2 | Cutout:836-890 (the painter mount) | THE painter chrome the user knows: CutoutToolRail (with the ColorWheel) · PaintSurface · CutoutInspector (TOOL·FX·SOURCE tabs over the resizable LAYERS panel) · CutoutStatusBar | **L** PAINT mounts the EXACT same modules (ONEPAINTER-0606). **Honest record:** the first cut mounted the generic `PaintEditor` kit (PaintControls' PaintToolRail/LayerStrip/LookPanel) — existing modules but a SECOND painter experience, user-rejected as the ledger's §8 review-blocker. That mount is DELETED; the generic kit's only consumer was this lens (its keep/delete is the paint lane's call — their file, live WIP). Lens-owned chrome is ONE thin save strip (a host verb; cutout's equivalent lives in its TopBar) |
| K2a | Cutout:888,928 EffectModal | custom-WGSL FX modal | **REPORTED CONFLICT** (directive 3): EffectModal is route-LOCAL inside CutoutRoute.tsx — unexported, and that file carries the paint lane's uncommitted WIP, so it cannot be imported or exported without touching their live lane. The Inspector's FX tab works fully (built-in surfaces); the "custom WGSL" button explains and defers to /cutout. Fix when the paint lane's lane is cold: export EffectModal (or extract it to editors/paint) and mount the same module here |
| K2b | Cutout Inspector SOURCE tab | onNewCanvas / onLoadImage (library-document verbs) | **L** PAINT — same component, host-decided verbs (the props ARE host callbacks): in-lens they explain that canvas/image documents live in /cutout, since this lens is bound to the selected part. No chrome fork |
| K3 | Cutout:519-549 saveModelPaint | bake overlay → applyBodyPaint → labeled commit on the characters channel; empty painting CLEARS; draft slot dropped | **L** PAINT save action (figure branch only); store refreshes draft.paint from the committed doc |
| K4 | Cutout:846-852 ModelPreview3D | live 3D beside the painter re-baking per stroke | **RULED → DAY ONE** (user, 2026-06-06): the PAINT lens imports cutout's ModelPreview now — paint-and-see in the workbench immediately |
| K5 | Cutout:496-504 draft slots | OPEN-SLOT hot-update persistence of unsaved paint | **RULED → WORKBENCH-SCOPED SLOTS** (user, verbatim: "makes it better if something gets really fucked up"): the lens gets its OWN slot book, never cutout's — one corrupted book must not eat both surfaces' unsaved work |

## Deferred (full list — nothing silently dropped)

1. ~~**K4** live 3D model preview inside the PAINT lens~~ — RULED IN (day one).
2. ~~**K5** draft-book scope~~ — RULED: workbench-scoped slot book (isolation).
3. **ClothingSkinCaptures** (preview.tsx:459) — module-internal capture set;
   verified mounted via the captures stack, rides I9. Listed for the
   independent check, not actually deferred.
4. The /characters route itself — UNTOUCHED this dispatch; flips on the
   user's word in its own commit (the dispatch's own fence).

→ ZERO open deferrals: every parity row has a workbench landing.

## Shared-file edits this dispatch genuinely requires (named per the fence)

- `shell/fields.tsx`: `text` FieldSpec (B1, G4) · `act` FieldSpec (B4-B6, D8,
  G4-G5, H2) · color palette opts (F6) · slider commit-on-release (H1).
- `shell/Workbench.tsx`: `source.onPick?(rowId)` (A5 — load is an event, not
  a render side-effect) · `source.defaultRow?(rows)` (A3 — last, not first).
