import type { DocIndex } from '../types';

export const hmsc_massive_map_lab: DocIndex = {
  name: 'hmsc_massive_map_lab',
  file: 'hmsc_massive_map_lab.md',
  cart: 'cart/hmsc_massive_map_lab.tsx',
  purpose: ['rendering', 'world_gen', 'telemetry', 'camera', 'debug'],
  loc: 780,
  summary:
    'A perf-measurement lab that answers whether a Miami-scale procedural city (12.8 km x 8 km, 4,000 chunks) can render in one Scene3D by streaming a radius of deterministic hash-generated chunks around a movable focus and drawing the entire visible city as ONE Scene3D.Instances batch, with a dense diagnostics panel reading host telemetry.',
  interfaces: [
    {
      name: 'hash2',
      purpose: ['world_gen', 'math'],
      kind: 'utility',
      sourceFile: 'cart/hmsc_massive_map_lab.tsx',
      description:
        'Integer-mixing hash (Math.imul / xor-shift, plain JS) backing the deterministic world; pan away and back and identical buildings reappear.',
      status: 'lab',
    },
    {
      name: 'randRange',
      purpose: ['world_gen', 'math'],
      kind: 'utility',
      sourceFile: 'cart/hmsc_massive_map_lab.tsx',
      description: 'randRange(cx, cz, salt, min, max) gives each chunk reproducible randomness derived from hash2.',
      dependsOn: ['hash2'],
      status: 'lab',
    },
    {
      name: 'chunkKind',
      purpose: ['world_gen'],
      kind: 'utility',
      sourceFile: 'cart/hmsc_massive_map_lab.tsx',
      description:
        'Analytic zoning: east third = water; a 900 m disc near (18%,-4%) = downtown; central cross bands = urban; far west/south = industrial; rest = suburb. Kind drives building count/height/palette and ground color.',
      status: 'lab',
    },
    {
      name: 'generateBuildings',
      purpose: ['world_gen', 'building'],
      kind: 'utility',
      sourceFile: 'cart/hmsc_massive_map_lab.tsx',
      description:
        'Splits each chunk into 2x2 blocks; per block up to N lots (downtown 7 / suburb 4 / industrial 3, scaled by density 0.2-1.0); a hash gate skips lots probabilistically; position/footprint/height all randRange-derived (downtown to 155 m, suburbs 4-14 m).',
      dependsOn: ['randRange', 'chunkKind'],
      status: 'lab',
    },
    {
      name: 'visibleChunks',
      purpose: ['world_gen', 'rendering'],
      kind: 'utility',
      sourceFile: 'cart/hmsc_massive_map_lab.tsx',
      description:
        'Regenerates the square of chunks of chunkRadius (1-8, default 3 -> 7x7=49) around the camera focus on every focus/radius/density change, clipped to map bounds. Wrapped in useMemo keyed on [targetX,targetZ,chunkRadius,density]; self-timed (chunkBuild.ms). No cache, no incremental diffing.',
      dependsOn: ['generateBuildings'],
      status: 'lab',
    },
    {
      name: 'buildCityBatch',
      purpose: ['rendering', 'geometry'],
      kind: 'utility',
      sourceFile: 'cart/hmsc_massive_map_lab.tsx',
      description:
        'Flattens the entire visible city (ground slab, 2 sidewalk strips, road+avenue+center-line skipped on water, every building) into one flat number[] with stride 9: x,y,z,sx,sy,sz,r,g,b via pushBoxInstance; feeds a single Scene3D.Instances with the unit box.',
      dependsOn: ['visibleChunks', 'pushBoxInstance', 'rgb01'],
      emits: ['scene3dInstanceData'],
      status: 'lab',
    },
    {
      name: 'pushBoxInstance',
      purpose: ['rendering', 'geometry'],
      kind: 'utility',
      sourceFile: 'cart/hmsc_massive_map_lab.tsx',
      description: 'Appends one box (x,y,z,sx,sy,sz,r,g,b) to the stride-9 instance stream.',
      status: 'lab',
    },
    {
      name: 'rgb01',
      purpose: ['color'],
      kind: 'utility',
      sourceFile: 'cart/hmsc_massive_map_lab.tsx',
      description: 'Converts hex colors to 0-1 float triples for the instance color channels.',
      status: 'lab',
    },
    {
      name: 'Scene3D.Instances',
      purpose: ['rendering', 'geometry', 'host_bridge'],
      kind: 'component',
      sourceFile: 'runtime/primitives.tsx',
      codeRef: 'runtime/primitives.tsx:709',
      description:
        'Scene3DBase.Instances interns the unit box once and ships scene3dInstanceData/Count/Stride host props; host framework/gpu/3d.zig reads scene3d_instance_stride (~line 1435) and issues ONE instanced draw call for the whole batch (~3,000+ boxes -> 1 draw).',
      consumes: ['scene3dInstanceData', 'scene3dInstanceCount', 'scene3dInstanceStride'],
      consumers: ['cart/hmsc_massive_map_lab.tsx'],
      status: 'live',
    },
    {
      name: 'ChunkGround',
      purpose: ['rendering', 'building'],
      kind: 'component',
      sourceFile: 'cart/hmsc_massive_map_lab.tsx',
      codeRef: 'cart/hmsc_massive_map_lab.tsx:317',
      description:
        'Fully-written per-chunk Scene3D.Mesh ground component, never rendered (grep confirms zero JSX usage). Abandoned mesh-per-box first draft superseded by buildCityBatch; survives as in-file documentation of the per-mesh vs instanced comparison.',
      status: 'deprecated',
    },
    {
      name: 'ChunkRoads',
      purpose: ['rendering', 'building'],
      kind: 'component',
      sourceFile: 'cart/hmsc_massive_map_lab.tsx',
      codeRef: 'cart/hmsc_massive_map_lab.tsx:346',
      description:
        'Per-chunk Scene3D.Mesh roads component, never rendered. Dead code superseded by buildCityBatch; duplicates its exact geometry recipe.',
      status: 'deprecated',
    },
    {
      name: 'BuildingMesh',
      purpose: ['rendering', 'building'],
      kind: 'component',
      sourceFile: 'cart/hmsc_massive_map_lab.tsx',
      codeRef: 'cart/hmsc_massive_map_lab.tsx:375',
      description:
        'Per-chunk Scene3D.Mesh building component, never rendered. Dead code superseded by buildCityBatch; duplicates the same offsets.',
      status: 'deprecated',
    },
    {
      name: 'CameraState',
      purpose: ['camera'],
      kind: 'data_model',
      sourceFile: 'cart/hmsc_massive_map_lab.tsx',
      description:
        'One state object holding BOTH rigs (mode gameplay|map): gameplay = third-person chase (eye 15 m behind focus at 4.4 m, look 44 m ahead, fov 62, drag mouselook); map = orbit (yaw/pitch/distance 320-4200 m, fov 48). No @reactjit/cameras rig used.',
      status: 'lab',
    },
    {
      name: 'cameraPosition / cameraTarget',
      purpose: ['camera', 'math'],
      kind: 'utility',
      sourceFile: 'cart/hmsc_massive_map_lab.tsx',
      description:
        'Pure-trig derivation of camera eye and look-at from CameraState; hand-rolled, no cameras registry. Consolidation candidate: gameplay ~ Follow, map ~ Orbit.',
      status: 'lab',
    },
    {
      name: 'updateCamera',
      purpose: ['camera', 'input'],
      kind: 'utility',
      sourceFile: 'cart/hmsc_massive_map_lab.tsx',
      description:
        'Writes camera changes to cameraRef first, then flushes to React state immediately (key/mode, immediate=true) or coalesces drags through a scheduled rAF-probe flush; subsequent drags within the window just mutate the ref and bump a coalesced counter. Collapses any number of mousemove events per frame to ONE setCameraState.',
      status: 'lab',
    },
    {
      name: 'decodeKey',
      purpose: ['input', 'host_bridge'],
      kind: 'utility',
      sourceFile: 'runtime/hooks/useIFTTT.ts',
      codeRef: 'runtime/hooks/useIFTTT.ts:352',
      description:
        'Unpacks a packed integer (key + modifiers) from the host __ifttt_onKeyDown global and re-emits on the JS event bus; busOn(\'__keydown\', ...) subscribes. WASD/arrows pan focus in 80 m steps (world axes), +/- zoom, 1/2 switch modes.',
      consumes: ['__keydown', '__ifttt_onKeyDown'],
      consumers: ['cart/hmsc_massive_map_lab.tsx'],
      status: 'live',
    },
    {
      name: 'useTelemetry',
      purpose: ['telemetry', 'host_bridge'],
      kind: 'hook',
      sourceFile: 'runtime/hooks/useTelemetry.ts',
      description:
        'Nine simultaneous subscriptions (heaviest user in the repo): scalars fps/layoutUs/paintUs/tickUs @ 250 ms, nodeCount @ 500 ms, JSON frame/gpu/nodes/input @ 500 ms. Each maps to a registered V8 host fn via callHost from runtime/ffi.ts, polled with setInterval. Importing it gates those bindings into the binary (metafile-gate).',
      consumes: [
        'getFps',
        'getLayoutUs',
        'getPaintUs',
        'getTickUs',
        '__tel_node_count',
        '__tel_frame',
        '__tel_gpu',
        '__tel_nodes',
        '__tel_input',
      ],
      consumers: ['cart/hmsc_massive_map_lab.tsx'],
      status: 'live',
    },
    {
      name: 'CameraDiagnostics',
      purpose: ['telemetry', 'camera', 'debug'],
      kind: 'data_model',
      sourceFile: 'cart/hmsc_massive_map_lab.tsx',
      description:
        'Self-counted camera-input metrics (updates/immediate/scheduled/coalesced/flushes, last flush delay ms, last drag deltas) displayed on the panel; the lab instruments its own input pipeline because camera-drag jank was a suspect.',
      status: 'lab',
    },
    {
      name: 'PlayerFigure',
      purpose: ['character', 'rendering'],
      kind: 'component',
      sourceFile: 'cart/hmsc-int/render3d/PlayerFigure.tsx',
      description:
        'The shared hmsc humanoid (skeleton/pose/palette in cart/hmsc-int/render3d/humanoid/), same model as the game and every NPC. Mounted with position=focus, yawDegrees, animationSeconds=Date.now()/1000, moving=false.',
      dependsOn: ['HumanoidFaceCaptures'],
      consumers: ['cart/hmsc_massive_map_lab.tsx', 'cart/hmsc'],
      status: 'live',
    },
    {
      name: 'HumanoidFaceCaptures',
      purpose: ['character', 'texture_bake', 'rendering'],
      kind: 'component',
      sourceFile: 'cart/hmsc-int/render3d/humanoid/face.tsx',
      codeRef: 'cart/hmsc-int/render3d/humanoid/face.tsx:218',
      description:
        'Offscreen StaticSurface that bakes the face textureKeys the figure head decal samples (StaticSurface->textureKey bridge). Any cart drawing PlayerFigure must mount this as a 2D sibling of the Scene3D.',
      emits: ['textureKey'],
      consumers: ['cart/hmsc_massive_map_lab.tsx'],
      status: 'live',
    },
    {
      name: 'HMSC_SCALE',
      purpose: ['math', 'world_gen'],
      kind: 'utility',
      sourceFile: 'cart/hmsc-int/world/scale.ts',
      description: 'Shared hmsc world scale constant imported by the lab (1 unit = 1 meter scale contract).',
      consumers: ['cart/hmsc_massive_map_lab.tsx'],
      status: 'live',
    },
    {
      name: 'set (clipboard)',
      purpose: ['host_bridge', 'debug'],
      kind: 'utility',
      sourceFile: 'runtime/hooks/clipboard.ts',
      description:
        'Calls host fn __clipboard_set; the copy diagnostics button serializes the full snapshot (world params, visible counts, chunk-build ms, camera state, all telemetry blobs, input diagnostics, capturedAt ISO timestamp) to the system clipboard as JSON — the lab output device.',
      consumes: ['__clipboard_set'],
      consumers: ['cart/hmsc_massive_map_lab.tsx'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'Hash-deterministic procedural world',
      purpose: ['world_gen', 'math'],
      description:
        'World = pure function of (coords, seed-salts) via Math.imul mix; no storage, regenerate on demand. The infinite-city-from-nothing shape.',
      examples: ['hmsc_massive_map_lab'],
      status: 'recurring',
    },
    {
      name: 'Chunk streaming around a focus',
      purpose: ['world_gen', 'rendering'],
      description:
        'Radius window over a chunk grid, regenerate on focus move, clip to map bounds, useMemo keyed on focus+knobs.',
      examples: ['hmsc_massive_map_lab'],
      status: 'recurring',
    },
    {
      name: 'One-batch instanced city',
      purpose: ['rendering', 'geometry'],
      description:
        'Flatten everything box-like into a stride-9 float stream on ONE unit-box Scene3D.Instances. The proven scale answer vs the dead per-mesh components. Sibling of world_as_shader_quad (2D) — the one-node-N-things move in 3D.',
      examples: ['hmsc_massive_map_lab'],
      status: 'recurring',
    },
    {
      name: 'Ref-buffer + coalesced-flush input',
      purpose: ['input', 'camera'],
      description:
        'High-frequency input mutates a ref; a scheduled once-per-frame flush commits to React state. THE pattern for drag/mouselook without re-render storms.',
      examples: ['hmsc_massive_map_lab'],
      promoteTo: 'useCoalescedInput',
      status: 'promote',
    },
    {
      name: 'rAF-probe / setTimeout-16',
      purpose: ['game_loop'],
      description:
        'rAF probe falls back to setTimeout(fn,16) on the V8 host which has no requestAnimationFrame. Universal across carts.',
      examples: ['hmsc_massive_map_lab', 'billboard_demo'],
      status: 'recurring',
    },
    {
      name: 'Self-instrumenting lab + clipboard export',
      purpose: ['telemetry', 'debug'],
      description:
        'Labs measure themselves (timed useMemo, input counters, dual fps sources) and ship a copy-JSON button as the human<->AI feedback channel.',
      examples: ['hmsc_massive_map_lab'],
      status: 'recurring',
    },
    {
      name: 'Dual-rig camera in one state object',
      purpose: ['camera'],
      description:
        'Gameplay chase + map orbit sharing a focus point, mode-switched. Pre-registry hand-rolled trig; convergence target = @reactjit/cameras Follow/Orbit.',
      examples: ['hmsc_massive_map_lab'],
      promoteTo: '@reactjit/cameras (Follow + Orbit)',
      status: 'resolved',
    },
    {
      name: 'Telemetry panel idiom',
      purpose: ['telemetry', 'ui'],
      description:
        'useTelemetry scalars at 250 ms + JSON at 500 ms + color-coded thresholds (green >=55, amber >=30, red below).',
      examples: ['hmsc_massive_map_lab', 'render_perf_lab'],
      status: 'recurring',
    },
    {
      name: 'Shared humanoid + face-capture contract',
      purpose: ['character', 'rendering'],
      description:
        'Any cart drawing PlayerFigure must mount HumanoidFaceCaptures next to its Scene3D. Cross-cart reuse of the game own model.',
      examples: ['hmsc_massive_map_lab'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'Full rebuild on every camera flush',
      purpose: ['rendering', 'world_gen', 'telemetry'],
      description:
        'Every camera flush rebuilds all visible chunks AND the full instance array from scratch (no cache, no diffing). At radius 8 (17x17=289 chunks) this is the knob that hurts. Measured-and-accepted brute force, watched by the chunk build ms stat.',
      evidence: ['hmsc_massive_map_lab.md quirks; visibleChunks useMemo keyed on focus+knobs'],
      severity: 'medium',
    },
    {
      name: 'Instance data re-shipped across bridge each flush',
      purpose: ['rendering', 'telemetry'],
      description:
        'The instance data array gets a fresh identity every rebuild, so the whole batch re-ships across the bridge each camera flush. This is the cost being measured (vs the baked-world direction), not a bug.',
      evidence: ['hmsc_massive_map_lab.md quirks; memory feedback_react_3d_is_authoring_not_runtime'],
      severity: 'low',
    },
    {
      name: 'Stale printed mesh caps',
      purpose: ['telemetry', 'rendering'],
      description:
        'The diagnostics hardcode meshCap 8192 and nodeIndexCap 4096, but framework/gpu/3d.zig:170-171 now says MAX_INSTANCES=65536, MAX_SCENE_MESHES=32768. The caps were raised after this lab was written; its printed ceilings are wrong (conservative).',
      evidence: ['framework/gpu/3d.zig:170-171', 'hmsc_massive_map_lab.md stale constants flag'],
      fix: 'Trust the host telemetry numbers, not the printed labels; update the hardcoded caps.',
      severity: 'high',
    },
    {
      name: 'Dead per-mesh trio duplicates the batch recipe',
      purpose: ['rendering', 'maintenance'],
      description:
        'ChunkGround/ChunkRoads/BuildingMesh are never rendered but encode the same geometry offsets as buildCityBatch (ground -0.04, sidewalks 0.015/0.017, road 0.045, avenue 0.047, center-line 0.071). Drift hazard if either side is edited alone.',
      evidence: ['cart/hmsc_massive_map_lab.tsx:317,346,375; grep confirms zero JSX usage'],
      fix: 'If touched again: delete or rewire behind a toggle; do not let the two recipes drift.',
      severity: 'medium',
    },
    {
      name: 'WASD pans in world axes, not camera-relative',
      purpose: ['input', 'camera'],
      description:
        'WASD/arrows pan the focus in world axes regardless of camera yaw — fine for a lab, wrong feel for gameplay.',
      evidence: ['hmsc_massive_map_lab.md input section'],
      severity: 'low',
    },
    {
      name: 'No collision — focus pans through buildings',
      purpose: ['physics', 'world_gen'],
      description:
        'The cart uses no physics; the focus pans straight through buildings. No __hmsc_* host physics, no road grammar / __path_*.',
      evidence: ['hmsc_massive_map_lab.md what this cart does NOT use section'],
      severity: 'low',
    },
  ],
};
