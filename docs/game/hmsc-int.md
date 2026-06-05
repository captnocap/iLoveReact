# hmsc-int cart inventory

Source cart: `cart/hmsc-int/` (~9,200 lines: ~45 modules + `tabs/` + `assist3d/` + own `AGENTS.md` + `cart.json`)

Reviewed: 2026-06-04 (other sessions were actively editing this cart during review; this reflects the working tree)

## High-level purpose

`hmsc-int` is the **world editor for Hitman Shitcity** — the authoring counterpart of the game cart `cart/hmsc`. Its architecture rests on three locked decisions (all in its `AGENTS.md`):

1. **It stages a real `GameState`** — the exact record the game boots from — and "Compile" persists it to the shared `'hmsc'/'game-state'` localstore key (`saveGameState`). Localstore is ONE store across carts (`fs.init("reactjit")`), so the editor IS the editor→game channel. The old "emit `wv_*` command text" model is explicitly dead.
2. **Every mutation goes through the game's own mutators** (`editorWorld.ts` calls `resolveBuildingPlacement`/`addBuildingToWorld`, `placeProp`, `addZone`, `addSurfaceRegion`, `placeCell`, `setBuildingFaceSkin`, `nextUniqueId`) so an authored thing is byte-identical to one the game made. No parallel schema.
3. **The preview is the game's own renderer** (`WorldStatics` from `cart/hmsc/render3d/GameWorld3D` + the matching capture components) — no renderer fork, so the preview can't drift from the game.

Workflow: paint top-down in 2D (tiles / heights / zones / placements over a sparse chunk grid) → live iso/free-fly 3D preview → **Compile** writes the boot key → the game boots that exact world.

It is a **multi-map workspace** (VSCode model): each map is its own session file; maps are *thin references* into shared global registries (tile kinds, object kinds, kind textures) — change a global, every map follows.

## File map (by subsystem)

**Spine / shell**
- `index.tsx` (833) — composition only: workspace persistence (`useWorkspace`, payload v2), multi-map CRUD orchestration, placement state + undo snapshots, tile-selection + override state, `previewWorld` assembly, compile, router. The 2×2 `QuadSplit` layout: PropertiesPanel | RightPanel / PaintCanvas | IsoPreview, under the persistent `ProjectBar`.
- `AGENTS.md` — the cart's own agent contract (mutator rule, compile-=-persist, shape map). *Drift note: it documents `MapCanvas.tsx`, which has since become `PaintCanvas.tsx`.*
- `ProjectBar.tsx` (235) — persistent top strip: map switcher (`MapsMenu`), new/rename/delete, undo/redo, route nav buttons (editor/test/voxels/perf/assist/textures), Compile button, save pill, event-log popover. Menus export separately and render as the **root's last children** (the overlays-last hit-test rule, recorded in its header).
- `QuadSplit.tsx` (133) — controlled 2×2 splitter; drag is driven by the host's **global cursor channel** (`system:cursor:move`, pumped by Zig from `SDL_GetGlobalMouseState`) rather than per-node mouse-move, so tracking never loses capture; mouse down/up only bracket the gesture.
- `theme.ts` / `studio.cls.ts` (206) — classifier-driven styling: every colour is a `theme:` token; importing `studio.cls` seeds the studio theme (`setTokens`); per-instance states are sibling classes (`…On`/`…Active`). The two inspector surfaces render exclusively through these classes.

