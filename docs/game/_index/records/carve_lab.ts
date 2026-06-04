import type { DocIndex } from '../types';

export const carve_lab: DocIndex = {
  name: 'carve_lab',
  file: 'carve_lab.md',
  cart: 'cart/carve_lab.tsx',
  purpose: ['geometry', 'asset_pipeline', 'texture_bake', 'rendering', 'camera'],
  loc: 356,
  summary:
    'An interactive 3D lab for the Geometry.Carve generator: drop a (transparent PNG) image, ImageMagick turns it into an occupancy mask, and the silhouette inflates into a rounded textured 3D piece you can orbit and tune.',
  interfaces: [
    {
      name: 'carve_lab (cart component)',
      purpose: ['geometry', 'asset_pipeline', 'rendering'],
      kind: 'component',
      sourceFile: 'cart/carve_lab.tsx',
      description:
        'The entire single-file cart: state, ingestion pipeline, UI controls, 3D scene, and drag-to-orbit handlers. No cart.json manifest.',
      dependsOn: ['Geometry.Carve', 'OrbitCamera', 'useFileDrop', 'run', 'readFile', 'mkdir', 'parseTxt', 'StaticSurface'],
      status: 'lab',
    },
    {
      name: 'ingest',
      purpose: ['asset_pipeline', 'geometry'],
      kind: 'utility',
      sourceFile: 'cart/carve_lab.tsx',
      codeRef: 'cart/carve_lab.tsx:110',
      description:
        'The ingestion pipeline (lines 110–134): triggered by file drop or resolution change; runs imageToTexture (pad to 512² PNG32) and imageToGrid (txt: enumeration), parses to a PixelMatrix, updates srcPath/matrix/tex state. busyRef prevents concurrent ingests.',
      dependsOn: ['run', 'readFile', 'parseTxt'],
      consumes: ['__proc_spawn', '__proc_wait', '__fs_read'],
      status: 'lab',
    },
    {
      name: 'heartMask',
      purpose: ['geometry', 'math'],
      kind: 'utility',
      sourceFile: 'cart/carve_lab.tsx',
      codeRef: 'cart/carve_lab.tsx:68',
      description:
        'A math-generated occupancy grid using the implicit heart-curve equation; the default shape so the lab shows something before any file is dropped.',
      status: 'lab',
    },
    {
      name: 'Knob',
      purpose: ['ui'],
      kind: 'component',
      sourceFile: 'cart/carve_lab.tsx',
      codeRef: 'cart/carve_lab.tsx:83',
      description:
        'A reusable label/minus/value/plus row used for depth (0.05 step [0.05,2.0]), inflate (0.1 step [0,1]), and zoom (0.4 step [1.2,12]).',
      status: 'lab',
    },
    {
      name: 'Geometry.Carve',
      purpose: ['geometry', 'asset_pipeline'],
      kind: 'utility',
      sourceFile: 'runtime/geometries/Carve.ts',
      description:
        'The carved-piece generator (the "Teddy" cutout-inflate): chamfer distance transform → per-corner sqrt-profile rounded thickness → smooth normals → front(-Z)/back(+Z)/side-wall face emission. CarveParams = {mask,cols,rows,width,height,depth,inflate}. ~2 quads/solid cell; a 48² mask is ~10–25k verts.',
      consumers: ['cart/carve_lab.tsx'],
      status: 'lab',
    },
    {
      name: 'Geometry registry (index.ts)',
      purpose: ['geometry'],
      kind: 'registry',
      sourceFile: 'runtime/geometries/index.ts',
      description: 'Re-exports Geometry.Carve as a GeometryDef with id:"Carve".',
      status: 'live',
    },
    {
      name: 'intern.ts (geometry interning)',
      purpose: ['geometry', 'rendering'],
      kind: 'utility',
      sourceFile: 'runtime/geometries/intern.ts',
      description:
        'JS-side geometry interning: caches the carved mesh by stable (id, params) key so it is only rebuilt when params identity changes (useMemo keeps params stable).',
      status: 'live',
    },
    {
      name: 'OrbitCamera',
      purpose: ['camera'],
      kind: 'component',
      sourceFile: 'runtime/cameras/index.tsx',
      description:
        'A thin wrapper around CameraRig + the Orbit solver; CameraRig calls Orbit.solve({...ORBIT_DEFAULTS,...params}) → {pos: orbitalEye(target,yaw,pitch,dist/zoom), target, fov}, passed to <Scene3D.Camera>.',
      dependsOn: ['Orbit'],
      status: 'live',
    },
    {
      name: 'Orbit (rig)',
      purpose: ['camera', 'math'],
      kind: 'utility',
      sourceFile: 'runtime/cameras/rigs/orbit.ts',
      description: 'The Orbit rig definition: solve(params) → {pos,target,fov} using orbitalEye().',
      status: 'live',
    },
    {
      name: 'useFileDrop',
      purpose: ['input', 'asset_pipeline', 'host_bridge'],
      kind: 'hook',
      sourceFile: 'runtime/hooks/useFileDrop.ts',
      description:
        'Bridges framework/filedrop.zig to React; reads __filedropSeq and __filedropLastPath host fns to detect drag-and-drop events from the OS window manager.',
      consumes: ['__filedropSeq', '__filedropLastPath'],
      status: 'live',
    },
    {
      name: 'run (process)',
      purpose: ['asset_pipeline', 'host_bridge'],
      kind: 'utility',
      sourceFile: 'runtime/hooks/process.ts',
      description:
        'Spawns a process via __proc_spawn, collects stdout/stderr via __ffiEmit subscriptions, awaits proc:exit. Used to run ImageMagick magick for grid and texture generation.',
      consumes: ['__proc_spawn', '__proc_wait'],
      status: 'live',
    },
    {
      name: 'readFile / mkdir (fs)',
      purpose: ['asset_pipeline', 'host_bridge'],
      kind: 'utility',
      sourceFile: 'runtime/hooks/fs.ts',
      description:
        'Synchronous file system wrappers backed by __fs_read / __fs_mkdir; reads the ImageMagick txt: output back into JS and creates the /tmp/_reactjit_carve scratch dir.',
      consumes: ['__fs_read', '__fs_mkdir'],
      status: 'live',
    },
    {
      name: 'parseTxt',
      purpose: ['asset_pipeline', 'format'],
      kind: 'utility',
      sourceFile: 'cart/pixel_icons/matrix.ts',
      description:
        'Shared parser: converts ImageMagick txt: enumeration output (X,Y:(R,G,B,A) #RRGGBBAA) into a palette-indexed PixelMatrix; pixels with alpha < 16 become null (carved away).',
      consumers: ['cart/carve_lab.tsx'],
      status: 'live',
    },
    {
      name: 'PixelMatrix',
      purpose: ['format', 'asset_pipeline'],
      kind: 'data_model',
      sourceFile: 'cart/pixel_icons/PixelIcon.tsx',
      description:
        'Palette-indexed grid type {size, palette: string[], pixels: Array<number|null>} (null = transparent) plus the colorAt() helper.',
      status: 'live',
    },
    {
      name: 'StaticSurface',
      purpose: ['texture_bake', 'rendering'],
      kind: 'component',
      sourceFile: 'runtime/primitives.tsx',
      description:
        'A render-to-texture primitive: its children (here an <Image src={texPath}>) are painted into an offscreen GPU texture keyed by staticKey, positioned at left:-99999 so it is not visible in the 2D UI.',
      status: 'live',
    },
    {
      name: 'ffi (callHost / subscribe)',
      purpose: ['host_bridge'],
      kind: 'utility',
      sourceFile: 'runtime/ffi.ts',
      description:
        'The underlying FFI bridge; callHost/callHostJson/subscribe are used by hooks to talk to Zig-registered host functions. All host access in this cart routes through it.',
      status: 'live',
    },
    {
      name: 'framework/gpu/3d.zig (textureKey sampling)',
      purpose: ['rendering', 'texture_bake'],
      kind: 'module',
      sourceFile: 'framework/gpu/3d.zig',
      codeRef: 'framework/gpu/3d.zig:1382',
      description:
        'Host 3D renderer: on Scene3D.Mesh with scene3d_tex_key, looks up the StaticSurface bind_group_3d (images.staticSurfaceBindGroup3D) so the mesh fragment shader samples that texture.',
      status: 'live',
    },
    {
      name: 'renderStaticSurfaceCaptures',
      purpose: ['texture_bake', 'rendering'],
      kind: 'utility',
      sourceFile: 'framework/engine.zig',
      description:
        'Paint engine: renders StaticSurface children into offscreen textures before the main frame; flushPending() (which draws 3D) runs after it but before the 2D pass so the mesh reads this frame’s captured content (fixes one-frame-stale).',
      status: 'live',
    },
    {
      name: 'filedrop.zig',
      purpose: ['input', 'host_bridge', 'asset_pipeline'],
      kind: 'module',
      sourceFile: 'framework/filedrop.zig',
      description: 'Host file-drop handler: sets lastPath + increments seq, then calls markDirty() to wake React.',
      emits: ['__filedropSeq', '__filedropLastPath'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'image → mask → 3D inflate (Teddy carve pipeline)',
      purpose: ['asset_pipeline', 'geometry'],
      description:
        'Drop image → ImageMagick occupancy mask → Geometry.Carve inflates the silhouette into a rounded piece, source image textured on front/back faces. The image→3D asset lane.',
      examples: ['carve_lab'],
      status: 'recurring',
    },
    {
      name: 'StaticSurface render-to-texture for a 3D mesh face',
      purpose: ['texture_bake', 'rendering'],
      description:
        'An offscreen <StaticSurface staticKey> (positioned at left:-99999) whose painted content is sampled by a Scene3D.Mesh via matching textureKey. Frame-ordering guarantee: captures render before the 3D flush so the mesh reads this frame’s content.',
      examples: ['carve_lab', 'hmsc_scale_lab', 'billboard_demo'],
      status: 'recurring',
    },
    {
      name: 'stamp-unique staticKey (Date.now())',
      purpose: ['texture_bake', 'asset_pipeline'],
      description:
        'A staticKey incorporating Date.now() so it can never collide with a stale bake from a previous hot reload — the host’s StaticSurface cache outlives reloads.',
      examples: ['carve_lab'],
      status: 'recurring',
    },
    {
      name: 'orbit camera via OrbitCamera + same-node drag',
      purpose: ['camera', 'input'],
      description:
        'OrbitCamera solves yaw/pitch/dist cart-side; drag handlers (onMouseDown/Move/Up on the outer Pressable) accumulate yaw and clamp pitch; camera updates via React state, no rAF.',
      examples: ['carve_lab', 'hmsc_scale_lab', 'head_lab'],
      promoteTo: 'OrbitCamera',
      status: 'resolved',
    },
    {
      name: 'geometry interning with stable useMemo params',
      purpose: ['geometry', 'rendering'],
      description:
        'useMemo keeps the params object identity stable; intern.ts caches the generated mesh so it only rebuilds when params actually change. The carve mask only regenerates on mask/knob change.',
      examples: ['carve_lab'],
      status: 'recurring',
    },
    {
      name: 'host subprocess via run() + FFI events',
      purpose: ['asset_pipeline', 'host_bridge'],
      description:
        'run("magick", [...]) spawns via __proc_spawn, collects output via __ffiEmit subscriptions, awaits exit — the subprocess shell-out lane.',
      examples: ['carve_lab'],
      status: 'recurring',
    },
    {
      name: 'thin-slab ground plane (avoid back-face culling)',
      purpose: ['rendering'],
      description:
        'A very wide very thin Geometry.Box (7×0.03×7 at y=−0.015) used as the ground instead of a true plane, the same trick as skybox_demo to dodge back-face culling.',
      examples: ['carve_lab', 'skybox_demo'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'stale StaticSurface bake without stamp-unique key',
      purpose: ['texture_bake', 'maintenance'],
      description:
        'The host’s StaticSurface cache outlives hot reloads; without a fresh Date.now()-stamped staticKey the mesh would sample a stale or wrong image. The cart deliberately stamps texPath/texKey to dodge this.',
      evidence: ['cart/carve_lab.tsx:106 (stamp-unique keys note)'],
      fix: 'Always incorporate Date.now() (or another fresh nonce) into the staticKey.',
      severity: 'medium',
    },
    {
      name: 'one-frame-stale 3D texture (frame ordering)',
      purpose: ['texture_bake', 'rendering'],
      description:
        'A mesh sampling a StaticSurface via textureKey would read last frame’s content unless captures render before the 3D flush; flushPending() runs after renderStaticSurfaceCaptures() but before the 2D pass to guarantee this-frame content.',
      evidence: ['framework/gpu/3d.zig:1382–1383', 'framework/engine.zig renderStaticSurfaceCaptures()'],
      severity: 'low',
    },
    {
      name: 'concurrent-ingest race (busyRef guard)',
      purpose: ['asset_pipeline'],
      description:
        'Rapid drops or knob spam can fire overlapping ingests; busyRef guards against concurrent ImageMagick runs corrupting state.',
      evidence: ['cart/carve_lab.tsx:104 (busy flag)'],
      severity: 'low',
    },
    {
      name: 'mesh cost scales with mask resolution',
      purpose: ['geometry', 'rendering'],
      description:
        'Carve emits ~2 quads per solid cell + boundary walls; a 48×48 mask is ~10–25k vertices, so high resolutions on dense silhouettes get expensive.',
      evidence: ['runtime/geometries/Carve.ts (mesh cost note, doc line 172)'],
      severity: 'low',
    },
    {
      name: 'ImageMagick (magick) is an external runtime dependency',
      purpose: ['asset_pipeline', 'maintenance'],
      description:
        'Both the texture and grid steps shell out to the system magick binary; the cart silently depends on ImageMagick being installed on the host.',
      evidence: ['cart/carve_lab.tsx ingest (lines 110–134); magick -resize ... PNG32/txt:'],
      severity: 'medium',
    },
  ],
};
