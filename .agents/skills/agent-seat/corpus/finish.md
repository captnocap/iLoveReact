# Phase: finish

**Forward obligation —** A cold agent must be able to continue from `tools/seat look` alone.

---

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

`save` first refuses either unnamed faces or live faces still covered by generator names,
because a durable model needs both complete coverage and an intentional naming pass. It then
writes RJMD v4 geometry and semantic membership/table together and re-reads the written blob.
If named resident geometry would become anonymous, save fails and restores the previous exact
blob. Therefore `ok:true` is the save postcondition; the reply's embedded `percept` is still
only the live view. Follow it with `semantic-status` for the horizon diagnosis.

Use this normal-flow acceptance test whenever semantic persistence changes or is in doubt:

```bash
tools/seat new cube 1 1 16
tools/seat look                         # six generator names; placeholders: 6
tools/seat select region:right && tools/seat name cabinet_right
tools/seat select region:left && tools/seat name cabinet_left
tools/seat select region:bottom && tools/seat name cabinet_base
tools/seat select region:back && tools/seat name cabinet_back
tools/seat select region:front && tools/seat name cabinet_front
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

---

## Handoff notes — intent only, never a fact the seat can measure

```bash
tools/seat oracle note decision    "user wants the hood asymmetric — do NOT mirror it"
tools/seat oracle note observation "the rear seam still reads soft at grazing angles"
tools/seat oracle note todo        "bridge the underbody once the fascia is final"
tools/seat oracle note read        # what the last agent left you
tools/seat oracle note drop <id> | clear
```

**If the seat can measure it, do not write it down.** "Hood bbox is 1.2 m" is poison: three
edits later the next agent still trusts it, and `measure bbox region:hood` would have told
them the truth. A note carries the one thing `look` can never answer — what the user
decided and why. Intent, constraints, deliberate exceptions.

Every note is stamped with the mesh generation it was written at. **Decisions stay durable**
(intent does not expire because geometry moved); **observations and todos go suspect** the
moment the mesh advances, and `oracle note read` marks them. Read decisions as law and
suspect notes as leads to re-verify.

Notes ride the model's package (`notes.json`), so they survive a cold restart and die with
the model. A model with no package yet keeps its pad in memory and the reply says
`durable:false` — save before relying on the handoff.

### Reading a SAVED package

```bash
tools/seat package info [model]        # header, counts, bbox, parts
tools/seat package regions [model]     # the saved semantic table + per-region tri counts
tools/seat package ranges [model]      # per range: triangles, GROUPS, bbox, part name
tools/seat package triangles 700 4     # saved corners AND uvs, by index or 700,701,702
tools/seat package diff                # saved blob vs the resident mesh
tools/seat package compare <model>     # two SAVED packages against each other
```

`ranges` is the one that answers "did this part survive the save with its quads intact":
`ranges: 6` cannot, but 246 triangles over 130 groups can — that is a quad mesh, while
246 over 246 is soup. `triangles` decodes uvs from stride columns 6 and 7, which is the
detail a hand reader gets wrong after getting positions right.

**Never read `mesh/doc.blob` with bun, node, or python.** The header grew 40 → 48 bytes
at RJMD v5 and there are v4 and v5 packages on disk simultaneously, so a hardcoded offset
silently returns wrong numbers for half your models. When the reader refuses, it names the
code and the reason — `[invalid-edge-logical-id] edge region "test" refers outside the
saved logical-vertex table` is a real answer; a hand parser would have returned plausible
garbage instead.