**World data layer**
- `chunks.ts` — sparse grid of 120×120-tile chunks (`CHUNK_TILES` matches the game). World extent derives from the address window (a–zzz columns / 0–999 rows → 152×8 chunks). Chunks grow into any in-bounds unoccupied neighbour. Each chunk owns its tile/height/zone buffers; zone *defs* are world-wide.
- `address.ts` — spreadsheet addressing (`A0…DP119`), bijective base-26 columns over integer cell coords; display/parse skin only.
- `tileData.ts` — `Int16Array` tile-kind index per 1m cell (−1 = empty); `TILE_PALETTE` derived from the game's `tileKinds` registry; rendered as one Effect storage buffer.
- `heightData.ts` (170) — `Float32Array` heightfield, 2 samples/tile, `HEIGHT_LIMIT = 64m` as the single height-range knob (brush stepper, stamp clamp, colormap span all derive). Brush mutates in place O(brush); render is one buffer upload.
- `zoneData.ts` — `Int16Array` per-cell zone membership + world-wide `ZoneDef {name,color,flags}` using the game's `ZONE_FLAGS` taxonomy (the same flags the player-drive loop fires onEnter/onExit from).
- `brush.ts` — shared footprint math (circle/square/diamond) for all painted layers.
- `tileOverrides.ts` (88) — per-cell property **overrides** layered on a cell's kind without changing the kind: `cellKey → {dotted-path → value}`; effective = override ?? kindDefault. The bulk-edit target of the tile selection.
- `placements.ts` (87) — the 'place' layer model: `{id, cat: building|prop|marker, kind, gx, gy, rotation, locked}` with footprint/colour/label **re-resolved from the kind registries** (never stored).
- `mapStore.ts` (189) — map codec: live world ↔ JSON `MapSnapshot`. THE RULE: globals are shared, maps are thin references — tiles persist via a `tileLegend` of kind *names* remapped on load; placements persist as `{id,cat,kind,pose}` only. Buffers RLE-encoded via the shared `@reactjit/workspace` grid codec.
- `projects.ts` (56) — directory-level CRUD over `sessions/*.session.json` (list/exists/delete/name hygiene).
- `editorWorld.ts` (272) — the authoring spine described above; also `emptyEditorWorld()` (game-shaped state with no content), ghost-validity check (`buildingFootprintBlocked`), terrain-aware Y (`landformGroundTopAt` under every placement), marker placement as `placedCells` with save→spawn `spawnKey` links.
- `kindTextures.ts` (64) — GLOBAL per-kind part textures in the shared 'hmsc' store (key `cat:kind` → partId→textureId), broadcast via an IFTTT bus event; folded into instances at preview+compile with instance overrides winning.
- `worldFile.ts` (178) + `assets.ts` (91) + `assetPrompt.ts` — the **other** (future) authoring lane: the world as a hand-editable `.tsx` file importing asset components, placements serialized as JSX tags at spreadsheet addresses; `ASSET_AUTHORING_PROMPT` is the codified contract for AI-generated assets (1 tile = 1m, 2-unit player anchor, Scene3D.Mesh emission). *Not wired to the main editor flow yet — a parallel model awaiting the bake pipeline.*

**game/kinds/ — the kind registries (WO-2 capture, 2026-06-04)**
- `game/kinds/` — the V4 ground-floor data layer, REWRITTEN fresh from the hmsc registries (V17-TRIAGE: capture = rewrite; the old files under `cart/hmsc/` stay untouched behavior references). Five families behind one door (`game/kinds/index.ts`, exported as `GAME_KINDS` through `game/index.ts`): `tiles.ts` (18 kinds; the LOCKED road grammar — lane trios, flow-neutral `junction`, walk-preferred `crosswalk` — with lane flow as table DATA `flow`/`TILE_FLOW_VECTORS`, not a naming convention), `props.ts` (16 kinds borrowing tile bundles), `npcs.ts` (4 kinds + the faction regard matrix), `roles.ts` (the open role axis), `landforms.ts` (4 kinds; every fixed-shape constant lifted into `LANDFORM_TUNING` per P2). Each family ships P4 behavior tests (`*.test.ts`, shared `game/_testkit.ts`, run under `tools/v8cli`); `CAPTURE.md` records what was deliberately not carried (dead door sub-fields, two duplicated fields) and every ambiguity surfaced.

