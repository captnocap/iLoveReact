# Editor Foundation — Shared Contracts (Phase 0)

Purpose: the seams every foundation workstream builds against. Read this before
touching any foundation system. If a change would alter a seam here, raise it with
the supervising thread first — parallel workers depend on these being stable.

Companion docs: `cart/hmsc-workspace-mock/DESIGN_INTAKE.md` (the felt requirements),
`docs/game/COMPILE_CACHE_ARCHITECTURE.md` (V31 chunk cache), constitution
`docs/game/DECISIONS.md` (V28 stateless engine / V29 map format / V31 cache).
Plan of record: `~/.claude/plans/hey-i-want-you-giggly-minsky.md`.

## Governing rules (non-negotiable)

- **Fresh build. One cart, two routes — `/editor` and `/play`. One system.**
- **No cross-dir import webs.** Never import between carts. Clone a useful donor
  file into its proper new home and repurpose it. Zig → `framework/`; shared TS →
  `runtime/`; the editor cart consumes them via `@reactjit/runtime`.
- **React writes UI, never systems.** Every interactable system (selection,
  editing, brushes, gizmos, input loop, model authoring) is a Zig host function
  with a native input loop, zero JS per event. `cart/modelview.tsx` is the
  reference.
- **Everything authoring enters through CommandAuthority** (below). The owning
  domain validates and applies once; only the authority's outcome sink appends
  the immutable eventbus report. The bus is not an alternate mutation door.
- **Styling = classifier `.cls.ts` only**, `theme:NAME` tokens, no inline styles
  without a damn good reason. Baseline: `cart/hmsc-workspace-mock/workspace.cls.ts`
  + `theme.ts` + `runtime/classifier.tsx`. JSX reads like a document.
- **V20 is dead.** Do not read or build on it. History = eventbus log + autosave
  snapshots + backup; compiled-chunk history (V31) is the restore surface.
- **Model documents save at boundaries, never per edit** (req_4344). File → Save,
  doc switch, doc close, and editor exit are the only model commit points; each
  committed save archives one Lore recovery revision, and a refused Save opens
  the Lore recovery pane so the last good revision can be restored. Do not
  reintroduce a mid-session model autosave debounce — the corruption net is the
  save guard + Lore restore, not write frequency.

## Two distinct buses — do not conflate

- **Authoring outcome log** = `runtime/editorbus/` (TS door) +
  `framework/events/` (Zig ordering/persistence spine). Ordered, append-only,
  multiplayer-shaped. Correlated CommandAuthority outcomes are replay-grade;
  uncorrelated legacy receipts are observational while their slices migrate.
- **Diagnostics bus** = `runtime/eventBus.ts` + `framework/diag/event_bus.zig`
  (logging/observability, sampled, fire-and-forget). The in-app console may
  subscribe to authoring events, but diagnostics channels are their own registry.

## Seam 1 — the authoring-event envelope (`runtime/editorbus/event.ts`)

The one shape every system emits/consumes:

```ts
interface EditorEvent<P> {
  seq: number;        // authoritative monotonic order; SEQ_PENDING (-1) until confirmed
  origin: string;     // producing peer id ('local' until a session/server assigns one)
  ts: number;         // wall-clock ms metadata; seq is the authority
  type: string;       // a registered event type, e.g. 'piece.place'
  targets: TargetRef[]; // { kind, id }[] — drives dirty-tracking + the hot index
  payload: P;
  // Present on migrated command outcomes:
  invocationId?: string;
  commandId?: string;
  actionId?: string;
  source?: string;
  phase?: 'applied' | 'rejected' | 'undone' | 'redone';
  causedBy?: string;
  effect?: 'action' | 'project-action' | 'report-only' | 'control';
  undoScope?: { kind: 'none' | 'document' | 'project' | 'workspace' | 'native'; key?: string };
}
```

Register your event types ONCE at module load — this is the anti-collision seam,
so parallel workers add events without editing a shared switch:

```ts
const placePiece = defineEventType<{ piece: string }>({
  type: 'piece.place', undoable: true,
  describe: (p) => `place ${p.piece}`,
});
// later: dispatch(placePiece({ piece: 'Wall Kit' }, [{kind:'piece',id}, {kind:'chunk',id:'3,2'}]))
```

`TargetRef.kind` is an open vocabulary owned by its authoring system
(`piece | tile | prop | material | marker | chunk | …`). A `chunk` ref lets an
event declare its dirty region directly; object refs are resolved to chunks by the
hot index (E). **Carrying refs is what keeps one edit O(1) on an empty vs rich map.**

## Seam 2 — application command authority (`runtime/commands/`)

`CommandRegistry` stores declarations and returns frozen, handler-free
projections. Menus, keybindings, Section D, context menus, palettes, native
input, automation, and remote peers may inspect those projections, but cannot
execute their private handlers.

`CommandAuthority.invoke({ invocationId, commandId, args, source, ... })` is the
one execution entrance. It validates arguments, enablement, capabilities, and
mode predicates; runs exactly one private handler; then publishes exactly one
`applied` or `rejected` outcome through its authority-owned sink. `source` is
withheld from the handler, so it cannot select another implementation.

