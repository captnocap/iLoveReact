# Mesh Stable Handle — slice 3 design (req_3469–3486)

Status: DESIGN — approved direction ("yeah go forward with it", req_3486);
implementation is the next work unit. Slices 1–2 (the integrity roll call,
`docs/game/editor_mesh_integrity.md`) are shipped and independent of this.

## The contract, in one sentence

`hostKey` becomes a **stable per-document handle** — "here is something you
point at; all you need to know is where to look" (the user's words) — and the
generation churn that today renames the mesh on every topology op moves
entirely inside the host, where it always belonged.

## Why

The current key `modelview-edit-{hash}-{revision}` fuses two meanings:
*which document* (which React genuinely needs to declare the scene) and
*which generation of it* (a host-internal cache-invalidation signal that
leaked across the bridge). Every topology door returns a NEW key that its one
caller must relay to React state, the doc twig, and every other consumer —
manual adoption at dozens of call sites, and the documented stale-key failure
class ("model renders default-grey") exists ONLY because of it. The framework
already has both idioms proven: content-addressing for immutable baked assets
(V29/V31 — correct there), and stable-location-with-mutable-content for the
paint atlas texture and the VM-render surfaces (correct here). The edit mesh
is the system's one mutable document and inherited the wrong idiom. Precedent
for the fix: V23 gave the camera exactly this treatment (JS = transport and
parameters; the host owns the state).

## Mechanics

1. **Handle**: minted once per document at load/new — `modeldoc:{token}`
   (token = the same FNV document token `modelDocumentToken` already stamps
   on action events). Stored where `g_edit_key` lives today; never re-minted
   by an op. A fresh load of a DIFFERENT document mints a new handle.
2. **Generation**: `g_edit_generation: u32` bumps exactly where the two
   replace funnels mint keys today (`replaceActiveEditMesh` /
   `...PreservingAtlas` — the single site, so a missed bump is impossible by
   construction). Position-only edits keep not bumping (they patch in place).
3. **Internal caches key on (handle_hash, generation)**:
   - GPU intern (`g_geo_cache`): a lookup that finds the handle with an OLDER
     generation **rebinds the slot** — frees/reuses its region instead of
     appending a new one. This is the eviction path the retained buffer never
     had; long sessions stop orphaning a slot per topology op.
   - `model_paint` target: keys on handle_hash; its own layout revision
     mechanism is unchanged.
   - Host stash: keyed by handle; generation rides the entry.
4. **Doors return `{ok, lo, hi, count}` — never a key.** The action-event
   ring (which slice 1 extended) is the only change-news channel; the events
   already carry the document token and before/after counts.
5. **JS**: `model.key` → `model.handle`, set once at load. `adoptMesh` keeps
   its selection/range/paint-gate resync but drops key adoption. The doc twig
   stores the handle — the hot-reload resume comparison (`twig.key ===
   session.key`) becomes trivially stable, and the "doc twig must track every
   mesh re-key" hazard dies. The RJIT_MESHOPS harness gotcha ("calling a door
   bare leaves React drawing the stale key") dies with it.
6. **Draw path**: `Scene3D.Mesh hostKey` resolves the handle; the host maps
   handle → current generation internally at draw time (one global — the
   ACTIVE edit doc — so the lookup is a comparison, not a table).

## Migration order (each step ships green)

a. Host mints the handle at load; the current per-op keys keep working but
   also register as aliases of the handle (dual-accept).
b. Intern/stash/paint rewire to (handle, generation) with slot rebind.
c. Doors stop returning keys (JS still tolerates their absence).
d. JS declares the handle, drops adoption; doc twig stores the handle.
e. Delete the alias layer and the key-minting.

## Risks and their answers

- **Missed generation bump → stale GPU geometry.** Bump lives only inside
  the two funnels every topology op already funnels through; the slice-1
  roll call (which audits after every commit) is the tripwire if a new path
  ever bypasses them.
- **Quality re-mesh** (`setQualityPaintTarget`) re-targets the paint system:
  treat as a generation bump on the same handle, same as topology.
- **Hot reload**: `resetForReload` re-stashes by handle; resume compares
  handles — strictly simpler than today.
- **Two documents open** (model tabs): handle per document already implied by
  minting at load; the active-doc generation global becomes a small map only
  if/when two edit docs are ever resident simultaneously (today: one).

## Estimate

Two to three focused agent-sessions: (a) host-side handle+generation+rebind
with the alias layer, (b) JS declaration + door slimming + twig, (c) alias
removal + harness/doc updates. Each step independently shippable and
verifiable with the existing headless gesture chains.