**2D paint surface**
- `PaintCanvas.tsx` (1265, the largest file) — the bottom-left authoring quad. Four layers (paint/height/place/zone) over focused chunks only; each focused chunk is one `<ChunkSurface>`; "+" ghosts on open sides grow the map. Brush input is the cutout pattern: a screen-space `<Pressable>` sibling over the `<Canvas>` (same-node down/move for pointer capture), rails rendered after it to stay clickable. Alt-drag pans; WASD pans via the Canvas `drift*` props when this quad owns WASD focus. Host calls: `__canvas_screen_to_graph` (pointer→graph coords, the same telemetry binding pixel_icon_demo wraps) and `__tel_input` (focused-node check so typing in an input never paints); key state via `__keydown`/`__keyup`/`system:blur` bus.
- `ChunkSurface.tsx` (72) — one chunk = one Effect quad; owns its coalesced GPU buffer (`usePaintedField`) and picks the layer's shader; registers a flush so a stroke re-uploads only its chunk.
- `usePaintedField.ts` (54) — the de-thrash core: brush `touch()`es at input rate (~100/s), encode+upload coalesce to once per frame (rAF/setTimeout-16). Decouples input rate from GPU upload rate.
- WGSL views: `heightField.wgsl.ts` (bilinear height → multi-stop elevation ramp + grid lines), `heightTileView.wgsl.ts` (height tint over tile ground — sculpting keeps tile context), `zoneView.wgsl.ts` (tile ground + translucent zone tint in ONE quad — no Effect-over-Effect alpha), `tileField.wgsl.ts` — **a re-export of the game's `HEIGHTFIELD_TILE_SHADER`** (`render3d/heightfieldSurface`): the editor paints with the very shader the game drapes terrain with. One source; what you paint is what boots.
- `BrushRail.tsx` (215) + `railAtoms.tsx` (173) — the per-layer left rail (tools, tile palette, brush size/shape/profile, height mode brush|ramp with ramp params, zone list) from shared rail atoms (ToolBtn/Swatch/sliders/steppers).
- `chunkFloor.ts` (95) — the painter→preview bridge: each focused chunk becomes a `ChunkFloor` {tileData, heights, hver} with **stable per-chunk identity** (the fix for the preview re-bake choke — rebuilt=1 reused=N−1); `floorsToLandforms` lowers floors to real `'heightfield'` Landforms so the preview and compile use the game's own terrain type.

**3D preview + inspection**
- `IsoPreview.tsx` (200) — free-fly no-clip camera (drag look, WASD fly, Q/E up/down; only while this quad owns WASD focus), fog off, far clip pushed out; world drawn by `WorldStatics` + the full capture family (Landform/Building/Prop/Part surface captures) so floors and facades texture exactly as in-game. Camera pose persists per map and autosaves on settle.
- `PropertiesPanel.tsx` (716) — the top-left **per-instance** inspector: header banner (swatch + bespoke gauges + profile radar drawn with `Graph` primitives) over a dense grouped data strip. Focus precedence: tile *selection* (bulk overrides) > selected placement (one-object world via `objectPreview.ts`) > active paint tile. Face-skin picker shows live mini-renders of real facades (`StaticSurface`).
- `RightPanel.tsx` + `tabs/` — right quad: Objects (breadcrumb browser over building/prop/tile/embedded/marker/assistant categories + `ModelViewer`/`ObjectInspect3D` + shared PropertiesPanel; green + places), Notes (TextArea persisted in the map payload), Chat (`useAssistant` claude_code chat, lazily armed), Settings (grid toggle, layout reset, autosave status).
- `ModelViewer.tsx` (116) — single-object studio viewer: no skybox/fog, OrbitCamera solved cart-side, drag via the global cursor channel, wheel zoom (notes `<Scene3D.OrbitControls>` is a host-side stub).
- `ObjectInspect3D.tsx` (139) — *pickable* viewer: click a part (deck, pillar, panel) to texture it; parts from the game's `buildingParts`/`propParts`; ray from the same solved camera that renders, so picks are exact.
- `objectPreview.ts` — builds a one-object mini-world via the real mutators so inspection resolves identically to the map.
- `TexturePreview.tsx` — one swatch component for both texture kinds (react-authored facade markup vs shader `Effect` with frozen data) — "texture is one concept."

