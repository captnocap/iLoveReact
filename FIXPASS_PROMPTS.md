# Fix-pass worker prompts — 2026-07-15 session 52c7 rap sheet

Six lanes. Threads 1, 2, 3, 6 are fully disjoint — fire simultaneously.
Threads 4 and 5 both edit `framework/gpu/3d.zig` (different functions) — run
parallel with commit-early discipline, or start 5 after 4's first commit.
Supervisor reviews all work after completion (session 52c7 has the context).

Copy each block below verbatim into its own worker pane.

---

## Thread 1 — Pointer modifier bridge

```
Mouse click events delivered to JS carry NO keyboard-modifier state, so shift-click
multi-select in the world editor is dead code. Fix the bridge.

FACTS (verified):
- runtime/index.tsx getPointerPayload (~line 385) builds the JS pointer event from
  host getters: targetId/x/y/button/pressure/buttons only. No shiftKey field exists.
- No host fn exposes modifier state for clicks. The KEYBOARD path already packs SDL
  mod state — see runtime/hooks/useIFTTT.ts decodeKey (~357): (mod<<32)|sym, and
  engine.zig reads SDL_GetModState natively for mesh-editor gestures.
- The consumer is already written and waiting: cart/editor/world/WorldViewport.tsx:606
  sets additive:!!e?.shiftKey and pan:!!e?.shiftKey; AppFrame's selectPiece additive
  path maintains selectedPieceIds.

FIX:
1. framework/v8_bindings_core.zig — register a host getter (e.g. getMouseMods)
   returning the current SDL_GetModState() bitmask (register alongside getMouseX/
   getMouseDown, ~line 2989).
2. runtime/index.tsx getPointerPayload — read it and add shiftKey, ctrlKey, altKey,
   metaKey booleans to the payload (decode with the same SDL_KMOD_* masks used in
   useIFTTT.ts — keep the constants in one importable place, no magic numbers).
3. Rebuild (tools/rjit — Zig change requires it).

VERIFY (the gesture itself, not just compile): in the editor world view, shift-click
two wall pieces — the status line must read "added <piece> · 2 pieces". Also confirm
shift-drag still pans and plain click still replaces the selection.

Commit with (USER ASK req_3083). Do not touch WorldViewport.tsx or AppFrame.tsx —
their code is correct and other threads own facade files.
```

---

## Thread 2 — Facade scope + clicked-side picking

```
Two facade-painter fixes in cart TS (no Zig rebuild). The facade model:
cart/editor/world/facades.ts; the open flow: cart/editor/shell/AppFrame.tsx
openFacadePainter (~2277); command entry 'paint-facade' (~1543).

FIX 1 — scope (RULED, req_3062: explicit selection only, never auto-gather):
openFacadePainter currently branches: >1 selected → facadeFromSelection (correct,
keep); exactly 1 selected → gatherFacade over the whole contiguous coplanar run
(the auto-gather the user rejected twice — on a real building it grabs the entire
face, hundreds of pieces). Change: 1 selected piece = a ONE-piece facade
(facadeFromSelection with just that piece). Delete the gatherFacade call; delete
gatherFacade itself from facades.ts if nothing else uses it (check first).

FIX 2 — side picking:
wallFace (facades.ts:114) anchors the canvas to the piece's yaw-front (local +z)
regardless of which side the user clicked. Make the facade open on the CLICKED face:
the world click that opens the context menu has a hit normal (the paintFace path
already resolves faces via faceRoleForHit in cart/editor/world/pieceSlots.ts — reuse
that plumbing). When the click hit the back face, negate the facade normal and
mirror the plane offset so origin/uDir describe the clicked side. Front-face clicks
must produce byte-identical facades to today (facades.test.ts guards this — extend it).

VERIFY: (a) one selected wall + Paint Facade → canvas exactly that piece's w×h;
(b) status line still explains the wall-family/same-plane failure cases; (c) click
the BACK of a wall → facade paints on the back side. Note paintable surfaces can't
be captured by rjit shot — verify dimensions/normals via the facade row (log or test),
and extend cart/editor/world/facades.test.ts for both fixes.

Commit with (USER ASK req_3082). Do not touch runtime/index.tsx, v8_bindings_core.zig,
framework/gpu/3d.zig, or the resident-mesh draw path — other threads own those.
```

---

## Thread 3 — Facade quad honors alpha

