# Guiding Light

*A north star for the data-shape engine. The obvious path will pull you off this
at every turn. Hold the line all the way through and it turns out nicely.*

---

## The One Idea

**A game (or app) is DATA, not code.**

The engine is a *small fixed set of loaders and systems* sitting behind a *narrow
data-format waist*. Everything you author becomes data; the host runs the data.
You never ship game-specific code into the runtime loop — you ship a data shape,
and a fixed host that knows how to read and run it.

> A shipped game is DATA: an asset vocabulary (content-addressed blobs) plus
> streams composing those assets **by reference**.

---

## The One Law

**Compressibility = Composability = Separability = LOW RANK.**

Everything good in this system is the same move:

- **Store each distinct thing once** (content-address it by its identity/hash),
  and **reference it everywhere**. `#ABABAB` exists one time; everything else is
  a pointer to it.
- **Factor tables into a sum of dimensions, not a product.** A damage table isn't
  `weapons × hitboxes × health` cells — it's `weapons + hitboxes + health` factors
  multiplied at lookup. The full table is the *outer product*; keep the factors,
  throw away the product.

The corollary, and the thing to internalize:

> **The primitives are always cheap. The interactions are the cost.**
> Factors are cheap (a sum). Couplings, seams, connectors, special-cases — those
> are the *rank*, and rank is the only thing you ever truly pay for.

So the engineering question for *anything* — an asset, a table, a behavior, a
world — is always one question: **how low-rank is it?** Push it toward separable.
What won't separate is your honest, irreducible cost. Pay that and nothing more.

---

## The Shape

```
   any producer        →     ONE data format      →      any host
  (TS, Python, JSON,         (the narrow waist:          (native Zig, WASM,
   visual editor, LLM,        content-addressed           SDL, three.js …)
   reverse-engineering)       blobs + reference
                              streams, packed binary)
```

- **Two runtime primitives, both dumb on purpose:** *branch* (logic / if-else /
  verbs / rules) and *arithmetic* (continuous sim / `x += v·dt`). That's the whole
  engine. Everything else is data flowing through them.
- **The engine is the deepest module:** tiny fixed interface, vast navigable
  capability. Its worth is measured in *expressiveness per unit of engine code*.
- **Cost is a fixed P×K matrix** (platforms × systems); **output is unbounded**
  (games × all platforms). A handful of composable systems spans an exponential
  behavior space the data navigates. Build the engine once; ship infinite content.

---

## The Discipline (the gate — this is what holds it all up)

These are non-negotiable. Every one of them is what makes the whole thing work,
and every one of them is what the obvious path will tempt you to break.

1. **Keep the data DECLARATIVE. Never Turing-complete.** Data says *what*; systems
   decide *how*. The moment your data format grows conditionals, variables, loops,
   and functions, you have built a slow programming language inside JSON and thrown
   away everything. Customizability is bounded by the dimensions the systems
   *expose* — not by general computation.

2. **The CPU produces artifacts. It never runs frames.** No game code in the frame
   loop. No V8, no GC, no interpreter in the hot path. The authoring language runs
   *once* to emit the artifact and is then gone. Its performance is irrelevant
   because it is a compiler, not a runtime.

3. **Author structured → compile down to flat primitive data.** The niceness lives
   in the producer (typed TS, helpers, abstractions). The flatness lives in the
   artifact. The dumbness lives in the engine. Don't make the engine smart to make
   authoring nice — make the *compiler* do it.

4. **Content-address everything.** Each value, mesh, sound, motion, tile — stored
   once, keyed by hash, referenced. The hash *is* the cache key (this is what makes
   iteration instant and dedup free).

5. **Refuse what won't factor and what forces per-frame work.** This is the gate at
   every layer: tailwhip refuses layout-dirtying animation; the effect layer refuses
   un-analyzable closures; the rule layer refuses Turing-completeness; the engine
   refuses per-game code. Saying *no* here is what earns the wins.

---

## When the Obvious Shape Tempts You

You will hit these forks constantly. The left column is the easy, conventional,
"everyone does it this way" move. **Take the right column every time.**

| The obvious shape says… | Hold the line: | Because |
|---|---|---|
| Embed a scripting VM (Lua/V8) so logic is easy | Reify behavior as data (verbs + rules); add a *system* for genuinely new behavior | A VM puts code + GC back in the loop — the one thing you deleted |
| Just handle this one case in engine code | Push it into data — a slot, an archetype, a rule | Game-specific code in the engine ends the factor-of-one property |
| Store the rendered result / the full table / the dense form | Store the recipe / the factors / the references | The product is huge; the factors are a sum. Bake only when the state space is genuinely small |
| Grow the rule format with conditions, variables, loops | Keep it declarative; drop to a real system at the boundary | That growth *is* building a language — the inner-platform trap |
| Use JSON (or base64) at runtime | Pack binary, zero-copy; data *is* the load format | Text means a parse/inflate pass + GC; the win is loading bytes and using them in place |
| Couple the systems together — it's convenient | Keep them separable; bridge with events | Coupling is the rank that costs; separable systems factor to a sum |
| Bake everything to results for the demo | Pick bake-vs-formula per asset by which is smaller (MDL) | Continuous/high-dimensional things explode when baked; keep them as formulas |
| Recompile/cook on every change like a real engine | Serialize, don't compile; content-address assets | The instant edit→see loop is the whole point — protect it |

