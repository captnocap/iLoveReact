---
name: agent-seat
description: Drive the running ReactJIT studio model editor through its live Agent Seat API. Use when an agent must create, revise, save, or cold-verify a 3D model from a prompt or reference image by selecting named/geometric surfaces, extruding, transforming, naming topology, inspecting semantic persistence, or undoing work while the user watches the editor.
---

# Agent Seat

Model with the editor's resident tools; never emit vertex arrays or replace the mesh
with generated code. Treat every successful reply's `percept` as the source of truth for
the **resident mesh**. Use `save` and `semantic-status` for durable-state claims; a live
percept alone does not prove what will survive a cold restart.

**This document is the complete capability surface.** Common modeling verbs have short CLI
forms; the rest use `tools/seat action <name> '<json-object>'`. Do not invent an unlisted
action or bypass the resident editor.

Source of truth for this file: `cart/editor/agent/seatApi.ts` (the API),
`tools/seat` (the CLI adapter), `cart/editor/stage/ModelView.tsx:2598` (the live handler).

---

## Scale contract — READ THIS BEFORE PICKING ANY NUMBER

**1 unit = 1 meter.** This is ruled (`tools/oracle "scale contract"` → R4): 1 tile = 1 meter,
player collider 1.65 m, visual head-top ~2.04 m.

The seat bootstraps a **1×1×1 cube** — that is a **1 meter** cube, already the size of a
washing machine. The "unit cube" framing is a trap: block out in meters from the first
operation, because a model built at unit-cube scale lands ~4× oversized and nothing in the
percept will warn you.

| Object | Realistic size (w × h × d, meters) |
|---|---|
| Tabletop radio | 0.35 × 0.22 × 0.15 |
| Console/floor radio cabinet | 1.1 × 1.0 × 0.45 |
| Chair seat height | 0.45 |
| Table / desk height | 0.75 |
| Door | 0.9 × 2.0 |
| Player collider | 1.65 tall |

Sanity check before you start: *would this object fit next to a 1.65 m person?* State the
target dimensions in meters in your first message, then scale the bootstrap cube to them.

The bootstrap cube is `x[-0.5,0.5] y[0,1] z[-0.5,0.5]` — centred in x/z, **sitting on
y=0**. Keep models grounded at y=0 by scaling y about a pivot of `0`.

---

## Loop

1. Ensure the user has the target model open under `./tools/rjit dev editor`, or create one
   through the normal shell flow with `tools/seat new`.
2. Run `tools/seat look` before editing. A new cube should report the six primitive names.
3. Select a durable name whenever one exists. Use a geometric selector only for the first
   reach or a deliberate spatial query.
4. Make one coherent structural change, inspect the returned percept, then continue.
5. Use a named operation for every face-creating change. Rewind with `tools/seat undo` as
   soon as a result diverges from the requested form.
6. Run `tools/seat save`, then `tools/seat semantic-status`. Require `status:"healthy"`
   and matching nonzero saved/mount/resident counts before claiming that names are durable.
7. Report changes in terms of semantic names and dimensions, not face indices. When cold
   persistence is material to the task, fully stop and reopen the editor and prove the names
   with a generation-1 `look`.

---

## Short verb table

These are the only actions; `tools/seat <anything-else>` exits 2.

