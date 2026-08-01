# The Agent Seat — letting a model sit down at the studio editor

**Status:** design written, awaiting go (req_3573, 2026-08-01)
**Precedent for this doc's shape:** `docs/game/MESH_STABLE_HANDLE_DESIGN.md`

---

## The idea in one line

An agent — Claude, Codex, Kimi, whoever — **takes a seat at the running editor**
and models with the same hands you use: place a cube, select the top face, pull
it up, cut a loop, bevel the corner. You watch it happen live, in the window
that's already open, and every turn it takes is a checkpoint you can rewind to.

Not a code generator that emits a mesh. **A driver of the tools that already work.**

---

## Why the old way fell short, precisely

When agents "write code that makes 3D models" they are authoring vertex arrays
from imagination. There is no feedback, no topology, no snapping, no undo, no
proportion check — a blind author writing a format. It fails for the same reason
a person would fail typing raw coordinates into a text file.

The studio editor removed every one of those handicaps *for you*. The seat gives
the agent the same removal.

---

## What already exists (this is not a rewrite)

The survey that grounds this design. Nearly every part is already built and
shipping — they were built for humans, for tests, and for hot reload, and they
happen to be exactly the five organs a seat needs.

| Organ | What's there today | File |
|---|---|---|
| **Hands** | `ModelToolApi` — ~40 real verbs: `extrudeFace`, `extrudeEdge`, `loopCut`, `basicCut`, `bevel`, `weld`, `solidifySelection`, `glassSelection`, `detachSelection`, `mergeParts`, `mergeFaces`, `trisToQuads`, `duplicatePart`, `pathArray`, `flipSelection`, `deleteSelection`, `appendPart`, `scaleBy`, camera bookmarks… | `cart/editor/stage/ModelView.tsx:245`, mirrored `cart/editor/data/types.ts:155` |
| **Muscle** | The doors those verbs call: `__mesh_topo_extrude_face`, `__mesh_topo_loop_cut`, `__mesh_bevel_begin/preview/end`, `__mesh_topo_solidify`, `__mesh_topo_weld`, `__mesh_topo_detach`, `__mesh_symmetrize`, `__mesh_gizmo_nudge`, `__mesh_gizmo_scale_by`, … | `framework/gpu/mesh_edit.zig`, `framework/v8_bindings_core.zig` |
| **Memory** | Full-snapshot undo journal with **labels**, plus `__mesh_journal_checkpoint(kind, before, after)` for metadata-only units and `__mesh_journal_note()` for cart-side part metadata riding each snapshot | `v8_bindings_core.zig:1336–1490` |
| **Nerves** | `__mesh_action_drain()` → one structured row per accepted commit: `id, document, kind, phase, source, before/after vertices, before/after parts, dropped`. **`source` already distinguishes native gestures from JS-invoked ones.** | `v8_bindings_core.zig:1414` |
| **Governance** | `CommandAuthority` / `CommandRegistry` — one handler entrance, `validateArgs`, `isEnabled` guards with reasons, `undoScope`, `requiredCapabilities`, one applied/rejected outcome per invocation. **`CommandSource` already contains `'remote'` and `'automation'`.** | `runtime/commands/command.ts:20–30` |
| **Wire** | `/tmp/reactjit.sock` — the dev host's live line protocol. `PUSH` / `INFO` / `EVENTS` / `TELEMETRY` / `LOGLEVEL` / **`NOTICE <len>` + JSON, which already routes into the JS runtime** (`emitDevNotice`) | `framework/diag/dev_ipc.zig`, `framework/v8_app.zig:3708` |
| **Eyes** | `__capture_frame(path)` in the live app; `rjit shot` headless. Desktop capture stays banned. | `framework/gpu/capture.zig`, `cli/commands/shot.ts` |
| **Bus** | `runtime/editorbus` — multiplayer-shaped, monotonic `seq`, peer `origin` | `runtime/editorbus/` |
| **Precedent** | `RJIT_MESHOPS` — a ~50-op gesture script that already drives all of the above headlessly | `cart/editor/stage/ModelView.tsx:3112` |

**So the honest statement of scope: the seat is not new machinery. It is a
noun, an amount, a checkpoint, and a socket verb bolted onto machinery that
already runs.**

---

## The actual gap (the whole design turns on this)

Look at the shape of every tool verb:

```ts
extrudeFace: () => void;
loopCut: () => void;
bevel: () => void;
weld: () => void;
solidifySelection: () => boolean;
```

**No arguments.** Every one of them gets its two essential inputs from your hand:

- **the noun** — *what* to operate on — comes from the live host selection you
  made by clicking in the viewport
- **the amount** — *how far* — comes from dragging a gizmo, or from a host-owned
  live popup (`bevel` literally opens one)

