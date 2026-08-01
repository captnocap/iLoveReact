---
name: agent-seat
description: Drive the running ReactJIT studio model editor through its live Agent Seat API. Use when an agent must create or revise a 3D model from a prompt or reference image by selecting named/geometric surfaces, extruding, transforming, naming topology, inspecting semantic percepts, or undoing work while the user watches the editor.
---

# Agent Seat

Model with the editor's resident tools; never emit vertex arrays or replace the mesh
with generated code. Treat every successful reply's `percept` as the new source of truth.

**This document is the complete capability surface. Everything the seat can do is listed
here, and everything it cannot do is listed under "What the seat cannot do" with the
resident code that would implement it. Do not go grepping the editor to find out whether
a verb exists — if it is not in the verb table below, it is not reachable from the seat.**

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

1. Ensure the user has the target model open under `./tools/rjit dev editor`.
2. Run `tools/seat look` before editing.
3. Select a durable name whenever one exists. Use a geometric selector only for the first
   reach or a deliberate spatial query.
4. Make one coherent structural change, inspect the returned percept, then continue.
5. Use a named operation for every face-creating change. Rewind with `tools/seat undo` as
   soon as a result diverges from the requested form.
6. Report changes in terms of semantic names and dimensions, not face indices.

---

## Verb table — the complete surface

These are the only actions; `tools/seat <anything-else>` exits 2.

| CLI | JSON `{action, args}` | Notes |
|---|---|---|
| `tools/seat look` | `{"action":"look"}` | Returns percept. Bootstraps cube names on a virgin 6–12 face mesh. |
| `tools/seat elements` | `{"action":"elements"}` | Returns ephemeral vertex positions and boundary-edge endpoints. Re-read after topology changes. |
| `tools/seat select <selector>` | `{"action":"select","args":{"selector":"…"}}` | Sets the live face selection. |
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
| `tools/seat scale ax ay az px py pz f` | `{"action":"scale","args":{"axis":[1,0,0],"pivot":[0,0,0],"factor":1.2}}` | Scales along one axis about a pivot. |
| `tools/seat rotate ax ay az px py pz deg` | `{"action":"rotate","args":{"axis":[0,1,0],"pivot":[0,0,0],"degrees":15}}` | Degrees, converted to radians internally. |
| `tools/seat undo` | `{"action":"undo"}` | |
| `tools/seat redo` | `{"action":"redo"}` | |
| `tools/seat delete` | `{"action":"delete"}` | Delete the selected faces, or faces touching selected edges/vertices. |
| `tools/seat merge-faces` | `{"action":"merge-faces"}` | Merge 2+ compatible selected faces. |
| `tools/seat weld` | `{"action":"weld"}` | Weld selected vertices; one selected edge collapses its endpoints. |
| `tools/seat solidify <thickness>` | `{"action":"solidify","args":{"thickness":0.03}}` | Add inner skin and rim walls. Meters. |
| `tools/seat detach <name>` | `{"action":"detach","args":{"name":"roof"}}` | Detach selected faces into a named Outliner part. |
| `tools/seat flip` | `{"action":"flip"}` | Reverse selected face winding. |
| `tools/seat glass` | `{"action":"glass"}` | Toggle glass on selected faces. |
| `tools/seat paint r g b` | `{"action":"paint","args":{"rgb":[180,40,20]}}` | Journaled solid RGB fill of selected faces; bytes 0–255. |
| `tools/seat atlas <template\|solid\|blank> [r g b] [detail]` | `{"action":"atlas","args":{"base":"solid","rgb":[180,40,20],"detail":16}}` | Explicitly rebuild a stale paint atlas after topology edits. |
| `tools/seat material <slot\|clear>` | `{"action":"material","args":{"slot":2}}` | Assign/clear an existing texture-role slot on selected faces. |
| `tools/seat uv <restore\|auto-size\|project-view>` | `{"action":"uv","args":{"operation":"auto-size"}}` | Operate on UV islands belonging to the face selection. |
| `tools/seat save` | `{"action":"save"}` | Full package save: RJMD v4 geometry + semantic table + parts + paint metadata. |
| `tools/seat add <kind> <size> <height> <sides> <name> [x y z]` | `{"action":"add","args":{"kind":"cylinder","size":0.26,"height":0.1,"sides":6,"name":"dial"}}` | Appends a resident primitive as a named part. **Meters.** |
| `tools/seat cut <dir> <cuts> [offset]` | `{"action":"cut","args":{"direction":0,"cuts":2,"offset":0.5}}` | Loop cut the current face selection. |
| `tools/seat mirror <x\|y\|z> [-]` | `{"action":"mirror","args":{"axis":0,"keep":true}}` | Symmetrize; `-` keeps the −side. |
| `tools/seat shot <path>` | `{"action":"shot","args":{"path":"/tmp/x.png"}}` | The app captures its OWN frame. |
| `tools/seat do '<json-array>'` | `{"action":"batch","args":{"requests":[…]}}` | See Batching. |

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

