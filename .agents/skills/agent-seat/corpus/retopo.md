# Phase: retopo

**Forward obligation —** Name each replacement strip as you build it. A retopologized shell that arrives unnamed has thrown away the only cheap input skinning has.

---

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
   boundary edges; when those neighbors disagree (bridging across a recess or ≥90°
   corner selects its two opposing flank walls), the quad's other two edges carry the
   winding instead if they already exist and agree (req_3840). When both opposite
   normal pairs disagree across a harder corner transition, the selected manifold
   boundary edges' directed circulation is the final authority: a consistent loop
   still fills, while contradictory circulation rejects (req_3963/req_3964/req_3965).
   Either opposite pair of a valid 4-edge hole therefore fills it. Do not append an
   unconditional `flip` after it. This
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

### Retopology playbook — the measured reference retopo

The repo carries one complete, finished exemplar of this whole workflow, done by the user's
own hand: a Tripo-generated triangle soup
(`cart/editor/data/models/props/Van_Seat_Soup/mesh/van_seat_soup.glb` — 1,998 tris, 1,049
verts, **26 intersecting shells**, zero mirror symmetry) retopologized into
`cart/editor/data/models/props/car_backseats/mesh/doc.blob` (RJMD v4). Every number below is
measured from those two files. The blob's face-group ids run in creation order, so the build
sequence itself is recoverable data. When asked to retopologize a soup, this is the shape of
DONE — state your plan against these metrics before the first delete.

**Target metrics (what the finished exemplar measures):**

- **~50% of the soup's triangle budget.** 1,998 → 1,015 tris = 531 authored faces. A retopo
  that lands near or above the soup's count is not a retopo.
- **≈90% quads.** 480 quads, 49 lone triangles, 2 three-tri faces. Lone triangles are legal
  ONLY at curvature poles and corner terminations — in the exemplar they cluster at the
  headrest crowns and cushion corners, while the long band rows are 25-quad runs with ZERO
  triangles. A lone triangle in the middle of a flat band is a defect, not a style.
- **Shells collapse ~4×.** 26 soup shells → 6. Everything permanently joined fused into ONE
  continuous shell (cushion + backrest + side bolsters, 746 tris); genuinely separate pieces
  stayed separate small shells (the two headrests, headrest posts as 12-tri boxes).
- **Median ~8 mm surface fidelity** to the source on a ~1 m object. The p99 (85 mm) is
  where detail was deliberately dropped, not error — see the next point.
- **Symmetry is IMPOSED, never inherited.** The soup has 0 exactly-mirrored verts; the
  retopo is 95% bilateral within 4 mm with 27 verts pinned on the centerline. AI soups are
  always slightly askew; the retopo is where the model becomes symmetric.
- **Adaptive quad size.** Edge lengths 14–190 mm (median 48 mm), aspect ratio median ~2.9:
  small quads follow curvature, long strip quads cross flat panels. Uniform density is
  wrong in both directions.

**Drop detail on purpose.** The soup's bolt heads, floor sliders, and a ~350-tri
seatbelt-buckle hardware cluster simply do not exist in the retopo (its bbox floor rose from
y=0 to y=0.087 — the under-floor rails were cut entirely). Sub-centimeter hardware becomes
paint, not topology. Spend the budget on silhouette and the big readable surfaces.

**The measured build order** (replayed from the blob's group-id sequence):

1. **One half first.** The right half of the body went down as side panel → back corner →
   headrest + its posts (faces 0–74 of 531).
2. **Mirror it, then repair the seam.** The left half lands as one contiguous block (faces
   75–174) and carries the densest lone-triangle cleanup. Today that whole step is
   `mirror-replace` (or an armed Mirror Edit from the start) plus `weld-pairs` down the
   centerline — the exemplar is what that verb was built from.
3. **Full-width band rows.** Backrest front, cushion top, cushion front, backrest top,
   headrest crowns, underside — each laid as full-width quad strips (the zero-triangle
   25-quad blocks). This is exactly the retopo-bands + Delete Faces → Create Face corridor
   work described above, row by row, `normalize-widths` per row.
4. **Closeout.** Underside faces and a last handful of bridging quads.

**Name as you go — do better than the exemplar.** The reference blob's semantic table is
EMPTY and it has a single part (`backseats`, one range): it predates the naming ruling and
is exactly the debt SEMBLOB-0801 outlaws. Your retopo names each band and region at the
operation that creates it (`create-face <name>`, `name`) — `cushion`, `backrest`,
`bolster`, `headrest`… — because the entire point of a retopo is a skinnable, riggable
surface, and names are that rig's input. `unnamed: 0` at save, as everywhere else.

**Session mechanics for a retopo specifically:** tint the whole source and freeze it with
the retopo-bands ghost BEFORE the first delete; keep the corridor manifold at every step
(delete mating soup faces on both sides, bridge, `weld-pairs` each seam pair); and finish by
toggling the ghost over the result — coincident curvature reinforces, silhouette drift
separates visibly.

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
