# Phase: reference

**Forward obligation —** Lookup only. Reading reference never advances a phase.

---

## Short verb table

These are the only actions; `tools/seat <anything-else>` exits 2.

| CLI | JSON `{action, args}` | Notes |
|---|---|---|
| `tools/seat look` | `{"action":"look"}` | Returns the resident percept, including separate logical UV-island and independently painted footprint counts, or `state:"no-live-model"` from the always-on shell. Bootstraps cube names on a virgin 6–12 face mesh. |
| `tools/seat semantic-status` | `{"action":"semantic-status"}` | Compares saved RJMD, viewport mount input, and resident native semantics. |
| `tools/seat action editor-status '{}'` | `{"action":"editor-status"}` | Reads the shell status line, active blocking dialog/session, and pending unsaved-document prompt without changing the model or UI. |
| `tools/seat action part-ownership '{}'` | `{"action":"part-ownership"}` | Part-range TRUTH, read-only (req_4189). Returns the host's authoritative table (`hostParts`, `authoredGroups`, `unownedFaces`, `multiplyOwnedFaces`, `ownershipValid`, `rangesValid`), the shell's Outliner rows (`shellRows`), the live `editScopeRanges`, and `agrees`. These two tables CAN diverge, and while they do every range-scoped op keeps working off numbers the host does not share. Run it when a selector refuses with "active part scope permits N" for an N smaller than the model, when Outliner rows change without an op, or before trusting `groups:<lo>..<hi>`. `agrees:false` is the fault; `percept.parts` alone can never show it. |
| `tools/seat new <kind> [size height sides]` | `{"action":"new","args":{"kind":"cube","size":1,"height":1,"sides":16}}` | Creates a model document through the editor shell's normal New Model flow. |
| `tools/seat elements` | `{"action":"elements"}` | Returns ephemeral vertex positions and boundary-edge endpoints. Re-read after topology changes. HONOURS the active part scope: scope to a part first and only its elements return (ids stay global). For whole-mesh reads on large models, page with `follow inspect` instead of one giant reply. |
| `tools/seat action boundary-continuation '{"open":[a,b]}'` | `{"action":"boundary-continuation","args":{"open":[a,b]}}` | Returns only boundary edges incident to `a` and `b`, plus legal one-per-side pairs and their next open edge. |
| `tools/seat action select-edge-continuation '{"open":[a,b],"edges":[[a,c],[b,d]]}'` | Same | Atomically validates and selects one continuation edge at each endpoint. Rejects disjoint, same-side, and collapsed pairs. |
| `tools/seat action retopo-bands '{"operation":"plan-from-selection"}'` | Same | From a selected established quad strip, recovers its ordered lower/upper rails, maps and tints every resident face relative to those local rails. `read`, `select {id|"all"}`, and `clear` use the map. |
| `tools/seat action retopo-bands '{"operation":"tint-selection","id":0}'` | Same | Assigns the current face selection to an exact package-saved band/color. IDs are 0..11. `untint-selection` erases selected assignments. |
| `tools/seat action retopo-bands '{"operation":"ghost"}'` | Same | Toggle the package-saved frozen source soup over the current retopology. `visible:true|false` sets it explicitly and returns source coverage. |
| `tools/seat action retopo-bands '{"operation":"deleted-patch"}'` | Same | Recover the exact unread Delete Faces perimeter after a reconnect. Normal Seat `delete` replies include it directly as `deletedBoundary`. |
| `tools/seat follow <start\|read\|stop\|clear\|inspect>` | `{"action":"follow","args":{"operation":"start","label":"torso strips"}}` | Records the append-only native edit firehose; also derives Delete Faces → Create Face examples when possible. See Follow. |
| `tools/seat select <selector>` | `{"action":"select","args":{"selector":"…"}}` | Sets the live face selection. |
| `tools/seat action region-edit '{"name":"cushion","rename":"seatBase"}'` | `{"action":"region-edit","args":{…}}` | Rename an existing region, or `{"name":"cushion","remove":true}` to remove it — its faces go back to unnamed and the row leaves the table. Naming is no longer one-way (req_3894). Refuses an unknown name, an empty/reserved rename, or a rename onto another region's name (merge deliberately instead). Children of a removed region are orphaned to root, and the whole edit is ONE undo step. |
| `tools/seat action select-audit '{"kind":"unreachable"}'` | `{"action":"select-audit","args":{…}}` | Select the triangles behind the percept's geometry counts — `intersecting`, `unreachable`, or `both` (req_3883). The host marks them in the same pass that counts them, so the selection can never disagree with the number the reply reported. |
| `tools/seat select-face <id> [+]` | `{"action":"select-face","args":{"index":7,"additive":true}}` | Exact triangle selection; ephemeral, never semantic memory. |
| `tools/seat select-edge <id> [+]` | `{"action":"select-edge","args":{"index":4,"additive":true}}` | Select edge ids returned by `elements`. |
| `tools/seat select-vertex <id> [+]` | `{"action":"select-vertex","args":{"index":2,"additive":true}}` | Select vertex ids returned by `elements`. |
| `tools/seat name <name> [instance]` | `{"action":"name","args":{"name":"…","instance":0}}` | Names the current selection, role `authored`. |
| `tools/seat extrude <dist> <name> [instance]` | `{"action":"extrude","args":{"distance":0.2,"name":"roof","instance":0}}` | Creates `<name>.cap` + `<name>.wall`. A MULTI-face selection region-extrudes as ONE shell: the patch translates along its average normal as the cap and walls rise only on the selection boundary — never between selected faces. One part per selection; wire faces, non-manifold selection edges, and closed selections are refused. |
| `tools/seat extrude-edge <dist>` | `{"action":"extrude-edge","args":{"distance":0.1}}` | Extends exactly one selected edge; inherits source meaning. Never fuses: if the outer corners would land in an existing vertex's weld class the distance auto-nudges clear (req_3802), so an extrude always creates a free boundary edge — bridge deliberately with `create-face`, never by extruding "onto" geometry. |
| `tools/seat connect` | `{"action":"connect"}` | Connect exactly two selected non-adjacent vertices across one face. |
| `tools/seat create-face <name>` | `{"action":"create-face","args":{"name":"bridge"}}` | Fill a closed 3/4-edge loop or bridge two disjoint edges; naming required. |
| `tools/seat bevel <width>` | `{"action":"bevel","args":{"width":0.02}}` | Atomic native bevel session on one edge or vertex. Meters. |
| `tools/seat inset …` | `{"action":"inset","args":{"distance":0.001,"name":"panel","pivot":[0,0.5,0],"axes":[[1,0,0],[0,0,1]],"factors":[0.6,0.7]}}` | Packages hairline extrude + two-axis shrink; see Inset. |
| `tools/seat move x y z` | `{"action":"move","args":{"delta":[0,0.1,0]}}` | Translates the selection. Transforms act on the IN-SCOPE selection in any mode — a face selection resolves to its corner vertices; view mode (0) transforms nothing. |
| `tools/seat scale ax ay az px py pz f` | `{"action":"scale","args":{"axis":[1,0,0],"pivot":[0,0,0],"factor":0.018}}` | Exact axis scale about a pivot; factors are not rounded to UI step sizes. All SEVEN args are required — a short arg list is the usual cause of "scale rejected". For signed numerics, the `action` JSON form is the reliable lane if your shell/wrapper eats a leading `-`. |
| `tools/seat scale-uniform <factor>` | `{"action":"scale-uniform","args":{"factor":1.2}}` | Uniform scale around the current selection pivot. |
| `tools/seat rotate ax ay az px py pz deg` | `{"action":"rotate","args":{"axis":[0,1,0],"pivot":[0,0,0],"degrees":15}}` | Degrees, converted to radians internally. |
| `tools/seat undo` | `{"action":"undo"}` | |
| `tools/seat redo` | `{"action":"redo"}` | |
| `tools/seat delete` | `{"action":"delete"}` | Delete the selected faces, or faces touching selected edges/vertices. |
| `tools/seat merge-faces` | `{"action":"merge-faces"}` | Joins exactly TWO triangles across a shared diagonal into one quad — a quadifier, not an n-gon builder. To push a multi-face patch, select it and `extrude` (region extrude). |
| `tools/seat weld` | `{"action":"weld"}` | Weld selected vertices; one selected edge collapses its endpoints. |
| `tools/seat action weld-pairs '{"pairs":[[a,b],[c,d]],"maxDistance":0.01}'` | Pairwise seam weld. | Each pair collapses independently to its midpoint; the optional metre leash rejects stale/cross-body matches. |
| `tools/seat action normalize-widths '{"paths":[{"vertices":[a,b,c]}],"strength":1}'` | Equalize retopology row widths. | Ordered real-edge paths only. Open endpoints stay pinned; closed rows retain the first vertex as their phase anchor. |
| `tools/seat solidify <thickness>` | `{"action":"solidify","args":{"thickness":0.03}}` | Add inner skin and rim walls. Meters. |
| `tools/seat detach <name>` | `{"action":"detach","args":{"name":"roof"}}` | Detach selected faces into a named Outliner part. |
| `tools/seat flip` | `{"action":"flip"}` | Reverse selected face winding. |
| `tools/seat glass` | `{"action":"glass"}` | Toggle glass on selected faces. |
| `tools/seat paint r g b` | `{"action":"paint","args":{"rgb":[180,40,20]}}` | Journaled RGB fill. Rejects undersized atlases with the required `fit` instead of returning invisible success. |
| `tools/seat atlas <template\|solid\|blank> [r g b] [fit]` | `{"action":"atlas","args":{"base":"solid","rgb":[180,40,20],"fit":1024}}` | Explicitly rebuild a stale paint atlas after topology edits. `fit` is the atlas BUDGET — 512/1024/2048/4096, default **1024²**. Replies with the sheet you got: `{density,fit,w,h}`. |
| `tools/seat material <slot\|clear>` | `{"action":"material","args":{"slot":2}}` | Assign/clear an existing texture-role slot on selected faces. |
| `tools/seat uv <restore\|auto-size\|project-view>` | `{"action":"uv","args":{"operation":"auto-size"}}` | Operate on UV islands belonging to the face selection. |
| `tools/seat save` | `{"action":"save"}` | Full package save. Refuses unnamed faces and unresolved generator names; otherwise re-reads the written RJMD and rejects/rolls back a semantic drop. |
| `tools/seat add <kind> <size> <height> <sides> <name> [x y z]` | `{"action":"add","args":{"kind":"cylinder","size":0.26,"height":0.1,"sides":6,"name":"dial"}}` | Appends a part whose surfaces are named at creation. **Meters.** |
| `tools/seat cut <dir> <cuts> [offset]` | `{"action":"cut","args":{"direction":0,"cuts":2,"offset":0.5}}` | Loop cut: PROPAGATES the edge ring around the whole body — one hood cut also cuts windshield/roof/underbody (measured: +66 tris where basic-cut adds +6). Reach for it only when you want the full ring. |
| `tools/seat basic-cut <dir> <cuts> [offset]` | `{"action":"basic-cut","args":{"direction":0,"cuts":1,"offset":0.5}}` | Subdivides ONLY the selected faces — the bounded local cut. This is the one you want for a local detail line; it never walks the ring. The receipt's `worldDirection` is the seed vector applied geometrically across every selected face. |
| `tools/seat tris-to-quads` | `{"action":"tris-to-quads"}` | Convert the compatible maximum triangle set. |
| `tools/seat action mirror-quads '{"axis":0}'` | `{"action":"mirror-quads","args":{"axis":0}}` | Retroactive mirror quad repair (req_3855): wherever an authored quad's reflection across the model-origin axis plane (`axis` 0/1/2 or `"x"|"y"|"z"`) is covered by two SEPARATE lone triangles, fuse that twin pair into the matching quad. Grouping only — no vertex moves; a twin split on the opposite diagonal still matches; fusion is TRUSTED (no coplanarity gate — the existing source quad licenses an equally-warped twin). Reply carries `quads/symmetric/pairs/refused` even on failure. |
| `tools/seat action mirror-replace '{"axis":0}'` | `{"action":"mirror-replace","args":{"axis":0}}` | Selection-scoped mirror stamp (req_3864): reflect the SELECTED faces across the model-origin axis plane — every whole twin face buried in the stamped space is deleted, the selection is re-created reflected (quads stay quads, diagonals preserved), and the seam + region borders WELD (near-plane corners share the source vertex; border corners snap onto surviving twin verts). Unselected faces are never deleted and never reflected, so deliberate asymmetry survives by not being selected. Reply carries `copied/replaced/welded/seam`. |
| `tools/seat collect-uv-orientation` | `{"action":"collect-uv-orientation"}` | Expand one selected face to the same signed UV orientation. |
| `tools/seat mirror <x\|y\|z> [-]` | `{"action":"mirror","args":{"axis":0,"keep":true}}` | Symmetrize. WHOLE-MODEL scope cuts at the model-origin plane; a FOCUSED part symmetrizes about its OWN centerline (req_3886) — scope to the part first to repair it in place. `-` keeps the −side. Armed mirror-EDIT twinning always stays on the fixed origin plane. |
| `tools/seat shot <path>` | `{"action":"shot","args":{"path":"/tmp/x.png"}}` | Whole-window swapchain capture at the live camera; use the structured offscreen lane below for an active-model stage render. |
| `tools/seat command <editor-command-id>` | `{"action":"command","args":{"id":"mesh-wire"}}` | Invoke an existing zero-argument editor command through `runCommand`. |
| `tools/seat action <name> '<json>'` | Any structured action below. | Parameterized parity lane; JSON must be one object. |
| `tools/seat do '<json-array>'` | `{"action":"batch","args":{"requests":[…]}}` | See Batching. |

