import type { DocIndex } from '../types';

export const voxel_stack_demo: DocIndex = {
  name: 'voxel_stack_demo',
  file: 'voxel_stack_demo.md',
  cart: 'cart/voxel_stack_demo/',
  purpose: ['voxel', 'world_gen', 'rendering', 'geometry', 'camera', 'interaction'],
  loc: 625,
  summary:
    'A self-contained Minecraft-lite where you orbit a seeded voxel terrain and click block faces to build or mine, rendering through Scene3D.Instances (one instanced draw per block kind) and doing 3D ray/AABB face picking by hand-rolling the camera-inverse ray with zero host calls.',
  interfaces: [
    {
      name: 'VoxelStackDemo (default export)',
      purpose: ['voxel', 'interaction', 'rendering'],
      kind: 'component',
      sourceFile: 'cart/voxel_stack_demo/index.tsx',
      description:
        'The whole cart: block registry, world gen, picking math, scene, and HUD. Pure React state + declarative primitives; the only continuous interaction is mouse drag (orbit), wheel (zoom), and click (pick).',
      dependsOn: ['BLOCKS', 'makeWorld', 'screenRay', 'pickBlockFace', 'placeOnFace', 'instanceBatches'],
      status: 'lab',
    },
    {
      name: 'Block',
      purpose: ['voxel', 'world_gen'],
      kind: 'data_model',
      sourceFile: 'cart/voxel_stack_demo/index.tsx',
      description:
        '{ id, x, y, z, kind } in a flat Block[] — no chunks, no octree, no typed arrays. id is a monotonic integer (next = max+1); identity for selection and React keys.',
      status: 'lab',
    },
    {
      name: 'BLOCKS',
      purpose: ['voxel', 'world_gen'],
      kind: 'registry',
      sourceFile: 'cart/voxel_stack_demo/index.tsx',
      codeRef: 'cart/voxel_stack_demo/index.tsx:28',
      description:
        'Per-kind { label, color, opacity?, drop?, solid? } for 9 kinds. opacity drives translucent kinds (leaf 0.82, glass 0.42, water 0.48) on singleton overlays; drop remaps mining yields (grass->dirt). solid:false on water is declared but never read.',
      status: 'lab',
    },
    {
      name: 'FACES',
      purpose: ['voxel', 'geometry', 'interaction'],
      kind: 'registry',
      sourceFile: 'cart/voxel_stack_demo/index.tsx',
      description:
        'The six axis-unit face descriptors { key, label, dx, dy, dz } — shared vocabulary between picking (which face the ray entered), the face-handle gizmos, and placement (add(block, face)).',
      status: 'lab',
    },
    {
      name: 'Inventory / START_INVENTORY',
      purpose: ['voxel', 'item'],
      kind: 'data_model',
      sourceFile: 'cart/voxel_stack_demo/index.tsx',
      description:
        'Record<BlockKind, number> seeded by START_INVENTORY; build decrements, mine increments the drop kind — the finite-resource build/mine loop.',
      status: 'lab',
    },
    {
      name: 'makeWorld',
      purpose: ['world_gen', 'voxel'],
      kind: 'utility',
      sourceFile: 'cart/voxel_stack_demo/index.tsx',
      codeRef: 'cart/voxel_stack_demo/index.tsx:83',
      description:
        'Generates a deterministic 13x13 column field over heightAt(x,z) (three-term sine/cosine rounded to int, range ~+-2): stone/dirt/grass layers, a fixed water pond, three procedural trees; a put guard prevents double-occupancy. Same world every reset.',
      status: 'lab',
    },
    {
      name: 'instanceBatches',
      purpose: ['rendering', 'voxel', 'geometry'],
      kind: 'utility',
      sourceFile: 'cart/voxel_stack_demo/index.tsx',
      codeRef: 'cart/voxel_stack_demo/index.tsx:322',
      description:
        'Memoized on blocks: groups blocks by kind and packs each group into a flat stride-9 instance array [x,y,z,1,1,1,r,g,b] (colors from hexRgb). One Scene3D.Instances per kind present — the whole field is <=9 draw nodes regardless of block count.',
      consumers: ['VoxelStackDemo'],
      status: 'lab',
    },
    {
      name: 'screenRay',
      purpose: ['camera', 'math', 'interaction'],
      kind: 'utility',
      sourceFile: 'cart/voxel_stack_demo/index.tsx',
      codeRef: 'cart/voxel_stack_demo/index.tsx:137',
      description:
        'Hand-rolled pixel->world ray: rebuilds the camera view basis (forward = pos-target, side = up x f, up = f x s), converts the pixel to NDC, scales by tan(fov/2) and aspect, returns a normalized world ray. Duplicates the basis math inside unprojectGround.',
      status: 'lab',
    },
    {
      name: 'rayBlockFace',
      purpose: ['math', 'interaction', 'voxel'],
      kind: 'utility',
      sourceFile: 'cart/voxel_stack_demo/index.tsx',
      codeRef: 'cart/voxel_stack_demo/index.tsx:157',
      description:
        'Classic slab-method ray-vs-unit-AABB tracking which axis/sign produced the entry t and mapping it to a Face (exit face if origin is inside). Returns { t, face }.',
      status: 'lab',
    },
    {
      name: 'pickBlockFace',
      purpose: ['interaction', 'voxel'],
      kind: 'utility',
      sourceFile: 'cart/voxel_stack_demo/index.tsx',
      codeRef: 'cart/voxel_stack_demo/index.tsx:193',
      description:
        'Linear O(n) scan over all blocks; nearest positive t wins. No acceleration structure, appropriate at this scale.',
      dependsOn: ['screenRay', 'rayBlockFace'],
      status: 'lab',
    },
    {
      name: 'placeOnFace',
      purpose: ['voxel', 'interaction', 'item'],
      kind: 'utility',
      sourceFile: 'cart/voxel_stack_demo/index.tsx',
      codeRef: 'cart/voxel_stack_demo/index.tsx:457',
      description:
        'The single click handler for both tools. Mine: refuses bedrock (y<=-2) and water (Locked), else removes block and banks drop. Build: targets the face-adjacent cell, refuses occupied/out-of-stock, else appends a block and decrements inventory. Updates the status string.',
      status: 'lab',
    },
    {
      name: 'Scene3D.Instances',
      purpose: ['rendering', 'geometry', 'voxel'],
      kind: 'component',
      sourceFile: 'runtime/primitives.tsx',
      codeRef: 'runtime/primitives.tsx:709',
      description:
        'Requires a registry geometry generator, interns it (internGeometry), and ships vertices only the first time a geometry key is seen (hasShipped/markShipped) — later nodes carry just scene3dGeomKey. Emits scene3dInstanceData/Count/Stride for the host instanced draw.',
      consumers: ['voxel_stack_demo'],
      status: 'live',
    },
    {
      name: 'solveCamera / CAMERAS.Orbit',
      purpose: ['camera'],
      kind: 'utility',
      sourceFile: 'runtime/cameras/',
      codeRef: 'runtime/cameras/index:50',
      description:
        'solveCamera (index line 50) + CAMERAS.Orbit (rigs/orbit.ts): pure solve of { target, yaw deg, pitch deg, dist, zoom, fov } -> { pos, target, fov }. Degrees throughout. The cart memoizes the solve with target = blocks centroid, y clamped [0, 2.2].',
      consumers: ['voxel_stack_demo'],
      status: 'live',
    },
    {
      name: 'Geometry.Box',
      purpose: ['geometry'],
      kind: 'utility',
      sourceFile: 'runtime/geometries/',
      description: 'The only geometry used — unit params, scale via instance data.',
      consumers: ['voxel_stack_demo'],
      status: 'live',
    },
    {
      name: 'cart.json',
      purpose: ['format'],
      kind: 'data_model',
      sourceFile: 'cart/voxel_stack_demo/cart.json',
      description:
        'Directory-cart manifest { name, description, customChrome: false, width: 1280, height: 820 } — how directory carts declare window size + chrome to the host.',
      status: 'lab',
    },
  ],
  patterns: [
    {
      name: 'Scene3D.Instances + group-by-kind + stride-9 [pos, scale, rgb]',
      purpose: ['rendering', 'voxel', 'geometry'],
      description:
        'The proven cheap path for many-identical-meshes worlds: one instanced draw per kind, one shared unit-cube vertex buffer (ship-vertices-once intern). Directly relevant to hmsc props/voxel experiments.',
      examples: ['voxel_stack_demo', 'cart/hmsc-int/VoxelHybridRoute.tsx'],
      status: 'recurring',
    },
    {
      name: 'Hand-rolled screenRay (camera-inverse picking duplicate)',
      purpose: ['camera', 'interaction', 'math'],
      description:
        'The cameras registry owns the camera inverse but only exposes ground picking (unprojectGround); carts needing non-ground hits re-roll the view-basis ray. Three code bodies now build the same basis (unproject.ts, this cart, scape3d projection.ts).',
      examples: ['voxel_stack_demo', 'runtime/cameras/unproject.ts'],
      promoteTo: 'screenRay exported from @reactjit/cameras',
      status: 'promote',
    },
    {
      name: 'Face vocabulary (FACES six-delta + entry-face slab + adjacent placement)',
      purpose: ['voxel', 'interaction', 'geometry'],
      description: 'The reusable voxel-editing core: a six-delta face table shared by picking, gizmos, and face-adjacent placement.',
      examples: ['voxel_stack_demo'],
      status: 'recurring',
    },
    {
      name: 'Click-vs-drag via travel threshold on one Pressable',
      purpose: ['interaction', 'input'],
      description:
        'A single Pressable accumulates |dx|+|dy| during orbit; mouseup treats the gesture as a click only if total travel < 6px. The established gesture pattern for orbit-plus-pick scenes.',
      examples: ['voxel_stack_demo', 'physics_lab'],
      status: 'recurring',
    },
    {
      name: 'Block registry with drop/solid/opacity (kind-derived behavior)',
      purpose: ['voxel', 'world_gen'],
      description:
        'A miniature of the hmsc kind-registry idea — kind-derived behavior in one table; solid being dead here shows the table is ahead of the mechanics.',
      examples: ['voxel_stack_demo'],
      status: 'recurring',
    },
    {
      name: 'cart.json manifest parameterizing the host window',
      purpose: ['format', 'ui'],
      description: 'Directory carts declare window name/size/chrome via cart.json — worth standardizing across game carts.',
      examples: ['voxel_stack_demo'],
      status: 'recurring',
    },
    {
      name: 'Overlays as later siblings (overlays-last hit-test rule)',
      purpose: ['ui', 'interaction'],
      description: 'HUD panels are absolutely-positioned later siblings of the scene Pressable so hit-test paint order surfaces them over the scene.',
      examples: ['voxel_stack_demo'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'Per-instance opacity is dropped — translucent kinds render opaque',
      purpose: ['rendering', 'voxel'],
      description:
        'opacity is not in the stride-9 instance format, so glass/water/leaf render opaque in the instanced field; opacity only appears on singleton overlay meshes (selection ring, ghost, handles). A visual fidelity gap before reusing this as the voxel renderer.',
      evidence: ['cart/voxel_stack_demo/index.tsx:322', 'voxel_stack_demo.md: "translucent kinds ... render opaque in the instanced field"'],
      severity: 'high',
    },
    {
      name: 'screenRay duplicates unexported unprojectGround math',
      purpose: ['camera', 'maintenance', 'interaction'],
      description:
        'screenRay (index.tsx:137) rebuilds the same view basis as runtime/cameras/unproject.ts:unprojectGround; the registry exports only the ground-plane intersection, so non-ground picking re-rolls the ray. Three divergent copies exist.',
      evidence: ['cart/voxel_stack_demo/index.tsx:137', 'voxel_stack_demo.md: "This duplicates the basis construction inside runtime/cameras/unproject.ts:unprojectGround"'],
      fix: 'Export screenRay(sx, sy, rect, solved) from @reactjit/cameras and make unprojectGround a consumer.',
      severity: 'medium',
    },
    {
      name: 'Dead scaffolding fields: solid + water inventory slot',
      purpose: ['voxel', 'maintenance'],
      description:
        'BLOCKS.solid:false on water is declared but never read (no physics consumes it); the water inventory slot is always 0 and not in the HOTBAR — scaffolding for mechanics that do not exist yet, reads as wired.',
      evidence: ['cart/voxel_stack_demo/index.tsx:28', 'voxel_stack_demo.md: "solid:false on water is declared but never read — dead field"'],
      severity: 'low',
    },
    {
      name: 'No hidden-face culling — buried blocks are full instances',
      purpose: ['rendering', 'voxel'],
      description:
        'No neighbor occlusion or hidden-face culling; buried blocks render as full instances. Fine at ~300 blocks but the scaling answer is chunk meshing, not more instances.',
      evidence: ['voxel_stack_demo.md: "No hidden-face culling or neighbor occlusion — buried blocks are full instances."'],
      severity: 'low',
    },
    {
      name: 'No persistence — world resets on relaunch',
      purpose: ['persistence', 'voxel'],
      description:
        'Despite being an editor-shaped toy, there is no save/load; the deterministic world resets on relaunch, and reset() rebuilds it.',
      evidence: ['voxel_stack_demo.md: "no persistence (world resets on relaunch)"'],
      severity: 'low',
    },
  ],
};
