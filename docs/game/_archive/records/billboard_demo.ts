import type { DocIndex } from '../types';

export const billboard_demo: DocIndex = {
  name: 'billboard_demo',
  file: 'billboard_demo.md',
  cart: 'cart/billboard_demo.tsx',
  purpose: ['rendering', 'texture_bake', 'shader', 'geometry', 'game_loop'],
  loc: 100,
  summary:
    'A minimal proof cart for the 2D-on-3D bridge: it renders two ordinary 2D subtrees (a live Box+Text UI and a WGSL Effect shader) into offscreen GPU textures via StaticSurface staticKey, then samples those textures as the diffuse maps of two thin 3D panels inside a Scene3D.',
  interfaces: [
    {
      name: 'StaticSurface',
      purpose: ['texture_bake', 'rendering'],
      kind: 'component',
      sourceFile: 'runtime/primitives.tsx',
      codeRef: 'runtime/primitives.tsx:327',
      description:
        'Pure prop-mapper that renders a host View node with staticSurface:true and staticSurfaceKey (aliased from staticKey). Host-side gpu.zig StaticSurfaceEntry machinery renders the subtree paint into a cached offscreen GPU texture keyed by the string; children stay live React nodes (layout + hit-test still run), only paint is collapsed. Used here purely as a render-to-texture source parked offscreen.',
      dependsOn: ['framework/gpu/gpu.zig'],
      emits: ['bb-screen', 'bb-fx'],
      consumers: ['cart/billboard_demo.tsx', 'cart/hmsc'],
      status: 'live',
    },
    {
      name: 'Scene3D.Mesh textureKey',
      purpose: ['rendering', 'texture_bake'],
      kind: 'component',
      sourceFile: 'runtime/primitives.tsx',
      codeRef: 'runtime/primitives.tsx:535',
      description:
        'Scene3DBase.Mesh passes textureKey through as host prop scene3dTexKey (only when a non-empty string). Host-side layout.zig:508 declares scene3d_tex_key; 3d.zig:1382 resolves it per mesh each frame via images.staticSurfaceBindGroup3D(key), binding the StaticSurface cached texture as the diffuse sampler, replacing the global 1x1 white default. The link is string-keyed, cross-tree, resolved host-side per frame.',
      dependsOn: ['StaticSurface', 'framework/gpu/3d.zig', 'framework/gpu/images.zig'],
      consumes: ['bb-screen', 'bb-fx'],
      status: 'live',
    },
    {
      name: 'Scene3D',
      purpose: ['rendering'],
      kind: 'component',
      sourceFile: 'runtime/primitives.tsx',
      description:
        'Full-screen 3D scene container holding the camera, lights, and the two textured panel meshes. Default auto-fog is active but irrelevant at the 5-unit camera distance.',
      status: 'live',
    },
    {
      name: 'Scene3D.Camera',
      purpose: ['camera', 'rendering'],
      kind: 'component',
      sourceFile: 'runtime/primitives.tsx',
      codeRef: 'runtime/primitives.tsx:443',
      description:
        'Prop-mapper onto scene3d* host props consumed by 3d.zig. Fixed hand-placed position at [0,1,5] looking at origin, fov 50. No @reactjit/cameras rig, no controls, no picking.',
      dependsOn: ['framework/gpu/3d.zig'],
      status: 'live',
    },
    {
      name: 'Scene3D.AmbientLight',
      purpose: ['rendering'],
      kind: 'component',
      sourceFile: 'runtime/primitives.tsx',
      description: 'Prop-mapper onto scene3d* host props; white at 0.6.',
      dependsOn: ['framework/gpu/3d.zig'],
      status: 'live',
    },
    {
      name: 'Scene3D.DirectionalLight',
      purpose: ['rendering'],
      kind: 'component',
      sourceFile: 'runtime/primitives.tsx',
      description: 'Prop-mapper onto scene3d* host props; white at 0.8, direction [0.4, 0.9, 0.5].',
      dependsOn: ['framework/gpu/3d.zig'],
      status: 'live',
    },
    {
      name: 'Geometry.Box',
      purpose: ['geometry', 'rendering'],
      kind: 'utility',
      sourceFile: 'runtime/geometries/Box.ts',
      description:
        'TS generator from the @reactjit/geometries registry, run once per unique params via the JS intern cache (runtime/geometries/intern.ts), shipping verts + intern key to the host on first use only; host 3d.zig internGeometry/lookupGeometry retains verts in a GPU buffer. String geometry names are dead (the JS side throws at runtime/primitives.tsx:702). Used here with literal dimensions 2.2 x 1.1 x 0.006.',
      dependsOn: ['runtime/geometries/intern.ts', 'framework/gpu/3d.zig'],
      status: 'live',
    },
    {
      name: 'Effect',
      purpose: ['shader', 'rendering'],
      kind: 'component',
      sourceFile: 'runtime/primitives.tsx',
      codeRef: 'runtime/primitives.tsx:886',
      description:
        'Maps data to host prop effectData, renders host type Effect. Host effects.zig compiles the cart-supplied WGSL fragment into a pipeline; data floats are uploaded to a storage buffer at @group(0) @binding(1) without recompiling (effects.zig:215, :798). VsOut struct and binding declarations are injected by the Effect machinery; the cart shader only writes fs_main. Here it is an animated plasma fed data=[tick*0.05].',
      dependsOn: ['framework/gpu/effects.zig'],
      status: 'live',
    },
    {
      name: 'Filter',
      purpose: ['shader', 'rendering'],
      kind: 'component',
      sourceFile: 'runtime/primitives.tsx',
      codeRef: 'runtime/primitives.tsx:359',
      description:
        'Maps to host props filterName/filterIntensity on a View. Host layout.zig:410 (filter_name) to filter_shaders.zig (crt_wgsl ~line 110) renders the subtree to an offscreen texture and composites through the named shader. Closed Zig enum of shader names, NOT cart-extensible (the known Filter debt; Effect is the open user-WGSL surface). Here a crt Filter sits inside the StaticSurface so the CRT pass is folded into the captured texture.',
      dependsOn: ['framework/gpu/filter_shaders.zig'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'StaticSurface to textureKey bridge (2D-on-3D)',
      purpose: ['rendering', 'texture_bake'],
      description:
        'String-keyed render-to-texture sampled by a mesh: a 2D subtree captured to an offscreen GPU texture, then bound as a mesh diffuse map via a shared key string. THE capability this cart exists to prove; also used by hmsc tile surfaces and any in-world screen/billboard.',
      examples: ['billboard_demo', 'hmsc'],
      status: 'recurring',
    },
    {
      name: 'rAF-probe / setTimeout-16 game loop',
      purpose: ['game_loop'],
      description:
        'A useEffect probes globalThis.requestAnimationFrame and falls back to setTimeout(fn, 16) because the V8 cart host has no rAF binding. The universal cart animation driver; this cart always runs on the setTimeout branch.',
      examples: ['billboard_demo'],
      promoteTo: 'useGameLoop',
      status: 'promote',
    },
    {
      name: 'Monotonic tick state as the single clock',
      purpose: ['game_loop', 'animation'],
      description:
        'One useState counter drives both shader time (data=[tick*0.05]) and transform animation (sin(tick*0.022)), incremented every frame with bit-mask wraparound at 24 bits.',
      examples: ['billboard_demo'],
      status: 'recurring',
    },
    {
      name: 'Effect-as-material',
      purpose: ['shader', 'animation'],
      description:
        'Animating a shader by re-uploading data[] per frame while the WGSL source stays static (no pipeline recompile). Time advances because React re-renders with a new data array each tick.',
      examples: ['billboard_demo'],
      status: 'recurring',
    },
    {
      name: 'Geometry registry mesh',
      purpose: ['geometry', 'rendering'],
      description:
        'geometry={Geometry.X} params={...} — the only living mesh-geometry path. String geometry names throw.',
      examples: ['billboard_demo'],
      status: 'resolved',
    },
    {
      name: 'Offscreen parking',
      purpose: ['texture_bake', 'rendering'],
      description:
        'position: absolute; left: -99999 keeps StaticSurface capture sources in the layout tree but off the visible screen. A convention, not a primitive.',
      examples: ['billboard_demo'],
      status: 'recurring',
    },
    {
      name: 'Thin-panel trick',
      purpose: ['rendering', 'geometry'],
      description:
        'Domain knowledge: a screen mesh is a near-zero-depth box so the shared-texture smear on side faces collapses to a hairline; pair with rocking (not spinning) motion to keep edges away from the camera, since one mesh shares ONE diffuse texture across all 6 box faces.',
      examples: ['billboard_demo'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'Host has no requestAnimationFrame',
      purpose: ['game_loop'],
      description:
        'The V8 cart host (v8_app.zig) does not expose requestAnimationFrame anywhere in framework/ or v8_app.zig; game loops that assume rAF will not animate. Must probe and fall back to setTimeout(fn,16). setTimeout/clearTimeout ARE host-provided globals.',
      evidence: ['no rAF binding anywhere in framework/ or v8_app.zig (verified)'],
      fix: 'Use the rAF-probe-or-setTimeout idiom (memory reactjit_no_raf).',
      severity: 'high',
    },
    {
      name: 'Filter requires explicit 100% size or host crashes',
      purpose: ['rendering', 'shader'],
      description:
        'A Filter must carry explicit style={{width:100%, height:100%}}; omitting this crashes the host at load with no log.',
      evidence: ['cart obeys the hard rule per memory feedback_filter_needs_size'],
      fix: 'Always set style width/height 100% on Filter.',
      severity: 'high',
    },
    {
      name: 'Inline data array forces per-frame rebake',
      purpose: ['texture_bake', 'shader'],
      description:
        'data={[tick * 0.05]} is an inline array with fresh identity every render — the static_surface_inline_props_rebake hazard. Intentional here (the shader must re-bake each frame to animate), but copying this line into a static capture context causes a 40ms+ per-frame rebake bug.',
      evidence: ['billboard_demo.md Quirks: inline data array; memory static_surface_inline_props_rebake'],
      fix: 'In static capture contexts, memo the capture and useMemo the data/style identities.',
      severity: 'medium',
    },
    {
      name: 'Live StaticSurface content re-captures every frame',
      purpose: ['texture_bake', 'rendering'],
      description:
        'The frame {tick} text updates live on the mesh because the StaticSurface re-captures when its content dirties — the documented live-content-forces-per-frame-re-render cost. This is the rebake cost class behind hmsc paint-spike hunts; fine for two 512x256 surfaces, not for big trees.',
      evidence: ['billboard_demo.md Quirks: live content forces per-frame re-render of the capture'],
      severity: 'low',
    },
    {
      name: 'Whole-cart re-render every frame',
      purpose: ['game_loop'],
      description:
        'tick advancing every ~16ms re-renders the whole cart every frame. Acceptable for a tiny tree; the pattern does not scale to big trees without isolating the ticking state.',
      evidence: ['billboard_demo.md Quirks: tick advancing re-renders the whole cart'],
      fix: 'Isolate the ticking state in larger trees.',
      severity: 'low',
    },
    {
      name: 'Unbounded geometry intern with varying params',
      purpose: ['geometry'],
      description:
        'Literal dimensions are fine for a fixed-size demo (two static param sets -> two intern entries), but for varying sizes use unit params + a scale transform or the intern cache grows unboundedly.',
      evidence: ['billboard_demo.md: memory geometry_intern_unbounded'],
      fix: 'Unit params + scale transform for size-varying meshes.',
      severity: 'medium',
    },
  ],
};
