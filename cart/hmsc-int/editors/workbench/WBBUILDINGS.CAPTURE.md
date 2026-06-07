# BUILDSKIN-0606 CAPTURE — the building source's spec parity table

The COVERAGE LAW deliverable: the user's 5-point spec, line-referenced to
where each point lives, plus the non-negotiable design constraint. Sources
audited end to end:

- `game/build/{pieces,catalog,edits,prefabs,placed}.ts` + `game/world/stream.ts`
  (the V24 grammar + the V20 world stream — the building truth)
- `game/textures/registry.tsx` (THE texture registry — what a material IS)
- `editors/workbench/materials/store.ts` (the step-7 lane's landed contract)
- the items/characters sources (the WorkbenchSource pattern, per dispatch)

New files: `game/build/skins.ts` (the pure skin vocabulary),
`editors/workbench/buildings/{store.ts,panel.ts,live.ts,Stage.tsx,source.tsx,buildings.test.ts}`.
Additive edits: `game/build/prefabs.ts` (two optional fields + skin shape
checks in validatePrefab), `game/build/index.ts` (exports + GAME_BUILD.skins),
`editors/workbench/sources.ts` (registration).

## The user's spec, point by point

| # | spec (near-verbatim) | where it lives |
|---|---|---|
| 1 | a saved PREFAB becomes a BUILDING type; the roster lists every prefab-building with its total piece count | **R** — roster = the prefab table: static seeds (prefabs.ts:62 BUILD_PREFAB_DEFINITIONS) + world-saved defs (stream.ts:61 `prefabs`, fed by `prefabDefined` events), world wins same-id (stream.ts:201 — the stream's own newest-meaning law, which is also how editing a seed works: the edit commits a world copy that shadows it). Rows read `Motel Room · 6` (buildings/panel.ts buildingsRoster) |
| 2 | GLOBAL skin per piece TYPE — 4 types, "all walls → green" in one action | **P** — `BuildPrefabDef.skins` (prefabs.ts:49, typed by kind) edited through one group per kind PRESENT, the structural quartet first (skins.ts:60 STRUCTURAL_SKIN_KINDS = wall/floor/ramp/roof — the user's 4; skins.ts:64 skinKindOrder puts any other V24 kind after, none exempt — the buildings-are-one-category law). The ALL row writes every slot in ONE action → ONE commit (store.ts:158 setTypeSkin, skins.ts skinAllSlots; suite: "one action, one commit") |
| 3 | PER-PIECE OVERRIDE on top — global green, one wall red; override beats global | **P+S** — `PrefabPiece.skin` (prefabs.ts:39) edited in the selected piece's group (store.ts:169 setPieceSkin); resolution order is ONE pure function: piece > type > bare (skins.ts:79 resolveFaceSkin), consumed by the panel's provenance rows, the stage's render fold, and the caption (describeFaceSkin). THE PASS is the suite's headline test, including clear-falls-back-to-green |
| 4 | skins are PER-FACE; 6-face box but only the 2 MAJOR faces matter individually; sides are ONE uniform group | the slot vocabulary: `front · back · sides` (skins.ts BUILD_FACE_SLOTS); plates label their majors top/bottom, walls front/back, slot ids fixed so skins survive a kind swap (skins.ts:36 faceSlotLabels). The stage renders the rule literally: core box = the side group, two thin major-face slabs carry their own skins (Stage.tsx:57 PieceMeshes; quarter-turn normals, no fake per-face split beyond the 2+1) |
| 5 | NOTHING IS IMMUTABLE — swap a wall to a door, remove a piece, add a window; live structures, never baked | **P+A** — the piece group's `piece` enum (full catalog swap, store.ts:186 — placement AND skin survive the swap: the override rides the PrefabPiece, never an index table; proven by the remove-shifts-indexes test), `cutout` enum (door/window/… — "swap a wall to a door" IS the V24 wall-edit vocabulary; refused on editless kinds by the kind contract), x/y/z/yaw nums, `remove piece` act, hero `+ wall`/`+ floor`. Every mutation = ONE `prefabDefined` commit of the full def, validated (store.ts:128 redefine → validatePrefab → the REAL worldStream.apply accepts it in the suite) |

## The design constraint (non-negotiable): the skin vocabulary IS the material system

- A face skin is exactly one of TWO things (skins.ts BuildFaceSkin): the
  mesh's native base **color** (the channel catalog pieces already render
  with — green/red are this) or a **material** — a textureKey into THE
  texture registry (game/textures/registry.tsx: shader recipes, stored
  Materialized materials, decals, facades). No third path exists.
- Material EXISTENCE is gated at the editing boundary (store.ts:121
  checkSkin → live deps.validMaterial = `textureById` — buildings/live.ts);
  an id outside the registry throws. The picker's options ARE
  `allTextures()` (live.ts), so the materials lane's saves appear here the
  moment they land — one source of truth, zero coordination debt.
- The stage renders a material skin the way the game does: ONE
  `TextureCapture` per distinct id (Stage.tsx:226, staticKey `bldskin:<id>`)
  sampled by `textureKey` on the face slab — the registry's own bake wire,
  not a parallel texture path.
- The pure model (game/build/skins.ts) holds NO registry import, so the
  bake/game side can consume skinned defs React-free.

## Three chrome laws

- LAW 1: gutter 3 is the one edit surface (all skin/structure writes are
  panel fields/actions through the store); the stage receives the resolved
  render fold (panel.ts:229 buildingRender) — its only inputs are SELECTION
  (click-pick via the pure raycastPieces, Stage.tsx:204 — the WBCHAR C3
  "grabbing selects" precedent) and the orbit camera (ObjectInspect3D's
  proven native wire).
- LAW 2: no lenses claimed (single view, no segment shown) — nothing
  property-shaped rides the preview bar.
- LAW 3: the building renders full-bleed; the bottom strip is the live
  provenance caption (selected piece: `front: #dc2626 (piece override) ·
  back: #16a34a (type global) · …`) — the resolution order, readable while
  it happens.

## Notes / open edges (named, never dropped)

- **Stamping skins into the world**: `stampPrefabPieces`/`PlacedBuildPiece`
  do not carry skins yet — placed-world rendering of skinned stamps is the
  bake/world lane's pickup (the def carries everything it needs; the field
  rides the PrefabPiece, so the stamp pass-through is one spread when that
  lane lands). In-scope here was the workbench source (menu outside game
  testing), per dispatch.
- **Free-angled pieces**: the stage's face slabs snap to the nearest quarter
  turn (pieces author in 90° steps; `snap: 'free'` props would render their
  majors on the nearest axis). The DATA is exact — only the preview slab
  orientation rounds.
- **Material picker scale**: per-slot material pickers now consume the MATERIAL
  source chooser contract (`materials/chooser.ts:12-23`) through the shared
  `pick` field. BUILDING_PALETTE quick-picks stay local because they are color
  swatches, not material registry choices.
- **docs/game maintenance contract**: `game/build/` gained skins.ts + two
  optional fields; if the supervisor sequences this into a commit, the
  game-side docs/_index records for the build cart should be updated in the
  same commit per the contract (flagged, not done — supervisor sequences).
- The P4 suite: `buildings/buildings.test.ts` (9 tests) — roster/shadowing,
  THE PASS (global green → one wall red → clear falls back), per-face slot
  rule, material gating + capture list, structure edits (swap keeps skin,
  cutout contract, remove/add), index-shift skin survival, panel generation
  order, pure resolution. The fake session folds every commit through the
  REAL worldStream.apply — store → stream → merged read, proven headless.

## req_0184 — USER VERDICT fixes (path PASSES; two FAILS + delete addendum)

| fail/ask (user verbatim) | fix |
|---|---|
| "the skybox or camera for the 3d preview is extremely dark" | the stage had NO lights and framed at 12–25m where the auto-fog faded every face into the dark bg. Now THE stage kit's studio rig — ModelScene's exact wires (ModelViewer.tsx:38-42): `Fog enabled={false}` + ambient 0.55 + directional 0.95, bg = the kit's elevated panel (Stage.tsx Scene3D block). Shot-proven lit |
| "the side menu is an actual joke" — the full material registry inlined as chip walls per face row, the piece list a flat chip flood | the PICKER pattern, once for everyone: new `pick` FieldSpec in THE one renderer (shell/fields.tsx) — collapsed it is ONE compact chip (current value ▾); clicking opens THE shared chooser (shell/picker.tsx: search + groups + counts), one open at a time across the whole panel. Buildings consumes it for: per-slot materials (grouped by a-/b-/… family via `materials/chooser.ts:12-23`), the piece selector (grouped by TYPE with counts — `WALLS · 5` headers), and the catalog swap (grouped by kind). Zero option-dump enums remain. COORDINATION (via supervisor): shell/picker.tsx is intended as THE material-picking component — the materials lane consumes the same `pick` field; exactly one implementation |
| addendum: DELETE a building, confirm-step, no orphans | new ADDITIVE world-stream event `prefabRemoved` (stream.ts: tombstone in `removedPrefabs` so a deleted SEED stays gone; `prefabDefined` revives; a tombstoned id refuses `prefabStamped`). store.deleteBuilding is TWO-STEP: first click ARMS (`armedDelete`, panel renders `⚠ confirm delete building`), second executes ONE commit; any other edit/selection disarms. No confirm convention existed in the app (the vehicles census flags immediate-delete as an oddity) — this arm-confirm is the candidate convention. Skins die with the def atomically (they live inside it); selection was the only other keyed state, dropped with it |

Suite grown to 12 tests (pick folds; arm→confirm through the real
materializer; disarm/revive/stamp-refusal). Shots (lit + compact, the user's
own `test · 27` then the motel): `/tmp/buildskin-fix-test.png`,
`/tmp/buildskin-fix-motel.png`.
