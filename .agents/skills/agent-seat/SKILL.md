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
`tools/seat` (the CLI adapter), `cart/editor/shell/AppFrame.tsx` (the always-on transport),
and `cart/editor/stage/ModelView.tsx` (the current mesh-capable Seat).

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

1. Run `tools/seat look` before editing. The always-on shell answers even when no model is
   open. If it returns `state:"no-live-model"`, create the intended first model with
   `tools/seat new`; never ask the user to prepare a disposable bootstrap model.
1.1 Gather your context images. Use the image generation script provided*
2. A new cube should report the six primitive names before further editing.
3. Select a durable name whenever one exists. Use a geometric selector only for the first
   reach or a deliberate spatial query.
4. Make one coherent structural change, inspect the returned percept, then continue.
5. Use a named operation for every face-creating change. Rewind with `tools/seat undo` as
   soon as a result diverges from the requested form.
6. Before any final atlas, paint, or save, clear the **Topology finish gate** below —
   junction by junction, naming each one. A pile of `add`-ed solids is a blockout; shipping
   it throws away ~43% of the model as geometry no camera can reach. `part-merge` resolves
   NOTHING: it welds no vertex and deletes no face, and using it to tidy the Outliner over
   unjoined solids is the worse of the two failures, not the fix.
7. Run `tools/seat save`, then `tools/seat semantic-status`. Require `status:"healthy"`
   and matching nonzero saved/mount/resident counts before claiming that names are durable.
8. Report changes in terms of semantic names and dimensions, not face indices. When cold
   persistence is material to the task, fully stop and reopen the editor and prove the names
   with a generation-1 `look`.

*(
`cart/editor/img.cjs` is the user's generation console (nano-gpt API through the local
SOCKS proxy on 127.0.0.1:9050). Agent lane is `--headless` + a queue file; everything is
env-overridable, so keep the whole run in a scratch workdir:

```bash
W=<scratch>/skin-<model>; mkdir -p $W/prompts $W/out
cat > $W/prompts/<name>.txt <<'EOF'
<the texture prompt — see Prompting below>
EOF
echo '[<name>] [2k] [1] [3] [nano-banana-2-lite] [<ABS-PATH-TO-GUIDE-WITHOUT-EXTENSION>] [none] [aspect_ratio=2:3]' > $W/queue.txt
cd $W && NANO_PROMPTS_DIR=$W/prompts NANO_IMG2IMG_DIR=$W NANO_OUTPUT_DIR=$W/out \
  NANO_QUEUE_FILE=$W/queue.txt NANO_QUEUE_LOG_FILE=$W/queue.log \
  NANO_IMAGE_RESULTS_LOG=$W/results.csv \
  node /home/siah/creative/reactjit/cart/editor/img.cjs --headless
```

Queue line grammar: `[prompt] [resolution] [imgs/batch] [batches] [model] [refs] [style] [k=v,...]`.

- **Always set batches explicitly** — the default is 25.
- Reference paths are absolute **without the file extension** (the loader appends
  .png/.jpg/... itself).
- If Generating a UV, append a UV safety instruction to any img2img run ("fill in the uv,
  remove the wireframe, no trademarks").
- `aspect_ratio` should approximate the atlas w:h (valid: 21:9 16:9 9:16 5:4 4:3 3:4 2:3
  3:2 square auto). Exact dims come later from the resize step, not from the API.
- Models (both proven): `nano-banana-2-lite` — dirt-cheap, ~12 s, halfway-decent; the
  drafting default. `gpt-image-2` — clearly better fidelity; use `[1024x1536]`-style
  resolution (max 2560x1440) + `quality=high`, and the **pink guide, never transparent**.
  Cost is not a constraint; generate 2–4 candidates per look and pick with your eyes.
- **gpt-image-2 WxH must be multiples of 16** (`816x1248`, not `810x1245`) or the API
  400s with INVALID_RESOLUTION. Round up to the nearest 16 and fix it in the resize step.
)

---

## Short verb table

These are the only actions; `tools/seat <anything-else>` exits 2.

