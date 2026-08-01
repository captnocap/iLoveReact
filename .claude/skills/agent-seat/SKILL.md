---
name: agent-seat
description: Drive the running ReactJIT studio model editor through its live Agent Seat API. Use when an agent must create or revise a 3D model from a prompt or reference image by selecting named/geometric surfaces, extruding, transforming, naming topology, inspecting semantic percepts, or undoing work while the user watches the editor.
---

# Agent Seat

Model with the editor's resident tools; never emit vertex arrays or replace the mesh with generated code. Treat every successful reply's `percept` as the new source of truth.

## Loop

1. Ensure the user has the target model open under `./tools/rjit dev editor`.
2. Run `tools/seat look` before editing.
3. Select a durable name whenever one exists. Use a geometric selector only for the first reach or a deliberate spatial query.
4. Make one coherent structural change, inspect the returned percept, then continue.
5. Use a named operation for every face-creating change. Rewind with `tools/seat undo` as soon as a result diverges from the requested form.
6. Report changes in terms of semantic names and dimensions, not face indices.

For several already-decided operations, send one visible 100 ms-cadence batch:

```bash
tools/seat do '[
  {"action":"select","args":{"selector":"body/front"}},
  {"action":"extrude","args":{"distance":0.2,"name":"window"}},
  {"action":"move","args":{"delta":[0,0.1,0]}}
]'
```

Stop on the first rejected row. Do not blindly retry a rejected batch.

## Inspect and select

```bash
tools/seat look
tools/seat select 'window.rim'
tools/seat select 'facing:+y@15'
tools/seat select top
tools/seat select bottom
tools/seat select 'outermost:-x'
tools/seat select 'above:y>1.4'
tools/seat select 'inside:box(-1,0,-1,1,2,1)'
tools/seat select 'part:12..18'
```

Names are durable primary handles. Geometric selectors resolve against live topology and return the actual face count and bounding box; treat zero or unexpectedly broad results as a reason to stop and inspect.

## Name and create

Name the current selection:

```bash
tools/seat name body/front
```

Extrude the current face selection with declared output roles:

```bash
tools/seat extrude 0.35 parapet
```

This creates `parapet.cap` and `parapet.wall` semantic regions in the same journal transaction as the topology. Never omit the name. `as _` is represented by `_`, but anonymous creation is refused once naming debt exceeds eight faces.

## Transform exactly

All values are model-space. State the axis and pivot; do not rely on a screen gizmo's ambient frame.

```bash
tools/seat move 0 0.3 0
tools/seat scale 1 0 0  0 0 0  1.2
tools/seat rotate 0 1 0  0 0 0  15
```

The first three values for scale/rotate are an arbitrary axis vector, the next three are the explicit pivot, and the final value is factor/degrees.

## Rewind and race safety

```bash
tools/seat undo
tools/seat redo
```

Every percept includes a mesh `generation`. For guarded work, export that generation before the next call:

```bash
RJIT_SEAT_GENERATION=42 tools/seat extrude 0.2 roof
```

A request stamped with an older generation is rejected after a rewind or concurrent edit. Re-run `look`; never apply an old plan to the new mesh.

## Semantic discipline

- Preserve the user's mental model: a repeated structure should share one name and use instances, not `window1`, `window2`, and so on.
- Block out proportions and major parts before detail.
- Name meaning at the operation that creates it. Do not plan to reconstruct it later from normals.
- Rename or re-author a region when its meaning changes; a confidently stale label is worse than an unnamed face.
- Never use raw face indices as durable memory.
- A cold agent must be able to continue from `tools/seat look` alone. If the percept cannot support that, pay down naming debt before continuing.