An agent has no hand. It cannot click a face and it cannot drag a gizmo. That —
not topology, not file formats, not model capability — is the entire reason this
doesn't already work.

The repo has already solved this twice, deliberately, for tests:

```zig
/// __mesh_gizmo_nudge(axis, amount) → bool. Headless/test hook: translate the
/// active selection along X/Y/Z without needing a mouse drag or captured camera.
```

`__mesh_gizmo_scale_by(factor)` is the same idea. **The seat is the completion of
a pattern the codebase already started** — extend "parameterized, camera-free" from
two ops to all of them, and add a way to name the selection.

---

## The design, in five parts

### 1. The Selector — giving verbs a noun

A person thinks *"the top face of the roof."* They never think *"face 47."*
And face 47 is worse than useless to an agent: **indices don't survive topology
ops.** Extrude once and every index the agent memorized is a lie.

So the seat never speaks in indices. It speaks in **selectors** — a small query
language resolved host-side, against live topology, at the moment of use:

```
facing:+y                      faces whose normal is within 15° of +Y
facing:-z@30                   …within 30°
part:roof                      every face owned by the part named "roof"
group:12                       one authored face group
top / bottom / outermost:+x    extremal faces along an axis
above:y>1.4                    faces whose centroid is above a plane
inside:box(-1,0,-1, 1,2,1)     faces inside a world-space box
loop:from(facing:+y)           the edge loop bounding a face set
border                         open boundary edges
material:glass                 faces carrying a texture role
```

with set algebra: `part:roof & facing:+y`, `all - bottom`, `part:body | part:arm`.

**Resolution lives in Zig**, as one new door — `__mesh_select_query(json)` — for
three reasons: the host already owns topology, the weld map, part ranges, and
normals; nothing large crosses the bridge each turn; and it resolves identically
to how selection already works, so the seat can never drift from the UI's idea of
"selected."

Every op returns **what its selector actually resolved to** (`{faces: 6, groups:[3,4,5…], bbox: […]}`).
The agent is never guessing, and the user's transcript reads in English:

> `extrude part:roof & facing:+y by 0.35` → *6 faces, +0.35 Y, 24 → 42 faces*

This is the single highest-leverage piece. Without it, an agent is doing
index arithmetic and will fail exactly the way the old code-generation approach
failed. With it, it is doing what you do.

### 2. The Ops — verb + noun + amount

One flat, boring, authored vocabulary. Every line is **one `CommandAuthority`
invocation → one journal unit → one action event.** No line invents geometry;
each routes to the `ModelToolApi` verb or host door that already exists.

```
new cube 1,1,1                      # or cylinder | cone | sphere | plane | pyramid | icosphere
add cube 0.4,0.4,0.4 at 0,1.2,0     # append a part to the open model

select part:body & facing:+y
extrude 0.4                         # __mesh_topo_extrude_face + parameterized offset
inset 0.08
move 0,0.3,0                        # __mesh_gizmo_nudge, already parameterized
scale 1.2 axis=x pivot=center       # __mesh_gizmo_scale_by
rotate 15 axis=y

loopcut 2 axis=y at 0.5             # __mesh_topo_loop_cut + explicit cuts/offset
bevel 0.05 segments=2               # __mesh_bevel_begin/preview/end, no popup
solidify 0.05
weld / flip / detach / merge
mirror x                            # __mesh_symmetrize
glass                               # __mesh_topo_glass

part "roof"                         # name the current selection as a part
paint #c0392b                       # __model_paint_group_range
```

**Nothing in this list is new capability.** It is the existing verb list with
the two missing inputs supplied in text.

Deliberately **excluded**: pixel gestures. `pick:x,y` and `box:x0,y0,x1,y1` are
camera-dependent — that's why `RJIT_MESHOPS` has to interleave `wait:frames`.
They stay in the test harness. A seat that aims a mouse is a seat that breaks
whenever the camera moves.

### 3. The Percept — what the agent sees

Before and after each turn, one cheap text digest. Screenshots are a poor primary
sense for geometry; *numbers* are precise and an order of magnitude cheaper:

```
model "streetlamp"  ·  3 parts  ·  86 faces / 240 tris  ·  bbox 0.30 × 4.20 × 0.30
  part "pole"   quads 32  bbox 0.20 × 3.80 × 0.20  at 0, 1.90, 0
  part "head"   quads 40  bbox 0.30 × 0.35 × 0.30  at 0, 3.95, 0   glass: 4 faces
  part "base"   quads 14  bbox 0.30 × 0.15 × 0.30  at 0, 0.07, 0
selection: none        undo 12 / redo 0        take 4 "lamp head"
warnings: 2 non-manifold edges in "head"
```

Plus, on demand, the **eyes**: `seat shot --view front|side|top|iso` — an
orthographic capture at a fixed preset, via the existing `__capture_frame`. Used
for judgment calls ("does this read as a streetlamp?"), not for measurement.