Action outcomes carry a stable `actionId`. Undo/redo are control commands whose
`undone`/`redone` reports retain that action id. Domain handlers must prepare all
fallible work before one atomic commit; the authority cannot roll back arbitrary
side effects captured by a TypeScript closure.

First active-cart proofs (`req_2985`):

- `world.floor.step`: Map menu, `]`, Section D arrows, and headless invocation
  share one handler.
- `world.pieces.place`: viewport submits semantic candidates; authority assigns
  ids, computes exact replacement forward/inverse patches, commits once, and
  emits a correlated `piece.place` outcome. World undo/redo report against the
  same action id.

## Seam 3 — host-door convention (`runtime/ffi.ts`)

- Naming: `__editor_*` for new editor doors (e.g. `__editor_bus_emit`); existing
  `__mesh_edit_*` / `__model_*` (modelview) are the interactable-system reference.
- Register in Zig via the host's `registerHostFn`; call from TS via
  `callHost` / `callHostJson` / `hasHost`. Each workstream declares its door
  signatures by augmenting `interface HostCalls` (see `runtime/editorbus/bus.ts`
  and `runtime/diag/channel.ts` for the pattern).
- JSON across the bridge: one string in/out, paired with std.json on the Zig side.
- **Graceful degrade:** TS doors fall back to a local impl when the Zig door isn't
  wired yet, so TS workstreams build/test before the Zig lands (see the editorbus
  local fallback).

### Authoring-bus doors (workstream A implements in Zig)
- `__editor_bus_emit(json) -> number` — append, return authoritative seq (re-broadcasts the confirmed envelope on the `editor.bus` ffi channel via `__ffiEmit`).
- `__editor_bus_since(afterSeq) -> json` — confirmed events with seq > afterSeq.
- `__editor_bus_head() -> number` — highest committed seq.

### Diagnostics doors (workstream B implements in Zig)
- `__diag_emit(channelId, severity, msg, fieldsJson)` — cheap no-op when disabled; captures host events too.
- `__diag_set_enabled(channelId, on)` — mirror enabled state to host emitters.

## Seam 4 — diagnostics channel contract (`runtime/diag/channel.ts`)

Register a channel ONCE; the settings UI renders toggles from the registry and the
console reads the feed. `costTier` (`cheap | sampled | heavy`) makes hot channels
obvious; disabled = cheap branch; high-frequency = aggregate/throttle/sample.

```ts
const placeCh = defineChannel({
  id: 'editor.place', label: 'Placement', description: 'place/move/delete timing',
  costTier: 'sampled', defaultOn: false, sinks: ['console', 'bus'],
});
if (placeCh.on) placeCh.log('info', 'placed', { ms, chunk });
```

## Seam 5 — directory homes

| System | Home |
| --- | --- |
| Authoring outcome log (A) | `framework/events/` (Zig) + `runtime/editorbus/` (TS door) |
| Diagnostics + console (B) | `framework/diag/` (Zig) + `runtime/diag/` (TS) + cart console overlay |
| Command registry + authority (C) | `runtime/commands/` (TS); cart composition in `cart/editor/data/applicationCommands.ts` |
| Content-hash + chunk cache (D) | `framework/world/` (Zig, beside `gamefile_writer.zig`) |
| Hot authoring-state index (E) | `framework/` (Zig, host-owned) |
| Build-journal + bug-thread (F) | `runtime/` (TS) over `tools/request` + `docs/game/_requests/` |
| Defaults/tunables registry (G) | `runtime/` (TS) + host door |
| Model-authoring host pattern (H) | `framework/` (Zig, generalize `gpu/mesh_edit.zig` + `engine.zig`) |
| Editor cart shell | the new cart (React, classifier-only) |

## Depth decisions (this pass)

- **D (chunk cache) = scaffolding + dirty-tracking only**, built into the Zig
  `gamefile_writer` effort, whole-map bake as fallback. Full per-chunk split +
  reuse-by-hash + V31's 8 acceptance tests is the fast-follow.
- **H (model authoring) = host-door / input-loop pattern only.** The studio
  capability port is the first vertical built on it, not this pass.

## Verification spine

- Zig systems: a `framework/testing/unit/` test (ordering, round-trip, dirty
  compute, content-hash parity).
- TS registries: a self-contained `*.test.ts` micro-harness (see
  `runtime/editorbus/editorbus.test.ts`), built + run:
  ```
  tools/esbuild runtime/<area>/<x>.test.ts --bundle --outfile=/tmp/x.test.js \
    --format=iife --platform=neutral --target=es2022 --alias:@reactjit=runtime
  tools/v8cli /tmp/x.test.js
  ```
- UI: `tools/rjit dev <cart>` + headless `tools/rjit shot <cart>`. **Never desktop
  capture** (SELFSHOT rule).
- The supervising thread integrates each workstream against these seams before it
  is accepted; nothing merges that bypasses CommandAuthority, uses inline styles, or
  implements an interactable system in React.
