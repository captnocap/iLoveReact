# PLATMOD_PLAN.md — the stateless Zig engine + RLE data + Zig loader (PLATMOD-PLAN-0607, corrected 0608)

**Status: PLAN, rewritten 2026-06-08 (req_0287) around the CORRECTED V28
architecture. Awaiting the supervisor's go for the Zig-loader work — the user
is driving that next.** Ruling set: V28 (platform/mod split — stateless Zig
engine, a game is DATA), V29 (the RLE data format), V30 (changelevel + frozen
world) in `docs/game/DECISIONS.md`. Plan only — no implementation here.

The user's word this plan executes, verbatim:

> "ts/tsx → encoded rle shape → loaded into zig loader → play."

and:

> "all of the capability already exists in zig, it just is 'stateless' by
> design … an entire game can be rle'd as long as the core capabilities exist
> in the engine itself … the loader takes in all the data, constructs the
> game from it."

end goal:

> "dropping off the javascript."

---

## 0. The correction this rewrite carries (read first)

The first draft of this plan (and V28) described a "game package" of
`bundle.js + mapfiles + assets` loaded by a "player binary" that "already IS"
the V8 dev host. **That was a worker interpretation the user never made.** The
user's architecture is the opposite of "ship the JS":

- The Zig engine is **stateless and already built** — camera, movement,
  physics, rendering, and behaviors (NPC AI, the 45-tick system) are engine
  capabilities that *take data and run it*. Camera/movement/physics are
  Zig-hosted today.
- **A game is DATA** — an asset vocabulary plus an RLE tape that composes
  those assets by reference. No per-game code, behavior included.
- **Ship = baked RLE + the Zig loader, no JS.** The JS/React side is the
  *authoring and dynamic-iteration* environment (the `/test` route), not the
  runtime.

PLATMOD **slice 1** (`92c703fa2`, `rjit-player` loading a `bundle.js` via V8)
is the **testing-environment loader the user explicitly called wrong**
(req_0254). It is not reverted — it stands as the dynamic-path lineage. Its
reusable parts (RLE codec, lump/asset container, content addressing) carry
forward; its V8-bundle-loading premise is retired.

---

## 1. The two paths (one engine, one data format)

```
            AUTHOR / ITERATE                         SHIP / PLAY
  ┌──────────────────────────────┐        ┌──────────────────────────────┐
  │  /test route (DYNAMIC)        │        │  baked RLE data               │
  │  TS/TSX authoring, live        │        │      +                        │
  │  "always rencoding, doing      │  ───▶  │  the stateless Zig loader     │
  │   tons of work" — JS-hosted     │ Compile│  (NO JS)                      │
  │  iteration, correct by design  │ 3 bakes│  "loader constructs the game" │
  └──────────────────────────────┘        └──────────────────────────────┘
            same Zig capabilities underneath both
```

- **The DYNAMIC path** is what exists and works: hmsc-int's `/test` route
  (`editors/play/PlayRoute.tsx`) drives the live Zig capabilities through the
  React/V8 side, re-encoding on the fly. This is the dev loop; it stays.
- **The SHIP path** is the goal this plan builds toward: the Compile button
  bakes the authored world into RLE, and a **stateless Zig loader** reads that
  RLE and constructs the running game with **no JavaScript present at all**.
- **Same engine underneath both.** The capabilities the /test route exercises
  live and the loader feeds from baked data are the SAME Zig code. That is the
  separation of concerns the user named: prove a capability live in /test,
  then finalize it into the built engine.

---

## 2. The data shape (V29, in V28's words)

A game is the user's pseudocode shape:

```
game: {
  buildings: [...],        // asset vocabulary — the "IDE definitions"
  textures:  [...],
  map:       [...],
  models:    [...],
  data: [[[1,1,[0a,20f], ...] ...] ...]   // the RLE tape — the "IPL"
}
```

- The vocabulary arrays are the **installable, content-addressed assets**
  (V29): authored shapes baked by EXECUTION, hashed, deduped.
- The `data` tape is **RLE references** composing those assets: each entry is
  a `piece → shape → position → face-materials` reference, not a copy. The
  tape **IS the state** the stateless capabilities consume — there is no
  separate "game state object" shipped as code.
- This is V29 verbatim (binary row-RLE, the `runtime/workspace/rle.ts` scheme;
  content addressing; reference-not-embed) and the Vice City architecture
  (roster = IDE, RLE tape = IPL placement list).

---

## 3. The Compile button — THREE bakes, each → RLE

The editor's Compile does three independent bakes (user-ruled), each emitting
an RLE stream:

1. **game logic → rle** — the parameters that drive engine behaviors (the
   45-tick cadence config, kind dispositions, mission/CaaS schema rows, zone
   rules). NOT script — DATA the stateless behavior capabilities read.