The `warnings:` line is load-bearing. It surfaces the integrity roll call
(`meshIntegrityRollCall`, req_3484) *to the agent*, so a seat that corrupts
topology is told immediately instead of building forty ops on top of rubble.

### 4. The Take — what you watch, and what you rewind to

A **take** is one agent turn: an intent, the ops it ran, a journal mark, and a
thumbnail.

- On take open: `__mesh_journal_mark("take 5: window cuts")` *(new, small)*
- Ops apply **staggered ~80–120ms apart**, drained on a frame timer, so you
  actually *see* it model instead of the mesh snapping between frames.
  **The stagger is the feature** — it's what "watching them build" means.
- On take close: capture a thumbnail, freeze the transcript.
- Rewind: `__mesh_journal_rewind(markId)` *(new)* — pops journal units back to
  that mark. The existing snapshot journal already holds everything needed;
  this is a named entry point, not a new storage format.

Your surface is a **filmstrip** — take thumbnails left to right. Click one, the
model returns to it. The agent is told:

```
REWOUND to take 3 ("base box"). Takes 4–6 discarded. Reason: "roof is too steep"
```

A rewind bumps the seat's **generation**; any op still in flight stamped with an
older generation is rejected with `rewound`. So there is no race where the agent's
next burst lands on top of a state you just undid.

Your own edits are tagged `source: native`. An agent rewind never touches them —
the action stream already carries source attribution, so this falls out of
existing data rather than needing new bookkeeping.

### 5. The Seat — who's driving, and your leash on them

A seat is a connected peer with a policy:

```ts
{
  id: 'seat-1', as: 'claude', document: 'streetlamp',
  allow: ['mesh.*', 'paint.*'],          // never 'file.export', never 'world.*'
  budget: { opsPerTake: 40, opsPerMinute: 200 },
  scope: { parts: ['roof'] },            // optional: may only touch these parts
  mode: 'live' | 'hold' | 'step',
}
```

- **live** — ops apply as they arrive
- **hold** — ops queue; nothing moves until you release. You inspect, then let it go
- **step** — one op per click. For when you're not sure yet
- **take the wheel** — you edit at any time; the seat's ops queue behind yours

Every op goes through `CommandAuthority` with `source: 'automation'`, so
enablement guards, capability requirements, and undo scoping are the ones already
written — and rejections come back as **structured reasons the agent can act on**:

```
REJECTED extrude — selector "part:roof & facing:+y" resolved to 0 faces
  (part "roof" has 0 faces facing +Y; its top faces face +Z. try facing:+z)
```

That feedback loop is what separates a seat from a script. The agent fixes its
own mistakes instead of silently producing garbage.

---

## The wire — how an agent connects

Agent-agnostic on purpose: **anything that can run a shell command can take a
seat.** No MCP, no SDK, no language binding.

```bash
rjit seat open --as claude --doc streetlamp     # → seat id; joins the LIVE editor
rjit seat look                                  # → the percept
rjit seat do 'select part:body & facing:+y
               extrude 0.4
               inset 0.08'                      # one turn, many ops, one reply
rjit seat shot --view front -o /tmp/a.png
rjit seat take "lamp head"                      # close the take
rjit seat history                               # the filmstrip, as text
```

`seat do` is the workhorse: **one round trip per agent turn**, not per op —
matching how these models actually work. The reply is the percept diff plus any
rejections.

Transport: a new `SEAT <len>\n<json>` verb on `/tmp/reactjit.sock`, alongside
`PUSH`/`NOTICE`. It reuses the exact path `NOTICE` already takes into the JS
runtime (`emitDevNotice`), so this is a sibling of a working mechanism rather
than new plumbing. Because the op vocabulary lives in TS, **extending it is a
hot reload, not a rebuild** — only new host doors cost a ship.

A headless flavor falls out for free: same seat, `rjit shot`-style hidden window,
for CI and for agents working without you watching.

The **skill** is then small and honest: the selector grammar, the op list, the
percept format, the turn loop (*look → do → look → shot when unsure → take*), and
the modeling habits that matter — block out proportions first, name parts early,
mirror instead of duplicating, checkpoint before anything structural.

---

## The reference image

*"send an image or just a descriptive prompt"* — the image goes to the **agent**
(these models are multimodal), not to the editor. But there's a real assist the
editor can give, and it's how a person box-models from reference:

**`seat ref <image> --view front`** pins the image as a blueprint plane in the
model viewport at the matching orthographic camera. Then `seat shot --view front`
returns the model *against* the reference at the same camera — so the agent can
compare proportions instead of guessing them. You see the same plane in your
window while it works.

The repo already does exactly this trick for another AI-facing surface:
`atlases/uv-ai-guide.png` (`MODEL_UV_GENERATION_GUIDE_FILE`,
`cart/editor/data/modelPackageStore.ts:725`). Same idea, different axis.

