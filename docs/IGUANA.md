# Iguana — define the interface in JS, get Zig-static UI

**Thesis.** Zig static UI is unbeatable because every decision is made before
frame one — not because Zig is fast. The language was never the source of the
win; the *phase* was. Iguana is a phase split enforced as a framework:
**dynamic language, static runtime.** JS describes the UI once (setup), the
engine runs it forever (frames), and JS re-enters only as a guest worker for
logic the engine can't express.

Status: design sketch. Nothing here is built. This document is the shared
source for reasoning about it over time — argue with it, amend it, date the
amendments.

---

## The bet (regime, stated up front)

Real apps live at tiny **K/N** — a small vocabulary of component/style/shape
schemas (K) instanced many times (N). The classify miner measures K≈19 against
thousands of elements on real corpora; REROLL found the same shape in the
layout tape (18 formulas at 262k ops); RETAINED's shape cache only pays when
recurrence exists. Every engine win below is a bet on small K/N.

**d152 is the boundary marker, not a target.** Runtime-determined component
structure, per-instance state at unknown depth, chaos mutation — that cart
defines what Iguana *refuses*. The conformance test inverts: d152's job is to
be **rejected with a good error message**, not compiled. Carts that genuinely
need that regime run on the React/V8 lane, which does not go away.

---

## The Iguana machine (semantic core)

The framework is a syntax over this machine. tsz was a syntax over React's
machine, and React's semantics leaked through every crack ("mixed-lane hoists
them; React requires them in a FC"). The fix is owning the machine. Both lanes
— iguana.ts (JS, dev/dynamic) and a future Smith native lane — implement
*this*, and emit the same host command protocol, so the engine cannot tell
producers apart.

Five concepts. No more.

| Concept | What it is | Lifetime |
|---|---|---|
| **Schema** | A component type: fixed slot layout + template + action table. The comptime-known half. | Closed at freeze |
| **Instance** | One occupant of a schema's pool, keyed by reconciliation identity. The runtime half. | Stamp/destroy at runtime |
| **Slot** | A declared reactive cell (state or bound output). All change flows through slots. | Per-instance or global |
| **Action** | A defunctionalized handler: a tagged descriptor `(kind, target, args)`, not a closure. Executes engine-side. JS handlers exist but are the escape hatch, not the norm. | Declared at freeze |
| **Standing query** | `during(cond)` — a block active while a condition holds; activation/deactivation with cleanup-in-reverse. Replaces effects, lifecycle, subscriptions. | Declared at freeze, activates at runtime |

Notable absences: render functions, re-render, hooks, reconciliation/diffing,
effects-with-deps-arrays, context, hydration. None of these exist in the
machine, so none can leak.

---

## Phases

```
┌─ Phase 1: SETUP (JS, runs once) ──────────────────────────────┐
│ Component functions execute — they DECLARE, not render:       │
│ templates, classifiers, slots, bindings, actions, durings,    │
│ initial pool contents. Setup IS compilation, executed         │
│ instead of parsed.                                            │
└──────────────── freeze() ─────────────────────────────────────┘
┌─ Phase 2: RUNTIME (Zig; JS out of the frame path) ────────────┐
│ Frames: pool iteration, dirty slots, baked layout, paint.     │
│ Events: action descriptors execute natively. V8 wakes only    │
│ for JS-function handlers (per-event µs hop, never per-frame). │
└───────────────────────────────────────────────────────────────┘
┌─ Phase 3: SNAPSHOT (optional, the kicker) ────────────────────┐
│ Serialize setup's entire output (templates, baked tapes,      │
│ pools, slot table, action table). Next launch cold-boots as   │
│ pure Zig data; the V8 isolate is created lazily, on the first │
│ event that actually needs a JS handler. (Qwik's resumability, │
│ minus the hostile platform.)                                  │
└───────────────────────────────────────────────────────────────┘
```

**Freeze rules.** After `freeze()`:
- Registering a new template/schema/classifier → **error** (loud, with the
  offending stack). No silent fallback — quiet post-freeze dynamism is how you
  become React again, just slower.
- Stamping/destroying instances, writing slots, firing actions → fine, that's
  the runtime half.

---

## Authoring surface (iguana.ts sketch)

Setup-once components. They run one time, wire slots to template holes, and
return an instance. There is no second call; there is nothing to memoize.