**Live mirror is bilateral (req_3796/req_3797).** With a mirror plane armed (Mirror Edit
X/Y/Z — model-origin plane, always), the editing verbs land on BOTH sides in one journal
transaction: transforms reflect onto twins, and extrude, delete, flip, glass, paint fill,
solidify, detach, merge-faces, weld, connect, create-face, bevel, and extrude-edge all
extend to the selection's mirror twins automatically. A missing/out-of-scope twin honestly
falls back to one-sided, and so does a twin edge whose side is already FILLED: a mirrored
create-face/extrude-edge requires the twin edge to match the source edge's face incidence
(req_3843), so bridging an open edge never stacks a duplicate coincident face over a
surfaced twin side. After a mirrored extrude only the SOURCE cap is selected — move it
and the twin cap follows by reflection. Every twin lands as its OWN authored face
(req_3804): bilateral ops pair source and twin positionally, never by shared face
identity — two disjoint pieces reporting as one selectable face is a bug, not mirror
behavior. Exceptions: loop cut already propagates its ring
around the whole body. Basic Cut stays bounded to the selected authored faces, but an
armed Mirror Edit adds their in-scope twins to the same preview, commit, and undo.
Forgot to arm mirror before quadifying one side? `mirror-quads` (table above) retroactively
copies quad grouping onto twin triangle pairs — same repair as the `quads` verb in the
editor's symmetry trust strip.

