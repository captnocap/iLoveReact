# Deshitification ledger

## Round 1 — 2026-08-14
**Trigger:** "lets do some of this"; "there are buttons in the actionbar that have absolutely no reason to be there, they are functions used once in a blue moon and the button somehow lives right next to arguably soem of the most important base actions and it just doesnt align, and on top of that, i think just if you take a peak at what is on that action bar, you should be able to infer exactly what im talking about"; "the one i genuinely cant understand why is showing up on the action bar still. this right here has been used literally 1 time and never again"

**Since last round:** First round. Recent Material Lab work is present, including in-flight panel registrations for Stack and Lab inspector.

**Findings:** 1 lie, 6 structure, 2 layout, 2 copy, 1 stale-risk. Seeded and fixed first: the Model action bar flattened a complete 23-tool vocabulary beside foundational controls, while a one-off retopology teaching cluster bypassed that vocabulary as bespoke JSX. Other notable findings: generic Focus displays placeholder facts on unrelated documents; Material Lab draws duplicate side chrome; its registered panes are not consumed; non-world documents inherited World controls; model lighting bypasses the command table.

**Passes run:** Non-world action-bar authority → done; Material, Playtest, Animation, Facade and Knowledge now keep Section D empty. Model action-bar diet → done; permanent registered controls reduced from 23 to 11 with context/menu parity intact. Retopology pseudo-command cluster → done; Band/tint/erase/ghost/clear UI and dead shell wiring removed, native capability retained.

**Rules minted:** Document-kind presentation switches are exhaustive; a new or non-authoring document defaults to empty chrome, never World authority by fallthrough. A permanent toolbar is a curated projection of the command registry, never the complete command vocabulary. Action-bar audits inspect all JSX after the registry projection; bespoke controls are pseudo-commands and fail conformance.

**Watchlist:** Section D surface authority → focus Material/Playtest/Animation and confirm Build, snap, floor and walls do not render. Model action-bar hierarchy → confirm its permanent registered strip is exactly View/Vertex/Edge/Face, Move/Scale/Rotate, Mirror X/Y/Z, Paint; confirm Face mode does not append Band/tint/erase/ghost/clear; occasional registered tools remain reachable by right-click/menu/hotkey.

**Regressions found:** None; first round.

**Stale sightings:** None reported. Open risk: after Material Lab Save to Catalog, confirm generated registry consumers refresh without reload before closing the stale audit.

## Round 2 — 2026-08-14
**Trigger:** "Material Lab — polish pass 3: naming, ownership, and the Library container"

**Findings:** 1 stale, 3 structure, 2 layout, 2 copy. Recipe rename edited the canonical recipe but the bottom tab retained the asset-name snapshot, while the stage titlebar rendered the immutable recipe slug. The Layers rail also owned blend/base-warp property controls, and Library reused Paint's tiny paginated grid.

**Passes run:** Control ownership → Layers now owns membership and the inspector owns selected-layer properties. Name authority → stage and active material tab derive from the live recipe name. Library container → fixed pagination replaced by a responsive, named, vertically scrolling, virtual-batch grid; color sets collapsed into compact chrome.

**Rules minted:** A document title derived from a live editable entity is a projection, not persisted duplicate state. Context rails own collection membership; inspectors own selected-object properties. Shared GPU batching may share its data contract without sharing another surface's density.

**Regressions found:** Recipe rename left the bottom tab, slug chip, and stage label stale.

**Stale sightings:** FIXED — rename the active recipe to `test`; the inspector remains the only input, and the stage title plus active bottom tab now read live `recipe.name`. The stale slug chip was removed.

## Round 3 — 2026-08-14
**Trigger:** "when i scroll on the library i get 240 fps -> 11 fps, and the tab takes ~2-3 seconds to open, then another 2-3 seconds before it hydrates a bunch of thumbnails into larger thumbnails. the ending library after the wait is genuinely a nice view but the performance shitter when scrolling blows ass and opening the tab at all blows for the wait time"; "also, do the shaders have a fixed width or something? even on 1x my monitor makes it start tiling"

