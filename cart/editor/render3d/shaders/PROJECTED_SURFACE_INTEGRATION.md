# Projected Surface Packages

Status: integration proposal, based on the active `cart/editor/` and framework code as of 2026-08-30.

## The target

The target is not “put a height map beside a material.” It is one authored surface package whose structural field drives every representation of the surface:

- the base face becomes real displaced 3D geometry;
- the art layer shades the exact bricks, ribs, seams, chips, and valleys that produced that geometry;
- normals and shadows follow the displaced shape;
- collision evaluates or bakes the same structural field;
- a plane, a six-sided tube, or another coarse mesh can carry the package through an explicit surface domain;
- deterministic cell addressing produces local repetition such as brick courses or corrugation without repeating a finite texture tile.

The current Brick and Rust Sheet previews are ideal examples. Their WGSL already computes most of the useful structural information, but it throws that information away after producing RGB. The integration should promote that hidden structure into shared package data rather than try to infer depth from the final color.

In this repository, `shader`, `material`, and `Effect` already have precise meanings. A shader is an art-layer WGSL recipe; a material is the named assignable look produced from one; an `Effect` is a fragment-shader quad. The system proposed here is therefore a new **Surface Package** capability that composes with the shader/material system. It should not redefine a material as geometry, and it should not be built as an `Effect` extension.

## What exists already

The engine is much closer to this than a blank-slate renderer.

### The shader catalog is a strong appearance compiler

The authored catalog has a strict material signature and generated registry. Atom kinds are separately typed as scalar fields, UV warps, and color modifiers in [ATOM_CONTRACT.md](./ATOM_CONTRACT.md). The Material Lab already has the correct two-speed split in [LAB.md](./LAB.md): numeric changes travel through `D[]` without compilation, while graph-topology changes emit and compile a small per-recipe module.

[recipe.ts](./recipe.ts) is the single deterministic recipe emitter. [compose.ts](./compose.ts) resolves only the transitive functions needed by a recipe or binding set. That per-set composition is load-bearing: composing the entire catalog produced a roughly 735 KB WGSL module and render-thread stalls measured in minutes.

The existing source materials expose the opportunity clearly:

- [brick.wgsl](./materials/brick.wgsl) computes `row`, `cell`, cell-local coordinates, mortar distance, per-cell tone, soot, and chips, then returns only `vec3f` color.
- [rust_sheet.wgsl](./materials/rust_sheet.wgsl) computes a sine corrugation, ridge value, rust noise, vertical drips, and speckling, then returns only color.
- [corrugated_metal.wgsl](./materials/corrugated_metal.wgsl) likewise computes the rib sine that should be both shape and shading.

Those values are not merely decoration. Mortar distance is a displacement profile. Corrugation is literally a surface equation. Cell identity is the seed for non-repeating brick variation. The package compiler should let geometry and appearance consume those values together.

### Live material regions already solve continuous 3D color domains

[regionFormula.ts](../regionFormula.ts) composes only the materials bound in the session and evaluates them over mesh-local position. [liveRegions.ts](../liveRegions.ts) owns the session-wide union so independent users do not replace one another’s composed formula.

The framework’s region path in [shaders.zig](../../../../framework/gpu/shaders.zig) passes mesh-local position to `region_rgb`, and [live_regions.zig](../../../../framework/gpu/scene3d/live_regions.zig) binds a per-region `D` stream to a stable set of faces. This already proves that a procedural look can remain continuous across many faces and remain editable through data.

The current region path is still appearance-only. It re-draws selected faces as an equal-depth, emissive overlay. Its vertex stage does not displace vertices, its normals remain those of the base mesh, and the shadow pass sees the undisplaced mesh. A projected surface cannot remain an overlay; it must own the vertex and fragment work for its faces in one render path.

### The ground path already proves GPU displacement plus normal reconstruction

The formula-painted ground pipeline in [shaders.zig](../../../../framework/gpu/shaders.zig) uses one immutable topology, reads heights from a storage buffer in the vertex stage, and reconstructs normals with neighboring samples. [paint_runtime.zig](../../../../framework/world_loader/paint_runtime.zig) registers the same sampled grid as a physics heightfield: its stated invariant is “see-it == walk-it.”

That is an excellent precedent for projected surfaces. It is not the complete solution because the ground grid is horizontal and data-sampled, while a Surface Package must operate in a local face/chart frame and may evaluate a procedural program. The ownership pattern is correct: immutable evaluation topology plus data-driven displacement, with a matching host-side collision representation.

