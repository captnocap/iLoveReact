# Phase: rig

**Exit truth —** `rig-gates` is host-measured. This phase clears only when
`tools/seat rig-status` reports `state:"bound"`, all seven readiness rows are
`ready`, and `weightsStale`, `fitReview`, and `bindReview` are all false. An
attestation cannot override that result.

Topology, stable anatomy, the independent skeleton, and saved logical-vertex
weights are separate artifacts. Fix the artifact named by the failing row; never
rename parts into bones, infer anatomy from Outliner order, or ask runtime to bind.

## The loop: read one gate, clear one gate

```bash
tools/seat rig-status
```

Run that before any rig action and after every topology, anatomy, object-mode,
fit, joint, bind, or save change. The same structured matrix rides every reply as
`percept.rig`, so rebind debt is ambient rather than something to remember.

Statuses mean:

- `blocked` — authoring input is invalid; repair the named gate.
- `waiting` — a dependent artifact does not exist yet. Before the first Bind,
  the three hash rows and saved-weight row wait together; they are not four
  independent modelling tasks.
- `stale` — an existing bind no longer describes current topology, anatomy, or
  object ownership.
- `ready` — this row is current.

Debt flags are independent of the rows:

- `weightsStale:true` — topology, role membership, or object ownership changed;
  Bind again after the upstream gates pass.
- `fitReview:true` — positions/proportions or inferred joints need inspection;
  refit unlocked joints or place them exactly.
- `bindReview:true` — a joint/frame/constraint changed. Weights survive, but the
  bend tests and saved bind frame must be reviewed.

Read the exact counts in `connected_body` and `required_semantics`; never parse a
human `detail` string and never diagnose by trying Bind.

## 1. Attach and classify

Rigging is an optional capability on **any** open model. Player versus NPC is an
export choice, never a package-kind prerequisite.

```bash
tools/seat action rig '{"operation":"attach-humanoid"}'
tools/seat action rig '{"operation":"object-mode","id":"part:body","mode":"body"}'
tools/seat action rig '{"operation":"object-mode","id":"part:coat","mode":"deformable"}'
tools/seat action rig '{"operation":"object-mode","id":"part:hat","mode":"rigid","bone":"head"}'
```

Read the attach reply. Its preflight names the object it will make BODY and
refuses with a plan when the largest connected mesh is not that object. Do not
accept a wrong BODY and hope to recover during Bind.

- `body` — exactly one primary anatomical object and one logical edge-connected
  component.
- `deformable` — clothing, hair, or another independently solved soft object.
- `rigid` — follows one weighted stable bone at exactly 1.0.

`root` is an unweighted motion control and is refused as a rigid target. Use a
real deforming bone such as `head`, `hand_left`, or `pelvis`.

## 2. Clear connected_body

```bash
tools/seat action rig '{"operation":"select-detached"}'
```

This counts and selects detached BODY faces in the same native pass. Inspect the
selection, then use the ordinary topology verbs:

- debris: delete it;
- a real body crack: delete mating faces if needed, bridge/create the missing
  faces, then `weld-pairs` one matching seam pair at a time;
- an intentional accessory: keep it as a separate stable object and classify it
  deformable or rigid.

One Outliner row, touching surfaces, overlapping shells, and `part-merge` do not
prove a weld. Re-read `rig-status`; do not continue until `connected_body` is
`ready` with exactly one component and zero detached triangles.

## 3. Clear required_semantics and audit boundaries

Display names are not anatomy. Select BODY faces and assign the stable key:

```bash
tools/seat action rig '{"operation":"role","role":"upper_arm:left"}'
tools/seat action rig '{"operation":"coverage"}'
tools/seat action rig '{"operation":"select-uncovered"}'
```

Use the character's anatomical left/right, not the screen side. The required set
is pelvis, abdomen, chest, head, plus left/right upper arm, lower arm, hand,
upper leg, lower leg, and foot. Neck, clavicles, fingers, and toes are optional
only when those surfaces do not exist.

Required-role presence and complete coverage are different facts. `16/16` can
still leave BODY faces uncovered. `coverage` must report every BODY face covered
and no missing required role; `select-uncovered` selects the exact remaining
faces in the same measured pass.

Before Fit or Bind:

```bash
tools/seat action rig '{"operation":"boundary-audit"}'
```