**Routes (under `@reactjit/router`, hot-persistent via `hotKey`)**
- `/` editor · `/log` `LogView` (in-app tail of the perf churn log) · `/textures` `TextureStudio` (155: catalog rail → `ShaderLab` (189: tune named params on a shared base + overlay, **Materialize** freezes data[] into a stored material in the shared 'hmsc' store → joins `allTextures`) · `/assist3d` (below) · `/voxels` `VoxelHybridRoute` (544: a voxel build/mine surface — voxel_stack_demo's pattern grown an export: writes meshes to disk) · `/test` `TestRoute` (197: walk the staged world with a `PlayerFigure` — landform/surface height sampling, the editor's "play test" seam).

**assist3d/ (AI scene authoring)**
- `scene.json` is the single source of truth; `MeshSpec` = raw geometry primitive (6 shapes), deliberately NOT a game kind — bridging into placements is a separate step. Three backends in `backends.ts`: `claude_code` (subprocess **writes scene.json itself** via its Write tool), `openai_compat` and `local_ai` (llama.cpp GGUF) call a `set_scene` tool and the **cart** writes the file (plus a fenced-JSON fallback). `useSceneAssistant` hides the difference; `useAssistScene` watches the file; the Objects tab's ASSISTANT category browses the same file. `picking.ts` — screenRay (same unexported-camera-math duplicate family) + **AABB slab pick, not sphere** (sphere fails for flat slabs: camera ends up inside the bounding sphere). `modelHistory.ts` remembers local GGUF paths.

**Diagnostics**
- `perfLog.ts` (153) — file-backed churn recorder (`/tmp/hmsc-int-churn.log`, debounced batch writes so logging never sits on the paint path; `console.log` never reaches the terminal — severity ring only). `useChurn` probes name which state drove a whole-cart re-render. Self-declared temporary: "rip out once the choke is settled."
- `editLog.ts` (90) — the *semantic* event trace (categorized EditNotes: tile/height/zone/chunk/object/camera/map), capped ring persisted to `sessions/_eventlog.json` (survives hot reload; not in the import graph so writes can't loop), shown in the ProjectBar popover with per-category colours and ~600ms coalescing for continuous edits.

## Host functions vs JavaScript functions

- **Localstore**: `hmscStoreGet/Set` (game-side wrappers over `__store_*`) for the boot key, kind textures, materialized textures. The compile channel.
- **fs**: session files, `_eventlog.json`, churn log, voxel exports, scene.json (cart-write backends), via `__fs_*`.
- **Canvas math**: `__canvas_screen_to_graph` (pan/zoom-aware pointer→graph; `framework/v8_bindings_telemetry.zig`) — here it's *live*, unlike pixel_icon_demo's dead wrapper. `__tel_input` (focused-node id) gates WASD/brush against typing.
- **Canvas camera**: `viewX/viewY/viewZoom` + `driftX/driftY/driftActive` props (host-applied pan, the canvas_view_control_props seam) for alt-drag and WASD pan.
- **Input buses**: `__keydown`/`__keyup`/`system:blur` (key state for WASD + modifiers), `system:cursor:move` (global cursor channel from `SDL_GetGlobalMouseState` — divider drag, orbit drag).
- **AI**: `useAssistant` (claude_code subprocess / OpenAI-compatible HTTP / embedded llama.cpp) for ChatTab + assist3d.
- Everything else is JS/GPU: typed-array buffers, RLE codec, Effect storage buffers, the game's own world mutators.

## Cross-cutting patterns this cart canonizes

- **Author-with-the-game's-own-code** (mutators, renderer, terrain shader, parts lists) as the anti-drift strategy — the strongest statement of it in the repo.
- **Coalesced GPU paint** (`usePaintedField` + per-chunk buffers + stable chunk keys) — the scale answer for brushed surfaces; the stable-identity rule exists because per-rectangle churn *crashed wgpu mid-draw*.
- **Thin-reference persistence** (mapStore's globals rule + name-keyed tile legend) — the multi-map workspace's data philosophy.
- **Workspace pattern, third consumer** (after cutout, composer) — here with v2 payload carrying the whole world, per-map cameras, synchronous `flushCurrent` before map switches, and undo snapshots taken at *action start* (`onEditBegin`) rather than on change.
- **Settle-snap**: native drag streams raw positions, a 140ms quiet timer quantizes to the compile's cell rect — `placementCellRect` is the ONE shared snap across canvas node, preview, and compile.
- **Two texture scopes**: top-left panel = per-INSTANCE; right-rail Objects = per-KIND global (shared store + bus broadcast); merged at preview/compile with instance winning.
- **Diagnostics as modules** (perfLog/LogView/useChurn + editLog) — disposable, file-backed, never on the hot path.

## What is not here / open seams

- `worldFile.ts`/`assets.ts`/`assetPrompt.ts` lane (world-as-.tsx + AI asset generation + bake-to-Zig) is built but not wired into the main flow — it coexists with the GameState lane; the coherence pass must reconcile the two authoring models.
- `AGENTS.md` names `MapCanvas.tsx` (now `PaintCanvas.tsx`) — doc drift inside the cart's own contract.
- Tile **overrides** serialize with the map but runtime consumption game-side is not wired (per the tile-overrides memory).
- assist3d meshes don't bridge into placements yet (deliberate, but the step doesn't exist).
- perfLog is explicitly temporary; the idle paint-spike hunt it served is still OPEN per memory.
- No collaborative/locking story despite parallel sessions editing the same sessions dir (menu refresh-on-open is the only concession).

## Glossary

Chunk: One 120×120-tile unit of the sparse world grid; owns its tile/height/zone typed-array buffers; renders as one Effect quad.

Compile: Persist the staged `GameState` to the shared `'hmsc'/'game-state'` localstore boot key (`saveGameState`) — a deliberate button, not an autosave.

ChunkFloor: The painter→preview snapshot per focused chunk `{tileData, heights, hver}` with stable identity; lowered to real heightfield Landforms by `floorsToLandforms`.

Focused chunks: The subset of chunks currently rendered/edited (focus filter); only these mirror to the preview.

Global cursor channel: `system:cursor:move` — host-pumped global mouse deltas (SDL_GetGlobalMouseState) used for divider and orbit drags instead of per-node mouse-move.

Kind texture: A GLOBAL partId→textureId map stored per `cat:kind` in the shared 'hmsc' store; every instance of the kind wears it unless an instance override wins.

Layer: The active paint mode of the 2D canvas — paint (tiles) / height / place (objects) / zone — deciding rail contents and which WGSL view draws.

Map: One named world project = one session file; thin references into shared registries, RLE-encoded buffers, view + camera + brush + overrides in the payload.

Materialize: Freeze a tuned shader recipe's current params into a named stored material (shared 'hmsc' store) that joins the one texture registry.

Override (tile): A per-cell `{dotted-path → value}` patch on top of the cell's tile kind; bulk-edited across the current tile selection; kind never changes.

Placement: A 2D-authored instance `{cat, kind, pose, locked}`; lowered through the game's own mutators into the preview/compiled world; footprint/label always re-resolved from kind registries.

Settle-snap: Store raw coords while a native drag streams, then quantize to `placementCellRect` after 140ms of quiet — no fight with the host-owned drag.

Tile selection: Pointer-tool click (+ctrl-click) group of cells — the bulk-override focus shown in the top-left panel.

WASD focus: Exactly one bottom quad (canvas pan vs preview fly) owns the WASD keys, claimed by click, persisted per map.

worldRev / viewRev / worldEpoch: Autosave trip counters (stroke edits / camera settles) and the remount key for PaintCanvas on map open.

## The game/ ground floor + compile/verify (added 2026-06-05, Milestone-0 steps 1–2)

`cart/hmsc-int/game/` is the V17 ground floor — `game/index.ts` is the ONLY
door, exporting the 19 standard `GAME_*` names. Live at milestone-0:
GAME_PHYSICS (typed wire wrapper over the honest `__game_physics_*` bindings —
`v8_bindings_game_physics.zig`, re-pointed 2026-06-05 when WO-1 landed; it does
NOT fall back to the legacy `__hmsc_*` aliases, so a missing honest name
surfaces a broken `has-game-physics` gate instead of masking it),
GAME_PATHING (door over runtime/pathing.ts + runtime/motion.ts — still the
`__path_*` names; no honest alias registered yet), GAME_INPUT
(transport only, V7), GAME_CAMERA (the pure side of @reactjit/cameras;
solveCamera extracted to runtime/cameras/solve.ts), GAME_LOOP (clocks only —
NO loop API per R3; the V8 45/min cadence + frame transport), GAME_COMMANDS
(registry + hmsc-dialect parser — the V19 scripting surface), and GAME_KINDS
(the five kind tables, captured by its own lane). The rest export an honest
`{ status: 'capture-pending' }` so the standard import line already resolves.
`@game` is a bundler alias for this directory (cli/cart/bundle.ts) and the
V18 metafile-gate signal. Every family carries a P4 `*.test.ts` beside it
(bundle with tools/esbuild, run under tools/v8cli).

`cart/hmsc-int/compile/` is the V19 skeleton: `rjit game compile` bundles
`compile/main.ts` → `zig-out/game/hmsc-headless.js`; `rjit game verify`
compiles fresh, runs every `game/**/*.test.ts` suite, then boots the output
headless under v8cli and replays every `compile/verify/*.cmds` command
sequence, exiting with one `VERDICT GREEN/RED` line. The milestone-0 world is
a state skeleton (boot / tick / status / help); it grows as captures land —
the green light exists from day one and never goes dark.

## The labs route + scaffold (added 2026-06-05, Milestone-0 step 3)

`cart/hmsc-int/labs/` holds the experiment slots (V13/V17/P5): `_scaffold.tsx`
(+`_scaffold.notes.md`) is the template `rjit lab new <name>` copies — a lab is
`@game` imports + an exported scene, nothing else, with the paired
`<name>.notes.md` as its P6 contract (read by humans, AI, and the oracle).
`labs/index.ts` is the registry the CLI maintains at its `rjit:` markers.
`cart/hmsc-int/shell/LabsRoute.tsx` is the first shell/ piece — the `/labs`
route (ProjectBar FlaskConical button): lab list on the left, the loaded scene
center, the notes always beside it. Shell stays game-agnostic: the lab list
crosses in as plain data at the router. The remaining index.tsx→shell/
inversion is the editors-capture lane.

## The data/ persistence layer (added 2026-06-05, Milestone-0 step 4)

`cart/hmsc-int/data/index.ts` is the V20 layer — `openStore(rootDir)` is the
only door. Per-concern append-only streams (`data/streams/<name>.jsonl`), one
TOTAL cross-session undo chain (a global sequence number across all streams;
an undo point is a log position — `stateAt(seq)` reads as-of, history is never
rewritten), and materialized snapshots (`data/snapshots/<name>.snapshot.json`,
stamped with their chain position) — the game/compile loads snapshots, never
history. The incompleteness guard is in the API: `defineStream` demands the
log name AND the materializer (initial+apply) in ONE registration — a stream
without snapshot support cannot be expressed. Stream/snapshot CONTENT is
gitignored (the content time machine); backup story = `store.exportBackup()`
(streams + manifest) or tar of `data/streams/`. Host gap flagged: no
`__fs_append` binding yet, so appends are read+concat+write (semantically
append-only; the reader tolerates a torn trailing line). P4 suite
`data/data.test.ts` rides `rjit game verify` (suite roots: game/ + data/).