### The stage reads form now — matcap shading (req_3766)

The model stage shades by VIEW-SPACE normal (sculpt-app solid mode): distinct
faces get distinct tones AND hues (warm right / cool left / bright top), and
grazing faces darken, so edges, creases, and silhouettes read in a plain shot
without the vert/edge overlays. Limits to know: a SMOOTH-shaded surface (normals
smoothed across edges) still blends across its interior — the overlay remains
the exact-topology instrument there; and Paint mode / the Flat switch disable
matcap so colour judging stays exact. Verify shape work from shots first, and
drop to overlays only when you need indices.

### shot — the agent's eyes

```bash
tools/seat shot /tmp/model.png    # then read the PNG back
tools/seat action shot '{"path":"/tmp/x.png","offscreen":true,"width":1024,"height":1024,"pose":[yaw,pitch,dist,tx,ty,tz]}'
```

Captures the app's own composed frame (SELFSHOT-0606) — it never touches the desktop,
which is banned. **Use it to check your own work** instead of asking the user what they
see. Plain `tools/seat shot` stays the whole-window swapchain capture, chrome included, at
the current live camera. The structured `offscreen:true` lane renders the active model stage
to the PNG at the optional `[yaw,pitch,dist,targetX,targetY,targetZ]` pose, without moving the
user's camera and without capturing editor chrome; omit `pose` to use the live camera. Pose
values are radians, positive pitch looks down, and the convention is the same as the viewport
pose. The offscreen lane is active-model only; a background model has no framed scene and
refuses `shot`.