### The physics engine has useful destinations

[physics.zig](../../../../framework/game/physics.zig) already supports bilinear heightfield colliders with slope limits. [mesh_collision.zig](../../../../framework/game/mesh_collision.zig) supports an exact static triangle narrowphase behind coarse broadphase boxes. [world_loader/physics.zig](../../../../framework/world_loader/physics.zig) already derives, registers, and spatially windows collision representations.

Those give the package compiler two existing static outputs:

- a sampled heightfield where the surface is a suitable single-valued field;
- baked collision triangles for general static projected geometry.

Animated or very high-detail projected collision needs one new narrow capability, described below; it does not require a second physics engine.

### The compiled world has a firm ownership rule

The building grammar in [DECISIONS.md](../../../../docs/game/DECISIONS.md) is “author by semantic piece, bake by gameplay contract, skin by catalog.” A wall remains a wall and must still bake collision, cover, sound occlusion, rooms, and navigation from its semantic meaning.

The same document explicitly rejects runtime-dynamic shapes in map data. Lawful runtime variation is instance transforms/parameters, shader `data[]`, or newly authored content installed as an asset and then referenced. Per-frame geometry is a framework capability, never a map concern.

A Surface Package therefore becomes a content-addressed installed asset. A map or model references its key and supplies bounded instance parameters. Static geometry and collision can be compiled into the asset; genuinely animated evaluation remains a framework-owned effect/collision capability.

## Recommended architecture

Use one versioned Surface Package whose registered WGSL surface module is the only mathematical authority. Package data selects that module and supplies its frequencies, phases, amplitudes, seeds, and modifier values:

```text
 Surface Package data + registered WGSL surface module
                         |
                  compute prepass
                         |
             Pending Surface Revision
        Generated Surface Buffer + Collision Field Layout
                         |
        install collision · resolve swept change · commit
                         |
              Active Surface Revision
                  /                    \
        Scene3D + shadow pass      Collision Residency View
                  |                    |
          appearance recipe       coherent Zig physics
```

There is no hand-translated Zig copy of the sine/noise/warp formula. The same WGSL function that defines the structural shape is invoked by a compute prepass to generate positions, normals, and structural feature values. Scene3D renders that generated buffer, and collision samples are a bounded view into the same generated data. Zig owns buffer orchestration, residency, broadphase, and contact resolution; it never reimplements the surface equation.

This requires one terminology correction to “the material shader defines the geometry.” A fragment entry point cannot pass a frequency backward to a vertex stage because vertex work happens first. The authored shader must become a composable **surface module**, not only `fs_main`. Its parameter schema is packed into the surface `D[]` section and bound to compute, vertex/shadow, and fragment consumers. The module therefore defines the material’s structural frequencies, while the compute prepass runs before every consumer that needs the result.

The generated buffer is also how to avoid evaluating the same geometry once for rendering and again for collision. Evaluation topologies should use nested grids/LOD levels so a collision lattice is a subset or index view of the render lattice. A static package computes once and caches. An animated package computes one pending revision, installs its matching collision layout, resolves the swept change from the previous revision, and only then promotes it. Rendering and physics can access only the same committed active revision.

Maps and installed assets still remain data. They reference a trusted registered surface module plus parameters; they do not hot-load arbitrary executable WGSL from map data. In the editor, the Surface Lab may compose/recompile a module just as Material Lab does today. Compile installs or bakes the reviewed result into the asset pipeline.

### One package, two internal layers

A package has a structural layer and an appearance layer, but they are not independent assets:

1. The **WGSL surface module** defines coordinates, cell addressing, domain warps, scalar displacement, and private feature signals such as mortar, ridge, cavity, chip, or rust accumulation.
2. The **appearance recipe** uses the existing shader/material compiler and may consume those private structural signals. It produces color now and can grow into roughness/emissive channels later without changing the public geometry contract.

The internal feature graph is shared. For Brick, geometry and color both read the same mortar and cell calculations. For Rust Sheet, corrugation displacement, ridge lighting, rust-valley accumulation, and drip flow all read the same rib phase. No caller outside the package needs to know how many intermediate signals exist.

The public engine boundary should remain narrow:

- prepare one validated pending surface revision containing its render buffer and collision layout;
- atomically promote it only after physics has installed that layout and resolved the transition;
- expose render and collision residency views of the committed revision only;
- evaluate appearance from the generated domain/features and the same module parameters;
- report conservative displacement bounds and required evaluation density;
- expose versioned parameters, seeds, projection policy, and collision policy;
- transfer only generated samples/contact data across the GPU/physics boundary, never a second formula.

