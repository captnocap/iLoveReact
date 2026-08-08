# Phase: blockout

**Forward obligation —** NAME every face-creating operation as you make it — `extrude`/`create-face`/`add` all take a name. The naming phase AUDITS and refines names; it does not get to invent them from normals. Keep parts separate where a junction will need resolving.

---

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

Surfaces receive generator scaffold names in the same creation transaction: cubes get `.right/.left/.top/.bottom/.back/.front`;
cylinders get `.cap.top/.cap.bottom/.wall`; cones and pyramids get `.base/.wall`; other
primitives get `.surface`. The root name selects the whole descendant family. These labels
prevent anonymous geometry during construction; they do not replace the intentional naming
pass before save.

**`add` produces a sealed solid, and a pile of sealed solids is a BLOCKOUT, not a model.**
This verb is the cheapest thing in the seat: it never fails, it auto-names all six surfaces
so unnamed debt never rises, and it needs no `elements` read and no topology reasoning. Its
generator labels are still intentional-naming debt. That is exactly why it is the trap —
across this repo's 216 model packages, **1,203 of 1,305
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