**Since last round:** Round 2 replaced the fixed paginated Paint-density browser with the responsive full-width Library grid.

**Findings:** 1 performance regression, 1 hydration regression, 1 viewport-geometry regression. The Library rebuilt its 400-material model per wheel event, mounted fresh shader modules while scrolling, left large procedural Effects live instead of cached, and hydrated first at a guessed width. Stage 1× used a short-edge square, forcing repeats on ultrawide viewports.

**Passes run:** Library hot-path repair → catalog rows memoized, scroll updates batch-granular and settled, six-row effects cached through `StaticSurface`, guessed-width render removed. Stage density semantics → 1× is one full-viewport sample; higher densities retain intentional tiling.

**Rules minted:** A virtual list is not virtual if scroll position invalidates the full data model or compiles presentation while input is active. Procedural gallery cells must become stable cached textures before they enter a scroll hot path. Responsive GPU content never renders against guessed geometry.

**Watchlist:** Material Library → confirm first tab entry presents chrome/cards without a multi-second blank, sustained scrolling stays near baseline FPS, settled thumbnails retain the Round 2 appearance, and returning to a visited batch reuses its cached surface. Material stage → at ultrawide 1× confirm one sample spans the stage; 2×/4×/6× still tile.

**Regressions found:** Round 2 Library container pass regressed first-open latency and scroll frame time by omitting Paint's cache boundary and treating pixel scroll as React state.

**Stale sightings:** Round 2 recipe-rename fix remains source-derived from live `recipe.name`; no new stale-data sighting. The reported delayed thumbnail resize was hydration churn, fixed by waiting for measured geometry before mounting Effects.

## Round 4 — 2026-08-14
**Trigger:** "arguably that is slower? i cant tell. and i keep hitting full on 2-3 second freezes when scrolling"; "also i think we are missing every variation of each existing shader. like, to my knowledge, every one of these has 3 existing variants of itself but this surfaces one of them and has no way to use the others"

**Since last round:** Round 3 deferred shader creation until scroll settled and enlarged each module to six rows. That moved the synchronous render-thread compilation stall instead of removing it.

**Findings:** 1 performance regression, 1 hidden-capability structure defect. A newly settled Library batch still constructed `ShaderGridBatch`/`fillShaderFor`, so scrolling could trigger seconds of synchronous WGSL compilation. The catalog model also called `defaultShaderData`, flattening every registry material to variant 0 even though `variantLabels` and take-scoped slots already described all three authored takes.

**Passes run:** No-shader Library → the scrolling tree now contains only virtualized card primitives and actual baked palette signatures; exact procedural rendering begins only after explicitly opening a material in the Lab. Variant recovery → each authored take is its own named card, card activation passes the selected variant through the existing material-selection command, and the inspector exposes an editable Variant dropdown for a selected base or surface layer.

**Rules minted:** A cache cannot repair synchronous compilation required to populate the cache. Scrollable catalogs never create shader modules or pipelines; exact rendering starts at a deliberate selection boundary. Registry variants are authored content, not implementation detail, and every take must be reachable anywhere the material itself is offered.

**Watchlist:** Material Library → confirm first open has no multi-second blank and sustained scrolling has no 2–3 second freeze; confirm three named take cards are visible for a material such as Water and each opens the corresponding take. Inspector → select the base or a surface layer and confirm Variant changes the rendered take.

**Regressions found:** Round 3's settled-batch cache approach was slower in practice because it compiled larger shader modules after scrolling stopped. It is retired; the Library has no Effect or shader-batch import.

**Stale sightings:** Round 2 recipe-rename fix remains source-derived. No new stale-data sighting; the apparent delayed thumbnail hydration was eliminated rather than cached.

## Round 5 — 2026-08-14
**Trigger:** "we just went from having a full library of actually recognizable shaders to a bunch of noise that means effectively nothing to me"; "why not just pre-bake them into thumbnails, anytime a new one is added, get it as a thumbnail. store them this way. no sense in doing it every time during runtime"; "the tooltips are aggressive as hell. delay them from showing for a few seconds of inactivity"