That is a deep interface: rich procedural internals behind a small, validated runtime surface.

### Proposed package shape

The names below are illustrative, but the separation is important:

```ts
type SurfacePackage = {
  version: 1;
  id: string;
  base: {
    topology: 'plane' | 'charted-mesh';
    evaluationDensity: number;
  };
  domain: {
    kind: 'chart2d' | 'object3d';
    metersPerUnit: number;
    periodicU?: number;
    periodicV?: number;
  };
  surfaceModule: string;
  appearance: MaterialRecipe;
  bounds: {
    minimumDisplacement: number;
    maximumDisplacement: number;
  };
  collision: {
    mode: 'base' | 'baked-buffer' | 'streamed-buffer';
    sampleSpacing: number;
    motion: 'static' | 'revisioned';
    activationHorizonMs: number;
  };
};
```

The saved asset should contain the stable surface-module key, package parameters, and references required to reproduce it. Generated surface buffers, tessellated render proxies, and baked collision are derived caches or compiled lumps, not competing sources of truth.

The initial Surface Lab graph only needs a compact vocabulary and emits one WGSL surface module:

- constants, parameters, arithmetic, min/max, clamp, mix, smoothstep;
- sine, cosine, pulse/cliff shaping, and finite-domain filters;
- deterministic hash, value noise, and FBM with canonical behavior;
- coordinate transform and domain warp;
- cell address plus cell-local coordinates;
- periodic wrapping declared at the domain boundary;
- optional time, oscillator, envelope, LFO, noise, ring modulation, and step sequence nodes.

The synth-style modifier rack fits naturally as an authoring UI for this module. Its sequencer must remain an explicit enabled/disabled node. When disabled it contributes the identity value, and collision cannot accidentally keep stepping while the visual is frozen.

Every node must emit one canonical WGSL implementation. Rendering, structural appearance, and GPU collision generation all call that implementation; there are no cross-language hash/noise twins to keep approximately synchronized.

### Keep the existing material contract compatible

Do not change every catalog function from `-> vec3f` to a giant geometry/material struct. Most catalog entries are art-only and should remain valid.

Instead:

- keep current materials and recipes working unchanged;
- add Surface Packages as an optional higher-level catalog kind;
- let a Surface Package embed/reference an appearance recipe using the existing recipe compiler;
- allow art-only materials to be used on projected geometry when exact structural coupling is not needed;
- migrate selected materials such as Brick and Rust Sheet by extracting their structural calculations into package-owned nodes, then generate an appearance adapter that preserves their ordinary 2D material preview.

This gives gradual migration. A material can still be applied to an ordinary mesh. A Surface Package can also materialize a 2D look for existing paint workflows. Only packages that declare structure acquire geometry and collision behavior.

[types.ts](../../data/types.ts) currently lets a `ModelTextureSlot` carry an optional appearance-only `liveMaterial`. Keep that capability honest. Add a separate projected-surface binding carrying a package asset key plus instance parameters, and reject a slot that tries to use both owners. The new binding can reuse the slot’s durable face membership, but the projected pipeline replaces the base draw for those faces; it is not another equal-depth overlay. Build pieces should reference the same package through their catalog skin while retaining their independent semantic kind and gameplay collision data.

### Use a versioned sectioned data stream

The Material Lab’s `D[]` pattern is worth reusing, but the current region buffer is a fixed 256-float array with positional extras. Do not indefinitely append geometry state to that implicit layout.

A projected-surface pipeline should receive a versioned buffer with explicit section offsets:

- package/instance header;
- structural node parameters;
- appearance recipe row in the existing material layout;
- palette and material parameters;
- animation state;
- optional sampled/baked field data.

The existing row-relative `mat_data_base` mechanism can point the material helpers at the appearance section. Structure and appearance then share one GPU binding without pretending their layouts are the same. Validation must reject missing sections, non-finite values, invalid bounds, excessive program depth, and over-budget sample density before pipeline creation.

Numeric edits remain data-speed. Adding/removing/reordering structural nodes, swapping atom kinds, changing projection type, or changing base topology remains compile-speed. The same topology key idea used by [recipe.ts](./recipe.ts) should cover the structural graph.

## Rendering path

### A logical face still needs evaluation topology

WebGPU vertex shaders can move vertices but cannot create new ones. A logical plane with two triangles cannot become a field of bricks by displacement alone.