```
Painted facade quads draw OPAQUE and blank out the wall texture behind them.
Intent (facades.ts header): unpainted texels are alpha-0 and must be invisible —
"the quad shows exactly the paint and nothing else."

CONTEXT: a facade bakes to a PNG (RGBA, alpha 0 where unpainted) at
<map dir>/facades/<id>.png (cart/editor/world/facadeBake.ts) and is pushed as a
resident mesh (key facade:<id>, two-sided quad lifted 12mm off the wall) through
cart/editor/world/livePush.ts → encodeResidentMeshes (cart/editor/world/meshProps.ts)
→ the host door → the world renderer. Somewhere in that native draw path the PNG's
alpha is ignored.

FIX: trace where pushed resident-mesh textures are uploaded/drawn in framework/
(start from the host fn livePush's encode lands in — see meshProps.ts for the door
name — and framework/v8_bindings_compiled_world.zig). Make the draw honor texture
alpha: alpha-test/discard for hard-edged paint, or route through the transparent
pass the painted-glass path already uses (see modelGlassFirstVertex / glass handling
in framework/gpu/3d.zig for the pattern). Prefer whichever the existing pipeline
supports without a new pipeline permutation. Mind draw order vs the wall's face
skins (8mm) under the facade (12mm).

VERIFY: paint ONE stroke on a textured wall, save, and confirm in the world view the
wall texture is visible everywhere except under the stroke — and the stroke is
visible from the back side mirrored (two-sided quad). rjit shot CAN capture the
world view (it's the <Paintable> editor canvas it can't) — cite the shot command +
PNG path. Zig change → rebuild with tools/rjit.

Commit with (USER ASK req_3082). Only touch the native draw/upload path — facade TS
files belong to Thread 2.
```

---

## Thread 4 — Solidify face identities + merge seam dissolve

```
Two mesh-studio parity regressions in framework/gpu/3d.zig. The behavior contract is
the old studio's pure TS reference — READ IT YOURSELF (no subagent summaries):
cart/editor/model/editMesh.ts (solidifyFaces:1579) and
cart/hmsc-int/editors/model/editMesh.ts (mergeFaces:2392, dropCollinearLoop:2371).
"Port" means observable behavior parity: what SELECTS and what EDGES exist afterward,
not just same-looking geometry.

FIX 1 — solidify (meshSolidifySelection, 3d.zig:3724):
Today every new triangle (inner skin + rim walls) INHERITS the source face's authored
group id, so the whole slab picks/paints as ONE face. Change: mint a FRESH group id
per logical new face — one per inner-skin source face, one per rim-wall quad — and
grow the owning part's contiguous group range (the renormalize-into-part-ranges
pattern loop cut already uses, req_2644; see how meshTopoLoopCut carries base_part /
capturePartOfFaces through a cut). After solidify on one selected face of a cube
part: 6 independently selectable faces, part ranges valid (rangesValid/ownershipValid
in the mesh journal log stay true), paint colors inherited as today.

FIX 2 — merge faces (meshMergeSelectedFaces, 3d.zig:3538):
Today it only stamps a shared group id — geometry untouched, so every seam vertex and
edge segment survives ("a 2x2 grid of quads must come back as ONE clean quad, not an
8-gon" — the reference's own words). After the regroup, do the reference's topology:
walk the merged group's boundary (chainGroupLoop exists in framework/gpu/mesh_edit.zig),
drop collinear seam midpoints (port dropCollinearLoop's epsilon test), rebuild the
group's triangles as a fan of the cleaned loop, and drop orphaned verts. Result: one
edge per straight run, no leftover pickable seam verts. Keep the null/fallback rules
(non-coplanar or hole-y selections refuse cleanly like the reference returns null).

TEST: add cases to framework/testing/unit/mesh_edit.zig style tests — and run them on
IRREGULAR (transformed/sheared) meshes, not just unit cubes. If Thread 6's parity
harness has landed, your ops must pass it. Both fixes rebuild via tools/rjit.

VERIFY in-app via the headless gesture harness (RJIT_MODELDOC/RJIT_MESHOPS) or unit
tests: solidify → face count and per-face selectability; merge → edge count drops to
the clean-quad number. Cite the numbers.

Commit each fix separately: (USER ASK req_3069) for solidify, (USER ASK req_3073) for
merge. You share 3d.zig with Thread 5 (different functions) — commit early and often,
pull before commit, never git add -A.
```

---

## Thread 5 — Parametric loop cut (both modes)