**Since last round:** Round 4 correctly severed shader compilation from the scroll tree, but substituted palette stripes that were fast and semantically useless as material previews.

**Findings:** 1 recognition regression, 1 authoring-lifecycle gap, 1 chrome-interference defect. Palette signatures could not communicate actual shader form. The generator had no durable preview-artifact stage. Immediate native tooltips obscured cards during ordinary browsing.

**Passes run:** Recognizable artifact bake → a dedicated GPU authoring cart captures all three authored takes into immutable content-addressed 128px PNGs and atomically publishes a versioned manifest. Generator integration → the canonical shader sweep builds the baker, skips unchanged hashes, runs stale captures only, and refuses success unless every live material has three files. Library restoration → one named material card displays the selected exact baked take with 1/2/3 selectors; scrolling mounts Images only. Browse quieting → Library tooltips require a 2.5-second dwell, cancel on leave, and cancel immediately on scroll.

**Rules minted:** A performance placeholder is not a preview if it removes the visual fact users browse by. Expensive deterministic catalog presentation is an authoring artifact, content-addressed and validated beside the source generator. Tooltip discovery chrome yields to continuous browsing input.

**Regressions found:** Round 4's palette-signature substitute destroyed material recognizability. It is retired; no palette facade remains in the Library.

**Stale sightings:** FIXED — thumbnail manifest hashes cover bake version, shader source, packed take data, dimensions, and take identity; unchanged catalogs reuse all 1,230 artifacts, while a changed/new material becomes stale automatically.

## Round 6 — 2026-08-14
**Trigger:** "this looks like a mapped item problem, it hard cuts off the thumbnails after some fixed limit i assume like 1024 or similarly"

**Findings:** 1 native resource-lifecycle defect. The process-wide `<Image>` cache had a hard 256-entry append-only table. Once editor chrome and previously visited surfaces occupied roughly 241 entries, the Library loaded the remaining contiguous ~15 thumbnails and permanently rejected every later source.

**Passes run:** Bounded residency repair → the cache remains capped at 256 GPU textures, but capacity exhaustion now replaces the least-recently-used entry not touched in the current frame. Replacement releases the old bind group, texture view, and texture before installing the new source; entries already queued for the current frame are never recycled.

**Rules minted:** A bounded process cache must define replacement behavior; reaching capacity may degrade reuse but may never permanently disable a capability. GPU resources queued in the current frame are not eviction candidates.

**Regressions found:** Round 5 exposed a pre-existing append-only image-cache ceiling because the Library is the first editor surface to browse hundreds of unique bitmap sources in one session.

**Stale sightings:** None. This was residency exhaustion, not stale artifact data; all 1,230 manifest files remain valid.

## Round 7 — 2026-08-14
**Trigger:** A newly saved Lab composition appeared in Library as `PREVIEW MISSING`.

**Findings:** 1 partial-publication race. Shader generation writes registry/dispatch before the authoring baker finishes, so dev hot reload could briefly expose a new material against the prior thumbnail manifest. In this sighting, Milky Way Lab was registry material 411 while the manifest still committed 410.

**Passes run:** Artifact completion → regenerated and baked Milky Way Lab's three content-addressed previews; the manifest now covers 411 materials. Atomic Library publication → a material becomes browseable only when the current versioned manifest contains all three authored take paths, making the manifest the UI commit record instead of rendering a broken placeholder during registry-first reloads.

**Rules minted:** Generated registry membership is not proof that dependent presentation artifacts are published. Consumers cross the transaction boundary through the completed manifest.

**Regressions found:** Round 5 validated generator completion but allowed intermediate dev hot reloads to render half-published catalog entries.

**Stale sightings:** FIXED — Milky Way Lab's registry entry preceded its manifest entry. The completed manifest now publishes all three previews together; partial entries remain invisible rather than becoming broken cards.

