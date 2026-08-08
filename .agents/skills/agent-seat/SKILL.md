---
name: agent-seat
description: Drive the running ReactJIT studio model editor through its live Agent Seat API. Use when an agent must create, revise, retopologize, skin, save, or cold-verify a 3D model — the oracle routes the task to the phases it actually needs and gates each one on measured exit criteria.
---

# Agent Seat

Model with the editor's resident tools. Never emit vertex arrays, never replace the mesh
with generated code. This page is only what must be true in EVERY phase; the working
knowledge lives behind the oracle, which serves the slices your task needs and refuses to
let you leave a phase whose exit criteria are unmet.

## Before any work

```bash
tools/seat oracle start "<what you are here to do>"     # classifies, plans, serves phase 1
tools/seat oracle status                                # where am I, what still blocks me
tools/seat oracle advance                               # the gate — refuses with the failing checks
tools/seat oracle ask "<question>"                      # lookup mid-phase; never moves the plan
```

`oracle start` is three commands from working: claim, look, declare scale. Take it — the
plan you get is smaller than this document ever was, and every reply then carries
`percept.oracle` telling you your phase and how much debt stands between you and the next.

## The seat is the complete capability surface

**Never read model packages or compute geometry facts with bun, node, or python.** The seat
is the only correct parser of its own formats and the only source that reflects the resident
mesh — a hand-written blob reader silently returned RJMD v4 numbers after the format went
v5, and nobody was warned. `package`, `measure`, `stats`, and `align` answer every question
those escapes were answering; `--fields` reshapes a reply without `jq`; `--wait` and
`wait-ready` replace sleeping a guessed number of seconds. If a fact you need has no verb,
**report the gap plainly** — like the selector-algebra boundary — instead of hand-parsing a
blob or doing the arithmetic yourself. Every such gap is a filed feature request.

Common verbs have short CLI forms; the rest are `tools/seat action <name> '<json>'`. Do not
invent an unlisted action (`tools/seat oracle ask "verb table"` lists them all).

## Scale contract — READ THIS BEFORE PICKING ANY NUMBER

**1 unit = 1 meter.** Ruled (`tools/oracle "scale contract"` → R4): 1 tile = 1 meter, player
collider 1.65 m. The seat bootstraps a **1×1×1 cube** — a **1 meter** cube, already the size
of a washing machine. "Unit cube" is a trap: block out in meters from the first operation.

## Claim the model, dismiss at the end

```bash
tools/seat claim <password> [agent]     # before any structural work; export the credentials
tools/seat dismiss                      # after the final save + semantic-status
```

Claims lock writes, not reads. Lanes run in parallel against one editor; an unclaimed
structural edit on someone else's model is a crossed wire.

## Refusal semantics

A refusal is data, not an obstacle. `save` refuses unnamed faces; `paint` refuses an
undersized atlas and names the `fit` to rebuild at; `advance` refuses a phase and names
every unmet criterion. **Read the reason and satisfy it — never route around it.** A
host-measured check cannot be attested past; only checks with no measurement yet accept
`oracle attest <id> "<how you verified it>"`, and each one is an audit that does not exist
yet. Treat `pass:null` as blocking: unknown is not clean.

Report changes in semantic names and dimensions, never face indices. A cold agent must be
able to continue from `tools/seat look` alone.

Source of truth: `cart/editor/agent/seatApi.ts`, `seatOracle.ts`, `tools/seat`,
`cart/editor/shell/AppFrame.tsx`, `cart/editor/stage/ModelView.tsx`. Phase docs:
`.agents/skills/agent-seat/corpus/`.