| CLI | JSON `{action, args}` | Notes |
|---|---|---|
| `tools/seat look` | `{"action":"look"}` | Returns percept. Bootstraps cube names on a virgin 6–12 face mesh. |
| `tools/seat semantic-status` | `{"action":"semantic-status"}` | Compares saved RJMD, viewport mount input, and resident native semantics. |
| `tools/seat new <kind> [size height sides]` | `{"action":"new","args":{"kind":"cube","size":1,"height":1,"sides":16}}` | Creates a model document through the editor shell's normal New Model flow. |
| `tools/seat elements` | `{"action":"elements"}` | Returns ephemeral vertex positions and boundary-edge endpoints. Re-read after topology changes. |
| `tools/seat follow <start\|read\|stop\|clear\|inspect>` | `{"action":"follow","args":{"operation":"start","label":"torso strips"}}` | Records and pairs the user's native Delete Faces → two-edge Create Face strip demonstrations. See Follow. |
| `tools/seat select <selector>` | `{"action":"select","args":{"selector":"…"}}` | Sets the live face selection. |
| `tools/seat select-face <id> [+]` | `{"action":"select-face","args":{"index":7,"additive":true}}` | Exact triangle selection; ephemeral, never semantic memory. |
| `tools/seat select-edge <id> [+]` | `{"action":"select-edge","args":{"index":4,"additive":true}}` | Select edge ids returned by `elements`. |
| `tools/seat select-vertex <id> [+]` | `{"action":"select-vertex","args":{"index":2,"additive":true}}` | Select vertex ids returned by `elements`. |
| `tools/seat name <name> [instance]` | `{"action":"name","args":{"name":"…","instance":0}}` | Names the current selection, role `authored`. |
| `tools/seat extrude <dist> <name> [instance]` | `{"action":"extrude","args":{"distance":0.2,"name":"roof","instance":0}}` | Creates `<name>.cap` + `<name>.wall`. |
| `tools/seat extrude-edge <dist>` | `{"action":"extrude-edge","args":{"distance":0.1}}` | Extends exactly one selected edge; inherits source meaning. |
| `tools/seat connect` | `{"action":"connect"}` | Connect exactly two selected non-adjacent vertices across one face. |
| `tools/seat create-face <name>` | `{"action":"create-face","args":{"name":"bridge"}}` | Fill a closed 3/4-edge loop or bridge two disjoint edges; naming required. |
| `tools/seat bevel <width>` | `{"action":"bevel","args":{"width":0.02}}` | Atomic native bevel session on one edge or vertex. Meters. |
| `tools/seat inset …` | `{"action":"inset","args":{"distance":0.001,"name":"panel","pivot":[0,0.5,0],"axes":[[1,0,0],[0,0,1]],"factors":[0.6,0.7]}}` | Packages hairline extrude + two-axis shrink; see Inset. |
| `tools/seat move x y z` | `{"action":"move","args":{"delta":[0,0.1,0]}}` | Translates the selection. |
| `tools/seat scale ax ay az px py pz f` | `{"action":"scale","args":{"axis":[1,0,0],"pivot":[0,0,0],"factor":0.018}}` | Exact axis scale about a pivot; factors are not rounded to UI step sizes. |
| `tools/seat scale-uniform <factor>` | `{"action":"scale-uniform","args":{"factor":1.2}}` | Uniform scale around the current selection pivot. |
| `tools/seat rotate ax ay az px py pz deg` | `{"action":"rotate","args":{"axis":[0,1,0],"pivot":[0,0,0],"degrees":15}}` | Degrees, converted to radians internally. |
| `tools/seat undo` | `{"action":"undo"}` | |
| `tools/seat redo` | `{"action":"redo"}` | |
| `tools/seat delete` | `{"action":"delete"}` | Delete the selected faces, or faces touching selected edges/vertices. |
| `tools/seat merge-faces` | `{"action":"merge-faces"}` | Merge 2+ compatible selected faces. |
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
| `tools/seat save` | `{"action":"save"}` | Full package save. Re-reads the written RJMD and rejects/rolls back a semantic drop. |
| `tools/seat add <kind> <size> <height> <sides> <name> [x y z]` | `{"action":"add","args":{"kind":"cylinder","size":0.26,"height":0.1,"sides":6,"name":"dial"}}` | Appends a part whose surfaces are named at creation. **Meters.** |
| `tools/seat cut <dir> <cuts> [offset]` | `{"action":"cut","args":{"direction":0,"cuts":2,"offset":0.5}}` | Loop cut the current face selection. |
| `tools/seat basic-cut <dir> <cuts> [offset]` | `{"action":"basic-cut","args":{"direction":0,"cuts":1,"offset":0.5}}` | Basic cut through the same atomic native session. |
| `tools/seat tris-to-quads` | `{"action":"tris-to-quads"}` | Convert the compatible maximum triangle set. |
| `tools/seat collect-uv-orientation` | `{"action":"collect-uv-orientation"}` | Expand one selected face to the same signed UV orientation. |
| `tools/seat mirror <x\|y\|z> [-]` | `{"action":"mirror","args":{"axis":0,"keep":true}}` | Symmetrize; `-` keeps the −side. |
| `tools/seat shot <path>` | `{"action":"shot","args":{"path":"/tmp/x.png"}}` | The app captures its OWN frame. |
| `tools/seat command <editor-command-id>` | `{"action":"command","args":{"id":"mesh-wire"}}` | Invoke an existing zero-argument editor command through `runCommand`. |
| `tools/seat action <name> '<json>'` | Any structured action below. | Parameterized parity lane; JSON must be one object. |
| `tools/seat do '<json-array>'` | `{"action":"batch","args":{"requests":[…]}}` | See Batching. |