## Round 8 — 2026-08-14
**Trigger:** "prime realestate in both left and right gutters"; "the stage itself has arguably the worst layout"; "buttons that dont do shit"; "i just prompted and there is no play button"; Kimodo supplied as timeline/hierarchy inspiration.

**Findings:** 3 truth defects and 5 hierarchy defects. Animation bypassed both contextual panel registries, generic object facts occupied the right gutter, capture diagnostics received equal center-stage priority, and playback targeted an unavailable `/play` world instead of the rig visibly mounted in the animation document.

**Passes run:** Registered Capture/Generate gutters → one lifecycle-bound bridge projects the stage-owned controls into contextual panels. Stage hierarchy → one dominant target preview and a responsive ruler/track timeline. Playback truth → Play/Pause/Resume/Stop address the target viewport node. Copy/affordance → Tracking names its real behavior and disabled controls explain their prerequisites.

**Rules minted:** A specialist workspace must claim the shell regions its workflow actually needs. Diagnostics do not receive equal area with the authored result. Preview transport targets the previewed object, not a mutually exclusive route. Disabled prime actions always state the missing condition.

**Watchlist:** Open Animation and confirm Capture/Generate select automatically; generate a motion, then Play/Pause/Resume/Stop and scrub it on the visible target; confirm Tracking Off leaves the target mounted and releases capture pose authority; keep spikewatch silent through 60 seconds of playback and scrubbing.

**Regressions found:** None in automated checks. Visual hierarchy and frame-time remain delegated to the running editor.

**Stale sightings:** FIXED — the previous generic Focus panel and `/play` playback promise no longer appear in animation context.

## Round 9 — 2026-08-14
**Trigger:** "The app's boot frame is initialization residue, not a designed state"; "the right focus panel describes Concrete Floor with nothing selected"; "the asset drawer has auto-focused Abalone Shell"; "Store View pins this s"; "the focus material button navigates to the Material Lab without focusing anything"; "the session opens as untitled with an arbitrary world, offering no way to resume previous work"; plus a direct ask for a homepage with jokes, a quote and an occasional flashy moment.

**Since last round:** Round 8 fixed animation's cold state by giving that workspace the gutters its workflow needs. Round 9 found the same disease one level up: the whole application's state zero was assembled from literal defaults in `data/initialState.ts` rather than designed, and nothing carried a working session across a real restart.

**Findings:** 3 phantom-subject defects, 1 systemic overflow defect, 4 card defects, 1 label/effect mismatch, 1 missing capability. `armedPieceId: 'floor.concrete.common'` and `activeAssetId: DEFAULT_ASSET_ID` were constants, and `selectedObject()` invented a placeholder tile so callers could treat a selection as non-nullable — three separate machines for showing the user something they never chose, and each one hid a designed empty state that already existed but had never been reachable. Panel strings ran off the app edge because `noWrap` text measured clamped and PAINTED natural (`engine.zig` passed draw width 0) while CSS `white-space: nowrap` also opts a flex item out of the wrap clamp — both halves had to be wrong for the bug to appear, and both were. The drawer card printed "3 variants" above three chips that could not fit their names beside their role tags in 236px, and its primary verb passed the click EVENT into `focusMaterialDocument(variant)` — which is why "focus material" reached the Material Lab focusing nothing. Nothing persisted the working session: tabs, panes, folder, floor and camera lived only in the `editor:view:v2` hot twig, which is Zig-owned memory that by design dies with the process.

**Passes run:** No phantom focus → boot arms nothing, selects nothing and seeds no objects; `selectedObject`/`assetByIdOrNull`/`selectionPosition` return null instead of substituting; every focus surface renders one shared `FocusEmpty` naming what it shows and the gesture that fills it; actions that need a material (Paint Faces, slot bind, Color Studio) refuse out loud rather than applying a default. Systemic overflow → `drawLineElidedRGBA` in `framework/primitive/text.zig` makes paint agree with measurement, and `panelText.ts#oneLine` stamps both halves of the policy onto all 34 single-line classes in the sheet. Session restore → `data/sessionStore.ts`, a per-concern durable save beside the color library and library history, carrying map, tabs, panes, folder, selection, floor and a real camera pose replayed through the saved-views recall path. Home → a boot document with Continue, the real `listMapDocuments()` list with names and timestamps, and New, plus a rotating quote, a rotating joke and a confetti `<Effect>` on milestone launches. Card cleanup → takes became rows, the variant count sentence is gone, the slug prints only when it is not the title again, and the verb reads "Open in Material Lab" because that is where it goes.