```tsx
import { component, slot, computed, during, action, For, Show, freeze } from 'iguana';
import { C } from './app.cls';   // classifiers — the only styling path

const Counter = component('Counter', (props: { initial?: number }) => {
  const count = slot(props.initial ?? 0);
  const tone  = computed(() => count.get() > 10 ? 'accent' : 'normal');

  return (
    <C.Row>
      {/* action-as-data: executes engine-side, V8 never wakes */}
      <C.Btn press={action.add(count, -1)}><C.BtnLabel>-</C.BtnLabel></C.Btn>
      <C.Value tone={tone}>{count}</C.Value>
      <C.Btn press={action.add(count, +1)}><C.BtnLabel>+</C.BtnLabel></C.Btn>
      {/* JS escape hatch: per-event V8 hop, allowed, visible */}
      <C.Btn press={() => count.set(fibonacci(count.get()))}>
        <C.BtnLabel>fib</C.BtnLabel>
      </C.Btn>
    </C.Row>
  );
});

const App = component('App', () => {
  const items   = slot.list<Todo>('id', initialTodos);  // keyed, homogeneous
  const loading = slot(false);

  during(loading, () => {
    // active while loading is true; cleanups run in reverse on deactivation
  });

  return (
    <C.Page>
      <Show when={loading}><C.Spinner /></Show>
      <For each={items}>{(item) => <TodoRow item={item} />}</For>
    </C.Page>
  );
});

freeze();   // schema closes here; the engine now holds a static cart
```