The pattern under all of them: **the obvious shape trades a structural win for a
local convenience.** It is always faster *today* and worse *all the way through*.

---

## The Honest Cost (so you're never blindsided)

The residual never vanishes — it relocates and it has one shape: **the high-rank
tail.** The seams between primitives, the coupling between systems, the *feel* of a
thing, the special-cases, the irreducible captured signal (a specific photo, a
specific voice, a beloved glitch). The low-rank skeleton comes out nearly free;
the high-rank soul is the expensive part.

Do not be discouraged by the tail, and do not let it tempt you to abandon the 90%
that factors. **Procedural/synthesizable content → formula (tiny). Irreducible
captured/authored content → bake lever (PCM/DXT/recorded performance), used
sparingly for the parts where the soul is the point.** Same choice on every axis —
image, audio, logic, geometry, motion. Pay the tail; refuse to pay for the
skeleton.

---

## Worked Example: painted textures (store the strokes, not the pixels)

A hand-painted texture *looks* like irreducible captured content — the obvious move
is to store the rasterized RGBA (a PNG, or RLE). Hold the line: **store the paint
PROGRAM, not its rasterization.** A layer is a list of strokes; each stroke is a
*reference* to its colour/shader ink plus the brush recipe — shape, size, flow, and
the **dither variables** (density, pattern, seed) — plus the stroke path. The
framework replays that program **once at load** into the resident texture, and the
strokes are gone.

Why this wins where PNG/RLE lose: **dithering is high-frequency by design** — its
whole job is to scatter pixels — so a rasterized dither is the *worst* case for RLE
(no runs to collapse) and bloats a PNG. But that scatter is *generated by a few
numbers*. Store the numbers (the formula, tiny); never the scatter (the product,
huge). This is the One Law on the image axis: the dither is **low-rank at the
parameter level** and only *looks* high-rank once rasterized. Content-address the
ink and the brush; the stroke list is a thin reference stream over them.

It is the **bake lever pointed at LOAD, not at disk** (Discipline 2): the CPU
produces the artifact once, at load, and never touches it per frame. On disk you
keep the recipe; in memory you hold the baked result. The producer paints richly;
the artifact is the flat atlas; the framework stays dumb.

**Animation falls out of the same shape.** An animated paint/shader is not a
flipbook of baked frames — it is the same stroke program plus a payload of frame
timings. The framework evaluates it **once on load** and bakes the resident frames.
A recipe, never a stored film — the same choice as everywhere else.

---

## Why It's Worth Holding the Line

- **Instant iteration** — there is no compile, only serialization; the edit→see
  loop is ~zero, and that compounds every hour.
- **Tiny footprint** — factored, content-addressed data is a fraction of the
  baked form.
- **Portability** — one artifact, any host. The data is the ROM.
- **Determinism for free** — world = data + fixed systems ⇒ the sim is a pure
  function of (state, inputs) ⇒ replay, rollback, lockstep netcode fall out.
- **No-GC native runtime** — columnar data + fixed systems, zero per-frame
  allocation, flat frame times.
- **Combinatorial content from a fixed engine** — author in any language, even
  none (a hand-written file is a valid game).

---

## The Order of Work

1. **Format + content-addressing + native host render.** ✅ (done — RJMP/`.rjpkg`,
   sha256 vocab, the native loader rendering the world.)
2. **Logic-stream execution.** Turn `stream_logic` (verbs/rules as data) into the
   running systems — the discrete tier executing natively. The render→run step.
3. **The continuous + discrete tiers wired by events.** Physics/anim per-frame;
   verbs fire on events the systems emit.
4. **Optional optimization passes at bake** — the mining/factoring/LUT-precompute/
   low-rank extraction. These trade bake-time for runtime/size. Turn them on *only*
   when you want that trade; they are the one thing that costs the instant loop.

At every step, the gate. Never smuggle code into the loop. Never let the data
become a language. Never store the product when you can store the factors.

---

## The Creed

> **The game is data. The engine is dumb and fixed. The complexity lives in the
> compiler, never the runtime. Store each thing once and reference it. Factor the
> product into a sum. Refuse code in the loop and refuse a language in the data.
> The primitives are free; pay only the rank. Hold this all the way through.**
