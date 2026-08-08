# Phase: setup

**Forward obligation —** Declare the model's real-world size in meters before the first primitive. Every later phase measures against it.

---

## Parallel agents: claims and background models

### Claims — lock the model, not the reads

Claim the model you are about to work on, then keep the token in the environment for the
whole engagement:

```bash
tools/seat claim <password> [agent]
export RJIT_SEAT_TOKEN=<password>
export RJIT_SEAT_AGENT=<agent>
```

`RJIT_SEAT_TOKEN` is stamped onto every later request; `RJIT_SEAT_AGENT` supplies the claim's
tab-badge name when the claim command omits its optional agent argument. `tools/seat dismiss`
releases the claim when you are done; `tools/seat claims` lists the in-memory claims. To claim
a parked target, set `RJIT_SEAT_MODEL=<model id>` before the claim; otherwise claim the active
model. Re-claiming with the same password is idempotent; another password is refused while the
claim stands.

Claims live in editor process memory. Restarting the editor wipes every claim. A claimed model
refuses mutations from everyone else — other agents and the user's UI — but claim admission
never gates reads or viewing. The read lane is `look`, `semantic-status`, `elements`,
`boundary-continuation`, `uv-state`, `recipe-list`, `shot`, and `claims`, plus structured
`operation:"read"` and `follow` `operation:"inspect"`; background routing can still refuse a
visible-UI bridge operation below, which is a session-routing refusal, not a claim lock. The
model's tab wears a lock badge with the agent name.

### Background models — park, route, restore

```bash
export RJIT_SEAT_MODEL=<model id>
```

`RJIT_SEAT_MODEL` targets an OPEN TAB that has been activated at least once. If the tab is not
open, the row refuses with `model <id> is not an open document tab — open it first`. If it is
open but has never become resident, every row refuses with `model <id> has no resident native
session — open its tab once so the editor loads it, then retry`. Do not confuse a package on
disk with a resident session.

Serveable background rows use the target's parked native session while the user works another
tab. The percept header identifies the target as `· model <id>`, and the generation guard is
per-model, including across batch rows. The shell selects the target session, runs the row,
then restores the user's active session. If restoration fails, the wedge failsafe says
`the editor's native session could not be restored — switch tabs to recover; the Agent Seat is refusing every request until then`;
switch tabs to recover before retrying.

Tab switches park the outgoing session: undo history, selection, and paint survive switching
away and back. Closing the tab parks its session; reopening the tab reclaims it. A background
save can persist the target, but `semantic-status` belongs to the visible ModelView, so run the
final status check with that model active.

### Background refusal families — name the trap before routing

The serveable lane is the remaining resident/native work — for example `select`, topology
verbs such as `extrude`, `save`, `part-select`, `part-rename`, `texture-slot`, `rig`,
`recipe-list`, and `retopo-bands` with `operation:"read"`. The following families are refused
for a background target:

- Visible viewport: `viewport`, `reference`, `paint-tool`, and `path`. The exact refusal is
  `<action> drives the visible model viewport; a background model is not the document on screen`:
  these actions need the model currently rendered in the viewport.
- UV/paint focus bridge: `uv-state`, `uv-select`, `uv-layout`, `uv-prestack`, `uv-stitch`,
  `uv-two-sheet`, `uv-geometry`, `uv-history`, `uv-atlas`, `uv-layer`, `paint-variant`, and
  `semantic-status`. The exact refusal is `the UV/paint focus bridge belongs to the visible
  ModelView; <action> cannot target a background model`: these operations are owned by the
  visible focus panel and painter.
- `shot`. The exact refusal is `a capture renders the frame the editor is composing; a
  background model has no framed scene`: visual verification of a background model therefore
  means asking for its tab or working it while active.
- Visible editor commands: `command`, `model-export`, `model-starter`, and `model-import`.
  The exact refusal is `editor commands run against the visible editor`.
- Part geometry: `add`, `detach`, `part-visibility`, `part-delete`, `part-duplicate`,
  `part-merge`, `part-path-array`, and `part-import`. The exact refusal is `part geometry ops
  mirror through the visible viewer's part-range table; they cannot target a background model
  yet`. The shell applies the same refusal to `group-visibility` and `group-duplicate`.
- `atlas`. The exact refusal is `the paint atlas transaction is owned by the visible painter`:
  rebuild the atlas with that model active.
- `follow`. The exact refusal is `Follow records the human's demonstrations in the visible
  editor`.
- `new`. The exact refusal is `new creates a document and has no target model`.
- `recipe`. The exact refusal is `recipes compose part-geometry verbs`.
- Mutating `retopo-bands` operations. The exact refusal is `retopology guides persist into the
  visible model package`; `operation:"read"` remains serveable.
- A nested `batch`. The shell refuses it with `nested batches cannot hold a background session
  across the row cadence`.

Claim admission and background routing are separate gates: a correct token does not make a
visible-UI operation serveable in the background, and an unclaimed background target still
needs a resident session.

---
