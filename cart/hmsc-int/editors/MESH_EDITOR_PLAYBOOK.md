# Studio — Blockbench-class modeling, in house

> **NAME (USER, req_0950): the tool is `Studio`.** Working title for the whole
> editor and the host viewport primitive alike.
>
> **DESIGN GATE — future tools are designed, not ad-hoc'd (USER, req_0950).**
> The tools AFTER the first slice — extrude (edge/face), create face, create
> edge, loop cut, inset/bevel, UV unwrap + the UV-edit ops — must each have
> their *interaction model* AND *pure data-op shape* deliberately designed and
> confirmed with the user BEFORE implementation. Do NOT bolt them on inline as
> they come up. When the first slice lands and one of these is next, STOP and
> spec it here first (the same way the camera/compass/gizmo/auto-fix got specced
> across req_0942–0949). This remark is the reminder to come back and confirm
> their shape.
>
> **BUILD LOG.**
> - ✅ **Increment 1 — EditMesh keystone (done, verified — 9/9).**
>   `cart/hmsc-int/editors/model/editMesh.ts` + `editMesh.test.ts` (9/9 pass via
>   `tools/esbuild … --alias:@reactjit=$ROOT/runtime` → `tools/v8cli`). Ships:
>   the `EditMesh` type (shared verts + n-gon quad-friendly faces; optional
>   uv/material designed in, unused in v1), **`MountPoint` typed connectors +
>   `mountsCompatible` (the Lego seam, Part 0 — part-of-the-data per req_0952)**,
>   `editMeshToGeometry` (fan-triangulate + Newell normals → `GeometryData`),
>   `meshEdges`/`faceNormal`/`faceCentroid`, `cuboid`/`cylinder` constructors
>   (origin-centered, outward-wound), and the concave Auto-Fix guard
>   (`isFaceConcave`/`findConcaveFaces`/`splitQuad`/`splitConcaveFaces`). Approach
>   for the viewport = **B** (extend `Canvas`'s host view-control into 3D).
> - ⏭ **Composition/assembly layer — DESIGN-GATED, not built.** Seating a child
>   part's plug into a parent socket → assembled whole → bake. The generalization
>   of the rig builder to vehicles/props; spec before building.
> - 🔎 **Survey finding (req_0957) — the host already owns camera + render, no JS.**
>   The `/compiled` path (`tools/rjit game play`) proves it. **`framework/game/camera.zig`
>   (V23) is a complete host-owned orbit camera**: `Mode.orbit`, `OrbitParams`,
>   `solveOrbit`, a `Controller` with per-frame solve + smoothing + distance
>   constraint + **`applyInputDeltas(yaw,pitch)`**, binding a Scene3D.Camera node.
>   JS only transports input deltas; the host solves every frame — **this IS the
>   buttery host-owned camera**, and `sculptCamera.ts` already drives it via
>   `GAME_CAMERA`. `gpu/3d.zig` already renders meshes host-side. So the "Studio
>   host primitive" REUSES these, it does not re-build a camera/render system.
> - ✅ **Increment 2 — the `<Studio>` viewport (landed, hot-reload, wired — req_0958).**
>   `editors/model/Studio.tsx` (`StudioViewport` + `StudioRoute`) + `editors/workbench/model/source.tsx`
>   (`modelSource`), wired into `editors/workbench/sources.ts` as the **STUDIO** tab.
>   Renders the cuboid EditMesh via Scene3D's **dynamic-geometry path** (a
>   `{id,generate,defaults}` def + `dynamicKey` — live verts, no rebuild) on a 1m
>   ground grid + origin axes, **host-owned orbit camera** driven through
>   `GAME_NATIVE_CAMERA.forNode` → `setOrbit`/`setInputDeltas` (camera.zig orbit
>   Controller — mirrors the proven VoxelStage pattern), Blockbench-ish boot
>   framing, a `STUDIO` P2 tunables table (`/model`, registered) + fov knob +
>   reframe. Verified: editMesh 9/9; Studio.tsx and the full `sources.ts` chain
>   bundle clean. Solid only; **hot-reloadable now (no rebuild)**.
> - ✅ **Increment 3 — BLANK SLATE + the OUTLINER (the layers component) — req_0961/0962.**
>   The scene is now a LIST of EditMesh PARTS (`editors/model/studioModel.ts`
>   `useStudioModel` — parts + activeId + revision; add / duplicate / reorder /
>   rename / delete / visibility), and the Studio **boots EMPTY** (grid + axes,
>   no mesh — the user: "start with an empty grid no mesh on it at all"). The
>   **outliner IS the paint editor's `LayerStackStrip`** (`editors/model/Outliner.tsx`
>   maps parts → `LayerStripRowModel[]`, wires the row verbs + +add) — no bespoke
>   layer list (PAINTLAYERS-0606). `StudioEditor` docks the outliner beside the
>   multi-part viewport; +add drops a 1 m cuboid (the shape dialog is next). The
>   workbench STUDIO tab + `StudioRoute` both mount `StudioEditor`. Bundle-clean,
>   hot-reloadable.
> - ✅ **Frame diagnostics + camera-angle trace — req_0963/0964.** A host-accurate
>   frame-drop readout (`editors/model/frameProbe.ts` reads the host per-frame
>   ring `__tel_history` + `__tel_frame`, so a HARD skip during a spin shows up in
>   worst/peak even after the 1 s fps average recovers; gc-ms vs present-ms split
>   names the culprit — reuses the `useTelemetry`/perfWatch telemetry door) + an
>   opt-in `[studio-cam]` `console.warn` trace of the COMMANDED yaw/pitch + the
>   inter-event gap on every drag event (so one smooth physical drag reveals
>   bursty input vs a present stall). Both toggle from the viewport corner.
> - ✅ **Spin-feel hunt — DIRECT camera, not smoothing — req_0963→0968.** The user
>   felt the orbit "skip" while spinning. Built host-accurate diagnostics
>   (`frameProbe.ts` over `__tel_history`/`__tel_frame` + the `__game_camera_probe`
>   door) and a coalesced `[studio-cam]` angle trace. The data cleared every
>   framerate suspect: **240 fps solid, camera steps at 240 Hz (`camHz=240`), 0
>   GC (0 fired), 0 dropped frames** — and the user's own clue sealed it
>   (Blockbench feels smooth at *112* fps). The culprit was the host camera's
>   smoothing ease (`camera.zig` default `smoothing_per_second=24` ≈ 42 ms
>   lag/momentum); Blockbench tracks input 1:1. Fix: the Studio camera now
>   defaults to **`cameraSmoothing=0` (direct)** via `ctl.setSmoothing(0)`, with a
>   live `smooth:` cycle (direct/24/80/160) to dial it — confirmed "way better".
>   Lesson: for a direct-manipulation modeling camera, default to NO smoothing;
>   render fps was never the problem. Diagnostics default quiet (logs opt-in via
>   `log cam`), kept in place for recurrence.
> - ✅ **View-orientation compass (Part 4b #1) — req_0969.** The Blockbench
>   navigation gizmo: a corner widget (`ViewCompass` in `Studio.tsx`) that projects
>   the ±X/Y/Z axis ends through the live view basis (forward from camera.zig's
>   orbit convention; right/up complete it), so it always shows the camera's
>   orientation, and **clicking an axis ball snaps the view to face it** (eased
>   shortest-path yaw turn via `faceAxis`; poles keep current yaw; a generation
>   token cancels the tween if you grab the camera). Positive ends are bright +
>   labeled, negatives dim, depth-sorted for occlusion. 2D projection for now
>   (hot-reload); graduates to the host screen-stable overlay alongside the
>   transform gizmo. Self-ticks at 30 Hz, isolated from the Scene3D tree.
> - ✅ **Face / edge / vertex selection (Part 4 #5) — req_0970.** A PERSISTENT
>   mode toggle (USER: Blockbench-style, not select-pick-reset) — object / vertex
>   / edge / face, each keeping its own selection set (`editors/model/meshSelect.tsx`).
>   Overlays are 2D but projected through a JS replica of the host pipeline
>   (`makeProjector` = `m4lookAt`+`m4perspective` from gpu/3d.zig, eye from
>   camera.zig `orbitalEye`), so dots/lines sit on the rendered mesh and draw on
>   top (back elements pickable, like Blockbench); screen-right works out identical
>   to the confirmed compass `R`, so handedness matches the render. Picking is
>   screen-space nearest in the viewport `onMouseDown` (vertex = nearest dot,
>   edge = nearest segment, face = point-in-projected-polygon, frontmost).
>   **Interaction (USER req_0977/0978):** a HIT changes the selection and does NOT
>   orbit (can't spin by dragging on an element); a MISS leaves the selection
>   ALONE and orbits — so dragging off in empty space spins WITHOUT deselecting.
>   Deselect comes ONLY from picking a new element (plain click = replace) or
>   **Esc** (clears all). **shift OR ctrl = add/toggle** (group multiple). Overlay
>   self-ticks 30 Hz, isolated from the Scene3D tree; selection resets when the
>   active part changes. **Next: the transform gizmo to MOVE the selection** (still first-slice;
>   then the design-gated edit ops).
> - ✅ **Add-mesh dialog + the 16-unit model (Part 4 #3) — req_0972/0973.** The
>   outliner's +add opens a dialog (`AddCubeDialog` in `Studio.tsx`): pick the
>   cube's **diameter** (= width = depth) and **height** and confirm. Units are
>   **Blockbench "pixels": 16 units = 1 tile = 1 m** (`STUDIO.unitsPerTile=16`,
>   `unitsToMeters`), and the center tile's fine grid is now **16×16** to match —
>   so the default 16-unit cube fills exactly the center tile, and the same 16-
>   unit basis is what per-face UV/texels will use (the user's reason for the
>   convention). Adding does NOT touch the grid (it's the ruler). `studioModel`
>   gained `addCube(diameterM,heightM)` + a per-part `version`. **Also fixed a
>   crash:** the `placed` memo had dropped the `~<version>` from the Scene3D.Mesh
>   `dynamicKey` (host drops the mesh / throws) — now `studio.<id>~<version>`.
> - ✅ **UI cleanup + LIVE UV preview (Part 3 Phase 3 foundation) — req_0981.**
>   Two legs. **(1) Viewport UI** (`Studio.tsx`): the OUTLINER (layers) now docks
>   on the **RIGHT** of the viewport (`StudioEditor`); the FRAMES diagnostics +
>   the smooth/log/fps levers folded into **ONE thin top-right toolbar**
>   (`FrameDiagBar` replaces the tall `FrameDiagOverlay`/`DiagLine`); fov + reframe
>   stay bottom-right; face/edge/vertex stays top-center; compass bottom-left.
>   **(2) Live UV in workspace column 3** (the panel): the read-only UV atlas
>   FORMED FROM the live mesh. `unwrapMesh(mesh, unitsPerMeter)` in `editMesh.ts`
>   is a pure box-projection by dominant face normal, sized on the **16-units
>   basis** (a face N units wide → N texels), shelf-packed into one atlas (3 new
>   tests, **12/12**). `editors/model/UVPanel.tsx` (`StudioUVPanel`) draws the
>   packed face rects (tinted X red / Y green / Z blue) + the projected corner
>   loops, recomputed on the active part's `version`. To reach column 3 the
>   studio model became a **shared module store** (`studioModel.ts` — `useStudioModel`
>   subscribes; one source of truth for col 3 + col 4), and the panel renderer
>   gained a minimal **`t:'node'`** field (the live-visual escape hatch in
>   `shell/fields.tsx`) so `model/source.tsx`'s `panel()` hosts `<StudioUVPanel/>`.
>   `editMeshToGeometry` still pins UVs flat (no textured display mode consumes
>   them yet — baking real per-face UVs is the follow-up). Hot-reload TSX.
> - ✅ **Transform gizmo — MOVE + RESIZE (Part 4 #5, the last first-slice piece) — req_0983.**
>   The Blockbench move/resize tool: red/green/blue (X/Y/Z) handles anchored on
>   the selection's "best center" (vertex itself / edge midpoint / face center /
>   centroid of a multi-select), drawn as a 2D overlay through the meshSelect
>   projector so the arrows are **NEVER hidden by geometry** (USER hard rule —
>   always on top). Pure ops in `editMesh.ts`: `vertsCentroid`/`vertsHalfExtent`/
>   `translateVerts`/`scaleVerts` (3 new tests, **15/15**). `meshGizmo.tsx` holds
>   the overlay (`TransformGizmo`: arrows for MOVE, square handles + a center hub
>   for RESIZE), the handle hit-test (`pickGizmoHandle`), the selection→verts
>   gather (`selectionVertIndices`), and the screen-drag→world mapping
>   (`axisScreen`/`dragWorldDistance`, frozen at mouse-down so perspective at the
>   anchor is honored). Viewport (`Studio.tsx`): a `move|resize` toggle joins the
>   element toolbar; `onDown` checks the gizmo BEFORE pick/orbit; a drag mutates a
>   viewport-local **draft** (re-lowered live, only the dragged part) and commits
>   to the store on mouse-up, running the **concave Auto-Fix guard**
>   (`splitConcaveFaces`) on commit — the commit-on-release pattern (no per-move
>   store write). Per-part `lift` is now FROZEN at mint (studioModel) so editing
>   verts never makes the part slide to re-seat; a `meshRev` counter re-lowers the
>   committed geometry WITHOUT refitting the camera (separate from `revision`).
>   The Auto-Fix currently auto-splits (the recommended action) — the
>   Revert/Ignore dialog is a later refinement. **First slice is now complete.**
> - ✅ **Loop cut (design-gated edit op #1) — req_0984/0985/0989/0990.** The
>   Blockbench loop-cut tool: select a face → "loop cut" → a small popup (Direction
>   / Cuts / Offset / Unit) previews live and commits on Apply. Pure ops in
>   `editMesh.ts`: `cutMeshByPlane` (general axis-aligned planar split — splits
>   every crossed face, interns shared ring verts, leaves the parallel caps),
>   `loopCutPositions`, `loopCut`, and face tags that survive a cut
>   (`tagOneFace`/`facesWithTag`/`clearFaceTags`). **19/19**. Mechanics, nailed
>   over several side-by-sides with the user: **the cut SPLITS the selected face**,
>   so the cut axis is one of the face's two IN-PLANE axes (NOT its normal — that
>   was a wrong turn that left the face whole); **Direction 0/1** picks which
>   in-plane axis; **Offset** default = size/2 (centered, =8 for a 16-cube), raising
>   it shrinks the kept −side half (interior slabs stay equal); **Unit** = Size
>   Units | Percent. The clicked face is **tagged**, the tag rides through the cut,
>   and on Apply the selection persists onto the kept −side half (`lcKeptFace`) —
>   the face visibly halves and stays highlighted, exactly like Blockbench. The
>   live preview rides the **draft** path (no per-keystroke store write); ✕ cancels.
>   Built on the box case; general-mesh edge-loops are a later step.
> - ✅ **Workspace branch/twig history — the Studio joins V20 persistence (req_0991/0993).**
>   The scene was IN-MEMORY ONLY (a reload wiped it, no undo). It is now a
>   PROJECTION of a new V20 per-concern stream, `editors/model/modelStream.ts` —
>   a **PARTS LIBRARY, independent of the map project** (USER req_0993: "build it
>   as a parts library… not associated with [the map]"), modeled on the painter's
>   `editors/cutout/stream.ts` (the user's pointed-to example): a dumb-upsert
>   materializer carrying each part's serialized `EditMesh` + presentation
>   (`StoredPart`), order-aware events (`partAdded`/`partMeshUpdated`/`partRenamed`/
>   `partVisibilitySet`/`partReordered`/`partRemoved`), unknown kinds pass through
>   (V20 schema-by-addition). `studioModel.ts` now opens ONE route session
>   (`editorSessions().open('/studio', editorChannel(modelStream))`, the vehicles/
>   painter idiom) and every mutator commits one content event + a labeled marker
>   on the one cross-session chain — so **parts survive a reload AND each edit is a
>   labeled undo point**. The store became a stream PROJECTION (geo memoized per
>   `(id, version)`); the active part rides the **twigs** file (`/studio` route),
>   NOT the undo chain. **Undo/redo** APPEND inverse events (V20: the log is never
>   rewound) via a local inverse stack — wired to **Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z)**
>   in `StudioEditor` (bus `__keydown`, TextInput-safe) plus a visible **↶ Undo /
>   ↷ Redo** control top-left of the viewport. When the store is unavailable (P4
>   bundling / a corrupt stream) the model falls back to a pure in-memory fold so
>   the viewport never crashes. Tests: new `editors/model/modelStream.test.ts`
>   **4/4** (round-trip save→stream→snapshot→cold-reopen, order ops, unknown-kind
>   passthrough, inverse cancels its forward edit); editMesh **19/19** regression
>   clean; `Studio.tsx` + the full `sources.ts` chain bundle clean. Hot-reload TSX
>   (no rebuild). **Follow-up:** twig the viewport tool-state too (selMode/gizmoTool/
>   smooth/camera — currently component `useState`); the parts library has no
>   compose/place-into-a-map consumer yet (that's the composition layer).
> - ✅ **Phase 5a — UV as stored, stable data (req_0997).** The `req_0981` UV
>   preview was wrong: `unwrapMesh` re-projected from the LIVE mesh every render, so
>   the atlas mutated on every vertex/edge edit (Blockbench's never does). Fixed at
>   the data layer per Part 5.1: `EditMeshFace.uv` is now NORMALIZED [0,1] per-corner
>   STORED data (type `V2[]`). New `unwrap(m)` box-projects + packs ONCE and writes
>   `face.uv`; `cuboid()`/`cylinder()` call it at mint, so a fresh part is already
>   unwrapped. `cutMeshByPlane` interpolates new-corner UVs along the cut (so a cut
>   subdivides WITHIN the parent island, and shared cut verts drop boundary notches
>   on neighbors for free); `splitQuad` carries UVs; `editMeshToGeometry` passes
>   real per-corner UVs through (textured mode can sample). Geometry edits
>   (`translateVerts`/`scaleVerts`, the gizmo) NEVER touch `uv`. The panel
>   (`UVPanel.tsx`) reads `storedUVLayout(mesh, texSize=STUDIO.unitsPerTile)` — the
>   fixed 16×16 square, stable under moves — instead of the live projection, with an
>   **Unwrap** button to re-derive on demand (the only time it recomputes).
>   `unwrapMesh` stays as the on-demand projection generator. Tests: editMesh
>   **24/24** (+5: fresh cube is unwrapped, a vertex move leaves UVs byte-identical,
>   a cut's new corner UV = the edge lerp, `storedUVLayout` invariant under a move,
>   re-unwrap rewrites from geometry); modelStream 4/4 regression; UVPanel + full
>   `sources.ts` chain bundle clean. Hot-reload TSX. **Next sub-piece (5a):**
>   selection-scoped display — show the SELECTED face's island (Part 5.2), which
>   needs the viewport's face selection lifted into the shared store. Then 5b (one
>   square atlas + guide export), 5c (paint the atlas), 5d (image-to-image).
> - ✅ **Persistence redo — boot-to-new + a model LIBRARY (req_0998/req_1000/req_1001).**
>   The req_0993 shortcut (the live scene WAS the stream → auto-restored on cold
>   start) was wrong. USER LAW ([[feedback_studio_branch_twig_cold_hot]]): cold
>   start → 'new' (blank); BRANCH = persisted + undoable per-model (every mesh edit);
>   TWIG = working-state (camera/tool/selection/which-model-open), hot-reload-only,
>   never undone, reset cold. Mechanism: `hotstate.zig` is in-process (survives V8
>   re-eval, cleared on restart) — new imperative `getHotState`/`setHotState`
>   (runtime/hooks) hold the open-model twig. `modelStream` restructured to a
>   LIBRARY of saved models (each `{id,name,parts,order}`, events scoped to their
>   `model` — the map-editor mapName idiom); `studioModel` is now a working scene
>   over ONE open model, boots to 'new', auto-creates+names a model (`new_mesh_NNN`)
>   on first add, branch-scoped undo. The workbench roster (`model/source.tsx`) is
>   the library: a `+ new` row + saved models; `onPick` opens; new shell hook
>   `selectedRow()` makes the roster highlight follow the store (the open model),
>   not the shell's disk twig — so it reads 'new' on cold start. Rename via the
>   MODEL panel name field. **Crash fix (req_1001):** the old flat-parts snapshot
>   shape made selectors read `undefined.models` → reducer + selectors normalize/
>   guard, discarding the pre-req_0998 shape (boot-to-new wants it gone). Tests
>   modelStream **6/6** (library, per-model isolation, order, passthrough, inverse,
>   old-shape tolerance). **DEFERRED (the twig other half):** camera/tool/selection
>   survive a hot reload (hot-state) — still `useState`, so they reset on hot reload
>   for now; the open-model already survives.
> - ✅ **KEY CORRECTION — the UV MESH ≠ the TEXTURE (USER req_1004).** I had fused
>   two steps. (1) The **UV mesh** (the mapping, what the UV editor shows): a base
>   cube maps EVERY face to the FULL unit square — click any face, you see the whole
>   16×16 outline, because every face samples the entire texture. `fullFaceUV(m)`
>   (each face's own projection normalized to fill [0,1]²) is the default;
>   `cuboid()`/`cylinder()` use it. (2) The **texture** (the box-net, image 89): a
>   DOWNSTREAM artifact made by "create texture" — it packs the faces into atlas
>   regions AND remaps their UVs. That is `unwrap()` (the box-net packer from
>   req_1002, kept) and is **Phase 5c**, NOT the default. The box-net work (req_1002)
>   and the "fill the square" idea (req_1003) were both this confusion — they belong
>   to 5c. The panel's button is now **Reset UV** (`fullFaceUV`), not Unwrap.
> - ✅ **Part 5.2 — SELECTION-SCOPED UV + loop-cut coherence (req_1005).** Blockbench
>   shows the SELECTED face's island: full square on a base cube, HALF-square after a
>   loop cut (the cut splits the UV with the geometry, coherent UV→texture). Our
>   `cutMeshByPlane` already interpolates the UVs (so a cut halves the island — the
>   data was right), but the panel showed ALL faces overlapping. Fixed: the viewport
>   publishes its face selection to the shared store (`studioModel.selectedFaces`, set
>   by a `StudioViewport` effect on `sel`/`selMode`); `UVPanel` scopes to it — show
>   the selected face's island, else the whole atlas. editMesh **25/25** (the cut-lerp
>   test proves coherence). **Remaining:** 5c create-texture (box-net image + remap +
>   paint), 5d image-to-image; per-face orientation parity.
> - ✅ **Loop cut on a SUB-FACE — the cut span is the selected face (req_1009).** A
>   second loop cut on an already-cut half was invisible (mesh/UV/selection all
>   unchanged). Cause: `loopCutAxisInfo` measured the cut span from ALL mesh verts
>   (the whole 16-unit cube), so a cut on an 8-unit half used the 16-unit range with
>   offset 8 → the new plane landed exactly on the FIRST cut's plane → no-op. Fix:
>   the span is now the SELECTED FACE's loop verts; new `loopCutRange(m,axis,lo,hi,
>   cuts,offset)` cuts within that explicit span (`loopCut` calls it with the whole
>   mesh for the bare cuboid). editMesh **26/26**. **Known remaining difference:**
>   `cutMeshByPlane` still splits the whole loop at the plane (the parallel faces);
>   Blockbench confines a loop cut to the single selected face — the next refinement
>   (a single-face cut) if exact parity is wanted.
> - ✅ **DYN-slot exhaustion — 'no highlight after several news' (req_1008).** The
>   host has **48 `DYN_SLOTS`** (framework/gpu/3d.zig) allocated by key-hash and
>   NEVER freed; once full, new dynamic meshes are DROPPED. The Studio gave every
>   part + its highlight + the drag-draft a PER-PART `dynamicKey`, so each part/model
>   ever created over a session permanently burned slots → the highlight (allocated
>   last) dropped after enough `new`+add churn; a restart reset the pool. Fix
>   (TSX-only): parts key by **render index** (`studio.s<i>~<id>.<ver>` — id-hash
>   bounded + reused), the draft uses ONE fixed slot (`studio.draft`), the highlight
>   ONE fixed slot (`studio.hi`). Studio dyn-slot use is now (parts in the open
>   model)+2, reused across the session — never exhausts. See [[project_host_camera_ray]].
> - ✅ **Loop cut — re-center the offset when the direction (axis) flips (req_1010).**
>   After 4 cuts along X (each on the kept sub-piece), the sub-face is ~1 unit wide
>   on X but still 16 units tall on Y. Switching the popup's Direction to Y kept the
>   STALE offset (~1, computed for the narrow X axis) and applied it to the 16-unit Y
>   axis → the "first" vertical cut landed near the top EDGE, reading as the 5th slice
>   of an ongoing vertical sequence instead of a single centered cut. `lcAxisInfo`
>   already recomputes the axis/span per `dir`, but the `offset` in `lc` state was
>   only seeded once at popup-open. Fix (TSX-only, `Studio.tsx` LoopCutPopup
>   `onChange`): when `patch.dir` changes the axis, RE-CENTER the offset on the new
>   axis (`round(info.sizeUnits/2)`, or 50 in percent mode) in the same `setLc` update,
>   so the live preview + Apply both use the centered value. The pure ops
>   (`loopCutRange`/`loopCutPositions`) were already correct given a right offset — the
>   bug was UI offset bookkeeping. New editMesh test reproduces "4 cuts on X then 1 on
>   Y lands centered (halves at ±0.5)": **editMesh 27/27**, modelStream 6/6.
>   **Known remaining difference (unchanged):** `cutMeshByPlane` still splits the whole
>   loop (the parallel faces); Blockbench confines a loop cut to the single selected
>   face — the next refinement (single-face cut) for exact parity.
> - ✅ **Loop cut — the popup/preview no longer bleeds across models (req_1011).** The
>   loop-cut `lc` popup state + its preview `draft` are transient `StudioViewport`
>   `useState`. Selection already reset on `activePart?.id`, but `lc`/`draft` did NOT,
>   and the preview effect keyed on `[lc, activePart?.id]` — so opening a model,
>   half-opening a cut, then clicking `+ new` (→ a fresh part) re-ran the preview on
>   the NEW part with the stale face index, re-drawing phantom cuts + re-opening the
>   popup. Fix (TSX): the preview effect keys on `[lc]` ONLY (a popup is bound to one
>   face of one part — switching parts must CLOSE it, never re-preview), plus a reset
>   effect on `[activePart?.id]` tears down `lc`/`draft`/`activeGizmo` whenever the
>   active part changes (select-another / switch-model / new). Bundle-clean.
> - ✅ **Removed the "Reset UV" button (req_1013).** The UV panel carried a "Reset UV"
>   button (`fullFaceUV(part.mesh)` — remap every face to the full unit square). The
>   user never asked for it and "resetting the mapping to the default" is not a step in
>   the authoring flow — it confused more than it helped (req_1012 was the user asking
>   what it even did). Removed both instances (header + the no-faces fallback) from
>   `UVPanel.tsx`; the panel is now a pure READ-ONLY view of the stored UVs. `fullFaceUV`
>   stays in `editMesh.ts` (it's the default UV applied at `cuboid()`/`cylinder()` mint,
>   still tested) — only the button is gone. The real UV authoring (box-net "create
>   texture" + per-island edits) remains the design-gated Phase 5c work. Bundle-clean.
> - ✅ **Face-selection dots were off by the part lift (req_1014).** In face mode the
>   centroid dots sat half a model-height low — the top-face dot at the model center,
>   the bottom-face dot a half-height below the model. `SelectionOverlay` (meshSelect.tsx)
>   added the part's render `lift` (parts sit ON the grid, so an origin-centered cube
>   lifts by half its height) to the projected VERTS but projected the face CENTROID
>   from un-lifted local space. Fix: bake the lift into the projector ONCE
>   (`proj = (p) => baseProj([p[0], p[1]+partLift, p[2]])`), so verts, edges, and dots
>   all share it and can't drift — the same one-lift-point pattern the picking path uses.
>   Bundle-clean; 2D overlay projection, no headless test.
> - ✅ **Extrude (design-gated edit op #2) — req_1015.** Specced from the user's
>   Blockbench side-by-side. THE key distinction the user drilled: the **extrude OP**
>   changes UV, but **pulling the cap in/out does NOT** — because the in/out is just a
>   vertex move, which our gizmo (`translateVerts`) already never lets touch `uv`. So
>   extrude is a pure TOPOLOGY op and the shaping reuses the existing move gizmo.
>   `extrudeFace(m, faceIndex, distance)` in `editMesh.ts`: copy the face's boundary,
>   offset the copy along the face normal by `distance`, **CAP** it with the moved face
>   (the cap REPLACES the original at the SAME index → the selection follows it, "the
>   face stays selected"), and **BRIDGE** the old boundary to the cap with side-wall
>   quads wound outward (Newell-normal vs face-centroid test). UV rule (the user's two
>   truths): the cap **inherits** the original face's UV (the end keeps its texture);
>   each new side wall gets the **default full-square UV** (`faceSquareUV`, extracted
>   from `fullFaceUV` so the default mapping lives in ONE place — rule of two). A
>   NEGATIVE distance insets (the cavity in the user's image). Studio: an **extrude**
>   button (face mode, 1 face selected, beside loop cut) commits a thin default lip
>   (`STUDIO.extrudeMeters = 1/16 m` = Blockbench "Extend 1") + sets the gizmo to move,
>   so the user immediately drags the cap in/out — pull out = longer box, pull in =
>   inset, NEITHER changes UV. editMesh **31/31** (+4: caps+walls/index, UV inherit +
>   outward walls, in/out drag leaves all UV identical, negative = inset); Studio.tsx
>   bundles clean. Hot-reload TSX. **Follow-ups:** an Extend/Direction popup for numeric
>   precision (Blockbench shows one alongside the gizmo); extrude on a non-axis-aligned
>   / general face; extrude edge.
> - ✅ **Concave Auto-Fix is now LOUD — the alert dialog (req_0949 finished, req_1016).**
>   The guard's DETECTION (`findConcaveFaces`/`isFaceConcave`) and FIX (`splitConcaveFaces`)
>   existed and ran on every gizmo commit — but SILENTLY auto-triangulated, with no alert
>   (the req_0949 Revert/Ignore dialog had been deferred). That violated the loud-not-silent
>   rule: an illegal (reflex/non-convex) edit was fixed behind the user's back. Now `onUp`
>   runs `findConcaveFaces` on the released mesh; a clean edit commits straight through, but
>   if any face buckled it does NOT commit — it keeps the buckled mesh PREVIEWED (the draft)
>   and raises `ConcaveFixPopup`: **Split Quads** (recommended → `splitConcaveFaces`) /
>   **Ignore** (commit it concave) / **Revert** (commit nothing — the store still holds the
>   pre-edit mesh, since we only commit on release). The gizmo is hidden while the dialog is
>   open; `autoFix` resets on active-part change (like the loop-cut transient state, req_1011).
>   editMesh **32/32** (+1: a dragged corner buckling a cube face is flagged, and Split Quads
>   clears it — the exact gizmo trigger). Studio.tsx bundles clean. Hot-reload TSX.
> - ✅ **Loop-cut SLIDE gizmo (req_1022).** Blockbench shows a move gizmo ON the cut so
>   the offset is dragged on the model, not just typed. Added it: while the loop-cut popup
>   is open a `TransformGizmo` (move) is drawn at the cut plane (`lcGizmoAnchor` = the
>   selected face's centroid pinned onto the middle cut plane via `loopCutPositions`).
>   Dragging the CUT-AXIS arrow drives `lc.offset` — `dragWorldDistance` → world metres
>   along the axis, negated (a higher offset shrinks the −side end, so +axis drag lowers
>   the offset), converted to the popup's unit and clamped; the live preview + the anchor
>   follow each drag. A dedicated `lcDragRef`/`lcDragAxis` (separate from the vert gizmo's
>   `gizmoDragRef`); onDown checks the slide handle before falling back to orbit (only the
>   cut axis is live — other arrows orbit); onUp drops the drag (Apply still commits the
>   whole cut). The popup's Direction/Cuts/Offset/Unit stay (the gizmo just adds on-model
>   offset control). Cleared on close + active-part change. Studio + sources bundle clean.
>   Hot-reload TSX.
> - ✅ **Gizmo stepping — stepped by default, never freeform (req_1023).** USER: every
>   gizmo drag should SNAP — no modifier = whole modeling units, **Shift = a finer step**,
>   **Alt = freeform** (no snap) — across the board (it was all freeform). One module
>   helper `snapToStep(value, step, fine, mods)` (Alt → unchanged; Shift → fine; else step)
>   drives every drag: the vertex/edge/face **move** snaps the translation distance; **per-
>   axis resize** snaps the RESULTING half-extent (so sizes land on whole units); **uniform
>   (center-hub) resize** snaps the scale FACTOR (`gizmoUniformStep`); and the **loop-cut
>   slide** (req_1022) snaps its world delta. Steps live in the `STUDIO` P2 table —
>   `gizmoStepMeters = 1/16` (1 unit), `gizmoStepFineMeters = 1/64` (¼ unit),
>   `gizmoUniformStep/Fine = 0.1/0.05`. Modifiers read live from the `heldMods` key bus
>   (tracks keyup, so Shift/Alt change mid-drag). Studio bundles clean. **This closes the
>   first design-gated edit-ops slice (loop cut, extrude, delete, select-all, concave alert,
>   slide gizmo, stepping).** Hot-reload TSX.
> - ✅ **Live gizmo drag readout (req_1024).** A small tooltip floats by the gizmo anchor
>   while dragging, showing how far the active gizmo has moved IN MODELING UNITS, so the
>   amount can be read off and MIRRORED on the other side for parity (no mental tracking).
>   `gizmoReadout` state set in onMove, cleared on up / close / part-change: move → "X +3u"
>   (axis + signed units via `metersToUnits`+`fmtUnits`), resize → "X Δ+2u" (the half-extent
>   delta), uniform → "⤢ ×1.20" (factor), loop-cut slide → "cut +1u". Positioned by
>   projecting the active anchor (`lcGizmoAnchor` when cutting, else `gizmoAnchorWorld`)
>   through the meshSelect projector, offset up-right. Studio + sources bundle clean. Hot-reload TSX.
> - ✅ **Pivot points + joints (req_1025) — the `rig` mode (Part 6).** USER model
>   (confirmed side-by-side): pivot + joint are ASYMMETRIC and live on different
>   parts — **pivot** on the child (its rotation origin + "here is where I connect,
>   everything downstream follows the joint"), **joint** on the parent (owns the
>   spin `axis` AND the rotation `limit`: "90° forward, 90° back" = 180° of travel,
>   or **full** for tires). A part can be both, and they NEST (a wheel is a pivot on
>   the body's axle joint AND a joint for a spinner). **Data layer (landed + tested):**
>   `EditMesh.pivot?: V3` (absent = bounds center, sticky once set — never moved by
>   geometry edits, like `uv`); `MountPoint.limit?: {full?,min?,max?}` +
>   `jointTravelDegrees`; pure helpers `meshBoundsCenter`/`pivotOf`/`setPivot`/
>   `addMount`/`updateMount`/`removeMount`. **Persistence + undo came FREE** — pivot
>   + mounts ride the existing `partMeshUpdated` (an EditMesh swap), so zero new
>   stream events / studioModel mutators; the viewport commits via `onEditMesh(id,
>   setPivot(…))` / `…addMount/updateMount/removeMount`. **Viewport (`rig` mode,
>   reusing everything):** a 5th toolbar mode (object/vertex/edge/face/**rig**) with
>   a dedicated branch (no mesh-element pick); `meshRig.tsx` = the self-ticking
>   overlay (orange pivot crosshair-ball + joint rings with a spin-axis arrow + a
>   type·travel label) + `pickRigHandle`/`rigHandles`. The selected handle wears the
>   EXISTING `TransformGizmo` (move) — drag (snapped via `snapToStep`, live
>   `gizmoReadout`) previews into a `rigDraft` and commits on release (`rigDragRef`,
>   mirrors `gizmoDragRef`/the loop-cut slide). `+ joint` adds a socket at the pivot
>   (drag it to the armpit/axle); a `RigJointPanel` sets type / kind / axis (X/Y/Z) /
>   limit (min·max° or **full**); Delete removes the selected joint (the pivot is
>   never deletable); Esc deselects. **req_1051: entering rig mode SPAWNS the gizmo
>   on the pivot immediately** (default-select the pivot on mode entry) so the 3-axis
>   move gizmo is right there to grab — placement (incl. DEPTH, via the into-screen
>   axis in the orbit view) is done with the gizmo, e.g. a pivot buried in the middle
>   of a tire + a joint in the wheelbase deadspace. Rig state resets on active-part
>   change. editMesh
>   **40/40** (+8: default/sticky pivot, add/patch/remove mount, joint limits +
>   travel, lowering leaves the rig intact), modelStream **7/7** (+1: pivot+joints
>   round-trip a cold reopen + the inverse). Studio + the full sources chain bundle
>   clean. Hot-reload TSX. **Follow-ups:** a visual limit ARC (v1 shows axis arrow +
>   degrees); re-selecting a joint that exactly coincides with the pivot (pivot wins
>   the click tie — add it offset or select from a list); the convergence layer (6c)
>   that consumes pivots+joints for composition + animation.
> - ✅ **Rig naming + metadata in column 3 (req_1051/1052/1053).** (1) **req_1051:**
>   entering rig mode SPAWNS the move gizmo on the pivot immediately (default-select
>   pivot on mode entry) — placement incl. DEPTH is the gizmo (drag the into-screen
>   axis in the orbit view): a pivot in the middle of a tire, a joint in the
>   wheelbase deadspace. (2) **req_1052:** pivots + joints are NAMED for binding —
>   `<lib>.<model>.pivot` + `<lib>.<model>.joint.<name>` (e.g. tires.offroad_left
>   .pivot → trucks.tundra.joint.back_left). A joint's `name` = its binding key
>   (unique; `renameMount` auto-suffixes a clash); `type` stays the compatibility
>   class. The left/right mirror (a wheel's one outward face) = save both views as
>   models (general), script-mirror = tires-only shortcut (a `+ mirror` helper is a
>   follow-up). (3) **req_1053:** the layer's rig METADATA moved to workspace column
>   3 UNDER the UV unwrap (`RigMetaPanel`, the `RIG` group in `model/source.tsx`) —
>   the outliner (a reused paint LayerStrip) can't hold it. Clean split: column 3 =
>   the data (editable name/type/axis/limit + add/remove, names = binding keys),
>   viewport = placement (the gizmo). The floating viewport joint panel was REMOVED
>   (no duplication). editMesh **41/41** (+renameMount), Studio + full sources chain
>   bundle clean. Hot-reload TSX. **Follow-ups:** `+ mirror` model duplicate; column
>   3 ↔ viewport selection sync (clicking a joint row highlights it in the viewport);
>   optional numeric position entry in the panel (placement is the gizmo today).
> - ✅ **Pivot opt-in · no type · name labels · branch/twig (req_1054/1055 + interjections).**
>   (1) **req_1054 — pivot is OPT-IN.** A part doesn't auto-have a pivot; a car body
>   is JOINTS-ONLY (nothing on it spins). The data was already pivot-optional
>   (`cuboid()` sets none) — the bug was the UI showing `pivotOf`'s bounds-center
>   fallback as a phantom pivot + auto-selecting it. Added `hasPivot`/`clearPivot`;
>   the overlay/pick/gizmo show the pivot ONLY when `hasPivot`; rig entry selects it
>   only if present; a `+ pivot` button (viewport + column 3) opts a rotating part
>   in; Delete on the pivot drops it. (2) **req_1055→1057 — no `type` in authoring.**
>   First made `type` a strict choice (req_1055), then the user saw it wasn't
>   joint-vs-pivot and ruled it out entirely ("no type — generic covers all the
>   bases"; joints bind by explicit NAME, so type-matching is unneeded).
>   `MountPoint.type` is now OPTIONAL + dormant (absent = generic; `mountsCompatible`
>   tolerates it), kept strict (`JOINT_TYPES`) for a future composition layer but
>   NOT surfaced; the type UI is gone. (3) **Label by NAME (interjection).** The overlay
>   tags each handle by its placement name ('back_left', not 'joint'/'generic') +
>   travel, and the pivot is always labeled — so binding targets read off the model.
>   (4) **branch/twig (USER).** The rig DATA is BRANCH (on EditMesh → partMeshUpdated
>   → persisted V20 + undoable — already so). The tool-state is now a proper TWIG:
>   `selMode`/`gizmoTool`/`rigSel`/`smooth` swapped to `useHotState` (survive a hot
>   reload, reset on cold restart), and the reset-on-part-change effect now skips its
>   first run (a hot-reload remount no longer wipes the restored twig). editMesh
>   **42/42**, modelStream **7/7**, Studio + full sources chain bundle clean. Hot-
>   reload TSX. **Follow-ups (unchanged):** `+ mirror` model duplicate; column3↔
>   viewport selection sync; numeric position entry; a visual limit ARC.
> - ✅ **Shapes beyond the cube + Blockbench cylinder (req_1056).** SURVEY: the only
>   topological (editable) builders were `cuboid` + `cylinder`; `@reactjit/geometries`
>   has more (Sphere/Cone/Torus/Plane/Globe/Head/Heightfield/Humanoid/Carve/VoxelMesh)
>   but those are render-only SOUPS — not loop-cut/extrude-able — so the Studio's add
>   needs an `EditMesh` builder per shape. Added builders (all unwrapped at mint via
>   `fullFaceUV`, all centered): **cylinder** reworked to Blockbench's knobs — diameter
>   + height + **sides** (a strict 3..48 via `clampSides`/`SHAPE_SIDES_MIN/MAX`); **cone**
>   (n-side base ring → apex, the cylinder with its top ring collapsed); **pyramid**
>   (axis-aligned square base → apex, the cuboid with its 4 top verts collapsed —
>   inherits the proven outward winding); **plane** (one +Y quad). The `Add Cube`
>   dialog became **`AddShapeDialog`** — a shape picker (Cube/Cylinder/Cone/Pyramid/
>   Plane) with per-shape params (diameter always; height except plane; sides 3..48 for
>   cylinder/cone) that builds the EditMesh and `addPart`s it. editMesh **45/45**
>   (+3: clampSides/cylinder-clamp, cone, pyramid+plane), Studio + sources bundle
>   clean. Hot-reload TSX. **Follow-ups (the heavier ring-topology primitives):**
>   `sphere` (UV sphere — lat/long rings + pole fans) and `torus`; a `circle` (capped
>   ngon) if wanted. These are the surveyed next shapes.
> - ✅ **Rotate tool (req_1057) — the move/resize/rotate triad.** The third gizmo
>   tool, to spin a part to the correct orientation (a just-added cylinder onto its
>   side, etc.). Pure op `rotateVerts(m, indices, anchor, axis, angle)` in editMesh
>   (right-handed about +X/+Y/+Z; faces/uv/mounts ride along — positions only). The
>   gizmo (`meshGizmo.tsx`) renders three RGB axis RINGS (a world circle per axis,
>   screen-sized like the arms, back half depth-hidden); `pickGizmoHandle` gains a
>   rotate branch (nearest ring within grab px). Drag math = screen-angle about the
>   anchor → world rotation about the axis, the direction frozen at mousedown via
>   `rotationSign` (the projected ring's signed-area winding — no camera view-dir
>   needed); SNAPS like every gizmo (req_1023): default 15° (`STUDIO.rotateStepDeg`),
>   Shift = 1°, Alt = free, with a live degree readout. Reuses the whole existing
>   drag flow (gizmoDragRef + the commit-on-release draft). Works on the selection,
>   so **whole-object reorient = Ctrl+A (select all) then rotate**. editMesh **46/46**
>   (+rotateVerts), Studio + sources bundle clean. Hot-reload TSX. **Follow-up:** an
>   object-mode rotate that targets the whole part without select-all, if wanted.
> - ✅ **Object-mode whole-piece transform + Ctrl+A scope fix (req_1058).** (1)
>   **Object mode now drives the WHOLE part.** The gizmo targets every vert in object
>   mode (anchored at the part center), so move/resize/rotate reorient the whole
>   piece with NO select-all; the move/resize/rotate toggle now shows in object mode,
>   and **entering object mode arms `rotate`** (the common reorient). `gizmoSelVerts`
>   = all verts in object / [] in rig / selection in element modes; the onDown grab +
>   the toolbar gate updated to match. Hot-reload TSX. (2) **Ctrl+A no longer lights
>   up the whole app.** The host's Ctrl+A also set `selection.zig sel_all` (select
>   ALL text across the tree) — so the Studio's select-all-faces flashed every label
>   in the app. Added a `__selection_clear` host door (`v8_bindings_core.zig` →
>   `selection.clear()`) that the Studio's Ctrl+A handler calls right after taking
>   the key, so the app-wide highlight never renders. **The door needs a host REBUILD**
>   (framework change); the TSX call is a safe no-op on an un-rebuilt host. Studio +
>   sources bundle clean; the binding passes `zig ast-check`.
> - ✅ **Create face / bridge edges (req_1059) — the slice's last edit op.** USER flow:
>   select an edge, select another edge, click **create face** → a quad bridges them.
>   Pure ops in editMesh: `bridgeEdges(m, e0, e1)` (a quad from two edges, ordered to
>   avoid the bowtie — of the two ways to join the edges, take the shorter new-edge
>   pairing; a shared vert is a no-op) and `createFaceFromVerts(m, verts)` (3 verts →
>   tri, 4 → quad, ring-ordered by angle in the best-fit plane; null otherwise). New
>   faces get the default per-face square UV (`faceSquareUV`). Note: edges aren't a
>   first-class primitive here (they're face-derived), so "create edge" is the same
>   op with a face result. Studio: a **create face** button in the element toolbar,
>   shown when 2 edges (edge mode) or 3–4 verts (vertex mode) are selected; commits
>   via onEditMesh + clears the selection. editMesh **48/48** (+bridge, +createFace),
>   modelStream 7/7, Studio + sources bundle clean. Hot-reload TSX. **This completes
>   the design-gated edit-ops slice** (loop cut, extrude, delete, create face) +
>   transforms (move/resize/rotate, per-element & whole-object) + the shape set
>   (cube/cylinder/cone/pyramid/plane) + rig authoring (pivot/joints).
> - ✅ **Encoded-shape readout + delete saved meshes (req_1060, items 1+2).** Two
>   small column-3 additions + the design-gate survey for item 3. **(1) The SHAPE
>   panel** (`editors/model/ShapePanel.tsx`, `StudioShapePanel`) — a READ-ONLY view
>   of the active part's ENCODED mesh under the UV + RIG panels: the counts (verts /
>   faces / edges / uv'd / mounts), the pivot (or its bounds-center fallback), every
>   face's vertex loop + uv/material flags, the named mounts, and the EXACT JSON the
>   V20 stream persists (`StoredPart.mesh`, pretty-printed, on a show/hide toggle).
>   Recomputed on the active part's `(id, version)` — the UV panel's key — so a
>   geometry edit refreshes it but an unrelated re-render doesn't re-walk the mesh.
>   Sibling of `StudioUVPanel`/`StudioRigPanel` (reads `useStudioModel`), hosted as
>   the new **SHAPE** group in `workbench/model/source.tsx`. **(2) Delete saved
>   meshes** — `deleteModel(id)` in `studioModel.ts` commits the (already-existing)
>   `modelDeleted` BRANCH event and falls back to the blank 'new' scene if the
>   deleted model was open (`setOpen(null)` clears the undo stacks); exposed as
>   `studioDeleteModel`. **The delete affordance lives ON THE ROSTER ROW (req_1064,
>   USER: the panel "is now double" — it duplicated the column-2 roster).** The shell
>   `RosterRow` shape stayed ({id,label,icon}); the CAPABILITY went on `WorkbenchSource`
>   as `canDeleteRow?(id)`/`onDeleteRow?(id)`, and `shell/Workbench.tsx` renders a ✕
>   (Trash2) per eligible row with a two-step INLINE CONFIRM (✕ → "delete" / ✕-cancel,
>   `confirmDeleteId` shell state, reset on source switch). Frontmost-leaf hit-test
>   means the inner ✕ takes the click without firing the row's select (the LayerStrip
>   row-button precedent). The Studio source sets `canDeleteRow = startsWith('model:')`
>   (so '+ new' is exempt) + `onDeleteRow → studioDeleteModel`. The duplicate
>   `ModelManagePanel.tsx` was DELETED. **(2b) Copy button on the SHAPE data face
>   (req_1064 follow-on, USER "a copy button on the data face would be nice"):** the
>   encoded-JSON row gained a **copy** button → `@reactjit/hooks/clipboard` `set(json)`
>   (system clipboard), with a 1.2 s "copied ✓" flash. editMesh **48/48**, modelStream
>   **8/8** (+modelDeleted removes from the library, unknown-id no-op), Studio + shell
>   + full sources chain bundle clean. Hot-reload TSX. **(3) Item 3 (export-to-texture
>   / painter, Phase 5c) is SURVEYED + SPECCED, not built** — see Part 5.5: the cutout
>   `ModelPreview` paint→`StaticSurface`→`textureKey` loop is a near-exact template;
>   the interaction (WHERE the paint surface lives) needs a user confirm under the
>   design gate before the build.
> - ✅ **Texture MAPPING — box-net atlas sampled on the 3D mesh (req_1062, Phase 5c
>   step 1).** USER (deferring the paint UI): "lets get the texture mapping down
>   first before we touch the paint portion." So the UV→atlas→mesh path is wired +
>   visible, WITHOUT a painter. **(1) `create texture`** (viewport toolbar, any mode,
>   active part) applies `unwrap()` — the box-net packer that remaps every face to
>   its OWN atlas region (vs the `fullFaceUV` default where every face samples the
>   whole square) — committed as a `partMeshUpdated` BRANCH edit (persisted +
>   undoable), then flips texture view on. **(2) `editors/model/TextureAtlas.tsx`**
>   (`StudioTextureAtlas`, key `studio.texture.live`): the active part's box-net
>   rendered into ONE offscreen `<StaticSurface>` as a UV-TEST GUIDE — a checkerboard
>   (scale/stretch/seam read, `STUDIO.textureCheckerCells`) + per-face region tint
>   (X red/Y green/Z blue), face label, and a UV-origin corner marker (orientation).
>   It reuses `storedUVLayout` (the SAME box-net the UV panel draws, so col 3 and the
>   3D texture never diverge) and re-bakes ONLY on the active part's `id~version`
>   (the `sig` memo — the StaticSurface inline-prop rebake hazard harnessed, the
>   cutout `ModelPreview` idiom). **(3) Display:** the active part's `Scene3D.Mesh`
>   samples it (`material="#ffffff"` + `textureKey`) when the **textured/solid**
>   toggle (a TWIG, `studio:texView`) is on; others stay solid. `editMeshToGeometry`
>   already passes the per-corner UVs through, so the mesh samples the atlas with no
>   geometry change. `STUDIO.textureAtlasPx=256`/`textureCheckerCells=8` (P2).
>   editMesh **48/48**, modelStream **8/8**, Studio + full sources chain bundle
>   clean. Hot-reload TSX. **To verify (user, side-by-side):** the box-net wraps the
>   model with each face showing its tinted region + checker; if it reads v-flipped,
>   flip the rect/marker in TextureAtlas (one place, noted). **Deferred (the paint
>   portion):** route a real painter at the atlas — the user will pick WHERE the
>   paint surface lives ("the paint mode will look a few ways") when we get there.
> - ✅ **GLOBAL "textureize" → the Create Texture dialog → one sprite-map atlas
>   (req_1068/req_1069, the real Blockbench flow — supersedes the req_1062 per-part
>   button).** USER gave the exact Blockbench reference (random shape → its UV goes
>   from the overlapping 16×16 default → a clean packed 64×64 atlas of colored
>   islands) + the Create Texture dialog whose "questions matter". **(1) The pure
>   packer** `editors/model/textureize.ts` (`textureizeScene`, headless **6/6**):
>   gathers every face of every part, projects each via `unwrapMesh`, scales by Pixel
>   Density, shelf/bin-packs them ALL into ONE square atlas (Padding gutters,
>   Power-of-2 rounding), and **rewrites every face's `uv` into the shared atlas** —
>   so all parts sample ONE texture. Each `TextureIsland` carries its **outline (the
>   cookie cutter, req_1069) + atlas slot**, so the piece-by-piece image-to-image
>   flow (send one island → mask the AI result to its outline → scale back into the
>   slot) needs no re-pack. **(2) The Create Texture dialog** (`CreateTextureDialog`
>   in Studio.tsx): Blockbench's exact fields — Name · Type (Texture Template / Solid
>   Color / Blank) · Pixel Density (16/32/64/128x) · Color · Rearrange UV · Power-of-2
>   Size · Keep Multi Texture Occupancy · Combine Islands · Edge/Island Angle
>   Threshold · Padding. Fully wired today: density, rearrange, power-of-2, padding;
>   the island-merge ones (Combine + thresholds) + Keep-Multi are surfaced for parity
>   and carried through (effect = the Phase-2 merge). **(3) Wiring:** a GLOBAL
>   `textureize` toolbar button opens the dialog; Confirm packs the scene, commits a
>   `partMeshUpdated` BRANCH edit per part (UVs persisted + undoable), records the
>   atlas params in a `studio:tex` twig, and shows it. **(4) Render** `TextureAtlas
>   .tsx` (`SceneTextureAtlas`): the WHOLE scene's packed islands rendered into ONE
>   offscreen `<StaticSurface>` (the cutout idiom) from the STORED UVs — colored
>   per-island (`ISLAND_PALETTE`, the image-4 template) for Texture Template, a flat
>   fill for Solid, outlines-only for Blank; EVERY part samples it (`textureKey`)
>   under the textured/solid toggle. editMesh 48/48, modelStream 8/8, **textureize
>   6/6**, Studio + TextureAtlas + sources bundle clean. Hot-reload TSX. **Deferred
>   (architecture in place — the outlines are saved so these need no re-pack):**
>   Combine-Islands angle merge, Keep-Multi-Texture, persisting a real texture-doc,
>   and **Phase 5d** — the per-piece masked image-to-image via the cookie cutters +
>   hand-painting the atlas.
> - ✅ **Unified island color + PNG sprite-sheet export (req_1072).** USER: the model
>   showed per-face colors but the UV panel showed only 3 (axis tints) — "it should be
>   exactly what is shown on the model"; plus "an export to sprite sheet button… either
>   the whole thing or one specific slice". **(1) ONE color source:** `islandColorFor
>   (partId, faceIndex)` in textureize.ts — a stable per-(part,face) palette pick (FNV
>   hash of the id + faceIndex, cycling `ISLAND_PALETTE`) now used by the 3D atlas
>   render (`SceneTextureAtlas`), the UV panel (`StudioUVPanel` — dropped `AXIS_TINT`),
>   AND the PNG export, so all three match exactly (rule of two). **(2) PNG export:** a
>   dependency-free encoder `editors/model/png.ts` (`encodePng` — STORED deflate + CRC32
>   + Adler32, headless) + `rasterizeAtlas(parts, texels, type, color, slice?)` in
>   textureize.ts (point-in-poly fill of each island's stored-UV silhouette with its
>   `islandColorFor` color, transparent ground; a `slice` crops to ONE face's island =
>   the cookie cutter). Studio: **export sheet** (whole atlas) + **export slice** (the
>   selected face's island, face mode + 1 face) write `cart/hmsc-int/exports/<name>.png`
>   via `bytesToBase64` + `writeFileBase64Atomic` (`@reactjit/hooks/fs`), with a toast.
>   The atlas name now rides the `studio:tex` twig. **req_1076:** the export filename is
>   the SCENE (model) name, not the dialog's `texture` default, + a numeric suffix when
>   the file already exists (`exists()` probe) — so exports never silently overwrite.
>   textureize **9/9** (+islandColorFor
>   stable, rasterize whole+slice, encodePng signature/IHDR), editMesh 48/48,
>   modelStream 8/8, Studio+TextureAtlas+UVPanel+sources bundle clean. Hot-reload TSX.
> - ✅ **Texture RE-UPLOAD — the round-trip return path (req_1079).** USER: re-upload a
>   new texture map so the model captures the visual edits ("treat it as you cookie
>   cutter everything to be safe"). The export's twin: **import sheet** (the whole
>   edited/AI sheet) + **import slice** (one face's regenerated island, face mode + 1
>   face) open an `ImportTextureDialog` pre-filled with this scene's export path (so
>   export→edit→import is one click). The model captures it because every face samples
>   ONLY its UV slot — the **cookie cutter is automatic**: a whole-sheet upload slips
>   back into place with overshoot ignored; a slice drops into its slot (clipped to the
>   rect). **Mechanism:** the PNG is read to a **`data:` URL** (`readFileBase64`) — NOT
>   a bare path — because the host image cache is keyed on the source BYTES, so a
>   same-path re-import would hit the stale cache; the data URL's payload changes with
>   content + an `imageRev` bump forces the StaticSurface re-bake. `SceneTextureAtlas`
>   renders the uploaded `<Image>` (the cutout `ModelPreview` idiom) IN PLACE OF the
>   procedural template when `imageUrl` is set, with per-slice `<Image>`s composited
>   over it at their slots; all on the `studio:tex` twig (`imageUrl` / `sliceImages` /
>   `imageRev`). Re-textureize resets to a fresh template. textureize 9/9, editMesh
>   48/48, modelStream 8/8, Studio+TextureAtlas+sources bundle clean. Hot-reload TSX.
> - ✅ **Phase 5d — AUTOMATED image-to-image (AI fill) + large-texture file-ref (req_1070/
>   req_1110/req_1113).** The manual loop (export slice → external model → import slice) is
>   now in-app. **(1) Reuse, not reinvent:** extracted `generateToBase64(prompt,opts,refs)`
>   from cart/image-gen's nano-gpt client (the network half, no disk — rule of two; the
>   image-gen app's `generateBatch` now calls it). **(2) `editors/model/textureGen.ts`** —
>   the AI core: `generateTexture` (img2img via the reused client), `enhanceViaNano` (prompt
>   enhancement through a nano-gpt TEXT model, same key, OpenAI `/v1/chat/completions`,
>   req_1113), `buildTexturePrompt`, `stripDataUrl`/`pngDataUrl`/`hashHex`. **(3) `AiTextureDialog`
>   (Studio.tsx)** beside import sheet/slice — prompt, image-model field, **reference toggle**
>   (img2img off the current atlas art vs text-only, default img2img), **enhance toggle**
>   (off / nano text / Claude — the req_1070 bypass; Claude routes through `useAssistant`
>   claude_code, spawned lazily only when picked, the event stream bridged to a promise),
>   live status. The result flows through the SAME slot/cookie-cutter path as import
>   (`applyTextureImage`), so no new render plumbing; `referenceB64` feeds the current art
>   (a prior upload/gen, else the procedural island raster) as the img2img reference.
>   **(4) Large-texture file-ref (req_1110):** `texSource(b64)` keeps small textures inline
>   (data URL) but writes large ones (> `STUDIO.textureInlineMaxBytes`) to a CONTENT-ADDRESSED
>   cache file (`exports/.cache/tex_<hash>.png`) referenced by PATH — keeping big textures
>   out of the twig while staying cache-correct (the host image cache keys on source bytes;
>   the hash makes the path change with content). Applied to BOTH import + AI. Resolution is
>   bounded at both ends (`STUDIO.aiTextureSize=1024`, refs are atlas-sized) so we never need
>   a JS image DOWNSCALER (none exists — only `encodePng`, no decoder). **(5) Native key store
>   (req_1118 — all in-house):** the nano-gpt key lives in hmsc-int's OWN `localstore`
>   (`nsGet`/`nsSet`, `'hmsc'` namespace, key `nano-gpt-api-key`) — entered once in an "api key"
>   field in the dialog, remembered across sessions. To keep this off Postgres, the pure network
>   client was split into a DB-free `cart/image-gen/client.ts` (`buildPayload` + `generateToBase64`
>   with the key passed IN); `generate.ts` (the image-gen app) keeps `generateBatch`, looking its
>   key up in Postgres and passing it through. So hmsc-int imports `client.ts` only — **zero `__pg_`
>   in the Studio bundle, NO dev-host rebuild.** editMesh **48/48**, modelStream **8/8**, textureize
>   **9/9**; client + generate + textureGen + Studio + sources + image-gen pages bundle clean
>   (Studio bundle: 0 `__pg_`, 4 `__localstore`). Fully hot-reloadable.
> - ✅ **Part 7 SPEC + Phase 7a data spine — THE ASSET COMPILER (req_1122/req_1123/req_1129).**
>   Specced Part 7 (the asset compiler) into the playbook — a Studio model becomes another
>   COMPILE INPUT that cooks to a typed, content-addressed, installed, catalogued,
>   placeable asset ("BSP files, but for assets"), the asset's MEANING explicit at compile
>   time via a kind selector → kind-specific descriptor (reusing the EXISTING kind tables,
>   not forking). **GUIDING_LIGHT-aligned (req_1129):** separable content-addressed FACTORS
>   (mesh blob / texture blob / descriptor) never a baked product, the hash IS the cache
>   key (idempotent re-cook), declarative-not-code, derive-don't-store-twice. Then BUILT +
>   tested the hot-reloadable data spine: **`editors/model/cookedAsset.ts`** (the pure cook
>   core — `flattenModel` lowers visible parts to ONE content-addressed soup via
>   `editMeshToGeometry`, collision/footprint MEASURED from bounds, the prop descriptor IS
>   `PropKindDefinition` verbatim, `validateProp` fails loud, `cookProp` returns
>   {asset, blob, errors} with an sha256 identity over its factors-by-reference) +
>   `cookedAsset.test.ts` **10/10**; **`editors/model/cookedAssetStream.ts`** (the V20
>   content store — `assetInstalled`/`assetRenamed`/`assetRemoved`, blobs interned ONCE by
>   hash = dedup, kind catalog selectors, cold-reopen) + `cookedAssetStream.test.ts` **8/8**;
>   **`editors/model/cookedAssets.ts`** (the Studio-side door — `useCookedAssets` hook +
>   install/rename/remove over the live `editorChannel`); and the **⚙ compile** toolbar
>   button + **`CompileAssetDialog`** in `Studio.tsx` (kind selector — prop live, item/
>   vehicle-part/clothing "soon" — label/solid/donor fields → `cookProp` → install + toast).
>   editMesh 48, modelStream 8, textureize 9 regression clean; Studio + full sources chain
>   bundle clean. Fully hot-reloadable (no rebuild). **The whole cook→install→catalog vertical
>   works in-editor now.** Reuses the imported-prop precedent (the `MESH_PROPS` real-mesh bake
>   path that already exists), so props are the cheapest kind to prove.
> - ✅ **Prop NATURE — three shapes, not two (req_1131).** The first Compile dialog cut
>   offered only Static vs Foliage and missed the prop stack's third nature: **kickable
>   PHYSICS bodies** (a barrel/can/ball — the KICKPROP `dynamics` system). Added a single
>   **Nature** selector (Static / Foliage / Physics) that maps onto the table's granular
>   fields; a Physics prop authors only the **bounce** (restitution) and the cook MEASURES
>   the body radius from the footprint (`PropDescriptorInput.physics = { restitution }` →
>   `dynamics: { bodyRadiusMeters = footprintRadius, restitution }`). `validateProp` rejects
>   a bad restitution / zero radius (fail loud). cookedAsset **13/13** (+3: physics body
>   measured, static has no dynamics, bad bounce rejected); Studio bundles clean. Hot-reload.
> - ✅ **Phase 7a — PLACE a cooked prop in the editor (req_1134, hot-reload, NO rebuild).**
>   "Where do I find it to place?" — answered. A cooked prop now appears in the iso build
>   pane's **prop tab → `studio` shelf** and places + renders like any built-in prop. The
>   imported-prop precedent (`isImportedPropKind` → `<ImportedProp>` mesh-soup render) was
>   the template; cooked props mirror it. **Built:** (1) a RUNTIME OVERLAY in
>   `game/kinds/props.ts` — `registerCookedProps`/`isCookedPropKind`/`cookedPropKinds`, and
>   `propKindDefinition`/`isPropKind`/`propDynamics`/`propMount`/`propSeat`/`propContainer`/
>   `propCoverClass` all fall back to it (so a cooked kind resolves through the SAME lookup as
>   a built-in; a defensive 1 m box fallback avoids a load-race crash); a new `'studio'` prop
>   CATEGORY (empty static shelf; `propCategory` returns it for cooked kinds). (2) A matching
>   overlay in `game/build/catalog.ts` — `registerCookedCatalog` builds a `prop.<id>` row per
>   cooked kind (MEASURED footprint via the prop overlay); `catalogEntry`/`isCatalogId`/
>   `catalogEntriesByKind` include them, so the placement palette + ghost + commit all work.
>   (3) `editors/model/cookedAssets.ts` `syncCookedRegistry` mirrors the cooked catalog into
>   BOTH overlays (descriptors first, then catalog rows), called on channel boot (cold-load
>   safe) + after every install. (4) Render: `render3d/props/CookedProp.tsx` (the cooked mesh
>   soup from the content store via `cookedMeshBlob`, à la ImportedProp), dispatched in
>   `render3d/Prop.tsx` before DataProp — covers BOTH the ghost and the standing placed prop
>   (`pieceMeshes` renders both through `<Prop>`). (5) `IsoAuthor` subscribes `useCookedAssets`
>   (boot-syncs the overlay + re-renders the rail on a new cook) and shows the live count on
>   the `studio` shelf chip. Correctness fix: the cooked descriptor's `kind` is now the asset
>   **id** (the placement key), not the display name. cookedAsset **13/13** (+kind=id), store
>   8, editMesh 48, modelStream 8, textureize 9, build 25 — all green; IsoAuthor + Prop +
>   Studio bundle clean. v1 renders UNTEXTURED (a flat tint); the texture + the /compiled bake
>   are the remaining slice.
> - ✅ **Bugfix — "the cooked prop shows but won't place" (req_1136).** Root cause: a
>   SYNC-ORDERING bug, not a logic bug. The world materializer DROPS a `piecePlaced`
>   whose `pieceId` isn't a known catalog id (`game/world/stream.ts:267`), and a stream's
>   `state()` is a CACHED fold (snapshot + incremental appends) — so if the cooked-prop
>   overlay wasn't synced when the worldStream first folded, a placed cooked prop was
>   dropped and stayed gone. The overlay was synced lazily by the deep `CatalogRail`, which
>   renders AFTER `buildPieces` folds. Fix: `editors/model/cookedAssets.ts` `ensureCookedRegistry()`
>   (sync the prop + catalog overlays from the persisted cooked-asset store), called in
>   `index.tsx` in a `useMemo` BEFORE `editorChannel(worldStream)` is created — so the
>   overlay is populated ahead of every fold + the placement apply. Proven by a new headless
>   repro `editors/model/cookedPlacement.test.ts` **4/4** that walks the exact chain (overlay
>   resolves → catalog lists → `validatePlacement` passes → the worldStream materializer KEEPS
>   the cooked `piecePlaced`). cookedAsset 13, store 8, build 25 green; index + IsoAuthor bundle
>   clean. Hot-reload TSX.
> - ⏭ **Next (Phase 7a finish — the /compiled + texture slice):** (1) the BAKE read —
>   `compile/worldGeometry.ts` + `bakeGameFile.ts` resolve a cooked-prop PLACEMENT (a
>   `prop.<id>` build piece) → its `MeshBlob` into the `MESH_PROPS` lump (generalize the
>   `isImportedPropKind` branch) + read the cooked-asset stream in the bake; (2) fold
>   **`@reactjit/image`** into the cook (atlas → compressed WebP + a catalog thumbnail; sets
>   `texRef`) + sample it on the cooked mesh (textureKey) — the `imageops` ingredient + the
>   loader texture wiring need the one dev-host REBUILD. Then Phase 7b–7d (item / vehicle-part
>   / clothing descriptors + their owning-system catalogs).
> - ✅ **PAINT mode — paint texels straight on the 3D faces (Phase 5c, req_1194).** The
>   long-deferred "paint the atlas in-app" — but the user pinned the interaction: **every
>   face of the texture becomes a NORMALIZED GRID of cells** (the atlas texels its UV slot
>   covers), cells are **slivers on thin/slanted geometry** (expected — textureize packs a
>   thin slot), and **painting a face NEVER bleeds across an edge into a neighbour** (each
>   face owns a disjoint, padded atlas slot). So the surface IS the 3D model, not a separate
>   2D canvas — you paint on the faces and the texel grid is the texture's own pixel grid.
>   **Built (TSX-only, hot-reload): `editors/model/meshPaint.tsx`** — the pure paint math +
>   the hovered-face grid overlay: `screenRay` (the INVERSE of meshSelect's projector — a
>   click → a world ray, no matrix inverse, reusing the orthonormal lookAt basis),
>   `pickFaceTexel` (Möller–Trumbore over every part's fan-triangulated uv-mapped faces →
>   the frontmost face + the barycentric-interpolated atlas texel), `faceTexelRect`/`brushTexels`
>   (the brush stamp CLAMPED to the hit face's slot — the no-spill guarantee), `paintRuns`
>   (merge same-colour cells per row → far fewer boxes than one-per-texel, under the layout
>   child cap), and `PaintGridOverlay` (the normalized grid on the hovered quad face via
>   bilinear over its 4 uv-rect corners + the cursor cell highlighted). **Studio wiring:** a
>   6th mode (`object/vertex/edge/face/rig/**paint**`, added to `SelMode`); entering it
>   auto-`textureize`s the scene if no texture yet (`ensureTexture`, distinct per-face slots
>   are required) + shows textured; onDown/onMove/onUp paint + drag-paint + hover-track (no
>   orbit while painting); a swatch palette + eraser + brush sizes (1/2/3/5) + clear-paint in
>   the toolbar. **Storage:** the painted texels ride `tex.paint` (`Record<"tx:ty",colour>`)
>   beside `imageUrl`/`sliceImages` — texture DATA on the `studio:tex` twig, `paintRev` in the
>   atlas `sig`; `SceneTextureAtlas` draws the runs on top of the base art so the model shows
>   paint live. brush colour/size are tool TWIGS (`studio:paintColor`/`paintBrush`).
>   **meshPaint 6/6** (ray round-trip vs the projector, face/texel hit, miss=null, brush
>   clamp = no spill, 1-texel brush, run-merge); editMesh 65, Studio + full sources chain +
>   the hmsc-int cart entry bundle clean. **Follow-ups:** per-stroke atlas re-bake is per-move
>   (fine for a 256px surface; throttle if it janks on dense meshes); grid overlay is quad-only
>   (tris/ngons get an outline); bake paint into the content-addressed texture asset (the cook /
>   /compiled slice); persist paint across a cold restart (today it's a twig, like `imageUrl`).
> - ⏭ **Next on the viewport:** bake the painted atlas into the cooked texture asset; the
>   agentic `generate_texture` tool + true outline (silhouette) masking beyond the rect slot +
>   batch "fill every island"; Combine-Islands angle merge + texture-doc persistence; wireframe
>   display mode (the one Zig rebuild — `gpu/3d.zig`); inset/bevel edit ops → the composition/
>   assembly layer; host-rendered screen-stable gizmo/compass.

---


> req_0942. The user built a car body in Blockbench (one continuous body mesh +
> 4 wheels, sloped windshield/hood, wheel-well cutouts, single painted UV atlas)
> and wants the same authoring capability native to hmsc-int — so that over time
> we *design the tools* and stop *prompting procedural model code*. This is the
> survey + gap analysis + phased plan. Behavior reference for the target tool is
> Blockbench mesh mode; do not treat box/cuboid mode as the target (it can't make
> the sloped body the user already made).

---

## Part 0 — THE COMPOSITION MODEL: Lego parts with typed mount points (USER, req_0952)

**This is the cornerstone. Read it before anything below — earlier drafts drifted
toward "one big molded mesh," and that is the WRONG direction.** The user does not
want to author whole players or whole cars. The model is **Lego**: author each
PART once (a tire, a spoiler, a hand, a head, a body), give it typed connection
points, and a **composition layer mends parts together at matching connectors.**

- **Parts, not monoliths.** "I don't want to make one big player model — I want
  to make each part, and mend them together. Same for cars: a bunch of tires,
  spoilers, whatever, that connect to bodies made separately." The Studio is a
  **single-part editor**; assembly is a separate concern.
- **Connection points are DATA on the part, authored in the Studio — not metadata
  added later.** A part's `EditMesh` carries `mounts: MountPoint[]`. A `MountPoint`
  is a **typed connector**: `{ name, type, kind: socket|plug, position, axis?, size? }`.
  A `plug` seats into a `socket` only when `type` matches (and sizes agree) — so a
  tire's `axle` plug fits a body's `axle` socket, never where a `spoiler` goes.
  The type prevents mis-mounting. (Landed + tested: `editMesh.ts` `MountPoint` +
  `mountsCompatible`.)
  - **tire** = geometry + a `hub` plug (type `axle`, with a spin `axis` + a `size`
    for the axle hole).
  - **car body** = geometry + 4 `axle` sockets + optional `spoiler`/`roof` sockets.
  - **character torso** = geometry + a `neck` socket + 2 `shoulder` sockets + 2
    `hip` sockets; head/arm/leg each carry the matching plug.
- **The bones system already IS this — just implicit in code.** The 25-bone FK
  skeleton (`game/figure/skeleton.ts`) encodes which part attaches where: head at
  the neck, arms at shoulders, legs at hips; `Bones` is the "universal currency"
  for assembly/clothing/hitboxes/anchors. Today the rig builder *knows in code*
  that "head goes above torso at the neck position." **The Lego refactor makes
  those connections explicit `MountPoint` data on the parts themselves.** A bone
  is a mount point; the skeleton is the character's mount graph.
- **Same architecture as the road grammar.** Roads aren't painted cells — they're
  spines with plot points that connect via shared, named, typed endpoints. **Parts
  are roads; mount points are plot points.** Mesh composition is the road system
  applied to models. (See `[[project_road_grammar]]`.)
- **Why this is the whole point — combinatorial scale.** Author a small
  vocabulary, get unbounded compositions: 8 bodies × 15 tires × 10 spoilers × 8
  hoods = **9,600 cars from ~40 parts**; 5 torsos × 6 heads × 8 hands × 8 feet × 4
  heights = **7,680 characters from ~30 parts** (then skin/clothing/scale multiply
  again). You'd burn out hand-authoring 50 whole characters; you can easily author
  30 parts. **The Lego model is what makes solo-dev content scale** — the same
  vocabulary→composition move as the building pieces.

**What this means for the build:**
- The Studio outputs **part-shaped data**: an `EditMesh` + its `mounts`. ✅ the
  mount data + the typed-match predicate are landed in the keystone.
- **The composition/assembly layer** — placing a child part so its plug seats into
  a parent's socket (orient by `axis`, snap by `position`), and the bake that
  flattens an assembled whole — is the **generalization of the rig builder to
  vehicles + props**, and a DELIBERATE design step under the design gate. **Spec
  it before building** (it is not built yet).
- **The preview/bake rule still holds** (`[[react_3d_is_authoring_not_runtime]]`):
  authoring assembles + previews live in React; the shipped game plays baked
  output (the figure already bakes keyframe clips — composed parts bake the same
  way, no reconciler in the hot path).
- **This corrects the convergence story:** parts are rigid pieces mended at typed
  joints (= bones), NOT one skinned mesh with per-vert weights. Per-part sculpt
  still exists (a head is a part you can mould); whole-body skin-weighting is not
  the model.

### Part 0a — Downstream payoffs: a joint assembled can be severed (USER, req_0953)

The mount-point model is not only an authoring convenience — it hands us three
gameplay capabilities **for free**, because the same typed-connector data drives
both **composition** (author-time assemble) and **decomposition** (runtime
detach). This sharpens the composition-layer spec: **mounts must be detachable at
runtime, not just static glue that bakes flat.**

- **In-game customization is a free feature.** The exact part-swap the Studio does
  to author content lets a PLAYER swap parts in-game — pick a body, tires,
  spoiler, hood; dress an avatar from torso/head/hand/foot parts. "The
  customization part alone is huge — some people, all they like to do is customize
  a car or their player model; that can be a game itself." Same composition layer,
  exposed to the player instead of the author.
- **Assassination / dismemberment.** Because a body is parts on typed joints, you
  can **chop the body up and hide the pieces** — sever a mount, the part becomes a
  free dynamic object. This is the ragdoll seam (`[[project_host_camera_ray]]`'s
  bones-in/bones-out contract, `game/figure/ragdoll.ts`) expressed through the same
  mounts.
- **Vehicle part-loss.** A **tire blows off the side of a car** — "it's just a
  joint," so detaching it on impact is free; vehicle damage reuses the mount seam
  (pairs with the dormant `breakable`/`health` material hooks, `[[hmsc_glass_transparency]]`).

**Design implication (for the gated composition spec):** a `MountPoint` /
assembled-part needs a runtime state — `attached | detached` — and a break trigger
(damage, interaction). Composition assembles; the same graph supports severing a
node so the subtree drops to a free body. Keep this in view when the composition
layer is specced; don't design a bake that can only ever produce a welded whole.

### Part 0b — Clothing already IS this; slot-bound inventory (USER, req_0954) — forward context, not the current build

The clothing system already embodies the slot/mount model, so the parts model
extends straight into wardrobe + inventory:
- **`outfit.ts` rules clothing as ATTACHMENTS** (USER req_0040: "a prop that is
  separate but tightly related, not entirely coupled"). `attachOutfit()` builds
  garments against the bones record (the same bones-in seam); garments ride bone
  slots (bottoms→pelvis, tops→torso/arm chain, accessories→head); the outfit is
  its own slotted document (`top`/`bottoms`/`print`/`accessories`). **A garment
  binds to a slot exactly as a tire binds to an axle** — the player-stats lab's
  inventory is "based on the clothing," binding at slots.
- **Slot-bound inventory → emergent gameplay (the idea is already shaped into that
  lab):** because carry/pockets bind to the OUTFIT's slots rather than to the
  player globally, swapping outfits leaves your stuff in the other outfit's pockets
  (a real-world inconvenience as a mechanic), and the Hitman beat falls out free —
  **take someone out → steal their outfit as a disguise** (you wear their slotted
  garments, and whatever those slots carried).
- **Status: forward context only.** The user: "not something you need to worry
  about at this point — the idea is already shaped into that lab in some fashion."
  Captured so the composition/mount design stays compatible with it; NOT in the
  current build scope.

### Part 0c — Props already have searchable containers + locks; the key IS a typed connector (USER, req_0955)

The prop system already carries the container + lock half of the slot model
(`game/kinds/props.ts`):
- **`PropContainer`** = `{ lootCategory, capacity (item slots), spawnFillChance,
  searchSeconds, access }` — a **searchable** container is item-slots you reveal
  over a loading bar.
- **`PropContainerAccess = 'open' | 'locked' | 'keyed'`** — `'locked'` =
  pickable/forceable; `'keyed'` = needs its key (safes, mailboxes). The **lock is
  a typed gate**, and **a key is just the matching typed connector — key↔lock is
  plug↔socket, the same `mountsCompatible` rule.**
- Props even already carry a **`propMount`** (floor/wall) — another mount.
- **Gaps the user named (forward, not now):** no keys yet (the typed key-item that
  satisfies a `'keyed'` lock), and items exist only "slightly" — made, but not yet
  given stats. The loot system is flagged in-code as "next in line."

### Part 0d — ONE model everywhere (the seam, USER req_0942–0955)

Slots / typed connectors are the single connective tissue across the whole game.
Author a small vocabulary; composition + typed-matching do the rest:

| Domain | The "socket" | The "plug" | Already in code |
|--------|--------------|-----------|-----------------|
| **Mesh parts** | body axle/spoiler sockets | tire/spoiler plug | `editMesh.ts` `MountPoint` ✅ |
| **Skeleton** | neck/shoulder/hip on torso | head/arm/leg | `game/figure/skeleton.ts` (implicit → make explicit) |
| **Clothing** | outfit slots on the bones | garment | `game/figure/outfit.ts` (attachments) |
| **Inventory** | the outfit's carry slots | items | the player-stats lab |
| **Containers** | a prop's item slots + lock | item / key | `game/kinds/props.ts` `PropContainer` |
| **Roads** | a spine's plot point | another spine's endpoint | `[[project_road_grammar]]` |

One typed-match predicate (`mountsCompatible`-shaped) governs every row: tire→axle,
head→neck, garment→slot, key→lock, road→plot-point. The composition layer the
Studio needs is the **same layer** that would assemble outfits, fill containers,
and gate locks — which is exactly why it's worth designing deliberately (the design
gate) rather than as a vehicle-only feature.

---

## Part 1 — What we have today (how it looks / behaves / acts)

Every modeling surface in the repo bottoms out at ONE representation:

```
GeometryData = { positions: Float32Array /* [px,py,pz, nx,ny,nz, u,v] × N */,
                 count, bounds }      // non-indexed triangle soup. No topology.
```

A geometry is a pure `generate(params) → GeometryData` registered in
`@reactjit/geometries`. The framework "knows zero shape names" — it draws
interned vertex bytes (`runtime/geometries/index.ts`, `_util.ts`). Everything
below produces that soup; nothing edits topology.

| Tool | Where | What it IS | How you author | Output |
|------|-------|-----------|----------------|--------|
| **Procedural vehicle** | `game/vehicle/index.ts` `buildVehicle()` | ~60 hand-placed `box`/`cylinder`/`sphere` meshes positioned by tuned offsets off a style's dims | **You don't.** You pick a style + seed + damage; code emits the part stack. This is the "many faces" the user wants gone. | array of `VehicleMesh` (each a primitive instance) |
| **Build pieces** | `editors/build/pieceShapes.ts` | Parametric decomposition of building pieces → `VisualBox`/`VisualRamp`/`gable` | Place catalog pieces on a grid (IsoAuthor); shape is fixed per kind | `VisualShape[]`, parity-tested against the compiled bake |
| **Primitive registry** | `runtime/geometries/*` | Box, Sphere, Cylinder, Cone, Torus, Plane, Head, Globe, Heightfield, Humanoid, VoxelMesh, Carve | Spread-override `params` in code | `GeometryData` |
| **VoxelMesh** | `runtime/geometries/VoxelMesh.ts` | Greedy exposed-face mesh from a set of unit blocks | Place/erase blocks (voxel editor) | `GeometryData` (real mesh, not box instances) |
| **Carve** | `runtime/geometries/Carve.ts` + `editors/cutout` | Image silhouette → inflated 3D (Teddy technique) | Paint/import a mask, inflate | `GeometryData` with front/back planar UVs |
| **Heightfield** | `runtime/geometries/Heightfield.ts` | Height grid → terrain surface | Paint a height grid | `GeometryData` (host can regen from compact params) |
| **OBJ/GLB import** | `cart/hmsc-int/tools/importPropMesh.mjs` | Parses OBJ + GLB (full glTF node/accessor walk), normalizes height, bakes to prop registry | CLI: `importPropMesh.mjs car.glb --kind imported.car …` | `IMPORTED_PROP_MESHES[kind].vertices` (our 8-float soup) |
| **Paint / cutout painter** | `editors/paint/*`, `editors/cutout/models.ts` | Layer-based mask painter → baked `PaintedOverlay`; per-part texture overlays | Paint layers on a canvas, bake | `PaintedOverlay` riding the model doc, **per part** |

### The real shape of it: three half-editors (USER, req_0943)

The capability isn't absent — it's **scattered across three subsystems, no part
of it in any one place** (the user's framing, and it's exactly right). Each owns
a different third of what a mesh editor is:

| Third of a mesh editor | Where it lives today | How it already works | Bolted to |
|------------------------|----------------------|----------------------|-----------|
| **Face selection + per-face paint + face cutouts** | Building pieces — `editors/build/FacePainter.tsx`, `pieceShapes.ts` wall edits | Click a face to TARGET it (front/back/sides slots; props skin by NAMED part; a plate reads top/bottom/edges), pick a skin → paints that slot, commits per-face events with stable ids ("paint face after face"). Wall edits **carve openings** — a face becomes a hole + jamb/sill/header frame (topological face surgery). Per-face image upload → decal doc. | the building catalog (a placed `PlacedBuildPiece`), not a free mesh |
| **One moulded mesh + unwrap atlas + sculpt** | Player models — `Globe`/`Head`/`Humanoid` + `/cutout` painter | A single continuous mesh moulded by an unwrap: paint photo + depth on the equirect unwrap, it wraps + displaces onto `globeSurface`. The Humanoid carries a 4-rect UV atlas (`HUMANOID_ATLAS`). | the humanoid/head, not a general shape |
| **Topology import + primitive assembly** | Props — `importPropMesh.mjs`, `propRecipes/*` | Full glTF/OBJ topology parsed → our 8-float soup; recipes stack primitives. | bake-only; **no interactive editing at all** |
| **Vertex/edge selection · extrude · loop cut · create-face** | **nowhere** | — | this is the actual hole |

So the two honest truths:

1. **We can already INGEST a Blockbench export and we already paint/select faces
   and mould unwrapped meshes — just never in the same tool, never on a free
   mesh.** The pieces exist; they're fragmented and each is welded to one
   content type.

2. **The one thing nothing does is edit topology** — no vertex/edge selection,
   no loop cut / extrude / create-face. The vehicle is "many faces" precisely
   because stacking primitives in code is the only way to make a body today, and
   the building editor's face-surgery (openings) can't be repointed at it.

**This makes the work a CONSOLIDATION, not a greenfield build:** harvest face
selection/paint from buildings, the unwrap-atlas/mould from player models, and
import from props; unify them on ONE editable mesh type; add the single absent
layer (vertex/edge topology + the four ops).

---

## Part 1.5 — Seven techniques, one curse (USER, req_0944)

Step back from the vehicle and the real problem is bigger and clearer: **every
content type is its own modeling technique.** The broken-up core was a blessing
(each silo evolved independently, fast) and is now a curse (a capability built
for one silo is unavailable to all the others — seven representations, seven
authoring UIs, seven paint/skin models, seven bake paths).

| Content | Technique today | Representation | Authoring surface |
|---------|-----------------|----------------|-------------------|
| **Player** | bones-driven single moulded mesh + unwrap + sculpt displacement | `Globe`/`Head`/`Humanoid` | `/characters`, `/cutout` |
| **Clothing** | bones-driven **garment primitives** (boxes/cones/cylinders ride the skeleton) | `ClothingInstance[]` on bones | `/clothing` workbench |
| **Items** | bespoke `generate(params)` meshes **+ voxel-block builder** (per-face neighbor recognition) | hand-authored mesh / `VoxelMesh` | `/items`, `/voxels` |
| **Vehicle** | procedural primitive stack (~60 boxes in code) | `VehicleMesh[]` instances | `/vehicles` population table |
| **Buildings** | parametric face-slot pieces + carved openings | `VisualBox`/`VisualRamp`/`gable` | IsoAuthor + `FacePainter` |
| **World** | painted heightfield → landforms + tile chunks | height grid | tile painter |
| **Props** | primitive recipes + OBJ/GLB import | soup / imported topology | recipe code / CLI import |

The voxel builder's "per-face recognition" (`VoxelMesh.greedyFaces` — emit a
face only where a block has no occupied neighbor) is the SAME adjacency reasoning
the edit ops need: it's a fourth harvest source, alongside building face-paint,
player unwrap/sculpt, and prop import.

### What actually unifies them

A representation that collapses all seven is a **topological mesh with optional
layers**:

- **verts + n-gon faces + edge adjacency** → props, items, vehicle body,
  building shells (the static core);
- **per-face UV + material slot** → building face-paint AND the player unwrap
  atlas (same field, two harvested behaviors);
- **typed mount points (`mounts`)** → the Lego seam (Part 0): player + clothing +
  vehicle + props all compose from parts mended at typed connectors; the skeleton
  is the character's mount graph, NOT a skinned monolith;
- **optional per-PART sculpt-displacement** → a head/part you mould (player head
  sculpt + voxel displace) — per part, not a whole-body skin;
- **constructors, not separate techniques**: voxel blocks, height grids, carve
  masks, primitives, and import all become *ways to mint or extend* a part's
  mesh — brushes in the editor, not seven parallel pipelines.

So the North Star is **one mesh foundation + one editor toolkit** that each silo
migrates onto over time. This is NOT a big-bang rewrite: the foundation is built
to subsume silos incrementally, and each migration *deletes* a bespoke technique
rather than adding an eighth. The car is simply the **first adopter** that proves
the substrate.

---

## Part 2 — What Blockbench gave the user (how it looks / acts) and what it costs us

Blockbench **mesh mode** edits a topological boundary mesh: shared vertices,
edges as first-class entities, n-gon faces each owning a UV rect in one texture.

| Blockbench op | What it does | What it requires that we lack |
|---------------|--------------|-------------------------------|
| **Edit mode + vertex/edge/face select** | Click/box-select sub-mesh elements | A topological mesh (shared verts + edge/face adjacency) and ray-pick against verts/edges/faces |
| **Move/scale/rotate selection** | Transform gizmo on the selection | A 3-axis gizmo bound to a selection set (we have orbit + handle-drag patterns, no element gizmo) |
| **Extrude edge / face** | Duplicate the boundary, bridge with new side faces, then drag | Topological mesh + a pure extrude op |
| **Create face** | Fill the hole between 3–4 selected boundary verts/edges — "seal the body" | Topology + boundary detection |
| **Loop cut** | Insert an edge ring across a quad loop, subdividing | Quad-loop walking (the hardest op; needs adjacency) |
| **UV unwrap + paint** | Each face → a rect in ONE atlas; painting the atlas paints the model | A single-atlas unwrap + painter routed at it (we have per-part paint + the Humanoid 4-rect atlas precedent) |

**Net:** five of the six gaps collapse into **one missing data structure** (the
editable topological mesh) plus a handful of pure ops over it. The render
pipeline, the import/export of our vertex format, the paint layer system, the
iso/orbit authoring shells, and ray-pick are all already here. That is what the
user means by "not that far off" — and it's accurate at the substrate level.

---

## Part 3 — The plan (each phase independently useful)

The keystone is one editable mesh type that lowers to `GeometryData` like every
other geometry, so it renders unchanged in the editor, `/test`, the compiled
bake, props, and vehicles. Each `EditMesh` is ONE PART (Part 0); it carries its
typed `mounts` so it composes, plus the OPTIONAL layers a part may need (per-face
material, per-part sculpt) even though v1 only exercises the static-mesh subset —
later migrations extend it rather than fork it.

```
EditMesh = {                        // ONE PART
  verts:  V3[]                      // shared positions
  faces:  { loop: number[],         // vertex indices, 3–4+ (quad-friendly)
            uv?: V3[],              // per-corner UV into the atlas ← buildings' face-paint + player unwrap
            material?: number }[]   // atlas/material slot
  mounts?: MountPoint[]             // typed connectors — the Lego seam (Part 0) ✅ landed
  // optional, per-part, later: sculpt-displacement (a head you mould)
}
MountPoint = { name, type, kind: 'socket'|'plug', position: V3, axis?: V3, size? }  // ✅ landed
editMeshToGeometry(m) -> GeometryData   // ✅ fan-triangulate + Newell normals + bounds
// constructors (NOT separate techniques): cuboid()/cylinder() ✅; fromVoxels(),
// fromHeightfield(), fromCarveMask(), fromImportedSoup() — each mints/extends a part
// COMPOSITION (separate layer, design-gated): seat a child's plug into a parent's
// socket (orient by axis, snap by position) → an assembled whole → bake.
```

**Phase 0 — Data model + round-trip (keystone).**
Define `EditMesh`, write `editMeshToGeometry()`, register an `EditMesh`/`PolyMesh`
geometry. Add `geometryToEditMesh()` that welds the importer's coincident verts
back into topology, so a Blockbench `.glb` becomes an *editable* object, not
baked soup. Headless tests (the pieceShapes/worldParity idiom). *Deliverable:
import the car and have it be editable data.*

**Phase 1 — Editor shell + selection + move.**
New mesh-editor route reusing the workbench gutter shape and orbit/Embodied
camera patterns. Render the EditMesh; overlay vertex dots / edge lines / face
highlights; click + box-select into vertex/edge/face selection sets; a translate
gizmo to move the selection. *Deliverable: "edit mode" — with box primitives +
vertex move you can already rake a windshield and make the sloped body.*

**Phase 2 — The four ops.**
`extrudeEdge`/`extrudeFace`, `createFace`, `loopCut` (last — hardest), maybe
inset/bevel-lite. Each a pure `(mesh, selection) → mesh` with a headless test.
*Deliverable: full Blockbench-class mesh editing.*

**Phase 3 — UV atlas + paint.**
Auto box-projection unwrap → per-face atlas rects; route the existing `/cutout`
painter at the atlas; bake to the same `PaintedOverlay`/material the vehicle
already wears. *Deliverable: paint the UV like Blockbench.*

**Phase 4 — Adopt for vehicles (the real goal).**
Let a vehicle reference an authored EditMesh body + 4 wheel instances, replacing
the procedural body stack. Keep `buildVehicle` for fleet variety; the hero/body
shape becomes an authored single mesh. *Deliverable: "many faces" → one body +
4 wheels.*

### Sequencing notes / risks
- **Quad-dominant invariant.** Loop cut and clean UVs want quads. Triangulate
  only at the `editMeshToGeometry` boundary; keep faces as n-gons/quads in the
  edit model.
- **Normals.** Soup carries per-vertex normals; recompute from face winding on
  lower, with a smoothing-angle threshold for the faceted N64 look.
- **Don't rebuild what exists.** Ray-pick (`globeSurface` handle picking, host
  camera ray, canvas hit-test), the paint layer stack, OBJ/GLB I/O, and the
  geometry intern cache are all reusable. Per `survey-before-build`.
- **Import path is the cheap win** and a hedge: Phase 0 alone makes Blockbench
  round-trip into editable data, so the user is never blocked while Phases 1–2
  land. **Proven:** `cart/hmsc-int/Desk.glb` (FBX2glTF, full pos/normal/uv/index)
  already imports and renders via `importPropMesh.mjs`.
- **Export formats (USER, req_0945).** The user's Blockbench exports OBJ / glTF /
  FBX (no `.glb`). Reality of our importer: **OBJ works today** (the immediate
  path — `parseObj` reads `vt` UVs + normals, triangulates quads). **`.gltf`
  text** is a small add (same accessor walk as `.glb`, external/base64 buffer
  instead of the GLB BIN chunk) and is the cleaner format (carries the material
  ref). **FBX**: skip — glTF/OBJ dominate it for us. So: tell the user "export
  OBJ" for an instant result; add the `.gltf` text path when convenient.

### Convergence ledger (the long game — one silo at a time, each deletes a technique)

Order by leverage and risk; each row is a future migration ONTO the foundation,
not part of the v1 cut. Vehicle is the proving ground because it's pure static
mesh (no rig, no sculpt) and is the user's stated goal.

| # | Silo | Migrates by | Bespoke technique it deletes |
|---|------|-------------|------------------------------|
| 1 | **Vehicle** | author body as one EditMesh + 4 wheel instances | the ~60-box procedural stack |
| 2 | **Props** | imported/recipe meshes become EditMesh; recipes become constructors | bake-only soup; one-off recipe code |
| 3 | **Items** | voxel + bespoke generators become EditMesh constructors | the separate item-geometry + voxel pipelines |
| 4 | **Buildings** | piece face-slots become EditMesh per-face materials; openings become a `cutFace` op | the parallel `VisualBox` decomposition (watch the compile-parity contract) |
| 5 | **Player + Clothing** | turn on `weights` + `sculpt`; unwrap atlas is just per-face UV | bones-driven garment primitives; the Globe-only sculpt path |
| 6 | **World** | heightfield stays a constructor; large-scale terrain likely stays specialized | (may NOT fully converge — flag, don't force) |

Risks to honor: the **compile/worldParity** contract (buildings must bake
identically — migrate behind the parity suite), the **geometry intern cache**
(unbounded — keep params unit + scale via transform, per memory), and **rig/
sculpt are real complexity** — don't promise them in v1, just don't design them
out.

---

## Part 4 — THE FIRST SLICE (USER-defined, req_0946)

The user tested Blockbench to learn how it handles modeling and judged it a
better approach than Blender, replicable here. They scoped the minimum first
slice explicitly — **the basics it all rides on, BEFORE extrude / create-face /
create-edge / loop-cut.** Reference shots are Blockbench's Edit mode; the target
is to match its *feel*, not its chrome.

**Build order of the first slice:**

1. **Workspace + camera (the crux).** A staging area: dark checker bg, a ground
   grid (coarse tiles + a finer center subgrid), an origin axis indicator
   (X/Y/Z). **The user's explicit warning: "the camera is a large part of the
   battle that can't be overlooked."** Our existing sculpt staging (the Globe/
   head UV-drag tool — its shot below) has a *poor staging area and camera*, and
   that's the thing to beat. Build a proper orbit/pan/zoom camera with correct
   framing on the mesh bounds FIRST; treat it as a first-class deliverable, not
   trim. Likely reuse `@reactjit/cameras` Orbit / `editors/sculptCamera.ts`, but
   the bar is the Blockbench feel, not the current sculpt camera.
2. **Outliner = our existing layers component.** Reuse the paint editor's layers
   component as the OUTLINER (survey-before-build): each layer is a mesh element,
   with an eye/visibility toggle. One mesh per layer.
3. **Add Mesh dialog.** Pick a shape we already have working (cuboid, cylinder,
   any registry shape) + dims (the Blockbench "Shape / Diameter / Height"
   dialog). **Place it exact at 0,0,0 sized to its dims** (the user's "place it
   exact at 0,0 for its size").
4. **Transform panel.** Position / Size / Pivot / Rotation numeric fields per
   element (host sliders + entry per the UI control laws).
5. **Selection modes: Face / Edge / Vertex** — a mode toggle. Render the right
   overlay per mode (face highlight · edge line · vertex dots), ray-pick + click
   to select (multi-select), and a **translate gizmo** (X/Y/Z arrows) to move
   the selection — moving verts/edges/faces edits the EditMesh, re-lowers, and
   re-renders live.

**Explicitly NOT in this slice:** extrude, create face/edge, loop cut. Those
are the next slice, and they all ride on the topology + selection this slice
establishes.

**What we already have toward it:** vertex UV-dragging exists today (the Globe/
head sculpt tool) — so the *drag-a-handle-on-a-mesh* mechanic is proven; it just
needs the real staging/camera and to operate on the EditMesh's verts/edges/faces
instead of the sculpt grid. And our `/cutout` UV painter grid "has a lot in
common" with Blockbench's UV display already — the UV panel is a partial head
start, not a from-scratch build.

**Scope mapping:** this slice = Phase 0 (minimal `EditMesh` + `editMeshToGeometry`
+ shape constructors, no UV/material/weight layers yet) fused with Phase 1 (the
edit-mode shell: workspace/camera, outliner, add-shape, transform, face/edge/
vertex select + move gizmo). The genuinely-new work is the **camera/staging**,
the **selection overlays + ray-pick**, and the **move gizmo**; the outliner,
transform panel, and add-dialog reuse existing components.

### Part 4a — The viewport is a HOST PRIMITIVE (USER, req_0947)

The user's ruling on the staging/camera: **the entire modeling canvas must be a
host primitive — like `<Canvas>` / `<Graph>`, but for 3D modeling — with the
camera owned by the host so movement is butter-smooth.** Feel target: exactly
Blockbench — camera pinned to the center of the empty grid, the object sculpted
on it. Plus display-mode settings: **solid · textured · wireframe · uv · face
orientation.**

Why this is correct (and what's new):
- **`Scene3D` today is NOT a host primitive** — it's a `<View>` with a
  `scene3d: true` flag; `framework/gpu/3d.zig` reads the flags and renders via
  wgpu. The camera *node* is host-solved per frame (V23/V26), **but the camera
  *control* round-trips through JS** (the `sculptCamera` hook catches each drag
  and posts yaw/pitch deltas). That per-drag JS hop is the gap to "buttery."
- **`Canvas`/`Graph` ARE true host primitives** (`node.canvas_type != null`):
  the host owns pan/zoom directly, React isn't in the drag loop. Memory:
  `[[canvas_view_control_props]]` — view = props re-applied on change + host
  drift, parsed in `v8_app.zig` applyProps. That's the template to mirror in 3D.
- **The build:** a new host primitive (a 3D viewport whose host side owns the
  orbit/pan/zoom pinned to grid origin, the grid+axis staging, and the
  render-mode switch), reusing the existing `gpu/3d.zig` wgpu renderer
  underneath. **New render modes needed:** wireframe, uv, face-orientation
  (solid + textured exist). This is FRAMEWORK (Zig) work → rebuild required, not
  hot-reload. It is the foundation the whole editor sits on; do it first and get
  the feel right before layering selection/gizmo on top.
- **Proposed shape (for confirmation):** `<Studio>` (working name — a short
  drawing-surface noun in the `Canvas`/`Graph` register) with host-owned camera
  + `displayMode="solid|textured|wireframe|uv|faceOrientation"`, taking the
  EditMesh as its content. Selection overlays + gizmo render into the same
  host viewport.

### Part 4b — Three crucial studio overlays (USER, req_0948)

All three are **host-rendered, screen-stable overlays** owned by the `<Studio>`
primitive — which is precisely why host-ownership matters (constant pixel size,
correct every frame, no JS in the draw loop). They are must-haves, not polish:

1. **Always-on positional compass.** A small view-orientation axis gizmo pinned
   in a viewport corner (Y green up · X red · Z blue, negative axes as dim
   dots). It rotates to reflect the camera's orientation but stays fixed in the
   corner at constant size — the "which way am I looking" readout. (Blockbench's
   is also click-to-snap-view; treat snapping as a nice-to-have, the readout as
   the must-have.)
2. **Fixed 3-arrow transform gizmo on selection.** When an edge/face/vertex is
   selected, a 3-axis arrow gizmo (X red · Y green · Z blue) appears at the
   selection — **world-axis-aligned and constant screen size regardless of
   camera angle or zoom** (it does NOT shrink with distance). This IS the move
   gizmo from the first slice; the requirement here is that it's screen-space
   scaled and orientation-stable.
3. **Ground grid.** The floor plane everything sits on, with the origin axis
   lines crossing at center (red X · blue Z) — the spatial anchor that makes the
   model read as *placed*, not floating in black (the fix for the current sculpt
   staging). Objects rest on it at the origin.

Implication: the `<Studio>` host primitive's render layer = staging (ground grid
+ origin axes) → mesh (in the active display mode) → selection overlay → fixed
transform gizmo → corner compass. All host-side, all screen-stable.

### Part 4c — Gizmo snapping + the concave Auto-Fix guard (USER, req_0949)

Two behaviors that ride the transform gizmo and the edit-commit flow:

1. **Drag snapping with modifiers.** The move gizmo **steps by one grid unit** in
   the drag direction by default; **Shift = sub-steps** (finer increment); **Alt
   = free-form** (no snap). Standard Blockbench modifier scheme — bake it into
   the gizmo drag from the start.
2. **Concave-quad Auto Fix — a FIRST-CLASS studio idea (the user: "absolutely a
   life saver").** When a gizmo move would leave any quad face **concave** (a
   reflex vertex / non-convex loop — which breaks UV interpolation and
   triangulation), the studio catches it **before committing** and surfaces a
   guard dialog (Blockbench's exact pattern):
   - **Split Quads (recommended)** — triangulate the offending quad(s) along the
     diagonal that restores validity;
   - **Revert Edit** — undo the move;
   - **Ignore** — keep it as-is.

   Design notes: concavity test = the quad's consecutive-edge cross products
   change sign (convex ⇒ all same sign); a pure `(mesh, faceIds) → offenders`
   check + a pure `splitQuad(mesh, faceId)` op, both headless-tested (the
   pieceShapes/worldParity idiom). This guard is WHY the quad-dominant invariant
   holds in practice — it's the rail that keeps edits from silently corrupting
   UVs/triangulation. Wire it into the edit-commit path from the first gizmo
   move, even though extrude/loopcut (which also create quads) arrive later.

---

## Part 5 — UV → texture pipeline (USER, req_0994–0996) — SPEC, design-gated

The user drove a long Blockbench side-by-side to nail down how UVs MUST behave,
because the UV layout is not a preview — **it becomes the paintable texture
atlas**, which is the seed of the whole texture-authoring (incl. image-to-image
AI) pipeline. Our `req_0981` UV preview is wrong at BOTH the data and display
layers; this is the corrected model + the phased build. Confirmed verbatim across
the thread ("Yep. That's correct").

### 5.0 — Root cause of "ours looks wrong"

Ours has **no stored UVs**. `editors/model/editMesh.ts` `unwrapMesh()` PROJECTS
every face from the LIVE vertices on each render (box-projection by dominant
normal, sized to the face's CURRENT dims, shelf-packed into separate rects). So:
- pulling an edge/vertex re-projects → the UV mutates on geometry edits (header
  shows "live from mesh", dims drift 33×50→33×54→41×56);
- a loop cut re-derives the whole set instead of splitting a stored island;
- the layout is 6 separated rects, not an atlas.

Blockbench stores UVs as DATA and only restructures on TOPOLOGY change.

### 5.1 — The Blockbench-parity UV model (the law)

1. **UVs are per-corner DATA on the face** (`EditMeshFace.uv`, the slot designed
   in at Phase 0, currently unused), in a **fixed square texture space** (16×16
   default; 32/64… is just resolution). Assigned ONCE — at `cuboid()` mint (the
   box-net) or an explicit "Unwrap" action — then STICKY.
2. **A face's UV rectangle is fixed in texture space, independent of its 3D
   shape.** Top face = full `0,0,16,16`; a slanted front face = `0,0,16,8`
   regardless of slant/stretch. Geometry edits (gizmo translate/scale, any vert
   move) **never touch `uv`**. → pulling edges/verts stops changing the UV.
3. **Cuts subdivide WITHIN the parent's rectangle; sub-faces share it.** `loopCut`
   interpolates UV for each new vertex (parametric along the edge it splits). The
   children split the parent's UV island; the outer boundary is preserved.
4. **Notches are free and load-bearing.** A cut's new vertex lands on the edge
   SHARED with a neighbor, so it enters BOTH faces' loops with an interpolated UV
   — an un-cut neighbor shows an indent on its UV boundary where the cut met its
   edge. This falls out of per-corner UVs riding shared verts; do NOT special-case
   it. (It's the proof the model is right.)
5. **`unwrapMesh` demotes** from a per-render derivation to an on-demand "Unwrap"
   action (only when Blockbench would recompute — explicit unwrap / first mint).

### 5.2 — The UV editor is SELECTION-SCOPED

Blockbench's UV panel shows the SELECTED face's UV island, outlined, against the
ONE fixed texture square (with its notches) — NOT all six islands in a grid.
Select front → its `16×8` rect; select top → the full `16×16`. Our panel's
always-all-6 "live from mesh" grid is the display bug. Rewrite: render the
selected face's island over the fixed texture square; keep a small "all faces"
overview toggle.

### 5.3 — WHY it matters: the atlas IS the texture (the real goal)

Once the islands pack into ONE square atlas, that atlas is simultaneously: the
**paint surface** (paint a texel → it paints the face region the texel maps to),
the **export guide** for image-to-image (island outlines + region tints + labels
→ AI prompt → texture back), and the **sampled texture** on the mesh (the face
reads its texels via the stored UV). The user's workflow: model → unwrap/arrange
islands → export atlas guide → image-to-image ("low-poly beat-up sedan texture
atlas, blue body, black windows…") → bring back → preview on mesh → fix regions →
**bake as a content-addressed texture asset**. This is the convergence with the
existing pipeline (survey-before-build, don't reinvent): the **painter**
(`editors/paint`, the shared paint surface), the **textures door**
(`game/textures/` — materials/decals/registry, content-addressed per
`[[project_decal_editor_textures_door]]`/MAPFORMAT), **2D-on-3D faces**
(`StaticSurface staticKey → Mesh textureKey`, `[[twod_on_3d_faces]]`), and the
**material pipeline** (`[[project_hmsc_material_pipeline]]`). The atlas produces a
texture the mesh samples via material/`textureKey`; the painter routes AT the
atlas; the bake uses the textures door's content addressing.

### 5.4 — Phased build (each phase independently useful)

- **Phase 5a — UV as stored data (the foundation; fixes "looks wrong").**
  `EditMeshFace.uv` populated. `cuboid()` writes the box-net; `loopCut`
  interpolates new-vert UVs (notches free); gizmo/vert ops never touch `uv`;
  `unwrapMesh` → on-demand "Unwrap" action. Panel rewrite: selection-scoped island
  over the fixed texture square + an all-faces overview toggle. Headless tests
  (UV survives a vert move unchanged; a cut subdivides within the parent rect; a
  neighbor gains a boundary notch). **This is the next thing to build.**
- **Phase 5b — one square atlas.** Pack islands into the fixed square (16/32/64);
  the panel shows the real atlas; export the atlas GUIDE image (outlines, region
  tints, labels).
- **Phase 5c — paint the atlas.** Route the existing painter at the atlas; preview
  on the mesh via material/`textureKey`; bake content-addressed (`game/textures`).
- **Phase 5d — image-to-image.** Send the guide out, bring the generated texture
  back onto the atlas; clean/fix regions; re-bake. (The AI texture-authoring step.)

### 5.5 — Phase 5c build spec (req_1060) — DESIGN-GATED, survey done, confirm before build

**Survey finding — the cutout painter is a near-exact template (don't re-roll).**
`editors/cutout/ModelPreview.tsx` already does the whole "paint a texture, see it
on the 3D model live" loop the Studio needs:
- the SHARED painter (`editors/paint/usePaintEditor.ts` + `PaintQuad`/`PaintSurface`)
  paints layers straight into GPU paintable textures (dabs never touch React state —
  the perf invariant);
- ONE offscreen `<StaticSurface staticKey=…>` captures the painted layers (a
  `PaintQuad` per visible layer sampling the painter's live masks) into a live
  texture (re-baked on a throttled P2 clock — the StaticSurface inline-prop rebake
  hazard turned into the bake tick, `[[static_surface_inline_props_rebake]]`);
- a `<Scene3D.Mesh textureKey={thatStaticKey}>` samples it — so painting the 2D
  surface paints the model, because the mesh's UVs index into the atlas.

The Studio already has the two halves this needs: `editMeshToGeometry` passes REAL
per-corner UVs through (so a textured mesh samples the atlas correctly), and the UV
panel already draws the stored box-net layout (`storedUVLayout`). Phase 5c =
**route the cutout's paint→StaticSurface→textureKey loop at the Studio's active
part, with the atlas = the box-net.** The bake (content-addressed via
`game/textures/`, `[[project_decal_editor_textures_door]]`) is the FOLLOW-UP after
the live paint loop reads right; the textures door's material/registry is where a
finished atlas lands as a reusable asset.

**The pieces to build (after the interaction is confirmed):**
1. **`createTexture` op** — `EditMeshFace.material` slot + an atlas descriptor on
   the part (size 16/32/64). `unwrap()` already box-nets + remaps the UVs into the
   packed atlas; "create texture" calls it (the box-net IS the texture layout, the
   req_1004 distinction) and mints a paint document sized to the atlas.
2. **The paint surface** — mount the shared painter over the atlas resolution. WHERE
   it lives (a Studio `paint`/`texture` mode beside the viewport vs. the 2D atlas
   panel growing paint controls vs. the standalone paint workbench source targeting
   the Studio part) is the INTERACTION QUESTION for the user (Blockbench shows a
   Paint tab: paint on the 3D model directly AND on the 2D texture/UV view, with a
   Textures list panel).
3. **Live preview on the part** — the active part's `Scene3D.Mesh` gets `textureKey`
   pointed at the painter's live `StaticSurface` capture (the cutout pattern, keyed
   per part so a multi-part model doesn't collide on the 48 DYN slots / one live key).
4. **Bake** — freeze the atlas to a content-addressed texture asset (`game/textures`)
   that the material/registry holds, so a textured part ships baked (the
   React-3D-is-authoring rule, `[[react_3d_is_authoring_not_runtime]]`).

**Scope honesty:** this spans the painter + the textures door + the Scene3D texture
path; it is the LARGEST of the req_1060 three and is design-gated. Items 1 (encoded
shape readout) + 2 (delete saved meshes) land first; 5c builds after the user
confirms WHERE the paint surface lives and the create-texture entry point.

**STATUS UPDATE (req_1062):** texture-mapping step 1 LANDED (a per-part `create
texture` box-net + the offscreen atlas the mesh samples). The user then specified the
REAL Blockbench flow (req_1068/req_1069), which SUPERSEDES the per-part button below
— see 5.6.

### 5.6 — The Blockbench "Create Texture" flow (USER req_1068/req_1069) — the real spec

The user drove a Blockbench side-by-side and gave the exact target: a **GLOBAL
"textureize" button** that takes the WHOLE SCENE and "builds a perfect sprite map"
(image: a random multi-face shape → its UV goes from the overlapping 16×16 default →
a clean 64×64 packed atlas of colored islands). Clicking it opens a **Create Texture
dialog** whose questions "matter" — they are the pack parameters. This is the real
Phase 5c; the req_1062 per-part button is a stepping stone.

**The dialog (Blockbench's exact fields, decoded):**
- **Name** — the texture's name.
- **Type** — `Texture Template` (the colored per-island UV template, the default +
  the point) | `Solid Color Template` (one flat color) | `Blank` (empty/transparent).
- **Pixel Density** (`16x` default; 16/32/64/128…) — texels per model unit (our unit
  = a Blockbench pixel, 16 u = 1 tile, so 16x ≈ 1 texel/unit; 32x = 2×, …). Sets atlas
  resolution.
- **Color** — the fill for Solid Color type (disabled otherwise).
- **Rearrange UV** (on) — REPACK the islands into an optimal atlas (vs. keep current
  UV positions). This is what turns the overlapping default into the packed sprite map.
- **Power-of-2 Size** (on) — round the atlas to a power-of-two square (16/32/64/…).
- **Keep Multi Texture Occupancy** (on) — when faces already sit on multiple textures,
  preserve that. (Deferred — we have one atlas today.)
- **Combine Islands** (on) — merge adjacent faces into one island where the dihedral
  angle is under the thresholds (fewer seams). (Phase-2; first slice = per-face islands.)
- **Edge Angle Threshold** (36) / **Island Angle Threshold** (45) — the angle gates for
  Combine Islands. (Surfaced; effective with the combine step.)
- **Padding** (on) — a gutter between islands in the atlas (stops texel bleed).

**The pack (the sprite map):** gather every face of every visible part, project each to
its 2D island (reuse `unwrapMesh`'s per-face projection), scale by Pixel Density, shelf
/ bin-pack ALL of them into ONE square atlas (Padding gutters, Power-of-2 rounding),
and **rewrite every face's `uv` to its packed slot** (normalized into the shared atlas)
— so all parts sample ONE global texture. The `Texture Template` render fills each
island a distinct pastel + a per-texel grid + the island outline (image-4 look). The
new UVs are BRANCH (a `partMeshUpdated` per part → persisted + undoable); the texture
SETTINGS (name/type/density/atlas size) ride a twig + deterministic per-island color
for the first slice (persisting a real texture-doc artifact is a follow-up).

**5.6a — Cookie-cutter outlines → piece-by-piece image-to-image (USER req_1069) — the
WHY.** Each island's **UV outline is saved as a "cookie cutter"** (a silhouette mask).
That unlocks the AI texture flow PIECE BY PIECE: send ONE island's region to an
image-to-image model ("generate a texture for this piece"); **if the model overshoots
the outline, that's fine** — the cookie-cutter MASKS the result to the island
silhouette, then it's **scaled back into that island's slot in the total atlas**. So
the texture is authored island-by-island (AI or paint), each masked to its own shape
and composited into the shared sprite map. **Architecture requirement (fold in NOW):**
the packer's output must expose, per island, its **outline polygon + atlas slot rect**
(the cookie cutter + where it lives), so the mask→generate→clip→composite step is a
clean follow-on. The actual image-to-image call + masked composite is Phase 5d (the AI
step); the packer built now must carry the outlines so 5d needs no re-pack.

**Build order:** (1) the pure global packer (`textureize.ts`, headless-tested) carrying
per-island outlines + slots; (2) the Create Texture dialog (faithful fields); (3) wire
the GLOBAL textureize button → dialog → confirm → rewrite all parts' UVs + show; (4) the
global colored sprite-map render (all parts sample the one atlas). Deferred with the
architecture in place: Combine-Islands angle merge, Keep-Multi-Texture, texture-doc
persistence, and **5d** (per-piece masked image-to-image via the cookie cutters) +
painting the atlas.

### 5.6b — Phase 5d: AUTOMATED image-to-image (USER req_1070/req_1110) — SPEC, design-gated

The manual AI loop today is: textureize → **export slice/sheet** PNG → run it through an
external image model yourself → **import slice/sheet** PNG. Phase 5d automates the middle.
The whole pipeline was DESIGNED WITH THE USER in req_1070 (an earlier session) before the
texture pipeline had even shipped; this is its build leg, now that the cookie-cutter
round-trip (req_1079) gives it a landing surface.

**Architecture (USER-RULED, req_1070):**
- **`useAssistant` is WORDS ONLY.** It is the text/agent worker (`runtime/hooks/useAssistant`).
  It drives OPTIONAL prompt enhancement — never the pixels. Image generation is a plain HTTP
  POST, not an assistant turn.
- **Generation REUSES `cart/image-gen`** — the nano-gpt client (the user's "aggregate provider
  with a ton of image models": seedream, nano-banana, riverflow, wan, …). The rule-of-two
  extraction `generateToBase64(prompt, options, refsB64[])` (network only, no disk) is the
  shared core; `buildPayload` already supports img2img via `body.imageDataUrls`, `b64_json`
  back, key from `db.getActiveApiKey()`. A `data:image/png;base64,…` result drops straight into
  the atlas (`image_cache.zig` decodes data URLs) — same path `importTexture` already uses.
- **Deterministic cart-driven spine NOW; agentic `generate_texture` tool LATER** (the assist3d
  `SET_SCENE_TOOL` pattern — conversational "make it more weathered"). Plus a **bypass toggle**:
  enhancement is optional, a switch sends the raw prompt direct.

**The flow (per generate):**
1. **Target** = a SLICE (selected face's island = the cookie cutter) or the WHOLE sheet — the
   same two targets export/import already offer.
2. **Prompt** — the user types a description; the scene/part name is folded in. **Enhance
   toggle:** ON → ONE structured `claude_code` turn via `useAssistant` expands it; OFF → the raw
   prompt goes direct.
3. **Reference (img2img)** — the CURRENT atlas slice/sheet, rasterized (`rasterizeAtlas`) →
   base64 → passed as the `imageDataUrls` reference, so the model paints WITHIN the existing
   island shape/colors. (The user framed this as "img2img for textures," so sending the current
   art as the reference is the default; a no-reference text-to-image mode is the toggle's other
   half.)
4. **Generate** — `generateToBase64(prompt, { model }, [refB64])` → b64.
5. **Composite** — drop the result into `tex.sliceImages[partId:faceIndex]` (slice) or
   `tex.imageUrl` (sheet) + bump `imageRev`. This is the EXACT path `importTexture` drives, so
   the cookie-cutter slot-clip + StaticSurface re-bake are already handled. (True polygon-
   silhouette masking beyond the rectangular slot is a SHARED follow-up for both the import and
   the AI path — `TextureIsland.outline` is saved for it.)

**UI (the design-gate question for the user):** an **"ai fill"** button beside import slice/
sheet opens an `AiTextureDialog` (mirrors `ImportTextureDialog`): a prompt field, the enhance
toggle, a model picker (the `config.ts` model list, default seedream-v4), a generate button, and
a small status line (enhancing → generating → done; reuses the export toast). Confirm the shape
(dialog vs docked panel; img2img-vs-text default; model default) before building.

**Build order:** (1) ✅ extract `generateToBase64` (rule of two). (2) ✅ the `AiTextureDialog`
+ the "ai fill" / "ai fill slice" triggers. (3) ✅ the enhance turn — nano-gpt TEXT model
(req_1113) OR `useAssistant` claude_code, behind the bypass toggle. (4) ✅ wire generate →
composite through the existing slice/sheet twig path (`applyTextureImage`), with the large-
texture file-ref (`texSource`). **ALL SHIPPED (req_1112/1113/1118) — see the BUILD LOG entry above.**
**Key store (req_1118):** the nano-gpt key is NATIVE to hmsc-int (`localstore`, entered in the
dialog's "api key" field) — the pure client was split into the DB-free `image-gen/client.ts` so
hmsc-int never imports Postgres. Zero `__pg_` in the Studio bundle, NO dev-host rebuild. Deferred:
the agentic `generate_texture` tool; true outline (silhouette) masking beyond the rect slot;
batch "fill every island."

---

## Part 6 — Pivot points + joints (USER, req_1025) — SPEC, design-gated

The next tool after the edit-ops slice. **DESIGN-GATED** (req_0950): the interaction
is specced here and confirmed with the user (Blockbench side-by-side) BEFORE the
viewport build; the pure data layer is safe to land + unit-test first (it is). This
is the keystone of BOTH downstream arcs — **composition** (Part 0: seat a child's
plug in a parent's socket) and **animation** (`[[project_animation_workbench_plan]]`:
rotate a part about its pivot) — so the data must serve both, not one.

### 6.0 — The user's words + the decode

> "the next thing they are going to pick up on is setting pivot points for a layer,
> this pivot point is going to also require joints. so like the center of a wheel is
> a pivot point, and then the location in the wheelbase of the model, is the joint.
> this lets us put pivots inside of things that will rotate like shoulders, or
> tires. and their joint locations."

**CORRECTED MODEL (USER, req_1025 follow-up — supersedes the first read).** Pivot
and joint are ASYMMETRIC and live on DIFFERENT parts — pivot on the child, joint on
the parent — exactly like a skeleton (the convergence target, Part 0):

> "the joint would be like saying ok here is an arm and here is a torso. the torso
> gets a joint point up in the area of the body where it would be considerably your
> arm pit, and then the arm itself, gets a pivot point that says i will connect to a
> joint right here. i can swing on the joints axis. so the joint is what says you
> can rotate this far this way, or this way, or full rotate (tires) where the pivot
> says 'here is where i connect, everything downstream from me is affected by the
> joint control'… an arm has a pivot, the body has a joint. the joint says it can
> turn 90deg forward and 90deg backward, that gives the pivot 180deg of rotation it
> can follow"

- **Pivot** = on the **child** (the arm). The part's **rotation origin** + "here is
  where I connect upward; everything downstream of me follows the joint's control."
  Part-local, ONE per part (Blockbench's per-element pivot; a bone's parent-end).
  It carries NO limit — it FOLLOWS the joint it connects to.
- **Joint** = on the **parent** (the torso, at the armpit). A `MountPoint` (the Lego
  seam, Part 0) that is the **authority on the constraint**: it owns the `axis` AND
  the **rotation `limit`** — "90° forward, 90° back" → 180° of travel the child's
  pivot may follow, or **full** (a tire spins freely). N per part.
- **A part can be both.** An upper arm has a *pivot* at the shoulder (connects up to
  the torso's joint) AND a *joint* at the elbow (the forearm's pivot connects there).
  This is the bone graph: each bone = a pivot (to its parent) + joints (for children).
- **Connection:** at composition/animation time a child's pivot snaps to a parent's
  joint; the child swings about the joint's `axis`, bounded by the joint's `limit`.

### 6.1 — The data model (the law) — SAFE TO LAND, mostly free

**Pivot lives on `EditMesh` alongside `mounts` — NOT on `StoredPart`.** Both are
"part data" of the same category (rotation origin + typed attach points) that the
bake/composition/animation read off the mesh. Consequences, all of which fall out
for FREE from the existing architecture (survey-before-build):

1. `EditMesh.pivot?: V3` (part-local). **Absent = the live bounds center**
   (`meshBoundsCenter`); once explicitly set, it is STICKY — geometry edits
   (`translateVerts`/`scaleVerts`, the gizmo) NEVER move it (the spread keeps
   `m.pivot`), exactly like Blockbench and exactly like `uv`.
2. `mounts: MountPoint[]` already exists; joints = authoring entries in it, now
   carrying a **`limit?: { full?; min?; max? }`** (degrees from rest) — the
   constraint the joint imposes on its child (`jointTravelDegrees(j)`: full → 360,
   else max−min; a shoulder −90..+90 = 180°). The pivot carries no limit; it
   FOLLOWS the joint.
3. **Persistence is free:** `StoredPart.mesh` serializes the whole `EditMesh`, so
   `pivot` + `mounts` round-trip through V20 with zero stream changes.
4. **Undo is free:** a pivot/joint edit is an `EditMesh` swap → it rides the
   existing `partMeshUpdated` event, whose `inverseOf` already restores the prior
   mesh. So `studioModel` needs NO new event and NO new mutator — the viewport
   calls `onEditMesh(id, setPivot(mesh, p))` / `…addMount(mesh, j)` like every
   other op. (Optionally a nicer undo LABEL than "edit mesh" — cosmetic only.)

Pure helpers added to `editMesh.ts` (headless-tested, the keystone idiom):
`meshBoundsCenter(m)`, `pivotOf(m)` (stored ?? bounds center), `setPivot(m,p)`,
`addMount(m,mount)`, `updateMount(m,name,patch)`, `removeMount(m,name)`,
`renameMount(m,old,new)` (auto-uniquifies — the name is a binding key),
`jointTravelDegrees(j)`.

### 6.1a — Naming + the binding addressing scheme (USER req_1052)

Pivots + joints are NAMED so a composition layer can bind them by address:

> binding `tires.offroad_left.pivot` to `trucks.tundra.joint.back_left`

The scheme is **`<library>.<model>.pivot`** (the part's one pivot — singular, so no
name needed) and **`<library>.<model>.joint.<name>`** (a named socket; a part has
many — `back_left`, `front_right`, …). So a JOINT's `name` is its **binding key**
and must be unique within the part (`renameMount` auto-suffixes a clash, loud not
silent). `type` stays the COMPATIBILITY class (`axle`/`shoulder` — `mountsCompatible`):
a truck's 4 joints are all `type:axle` but named differently; a wheel's pivot binds
to the chosen one by name. **The model name carries the left/right variant** —
`offroad_left` vs `offroad_right` are two saved models, see 6.1b.

### 6.1b — The mirror problem: save both views (USER req_1052)

A wheel "has one correct outward face" (the hubcap faces out), so a left and a right
wheel are MIRROR images. Decision: **save both views as separate models** (the
general approach — works for everything); **script-mirror is a tires-only shortcut**
(it "doesn't always work for everything, just for tires it does"). A `+ mirror`
duplicate (flip a model across an axis → a new saved model) is the obvious helper to
make the both-views workflow one click — a follow-up, not yet built.

### 6.1c — Metadata lives in column 3, under the UV unwrap (USER req_1053)

The outliner is a reused paint `LayerStrip` (name + visibility only) — "not built
for this type of extra data." So a layer's rig METADATA (the pivot + named joints
with type/axis/limit) lives in **workspace column 3, under the UV unwrap**
(`RigMetaPanel`, hosted by `model/source.tsx`'s panel as the `RIG` group). Clean
split: **column 3 = the data** (names/types/limits, the binding keys); **the
viewport = the placement** (the gizmo positions the pivot/joints in space). Both
read/write the one shared studio store, so they never diverge. The floating
viewport joint panel was REMOVED (its job moved here — no duplication).

### 6.2 — The interaction (CONFIRMED req_1025 follow-up — build it)

A **new editing mode** in the existing element toolbar, alongside
object/vertex/edge/face: **`rig`** (working name — it authors the part's rig data:
its pivot + its joints). It does NOT select mesh elements, so it is treated like
`object` by the selection machinery (no vertex/edge/face pick); it has its own
handle set + gizmo branch.

In `rig` mode the viewport shows, for the active part:
1. **The PIVOT handle** — an orange crosshair/ball at `pivotOf(part.mesh)` (lifted
   like every overlay). ALWAYS present (every part has a pivot — its rotation origin
   + upward-connection point). Click it → the **existing `TransformGizmo` (move)**
   appears on it; drag to place (snapped via `snapToStep`, live `gizmoReadout` in
   units — all reused). This is the arm's shoulder point ("here is where I connect").
2. **JOINT markers** — each `MountPoint` (socket) drawn at its `position` with a
   short **axis arrow** (the spin axis the child swings about) and a **limit arc**
   (the allowed travel; a full ring for tires). Click one → the move gizmo places
   its `position`; an inline panel sets its `type` (free text / suggested
   axle/shoulder/hip/neck/spoiler…), `axis` (3 axis buttons), and the **limit**
   (min°, max°, or a **full** toggle). This is the torso's armpit / the body's axle.
3. **`+ joint`** button — adds a socket `MountPoint` at the bounds center (drag it to
   the armpit/wheelbase), axis +Y, a default hinge limit (−90..+90). A selected
   joint can be removed.

Because pivot and joint are different roles on (usually) different parts, a single
part typically authors its pivot (if it rotates) and/or its joints (if children
attach to it) — and a part can carry BOTH (an upper arm: shoulder pivot + elbow
joint; a wheel: a pivot on the body's axle joint AND its own hub joint that a
spinner's pivot connects to — chains/nests freely, req_1025 follow-up).

Reuse, do NOT re-roll (the whole point of the slice that came before): the
`TransformGizmo`, `pickGizmoHandle`, `axisScreen`, `dragWorldDistance`,
`snapToStep`, `gizmoReadout`, the `makeProjector` overlay, and the `onDown/onMove/
onUp` drag flow. The `rig` branch is a new anchor + handle set fed into the SAME
gizmo machinery — like the loop-cut slide gizmo (req_1022) is.

### 6.3 — What it feeds (design for BOTH, per Part 0 / Part 0a)

- **Animation** rotates a child about its `pivotOf(mesh)` around the connected
  joint's `axis`, bounded by the joint's `limit` (the shoulder's 180° of travel).
- **Composition** seats a child (pivot) onto a parent's joint (`mountsCompatible`
  gates the type match): align the pivot to the joint `position`/`axis`. The chain
  nests (wheel→spinner) and is severable at runtime (Part 0a).
- So a `MountPoint` keeps room for a runtime `attached|detached` state later (Part
  0a) — don't bake a weld-only joint.

### 6.4 — Phased build

- **Phase 6a — data layer (SAFE, land now).** `EditMesh.pivot`; `meshBoundsCenter`/
  `pivotOf`/`setPivot`/`addMount`/`updateMount`/`removeMount`; headless tests
  (default pivot = bounds center; set pivot sticky under a vertex move; add/patch/
  remove a mount; mounts+pivot round-trip a `partMeshUpdated` reopen + inverse).
- **Phase 6b — the `rig` viewport mode (GATED — after confirmation).** The mode
  toggle; the pivot handle on the move gizmo; joint markers + the `+ joint` / select
  / drag / set-type / set-axis affordances; commit via `onEditMesh`.
- **Phase 6c — convergence (later, design-gated).** The composition layer consumes
  pivots + joints to assemble parts (Part 0); the animation workbench rotates about
  them (`[[project_animation_workbench_plan]]`).

---

## Part 7 — THE ASSET COMPILER (USER req_1122/req_1123) — SPEC, design-gated

> **The finish line of the whole Studio arc.** Everything up to Part 6 made the
> Studio a complete *modeler* (shape → rig → texture). Part 7 turns a Studio model
> into a **typed, cooked, installed, catalogued, placeable/equippable game asset** —
> the asset's MEANING explicit at compile time, not inferred later. Reference docs:
> the user's `HMSC-INT Architecture and Studio Asset Pipeline` brief ("BSP files,
> but for assets") and the req_1122 handoff. Constitution: V28 platform/mod split
> (compile output = a game package), V29/V30 map format (bake-by-execution →
> content-addressed assets; mapfile = lump bundle of references), and
> `[[react_3d_is_authoring_not_runtime]]` (author in React, ship baked data).
>
> **This part is DESIGN-GATED (req_0950): this spec is confirmed with the user
> BEFORE building, then built kind by kind, prop first.**

### 7.0 — The one idea: a Studio model is just another COMPILE INPUT

The compile already treats the game as baked data (`compile/bakeGameFile.ts`):
editor streams → `createHmscMapfile` → RJMP lump container → the no-V8
`world_loader.zig` reconstructs the world. The asset compiler is **another input
beside world / build / props / decals**, with the SAME shape: a Studio source
cooks to content-addressed installable data that maps reference by id/hash.

```
Studio model (StoredModel: EditMesh parts + rig + textureized atlas)
      | choose KIND → fill descriptor → validate → COOK
      v
cooked asset  (one mesh soup + a compressed texture + collision/bounds +
               mounts + a TYPED gameplay descriptor + content hash)
      | INSTALL (upsert into the cooked-asset V20 stream, keyed by hash)
      v
content store + catalog  (the kind's palette gains the cooked asset)
      | PLACE / EQUIP / ATTACH  (a WorldProp.kind = the cooked id, etc.)
      v
bake (worldGeometry → MESH_PROPS lump + descriptor) → world_loader renders it
```

### 7.1 — The surveyed reality this rides on (survey-before-build)

The pipeline is **mostly reuse**. The survey found every piece already present:

| Need | Already exists | File |
|------|----------------|------|
| Studio source (parts + rig + atlas) | `StoredModel` / `StoredPart` / `EditMesh` (pivot, mounts, per-face uv/material) | `editors/model/modelStream.ts`, `editMesh.ts` |
| mesh → render soup | `editMeshToGeometry(m) → GeometryData` (8-float pos3/nrm3/uv2) | `editMesh.ts` |
| **a real-mesh prop, baked + loaded** | the **imported-prop** path: `ImportedPropMesh.vertices` (the SAME 8-float soup) → `MESH_PROPS` lump via `collectImportedMeshProp` → loader renders arbitrary baked verts referenced by a thin transform | `game/kinds/importedProps.ts`, `compile/worldGeometry.ts` (`pushPropGeometry`'s `isImportedPropKind` branch), `world_loader.zig` |
| the prop catalog / descriptor | `PropKindDefinition` + `PROP_KIND_DEFINITIONS` (solid, footprint, height, tileKind, dynamics, **mount/seat/container/coverClass** — the gameplay meaning) | `game/kinds/props.ts` |
| content-addressed texture/material asset | the decal asset sink (`ASSET_KIND_DECAL_IMAGE`, sha256-deduped, shipped in the game-file `assets[]`) | `compile/decalAssets.ts`, `bakeGameFile.ts` |
| a V20 per-concern editor store (the "content store") | the stream/store idiom: `modelStream` (a library of saved docs), `decalPack`, the world/buildings streams | `editors/model/modelStream.ts`, `data/` |
| texture compression / thumbnails | **`@reactjit/image`** (decode→resize→encode WebP/JPEG/PNG in one Zig call) | `runtime/image.ts` (req_1123) |

**The keystone realization:** the **imported-prop mechanism IS the precedent for a
cooked Studio prop.** An imported `.glb` becomes `{ vertices: Float32Array, bounds,
footprint, solid, … }` registered as a prop kind and baked into `MESH_PROPS`. A
cooked Studio model is the EXACT same shape — `editMeshToGeometry` produces the
same soup — except the source is the in-editor Studio model and the install lands
in a **V20 cooked-asset stream** (hot-reloadable, the user's daily loop) instead of
a CLI-generated `importedProps.generated.ts` file. So props are the cheapest kind to
prove end-to-end, and the bake path for them already exists.

### 7.2 — Source vs cooked artifact (the BSP boundary — never confuse them)

- **Source = the Studio model** (`StoredModel` in `modelStream`): editable, undoable
  (branch), loose, tool-only metadata, recompilable. UNCHANGED by Part 7.
- **Cooked asset = a strict, versioned, content-addressed container**: fast to
  validate + load, stable binary-ish layout, no editor baggage, referenced by hash.

One model can cook to MANY assets (`chair.model` → a `prop` you sit on AND an `item`
you throw) — geometry may be shared/content-addressed; the **descriptor** is what
changes the meaning. The cook is pure + headless-testable (the `editMesh`/`textureize`
test idiom).

### 7.3 — The cooked-asset envelope + per-kind descriptors (P2 tables, rule of two)

A new module `editors/model/cookedAsset.ts` defines the common envelope and the
typed descriptors. **Descriptors REUSE the existing kind tables — they do not fork
them** (`[[feedback_rule_of_two_no_magic_values]]`).

**The envelope is a sum of SEPARABLE, CONTENT-ADDRESSED factors — never a baked
product (`[[GUIDING_LIGHT]]`: "store each thing once, reference it everywhere;
factor the product into a sum").** A `CookedAsset` is a thin record of REFERENCES
(hashes) into a shared blob store, plus the one factor that gives it meaning (the
descriptor). The heavy factors — the mesh blob and the texture blob — are stored
ONCE by their own content hash and pointed at; the descriptor is the only per-kind
factor. So one model cooked as a prop AND an item shares the exact same `meshRef`
and `texRef` (one blob each) and differs only in `descriptor` — the kind × mesh ×
texture space stays a sum, not a product.

```
// the heavy factors — interned ONCE in the blob store, keyed by their own hash:
MeshBlob    = { hash, verts: Float32Array /* pos3 nrm3 uv2, the loader's soup */, count, bounds }
TextureBlob = { hash, webp: Uint8Array /* @reactjit/image */, thumb: Uint8Array, w, h }

CookedAsset = {                  // a thin record of REFERENCES + the meaning factor
  id:        string              // stable catalog key, e.g. 'studio.tundra_body'
  hash:      string              // hash of (meshRef, texRef, descriptor, mounts) — the asset identity
  kind:      'prop' | 'item' | 'vehiclePart' | 'vehicle' | 'clothing'
  name:      string
  schema:    number              // descriptor schema version (hard-validated)
  meshRef:   string              // → MeshBlob.hash  (geometry factor, shared)
  texRef?:   string              // → TextureBlob.hash (texture factor, shared)
  collision: CookedCollision     // AABB + footprint (W/D/H) + boundsRadius (DERIVED from the mesh, not stored twice)
  mounts:    MountPoint[]        // the rig: pivot + named joints/sockets (Part 0/6)
  descriptor: PropDescriptor | ItemDescriptor | VehiclePartDescriptor | ClothingDescriptor  // the ONLY per-kind factor
}
```

The **shipped artifact is packed binary, referenced by hash — not JSON at runtime**
(`[[GUIDING_LIGHT]]` law 5/112). The cook re-uses the bake's existing flat targets:
the `MeshBlob` lands in the `MESH_PROPS` lump (the imported-prop binary path), the
`TextureBlob` ships as a content-addressed `assets[]` entry (the decal-asset path),
and a placement is a thin reference row. The editor-side cooked-asset stream (7.5)
holds these records for authoring/catalog; the loader only ever sees the flat
binary the bake emits. **Re-cooking is idempotent: same model → same blob hashes →
a cache hit, no rework** (the hash IS the cache key).

- **Prop descriptor** = a `PropKindDefinition` (the existing type, verbatim): solid,
  footprintRadius/Width/Depth, heightMeters (from bounds), tileKind, trafficControl,
  optional `dynamics` / `mount` / `seat` / `container` / `coverClass`. **No new
  schema** — the cook fills `props.ts`'s own type. Required: label, solid, a
  footprint, height, tileKind. Validate: a `container` needs capacity + access; a
  `'keyed'` container needs its key class; a `seat` needs pose + height + capacity.
- **Item descriptor** = built on `ItemDefinition` (`game/items/items.ts`) +
  equip/use fields (slot, one/two-handed, weapon/tool/consumable, damage, ammo,
  durability, grip points = named mounts, drop proxy). Required: slot + class; a
  weapon needs grip + damage.
- **Vehicle-part descriptor** = `partClass` (tire/wheel/fender/door/hood/seat/
  light/panel/cosmetic), compatible socket type, required orientation, physics
  effect (mass/handling/visual-only), damage/replacement rules. Mounts carry the
  hub/hinge (Part 0). Required: partClass + a compatible socket type.
- **Clothing descriptor** = body slot (head/torso/legs/feet/hands/face/accessory),
  layer, fit/body-shape, skeleton anchors (= mounts), hidden body regions, 1st/3rd
  person visibility, gameplay tags (armor/warmth/concealment). Built on
  `game/figure/outfit.ts` slot model. Required: body slot + attachment anchors.

Each kind's required-field set lives in ONE validation table (`cookValidators` in
cookedAsset.ts); compile FAILS LOUD on a missing field (`[[feedback_juice_limits_dont_set_low]]`
— never silently drop). The descriptor types are imported from their owning game
module so there is exactly ONE definition of "what a prop is."

### 7.4 — The cook step (pure, headless, prop first)

`cookProp(model: StoredModel, atlas: CookedTexture | null, descriptor: PropKindDefinition)
→ CookedAsset` in `cookedAsset.ts`:

1. **Flatten** every visible part: apply each part's `lift`, lower via
   `editMeshToGeometry`, concat into one soup. Per-face UVs already index the shared
   textureized atlas (Part 5 / `textureize.ts`), so the texture maps with no change.
2. **Texture** (the `@reactjit/image` fold-in): take the textureized atlas (the
   stored upload/AI art, else the procedural raster from `textureize.ts`/`png.ts`),
   `image(bytes).resize(N).webp({quality}).toBuffer()` → compressed WebP, plus a
   small `.webp` **thumbnail** for the catalog/palette. Both content-addressed
   (sha256). This earns the rebuild the `imageops` ingredient needs — which lands
   here for free because the bake/loader side is Zig work anyway.
3. **Collision + bounds**: AABB from the soup → footprintWidth/Depth, heightMeters,
   boundsRadius (the imported-prop derivation). Mounts contribute interaction-point
   hints. **Preview**: render the AABB/footprint box in the Studio viewport BEFORE
   cook (a `displayMode`-style overlay reusing the meshSelect projector).
4. **Descriptor + validate**: fold the dialog fields into the `PropKindDefinition`;
   run `cookValidators.prop`; abort with a loud message on a missing required field.
5. **Hash + envelope**: content-hash → `CookedAsset`.

Tests (`cookedAsset.test.ts`, the editMesh idiom): flatten round-trips bounds;
validate fails on a missing footprint; same input → same hash (idempotent); a
container prop needs capacity.

### 7.5 — Install → catalog → place (prop, end-to-end)

- **Content store = a new V20 stream** `editors/model/cookedAssetStream.ts` (the
  `modelStream`/`decalPack` idiom): `assetInstalled` (upsert by hash, idempotent),
  `assetRenamed`, `assetRemoved`. This is the "install once, reference everywhere"
  store — NOT a generated TS file (the user's daily loop is hot-reload Compile →
  /compiled, so cooked assets must land in a live stream like every other concern).
- **Catalog/palette**: the prop palette + `PropertiesPanel` read the cooked-asset
  stream alongside `PROP_KIND_DEFINITIONS`, so a cooked prop appears in the prop
  shelf with its thumbnail. A cooked prop's `kind` is its asset id; placement is the
  existing prop placement path (no new placement code).
- **Bake**: `worldGeometry.ts` already routes real-mesh props through `MESH_PROPS`
  via the imported-prop branch — generalize `isImportedPropKind`/`importedPropMesh`
  to ALSO resolve a cooked-asset id (read the cooked-asset stream in `bakeGameFile.ts`
  the same way it reads the world/buildings streams), pushing the cooked soup +
  thin transform into `MESH_PROPS` and the WebP texture into the game-file `assets[]`
  (the decal-asset path). The descriptor (footprint/solid/container) ships in the
  prop registry lump the loader reads. **The loader already renders MESH_PROPS** —
  no new Zig render path for props, only the cooked-asset read + texture wiring.

### 7.6 — The Compile dialog (Studio UI)

A **Compile** button (top toolbar, beside `textureize`) opens `CompileAssetDialog`
(Studio.tsx): **(1)** the kind selector (Prop / Item / Vehicle part / Clothing —
the meaning, asked first, per the user's "first menu asks what the shape is
becoming"); **(2)** the kind-specific descriptor form (host sliders + entry per
`[[feedback_ui_control_laws]]`); **(3)** a live **collision/bounds preview** in the
viewport; **(4)** **Validate** (red required fields) gating **(5) Cook + Install** →
a toast + the asset appears in its palette. Dialog state is a TWIG; the cooked asset
is BRANCH (the cooked-asset stream). Bundle-verify + the three tests after each step.

**Prop NATURE — the three real shapes, not two (req_1131).** The prop kind's form is
a single **Nature** selector that maps the user's mental model onto the table's
granular fields (instead of asking about `solid` + `tileKind` separately):
- **Static** — a fixed obstacle: `solid: true`, `tileKind: 'wall'` (blocks sight,
  gives cover).
- **Foliage** — walk-through scenery: `solid: false`, `tileKind: 'bush'` (conceals).
- **Physics** — a KICKABLE dynamic body (a barrel/can/ball, the KICKPROP system):
  `solid: true` + `dynamics: { bodyRadiusMeters, restitution }`. Only the **bounce**
  (restitution 0..1) is authored; the **body radius is MEASURED** from the footprint
  at cook time (derive, don't store twice — `[[GUIDING_LIGHT]]`). This is the third
  nature the prop stack already has (steelDrum/cans/balls/cones carry `dynamics`);
  the first dialog cut shipped only static/foliage and missed it.
`cookProp` fills `dynamics` from `PropDescriptorInput.physics = { restitution }`;
`validateProp` rejects a restitution outside 0..1 or a zero body radius (fail loud).

### 7.7 — Phased build (prop first, then generalize)

- **Phase 7a — prop, end-to-end (the proving ground).** `cookedAsset.ts` (envelope +
  prop descriptor + `cookProp` + validators) → `cookedAssetStream.ts` (V20 install)
  → the Compile dialog (prop only) → palette ingestion → the `worldGeometry`/
  `bakeGameFile` cooked-prop read into `MESH_PROPS` → fold `@reactjit/image` into the
  cook (accept the one-time dev-host rebuild for `imageops` + the loader texture
  wiring). Deliverable: build a shape in Studio → Compile as a prop → it shows in the
  prop shelf → place it → it renders in /compiled. Tests: `cookedAsset` + regression
  (editMesh 48, modelStream 8, textureize 9).
- **Phase 7b — item.** Item descriptor (on `ItemDefinition`) + route into the item
  catalog (`game/items`) + the held/dropped render path. Grip points = mounts.
- **Phase 7c — vehicle part.** `vehiclePart` descriptor + route into `game/vehicle`'s
  part vocabulary; hub/hinge = mounts; the composition layer (Part 0) seats it.
- **Phase 7d — clothing.** Clothing descriptor (on `outfit.ts` slots) + route into
  `game/figure` garment attachment; skeleton anchors = mounts.
- **Phase 7e — bundle / PAK + LODs (open).** Standalone cooked files vs a PAK bundle;
  authored LODs. Deferred until a kind needs them.

### 7.8 — Constraints that bind this part

- **No per-asset scripts** (the doc's hard rule): a cooked asset is DATA + engine-
  known behavior ids + parameters. A behavior the engine can't express is a missing
  engine capability — add it, then expose it as compile-time data. Never a JS/Lua
  payload inside an asset.
- **Reuse the kind tables, don't fork** — descriptors import from `props.ts` /
  `items.ts` / `vehicle` / `figure`. One definition of each kind's meaning.
- **One prop = one full capability** (`[[feedback_props_uniform_capability]]`): the
  cooked format gives every kind the same ceiling (image textures, measured physics
  footprint, glass/opacity) — no exemptions.
- **Maps reference, don't embed** (V29/V30): a placement is `{asset id, position,
  rotation, instance overrides}`; the cooked asset owns geometry/material/collision/
  descriptor. Shared assets amortize across maps.
- **Compile-loop latency is the bar** (`[[user_workflow_compiled_first]]`): the cook
  must be fast and land in /compiled; the install is a hot-reloadable V20 stream.
- **Branch vs twig**: the cooked asset = branch (the cooked-asset stream); the
  Compile dialog's working state = twig.

### 7.9 — Holding the Guiding Light line (USER req_1129)

The asset compiler IS the Guiding Light's thesis made concrete — "a game is DATA,
not code; the complexity lives in the compiler, never the runtime." Each law, as it
binds this part:

1. **A Studio model is a producer; the cook is the compiler; the loader is the dumb
   fixed host.** The niceness (typed `EditMesh`, the editor) lives in the producer;
   the flatness (`MESH_PROPS` verts + WebP bytes) lives in the artifact; the dumbness
   (render the soup) lives in the engine. We never make the loader smart to make
   authoring nice — the *cook* does the work.
2. **Store each thing once, reference everywhere; factor the product into a sum.**
   The mesh blob and texture blob are content-addressed factors interned once
   (§7.3); a cooked asset is references + the descriptor factor. kind × mesh ×
   texture is a *sum of factors*, not a baked product. One model → many assets shares
   the heavy blobs by hash.
3. **Content-address everything; the hash is the cache key.** Re-cooking an unchanged
   model is a no-op (blob hash hit). This is what keeps the cook inside the user's
   instant Compile → /compiled loop instead of turning it into a slow engine rebuild.
4. **Pack binary, zero-copy — no JSON/base64 at runtime.** The shipped artifact is
   the existing flat lumps (`MESH_PROPS` + content-addressed `assets[]`), loaded and
   used in place. The structured cooked-asset records are AUTHOR-side only.
5. **Declarative, never Turing-complete; no code in the loop.** The descriptor is
   flat data parameterizing fixed engine capabilities (solid, container, seat,
   handling). A behavior the engine can't express is a missing *system* to add and
   then parameterize by data — never a script smuggled into an asset.
6. **Bake is the lever, used where the state space is small.** A single authored
   asset (one mesh + one atlas) is bounded and irreducible captured/authored content
   — the legitimate place for the bake lever. We bake the asset, content-address it
   so re-cook is free, and keep everything that *factors* (placements, descriptors,
   shared blobs) as references. Refuse to bake the product; pay only the rank.