| CLI | JSON `{action, args}` | Notes |
|---|---|---|
| `tools/seat look` | `{"action":"look"}` | Returns the resident percept, including separate logical UV-island and independently painted footprint counts, or `state:"no-live-model"` from the always-on shell. Bootstraps cube names on a virgin 6–12 face mesh. |
| `tools/seat semantic-status` | `{"action":"semantic-status"}` | Compares saved RJMD, viewport mount input, and resident native semantics. |
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
| `tools/seat save` | `{"action":"save"}` | Full package save. Re-reads the written RJMD and rejects/rolls back a semantic drop. |
| `tools/seat add <kind> <size> <height> <sides> <name> [x y z]` | `{"action":"add","args":{"kind":"cylinder","size":0.26,"height":0.1,"sides":6,"name":"dial"}}` | Appends a part whose surfaces are named at creation. **Meters.** |
| `tools/seat cut <dir> <cuts> [offset]` | `{"action":"cut","args":{"direction":0,"cuts":2,"offset":0.5}}` | Loop cut: PROPAGATES the edge ring around the whole body — one hood cut also cuts windshield/roof/underbody (measured: +66 tris where basic-cut adds +6). Reach for it only when you want the full ring. |
| `tools/seat basic-cut <dir> <cuts> [offset]` | `{"action":"basic-cut","args":{"direction":0,"cuts":1,"offset":0.5}}` | Subdivides ONLY the selected faces — the bounded local cut. This is the one you want for a local detail line; it never walks the ring. The receipt's `worldDirection` is the seed vector applied geometrically across every selected face. |
| `tools/seat tris-to-quads` | `{"action":"tris-to-quads"}` | Convert the compatible maximum triangle set. |
| `tools/seat collect-uv-orientation` | `{"action":"collect-uv-orientation"}` | Expand one selected face to the same signed UV orientation. |
| `tools/seat mirror <x\|y\|z> [-]` | `{"action":"mirror","args":{"axis":0,"keep":true}}` | Symmetrize across the MODEL-ORIGIN plane (fixed — never a bounds midpoint); `-` keeps the −side. Center the model first if it sits off-origin. |
| `tools/seat shot <path>` | `{"action":"shot","args":{"path":"/tmp/x.png"}}` | The app captures its OWN frame. |
| `tools/seat command <editor-command-id>` | `{"action":"command","args":{"id":"mesh-wire"}}` | Invoke an existing zero-argument editor command through `runCommand`. |
| `tools/seat action <name> '<json>'` | Any structured action below. | Parameterized parity lane; JSON must be one object. |
| `tools/seat do '<json-array>'` | `{"action":"batch","args":{"requests":[…]}}` | See Batching. |