The engine should preserve “one face” as the authored/semantic source while lowering it to a tessellated render proxy. Likewise, a six-sided cylinder can remain six logical faces while each face receives enough generated vertices to evaluate the field. The proxy is implementation detail, content-addressed and shared where possible.

Evaluation density must be explicit and bounded. The compiler can derive a minimum from the surface module’s highest declared frequency, but the package should still carry quality/LOD limits. Frequencies above the mesh’s sampling rate alias into broken geometry; no shader trick fixes insufficient vertices.

### The projected pass owns depth, lighting, and shadows

The current live-region overlay is the wrong final ownership model because its base draw writes the old depth and shadow shape. Build a Scene3D projected-surface pipeline around a compute-generated buffer:

1. The compute prepass reads base position, normal, chart coordinate, instance transform, and the package `D[]` section.
2. It calls the authoritative WGSL surface function and writes displaced position, reconstructed normal, domain coordinate, and a compact structural-feature payload into the Generated Surface Buffer.
3. The Scene3D and shadow passes read the same generated positions. Neither pass independently reconstructs the surface formula.
4. The appearance fragment consumes interpolated structural features and the same package parameters. Fine appearance-only detail may still evaluate per fragment, but it must not redefine structural frequency or shape.
5. The collision view selects a nested subset of generated vertices/triangles or a local indexed patch from that buffer.
6. Standard Scene3D lighting, fog, transparency, wireframe, and shadow behavior operate on the generated positions and normals.

The buffer should carry a package revision and generation time. A pending revision is not renderable. It becomes active only when its collision layout is installed and physics has safely resolved the change from the previous active revision. Scene3D, shadows, collision residency, and debug visualization receive the active-revision handle rather than independently asking for the latest buffer. Static buffers regenerate only when structural data changes; animated buffers regenerate once per candidate update, not separately per consumer.

Normal displacement is deliberately the first contract. It covers walls, brick, shingles, corrugated sheet, cloth-like ripples, crystal facets, and stitched tubes. Vector displacement, topology holes, and true overhangs should wait until there is a concrete package that cannot be represented this way.

A mathematical cliff is still sampled by triangles. A sharp drop can look vertical at sufficient density, but it is not a disconnected brick with hidden side faces. If a package needs watertight sides, deep undercuts, or actual separated pieces, the asset compiler must bake explicit geometry. The authoring package can remain procedural even when its compiled representation becomes triangles.

### Projection domains are explicit

Appearance continuity and geometry continuity must use the same coordinate policy.

- `chart2d` is the preferred domain for planes, roofs, cloth panels, and stitched cylinders. It carries a tangent frame and continuous coordinates across the selected logical faces.
- `object3d` is useful for a seam-free volumetric field over an arbitrary mesh, displaced along its base normals.
- triplanar blending remains a useful appearance fallback, but it should not silently define structural projection because blended axes do not provide one unambiguous surface chart.

For a stitched six-sided tube, chart construction should assign each side a consecutive U interval and declare U periodic at the seam. The structural evaluator sees one ring, not six restarted faces. End caps can use separate charts or explicitly fade displacement to zero at their boundaries.

Per-face Surface Packages also need a boundary rule. Either displacement reaches zero at a package boundary, adjacent faces share the same package/chart, or the compiler creates the necessary boundary wall. Otherwise the renderer will correctly expose a crack that the source topology did not close.

## Brick and sheet metal as pilot packages

### Brick

The current 2D material already has the right decomposition:

1. derive a row and staggered cell address from continuous surface coordinates;
2. derive cell-local coordinates with `fract`;
3. compute signed distance to the horizontal and vertical mortar joints;
4. use a rounded cliff profile for the brick face;
5. modulate face depth with low-amplitude warp/chip fields;
6. hash the absolute cell address for brick-specific depth, hue, wear, and edge damage;
7. use mortar/face/cavity signals for the appearance recipe.

The important anti-tiling distinction is that `fract` is only used for the cell-local shape. The integer cell address must continue across the whole wall and feed the hash. The current 4× preview repeats the same finite `[0,1]` input tile, so the same macro patch restarts. A Surface Package preview should instead expand the continuous domain when zooming from 1× to 4×; it must not render the same UV square four times.

Low-frequency domain warp should also use continuous coordinates and a package/instance seed. That makes courses drift subtly and damage clusters span multiple bricks without creating a visible repeating rectangle. The goal is no observable finite tile, not the mathematically impossible promise that a finite hash can never repeat a value.