## Structured editor parity

Use the structured lane for cart-owned tools. These calls route into the same Outliner,
focus-panel, ModelToolApi, and command authorities as the visible controls.

```bash
tools/seat action part-select '{"ids":["part:body"],"primary":"part:body"}'
tools/seat action viewport '{"operation":"orbit","yawDegrees":45,"pitchDegrees":-20}'
tools/seat action viewport '{"operation":"frame","target":"model"}'
tools/seat action reference '{"operation":"add","path":"/tmp/front.png","patch":{"plane":"front","scale":2}}'
tools/seat action texture-slot '{"operation":"create","purpose":"screen","label":"Display"}'
```

| Action | Operations / arguments |
|---|---|
| `select-elements` | `kind:"face"|"edge"|"vertex"`, `indices`; replaces the mode selection in one call. |
| `part-select` | `ids`, optional `primary`; changes the native edit scope too. |
| `part-rename`, `part-visibility`, `part-delete`, `part-duplicate` | `id`; rename adds `name`, visibility adds `visible`, duplicate adds optional `axis:"x"|"y"|"z"`. |
| `part-merge` | `ids` with at least two rows. |
| `part-path-array` | `ids`, `params` (`axis`, `bays`, `turnDegrees`, `riseU`, optional XYZ `points`). |
| `part-import` | `id`: saved model package id or exact model name. |
| `parts-group`, `parts-ungroup` | `ids`. |
| `group-rename`, `group-visibility`, `group-duplicate`, `group-dissolve` | group `id`; rename adds `name`. |
| `outliner-move` | Existing `{item,target}` descriptors used by the Outliner. |
| `role-name` | `partId`, `role`. |
| `model-rename` | optional model `id`, plus `name`. |
| `model-import` | absolute `.glb`, `.obj`, or `.stl` `path`; STL replies `pending:true` while conversion completes. |
| `model-export`, `model-starter` | editor command `id`; character export also takes `role:"player"|"npc"`. |
| `viewport` | `read`; `orbit {yawDegrees,pitchDegrees}`; `frame {target:"model"|"selection"}`; pan; zoom; explicit `pose` (radians); lock; selection-mode; gizmo; wire; xray; `focus` (frame selection); `focus-tool`; mirror; bookmarks. Programmatic moves exit the focus tool first and return the actual live pose. |
| `reference` | `read`; `add {path,patch?}`; `update {id,patch}`; `remove {id}`. |
| `path` | `plane` or `edges`, flat normalized viewport `points:[x,y,…]`, and optional `closed`. Creates a real Outliner part. |
| `uv-state` | Read the complete live UV panel model. |
| `uv-select` | `mode:"island"|"islands"|"face"|"orientation"` plus `index`/`indices` and optional `additive`. |
| `uv-layout` | Full atomic `rects:[x,y,w,h,…]`. |
| `uv-geometry` | Full atomic corner array `corners:[x,y,…]`, optional `historyAction`. |
| `uv-history` | `operation:"read"|"undo"|"redo"`. |
| `uv-atlas` | reset, reload, save, export-wireframe, export-guide, `import {path}`, resize, `add-layer {path,x,y}`, compile-layers. |
| `uv-layer` | layer `id` and the existing `edit` patch. |
| `paint-tool` | Read/set tool, safety, detail, brush, palette; viewport fill, stroke, and polygon. |
| `paint-variant` | read, load, save-new, update, rename, remove. Load/update/remove address variant `id`. |
| `texture-slot` | read, replace, create, assign, select, remove, rename/patch, clear-selected. Membership stays native. |
| `rig` | read; `replace {rig}` for the prop rig; `lights-replace {lights}` for emitted point/spot lights. |