Authoring rules (= the machine's invariants wearing an API):

1. **Component structure is static after setup.** The JSX a component returns
   is its template — one shape per schema. Structure changes happen *only* at
   `<For>`/`<Show>` sites (stamp/destroy against pools), never by a component
   "returning something different."
2. **Lists are keyed and homogeneous** — instances of one schema. A
   heterogeneous list is a tagged union of schemas, declared as such.
3. **All styling through classifiers.** No `style={}` in app JSX. The miner
   (`rjit classify`) is the on-ramp for existing code.
4. **Handlers prefer data over functions.** `action.*` descriptors cover the
   common verbs (set/add/toggle/select/navigate/stamp/destroy). A JS closure
   handler is legal, visible in the API, and pays one V8 hop per event.
5. **No reading the world during setup except props/initial data.** Setup must
   be replayable (snapshot depends on it).

What dies relative to React: re-render semantics, hooks rules, deps arrays,
`useEffect`, synthetic events, context-as-magic, SSR/hydration, memoization
(of everything — there is nothing to re-compute).

---

## Compile target: the existing command protocol, extended

iguana.ts emits the same stream `applyCommandBatch()` (host_tree.zig) already
drains. React carts keep working untouched; the renderer can't tell producers
apart. Proposed extensions, all setup/freeze-phase except the starred ones:

| Command | Phase | Meaning |
|---|---|---|
| `REGISTER_TEMPLATE id structure` | setup | Static skeleton; classifiers by id; holes enumerated |
| `REGISTER_SCHEMA id slots actions` | setup | Slot layout + action table for a component type |
| `FREEZE` | once | Bake: layout tapes per template, shape-cache keys, pool sizing |
| `STAMP schema key slot-values` * | runtime | Instantiate from pool (one command, not a CREATE-per-node batch) |
| `DESTROY key` * | runtime | Return instance to pool |
| `SET_SLOT instance slot value` * | runtime | The entire steady-state protocol |
| `SNAPSHOT` / boot-from-snapshot | phase 3 | Serialize/restore the frozen world |

Bootstrapping shortcut: `STAMP`/`SET_SLOT` can initially *lower to* the
existing `CREATE`/`UPDATE` ops inside the bridge, so iguana.ts runs against
today's engine unmodified while the native fast paths land incrementally.

---

## What the engine gets (each tied to measured prior work)

| Invariant upheld | Engine win unlocked | Evidence |
|---|---|---|
| Classifiers only | Shared style records: parse-once, K-resident cache during layout, identity diffs | measured 2–3× layout+paint vs inline styles |
| Templates known at freeze | Pre-baked layout tape per shape class; stamp = translate, don't re-solve | RETAINED: 12.4× over idealized replay, 1010× over re-trace |
| Stable instances in pools | Node identity survives frames → the dormant dirty cycle wakes | LAYOUT_PERF_HANDOFF: 72µs → 1.18µs (23×) |
| Slot writes are the only steady-state change | Slot delta = layout *input* change by construction; never a re-trace | AFFINE: grid regime is `A·x + b`; scroll = one input float |
| Homogeneous keyed lists | Fat uniform batches; Fenwick per flow container | INCREMENTAL: O(log n) both axes; REROLL: 18 formulas, 57k-wide batches |
| Schemas closed at freeze | Affine-regime check per classifier **at freeze time** — "this screen is a matvec" becomes a compile-time fact | AFFINE probe, run once instead of guessed |

---

## Lanes & trajectory

```
authoring        semantics            execution
─────────        ─────────            ─────────
React/JSX   ──►  React machine   ──►  V8 lane            (exists; the escape regime)
iguana.ts   ──►  Iguana machine  ──►  V8 setup + Zig run (this doc)
tsz         ──►  Iguana machine  ──►  Smith native lane  (later; same machine)
```

- **iguana.ts is the reference implementation of the machine.** It makes the
  semantics real and shippable without a compiler. tsz becomes "the syntax of
  the machine" later; Smith becomes "the native backend of the machine" later.
  Neither is a prerequisite for shipping this.
- **Adoption is per-cart and reversible.** A cart is either a React cart or an
  iguana cart; both emit the same protocol; A/B latency and memory for real.
- **d152 stays on the React lane forever**, as designed.

---

## Honest scope

- **The dynamic boundary is real.** Truly data-dependent structure can't
  freeze. Iguana's answer is rejection + the React lane, not support. If real
  apps turn out to need post-freeze schemas routinely, the bet was wrong —
  that's falsifiable, good.
- **JS handlers still pay V8** — one hop per *event* (µs), never per frame. GC
  can stall a handler, never a frame. Acceptable; stated.
- **Action vocabulary will grow pressure to become a language.** Resist:
  actions are verbs over slots/pools, not a scripting layer. When a handler
  needs logic, it's a JS function — that's what the hatch is for.
- **Snapshot versioning is unsolved.** Setup output must be invalidated on
  bundle change (hash the bundle), classifier change, engine version. Stale
  snapshots must fail loudly to a fresh setup run.
- **`during` semantics need one precise page**: activation order, nesting
  (inner requires all ancestors), unmount-wins, cleanup-in-reverse. tsz's
  Intent Dictionary already specifies this; port it verbatim.
- **Text is the usual asterisk.** Text measurement makes some shapes
  parent-dependent; same gate as RETAINED (`flex_shrink: 0` discipline).
- **Build-time template extraction is deferred.** Setup-time registration is
  enough to start; a JSX compile pass that hoists templates to data is a pure
  optimization later, not a dependency.

## Open questions (running list — add, don't delete; date answers)

1. Slot granularity for nested data — `slot.list` of records vs per-field
   slots? (Relational answer: rows + column slots. Decide with a real cart.)
2. What's the minimal action vocabulary that covers ~90% of handlers in the
   existing story/cart corpus? (Measurable: mine the corpus's onPress bodies.)
3. Reconciliation keys for `<For>` — author-provided only, or content-hash
   fallback?
4. Does `during` belong on instances (component-scoped, unmount-wins) AND
   globally, with the same primitive? (tsz says yes; verify it survives JS.)
5. Snapshot of *mid-session* state vs setup-only — is "resume where you were"
   in scope, or only cold-boot acceleration?
6. Error surface: what does the d152-rejection error actually say? Write the
   message before writing the checker.
7. Where does the affine-regime report surface — freeze-time log, dev overlay,
   CI gate?

---

## Naming (registry, for when it matters)

Zig's official mascots are iguanas (Zero & Ziggy the Ziguana) — the name
encodes the lane story: an **iguana** (JS, warm-blooded dev lane) matures into
a **ziguana** (Smith-compiled native). Reserved vocabulary:

- `molt` — the migrate codemod (sheds inline styles in patches, like the animal)
- `bask` — freeze + bake (can't move fast until it's been on the hot rock)
- tail autotomy — the V8 escape hatch; the regrown tail is cartilage, not bone
- parietal eye — the static analyzer / miner (the third eye that watches
  structure without rendering)