**Live mirror is bilateral (req_3796/req_3797).** With a mirror plane armed (Mirror Edit
X/Y/Z — model-origin plane, always), the editing verbs land on BOTH sides in one journal
transaction: transforms reflect onto twins, and extrude, delete, flip, glass, paint fill,
solidify, detach, merge-faces, weld, connect, create-face, bevel, and extrude-edge all
extend to the selection's mirror twins automatically. A missing/out-of-scope twin honestly
falls back to one-sided. After a mirrored extrude only the SOURCE cap is selected — move it
and the twin cap follows by reflection. Every twin lands as its OWN authored face
(req_3804): bilateral ops pair source and twin positionally, never by shared face
identity — two disjoint pieces reporting as one selectable face is a bug, not mirror
behavior. Exceptions: loop cut already propagates its ring
around the whole body; basic-cut is NOT yet mirror-extended (cut both sides manually).

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
| `part-merge` | `ids` with at least two rows. Merges authoring scope while preserving each face's semantic region; it does not weld vertices or remove hidden faces. |
| `part-path-array` | `ids`, `params` (`axis`, `bays`, `turnDegrees`, `riseU`, optional XYZ `points`). |
| `part-import` | `id`: saved model package id or exact model name. |
| `parts-group`, `parts-ungroup` | `ids`. |
| `group-rename`, `group-visibility`, `group-duplicate`, `group-dissolve` | group `id`; rename adds `name`. |
| `outliner-move` | Existing `{item,target}` descriptors used by the Outliner. |
| `role-name` | `partId`, `role`. |
| `model-rename` | optional model `id`, plus `name`. |
| `model-import` | absolute `.glb`, `.obj`, or `.stl` `path`; STL replies `pending:true` while conversion completes. |
| `model-export`, `model-starter` | editor command `id`; character export also takes `role:"player"|"npc"`. |
| `viewport` | `read`; `orbit {yawDegrees,pitchDegrees}`; `frame {target:"model"|"selection"}`; pan; zoom; explicit `pose` — the 6-array `[yaw,pitch,dist,tx,ty,tz]` or named `{yaw,pitch,distance,target}` merged over the live pose (radians; POSITIVE pitch looks down from above, negative puts the camera below the model); lock; selection-mode (names or 0-3); gizmo (names or 0-2); wire; xray; `focus` (frame selection); `focus-tool`; mirror; bookmarks. Programmatic moves exit the focus tool first and return the actual live pose. |
| `reference` | `read`; `add {path,patch?}`; `update {id,patch}`; `remove {id}`. |
| `path` | `plane` or `edges`, flat normalized viewport `points:[x,y,…]`, and optional `closed`. Creates a real Outliner part. |
| `uv-state` | Read the complete live UV panel model. Optional `indices:[…]` returns only those island rects/intents plus the current selection, avoiding the full atlas-pixel payload. |
| `uv-select` | `mode:"island"|"islands"|"face"|"orientation"` plus `index`/`indices` and optional `additive`. |
| `uv-layout` | Full atomic `rects:[x,y,w,h,…]`. |
| `uv-prestack` | `plan` with `mode:"exact"|"normalize"` (normalize default), optional diagnostic `indices:[…]`, then `apply` with the returned `token`. Whole-layout repeat scan; reports logical islands and exact texture footprints separately; inspected indices return their matched families. |
| `uv-stitch` | `plan` with `indices` + `active` (or the current UV island selection), then `apply` with the returned `token`. Joins only welded-identity seams. |
| `uv-two-sheet` | `plan` with optional `heroIslands`/`uniformIslands`, semantic substring lists, `minimumReadableAreaTexels`, and `maximumReadabilityBoost`, then `apply` with its `token`. Natural proportional size is preserved; only undersized material/support footprints are enlarged toward the bounded readability floor. After apply, `export-guides` with the same token writes cropped hero + uniform guides. |
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

**`add` produces a sealed solid, and a pile of sealed solids is a BLOCKOUT, not a model.**
This verb is the cheapest thing in the seat: it never fails, it auto-names all six surfaces
so naming debt never rises, and it needs no `elements` read and no topology reasoning. That
is exactly why it is the trap — across this repo's 216 model packages, **1,203 of 1,305
region creations came from `add`, and 12 came from actually editing a mesh.** Every one of
those models measures ~43% unreachable geometry (see the Topology finish gate).

Blocking out with `add` is correct and expected. STOPPING there is not. Every place two
primitives end up permanently joined is a junction you owe: delete the mating faces on both
sides, bridge the openings, weld the seam. If you are not going to pay that, do not add the
primitive — extrude, inset, or cut the surface you already have instead, which produces
joined topology for free.

### cut vs basic-cut — ring propagation vs local subdivide

