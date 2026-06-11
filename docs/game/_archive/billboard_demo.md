# billboard_demo — 2D content rendered onto a 3D mesh face

**Cart file:** `cart/billboard_demo.tsx` (single file, ~100 lines, no subdirectory)
**Ship:** `./scripts/ship billboard_demo`

## What it is, in one sentence

A minimal proof cart for the **2D-on-3D bridge**: it renders two ordinary 2D subtrees (a live Box+Text UI and a WGSL `<Effect>` shader) into offscreen GPU textures via `<StaticSurface staticKey>`, then samples those textures as the diffuse maps of two thin 3D panels inside a `<Scene3D>` — the "monitor screen in the game world" capability.

## The scene, concretely

One full-screen `Box` (`width/height: '100%'`, bg `#0a0d14`) containing:

1. **A `<Scene3D>`** filling the screen, with:
   - `Scene3D.Camera` at `[0, 1, 5]` looking at origin, fov 50
   - `Scene3D.AmbientLight` (white, 0.6) + `Scene3D.DirectionalLight` (white, 0.8, direction `[0.4, 0.9, 0.5]`)
   - **LEFT mesh** — a thin box panel (`Geometry.Box`, params `{width: 2.2, height: 1.1, depth: 0.006}`), `material="#ffffff"`, `textureKey="bb-screen"`, at `[-1.4, 0, 0]`
   - **RIGHT mesh** — identical thin panel, `textureKey="bb-fx"`, at `[1.4, 0, 0]`, rocking the opposite way
2. **Two `<StaticSurface>` capture sources**, parked offscreen at `left: -99999` so they never paint to the visible screen, only into their textures:
   - `staticKey="bb-screen"` (512×256): a `<Filter shader="crt" intensity={0.85}>` wrapping a red `Box` with `Text` headers and a live `frame {tick}` counter
   - `staticKey="bb-fx"` (512×256): an `<Effect>` running an inline WGSL plasma shader fed `data={[tick * 0.05]}`

## Animation loop — JS-side, with the host's missing-rAF workaround

- State: a single `tick` counter (`useState(0)`), incremented every frame, wrapped at 24 bits (`(t + 1) & 0xffffff`).
- Driver: a `useEffect` that probes `globalThis.requestAnimationFrame` and **falls back to `setTimeout(fn, 16)`** because the V8 cart host (`v8_app.zig`) does **not** expose `requestAnimationFrame` — I verified there is no rAF binding anywhere in `framework/` or `v8_app.zig`. So in practice this cart always runs on the setTimeout branch. `setTimeout`/`clearTimeout` ARE host-provided globals. This rAF-probe-or-setTimeout pattern is the standard game-loop idiom across carts (see memory `reactjit_no_raf`).
- Motion: `rock = Math.sin(tick * 0.022) * 0.5` — plain JS math, applied as the meshes' Y `rotation` prop (±~28°). Deliberately a *rock*, not a spin, so the thin panels' side faces never broadside the camera (one mesh shares ONE diffuse texture across all 6 box faces, so side faces would smear the image; thinness + rocking hides them).

## Mechanism trace — exactly which layer does what

### `<StaticSurface staticKey="X">` (JS primitive → host paint capture)
- **JS side:** `runtime/primitives.tsx:327` — a pure prop-mapper. It renders a host `'View'` node with `staticSurface: true` and `staticSurfaceKey` (aliased from `staticKey`). No logic beyond defaulting scale/warmup/intro frames.
- **Host side:** `framework/layout.zig` carries the props on the node; `framework/gpu/gpu.zig` (the `StaticSurfaceEntry` machinery, ~line 944+) renders the subtree's paint into a cached offscreen GPU texture keyed by that string. Children remain live React nodes (layout + hit-test still happen); only *paint* is collapsed into the texture.
- This cart uses StaticSurface purely as a **render-to-texture source** — the quad itself is never seen (parked at `left: -99999` with `position: absolute`).

### `textureKey` on `<Scene3D.Mesh>` (the actual bridge)
- **JS side:** `runtime/primitives.tsx:535` (`Scene3DBase.Mesh`) passes `textureKey` through as the host prop `scene3dTexKey` (only when a non-empty string).
- **Host side:** `framework/layout.zig:508` declares `scene3d_tex_key`; `framework/gpu/3d.zig:1382` resolves it per mesh each frame: `images.staticSurfaceBindGroup3D(key)` (`framework/gpu/images.zig:101`, delegating to `framework/gpu/gpu.zig:1017`) looks up the StaticSurface's cached texture and binds it as the mesh's diffuse-sampler bind group, replacing the global 1×1 white default texture.
- So the link is **string-keyed, cross-tree, resolved host-side per frame** — the 2D capture and the 3D mesh never reference each other in JS; they only agree on the key string (`"bb-screen"`, `"bb-fx"`).