Inspect every adjacent role pair. A joint interface should be one intentional
closed ring with a plausible centroid, plane normal, and width. If an entry is
open, split across loops, or `ragged`, repair the topology/role boundary now.
Never pay for a bind while boundary-audit still reports a ragged joint.

## 4. Fit and place the independent skeleton

```bash
tools/seat action rig '{"operation":"fit"}'
tools/seat action rig '{"operation":"skeleton"}'
```

Fit reports every bone's `boundary | template | manual` source, confidence, and
model-space origin. A `template` fallback is an unresolved inspection item, not
proof that the joint is correct.

Agents place exact model-space coordinates; they do not simulate GUI nudges:

```bash
tools/seat action rig '{"operation":"joint","bone":"lower_arm_left","origin":[-0.42,1.18,0.03]}'
tools/seat action rig '{"operation":"joint","bone":"head","origin":[0,1.72,0],"frame":[0,0,0,1]}'
tools/seat action rig '{"operation":"joint","bone":"lower_arm_left","lock":true}'
tools/seat action rig '{"operation":"mirror-joints","source":"left"}'
```

`frame` is quaternion `x,y,z,w`. Read `skeleton` after edits for absolute
origins, frames, locks, and segment lengths. Moving `root` carries the hierarchy;
moving a non-root origin changes adjacent segment lengths. Lock deliberate manual
joints so a later Fit preserves them; mirror only after the source side is sound.

Seat rig operations acquire and release their native context internally. **Never
send F keys, press F twice, or synthesize viewport focus gestures.** A focus hack
is a GUI artifact, not a rigging operation.

## 5. Bind, then verify numerically

```bash
tools/seat action rig '{"operation":"bind"}'
```

Bind must refuse with the exact failing readiness rows; satisfy those rows rather
than retrying. A successful Bind creates up to four persistent f32 influences per
logical vertex. It does not make a texture or a new Outliner object.

Probe exact source weights, not GPU-packed colors:

```bash
tools/seat action rig '{"operation":"probe","vertex":812}'
tools/seat action rig '{"operation":"weights-summary","bone":"upper_arm_left"}'
tools/seat action rig '{"operation":"weights-symmetry","tolerance":0.00001}'
```

Run `weights-summary` for every deforming limb bone. Inspect vertex count, total
weight, bounds, `maxWeightOutsideRole`, and `bleedsInto`. Whole-rig
`weights-symmetry` compares mirrored logical vertices with mirrored stable bone
IDs and lists offenders; never substitute a position-weld guess.

Run all five tests on both sides (`side:"both"` is the exact paired request):

```bash
tools/seat action rig '{"operation":"bend-test","test":"shoulder","side":"both"}'
tools/seat action rig '{"operation":"bend-test","test":"elbow","side":"both"}'
tools/seat action rig '{"operation":"bend-test","test":"wrist","side":"both"}'
tools/seat action rig '{"operation":"bend-test","test":"hip","side":"both"}'
tools/seat action rig '{"operation":"bend-test","test":"knee","side":"both"}'
```

The numeric gate is displacement, volume delta when measurable, self-
intersections, crease depth, and asymmetry. Shots corroborate those values; they
do not replace them. A failure localizes worst logical vertices, their roles, and
nearest joint. Fix the named cause—anatomy boundary or joint origin—then Bind and
run the complete verification set again.

## 6. History, save, cold reopen, export

```bash
tools/seat action rig '{"operation":"undo"}'
tools/seat action rig '{"operation":"redo"}'
```

Rig history covers Fit, joint/frame/constraint/lock edits, object bindings, and
Bind. It is **session-resident and clears on cold reopen**. Undo is not a recovery
plan across sessions; checkpoint accepted work with Save.

```bash
tools/seat save
tools/seat rig-status
```

Save must complete the geometry/RJSK transaction and acknowledge the manifest
cutover. Then cold-reopen the model and read `rig-status` **without binding
again**. Require `bound`, seven ready rows, no stale/review debt, and matching
resident-versus-saved weights. A draft or stale rig cannot play or export, and no
save, staging, export, or runtime path auto-binds.

Choose gameplay role last:

```bash
tools/seat action model-export '{"id":"export-character","role":"player"}'
# or role:"npc"
```

Player/NPC changes export role only. It never creates, removes, repairs, or
authorizes the rigging capability.
