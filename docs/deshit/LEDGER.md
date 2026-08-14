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