Transforms act on **the current selection** — they take no selector. Always `select`
first. All values are model-space; state the axis and pivot explicitly rather than relying
on a screen gizmo's ambient frame.

Transport: writes one NOTICE to `$RJIT_SOCKET` (default `/tmp/reactjit.sock`), then polls
for `/tmp/reactjit-seat-<id>.json` every 25 ms, **timing out at 15 s**. AppFrame owns the
receiver from editor startup; ModelView is not a prerequisite. Exit code is 0 on `ok:true`,
1 otherwise.

## Selector grammar — complete

From `compileSeatSelector`. Anything not matching these returns `unknown selector`.

| Selector | Meaning |
|---|---|
| `all` | Every face. Use this to transform the whole model. |
| `region:<name>` | A named semantic region. Use this explicit form for durable handles. |
| `region:<name> & facing:+y` | That named region family narrowed by an axis-facing query. |
| `facing:+y` / `facing:-z@30` | Faces whose normal is within N degrees of an axis. **Default tolerance 15°.** |
| `top` / `bottom` | Compatibility aliases for the extremal face on ±y; names cannot shadow them. |
| `extremal:top` / `extremal:bottom` | Explicit extremal face on ±y. Preferred in new scripts. |
| `outermost:+x` / `outermost:-z` | Extremal face on the named axis. |
| `above:y>1.4` / `below:y>1.4` | Faces above/below a threshold on an axis. |
| `groups:12..18` | Authored face-group range. Index-based — never durable memory. |
| `inside:box(minx,miny,minz,maxx,maxy,maxz)` | Faces whose CENTROID is in an AABB. Six finite numbers. |
| `mirror:x` / `mirror:z@0.002` | Replaces the current selection with its twins across the model-origin plane. **Default tolerance 0.0001 m.** |