---

## Selector grammar — complete

From `compileSeatSelector`. Anything not matching these returns `unknown selector`.

| Selector | Meaning |
|---|---|
| `all` | Every face. Use this to transform the whole model. |
| `<name>` or `region:<name>` | A named semantic region. **Checked before every pattern below.** |
| `facing:+y` / `facing:-z@30` | Faces whose normal is within N degrees of an axis. **Default tolerance 15°.** |
| `top` / `bottom` | Extremal face on ±y. |
| `outermost:+x` / `outermost:-z` | Extremal face on the named axis. |
| `above:y>1.4` / `below:y>1.4` | Faces above/below a threshold on an axis. |
| `part:12..18` | Face-index range. Index-based — never durable memory. |
| `inside:box(minx,miny,minz,maxx,maxy,maxz)` | Faces fully inside an AABB. Six finite numbers. |

### Selector gotchas, all real

- **Names shadow keywords.** Named-region lookup runs *before* the `top`/`bottom` checks,
  and the cube bootstrap creates regions literally named `top`, `bottom`, `left`, `right`,
  `front`, `back`. So `select top` resolves to the **named region**, not the extremal
  query. They coincide on a fresh cube and silently diverge the moment you edit — after
  raising a mast, extremal-top is the mast tip while the name `top` may not exist at all.
- **The comparator in `above:`/`below:` is decorative.** `above:y>1.4` and `above:y<1.4`
  compile identically; only the `above`/`below` prefix and the number are read.
- **`inside:box` needs the face fully inside**, and coordinates are absolute. It is the
  only way to isolate a sub-part of a multi-face region (e.g. the front quad of a
  `*.wall` ring), but it is brittle: a bound tuned to exclude a neighbouring quad breaks
  the moment either moves. Re-derive bounds from the live percept, never from memory.
- **There are no compound selectors.** You cannot write `deck.wall & facing:-z`. Isolating
  the front quad of a wall ring means hand-fitting an `inside:box` around it.
- Geometric selectors return the real face count and bbox. Zero, or an unexpectedly broad
  result, is a reason to stop and inspect — not to proceed.

---

## The percept

Every reply carries `percept`, the whole state. Shape (`SeatPercept`):

```jsonc
{ "version": 1,
  "generation": 18,          // bump per topology change; used by the race guard
  "faces": 132,              // total triangles
  "unnamed": 0,              // naming debt
  "regions": [ { "id": 0, "faces": 2, "instances": 1, "bbox": [minx,miny,minz,maxx,maxy,maxz] } ],
  "table": { "version": 1, "regions": [ { "id": 0, "name": "right", "role": "+x", "parent": 3,
                                          "createdBy": { "op": "extrude", "at": 1785607074856 } } ],
             "nextRegionId": 6 } }
```

`regions[]` carries live geometry (face count + bbox per id); `table.regions[]` carries
meaning (name, role, parent, provenance). Join them on `id`.

**The reply is verbose and a batch embeds one full percept per row** — a 14-row batch
returns 14 copies of everything. Pipe through a compact reader when driving long
sessions. `formatSeatPercept()` is exported from `seatApi.ts` and renders exactly this
digest, but **the CLI does not call it** — it prints raw JSON.

Extruding one authored quad adds **+8 render faces** (2 cap triangles remain plus 8 wall triangles).

---

## Recipes

### Inset — packaged two-stage move

**The trap:** extruding a face and then scaling its cap turns the *entire face* into a
tapered pyramid, because the wall connects the original full perimeter straight to the
shrunken cap. This is silent and looks plausible until rendered.

