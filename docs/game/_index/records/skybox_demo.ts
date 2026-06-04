import type { DocIndex } from '../types';

export const skybox_demo: DocIndex = {
  name: 'skybox_demo',
  file: 'skybox_demo.md',
  cart: 'cart/skybox_demo.tsx',
  purpose: ['rendering', 'shader', 'world_gen', 'animation', 'ui'],
  loc: 0,
  summary:
    'A live demonstration of the analytic procedural skybox system (<Scene3D.Skybox>): a 3D scene with a day/night cycle, weather transitions, and per-zone mood, all driven by uniforms that lerp every frame; the sky is one fullscreen shader pass (gradient, sun, haze, drifting 2-D clouds, stars) and meshes melt into the horizon via automatic aerial-perspective fog.',
  interfaces: [
    {
      name: 'buildSky',
      purpose: ['shader', 'world_gen', 'color'],
      kind: 'utility',
      sourceFile: 'cart/skybox_demo.tsx',
      codeRef: 'cart/skybox_demo.tsx:86-140',
      description:
        'Main sky builder. Returns a Sky object (zenith/horizon/ground/sunDir/sunColor/sunSize/sunGlow/haze/cloud/night/ambient/lightColor/lightI) from (hour, weather, gloom): base day state from dayKey+sunDirFor, then weather grey-blend and gloom grey-green pall. Called every render.',
      dependsOn: ['dayKey', 'sunDirFor'],
      status: 'lab',
    },
    {
      name: 'dayKey',
      purpose: ['color', 'world_gen'],
      kind: 'utility',
      sourceFile: 'cart/skybox_demo.tsx',
      codeRef: 'cart/skybox_demo.tsx:66-77',
      description: 'Finds the two surrounding KEYS keyframes, computes normalized t, returns lerped zenith/horizon/sun colors.',
      dependsOn: ['KEYS'],
      status: 'lab',
    },
    {
      name: 'sunDirFor',
      purpose: ['math', 'world_gen'],
      kind: 'utility',
      sourceFile: 'cart/skybox_demo.tsx',
      codeRef: 'cart/skybox_demo.tsx:79-83',
      description: 'Maps hour to a sun arc (rises ~06:00 east, peaks noon +y, sets ~18:00 west); returns [cos(a), sin(a), 0.22] where a = ((hour-6)/12)*pi.',
      status: 'lab',
    },
    {
      name: 'KEYS',
      purpose: ['color', 'world_gen'],
      kind: 'data_model',
      sourceFile: 'cart/skybox_demo.tsx',
      codeRef: 'cart/skybox_demo.tsx:55-64',
      description: 'Eight day keyframes spanning hours 0-24 with zenith, horizon, and sun hex colors.',
      status: 'lab',
    },
    {
      name: 'color helpers',
      purpose: ['color', 'math'],
      kind: 'utility',
      sourceFile: 'cart/skybox_demo.tsx',
      codeRef: 'cart/skybox_demo.tsx:27-44',
      description: 'Pure JS color/math: hexToRgb, rgbToHex, lerp, mixHex, clamp01, smooth (smoothstep). No framework dependency.',
      status: 'lab',
    },
    {
      name: 'Scene3D.Skybox',
      purpose: ['rendering', 'shader'],
      kind: 'component',
      sourceFile: 'runtime/primitives.tsx',
      codeRef: 'runtime/primitives.tsx:478-492',
      description:
        'Converts string/numeric sky props (zenith/horizon/ground/sunDir/sunColor/sunSize/sunGlow/haze/cloud/night) into host node props (scene3dSky*), emitting a View node with scene3dSkybox: true. Hex strings convert to RGB arrays.',
      consumers: ['cart/skybox_demo'],
      status: 'live',
    },
    {
      name: 'drawSky',
      purpose: ['rendering', 'shader'],
      kind: 'host_fn',
      sourceFile: 'framework/gpu/3d.zig',
      codeRef: 'framework/gpu/3d.zig:1082-1112',
      description:
        'Host fullscreen-triangle sky pass: computes inv(vp) from the camera VP, wraps the system clock to a 0-1,000,000 ms cloud-drift window, writes the SkyUniforms struct (std140, 160 bytes), draws one fullscreen triangle (3 verts, no vertex buffer) with depth-test=always and depth-write=off.',
      dependsOn: ['SkyUniforms', 'skybox_wgsl'],
      status: 'live',
    },
    {
      name: 'SkyUniforms',
      purpose: ['shader', 'rendering'],
      kind: 'data_model',
      sourceFile: 'framework/gpu/3d.zig',
      description:
        'std140-layout struct (160 bytes) passed to the sky shader each frame: inv_vp, cam_pos, time, sun_dir, sun_size, zenith, haze, horizon, cloud, ground, sun_glow, sun_color, night.',
      status: 'live',
    },
    {
      name: 'skybox_wgsl',
      purpose: ['shader', 'rendering'],
      kind: 'shader',
      sourceFile: 'framework/gpu/shaders.zig',
      description:
        'Analytic sky shader: reconstructs the world-space view ray from inv_vp + pixel pos, paints a ground->horizon->zenith gradient, a crisp sun disk plus wide power-law glow along sunDir, horizon haze, 2-D fbm value-noise clouds drifting by time, and hashed star points fading in as night rises. Also (in shaders.zig) the mesh fragment shader samples the sky gradient for aerial-perspective fog.',
      status: 'live',
    },
    {
      name: 'drawScene',
      purpose: ['rendering'],
      kind: 'host_fn',
      sourceFile: 'framework/gpu/3d.zig',
      codeRef: 'framework/gpu/3d.zig:1238-1254',
      description:
        'Host 3D renderer: walks Scene3D children for skybox/camera/light/fog nodes, builds view+projection matrices, calls drawSky, uploads scene uniforms (fog planes, camera pos, sky colors for aerial perspective), draws all meshes with the same lighting and fog. With a skybox present and no explicit camera far, auto-derives fog: fog_near=max(6.0, extent*0.8), fog_far=max(near+12.0, extent*1.1), and sets fog_color to the skybox horizon with aerial perspective.',
      dependsOn: ['drawSky'],
      status: 'live',
    },
    {
      name: 'animation loop',
      purpose: ['animation', 'game_loop'],
      kind: 'utility',
      sourceFile: 'cart/skybox_demo.tsx',
      codeRef: 'cart/skybox_demo.tsx:175-187',
      description:
        'Self-scheduling JS loop via globalThis.requestAnimationFrame (V8 path) or setTimeout(fn,16) fallback; increments hour by 0.03/frame wrapping at 24 (~1.8 game-hours/sec). playRef mirrors playing to avoid stale closure. No __jsTick.',
      status: 'lab',
    },
    {
      name: 'Btn',
      purpose: ['ui'],
      kind: 'component',
      sourceFile: 'cart/skybox_demo.tsx',
      codeRef: 'cart/skybox_demo.tsx:153-165',
      description: 'Small Pressable wrapping a Box with conditional backgroundColor/borderColor based on active prop.',
      status: 'lab',
    },
    {
      name: 'Geometry registry',
      purpose: ['geometry', 'rendering'],
      kind: 'registry',
      sourceFile: 'runtime/geometries/index.ts',
      description:
        'Built-in shape defs imported as namespace Geometry (Box id "Box", Sphere id "Sphere", Cylinder id "Cylinder"), each with id/defaults/generate(). intern.ts caches vertex arrays by stable key to dedup bridge shipment.',
      dependsOn: ['intern'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'Derived sky state from a few scalars',
      purpose: ['world_gen', 'shader', 'color'],
      description:
        'hour is the single source of truth; weather and gloom are overlay blends; all sky values (colors, sun dir, light intensity, haze, cloud) are pure functions of those three numbers, computed every render and shipped as uniforms.',
      examples: ['skybox_demo'],
      status: 'recurring',
    },
    {
      name: 'Light sync',
      purpose: ['rendering', 'shader'],
      description:
        'The same computed sunDir/lightColor/lightI feed both the skybox shader and the DirectionalLight (AmbientLight uses the sky horizon color) so world lighting always agrees with the sky.',
      examples: ['skybox_demo'],
      status: 'recurring',
    },
    {
      name: 'rAF-or-setTimeout self-scheduling loop with ref mirror',
      purpose: ['animation', 'game_loop'],
      description:
        'sched = globalThis.requestAnimationFrame ?? setTimeout(fn,16); a ref mirrors the play flag so the loop reads the latest value without closing over stale state.',
      examples: ['skybox_demo'],
      promoteTo: 'useGameLoop',
      status: 'promote',
    },
    {
      name: 'Ground plane trick (thin Box not Plane)',
      purpose: ['rendering', 'geometry'],
      description:
        'Use a very wide, very thin Box (height 0.2) for ground instead of a Plane geometry, because a plane back-face-culls when viewed from above.',
      examples: ['skybox_demo'],
      status: 'recurring',
    },
    {
      name: 'Static geometry hits the intern cache',
      purpose: ['geometry', 'rendering'],
      description:
        'Meshes with static geometry+params do not re-ship vertices each frame; they hit the JS intern cache and only emit scene3dGeomKey + transform props per frame even while the cart re-renders every frame.',
      examples: ['skybox_demo'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'Plane geometry back-face-culls from above (black ground)',
      purpose: ['rendering', 'geometry'],
      description:
        'A true Plane geometry is single-sided and culls when viewed from above; the cart uses a thin Box slab as ground for this reason.',
      evidence: ['skybox_demo.md — "a thin slab rather than a plane because a true plane back-face-culls when viewed from above"; cart/skybox_demo.tsx ground Box height 0.2'],
      fix: 'Use a thin Box for floors/ground instead of Geometry.Plane.',
      severity: 'high',
    },
    {
      name: 'Sky props cross the bridge every frame',
      purpose: ['rendering', 'host_bridge'],
      description:
        'Skybox/AmbientLight/DirectionalLight prop values are new arrays/numbers each frame (hour changes), so they diff as changed and cross the V8/Zig bridge every tick — expected here but a cost to be aware of.',
      evidence: ['skybox_demo.md — reconciler diffs new arrays/numbers each frame, cross the bridge every tick'],
      severity: 'low',
    },
    {
      name: 'Auto fog only kicks in without explicit far / with a skybox',
      purpose: ['rendering'],
      description:
        'Fog planes are auto-derived from scene extent only because no explicit camera far is set and a skybox is present; setting an explicit far or omitting the skybox changes fog behavior. Aerial-perspective fog (fade toward sky gradient) is enabled automatically by the skybox, not declared.',
      evidence: ['framework/gpu/3d.zig:1238-1254 — fog_near=max(6.0, extent*0.8), fog_far=max(near+12.0, extent*1.1); auto only when no far and skybox present'],
      severity: 'medium',
    },
    {
      name: 'Cloud-drift time wraps at 1,000,000 ms',
      purpose: ['shader'],
      description: 'drawSky wraps the system clock to a 0-1,000,000 ms window for cloud drift; long-running sessions see a periodic wrap rather than monotonic time.',
      evidence: ['framework/gpu/3d.zig:1082-1112 — wraps clock to 0-1,000,000 ms window'],
      severity: 'low',
    },
  ],
};