### Selector gotchas, all real

- Selector keywords are reserved. `top` and `extremal:top` are geometric; `region:top`
  is the primitive's saved semantic region. Bare non-keyword names remain a compatibility
  convenience, but new scripts should always spell durable names as `region:<name>`.
- `part:` belongs to Outliner identity (`part-select`). It is deliberately not a face-range
  selector. Use `groups:<lo>..<hi>` only as an ephemeral bridge from a just-returned receipt.
- Render-triangle ids are a different index space. Select a returned list with
  `select-elements {"kind":"triangle","indices":[...]}`; the ambiguous `faces:` selector
  and `kind:"face"` form refuse instead of silently selecting half an authored quad mesh.
- **The comparator in `above:`/`below:` is decorative.** `above:y>1.4` and `above:y<1.4`
  compile identically; only the `above`/`below` prefix and the number are read.
- **`inside:box` tests the face CENTROID, not full containment** (`meshSelectQuery`, kind
  `.box`) — this page claimed "fully inside" for a long time and it was never true, which
  is why a returned bbox routinely reads WIDER than the box you asked for. Coordinates are
  absolute. It isolates a sub-part of a multi-face region (e.g. the front quad of a
  `*.wall` ring), but it is brittle: a bound tuned to exclude a neighbouring quad breaks
  the moment either moves. Re-derive bounds from the live percept, never from memory.
- **A box cannot isolate a region whose own AABB contains foreign faces.** Tightening drops
  target faces before it drops the intruders. When the count comes back over, that is the
  signal to reach for `mirror:` or a name — not to tune the numbers harder.
- **`mirror:` reads the CURRENT selection, so it is always the second call**: select the
  source, then mirror it. The reply adds `unmatchedSources` — how many source faces found
  nothing at their reflection. **Non-zero means a partial mirror**, which otherwise looks
  identical to a clean one; widen with `@<metres>` or accept that the model is asymmetric
  there. Coincident twins (an inner skin behind an outer) both come along by design, so a
  twin count above the source count is real, not a bug.
- Geometric selectors return the real face count and bbox. Zero, or an unexpectedly broad
  result, is a reason to stop and inspect — not to proceed.
- Every selector also compares matched faces with the active native scope. A partial match
  is rejected and cleared. `select all` first expands scope to every visible part.

---

## The percept

Every reply carries `percept`, the whole state. Shape (`SeatPercept`):