### Rust or corrugated sheet

The current sine rib is already the shape:

1. corrugation phase produces normal displacement;
2. its derivative produces the transverse normal;
3. curvature and valley position influence rust accumulation;
4. continuous FBM controls broad oxidation patches;
5. gravity/chart-V drives drips;
6. fine speckle remains appearance detail rather than expensive collision detail.

This is a strong second pilot because it proves that structural signals improve the art layer instead of merely coexisting with it. Highlighting should come from the displaced normal and scene lights, while paint/rust color comes from the appearance recipe. The package should not paint a fake bright rib on top of a real rib unless that stylistic exaggeration is intentional.

## Collision integration

### Static surfaces: bake by default

Static architecture and props should generate the surface once on the GPU. The collision view then selects a nested, collision-appropriate subset of that exact Generated Surface Buffer:

- plane-like walkable samples may be read back once and registered as existing heightfield colliders;
- wall relief, stitched tubes, and more general generated triangles may be read back once into the existing exact collision-triangle lane;
- semantic piece colliders remain authoritative for cover, navigation, portals, and broad gameplay meaning;
- micro-detail below the collision threshold remains visual only.

The CPU receives generated coordinates, not frequencies and not a translated equation. Static readback occurs only when the package revision changes, after which the coherent host physics system owns ordinary heightfield/triangle contact. Compile can persist that exact sample revision as the asset’s baked collision output, so shipped static surfaces need no readback at load.

The package compiler should record separate render and collision tolerances, but their evaluation lattices should be nested. A brick wall does not need every chip in collision, yet its brick-face projection may matter to a rolling sphere. A corrugated roof may need enough samples to roll across ribs but not enough to reproduce every rust pit. Collision chooses indices from the generated master surface rather than invoking the WGSL formula a second time.

### Stream installed collision cells, not physics bodies

The Wavegeo particle visualization is a good mental model for residency, but the engine should not spawn dozens of independent sphere colliders. Those bodies would create broadphase noise, seams, and unstable contact. The useful thing to preserve is the sparse field and its distance-triggered residency.

When a Surface Revision is prepared, partition its collision lattice into chart-local cells. Give each cell a deterministic identity derived from the package key, revision, chart, collision LOD, and integer cell coordinate. The procedural hash helps define the samples inside that cell, but the hash is a key—not storage by itself. The installed **Collision Field Layout** maps each cell identity to offsets and counts in a packed sample/triangle buffer generated from the authoritative surface data.

For a static package, that layout is immutable and is installed before the matching revision is ever rendered. Runtime streaming therefore does not evaluate WGSL, regenerate the roof under the player’s feet, perform GPU readback, or create new collider bodies. It only makes already-installed cell ranges resident in a bounded contact view.

Implement one framework-owned **collision residency view**:

1. use the semantic collider or the package’s conservative bounds as the coarse broadphase;
2. predict each relevant body’s swept bounds over the activation horizon;
3. inflate those bounds by the body’s support radius, collision approximation error, and a safety allowance;
4. map the inflated bounds into chart cells and activate their packed sample/triangle ranges;
5. resolve contact against that coherent local patch without knowing the surface formula;
6. pin the supporting cells and a neighbor ring while contact is possible;
7. evict only after the body crosses a larger exit margin, preventing residency chatter.

The minimum lead distance is a budget, not a magic constant. Conservatively:

```text
activation margin >= body support radius
                   + maximum relative speed * (worst activation time + one physics step)
                   + maximum relative acceleration * horizon² / 2
                   + collision approximation error
                   + safety allowance
```

For a static surface, surface speed and acceleration are zero. If activation is only a host-side cell lookup plus an active-mask or pool update, the selected patch can become usable in the same simulation frame. If residency ever requires a transfer or allocation, its measured worst-case latency must be included in the horizon. A fast body must be queried by its swept path rather than its current distance, so it cannot cross the trigger margin and the surface in one step.

The glowing “particles” can visualize resident samples, but they are not separately simulated spheres. They are sample points or triangle vertices carrying the exact generated position and normal. Physics treats their patch as one coherent surface. A sphere, capsule, or player can use the same patch through the existing host solver. Under a player standing or walking on a static roof, the supporting patch stays pinned and its coordinates never need reevaluation; only ordinary contact resolution continues each tick.

### Latency is allowed; render/physics desynchronization is not