### `<Scene3D.Mesh geometry={Geometry.Box}>` (geometry registry path)
- Uses the canonical `@reactjit/geometries` path: `Geometry.Box` is a **TS generator** (`runtime/geometries/Box.ts`), run once per unique params via the JS intern cache (`runtime/geometries/intern.ts`), shipping verts + intern key to the host on first use only; the host (`framework/gpu/3d.zig` `internGeometry`/`lookupGeometry`) retains the verts in a GPU buffer. String geometry names are dead — the JS side throws on them (`runtime/primitives.tsx:702`).
- Params here are **literal dimensions** (2.2 × 1.1 × 0.006), not unit-params-plus-scale-transform. That's fine for a fixed-size demo (two static param sets → two intern entries), but note the repo rule for *varying* sizes: unit params + scale transform, or the intern cache grows unboundedly (memory `geometry_intern_unbounded`).

### `<Effect shader={WGSL} data={[...]}>` (per-pixel generative surface)
- **JS side:** `runtime/primitives.tsx:886` — maps `data` to host prop `effectData`, renders host type `'Effect'`.
- **Host side:** `framework/gpu/effects.zig` compiles the cart-supplied WGSL fragment into a pipeline; `data` floats are uploaded to a storage buffer at `@group(0) @binding(1)` **without recompiling** the pipeline (effects.zig:215, :798). The `VsOut` struct and binding declarations are injected/shared by the Effect machinery — the cart shader only writes `fs_main`.
- The cart's shader is an animated plasma: pure `uv` + time (`ys[0] = tick * 0.05`), three phase-shifted sines into RGB. Time advances because React re-renders with a new `data` array each tick → host re-uploads 1 float/frame. **The shader animates via data upload, not via a host clock.**
- WGSL gotchas honored in the file: no unary `+`, no backticks in shader comments.

### `<Filter shader="crt">` (named post-process inside a capture)
- **JS side:** `runtime/primitives.tsx:359` — maps to host props `filterName`/`filterIntensity` on a `'View'`.
- **Host side:** `framework/layout.zig:410` (`filter_name`) → `framework/gpu/filter_shaders.zig` (`crt_wgsl`, line ~110) renders the subtree to an offscreen texture and composites through the named shader. **Closed Zig enum of shader names** — not cart-extensible (the known `<Filter>` debt; `<Effect>` is the open user-WGSL surface).
- The interesting composition here: the Filter sits **inside** the StaticSurface, so the CRT pass is folded into the captured texture — the mesh face shows *filtered* content with no leak to the visible screen.
- The cart obeys the hard rule: `<Filter>` carries explicit `style={{width:'100%', height:'100%'}}` — **omitting this crashes the host at load with no log** (memory `feedback_filter_needs_size`).

### Lights / camera
- `Scene3D.Camera`, `Scene3D.AmbientLight`, `Scene3D.DirectionalLight` are all prop-mappers in `runtime/primitives.tsx` (~line 443+) onto `scene3d*` host props consumed by `framework/gpu/3d.zig`. No `@reactjit/cameras` rig is used — the camera is a fixed hand-placed position, no controls, no picking.

## What this cart does NOT use

No host `__*` global functions, no `useHost`/`fetch`/`useConnection` networking, no localstore, no physics, no input handling (no Pressable, no key events), no `@reactjit/cameras`, no Tailwind `className` (all inline `style` objects), no Skybox/Fog overrides (so the default auto-fog is active — irrelevant at this 5-unit camera distance), no `Scene3D.Instances`, no `dynamicKey` dynamic geometry.

## Recurring shapes (glossary candidates)

These are the patterns this cart contributes to the cross-cart tally:

1. **StaticSurface → textureKey bridge** ("2D-on-3D") — string-keyed render-to-texture sampled by a mesh. THE capability this cart exists to prove. Also used by hmsc's tile surfaces and any in-world screen/billboard. Canonical reference per memory: this cart.
2. **rAF-probe / setTimeout-16 game loop** — the universal cart animation driver, since the host has no rAF. Appears in virtually every animated cart.
3. **Monotonic `tick` state as the single clock** — one counter drives both shader time (`data=[tick*0.05]`) and transform animation (`sin(tick*0.022)`), with bit-mask wraparound.
4. **Effect-as-material** — animating a shader by re-uploading `data[]` per frame while the WGSL source stays static (no pipeline recompile).
5. **Geometry registry mesh** (`geometry={Geometry.X} params={...}`) — the only living mesh-geometry path.
6. **Offscreen parking** (`position: absolute; left: -99999`) — keeping capture sources in the layout tree but off the visible screen. A convention, not a primitive: anything StaticSurface-captured but not meant to be seen does this.
7. **Thin-panel trick** — domain knowledge, not code: a "screen" mesh is a near-zero-depth box so the shared-texture smear on side faces collapses to a hairline; pair with rocking (not spinning) motion to keep edges away from the camera.

## Quirks / honest caveats

- The `frame {tick}` text updates live on the mesh because the StaticSurface re-captures when its content dirties — this is the documented "live content forces per-frame re-render of the capture" cost (fine for a demo with two 512×256 surfaces; this is exactly the rebake cost class behind hmsc's paint-spike hunts).
- `tick` advancing every ~16ms re-renders the whole cart every frame. Acceptable here (tiny tree); the pattern does not scale to big trees without isolating the ticking state.
- `data={[tick * 0.05]}` is an inline array — fresh identity every render, which is precisely the `static_surface_inline_props_rebake` hazard. *In this cart it's intentional* (the shader must re-bake each frame to animate), but copying this line into a static capture context causes the 40ms+ per-frame rebake bug.