```jsonc
{ "version": 1,
  "generation": 18,          // bump per topology change; used by the race guard
  "faces": 132,              // total triangles
  "islands": 27,             // logical UV islands; 0 until an atlas is readable
  "footprints": 19,          // exact independently painted regions after stacking
  "unnamed": 0,              // naming debt
  "placeholders": 0,         // live regions still named by new/add generators
  "placeholderFaces": 0,     // triangles still covered by those generator names
  "activePartId": "part:body", // current Outliner/native edit scope
  "parts": [ { "id": "part:body", "name": "Body", "kind": "cube",
               "visible": true, "lo": 0, "hi": 24,
               "groupPath": [ { "id": "group:shell", "name": "Shell" } ] } ],
  "regions": [ { "id": 0, "faces": 2, "instances": 1, "bbox": [minx,miny,minz,maxx,maxy,maxz] } ],
  "table": { "version": 1, "regions": [ { "id": 0, "name": "right", "role": "+x", "parent": 3,
                                          "createdBy": { "op": "extrude", "at": 1785607074856 } } ],
             "nextRegionId": 6 } }
```

`parts[]` is the durable Outliner tree joined to its host-authored `[lo,hi)` ranges;
`activePartId` identifies the scope that topology verbs currently intersect. Missing ranges
are reported as `null`, never inferred. The shell restores these rows from saved part metadata
on a cold open. `regions[]` carries live geometry (face count + bbox per semantic id), while
`table.regions[]` carries meaning (name, role, parent, provenance). Join those on `id`.
`placeholders` and `placeholderFaces` are that join's live generator debt: only nonempty
regions whose `createdBy.op` begins with `new ` or `add ` count. Missing provenance from an
older blob is treated as intentional so dropped history cannot lock its owner out of save.

Use `tools/seat --brief ...` for agent work. The live transport calls
`formatSeatPercept()`, removes repeated per-row percepts from batches, and prints one final
digest after the row outcomes. Omit `--brief` only when a machine consumer needs the full
JSON percept.

Extruding one authored quad adds **+8 render faces** (2 cap triangles remain plus 8 wall triangles).

## Batching

```bash
tools/seat do '[{"action":"select","args":{"selector":"body/front"}},
                {"action":"extrude","args":{"distance":0.2,"name":"window"}},
                {"action":"move","args":{"delta":[0,0.1,0]}}]'
```

- Rows run at a deliberate **100 ms cadence** so the user can watch the model build.
- **Hard ceiling ~140 rows**: 100 ms/row against the CLI's 15 s timeout.
- Execution **stops at the first rejected row**; the reply carries every reply collected so
  far and `ok:false`. Do not blindly retry a rejected batch — `look`, then re-plan.
- Batch only *already-decided* operations. Anything whose parameters depend on the previous
  result must be its own call.

---

## Rewind and race safety

```bash
tools/seat undo
tools/seat redo
RJIT_SEAT_GENERATION=42 tools/seat extrude 0.2 roof
```

The generation guard is checked before a request and before **every batch row**. After each
seat row, its resulting generation becomes the next expected value; any other generation
bump is a human/native edit and closes the batch before another queued action lands. A stale
single request reports `stale generation N`; an interrupted batch reports the exact row it
closed before. Re-run `look`; never apply an old plan to a changed mesh.

---

---

## Intent amplifiers — two decisions expand to N elements

You supply INTENT (two picks, a seed, a target coordinate); the host supplies TOPOLOGY.
Reach for these before writing an id list: 2 ids you just read beat 40 you must keep
consistent across a generation bump, and the walk runs beside the mesh, so it works on
models far too dense to page across the socket.

```bash
tools/seat select-path <fromVert> <toVert> [axis]   # shortest edge-walk between two verts
tools/seat select-loop <edge>                       # follow the edge loop
tools/seat select-ring <edge>                       # parallel edges across quads
tools/seat select-grow [rings]                      # expand the live face selection
tools/seat select-similar <face> [normal|coplanar|area] [tolerance]
```

**Every walk PREVIEWS by default** and touches nothing. The reply carries `count`,
`elements`, `bbox`, `terminated` (`closed` / `boundary` / `pole` / `unreached`), the
vertex it `stoppedAt`, and the `tieBreak` rule that resolved ambiguity — **lowest element
id wins an equal-cost step**. Read that sentence instead of re-deriving the geometry; a
walk that went somewhere you did not intend tells you why.

Commit with `--apply` (add `+` for additive). Apply uses the token the preview reported,
so a topology change in between is a refusal — never a silently different set.