**Rules minted:** A boot frame is a designed state or it is initialization residue; there is no third option. A resolver that substitutes a default cannot answer "did the user choose this" — that question needs its own nullable door. An empty state that only fires behind a constant has never shipped. Paint and measurement must agree about width, or the layout that placed a string is not the layout that draws it. A single-line label needs BOTH the elision props and `min-width: 0`; either alone puts the string back off the edge. A button's label names its effect.

**Regressions found:** None introduced. The pre-existing `editorEvents` `piece.place` slot-key failure predates this round and is untouched.

**Stale sightings:** FIXED — the boot frame no longer reports an armed piece, a focused material, a placeholder tile or a fictional `main.gamefile`. The world tab and chrome both carry the live map name.

**Watchlist — BOOT IS CLEAN:** cold-start the editor with zero input and confirm: Home opens with Continue/recent maps/New; no focus or inspector panel names an entity; the asset drawer's card shows its empty state; no string clips at a panel or app edge at the default 1536×940 window; the drawer card's take rows read their names and role tags; "Open in Material Lab" lands in the Material Lab on the named material. Automated half: `cart/editor/bootIsClean.test.ts` (25 checks).

## Round 10 — 2026-08-14
**Trigger:** "our navigation system is a fucking nightmare"; "that array of buttons being Editor Play untitled and the other one"; "there is no formal way to just directly go into the model editing studio or now the animation is also gonna join that"; "do not get me started on the color studio"; "see how this reports recents and favorites but your homepage doesnt report anything but a absolutely massive empty space"; "your jokes are dry"; "put your jazz hands into it".

**Since last round:** Round 9 made the boot frame a designed state and gave it a Home surface. Home was honest but nearly empty, and it exposed the deeper problem: the editor had DOCUMENTS but no DESTINATIONS. The model studio, the animation foundry and the material lab could only be reached sideways — by clicking a row in the asset tree or finding an entry inside the Globals menu — and nothing in the interface said they existed.

**Findings:** 1 missing navigation model, 1 chrome grouping defect, 1 reporting gap, 1 harness gap, 1 register miss. The top-right of the chrome had grown into an undifferentiated row (a book icon, a map pill, Editor, Play) mixing three unrelated questions: where am I working, which map, which route. Home reported nothing while the Asset Explorer four panels away held nineteen recents with staged thumbnails. The synthetic key harness could only build single characters, escape and enter, so anything bound to a function key was unreachable from a headless shot. And the jokes were dry gamedev quips in an application called Shitty Games.

**Passes run:** Destination model → `shell/destinations.ts` names the seven places you can work, each with a label, an icon, an F-key, and a line saying what you do there; the lit one is DERIVED from the open document so the strip can never disagree with the stage. Front door → `shell/WorkspaceSwitcher.tsx` puts them in the chrome next to the menus, and the chrome splits into three groups by question. Subject rule → a destination that needs a model or a material and has none lands on Home filtered to that subject, so every destination always goes somewhere. Home as hub → the void now carries the library's OWN recents and favorites (`recentLibraryHits`/`favoriteLibraryHits`, not a second list) as thumbnail rows with the Asset Explorer's badge vocabulary, filter chips, and a glyph rather than a blank swatch for models nobody has staged a shot for. Chrome fit → the spelled-out brand cost ~100px to name the application you are already inside; the mark stays, the width buys the strip its labels, and the window controls never shrink. Harness → `syntheticKeyEdge` learned the extended-key table, so F-keys and arrows are drivable headlessly. Register → thirty-six jokes rewritten in pop-up-ad voice.