`direction` is 0 or 1 (the face's two in-plane axes), `cuts` the number of new loops, and
`offset` is 0..1 along the span (0.5 = even). Cut faces stay in their existing semantic
region, so a cut never creates naming debt.

The two verbs differ in REACH, and picking the wrong one costs an order of magnitude of
budget (req_3763 P1-3, measured on an identical `region:hood` selection at offset 0.5):

- `cut` walks the edge ring around the entire body: `966 → 1032 (+66)`, touching
  noseTop, hood, windshield, roof, backlight, trunkLid, underbody, rearFascia, frontFascia.
  Use it when the model needs a full station line (a new cross-section loop).
- `basic-cut` subdivides only the selected faces: `966 → 972 (+6)`, `{hood: 6}`. Use it
  for every local detail line — panel breaks, recess edges, arch rounding. Rounding a
  wheel-well roof with `cut` costs ~140 tris; with `basic-cut` it costs ~6.

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
```

Captures the app's own composed frame (SELFSHOT-0606) — it never touches the desktop,
which is banned. **Use it to check your own work** instead of asking the user what they
see. It captures the whole editor window, chrome included, at the current camera.

Transforms act on **the current selection** — they take no selector. Always `select`
first. All values are model-space; state the axis and pivot explicitly rather than relying
on a screen gizmo's ambient frame.

Transport: writes one NOTICE to `$RJIT_SOCKET` (default `/tmp/reactjit.sock`), then polls
for `/tmp/reactjit-seat-<id>.json` every 25 ms, **timing out at 15 s**. AppFrame owns the
receiver from editor startup; ModelView is not a prerequisite. Exit code is 0 on `ok:true`,
1 otherwise.

### Retopology band map — review the whole model before replacing strips

The retopology map is package-backed authoring data, not paint, material, or mesh geometry. It assigns
**every resident face** to an axis band and renders adjacent bands with distinct translucent
colors over the live mesh. Planning does not mutate mesh geometry, dirty the atlas, alter
materials, or change semantics. It creates one model-history unit and atomically writes
`mesh/retopo-guide.blob` in the active model package. The reply is accepted only when
`covered === faces` and package persistence succeeds.

When the planner is wrong, the user authors the truth directly. In Face mode, select the
faces belonging to one band. In the Studio action bar, click the **BAND** chip to cycle
colors, then press **Tint** (palette icon). The eraser icon removes the selected faces'
assignment; the eye toggles the frozen source ghost; X clears the full temporary map and
ghost. The equivalent shell flow is:

```bash
tools/seat action retopo-bands '{"operation":"tint-selection","id":0}'
# Select the next band in the viewport, then use id 1, 2, ... through 11.
tools/seat action retopo-bands '{"operation":"tint-selection","id":1}'

# Correct a mistake: select the wrongly tinted faces, then erase their assignment.
tools/seat action retopo-bands '{"operation":"untint-selection"}'

# At any later point, compare the edited surface against the frozen source soup.
tools/seat action retopo-bands '{"operation":"ghost"}'
tools/seat action retopo-bands '{"operation":"ghost","visible":false}'
```

Tinting atomically updates the model package after copying its exact triangle mask, then clears
the face selection, making the chosen
color immediately visible and leaving the viewport ready for the next band. A manual `read`
reports `mode:"manual"` and `covered` as the number assigned so far; `select {id}` reselects
that exact mask. Same-document face deletion, weld compaction, and the normal retopology
**Delete Faces → Create Face** pair preserve the map: surviving triangles retain their
assignments, and a replacement face inherits the one band shared by the deleted patch.
Mixed-band or partly untinted deletions deliberately give the replacement no tint. Switching
models loads each package's own guide. Pressing X is the explicit destructive action that clears
the map, frozen source, and package sidecar. A normal Save also writes the current guide beside
the mesh document. Tint/erase/ghost replies carry `persisted:true`; a live mutation whose sidecar
write fails is a rejected operation and must never be described as durable.

`delete` returns `deletedBoundary`, captured before face compaction. Internal edges in the
deleted set occur twice and cancel; its compact ordered `components` are the exact
once-occurring perimeter, with welded endpoint ids and positions still owned by the surviving neighbours. Rebuild
from that transaction provenance. Do not rediscover it through a whole-mesh `elements`
dump or a geometric bbox guess. When deletion happened immediately before a Seat reconnect,
consume the same unread native record with `operation:"deleted-patch"`.

Retopology guide edits participate in the normal chronological model history. One plan,
Tint, erase, eye toggle, or clear press is one Ctrl+Z step; Ctrl+Y restores that exact step.
Every topology journal snapshot carries the guide version matching its geometry, so undoing
Delete Faces/Create Face restores the corresponding live band membership without discarding
the frozen source. Undo and redo immediately rewrite (or remove) `mesh/retopo-guide.blob` as
well as changing the resident overlay. Never implement a second guide-only undo stack or
reconstruct membership from the current viewport after a history step.

The **first manual tint freezes the original resident triangle positions** and begins a
parallel source-band map. Further tint/erase actions update that frozen map only until the
first topology generation change. After editing starts, the source is immutable while the
live labels follow face compaction and replacement. Toggle **Eye / `operation:"ghost"`** at
the end to project the colored original soup over the current mesh: coincident curvature
reinforces, while silhouette or surface drift separates visibly. The ghost receipt reports
`faces`, `covered`, `generation`, and `visible`; complete comparison requires tinting the
whole source (`covered === faces`) before the first delete. The package sidecar stores the
exact frozen triangle positions, source/live band membership, and ghost visibility, so a full
process rebuild or cold reopen restores the work. It is never an editable duplicate part.

Cold-restart acceptance test: tint at least two bands, toggle the ghost on, fully terminate and
reopen the editor, then `retopo-bands read` must report the same coverage and the GUI must still
show `GHOST ON`. If either disappears, stop—the package persistence contract is broken.

```bash
# Select the already-approved open quad strip; its geometry is the specification.
tools/seat select region:torso.retopo.band
tools/seat action retopo-bands '{"operation":"plan-from-selection"}'

tools/seat action retopo-bands '{"operation":"read"}'
tools/seat action retopo-bands '{"operation":"select","id":7}'
tools/seat action retopo-bands '{"operation":"select","id":"all"}'
tools/seat action retopo-bands '{"operation":"clear"}'
```

Each band row reports `id`, signed phase `bucket`, triangle count, local rail-relative
`range`, full bbox, and its RGB overlay color. A rail plan also reports `mode:"rails"`,
mean local `width`, and `railSamples`. `select id:"all"` selects every mapped resident face, expanding
the native scope to every visible Outliner part first. Selecting one band uses the exact
resident face mask behind the tint; it is not a geometric selector reconstructed later.

**Never derive band height from the seed's global bbox.** A strip can slope while retaining
constant local height: its global `minY..maxY` includes the lateral rise and therefore
overstates the band. `plan-from-selection` orders the two-triangle authored quads, recovers
every cross-section as lower.xyz + upper.xyz, and classifies faces against the nearest
interpolated rail segment in XZ. Once a band is established at a lateral position, faces
above its local upper rail or below its local lower rail cannot belong to that band.

Frame the whole model and inspect front, side, back, and iso views before changing topology.
The older `plan {axis,width,origin}` operation remains a diagnostic for genuinely planar
slabs; it is not a torso-retopology substitute. The rail map is still a proposal:
shoulders, poles, limb junctions, and other topology transitions can expose where a single
axis plan needs separate zones before automation continues.

### Follow — learn Delete Faces → Create Face strip replacement

Follow is a real resident observation session, not a request to inspect or modify source
code. `result.events` is the authority: an ordered, append-only firehose of every accepted
resident journal edit from every invocation source, carrying its native before/after payload.
Read that array first. Never infer that an edit did not happen because `result.examples` is
empty.

`result.examples` is only a derived convenience view for the common retopology unit: select
N triangles and **Delete Faces**, then select the two exposed boundary edges and **Create
Face** between them. Intervening actions, closed-loop creates, transforms, undo/redo, and
other topology decisions remain in `events` even when they match no recipe. Automation and
remote events remain in the raw firehose but are excluded from human demonstration examples
so an agent cannot train on its own attempts.

Capture is owned by successful native journal transactions, not by React button handlers.
Native keeps every unconsumed observation; `follow read` and `follow stop` move the queue into
the hot append-only transcript. The independent Follow queue must never share the cart's
destructive action drain and must never evict older events before a read. Rapid consecutive
demonstrations therefore survive UI polling cadence, and every visible command route records
identically.

```bash
tools/seat follow start "torso vertical strips"
# Reply READY and wait. The user performs 2–4 delete/create replacement pairs.
tools/seat follow read 0 8
tools/seat follow read 8 8
tools/seat follow stop 16 8
```

Each raw event contains `index`, numeric journal `kind`, `source`, observation time, and
native `before`/`after`. Journal summaries prove every accepted edit in order; operations
with richer observers additionally include local topology patches. Reads are paged so a long
demonstration cannot overflow the socket response: start at offset 0 and keep reading from
`eventNext` until it is `null`; `eventTotal` is the retained transcript size and `limit` is
clamped to 1..32. Paging never drains or truncates the stored transcript. `kind:255` means the
journal label has no compact action-enum entry; the edit is still real and ordered, so use
`before.label` (for example `weld`) instead of discarding it. Each derived paired example
contains:

- `delete.before.selectedTriangles`: the exact resident triangles removed, with two
  welded adjacency rings, part/material/semantic identity, and frontier;
- `create.before.selectedEdges`: the exact two exposed boundary edges, their welded
  endpoint ids and positions, plus their adjacent live face patch;
- `create.after`: the exact replacement face selected by Create Face and its new frontier;
- every `frontier`: boundary edge plus adjacent `outside` triangle, with
  `nonManifold:true` marking a hard stop.

Face and edge ids are ephemeral across deletion; welded endpoint positions are the bridge
between the two actions and across consecutive examples. Only derived examples exclude
Seat/automation actions so the agent's continuation cannot become its own training example;
the authoritative raw firehose includes every source.

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
   replacement face's forward `outside` frontier, not at an arbitrary screen patch. If that
   open edge is `[a,b]`, the next two bridge edges must contain `a` and `b` respectively.
   An edge sharing neither endpoint is invalid without further geometric reasoning.
3. Never cross a part, material, semantic, instance, open, or non-manifold boundary. A pole
   or mismatched cadence needs a fresh human seed.
4. Select the proposed resident triangles in one call:
   `tools/seat action select-elements '{"kind":"face","indices":[...]}'`.
5. Capture a shot with the proposed deletion selected and ask for approval before the first
   unseen change. Once approved: `tools/seat delete`; query the new work front locally with
   `tools/seat action boundary-continuation '{"open":[a,b]}'`, then select one returned
   pair with `tools/seat action select-edge-continuation
   '{"open":[a,b],"edges":[[a,c],[b,d]]}'`; then
   `tools/seat create-face <name>` and inspect the replacement face's new frontier. Create
   Face derives the new winding from the authored surface normals beside both selected
   boundary edges; do not append an unconditional `flip` after it. This
   continuation resolver runs inside the editor, so large imports never depend on the full
   `elements` reply fitting across the socket. When deletion rekeys the endpoints, use
   `select-edge-points` with the two pre-delete coordinate pairs; it uniquely resolves the
   surviving live vertices within the supplied tolerance before selecting their edges.
6. A work-front sliver is provisional while a band remains open. Validate the seam after the
   complete half-shell wrap closes; then mirror the approved half if the model is symmetric.

After each six-triangle replacement, inspect the local topology before advancing. A successful
Create Face can strand the unconsumed fan as a detached two-triangle island: every frontier edge
of that component reports `outside:null`. Delete that residual island immediately, then capture
a shot and require a visually continuous rail-to-rail strip. Face counts and named-quad receipts
do not prove corridor coverage; black gaps or overlapping diagonals are a failed step.

Closing the wrap is part of the job, not a manual handoff. Pair the stacked seam vertices in
their row order and call `weld-pairs` so every pair gets its own midpoint—ordinary `weld` over
the full seam would collapse all of them into one point. Then pass over each horizontal row
with `normalize-widths`. The host arc-length-resamples the row over its **existing polyline**,
so narrow/wide edge alternation evens out without replacing the torso curvature with a chord.
Reject crossed pair order, reused vertices, part changes, non-manifold frontiers, and any pair
beyond an explicit `maxDistance` derived from the live neighboring edge widths.

At a junction where two completed work fronts meet, do not treat “close the belt” and
“continue upward” as alternatives. The demonstrated transition is ordered: create the direct
quad between the two open fronts; delete the adjacent old soup quads above that bridge; grow
replacement quads upward from the new boundary; weld each stacked seam pair; then normalize
the row widths while retaining their existing curved paths. The direct bridge preserves the
band, while the upward replacements keep the whole shell manifold.

The derived example matcher currently recognizes only the ordered **Delete Faces → two-edge
Create Face** pair. Moving, cutting, welding, or a junction transition can prevent a derived
pair, but never invalidates the raw lesson: read the surrounding firehose events and their
journal labels in order. Do not clear or ask the user to repeat a demonstration merely because
`examples` is empty.

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
  "islands": 27,             // logical UV islands; 0 until an atlas is readable
  "footprints": 19,          // exact independently painted regions after stacking
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

### Topology finish gate — TWO ways to fail, both unacceptable

Measured on real models in this repo, by casting a 42-direction visibility fan off every
face (req_3742):

| model | triangles | unreachable from ANY angle |
|---|---|---|
| Stepthrough_Moped — ~32 primitives, never joined | 2,436 | **1,058 (43%)** |
| Moped_50 — 63 primitives, never joined | 2,046 | **895 (44%)** |
| radio_001 — box-modelled from ONE cube | 132 | 4 (3%) |

**Dropping primitives and not joining them throws away 43% of the model.** Those triangles
sit inside other solids. They are paid for four times over: transformed in the vertex buffer
every frame, baked into `collision.blob` (36 bytes/triangle, filtered only by Outliner
hide/show — nothing else), given their own UV islands and their share of the atlas budget,
and then multiplied by every instance placed in the world.

None of that appears in `unnamed`, in `semantic-status`, or in a screenshot. A model can read
`unnamed: 0 · healthy · save ok:true` and still be 43% garbage. Those receipts measure
bookkeeping. They do not measure whether you built a model.

**FAILURE 1 — soup.** Leaving N intersecting sealed solids that merely touch or overlap. Each
one keeps its entire closed surface including the parts buried inside its neighbours, and no
two of them share a vertex — so their UV islands can NEVER be stitched, because
`stitchUvIslands` matches on shared **mesh vertex index**, not position
(`cart/editor/model/uvLayout.ts`). Touching in 3D is not joining. Perfect contact is not
joining. 216 packages in this repo are in this state and cannot be skinned coherently.

**FAILURE 2 — the fake merge, and it is WORSE than failure 1.** Running `part-merge` until
the Outliner looks tidy while the geometry underneath is untouched. **`part-merge` does not
weld one vertex and does not delete one hidden face.** It changes which row owns which faces,
nothing else. A model merged from 33 solids down to 4 rows carries exactly the same 43% dead
geometry it had before — now hidden from the one panel that made it visible. That is not
progress, it is concealment, and the next agent inherits a lie. Do not do it.

**Row count is not the metric and never was.** You may finish a model with 78 Outliner rows.
Rows are authoring scope — they organize, they hide, they hold names. Whether the SURFACE is
continuous is a completely separate question, and it is the only one that matters here. Parts
and welding are orthogonal: *weld to establish the address; detach to break identity while
preserving the address.*

#### The unit of work is the JUNCTION, not the row

For every place two permanently-joined pieces meet:

1. Seat them in exact contact — numerically, per **Contact and assembly** below. Not by eye.
2. **Delete the mating faces on BOTH sides.** The faces that only ever point into the other
   piece are deleted, not hidden, not excluded, not left for later.
3. **Bridge the two openings** with `create-face` so the two surfaces become one continuous
   shell across the join.
4. **`weld-pairs` the seam** so each corresponding vertex pair collapses to one shared
   address. Now the islands either side of that join are stitchable, forever.

Repeat per junction. There is no bulk shortcut and looking for one is how both failures above
happened. It is work. Do the work.

#### Worked reference — Moped 50's centre stand (req_3744)

The user's own demonstration, and the shape to copy:

- `centerStandLeg.bottom` **deleted outright** — the cap that only ever faced into the bar.
- The bar's end caps **opened from 10 triangles to 3** where each leg lands.
- The openings **bridged**: +19 verts, +20 edges, +6 triangles. Authored faces unchanged.
- Result: the bar and both legs are ONE surface.
- **Outliner rows afterwards: still three. Still 78 total. Nothing was merged.**

Verify a junction the same way, from `look` alone: the two regions' bboxes share
bit-identical bounds where they join.

```
centerStandBar.cap.top  y-min 0.1401715     centerStandLeg.back  y-max 0.1401715
centerStandBar.wall     y-max 0.18163764    centerStandLeg.front y-max 0.18163764
```

Solids that merely touch never produce bit-identical bounds across regions. That is what a
weld looks like in the percept.

#### Finish acceptance

Do not call a model finished until you can state all four in your own words:

1. **Every permanent junction is resolved by the four steps above — name them, one by one.**
   "I merged the rows" is not an answer to this question.
2. **No mating face survives** anywhere two pieces are permanently joined. Keep mating faces
   ONLY on parts that articulate, open, detach, or break — where that surface can become
   visible.
3. **Atlas rebuilt only AFTER the topology pass**, never before. Compare `islands` against the
   blockout; islands that did not fall are buried faces you did not remove.
4. `save`, then `semantic-status` still `healthy`. Losing regions during this work is a bug —
   but keeping primitive rows to protect their names is not an acceptable workaround, because
   rows were never what you needed to change.

### Contact and assembly — make it touch, remove what cannot show

Treat contact as geometry, not appearance. A screenshot can judge the silhouette, but it
cannot prove that two pieces touch. Never hide a gap with perspective or bury one solid
inside another by eye.

For two axis-aligned mating surfaces:

1. Select the stationary surface/region and record its bbox contact plane.
2. Select the moving part's root region and record its bbox. Compute the exact translation:
   `delta = stationaryPlane - movingPlane` on the contact axis.
3. Move by that exact delta. Re-select both and require the plane difference to be at most
   `0.00001` m, with positive interval overlap on both other axes. Equality on one axis
   without overlap on the other two is not contact.
4. Inspect an orthographic shot only after the numeric check.

AABB planes are valid only for axis-aligned planar contact. For rotated, tapered, or curved
surfaces, use the actual boundary vertices from `elements`; pair the corresponding vertices
and establish contact with `weld-pairs`. Re-read `elements` after every topology mutation,
because all element ids are ephemeral.

Once a permanent assembly is seated, remove geometry that cannot ever be seen:

- If two whole faces mate permanently, delete both internal faces before joining their
  boundary. Keeping coplanar internal faces wastes geometry and can z-fight.
- If only part of a face is covered, cut/inset/connect until the hidden patch is its own
  face, then delete only that patch. Never delete an exposed remainder for convenience.
- Keep the mating faces on articulated, removable, opening, or damageable parts whose
  contact surface can later become visible.
- Verify the deletion from more than one view and inspect the returned boundary. A black
  exterior gap means the wrong face or too much face was removed.

Use this exact topology order when pieces need a shared seam:

1. Place the parts in exact contact.
2. Delete the permanently hidden mating faces or isolated hidden patches on BOTH sides.
3. Bridge the two openings with `create-face` so the surfaces become one shell across the
   join.
4. Re-read `elements`, pair corresponding seam vertices in order, and call `weld-pairs`
   with a `maxDistance` derived from the neighboring edge length. This establishes one exact
   address per pair without collapsing an entire seam to one point.
5. If the pieces must remain distinct authoring objects, `detach <name>` afterward.

`part-merge` is **not** in this list. It is an Outliner-scope convenience and it changes no
geometry whatsoever — it welds nothing and deletes nothing. Reaching for it here is the fake
merge described in the finish gate above: it makes the rows look resolved while leaving every
buried face and every duplicate vertex exactly where they were. Merge rows when you want one
editing scope, never as a step toward joined topology, and never as evidence of it.

Detach is deliberately last. It is a pure authored-group/part remap: geometry does not move,
but the indexed mesh is rebuilt so the two parts receive separate vertex identities at the
same coordinates. That is how two parts can sit on the **same address** without remaining one
welded topology. In short: weld to establish the address; detach to break identity while
preserving the address. Detaching before alignment leaves two independently drifting seams;
welding after detaching joins them again.

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
- Treat a pile of `add`-ed solids as a blockout, never a finished prop. Resolve it junction
  by junction: delete the mating faces on both sides, bridge the openings, weld the seam.
  Rows may stay exactly as they are — row count was never the metric, and `part-merge`
  changes no geometry at all.
- Seat contacting parts with exact plane/vertex math; visual closeness is not contact.
- Remove permanently occluded mating faces, but retain any surface that articulation,
  damage, or removal can expose.
- Use weld-then-detach when logical parts need separate vertex identities at exactly the
  same coordinates.
- Name meaning at the operation that creates it. Do not plan to reconstruct it later from
  normals.
- Rename or re-author a region when its meaning changes; a confidently stale label is worse
  than an unnamed face.
- Never use raw face indices as durable memory.
- A cold agent must be able to continue from `tools/seat look` alone. If the percept cannot
  support that, pay down naming debt before continuing.