GPU generation and host physics do have a synchronization boundary, but that does not require the visible surface to get ahead of collision. Desynchronization appears only if Scene3D renders the newest GPU result while physics still owns an older result. The renderer must render the **committed** revision, not the latest generated revision.

The revision lifecycle is:

1. compute produces pending revision `N+1`, including render positions and its Collision Field Layout;
2. the matching collision layout is transferred and installed in the coherent Zig physics system;
3. physics checks the swept change from active revision `N` to candidate `N+1` for nearby bodies;
4. contacts are resolved or bodies are moved safely out of the candidate surface;
5. only then is `N+1` atomically promoted and exposed to Scene3D, shadows, and collision residency.

If any stage is late or cannot resolve safely, the engine keeps rendering and colliding with `N`. A deterministic animation may keep a short queue of revisions generated ahead of their presentation time, accepting fixed presentation latency while retaining exact alignment. Latency delays promotion; it never permits a visual/physical mismatch.

Revision alignment and moving-collider tunneling are separate problems. Even perfectly matched snapshots can sweep through a body between `N` and `N+1`. Revisioned solid motion must retain both states and use swept triangles/prisms, time-of-impact, or bounded substeps before commit. Step-sequencer jumps need a declared morph window, substep budget, or non-solid teleport policy. If the transition exceeds its displacement/velocity budget, promotion fails closed instead of displaying geometry around an embedded body.

For arbitrary input-driven geometry that cannot be predicted, the correct choices are to wait for GPU completion, generate sufficiently ahead, or eventually produce contacts in the GPU command graph and feed them into the one coherent physics owner. Showing the new geometry against old collision is not one of the choices.

None of these paths author the wave twice. The WGSL surface module remains the definition, the generated collision layout crosses into host physics once per revision, and cheap cell residency changes occur as bodies move. This should reuse the world loader’s existing spatial attention model: static packages stay installed and immutable, while only nearby cells occupy the live contact view.

The visual `material` and gameplay/physics surface material must remain separate. A rusted metal appearance must not silently decide friction, restitution, footstep audio, or damage; those remain typed gameplay data in the piece/package collision section.

## Authoring and preview integration

Extend Material Lab conventions rather than creating an unrelated tool:

- a Surface Package mode with Structure, Appearance, Projection, Collision, and Bounds sections;
- the existing synth-like rack edits the structural graph;
- an explicit Sequence On/Off control makes the sequencer contribution identity when off;
- the existing 2D preview remains available as the appearance slice;
- add real 3D preview bases: dense plane, stitched six-sided tube, and selected model faces;
- display displaced wireframe, reconstructed normals, conservative bounds, and collision samples;
- provide Render LOD and Collision LOD independently;
- provide a “continuous 4× domain” preview that exposes anti-tiling behavior instead of repeating one finite tile;
- use the same composed package module that Scene3D consumes, not a second preview-only formula.

The preview should make the package’s representation ladder visible:

- logical source face count;
- evaluation/render triangles;
- collision samples or triangles currently resident;
- surface module, active/pending revision, and appearance recipe identity;
- current package/instance seed;
- activation horizon, swept trigger bounds, pinned support cells, and eviction margin;
- pending-revision state and the reason a candidate has not committed.

## Compilation and caching

Follow the Material Lab’s proven data-speed/compile-speed boundary:

Data-speed changes:

- seed, scale, projection depth;
- numeric node parameters;
- oscillator/LFO/envelope amounts;
- sequence gates and velocities;
- palette and appearance parameters;
- collision activation horizon and additional margin, above validated minimums.

Compile-speed changes:

- add/remove/reorder nodes;
- change structural atom types;
- change domain or base topology;
- change the bound appearance function set;
- enable a new output channel.

Pipeline composition must remain per package/per visible set. Never insert the whole material catalog into a projected-surface pipeline. Cache keys should include structural topology, required appearance functions, projection kind, static/skinned vertex variant, render pass, and schema version. Numeric values should not poison the pipeline key.

For installed static assets, compile by content hash into:

- the registered surface-module key, parameter data, and validated metadata;
- tessellated render topology or a reference to a shared topology;
- optional baked Generated Surface Buffer;
- material/appearance references;
- conservative bounds;
- collision triangles/heightfield derived from the buffer, or streamed-buffer policy;
- semantic piece outputs where applicable.

Maps reference the installed asset plus instance parameters. They do not embed a live arbitrary geometry program as map behavior.

## Correctness and performance gates

The first implementation should fail closed on these invariants:

