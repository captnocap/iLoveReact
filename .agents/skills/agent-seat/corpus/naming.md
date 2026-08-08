# Phase: naming

**Forward obligation —** This phase refines and audits. If it finds unnamed faces, the earlier phase failed its obligation — fix it here, and say so.

---

## Naming rules

- Names are **RIGGING input**, so intentional names describe parts and affordances:
  `headrest_undersides`, `seat_rig_player_back_to_this_face`. Geometry restatements such as
  `postFR.top` are generator scaffolding, not the finished table.
- `extrude <dist> <name>` declares `<name>.cap` and `<name>.wall` in the same journal
  transaction as the topology.
- **Extruding a `.cap` consumes it.** Extruding `faceplate.cap` into `grille` makes
  `faceplate.cap` disappear from the table; it becomes `grille.cap` + `grille.wall`. Only
  `.wall` regions persist down a chain. Plan names so each `.wall` reads correctly on its
  own, since that is what a cold agent will see.
- Reusing an existing name returns the **existing region** rather than making a duplicate,
  and sets it as the new pair's `parent`.
- The user has the same verbs in the GUI (req_3872/req_3880/req_3894): **N** in face mode (or
  Edit → Mesh → Name Faces…) opens a naming popover, and the **NAMES** pane lists every
  region with per-row rename and remove. All of it lands on the same table and host doors
  you use. Regions you did not create may therefore appear — and names you did create may be
  renamed or removed — between your calls; re-read the percept's table instead of assuming
  you are the only author, and never rename or remove a human-authored region unasked.
- A wrong name is fixable now: `region-edit` renames or removes. That is a correction tool,
  not a licence to leave naming until later — a name still belongs to the operation that
  creates the geometry.
- Anonymous creation uses `_` as the name and is **refused once `unnamed` exceeds 8**
  (`DEFAULT_NAMING_DEBT_BUDGET`). This is only a construction backstop: `save` refuses
  whenever `unnamed > 0`, and separately refuses generator-named regions that still carry
  faces, so every durable model crosses the boundary with complete coverage and an intentional
  naming pass.
- `name` assigns the current selection to a region with role `authored`.
- `create-face <name>` creates then names the selected result. Those are two undo units;
  all native geometry and its semantic table still persist together on `save`.
- The `instance` argument exists on `name`/`extrude` and the percept reports an
  `instances` count per region. Part duplication and path arrays keep the same region names
  while native topology automatically mints a fresh instance family for each copy. Rename
  only when a copy's meaning genuinely diverges.

---

### Why naming everything matters beyond your own session

Named regions are not just agent memory. RJMD v4 carries the semantics in the model
**blob**, so later **skinning** can lean on them: a mesh whose
surfaces are already named is far cheaper to skin from a UV than one that arrives as
anonymous faces. Name honestly and specifically even when the current session would not
need it — you are authoring the input to a later rig, not just a handle for yourself.

---

---

## Class specs — the depth you are being graded against

When the task matches a class with approved exemplars, the oracle loads a spec DERIVED from
those models and grades you against it:

```bash
tools/seat oracle spec car          # triangles, quad ratio, metre dimensions, parts, naming
```

The part list of an approved model **is its articulation spec**. Doors, lids, and bumpers
are separate Outliner parts because they open or break — which is exactly when mating faces
legitimately survive junction resolution. So "keep the faces that articulation can expose"
stops being a judgement call: for the class, these named parts stay separate and every other
junction welds.

Class criteria are graded **during blockout**, not at the end — a model that is 4x oversized
or ten times over budget is cheapest to fix before detail exists. Every bound is widened by
the class tolerance, and a spec derived from one exemplar says so in its `caveat`: it is that
model widened, not a distribution.

A person adds exemplars, never an agent:

```bash
tools/seat oracle exemplar car <model-id> --by <who>
tools/seat oracle exemplar car <model-id> --by <who> --reject "doors welded shut"
```

An unguarded corpus converges on average agent output — which is the disease these gates
exist to cure. Rejections with reasons are the most valuable rows in the store: each one is
a check that does not exist yet.
