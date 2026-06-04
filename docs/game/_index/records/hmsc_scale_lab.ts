import type { DocIndex } from '../types';

export const hmsc_scale_lab: DocIndex = {
  name: 'hmsc_scale_lab',
  file: 'hmsc_scale_lab.md',
  cart: 'cart/hmsc_scale_lab.tsx',
  purpose: ['rendering', 'character', 'geometry', 'camera', 'debug', 'texture_bake'],
  loc: 300,
  summary:
    'A measurement instrument (not a game) that renders the HMSC player figure inside a 3D scale room so a human can visually verify that every world metric in cart/hmsc/world/scale.ts agrees with the player’s painted body.',
  interfaces: [
    {
      name: 'HmscScaleLab',
      purpose: ['rendering', 'debug', 'character'],
      kind: 'component',
      sourceFile: 'cart/hmsc_scale_lab.tsx',
      description:
        'The single cart component: scene composition, orbit camera state, keyboard/drag input, and HUD legend. ~300 lines plus seven small local components.',
      dependsOn: [
        'HMSC_SCALE',
        'PlayerFigure',
        'HumanoidFaceCaptures',
        'cameraFromOrbit',
        'busOn',
      ],
      consumes: ['__keydown', 'getMouseX', 'getMouseY', 'getMouseDown'],
      status: 'lab',
    },
    {
      name: 'MeterBlock',
      purpose: ['rendering', 'debug'],
      kind: 'component',
      sourceFile: 'cart/hmsc_scale_lab.tsx',
      description:
        'A reference-height colored box with a white cap plate (asphalt/sidewalk/ledges). Takes a label prop it never renders (dead prop — labels live in the HUD legend only).',
      status: 'lab',
    },
    {
      name: 'DoorFrame',
      purpose: ['rendering', 'debug', 'building'],
      kind: 'component',
      sourceFile: 'cart/hmsc_scale_lab.tsx',
      description:
        'Two amber jambs + lintel sized from HMSC_SCALE.doorWidthMeters/doorHeightMeters (1×2.4m).',
      dependsOn: ['HMSC_SCALE'],
      status: 'lab',
    },
    {
      name: 'RulerTick',
      purpose: ['rendering', 'debug'],
      kind: 'component',
      sourceFile: 'cart/hmsc_scale_lab.tsx',
      description:
        'A ruler tick mark at 0.1m intervals (wider+white at whole meters). 34 ticks share one Box geometry intern key.',
      status: 'lab',
    },
    {
      name: 'HeightLine',
      purpose: ['rendering', 'debug'],
      kind: 'component',
      sourceFile: 'cart/hmsc_scale_lab.tsx',
      description:
        'A flat, wide, thin box at a fixed world y behind the figure — the 3D equivalent of a horizontal rule, color-keyed to a HUD swatch. The lab’s core visualization unit (eleven of them).',
      status: 'lab',
    },
    {
      name: 'GroundGrid',
      purpose: ['rendering', 'debug'],
      kind: 'component',
      sourceFile: 'cart/hmsc_scale_lab.tsx',
      description:
        '9×9 thin box lines at TILE_SIZE (1m) spacing, axis lines lighter — the visual "1 square = 1m" claim.',
      status: 'lab',
    },
    {
      name: 'LabelSwatch',
      purpose: ['ui', 'debug'],
      kind: 'component',
      sourceFile: 'cart/hmsc_scale_lab.tsx',
      description:
        'A HUD legend row: 12px color chip + bold label + live value text computed from the same constants the meshes use.',
      status: 'lab',
    },
    {
      name: 'CameraButton',
      purpose: ['ui', 'camera'],
      kind: 'component',
      sourceFile: 'cart/hmsc_scale_lab.tsx',
      description: 'A camera preset Pressable in the top-right panel; selected styling driven by camera.preset.',
      status: 'lab',
    },
    {
      name: 'cameraFromOrbit',
      purpose: ['camera', 'math'],
      kind: 'utility',
      sourceFile: 'cart/hmsc_scale_lab.tsx',
      codeRef: 'cart/hmsc_scale_lab.tsx:38',
      description:
        'Spherical→cartesian orbit conversion adding a hardcoded center offset [+0.9,+1.1,+0.2] — which does NOT equal cameraTarget [0.85,1.05,0.02].',
      status: 'lab',
    },
    {
      name: 'HMSC_SCALE',
      purpose: ['world_gen', 'physics', 'building', 'vehicle'],
      kind: 'data_model',
      sourceFile: 'cart/hmsc/world/scale.ts',
      description:
        'The world-metric contract object: 1 tile = 1m; capsule 1.65m×0.34r, step 0.35m, door 1×2.4m, story 3m, car/bus/room dimensions. Single source of truth; this lab reads 9 fields as its checker.',
      consumers: [
        'cart/hmsc/world/buildings.ts',
        'cart/hmsc/world/structures.ts',
        'cart/hmsc/world/interiors.ts',
        'cart/hmsc/world/propKinds.ts',
        'cart/hmsc/world/placementCheck.ts',
        'cart/hmsc/world/roadProfile.ts',
        'cart/hmsc/world/buildingKinds.ts',
        'cart/hmsc/world/grid.ts',
        'cart/hmsc/render3d/GameWorld3D.tsx',
        'cart/hmsc/render3d/Building.tsx',
        'cart/hmsc/state/defaults.ts',
        'cart/hmsc_massive_map_lab.tsx',
        'cart/hmsc_scale_lab.tsx',
      ],
      status: 'live',
    },
    {
      name: 'PlayerFigure',
      purpose: ['character', 'rendering'],
      kind: 'component',
      sourceFile: 'cart/hmsc/render3d/PlayerFigure.tsx',
      description:
        '23-line thin wrapper: gait pose (drivePose) → skeleton solve (solveHumanoid with PLAYER_FACE_KEY) → <Figure rig palette={PLAYER_PALETTE} marker>. Its header comment is the contract that any mount must also mount HumanoidFaceCaptures.',
      dependsOn: ['drivePose', 'solveHumanoid', 'Figure', 'PLAYER_PALETTE', 'PLAYER_FACE_KEY'],
      consumers: ['cart/hmsc_scale_lab.tsx', 'cart/hmsc'],
      status: 'live',
    },
    {
      name: 'solveHumanoid',
      purpose: ['character', 'geometry', 'math', 'damage'],
      kind: 'utility',
      sourceFile: 'cart/hmsc/render3d/humanoid/skeleton.ts',
      description:
        'Solves a pose into world-space joints and emits BOTH render parts (rig.parts) and hit capsules (rig.zones) from the same joints — mesh and hitbox can never drift. Plain JS trig (rotateY/rotateX/segmentPose).',
      consumers: ['PlayerFigure'],
      status: 'live',
    },
    {
      name: 'drivePose',
      purpose: ['animation', 'character'],
      kind: 'utility',
      sourceFile: 'cart/hmsc/render3d/humanoid/pose.ts',
      description:
        'drivePose(seconds, moving, running) — the one gait. This lab passes (0,false,false) so only the idle branch runs; the figure is a statue.',
      consumers: ['PlayerFigure'],
      status: 'live',
    },
    {
      name: 'Figure',
      purpose: ['character', 'rendering', 'texture_bake'],
      kind: 'component',
      sourceFile: 'cart/hmsc/render3d/humanoid/Figure.tsx',
      description:
        'The ONE humanoid renderer — maps rig.parts to <Scene3D.Mesh>, resolving each part’s MaterialSlot through a palette; draws the teal marker when passed; renders any textured part white so the bake reads true (line 29).',
      dependsOn: ['solveHumanoid'],
      status: 'live',
    },
    {
      name: 'PLAYER_PALETTE',
      purpose: ['character', 'color'],
      kind: 'registry',
      sourceFile: 'cart/hmsc/render3d/humanoid/palette.ts',
      description:
        'Slot→hex color map for the player. NPC palettes (NPC_PALETTES) live in the same file, used here only indirectly via the face pool.',
      status: 'live',
    },
    {
      name: 'HumanoidFaceCaptures',
      purpose: ['character', 'texture_bake', 'rendering'],
      kind: 'component',
      sourceFile: 'cart/hmsc/render3d/humanoid/face.tsx',
      codeRef: 'cart/hmsc/render3d/humanoid/face.tsx:218',
      description:
        'The baked face decal pool: player + all 4×6 NPC palette×feature combos as StaticSurface nodes parked at left:-99999, each a 96px composition of plain Boxes. Bakes once (static identities); StaticSurface→textureKey feeds the Head decal.',
      emits: ['PLAYER_FACE_KEY'],
      consumers: ['cart/hmsc_scale_lab.tsx'],
      status: 'live',
    },
    {
      name: 'PLAYER_FACE_KEY',
      purpose: ['character', 'texture_bake'],
      kind: 'utility',
      sourceFile: 'cart/hmsc/render3d/humanoid/face.tsx',
      description:
        'The face texture key passed into solveHumanoid to swap the head part to Geometry.Head and resolve the baked player face texture.',
      status: 'live',
    },
    {
      name: 'Geometry.Head',
      purpose: ['geometry', 'character', 'texture_bake'],
      kind: 'utility',
      sourceFile: 'runtime/geometries/Head.ts',
      description:
        'A sphere whose UVs planar-project a flat face texture onto the front (−Z) hemisphere and clamp back-hemisphere UVs to the texture border circle (the Mii/Animal Crossing decal trick).',
      status: 'live',
    },
    {
      name: 'busOn',
      purpose: ['input', 'host_bridge'],
      kind: 'utility',
      sourceFile: 'runtime/hooks/useIFTTT.ts',
      codeRef: 'runtime/hooks/useIFTTT.ts:207',
      description:
        'IFTTT event-bus subscription; the lab’s useEffect subscribes busOn(‘__keydown’, handler) and returns unsubscribe as cleanup.',
      consumes: ['__keydown'],
      status: 'live',
    },
    {
      name: 'decodeKey',
      purpose: ['input', 'host_bridge'],
      kind: 'utility',
      sourceFile: 'runtime/hooks/useIFTTT.ts',
      codeRef: 'runtime/hooks/useIFTTT.ts:352',
      description:
        'Decodes the packed keydown int (keysym low 16 bits, SDL modifier mask high 16) into {key,ctrlKey,shiftKey,altKey,metaKey}; key is already lowercased.',
      emits: ['__keydown'],
      status: 'live',
    },
    {
      name: '__ifttt_onKeyDown',
      purpose: ['input', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/engine.zig',
      codeRef: 'framework/engine.zig:4237',
      description:
        'Host global installed by useIFTTT; SDL3 keydown calls callGlobalInt with packed = keysym | (modifiers << 16), fanned out in JS on the __keydown bus.',
      status: 'live',
    },
    {
      name: '__dispatchEvent',
      purpose: ['input', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'runtime/index.tsx',
      codeRef: 'runtime/index.tsx:426',
      description:
        'The JS half of pointer events; host evals js_on_mouse_* expressions (installed by v8_app.zig:2429–2436) and this builds the payload by pulling coordinates from host getters.',
      dependsOn: ['getPointerPayload'],
      status: 'live',
    },
    {
      name: 'getPointerPayload',
      purpose: ['input', 'host_bridge'],
      kind: 'utility',
      sourceFile: 'runtime/index.tsx',
      codeRef: 'runtime/index.tsx:372',
      description:
        'Pulls window-pixel coordinates from host getters getMouseX()/getMouseY()/getMouseDown() at dispatch time; mouse events do not carry coordinates.',
      consumes: ['getMouseX', 'getMouseY', 'getMouseDown'],
      status: 'live',
    },
    {
      name: 'Geometry registry (@reactjit/geometries)',
      purpose: ['geometry'],
      kind: 'registry',
      sourceFile: 'runtime/geometries/',
      description:
        'Box/Cylinder/Sphere/Cone/Torus/Head generators + intern cache (intern.ts): first mesh per unique-params key ships verts, every subsequent ships only the key. Constant params keep the cache bounded.',
      status: 'live',
    },
    {
      name: 'Scene3D',
      purpose: ['rendering'],
      kind: 'component',
      sourceFile: 'runtime/primitives.tsx',
      codeRef: 'runtime/primitives.tsx:405',
      description:
        'Declarative 3D primitive; <Scene3D> and children are plain View nodes with scene3d* props consumed each frame by framework/gpu/3d.zig (render-to-texture, composited as a quad). Mesh geometry shipping at lines 535–708.',
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'constants module + visual lab that draws the constants',
      purpose: ['debug', 'world_gen'],
      description:
        'A standalone lab cart whose job is to make a contract module (HMSC_SCALE) visible; siblings combat_lab/camera_lab/physics_lab verify other contracts. A lab must derive everything it draws from the contract module or it rots.',
      examples: ['hmsc_scale_lab', 'combat_lab', 'camera_lab', 'physics_lab'],
      status: 'recurring',
    },
    {
      name: 'solve the shape once, derive every consumer from the solve',
      purpose: ['character', 'geometry', 'damage'],
      description:
        'One skeleton produces mesh AND hitbox from the same joints (cannot drift), one renderer recolors via palettes, one face pool guarantees any key resolves. Same instinct as the scape3d thingymajigger model and buildings-are-one-category. Top-level glossary concept.',
      examples: ['hmsc_scale_lab', 'humanoid module', 'scape3d thingymajigger'],
      status: 'recurring',
    },
    {
      name: 'bus-mediated global keyboard (busOn(‘__keydown’))',
      purpose: ['input', 'host_bridge'],
      description:
        'Packed-int host→JS keydown push decoded once, fanned out in JS on the __keydown channel. The standing global-key idiom; same channel hmsc-int WASD pan uses.',
      examples: ['hmsc_scale_lab', 'hmsc-int'],
      promoteTo: 'useGlobalKeys',
      status: 'recurring',
    },
    {
      name: 'pull-based pointer payloads',
      purpose: ['input', 'host_bridge'],
      description:
        'Mouse events carry no coordinates; JS pulls getMouseX/Y from the host at dispatch. Anything wanting historical/queued positions cannot get them from this path.',
      examples: ['hmsc_scale_lab'],
      status: 'recurring',
    },
    {
      name: 'geometry-registry shipping discipline (unit params + scale transforms)',
      purpose: ['geometry', 'rendering'],
      description:
        'Params are unit-ish constants (verts ship once, references are cheap); anything animated belongs in position/rotation/scale. Lets a scene casually use 80+ meshes without OOMing the intern cache.',
      examples: ['hmsc_scale_lab'],
      status: 'recurring',
    },
    {
      name: '2D Boxes → StaticSurface bake → textureKey → Head decal UV',
      purpose: ['texture_bake', 'character', 'rendering'],
      description:
        'A full vertical slice of the "2D on 3D faces" capability that recurs in every cart drawing humanoids. The contract "mount <HumanoidFaceCaptures/> next to your Scene3D" is documented only in a comment — a glossary-level invariant.',
      examples: ['hmsc_scale_lab', 'hmsc gameplay', 'combat_lab'],
      status: 'recurring',
    },
    {
      name: 'orbit camera (lab-style)',
      purpose: ['camera', 'input'],
      description:
        '{yaw,pitch,distance} state + JS spherical→cartesian, presets as hardcoded tuples, drag via same-node mouse capture, zoom via bus keyboard. Entirely cart-side; host receives only the resulting camera position props.',
      examples: ['hmsc_scale_lab', 'carve_lab', 'head_lab'],
      promoteTo: 'OrbitCamera',
      status: 'resolved',
    },
    {
      name: 'overlays as root’s last children',
      purpose: ['ui'],
      description:
        'HUD panels rendered after the Scene3D inside the root Pressable so hit-test/paint-order favors the overlay.',
      examples: ['hmsc_scale_lab'],
      status: 'recurring',
    },
    {
      name: 'pointer-capture idiom (same-node down/move/up)',
      purpose: ['input', 'camera'],
      description:
        'onMouseDown+Move+Up all on the SAME full-screen Pressable, required because move/up handlers on other nodes don’t get capture in this runtime.',
      examples: ['hmsc_scale_lab', 'carve_lab'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'ScaleLabScene.tsx orphan duplicate',
      purpose: ['maintenance', 'rendering'],
      description:
        'cart/hmsc/labs/ScaleLabScene.tsx is a near-verbatim orphaned copy of this cart’s scene (re-implements MeterBlock/HeightLine/RulerTick/DoorFrame/capsule/ground/height lines, offset by labX/labZ). Nothing imports it (grep finds zero consumers) and it has already drifted.',
      evidence: [
        'cart/hmsc/labs/ScaleLabScene.tsx purple height line uses PLAYER_VISUAL_TOTAL_HEIGHT (2.45m) where the cart draws it at PLAYER_VISUAL_HEAD_TOP (2.04m)',
      ],
      fix: 'Make it the shared "scale reference scene" module both the standalone cart and any in-game embed import, or delete the orphan.',
      severity: 'high',
    },
    {
      name: 'hand-transcribed PLAYER_VISUAL_* constants',
      purpose: ['maintenance', 'character'],
      description:
        'The cart’s PLAYER_VISUAL_* constants (shoe bottom −0.16, head top 2.04, hat top 2.29) are hand-copied from skeleton.ts geometry, with nothing tying them together. If the skeleton’s proportions change the lab’s purple/yellow lines silently lie. ScaleLabScene.tsx repeats the same transcription a third time.',
      evidence: [
        'cart/hmsc_scale_lab.tsx:15–17',
        'skeleton.ts head capsule top [0,2.04,0] at line 207; hat apex 2.12+0.34=2.29; foot sphere −0.03 radius 0.155 ≈ −0.16',
      ],
      fix: 'Export the visual extremes from the humanoid module (it already exports the hitbox numbers) so the ruler can’t drift from the body.',
      severity: 'high',
    },
    {
      name: 'orbit center offset != cameraTarget',
      purpose: ['camera', 'maintenance'],
      description:
        'cameraFromOrbit adds center offset [+0.9,+1.1,+0.2], which does not equal cameraTarget [0.85,1.05,0.02]; the orbit pivots ~6cm off from where the camera looks. Harmless at this scale but a near-duplicate constant.',
      evidence: [
        'cart/hmsc_scale_lab.tsx:38 (cameraFromOrbit offset)',
        'cart/hmsc_scale_lab.tsx:170 (cameraTarget)',
      ],
      severity: 'low',
    },
    {
      name: 'MeterBlock label prop never renders',
      purpose: ['maintenance', 'ui'],
      description:
        'MeterBlock takes a label prop it never renders — labels exist only in the HUD legend (a 3D text label was presumably planned; dead prop).',
      evidence: ['cart/hmsc_scale_lab.tsx (MeterBlock, scene content section line 69)'],
      severity: 'low',
    },
    {
      name: 'preset stays highlighted after drag',
      purpose: ['ui', 'camera'],
      description:
        'Dragging keeps preset unchanged, so a preset button stays highlighted after the camera has been dragged away from it.',
      evidence: ['cart/hmsc_scale_lab.tsx (camera model section line 88)'],
      severity: 'low',
    },
    {
      name: '24 unused NPC face bakes',
      purpose: ['texture_bake', 'maintenance'],
      description:
        'HumanoidFaceCaptures bakes all 4×6 NPC palette×feature combos even though this cart has no NPCs (24 unused 96px bakes); negligible, but the pool is all-or-nothing by design.',
      evidence: ['cart/hmsc_scale_lab.tsx (what is not here section line 106)'],
      severity: 'low',
    },
    {
      name: 'face-capture mount contract lives only in a comment',
      purpose: ['texture_bake', 'character', 'maintenance'],
      description:
        'The invariant "any mount drawing the figure must also mount HumanoidFaceCaptures next to its Scene3D" is documented only in a comment in PlayerFigure.tsx:15–17; omit it and faces fail to resolve.',
      evidence: ['cart/hmsc/render3d/PlayerFigure.tsx:15–17'],
      fix: 'Promote to a documented glossary-level invariant.',
      severity: 'medium',
    },
  ],
};