- zero displacement returns the base surface exactly;
- declared periodic seams match position and normal within tolerance;
- generated displacement stays inside declared conservative bounds;
- compute, Scene3D, shadow, appearance, and collision composition reference the same registered WGSL surface function and parameter offsets;
- collision samples identify the exact Generated Surface Buffer revision they came from;
- Scene3D and physics can access only one atomically committed active revision;
- a pending revision is never visible, and failed transition resolution leaves the prior revision active;
- Zig contains no translated copy of a package’s sine, hash, noise, or warp formula;
- no non-finite node output reaches a vertex, bound, or collider;
- evaluation density satisfies the package’s declared maximum frequency or rejects it;
- a Surface Package boundary is closed, shared, or faded to zero;
- displaced geometry participates in the matching shadow pass;
- collision is derived from the same package revision and seed as rendering;
- every static collision cell resolves to immutable packed data in the installed revision;
- the swept activation margin exceeds worst-case relative travel during activation plus one simulation step;
- supporting cells remain resident until contact and the eviction margin are both clear;
- no revision commit leaves a nearby body embedded, including a maximum-budget sequencer transition;
- static collision never changes merely because the art palette changes;
- a disabled sequencer contributes identity to rendering and collision;
- the per-set compiler never falls back silently to the full catalog;
- the frame-time gate remains silent through representative static and streamed-buffer scenes, including revision changes and readback publication.

Tests belong at both layers:

- TypeScript tests for package schema, topology keys, WGSL composition, data packing, and migration adapters;
- GPU/WGSL tests for compute-generated positions, normals, feature payloads, seam closure, bounds, and stable buffer revisions;
- Zig tests for generated-buffer ingestion, atomic revision promotion, revision rejection, collision-cell residency, swept activation, hysteresis, baked geometry, and ordinary host-side contact resolution—never for a second surface evaluator;
- fixtures containing known package data and expected Generated Surface Buffer samples;
- interaction tests with a rolling sphere/capsule across brick cliffs, corrugation, a stitched seam, and an animated wave;
- user visual verification for silhouette, lighting, seam behavior, and collision-sample display.

## Suggested implementation sequence

1. **Freeze the Surface Package contract.** Define the versioned data schema, registered WGSL surface-module signature, generated-buffer layout, domain types, bounds, parameters, and structural node vocabulary. Do not begin with the rack UI.
2. **Build Brick on a dense plane.** Extract cell/mortar/profile/hash structure into one WGSL surface module, generate the displaced buffer in compute, and render its positions/features through standard lighting and shadows.
3. **Add the collision view and static bake.** Select a nested lower-density view from Brick’s generated buffer, transfer it once into the host’s existing collision representation, and prove a sphere cannot clip through the projected face. Do not add a Zig Brick evaluator.
4. **Build Rust Sheet.** Prove sine corrugation, curvature-aware art, continuous macro noise, and separate render/collision detail.
5. **Add chart stitching.** Wrap one package around the six logical sides of a coarse tube, enforce periodic U, handle caps, and test the seam in rendering and collision.
6. **Integrate the Surface Lab.** Reuse recipe/data packing, parameter controls, compile-progress behavior, and per-set composition. Add the stepping toggle and representation diagnostics.
7. **Add collision-cell residency.** Install one static Brick collision layout, stream immutable chart cells into a bounded active view from swept body queries, and prove a fast sphere cannot outrun activation. Add support-cell pinning and hysteresis before generalizing to oriented charts and stitched bases.
8. **Add atomic animated revisions.** Generate `N+1` ahead, install its matching collision layout, resolve the swept `N` to `N+1` change, and expose it only through one commit. Prove that delayed generation delays both consumers and that a failed transition keeps `N` visible and physical.
9. **Attach semantic build pieces and installed assets.** A wall/roof/prop references the package while retaining its own gameplay contract. Compile static outputs into content-addressed assets and map references.

## Recommendation

Build this as a Surface Package layer immediately above the existing shader recipes, not as a new material atom and not as a patch to live-region overlays.

The critical decision is to give the structural field one WGSL authority, one generated surface revision, and one atomic commit point shared by rendering and physics. That is what allows Brick to be one thing instead of a color shader, an unrelated displacement shader, and a third collision approximation. Its static collision layout can be installed once and streamed by deterministic cells, so distance controls residency rather than correctness. Existing shader composition, `D[]` parameters, object-space continuity, immutable evaluation topology, host heightfields, exact mesh collision, and content-addressed compilation can all be reused while Zig remains the one physics owner without becoming a second wave author.