**Rules minted:** A document is not a destination. Navigation belongs in one labelled strip, grouped by the question it answers. A front door that opens onto nothing is not a front door — every destination goes somewhere, and a picker is somewhere. A surface with a void beside a panel full of data is not missing content, it is missing a query. A key binding nothing can press headlessly is a binding nothing can verify.

**Regressions found:** None introduced. Pre-existing and untouched: `editorEvents` `piece.place` slot-key, and the user's map logs `[world-store] REFUSED malformed v5 snapshot: pieces[271] is a legacy wall-kind record` on every boot — a legacy record in authored data, not a code defect from this round.

**Watchlist — EVERY STUDIO HAS A DOOR:** from a cold start press F3, F4, F5 and confirm each lands in the model studio, the animation foundry and the material lab respectively with the strip lit on the matching destination; press F3 twice and confirm the second press offers the model picker; confirm the window controls are all visible at 1280 wide; confirm Home lists your real recents with thumbnails and that the Favorites chip shows the pinned set. Automated half: `cart/editor/shell/destinations.test.ts` (10 checks).

## Round 11 — 2026-08-26
**Trigger:** "[screenshot of MODEL · STATS] this panel is not wide enough to use properly at all." Ruling on the two open questions: STATS declares a wide width AND wears the drag grip; the overflow fix is systemic, not one class.

**Since last round:** The blueprint stats pane landed (profiles, scope, `rj.core.audio` events, target extensions) as a new inspector pane. It shipped into the focus panel's fall-through width and inherited a class-sheet hole that had been open since Round 9.

**Findings:** 1 layout defect, 1 systemic overflow defect, 1 row-proportion defect. The pane is a control GRID — `CellRow` spends 24px padding, an 82px label column, an 18px reserved reset column and two 8px gaps before any content, so at the 326 prop-inspector default its audio row had 123px for TWO select controls carrying an authored clip name. Every other dense pane in section G already declares its own width (character rig 720, atlas 480/960, blob 420/720); `stats` was the only workspace-shaped pane still reaching the default by fall-through. Underneath that, `HW_FormValue` — the class every select control in every panel renders its value with — was one of **90** Text classes that Round 9's sweep never reached, so a long clip name PAINTED over the control beside it rather than eliding. And the audio row split its span evenly between a name that can be long and a mode that is always one of three short words.

**Passes run:** STATS width + shared grip → `REGIONS.focusPanel.statsWidth = 480`, and the left-edge drag moved out of `Inspector.tsx` into `inspector/focusPanelResize.ts` as `useFocusPanelResize`, keyed per shape (`uvPanel`/`uvFocus`/`stats`) so panes share one clamp policy instead of copying a gesture. `uvPanelWidthFromDrag` was not reimplemented — it moved and lost its `uv` prefix, because nothing about it was ever UV-specific. Systemic overflow → all 101 bare `{ type: 'Text', … }` classes in `workspace.cls.ts` now declare a policy: 90 became `oneLine`/`oneLineColumn`, and `panelText.ts` gained `wrapping()` so "wraps on purpose" is distinguishable from "no policy at all". Row proportion → the audio clip control takes two flex shares to the mode's one.

**Rules minted:** A pane whose content is a FORM declares its own width; only fact lists inherit the prop-inspector default. A gesture that reads a shared policy belongs to the region, not to the first pane that needed it. "Wraps" and "has no overflow policy" must be distinguishable in the source, or the second one hides inside the first for another eight rounds. A policy with no enforcing check decays at the rate new classes are written — Round 9 stamped 34 classes correctly and 67 more were added around it.

**Watchlist — THE FORM FITS:** open MODEL · STATS on a model with a blueprint and at least one `rj.core.audio` event; confirm no string paints over the control beside it, the clip control is visibly wider than the mode control, and the left edge drags between 420 and 1600 leaving ≥560px of stage. Then open MODEL · PAINT and confirm its drag still works and its width is independent of the STATS width. Automated half: `cart/editor/workspace.cls.test.ts` (124 elided / 12 column / 21 wrapping / **0 unpoliced**) and `cart/editor/inspector/uvWorkspace.test.ts`.