### new versus add

Use `new` when the task needs a new model document. It routes through the editor shell's
existing New Model flow, creates the package and outliner document, and replaces the active
model exactly as the visible UI does:

```bash
tools/seat new cube 1 1 16
```

Use `add` only to append a part to the already-open document. `new` takes no semantic name;
the first `look` bootstraps the primitive's canonical face names. Do not create a probe blob
or reconstruct a lost table to test persistence—make a new model and exercise this normal
flow.

### add — resident primitives

`kind` is one of `cube cylinder cone pyramid plane sphere icosphere`. `size` is the
width (diameter for round kinds) and `height` the height, **both in meters**. `sides` is
the resolution knob — segments for cylinder/cone/sphere (clamped 3..48), subdivisions for
icosphere, ignored by cube/plane/pyramid. So a hexagonal dial is:

```bash
tools/seat add cylinder 0.26 0.10 6 tunerKnob
```

The part **spawns resting on y=0, centred in x/z**, and is left selected — so the very
next `move`/`rotate` positions it. The name is required (an unnamed part is refused, like
an anonymous extrude). Cylinders stand on their Y axis; a knob facing ±X needs a
`rotate 0 0 1 <pivot> 90` after the add.

Surfaces are named in the same creation transaction: cubes get `.right/.left/.top/.bottom/.back/.front`;
cylinders get `.cap.top/.cap.bottom/.wall`; cones and pyramids get `.base/.wall`; other
primitives get `.surface`. The root name selects the whole descendant family.

### cut — loop cut