```
The native loop cut slants on real models — the recurring complaint (req_2794,
req_2837, req_3037 were all patches on the same wound). The fix is to stop deriving
cut PLANES from geometry heuristics and go PARAMETRIC: cut lines connect equal-
fraction points along the face's uncrossed edge pairs, so cuts are always parallel
to the face's own edges — straight on boxes, leaned columns, and irregular
hand-built shapes alike. References to READ YOURSELF: the old studio's
loopCutPositions/loopCutRange (cart/hmsc-int/editors/model/editMesh.ts:1428 — its
cuts+offset comb semantics are the ruled UX and are already faithfully ported as
lcPlanes) and Blender's loop-cut semantics (topological, parametric).

FACE MODE (the user's primary path) — framework/gpu/3d.zig:
meshLoopCutFaceBegin (~2017) currently derives two cut directions via lcDeriveDirs
(~1846): longest-boundary-edge U + sign-aligned AVERAGED NEIGHBOR NORMALS as plane
normals. On irregular neighbors the average tilts every plane in the comb → all cuts
slanted the same way. Replace the plane comb with parametric cuts across the SELECTED
faces: for each authored quad in the selection, direction 0 cuts connect points at
fraction t along its two direction-0 edges (direction 1 = the other pair); the comb
fractions come from the existing lcPlanes math reinterpreted as fractions of the
span (cuts+offset UX unchanged: dir/cuts/offset popup, live preview, handle drag —
keep the whole session shell, swap the cutting core). Non-quad faces refuse or fall
back to the current plane path with a status message.

EDGE MODE — meshTopoLoopCut (3d.zig:1410) + ringCutSoup (mesh_edit.zig:2355) already
cut parametrically at edge MIDPOINTS. Align it with the same fraction machinery
(midpoint = t 0.5) so both modes share one cutting core rather than two dialects.
Note the ring walk requires clean 4-corner group boundaries — Thread 4's fixes make
solidified/merged geometry walkable again; do not duplicate their work.

TEST: unit tests on sheared/tapered/irregular quads asserting cut endpoints land at
exact edge fractions (no plane-normal involvement). If Thread 6's parity harness has
landed, pass it. Zig rebuild via tools/rjit.

VERIFY headlessly (RJIT_MESHOPS-style) on an irregular mesh: loop cut a sheared
column face — every cut segment's endpoints at equal fractions along opposite edges.
Cite numbers or test names.

Commit with (USER ASK req_3075 req_3076). You share 3d.zig with Thread 4 (different
functions) — commit early and often, pull before commit, never git add -A.
```

---

## Thread 6 — Port-parity harness

```
Build the conformance suite that makes "port" a checkable claim for the mesh studio's
native ops. Five-plus parity regressions shipped because native reimplementations
were only ever eyeballed on clean cubes; the reference implementation is pure,
headless TS sitting in the repo.

SHAPE:
- Reference side: cart/editor/model/editMesh.ts (pure functions — solidifyFaces,
  mergeFaces, loopCutRange, extrudeFace, extrudeEdge, detachPanel, subMeshFromFaces).
  Runs under tools/v8cli (no node/bun in this repo — scripts/*.js run via v8cli).
- Native side: the resident-mesh ops (framework/gpu/3d.zig meshSolidifySelection,
  meshMergeSelectedFaces, meshTopoLoopCut, lc session) — drive them headlessly the
  way the existing gesture harness does (RJIT_MODELDOC / RJIT_MESHOPS replay — see
  cart/editor/stage/ModelView.tsx ~1780 and docs/game/editor_hot_reload.md) or via
  framework/testing/unit/mesh_edit.zig where the op is callable pure.
- Diff the OBSERVABLE CONTRACT, not float soup: authored-face (group) count and
  which triangles share identity (= what one click selects), editable-edge count
  (mesh journal log's topology block already reports weldedVertices/triangleEdges/
  editableEdges — use it), vert count, and geometry within epsilon.
- Inputs MUST include irregular meshes: transformed/sheared cubes, bridged
  create-face shapes, non-square quads — the class where every regression hid.

DELIVERABLE: a runnable check (make it a tools/ script or zig build step — follow
repo conventions, survey before building) that prints per-op PASS/FAIL with the
contract numbers, wired so a worker can run it in one command and cite output.
Expect solidify/merge/loopcut to FAIL against the current natives — that is correct;
Threads 4/5 fix to green. Document the run command at the top of the harness file.

Commit with (USER ASK req_3077). New files only where possible; do not modify
3d.zig/mesh_edit.zig op code (Threads 4/5 own those) — test-only hooks are fine if
truly needed, kept additive.
```

---

## After all threads report done

Return to session 52c7 for review. Reviewer will check each lane against its VERIFY
line (gesture/numbers cited, not "compiles"), run Thread 6's harness, and walk the
board entries (req_3069, 3073, 3075/3076, 3077, 3082, 3083) to review state with
commit SHAs.