---

## What your screen looks like

The editor you already have, plus one panel (a section, per the fixed-region
layout contract in `cart/editor/shell/regions.ts`):

```
┌─ SEATS ──────────────────────────────────────┐
│ ● claude   live   take 5 · 12 ops · 00:04    │
│   [HOLD] [STEP] [TAKE WHEEL] [EVICT]         │
├──────────────────────────────────────────────┤
│ ▸ select part:roof & facing:+y     6 faces   │
│ ▸ extrude 0.35                    24→42 tris │
│ ▸ inset 0.08                             ok  │
│ ▸ bevel 0.02 segments=2       ⚠ 2 non-manif  │
├──────────────────────────────────────────────┤
│  [1]   [2]   [3]   [4]   [5]                 │
│  base  pole  head  glass roof  ← click=rewind│
└──────────────────────────────────────────────┘
```

The viewport is unchanged — the model builds itself in front of you.

---

## Build order

Riskiest and highest-value first; each step is independently useful.

| # | Slice | Proves / delivers | New Zig |
|---|---|---|---|
| **0** | `SEAT` socket verb + `new cube` + `look` | The live channel works end to end | socket verb only |
| **1** | **Selector resolver + the core 12 ops** | The heart. `select/extrude/inset/move/scale/loopcut/bevel/solidify/weld/mirror/part/paint` | `__mesh_select_query` + parameterized forms of the popup/gizmo verbs |
| **2** | Takes: mark, rewind, thumbnails, stagger | You can watch and revert | `__mesh_journal_mark`, `__mesh_journal_rewind` |
| **3** | Seat panel (filmstrip, transcript, HOLD/STEP/WHEEL) | Your leash | none |
| **4** | Policy, budgets, generations, multi-seat | Safety + more than one agent | none |
| **5** | `seat ref` blueprint planes + camera-preset shots | Modeling *from* an image | textured ortho plane in the model viewport |
| **6** | The skill + export handoff | The agent's model lands as a real package via existing export commands | none |

Slice 1 is the one that decides whether this works. If the selector language is
good, everything after it is assembly.

---

## Risks, honestly

1. **The derived-state matrix.** `project_mesh_consistency_matrix` diagnosed the
   editor's recurring corruption as ~8 hand-synced copies of the mesh doc with no
   commit protocol. **A seat firing 40 ops in 4 seconds is precisely the load that
   trips it.** Mitigations: the seat must adopt re-keyed meshes through the *same*
   path `AppFrame`/`ModelView` already use (`ModelToolApi.resyncFromHost`) — never
   a parallel one; the percept surfaces roll-call warnings to the agent; and the
   stagger keeps ops from stacking within a frame. **The stable-handle work
   (`MESH_STABLE_HANDLE_DESIGN.md`) is the durable fix and should be considered a
   companion to slice 1, not unrelated.**

2. **A second op path.** If the seat re-implements extrude instead of calling the
   existing verb, it becomes copy #9 of the disease. Rule: **every seat op must
   bottom out in an existing `ModelToolApi` verb or host door.** If a verb needs a
   parameter it doesn't have, add the parameter to the *existing* verb — don't
   fork it. (Note `ModelToolApi` is already duplicated across `data/types.ts` and
   `ModelView.tsx`; slice 1 should collapse that to one declaration.)

3. **Headless-only drift.** The value is *you watching*. If this only ever runs
   against a hidden window it becomes a second `RJIT_MESHOPS` and dies as a test
   fixture. Slice 0 targets the live host on purpose.

4. **Vocabulary creep.** Fifty ops nobody remembers is a failure. Twelve good ops
   plus a strong selector language beats fifty weak ones. Add an op only when a
   real model can't be built without it.

5. **The agent is still the agent.** This removes the handicaps; it does not
   make a model a good sculptor. Expect it to be genuinely good at *hard-surface,
   measurable* work — buildings, props, furniture, vehicles, signage — and weak at
   organic form. That maps well onto what this game needs.

---

## Why this fits the house rules

- **Zig-first** (`CLAUDE.md`): the capability — selector resolution, journal marks,
  the socket verb, blueprint planes — lands in `framework/`. TS declares the
  vocabulary and wires it. React renders the panel.
- **V19 ruling** — *"the entire testing surface is replayable all the time and
  DEEP — anything testable is scriptable."* A seat transcript **is** a replayable
  script. Verification and authoring become the same surface.
- **One-liner design philosophy**: `seat do 'select part:roof & facing:+y; extrude 0.4'`
  is the one line, and the person writing it doesn't need to know internals.
- **The active surface is `cart/editor/`** (V32) — that's where this lands.
- **Not an MCP**: a TS API, CLI verbs, and a skill. Any agent, any vendor.
