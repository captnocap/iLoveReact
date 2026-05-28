# Build-time geometry bake

A geometry that can be proven static is generated **once at build time**, not in
V8 at runtime. The generators (`./*.ts`) are pure `params → GeometryData`, so they
run anywhere — `rjit bake-geometry` runs them under v8cli at build, emits the verts
into `_baked.generated.ts`, and `intern.ts` pre-seeds its cache from that. A baked
mesh's `internGeometry()` is then a **transparent cache hit** — `generate()` never
runs in V8 for it. Anything not baked falls back to runtime generation unchanged;
nothing is lost (it's additive).

## Why this is safe to lean on (the runtime evaluator's domain is narrow)

Dynamism in a real scene is **sparse and edge-originated**. World-space geometry
almost never depends on window size — that's a UI concern, not a mesh concern. And
the cases people reach for as "dynamic geometry" mostly aren't:

- **animation** = static mesh + per-frame *transforms* (not new verts)
- **skinning / cloth** = static topology + per-frame vertex positions *on the GPU*
- **fracture / breaking** = state-machine swap to a pre-authored fractured variant
- **LOD** = a swap between pre-baked levels
- **procedural variation** = N baked variants + per-instance attributes

Per-frame vertex *position* updates are normal and handled by shaders. Per-frame
*topology* change is rare and is almost always pre-baked variants or coarse-grained
regen (voxel chunks on edit), not per-frame eval. So the bake catches the 95%; the
runtime generator's real job is the narrow remainder.

## The producers (both emit into one backend)

The seed/intern backend is built and proven. Two producers feed it:

### 1. Const-taint propagation — the auto producer (THE NEXT BUILD)

**Not** literal-detection at the use site (`{ width: 60 }` good, `{ radius: p.h/2 }`
bad) — that's the wrong primitive. Instead, **color the prop graph**:

1. Declare the **dynamic roots** — the small known set of edges where non-determinism
   enters: window/viewport size, pointer/keyboard input, network, time/clock, RNG,
   and any FFI/host-fn call. Some are framework-known (the hooks/host globals that
   return live values); the rest an author annotates **once** (the same annotation
   they already need for resize handling).
2. **Propagate taint downward** through the data-flow graph. A value is tainted iff
   it derives from a tainted root. Pure operations over const inputs stay clean.
3. **Bake every mesh whose `geometry` def + `params` come out un-tainted**, regardless
   of syntactic form.

`p.h / 2` inside a `.map()` over the citymap is fully bakeable: citymap is a const
config, `p.h` is a field of a const record, `/ 2` is pure — no tainted source touched.
The whole `.map()` folds at build time into N specialized literal-param meshes. The
skybox `p.h / 2` where `h` derives from window height is tainted → that one mesh
stays runtime. **Same syntax, different color, correct both ways.**

Substrate: the cli already has the TS compiler available (`deps/typescript`, used by
`classify`). The pass is graph-coloring over the prop graph rooted at declared
sources + const-folding of the clean subgraph — an abstract interpretation, **not**
an AST partial-evaluator chasing literal forms. **Mis-coloring bakes something
dynamic = silent visual corruption**, so this pass ships only with a verification
corpus (baked-vs-runtime output must match for known-static inputs).

### 2. Explicit manifest — the escape hatch (BUILT)

For genuine procedural cases (voxel terrain, real fracture) and FFI boundaries where
the analysis can't prove constness, the author names what to bake. Today this is the
proven backend's entry point:

```
rjit bake-geometry --manifest <path>   # [{ "geometry": "<defId>", "params": {…} }]
rjit bake-geometry --manifest <path> --check   # drift gate (nonzero on mismatch)
rjit bake-geometry --clear             # write the empty seed
```

## The shared backend (built + verified)

- `cli/commands/bake-geometry.ts` — runs generators (`bakeEntry`), emits the seed.
  `codegen-bindings`-shaped (run / `--check` / write); a sibling of `bake-icons`.
- `runtime/geometries/_baked.generated.ts` — the seed (committed empty). `BAKED` maps
  `internKey → {key, vertices, count, bounds}`.
- `runtime/geometries/intern.ts` — pre-seeds its cache from `BAKED` on load; exports
  `internKey()` (the bake reuses it, so a baked key === the runtime key) and
  `bakeEntry()`.

**Verified:** with `generate()` sabotaged to throw, a baked mesh still resolves
(transparent hit, no generate call); an un-baked mesh falls back to runtime
generation. `--check` gates drift. skybox_demo ships with the empty seed.

## Wiring TODO (when a producer lands)

`rjit ship` should run `bake-geometry` for the cart before bundling (the manifest
producer needs cart-manifest discovery; the taint producer needs the analysis pass),
so `_baked.generated.ts` is fresh when esbuild includes it. Until a producer is wired,
the seed stays empty and every mesh uses the runtime intern — i.e. exactly today's
behavior, with the bake path dormant and ready.
