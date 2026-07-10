# Editor hot-reload state survival (twigs + host session resume)

Active surface: `cart/editor/`. Last verified: 2026-07-10.
USER ASK req_2898 ("we need to pass in some hotstate.zig on things like current
edits and camera and all of that noise, paint, anything basically in here that
is state").

## In one sentence

A dev hot reload tears down the JS world but never the Zig process — so the
editor now mirrors its working state into `framework/state/hotstate.zig` twigs
and, on remount, ADOPTS the host's still-live mesh session instead of wiping
it: current edits, undo journal, paint atlas, both cameras, and how you were
holding the tool all survive a code save.

## The mechanism (host fn vs JS, file:line)

Three layers, smallest first:

- **Host session readback** — `framework/gpu/3d.zig modelSessionJson` (door
  `__model_session_json`, `framework/v8_bindings_core.zig`): the resident edit
  mesh's key/count, orbit radius, journal depths, and whether a paint atlas
  exists. Null when nothing is loaded. This is pure readback — no new state.
- **The reload path must not eat the session** (req_2913 — the first live test
  caught this): `resetForReload` (gpu/3d.zig), which flushes the append-only
  GPU intern caches on every dev reload, was ALSO calling `clearActiveEditMesh`
  — wiping the session identity the resume checks, so the remount fell back to
  seed geometry (the "everything turned into its most primitive shape" report).
  It now PRESERVES the session and re-stashes the mesh from the session's own
  CPU copy (`g_edit_verts`) so the first post-reload draw re-interns it into
  the fresh cache. Any future reload-time cleanup must leave `g_edit_*`,
  `mesh_edit` selection, the journal, `model_paint`, and `g_orbit` alone.
- **DOC twig** (`editor:meshdoc:v1`) — `cart/editor/stage/ModelView.tsx`
  stamps `{docId, key}` on every mesh adopt (topology ops re-key the host
  mesh; an effect on `model.key` tracks each one). On mount,
  `resumeHostSession()` compares twig + session: both matching means the host
  still holds THIS document's live mesh from before the reload → adopt it
  (setModel from the readback, resync part ranges, mirror host selection,
  re-enter paint if you were painting and the atlas is live). Any mismatch —
  other doc, cold boot — falls through to the normal seed load. Because the
  resume path never calls a load door, `meshJournalClear` and `orbitFrame`
  never fire: the UNDO JOURNAL and the mesh CAMERA survive, which a
  meshdoc/autosave reload could never give.
- **TOOL twig** (`editor:meshtool:v1`) — ModelView's tool-holding state
  (wire, camera lock, gizmo, mirror mask, brush, brush tool, palette, safety,
  detail, light rig, paint mode), written on every change, seeded into the
  fresh `useState`s on mount. Paint MODE only re-arms when the session resume
  confirmed a live atlas.
- **ISO pose twig** (`editor:isopose:v1`) — `cart/editor/world/WorldViewport.tsx`
  mirrors the world viewport's `IsoStage.pose` into hotstate on every camera
  push and seeds the stage from it on mount — a code save no longer yanks the
  world view back to the origin.

## What survives what

- **Hot reload (rjit dev, code save)**: mesh edits + undo journal + selection +
  paint atlas + mesh camera + world camera + tool/brush state + the view
  chrome (`persistView.ts`, pre-existing).
- **Cold restart**: hotstate is in-process by design — twigs reset; the named
  world save (SESSIONSAVE req_2765), model packages/meshdoc autosaves, and
  globals saves remain the durable layer, unchanged.

## Headless proof — the reload torture harness (req_2914)

In-process shots CANNOT prove reload-safety (req_2913's lesson). The real
harness is a `-Ddev-mode=true` build of the editor whose bundle lives at a
scratch path; touching that file fires the genuine watcher reload.
`RJIT_MESHOPS=@/path/ops.txt` reads the op script from a FILE, re-read on
every eval — rewrite it between touches to script a different phase per
remount. The `session` op logs the host session beside the doc twig.

The full suite, all green on 2026-07-10 (session key/undo/selection identical
across every event, zero seed-resets):

1. edit + face-mode selection → **plain reload**: resumed `1 undo · atlas
   live · mode 3 · 2 selected` — even the selection survives.
2. **rapid double reload** (3s apart): two resumes, session unchanged.
3. **broken bundle** (syntax error → V8 compile fails → last_good recovery
   eval): the session survives BOTH teardown cycles; resume fires after
   recovery.
4. **undo across a reload**: undo pops the op (312→36 verts), the twig tracks
   the undo's re-key, and the reload resumes the UNDONE state (`0 undo`,
   redo=1).
5. **redo across a reload**: restores 312 verts, twig tracks again,
   `match=true`.

PAINT suite (req_2916), all green the same day — pixel-level, via the
`atlas:/path.png` dump op:

6. **baseline honesty**: the pre-stamp atlas dump hashes DIFFERENTLY from the
   stamped one — the strokes really changed pixels (guards against a suite
   that "passes" because nothing painted).
7. **painted pixels across a reload**: two real committed strokes
   (`paint:1;stamp;paintend` ×2), then reload — the atlas PNG is
   byte-identical before/after (`39afcdec…` both sides), the stroke journal
   holds `{undo:2}`, and the serialized stroke program is the same 204 b64
   chars. The GPU side re-uploads by construction: `g_paint_tex` is recreated
   from the CPU atlas whenever it's missing.
8. **paint-undo after a reload**: `paintundo` still drives the surviving
   stroke journal (`undo:1 · redo:1`) — replay works on the resumed session.

## Known limits (this slice)

- The resume is per-document and single-session (the host holds ONE edit mesh);
  switching model docs loads normally and the twig re-targets.
- `focusMode` deliberately resets (the host focus-tool flag is re-armed per
  mount); selection MODE mirrors back from the host, which survives.
- Loop-cut popup sessions and dialogs stay closed after reload (modal
  discipline — a blocking session must not resurrect half-alive).