Brick should be the first proof because its current WGSL visibly contains the future system: cell address, local shape, mortar, tone, and damage are already there. The work is to stop collapsing those signals into RGB too early.

## Ruled amendments and the v1 contract as frozen (2026-08-31)

The user ruled on this proposal in session (req_4781, req_4782, req_4783); the
contract below is FROZEN and building (req_4784). Where this section and the
proposal above disagree, this section wins.

### Rulings

1. **Approved architecture (req_4781).** One WGSL surface authority, a
   compute-generated buffer, render/shadow/collision as views, Zig never
   carrying a translated formula. Three amendments accepted with approval:
   a hard v1 line at STATIC packages; a far-LOD normal/feature-map bake
   declared in the contract now (citywide vertex budget — near walls wear the
   displaced proxy, far walls wear a flat face + a texture baked FROM the same
   generated buffer); and per-fragment appearance as LAW, not allowance — the
   fragment re-evaluates the surface module for crisp shading (interpolated
   vertex features would blur brick mortar below today's 2D material).

2. **Capture-frame (req_4782).** Animation is AUTHORING-TIME. The world editor
   exposes the full rack (time, oscillators, LFO, sequencer scrub, depth); the
   author scrubs, then CAPTURES — frozen phase values become ordinary package
   params and the bake proceeds as static. Scrubbing is render-only preview
   (data-speed edits); collision bakes at capture. The proposal's streamed
   residency + atomic animated revisions (its collision sections' dynamic
   halves) are a SEPARATE, later campaign. Verbatim: "when it effectively
   comes to playing the game that would ideally be a static wall."

3. **The wall tool is the consumer (req_4783).** v1 packages bind through a
   build piece's per-side finish lane (worldFinishes / setSideFinish — package
   key + instance params + captured frame, per side). NOT a studio model
   editor feature: facade projection would fight the mesh editor for vertex
   ownership; a flat wall side has no identity to protect. Free wins already
   ruled elsewhere: wall-run identity (req_4501) makes the chart span the RUN,
   so courses continue across segments with no restart seam; semantic openings
   (req_4503/4507/4513) provide the boundary perimeters where displacement
   fades to zero so kit housings seat flush. Roofs ride the same lane. The
   stitched tube, charted-mesh and object3d domains drop out of v1 entirely.

### v1 as built (this repo, slice 1)

- **Surface modules** live in `surfaces/*.wgsl` — a fourth generated kind
  beside materials and atoms. Header `// @surface <fn>`, enforced signature
  `fn surface_<name>(sp: vec2f, seed: f32) -> SurfaceSample {`, `@param` knobs
  riding the standard `mat_param` rewrite. `sp` is CONTINUOUS (cell units in
  the 2D adapter, real run meters under a package) — the anti-tiling law is
  structural: hashes read the cell address, which never restarts.
- **`SurfaceSample`** `{ height: f32, cell: vec2f, feat: vec4f }` is emitted
  into the dispatch PRELUDE so every composed module carries the contract.
- **One authority, day one:** `materials/brick.wgsl` is now an appearance
  ADAPTER calling `surface_brick` and shading its features — pixel-identical
  color path (same ops, same order; recipe.test.ts's brick slot ground truth
  is the canary), with the height law living only in the module.
- **`surfacePackage.ts`** owns the v1 schema, fail-closed validation, the
  compile-speed topology key (numeric edits never move it), the structural
  D section (a fill-shaped row — `mat_param` works inside modules unmodified —
  with package extras after, region-harness style), and `surfaceEvalModule()`,
  the composed WGSL the compute prepass consumes behind `fn sp_eval(sp)`.
  `surfacePackage.test.ts` locks all of it, including the layout indices the
  Zig consumer must mirror.
- **Composition** resolves surface bodies transitively everywhere
  (`compose.ts` `fnBody()`); the ground and region formulas were joining
  through the material map alone and would have stringified `undefined` into
  WGSL for any adapter material — fixed as part of this slice.

### Remaining slices (in order)

1. Zig compute prepass + Generated Surface Buffer + a Scene3D projected draw
   of a dense plane wearing the brick package (first compute pipeline in the
   framework; wgpu bindings already expose it).
2. Static collision bake: nested-lattice readback into the existing
   heightfield / exact-triangle lanes; sphere-cannot-clip proof.
3. Wall-side-finish binding + capture UI (rack scrub in the world editor).
4. Far-LOD bake + Surface Lab authoring integration.
