# Phase: rig

**Forward obligation —** Topology and naming are rig INPUTS. If a rig gate fails on
connectivity or naming, the fix belongs in those phases, not in a rig workaround.

---

## What exists

Rigging reaches the Seat through two doors, both routed to the shell:

```bash
tools/seat action rig '{"operation":"read"}'          # current rig rows/state
tools/seat action model-export '{"id":"export-character","role":"player"}'
```

`export-character` is the placeability truth for a character; for props, the manifest
written by `save` is what makes the model placeable. Read
`docs/game/DECISIONS.md` (`tools/oracle "prop export rigging"`) before inventing a
convention — export shape is ruled, not a matter of taste.

## Why naming is the rig gate

Semantic region names ride the saved blob **because the rig and the skinner read them**
(V33 · RULED · 12, SEMBLOB-0801). A mesh that arrives with named surfaces is far cheaper
to rig and to skin than one that arrives as anonymous faces. So a rig phase that finds
unnamed faces has not found a rig problem — it has found unpaid naming debt, and the
answer is to go back and pay it.

## Honest gap

There is no host-computed rig audit yet: `connected_body`, joint-coverage, and
weight-sanity are not measured, so this phase's non-naming checks are **agent-attested**.
Each attested check is a filed feature request for a future audit — when the measurement
lands, the check flips to `verified:"host"` and stops depending on an agent's word.
Report what you attested and how you verified it.