2. **game map → rle** — tiles, heights, zones, placements, entity data (V29's
   lumps; V30's VIS precompute belongs here).
3. **custom items / skins → rle** — player/author-made content (the GMod-dupe
   model): authored once, installed as a new asset, then referenced.

All three bake by EXECUTION (V29): the compile RUNS the TS/TSX authoring code
in V8 and snapshots the output as RLE — the literal-scanner direction stays
retired. The bake is the LAST time JS runs for a shipped game.

---

## 4. The stateless Zig loader — build order

This is the next major focus once current in-flight game work lands. Build
order, each step green before the next (V19/P6). Tier: [P] platform
(`framework/`+`runtime/`), [E] editor (hmsc-int).

1. **[P] Binary RLE codec, Zig side.** A packed reader for the
   `runtime/workspace/rle.ts` scheme — no parser, decode straight into typed
   buffers. (Slice 1's TS codec is the source-of-truth shape; this is its Zig
   twin.) P4: a fixture tape round-trips TS-write → Zig-read identical.
2. **[P] The lump/asset container reader, Zig side.** The V29 BSP-style
   versioned lump directory: magic, lump table (raw|rle8|rle16|text),
   alignment, unknown-lumps-skipped. (Slice 1's container work is reusable
   here — it is the genuinely-keepable part of `92c703fa2`.)
3. **[P] The content store + addressing.** Install/validate assets by payload
   hash into the engine's content store; the tape's reference list is the
   dependency manifest, validated before construction. Atomic writes
   (temp → fsync → rename), hash IS the corruption check (the perf+integrity
   ruling, req_0254 q3).
4. **[P] The CONSTRUCTOR — "the loader takes in all the data, constructs the
   game from it."** Read the three RLE streams, resolve references against the
   asset vocabulary, and hand the composed data to the existing stateless
   capabilities (camera, movement, physics, render, behaviors). This is the
   heart of the slice: it proves the engine runs a game from DATA ALONE.
5. **[P] Behaviors from data.** Wire the logic-stream RLE into the 45-tick
   system + NPC capabilities so behavior is parameterized by data, not script
   (V28's hard line; V30's frozen-world activation rides here).
6. **[E] Compile emits the three real RLE streams** (§3), replacing the /test
   path's on-the-fly encoding for the ship artifact. The /test dynamic path is
   untouched.
7. **[P+E] No-JS ship.** The shipped artifact is `Zig loader + baked RLE`,
   zero `bundle.js`. `rjit ship` bakes the data in (V15-as-amended). This is
   "dropping off the javascript" realized.

Steps 1–4 are the spine — the first proof that a stateless engine constructs a
game from RLE. 5–7 complete the no-JS ship.

---

## 5. The promotion mechanic (bless, unchanged from the ruling)

The test-route → built-engine loop V28 names, made mechanical (ruled
req_0254/req_0255 — established on the Smith bless PRINCIPLE, in the TS CLI):

- **Bleeding = the live /test route** (dynamic, JS-hosted iteration).
- **Blessed = the last Zig-engine build PROMOTED on the user's word.**
- **`rjit player bless`** — a `cli/commands/` TS command (rebundled into
  `tools/rjit.js`): builds the engine fresh (refuses on failure), runs the
  gate (`rjit game verify` green + the P6 lab-corpus re-run), copies the
  binary to the blessed path, writes a stamp (commit, date, binary sha256,
  source hash); `--status` / `--diff` verbs. **Human-only** — Claude never
  blesses (Smith's rule kept verbatim; matches the supervisor-ordered-commit
  law and P5 "ground floor grows only by verdict").
- A capability the data can't yet express EXTENDS THE ENGINE here — it is
  never a game-side script (V28).

---

## 6. Sequencing

- **Blocks on current in-flight game work landing.** The user is driving the
  loader next; this plan is the target, not an active lane yet.
- **Does NOT block on the workbench fold.** The loader work touches
  `framework/` (Zig codec/container/constructor), `runtime/workspace/`, and
  the editor's Compile bake — none are workbench route surfaces. The fold's
  step 10 (chrome collapse) is independent.
- **Reuses slice 1's keepable parts** — the TS RLE codec, the lump/asset
  container, content addressing. Their Zig twins are steps 1–3 above; the V8
  bundle-loading premise (`rjit-player` eval) is retired, not extended.

---

## 7. The FIRST testable artifact and its done-bar

**The artifact:** one small authored world Compiles to the three RLE streams,
and the **stateless Zig loader constructs and renders it with no JS present.**

**Done-bar (all four, none waived):**

1. **Construction from data.** The Zig loader reads the baked RLE, resolves
   references against the asset vocabulary, and the existing capabilities
   render/step the world — proven by `tools/rjit shot` of the loader-built
   scene, PNG path cited (SELFSHOT-0606, no desktop capture).
2. **No JS in the ship artifact.** Grep/inventory proof: the shipped artifact
   carries the Zig loader + RLE data and **no `bundle.js`**.
3. **Round-trip + codec suites.** Zig packed-reader round-trips the TS-written
   tape; lump container future-lump-skip tolerance; `rjit game verify` GREEN
   with the new fixtures in the corpus.
4. **Data-not-code holds.** The constructed game is driven entirely by the
   three RLE streams — no per-game script path exists in the loader; a new
   capability would extend the engine (§5), not the data.

Not in the bar: full V29 mining (Apriori), full V30 changelevel/VIS, the whole
hmsc world. The first artifact proves the *spine* — stateless engine
constructs a game from RLE data, no JS — which is the user's pipeline
("ts/tsx → encoded rle shape → loaded into zig loader → play") end to end at
small scale.

---

## 8. Settled rulings carried in (req_0254/req_0255, 2026-06-07)

1. **Channel discipline** — bless principle, TS CLI, human-only (§5).
2. **Naming/shape** — coherent is the only bar; RLE-stream + loader naming to
   taste.
3. **Content store** — content-addressed dir, atomic hash-verified installs
   (§4.3) — "most performant and doesnt corrupt."
4. **Dynamic vs ship** — the /test route stays the dynamic JS-hosted env; the
   loader path is the no-JS ship. Both ruled, both kept (§1).
