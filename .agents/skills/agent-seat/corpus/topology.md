# Phase: topology

**Forward obligation —** Name every face you create while repairing junctions. Leave no unnamed face behind for the naming phase to guess at.

---

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
