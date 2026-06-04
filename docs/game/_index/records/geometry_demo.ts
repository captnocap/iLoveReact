import type { DocIndex } from '../types';

export const geometry_demo: DocIndex = {
  name: 'geometry_demo',
  file: 'geometry_demo.md',
  cart: 'cart/geometry_demo.tsx',
  purpose: ['geometry', 'rendering'],
  summary:
    'A demonstration / test-bed for the @reactjit/geometries subsystem that renders four 3D shapes in a Scene3D viewport (three hand-authored procedural shapes plus one runtime-generated random blob), exercising the full pipeline from pure-JS geometry generators to interned vertex buffers to host GPU mesh rendering.',
  interfaces: [
    {
      name: 'Pyramid',
      purpose: ['geometry'],
      kind: 'data_model',
      sourceFile: 'cart/geometry_demo.tsx',
      codeRef: 'cart/geometry_demo.tsx:33-93',
      description:
        'Hand-authored GeometryDef-like object id demo:pyramid, defaults { size: 1.4, height: 1.8 }: a square pyramid (four triangular side faces + four base wedges) wound CCW around +Y so normals face outward. Flat-shaded via triFlat.',
      dependsOn: ['mesh()', 'flat'],
      status: 'lab',
    },
    {
      name: 'Octahedron',
      purpose: ['geometry'],
      kind: 'data_model',
      sourceFile: 'cart/geometry_demo.tsx',
      codeRef: 'cart/geometry_demo.tsx:33-93',
      description:
        'Hand-authored GeometryDef id demo:octahedron, defaults { radius: 1.0 }: a diamond of two 4-sided cones sharing an equator, 8 faces. Flat-shaded.',
      dependsOn: ['mesh()', 'flat'],
      status: 'lab',
    },
    {
      name: 'Prism',
      purpose: ['geometry'],
      kind: 'data_model',
      sourceFile: 'cart/geometry_demo.tsx',
      codeRef: 'cart/geometry_demo.tsx:33-93',
      description:
        'Hand-authored GeometryDef id demo:prism, defaults { radius: 0.9, length: 1.8 }: a triangular prism (two end-cap triangles + three rectangular side faces). Sides use g.face() (BL,BR,TR,TL winding with flipped V so textures stay upright).',
      dependsOn: ['mesh()', 'flat'],
      status: 'lab',
    },
    {
      name: 'RandomBlob',
      purpose: ['geometry'],
      kind: 'data_model',
      sourceFile: 'cart/geometry_demo.tsx',
      codeRef: 'cart/geometry_demo.tsx:108-149',
      description:
        'A UV-sphere whose radius is displaced by a seeded sum-of-waves so every seed yields a different lumpy creature. On generate(): seeds the LCG, builds lumps (default 5) wave descriptors, sums sin(fx*nx+fy*ny+fz*nz+phase), iterates rings x segments emitting two smooth-shaded triangles per quad via g.tri(). Winding (a,c,d) then (a,b,c) to avoid back-faces when a is the top corner.',
      dependsOn: ['mesh()', 'rng'],
      status: 'lab',
    },
    {
      name: 'faceNormal',
      purpose: ['geometry', 'math'],
      kind: 'utility',
      sourceFile: 'cart/geometry_demo.tsx',
      codeRef: 'cart/geometry_demo.tsx:17-25',
      description:
        'faceNormal(a, b, c): computes the outward face normal of a triangle via cross product of its edge vectors, then normalizes. Pure math, no framework dependency.',
      status: 'lab',
    },
    {
      name: 'flat',
      purpose: ['geometry'],
      kind: 'utility',
      sourceFile: 'cart/geometry_demo.tsx',
      codeRef: 'cart/geometry_demo.tsx:17-25',
      description:
        'flat(g, a, b, c): convenience wrapper calling g.triFlat(a, b, c, faceNormal(a, b, c)) to emit a flat-shaded triangle with correct outward normals. Used by all three hand-authored shapes.',
      dependsOn: ['faceNormal'],
      status: 'lab',
    },
    {
      name: 'rng',
      purpose: ['geometry', 'math'],
      kind: 'utility',
      sourceFile: 'cart/geometry_demo.tsx',
      codeRef: 'cart/geometry_demo.tsx:100-106',
      description:
        'rng(seed): a linear congruential generator using Math.imul; returns a function yielding numbers in [0,1). Pure JS; does NOT use __crypto_random_bytes. Drives RandomBlob deterministic pseudo-randomness.',
      status: 'lab',
    },
    {
      name: 'mesh',
      purpose: ['geometry'],
      kind: 'utility',
      sourceFile: 'runtime/geometries/_util.ts',
      description:
        'The vertex-assembly builder from @reactjit/geometries: provides tri(), triFlat(), face(), build(). build() returns GeometryData { positions interleaved [px,py,pz,nx,ny,nz,u,v] x count, count, bounds:{radius} }.',
      consumers: ['cart/geometry_demo.tsx'],
      status: 'live',
    },
    {
      name: 'normalize',
      purpose: ['geometry', 'math'],
      kind: 'utility',
      sourceFile: 'runtime/geometries/_util.ts',
      description: 'Vector normalize helper re-exported from @reactjit/geometries.',
      consumers: ['cart/geometry_demo.tsx'],
      status: 'live',
    },
    {
      name: 'GeometryData',
      purpose: ['geometry'],
      kind: 'data_model',
      sourceFile: 'runtime/geometries/_util.ts',
      description:
        'The product of mesh().build(): a Float32Array of interleaved position/normal/UV floats, a vertex count, and a bounding radius.',
      consumers: ['cart/geometry_demo.tsx'],
      status: 'live',
    },
    {
      name: 'geometries registry (index.ts)',
      purpose: ['geometry'],
      kind: 'registry',
      sourceFile: 'runtime/geometries/index.ts',
      description:
        'The geometry registry; re-exports mesh, normalize, GeometryData, Vec3 from _util.ts and exports the GeometryDef type the cart shape objects conform to. Not directly imported by this cart for built-in shapes (the cart hand-rolls everything).',
      status: 'live',
    },
    {
      name: 'internGeometry',
      purpose: ['geometry', 'rendering'],
      kind: 'utility',
      sourceFile: 'runtime/geometries/intern.ts',
      description:
        'JS-side geometry interning: computes a stable key id + "|" + stableStringify(mergedParams), caches the generated vertex array, and deduplicates bridge shipment so identical meshes ship vertices only once per key. hasShipped(key) gates whether the full vertex array is emitted.',
      consumers: ['runtime/primitives.tsx'],
      status: 'live',
    },
    {
      name: 'Scene3D.Mesh',
      purpose: ['geometry', 'rendering', 'host_bridge'],
      kind: 'component',
      sourceFile: 'runtime/primitives.tsx',
      codeRef: 'runtime/primitives.tsx:535-708',
      description:
        'Bridges a GeometryDef into the Zig GPU renderer. Checks isGeometryDef, calls internGeometry(geometry, params); first ship emits scene3dGeomKey + scene3dVertices + scene3dVertCount + scene3dBoundsRadius, subsequent renders emit only key + bounds. Also carries scene3dPos/Rot/Scale and scene3dColorR/G/B/A (from material hex via _hexToRgb).',
      dependsOn: ['internGeometry', '3d.zig'],
      consumers: ['cart/geometry_demo.tsx'],
      status: 'live',
    },
    {
      name: 'Scene3D',
      purpose: ['rendering'],
      kind: 'component',
      sourceFile: 'runtime/primitives.tsx',
      description:
        'The 3D scene viewport with sub-components Scene3D.Camera, Scene3D.AmbientLight, Scene3D.DirectionalLight. Perspective camera, ambient + two directional lights. No Fog, Skybox, or OrbitControls in this cart.',
      consumers: ['cart/geometry_demo.tsx'],
      status: 'live',
    },
    {
      name: '3d.zig',
      purpose: ['rendering', 'host_bridge', 'geometry'],
      kind: 'module',
      sourceFile: 'framework/gpu/3d.zig',
      description:
        'The Zig GPU runtime that reads the shipped vertex array (keyed), uploads it to GPU, and draws it every frame.',
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'GeometryDef as inline pure-JS generator',
      purpose: ['geometry'],
      description:
        'A shape is an object { id, defaults, generate(params) } that builds GeometryData from params via the mesh() builder. The cart defines four inline; the same shape is the framework geometry contract.',
      examples: ['geometry_demo'],
      status: 'recurring',
    },
    {
      name: 'intern-by-(id,params) then ship-once',
      purpose: ['geometry', 'rendering'],
      description:
        'internGeometry caches by stable (id, params) key; the same shape generates only once and ships vertices to the host only once per key. Changing a param (blob seed) mints a new key and ships a new buffer; the old JS key is not GC-d immediately but is harmless.',
      examples: ['geometry_demo'],
      status: 'recurring',
    },
    {
      name: 'flat shading (triFlat) vs smooth shading (tri)',
      purpose: ['geometry', 'rendering'],
      description:
        'triFlat() gives the whole triangle one normal (faceted look  Pyramid/Octahedron/Prism); tri() with per-corner normals + UVs gives smooth shading (RandomBlob UV-sphere).',
      examples: ['geometry_demo'],
      status: 'recurring',
    },
    {
      name: 'absolute overlay over the 3D viewport',
      purpose: ['ui', 'rendering'],
      description:
        'UI is layered on top of the 3D viewport using position:absolute inside the same parent Box, because there is no DOM z-index. Title block, label row, regenerate button.',
      examples: ['geometry_demo'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'doc-comment drift: "spinning slowly on Y" but rotation is static',
      purpose: ['rendering'],
      description:
        'Each hand mesh has rotation={[0, 35, 0]}, a fixed 35-degree Y pose. The cart comment says "spinning slowly on Y" but the code does not animate rotation  there is no game loop / useFrame / useEffect.',
      evidence: ['geometry_demo.md:133'],
      severity: 'medium',
    },
    {
      name: 'RandomBlob mints a fresh vertex buffer per seed change',
      purpose: ['geometry', 'rendering'],
      description:
        'Changing seed changes params, so internKey produces a new key and a brand-new vertex buffer is shipped each press. The old key is not garbage-collected from the JS cache immediately (harmless here, but the general intern-cache OOM rule applies to per-frame-varying params).',
      evidence: ['geometry_demo.md:172'],
      severity: 'low',
    },
    {
      name: 'blob winding must be (a,c,d)+(a,b,c) not the naive order',
      purpose: ['geometry'],
      description:
        'The explicit winding (a,c,d) then (a,b,c) differs from the naive (a,d,c)+(a,c,b) because the naive ordering is back-facing when a is the top corner.',
      evidence: ['geometry_demo.md:77'],
      severity: 'low',
    },
  ],
};