**The fix** — `inset` extrudes a hairline first, then shrinks its selected cap along two
explicit in-plane axes. The wall becomes a flat ring in the original plane. Its CLI shape is:

```bash
tools/seat inset <hairline> <name> px py pz a1x a1y a1z f1 a2x a2y a2z f2 [ox oy oz]
```

Example on an X-facing face (shrink Y and Z, then offset the footprint):

```bash
# 1. flat inset ring: the panel stays flat, cap becomes the feature footprint
tools/seat select right
tools/seat inset 0.001 rightPanel 0 0.475 0  0 1 0 0.27  0 0 1 0.47  0 -0.055 -0.1
# 2. now pull the real feature — a crisp nub on a flat panel
tools/seat do '[
  {"action":"select","args":{"selector":"rightPanel.cap"}},
  {"action":"extrude","args":{"distance":0.1,"name":"knob"}}
]'
```

`rightPanel.wall` is the flat panel; `knob.wall` is the barrel. Name the pair for what the
**wall** will mean, because the cap gets consumed (below).

Inset is intentionally a compound recipe, not invented geometry. Its native extrude and
transforms remain separate undo units; if a transform rejects, the seat rewinds every unit
it applied. Bevel, connect, cut, and the other topology verbs are single native journal units.

A **recess** is the same shape inverted: inset ring, extrude hairline, then `move` the cap
*into* the body. That yields crisp square-sided recesses; scaling a cap after a real
extrude yields sloped/chamfered ones. Pick deliberately.

### Parts and SCOPE — the trap that reads as a broken verb

`add` creates a new outliner **part**, and the editor makes it the **active scope**.
Topology ops intersect your selection with that scope (`3d.zig`:
`mask[f] and faceInScopePub(f)`), so after an `add`, a `cut` on faces belonging to a
*different* part silently refuses — the selector happily reports 24 faces and the verb
still says no. That refusal is scope, not your selector.

**The seat has no scope verb.** Until it does: do part-spanning work *before* adding
parts, or operate only inside the part you added last. If a topology verb refuses on a
selection you just confirmed, suspect scope first.

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
  (`DEFAULT_NAMING_DEBT_BUDGET`). Prefer naming everything; the budget is a backstop.
- `name` assigns the current selection to a region with role `authored`.
- `create-face <name>` creates then names the selected result. Those are two undo units;
  all native geometry and its semantic table still persist together on `save`.
- The `instance` argument exists on `name`/`extrude` and the percept reports an
  `instances` count per region, **but no verb duplicates geometry** — the seat cannot
  create an instance. Do not plan around instancing.

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

The generation guard is checked **once, before the request runs** (and for a batch, once
before the first row — not per row). A stale stamp is rejected with
`stale generation N; live generation is M`. Re-run `look`; never apply an old plan to a new
mesh.

---

## What the seat cannot do

The editor underneath is larger than the seat. None of the following is reachable from the
seat today. Do not invent a pixel gesture or parallel mesh path; report the boundary and
offer to add a resident verb.

| Want | Status | Resident implementation |
|---|---|---|
| Scope control (which part ops apply to) | **No verb** | Native `__mesh_edit_scope`, `__mesh_edit_scope_ranges`. See the SCOPE trap above — this is the most likely cause of a "broken" verb. |
| Parts in the percept | **Not reported** | `add` creates parts, but the percept stays face-regions only, so a cold `look` cannot see part structure. Native `__mesh_part_ranges`. |
| Compound/set-algebra selectors | **No verb** | No `name & facing:+z`; select a durable name, then use cuts or element topology to narrow it. |
| Freehand/pixel paint | **No verb** | Seat paint is coordinate-free face fill. Camera-dependent brush strokes remain human tools. |
| Texture-role creation/removal | **No verb** | `material` assigns or clears slots already authored in the Rig panel. |
| Full UV layout editing | **Partial** | Restore, auto-size, and project-from-view are exposed; island dragging/packing/numeric corner edits remain panel tools. |

Part structure remains invisible to a cold `look`; face semantics do not. `save` persists
the RJMD v4 semantic membership and name table with the geometry, so a cold restart retains
the names shown by the percept.

Structural topology marks the current paint layout stale. Run `atlas` before `paint`, then
`save`; this is the same explicit “Remake Atlas” decision as the visible editor and prevents
old UVs from being silently endorsed against new geometry.

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