`direction` is 0 or 1 (the face's two in-plane axes), `cuts` the number of new loops, and
`offset` is 0..1 along the span (0.5 = even). Cut faces stay in their existing semantic
region, so a cut never creates naming debt.

### shot — the agent's eyes

```bash
tools/seat shot /tmp/model.png    # then read the PNG back
```

Captures the app's own composed frame (SELFSHOT-0606) — it never touches the desktop,
which is banned. **Use it to check your own work** instead of asking the user what they
see. It captures the whole editor window, chrome included, at the current camera.

Transforms act on **the current selection** — they take no selector. Always `select`
first. All values are model-space; state the axis and pivot explicitly rather than relying
on a screen gizmo's ambient frame.

Transport: writes one NOTICE to `$RJIT_SOCKET` (default `/tmp/reactjit.sock`), then polls
for `/tmp/reactjit-seat-<id>.json` every 25 ms, **timing out at 15 s**. Exit code is 0 on
`ok:true`, 1 otherwise.

### Follow — learn Delete Faces → Create Face strip replacement

Follow is a real resident observation session, not a request to inspect or modify source
code. It records the user's actual retopology unit while they work normally through the
visible editor: select N triangles and **Delete Faces**, then select the two exposed boundary
edges and **Create Face** between them. One accepted delete followed by one accepted create
is paired into one exact example.

Capture is owned by the successful native **Delete Faces** and **Create Face** transactions,
not by React button handlers. Native keeps a bounded queue of exact observations, including
invocation source; `follow read` and `follow stop` drain and pair every queued lesson into
the hot transcript. Therefore rapid consecutive demonstrations survive UI polling cadence,
and any visible command route records identically. Automation/remote actions are drained but
excluded from the user's lesson set.

```bash
tools/seat follow start "torso vertical strips"
# Reply READY and wait. The user performs 2–4 delete/create replacement pairs.
tools/seat follow read
tools/seat follow stop
```

Each paired example contains:

- `delete.before.selectedTriangles`: the exact resident triangles removed, with two
  welded adjacency rings, part/material/semantic identity, and frontier;
- `create.before.selectedEdges`: the exact two exposed boundary edges, their welded
  endpoint ids and positions, plus their adjacent live face patch;
- `create.after`: the exact replacement face selected by Create Face and its new frontier;
- every `frontier`: boundary edge plus adjacent `outside` triangle, with
  `nonManifold:true` marking a hard stop.

Face and edge ids are ephemeral across deletion; welded endpoint positions are the bridge
between the two actions and across consecutive examples. Follow intentionally excludes
Seat/automation actions so the agent's continuation cannot become its own training example.

To inspect a possible continuation without changing selection:

```bash
tools/seat follow inspect 4812,4813,4819 2
# Equivalent structured request:
tools/seat action follow '{"operation":"inspect","faces":[4812,4813,4819],"rings":2}'
```

After the user says the demonstration is done:

1. Stop and read the transcript. Do not search the repository; the transcript is the data.
2. Compare consecutive examples by the deleted patch centroid, bridge-edge displacement,
   replacement-face frontier, and triangle cadence. The next strip begins at the latest
   replacement face's forward `outside` frontier, not at an arbitrary screen patch.
3. Never cross a part, material, semantic, instance, open, or non-manifold boundary. A pole
   or mismatched cadence needs a fresh human seed.
4. Select the proposed resident triangles in one call:
   `tools/seat action select-elements '{"kind":"face","indices":[...]}'`.
5. Capture a shot with the proposed deletion selected and ask for approval before the first
   unseen change. Once approved: `tools/seat delete`; select the predicted two boundary edge
   ids; `tools/seat create-face <name>`; inspect the replacement face's new frontier.
6. A work-front sliver is provisional while a band remains open. Validate the seam after the
   complete half-shell wrap closes; then mirror the approved half if the model is symmetric.

Closing the wrap is part of the job, not a manual handoff. Pair the stacked seam vertices in
their row order and call `weld-pairs` so every pair gets its own midpoint—ordinary `weld` over
the full seam would collapse all of them into one point. Then pass over each horizontal row
with `normalize-widths`. The host arc-length-resamples the row over its **existing polyline**,
so narrow/wide edge alternation evens out without replacing the torso curvature with a chord.
Reject crossed pair order, reused vertices, part changes, non-manifold frontiers, and any pair
beyond an explicit `maxDistance` derived from the live neighboring edge widths.

Follow currently teaches only the ordered **Delete Faces → two-edge Create Face** pair.
Moving, cutting, welding, or any unrelated topology change between those actions invalidates
the pair; clear it and record again. The feature is deliberately narrow because this torso
cleanup replaces triangle strips mechanically while preserving the generated curvature.

---

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
| `faces:12..18` | Face-group range. Index-based — never durable memory. |
| `inside:box(minx,miny,minz,maxx,maxy,maxz)` | Faces fully inside an AABB. Six finite numbers. |

### Selector gotchas, all real

- Selector keywords are reserved. `top` and `extremal:top` are geometric; `region:top`
  is the primitive's saved semantic region. Bare non-keyword names remain a compatibility
  convenience, but new scripts should always spell durable names as `region:<name>`.
- `part:` belongs to Outliner identity (`part-select`). It is deliberately not a face-range
  selector. Use `faces:<lo>..<hi>` only as an ephemeral bridge from a just-returned receipt.
- **The comparator in `above:`/`below:` is decorative.** `above:y>1.4` and `above:y<1.4`
  compile identically; only the `above`/`below` prefix and the number are read.
- **`inside:box` needs the face fully inside**, and coordinates are absolute. It is the
  only way to isolate a sub-part of a multi-face region (e.g. the front quad of a
  `*.wall` ring), but it is brittle: a bound tuned to exclude a neighbouring quad breaks
  the moment either moves. Re-derive bounds from the live percept, never from memory.
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
  "unnamed": 0,              // naming debt
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

Use `tools/seat --brief ...` for agent work. The live transport calls
`formatSeatPercept()`, removes repeated per-row percepts from batches, and prints one final
digest after the row outcomes. Omit `--brief` only when a machine consumer needs the full
JSON percept.

Extruding one authored quad adds **+8 render faces** (2 cap triangles remain plus 8 wall triangles).

### Semantic persistence — three separate horizons

`look` reports only the resident native mesh. `semantic-status` reports the same three-way
diagnostic shown in Model Focus's **SEMANTICS** section:

| Status / UI tag | Meaning |
|---|---|
| `healthy` / `RESIDENT` | The mount carries names and its named-face count matches the resident mesh; inspect the saved counters too. |
| `visibility-filtered` / `HIDDEN PARTS` | Hidden parts are absent from viewport geometry, but their saved names and face counts remain intact. |
| `mount-mismatch` / `MOUNT DROP` | The saved blob has names, but the viewport input dropped them. |
| `load-mismatch` / `LOAD MISMATCH` | The mount input has names, but native hydration lost them. |
| `resident-only` / `LIVE ONLY` | Names exist live but have not yet been saved. |
| `none` / `NO NAMES` | No horizon currently carries names. |

The result includes document/package identity, `mountSource`, face/name/region counts for
all three horizons, and rows marked `resident`, `mount-only`, or `saved-only`. Refresh Model
Focus or call `semantic-status` after a save instead of guessing whether a CLI or UI display
is stale.

`save` writes RJMD v4 geometry and semantic membership/table together, then re-reads the
written blob. If named resident geometry would become anonymous, save fails and restores the
previous exact blob. Therefore `ok:true` is the save postcondition; the reply's embedded
`percept` is still only the live view. Follow it with `semantic-status` for the horizon
diagnosis.

Use this normal-flow acceptance test whenever semantic persistence changes or is in doubt:

```bash
tools/seat new cube 1 1 16
tools/seat look                         # six primitive names, unnamed: 0
tools/seat select extremal:top
tools/seat extrude 0.25 persistence_test
tools/seat save
tools/seat semantic-status              # status: healthy; saved/mount/resident agree
```

Then fully terminate the editor process, cold-open that saved model, and run
`tools/seat look`. The decisive result is `generation:1`, `unnamed:0`, with `top` and
`persistence_test.cap` / `.wall` still in the table. Hot reload is not a cold persistence
test.

---

## Callable recipes

Recipes are code, not worked examples. Discover them with `tools/seat --brief recipes` and
invoke one with `tools/seat --brief recipe <name> '<json>'`. Each registry entry is either
`candidate` or `approved`: run and visually review a candidate once; only approved recipes
may be chosen automatically from a request like “I need a dial.”

The first candidate is:

```bash
tools/seat --brief recipe dial \
  '{"target":"region:faceplate","normal":"+x","diameter":0.26,"depth":0.10,"sides":24,"name":"tuner"}'
```

It resolves the target bbox, creates a named resident cylinder, rotates its grounded axis
onto the explicit face normal, and seats its base at the target centre. A rejected transform
rewinds every journal unit the recipe created. Do not copy its internal steps into prompts;
improve the callable when the approved flow changes.

### Parts and scope

`add` creates a new outliner **part**, and the editor makes it the **active scope**.
Topology ops intersect selection with that scope. The selector boundary prevents silent
partials: it reports both matched and actionable faces, clears the selection, and rejects
when they differ. `select all` automatically scopes every visible part first.

Use `part-select` for an intentional subset. It updates Outliner selection, primary row,
native edit scope, and selected range as one authority call.

### Pivot as placement

Scaling a cap about an off-centre pivot collapses it *toward that point*. That is how you
position a small feature on a large face — shrink to size about the face centre, then
`move` to the target centre, or scale directly about the target.

### Split before parallel features

Use `cut` for ordered bands, or `elements` → two `select-vertex` calls → `connect` to split
one authored face along a chosen diagonal. Use `create-face` to bridge disjoint selected
edges. Re-run `elements` after every topology mutation: vertex/edge indices are reachable
handles, not durable memory. Name the resulting face selection immediately when its meaning
differs from the inherited source region.

---

## Naming rules

- `extrude <dist> <name>` declares `<name>.cap` and `<name>.wall` in the same journal
  transaction as the topology.
- **Extruding a `.cap` consumes it.** Extruding `faceplate.cap` into `grille` makes
  `faceplate.cap` disappear from the table; it becomes `grille.cap` + `grille.wall`. Only
  `.wall` regions persist down a chain. Plan names so each `.wall` reads correctly on its
  own, since that is what a cold agent will see.
- Reusing an existing name returns the **existing region** rather than making a duplicate,
  and sets it as the new pair's `parent`.
- Anonymous creation uses `_` as the name and is **refused once `unnamed` exceeds 8**
  (`DEFAULT_NAMING_DEBT_BUDGET`). This is only a construction backstop: `save` refuses
  whenever `unnamed > 0`, so every durable model crosses the boundary at zero debt.
- `name` assigns the current selection to a region with role `authored`.
- `create-face <name>` creates then names the selected result. Those are two undo units;
  all native geometry and its semantic table still persist together on `save`.
- The `instance` argument exists on `name`/`extrude` and the percept reports an
  `instances` count per region. Part duplication and path arrays keep the same region names
  while native topology automatically mints a fresh instance family for each copy. Rename
  only when a copy's meaning genuinely diverges.

---

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

## Remaining boundary

General set algebra is still absent; the supported compound is `region:<name> & facing:<axis>`.
Viewport-coordinate actions (`paint-tool` strokes and `path`) are intentionally
camera-dependent; frame or set `viewport` first and checkpoint before using them. OS-picker
commands can be opened through `command`, but prefer path-bearing actions when available.

Part structure and face semantics are both visible to a cold `look`: `parts[]` comes from
the saved Outliner metadata and exact host ranges, while RJMD v4 carries semantic membership
and its name table with the geometry.

Structural topology marks the current paint layout stale. Run `atlas` before `paint`, then
`save`; this is the same explicit “Remake Atlas” decision as the visible editor and prevents
old UVs from being silently endorsed against new geometry.

**Resolution is a budget, never a density you pick.** `atlas` takes `fit` — 512/1024/2048/4096 —
and the host derives texels/meter from the model's own size, so a small prop gets writing-grade
texels and a car divides the same sheet. Omit it and you get the painter's 1024². Do not reach
for the raw `detail` (texels/meter) door to "set the resolution": on a 0.3 m prop a plausible-
looking density packs the whole model into a ~25×26 px sheet where small islands filter away.
`paint` now measures live island texels first and rejects with `atlas fit=<budget>` when that
would happen. Rebuild at the recommended budget, then paint again.

### Why naming everything matters beyond your own session

Named regions are not just agent memory. RJMD v4 carries the semantics in the model
**blob**, so later **skinning** can lean on them: a mesh whose
surfaces are already named is far cheaper to skin from a UV than one that arrives as
anonymous faces. Name honestly and specifically even when the current session would not
need it — you are authoring the input to a later rig, not just a handle for yourself.

---

## Semantic discipline

- Preserve the user's mental model: a repeated structure should share one name, not
  `window1`, `window2`.
- Block out proportions and major parts before detail. Get the meter-scale right first.
- Name meaning at the operation that creates it. Do not plan to reconstruct it later from
  normals.
- Rename or re-author a region when its meaning changes; a confidently stale label is worse
  than an unnamed face.
- Never use raw face indices as durable memory.
- A cold agent must be able to continue from `tools/seat look` alone. If the percept cannot
  support that, pay down naming debt before continuing.