**Regressions found:** Round 9's overflow policy was never finished — it minted the rule and the module, stamped 34 classes, and left 67 unpoliced with no check to notice. That is what surfaced here as text painting over text. Re-tested intact this round: BOOT IS CLEAN (28/28) and EVERY STUDIO HAS A DOOR (8/8).

**Stale sightings:** None new — the user's words: "not yet this is my first time seeing it after it was made". Prior sightings (Round 2 recipe rename, Round 5 thumbnail manifest, Round 7 partial publication) remain source-derived and were not re-opened by this round's changes.

## Round 12 — 2026-08-26
**Trigger:** "one thing we can do to further deshitify is just change this entire panel to all behave on the same wavelength. there is no reason why one tab should have a extendable surface and another cant. also, the width churn between one tab to another is nausiating, it should carry the same width the user sets for every tab, the user can end up dealingn with needing to extend it to use when necessary if it doesnt fit, but when narrow the panel should also properly provide a usable surface to its best ability, example of what not to do is exactly the reason we are here right now, the text was too tight, it didnt wrap, and everything was jammed."

**Since last round:** Round 11 gave MODEL · STATS its own width and grip. That fixed the pane and made the disease legible one level up: a width per pane is churn, and a grip per pane is an arbitrary list.

**Findings:** 1 structure defect (7 mounts), 1 layout defect (per-pane widths), 1 degradation defect (rows squeeze instead of reflow), 1 duplicate-mechanism defect (blob C/W presets), 1 verification-gap defect. Section G was mounted SEVEN times in `Inspector.tsx`; six wrote `<C.HW_RightPanel>` bare and one carried a five-branch width expression and the only grip. Seven width constants existed for one region. Rows had no narrow behaviour at all — the 82px label column and 18px reset column are `flexShrink: 0`, so everything between them absorbed the whole shortfall. And the previous round's ReferenceError had shipped because an esbuild bundle was accepted as verification.

**Passes run:** One mount → `inspector/FocusPanelShell.tsx` owns width, grip, head, collapse and rail; panes supply only a body, so a pane cannot opt out of resizing or invent a width. One width → every per-pane constant DELETED (not renamed); `useFocusPanelResize` collapsed from a keyed map to a single width; UV FOCUS decides content only; the Blob Explorer's C/W preset buttons retired in favour of the drag. Narrow reflow → `inspector/rowLayout.tsx` publishes ONE derived breakpoint (429) and `CellRow`/`ReadOnlySection`/`PresetSection` stack below it: label on its own line, wrapping, controls at full span, right edge unmoved. Drag floor (364) derived from the widest minimum any pane declares. Verification gap → `unboundIdentifiers.test.ts`.

**Rules minted:** A region is mounted once. Seven mounts of one region is seven chances to disagree about it, and the sixth one always does. A width belongs to the REGION, not to whichever pane is open — a per-pane width is tab-to-tab churn with a nicer name. Narrow is a MODE, not a smaller version of wide: below the breakpoint the whole panel changes shape at once, because rows that reflow while their neighbours squeeze read as broken. A breakpoint is derived from the densest thing it must fit, or it is a magic number waiting to be wrong. **A bundler is not a verifier** — esbuild resolves modules, not identifiers, and will happily emit a bundle containing a call with no definition.

**Watchlist — ONE WAVELENGTH:** open the focus panel, drag its edge, then switch across Model/Paint/Stats/Rig/Names/Recovery/World/Outliner/Playtest/Lab/Animation and confirm the edge NEVER moves and every pane shows the grip. Drag below 429 and confirm every row in view stacks together (label on its own line, wrapping) rather than some stacking and some squeezing. Drag to the 364 floor and confirm the Blob Explorer still renders its data column. Automated half: `cart/editor/inspector/focusPanel.test.ts` and `cart/editor/unboundIdentifiers.test.ts`.