`select-similar ... coplanar` is the one that replaces the brittle `inside:box(...)` dance
for isolating a flat panel: same facing AND the same plane, so the far side of a slab
cannot join. A path with an `axis` travels monotonically along it, so a spine walk cannot
detour around a limb.

### Absolute placement and repeats

```bash
tools/seat set-position y 0.75 [min|center|max]   # "tabletop at 0.75 m", not read-then-subtract
tools/seat for-each rivet scale-uniform '{"factor":0.8}'
```

`set-position` deletes the read-bbox → subtract → move loop agents run constantly; the
anchor says which face of the selection lands on the coordinate. `for-each` applies one
decision per matching Outliner PART — parts are the unit because they survive the
generation bump each step causes, which a list of triangle ids does not. Each row is its
own transaction and a partial sweep names the parts that refused.

### Reading a SAVED package

```bash
tools/seat package info [model]        # header, counts, bbox, parts
tools/seat package regions [model]     # the saved semantic table + per-region tri counts
tools/seat package ranges [model]      # per range: triangles, GROUPS, bbox, part name
tools/seat package triangles 700 4     # saved corners AND uvs, by index or 700,701,702
tools/seat package diff                # saved blob vs the resident mesh
tools/seat package compare <model>     # two SAVED packages against each other
```

`ranges` is the one that answers "did this part survive the save with its quads intact":
`ranges: 6` cannot, but 246 triangles over 130 groups can — that is a quad mesh, while
246 over 246 is soup. `triangles` decodes uvs from stride columns 6 and 7, which is the
detail a hand reader gets wrong after getting positions right.

**Never read `mesh/doc.blob` with bun, node, or python.** The header grew 40 → 48 bytes
at RJMD v5 and there are v4 and v5 packages on disk simultaneously, so a hardcoded offset
silently returns wrong numbers for half your models. When the reader refuses, it names the
code and the reason — `[invalid-edge-logical-id] edge region "test" refers outside the
saved logical-vertex table` is a real answer; a hand parser would have returned plausible
garbage instead.

---

## Reading the named surfaces and the holes

```bash
tools/seat regions [filter] [--all]   # the semantic table JOINED to its geometry
tools/seat stats boundary             # watertight? how many HOLES, and where
```

`look` returns semantics (`table.regions`: id, name, role, parent) and geometry
(`regions`: id, faces, instances, bbox) as two arrays keyed by id. **Do not join them
yourself** — `regions` does it, adds `size`, hides empty names unless you pass `--all`,
and filters by substring. It is a pure percept read, so it works on a model another lane
has claimed.

`stats boundary` answers "is this watertight, and if not where are the holes" in one call:
`boundaryEdges`, `openVertices`, and **`loops`** — the number of separate rims, which is
the number an agent can act on where an edge count is not. It also lists
`coincidentOpenVertices`: boundary rims sitting in the same place, i.e. seams nobody
closed, which is exactly what `weld-pairs` fixes.

## Refusals name their cause

`extrude` used to reject with "(selection, name, or naming debt)" — three causes in one
string, so the agent had to go digging. It now names which of four it was: a non-finite
distance, naming debt (with the budget and both ways out), a semantic-name clash (with the
instance), or the host refusing the selection (with what a region extrude will not accept).
If you hit a refusal that does not tell you what to fix, that is a bug worth reporting.

---

## NAMED GAP: lathe / surface of revolution

Agents building wheels, rims, tyres and steering wheels write a ~500-line Python
orchestrator to do this (`build_rim.py`, req_4187). The technique is sound and uses only
existing verbs — which is exactly why it should be ONE verb rather than a script each
agent rewrites differently:

```
new cylinder → delete both caps → cut direction:1 cuts:N   # a tube of N loops
for each profile point k (radius, y):
    select-loop <seed edge of loop k> --apply
    scale-uniform (radius / baseRadius)
    move [0, y - loopY, 0]
flip                                                        # seed normals face inward
```

The missing piece is not the maths — it is loop-seed discovery (which edge belongs to loop
k) plus the composition. The proposed verb:

```bash
tools/seat lathe '{"profile":[[r,y],...],"sides":24,"bands":{"0":"hub","5":"grip"}}'
```

NOT BUILT YET. Until it exists, drive the existing verbs and **say in your report that you
had to orchestrate it externally** — that report is what turns this gap into the verb.
Naming each band as you shape it is still required either way.