**Regressions found:** Round 11's own commit (3beb1556e) shipped `useFocusPanelResize` with no import; the editor threw `ReferenceError` and GlobalErrorBoundary tore down the Inspector tree. Fixed in 1a5f71f10. Root cause of the MISS, not of the bug: the verification step was a bundle. `unboundIdentifiers.test.ts` now covers that class and was checked against the real regression.

**Stale sightings:** None new. The user's Round 11 answer stands: "not yet this is my first time seeing it after it was made".

## Round 13 — 2026-08-26
**Trigger:** "look at the recovery tab. it is nothing like the other tabs in terms of style or anything. the thing looks like a regurgitation of a bunch of badges as buttons or im not sure. and it itself has 3 tabs. one thing i stress a lot is agents are attrocious at consuming all the correct vertical space. either they have something that spans as tall as 1/3rd of the space or its overflowing when it does not need to be. there is a lot of dead space in this recovery tab for it to have 3 nested tabs"

**Since last round:** Round 12 put every pane on one width and one mount. Recovery was the pane that made the remaining divergence obvious: it had joined the panel's geometry without joining anything else.

**Findings:** 1 vertical-space defect, 1 style-divergence defect, 1 chrome-budget defect, 1 sheet-coverage gap. `Inspector` mounts the surface with no `height`, so it fell back to a hardcoded `defaultHeight: 640` inside a container of whatever size the window gave it — **dead space and overflow are the same bug here**, and which one you see depends only on your window. The pane also carried a private 13-entry `COLORS` map of raw hexes, a private `TinyButton`, a private `Fact` row and ~120 inline style objects, none through a classifier sheet. And its faces tab opened with FOUR stacked wrap-rows of chips (mode, source, 16 filters, 8 sorts), each with its own padding and divider — five or six wrapped rows of chrome before any data.

**Passes run:** Flex the surface → `flexGrow/minHeight: 0`, tab strip as fixed chrome, scroll takes the remainder, and the `height` prop DELETED so no caller can override the layout again. Curate the query header → permanent header is the source plus one line stating what is filtered and how it is sorted; full chip sets open on demand and active filters stay visible either way. Join the sheet → `stage/blobExplorer.cls.ts` for what is genuinely recovery-specific, the shared `HW_Pill` for chips, `HW_LensTab` for the 22px tab strip (was 42), and the focus panel's own `FactRow` for label/value lines, so recovery facts stack with every other panel fact when narrow. `COLORS` deleted. Finish the sweep → `journalThreads.cls.ts` (12 classes); `workspace.cls.test.ts` now covers three sheets.

**Rules minted:** A surface that takes a pixel height from a constant is not laid out, it is guessed — and the guess reads as dead space or overflow depending on the window, which is why those two complaints are one bug. A pane that reimplements its host's palette and controls will never look like its host, however carefully it is tinted; the fix is to USE the host, not to match it. Permanent chrome is what you need every time; everything else earns a disclosure. A sheet the policy test does not import is a sheet with no policy.

**Watchlist — RECOVERY IS PART OF THE PANEL:** open MODEL · RECOVERY on a tall window and confirm the surface reaches the bottom with no gap, then on a short window confirm it scrolls instead of overflowing. Confirm the faces tab opens with two header lines, not five. Drag the panel below 429 and confirm recovery's facts stack like every other pane's. Confirm no raw hex remains: `grep -c "#[0-9a-f]\{6\}" cart/editor/stage/BlobExplorerSurface.tsx` is 0.

**Regressions found:** None in the shipped work. During the round I damaged four classifier sheets with a `\s\s+` whitespace regex that ate newlines (285 deletions of pure line-joining); caught it in `git diff --stat` before it left the working tree, verified the damage was entirely mine and nothing else was pending in those files, and restored them. The lesson is the one already in the ledger: inspect the diff, not the exit code.

**Stale sightings:** None new.
