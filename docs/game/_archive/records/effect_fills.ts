import type { DocIndex } from '../types';

export const effect_fills: DocIndex = {
  name: 'effect_fills',
  file: 'effect_fills.md',
  cart: 'cart/effect_fills/',
  purpose: ['shader', 'texture_bake', 'rendering', 'asset_pipeline', 'ui'],
  loc: 370,
  summary:
    'A procedural-texture evaluation gallery of ~170 swatches, each a single Effect quad running one WGSL mega-shader (FILL_SHADER) selected by a 5-float data array, with a global runtime quality grade and a CATALOG.md mapping every swatch to its scape3d texture target.',
  interfaces: [
    {
      name: 'EffectFills',
      purpose: ['ui', 'shader'],
      kind: 'component',
      sourceFile: 'cart/effect_fills/index.tsx',
      description:
        'The gallery cart: fixed header (title + QualityToggle) over a ScrollView of eight board sections; nearly stateless (one useState for the quality grade). Re-renders only on quality toggle.',
      dependsOn: ['FILL_SHADER', 'Effect', 'fillData'],
      status: 'lab',
    },
    {
      name: 'FILL_SHADER',
      purpose: ['shader', 'texture_bake'],
      kind: 'shader',
      sourceFile: 'cart/hmsc-int/render3d/fillShader.ts',
      codeRef: 'cart/hmsc-int/render3d/fillShader.ts:1566',
      description:
        'The canonical WGSL mega-shader (1653 lines): ~30 shared noise/pattern helpers, ~58 material functions, a per-board quality_pass finisher, and an fs_main dispatch chain reading the 5 floats. Header is explicit: exactly one copy of the WGSL, canonical copy lives game-side. fs_main at line 1566.',
      consumers: ['effect_fills', 'textureShaders.ts'],
      status: 'live',
    },
    {
      name: 'fillData',
      purpose: ['shader'],
      kind: 'utility',
      sourceFile: 'cart/effect_fills/index.tsx',
      codeRef: 'cart/effect_fills/index.tsx:104',
      description:
        'Builds the 5-float [materialId, variant, seed, quality, board] array per swatch; each board spreads its seed via a distinct prime-coefficient formula (A: m*17+v*5+3 ... H: m*47+v*29+313) so no two swatches share a seed.',
      consumers: ['EffectFills'],
      status: 'lab',
    },
    {
      name: 'Fill parameter contract (D[0..4])',
      purpose: ['shader', 'format'],
      kind: 'data_model',
      sourceFile: 'cart/hmsc-int/render3d/fillShader.ts',
      description:
        'The load-bearing 5-float layout: D[0] materialId, D[1] variant (0|1|2), D[2] seed, D[3] quality (0 PSX..4 Max), D[4] board (0..7=A..H). Crosses as effectData into the storage buffer D.',
      status: 'live',
    },
    {
      name: 'quality_pass',
      purpose: ['shader', 'rendering'],
      kind: 'shader',
      sourceFile: 'cart/hmsc-int/render3d/fillShader.ts',
      codeRef: 'cart/hmsc-int/render3d/fillShader.ts:1505',
      description:
        'The unifying post-pass: above Preview adds fbm grain/flecks/scratches scaled by q; below applies the retro register (ordered dither, color quantization, desaturation, banding). Each board gets a tone-specific grade (B/F mold+lint, E bloom/no grime, G frost-bloom, H aggregate fleck) — the TONE duality enforced in the post-pass.',
      status: 'live',
    },
    {
      name: 'Material function',
      purpose: ['shader'],
      kind: 'shader',
      sourceFile: 'cart/hmsc-int/render3d/fillShader.ts',
      description:
        'A pure WGSL (uv, px, variant, seed) -> vec3f look builder; ~58 exist (road, brick, mold_wall, neon_tube, crt_screen, cash_stack, blood_pool, stained_glass, asphalt, ...) composed from the shared helper set; variant branches within a material.',
      status: 'live',
    },
    {
      name: 'textureShaders.ts (FILL_SPECS / fillSpec)',
      purpose: ['shader', 'texture_bake', 'asset_pipeline'],
      kind: 'registry',
      sourceFile: 'cart/hmsc-int/render3d/textureShaders.ts',
      codeRef: 'cart/hmsc-int/render3d/textureShaders.ts:237',
      description:
        'The game-side consumer: fillSpec() (line 237) wraps each board material into a ShaderSpec with named range-bounded draggable params (seed + grade base, per-variant seedShift) and a buildData re-emitting the 5-float layout. FILL_SPECS = FILL_BOARDS.flatMap(...) registers all ~58 materials for the texture-studio Materialize pipeline.',
      dependsOn: ['FILL_SHADER', 'FILL_BOARDS'],
      consumers: ['texture studio'],
      status: 'live',
    },
    {
      name: 'FILL_BOARDS',
      purpose: ['shader', 'format'],
      kind: 'registry',
      sourceFile: 'cart/hmsc-int/render3d/textureShaders.ts',
      description:
        'Game-side board table carrying per-board material names and seedCoef (the seed-spread prime coefficients duplicated from fillData) so the game specs reproduce the exact authored swatches.',
      status: 'live',
    },
    {
      name: 'Swatch',
      purpose: ['ui', 'shader'],
      kind: 'component',
      sourceFile: 'cart/effect_fills/index.tsx',
      description:
        'A 125x125 bordered Box containing an absolutely-positioned Effect quad plus a corner ID chip (monospace label like E07). Swatch IDs are stable: <Board><NN> where NN = materialId*3 + variant + 1.',
      status: 'lab',
    },
    {
      name: 'QualityToggle',
      purpose: ['ui', 'shader'],
      kind: 'component',
      sourceFile: 'cart/effect_fills/index.tsx',
      description:
        'Five segmented buttons (PSX/PS2/Preview/Std/Max) plus the active grade note; the one piece of cart state, applied globally across all swatches.',
      status: 'lab',
    },
    {
      name: 'Effect',
      purpose: ['shader', 'rendering'],
      kind: 'component',
      sourceFile: 'runtime/primitives.tsx',
      description:
        'The one user-WGSL surface: data -> effectData -> storage buffer D, with host-supplied U.time/U.size_w/U.size_h uniforms. v8_app.zig provides the Effect prelude and binds D at @group(0) @binding(1).',
      consumers: ['EffectFills'],
      status: 'live',
    },
    {
      name: 'CATALOG.md',
      purpose: ['asset_pipeline'],
      kind: 'module',
      sourceFile: 'cart/effect_fills/CATALOG.md',
      description:
        'The eval document: ID scheme, per-swatch scape3d target tables, the two texture-integration paths (bake-once vs live StaticSurface), pull priorities against the TONE duality, and open questions. Documentation as a first-class cart artifact.',
      status: 'lab',
    },
    {
      name: 'cart.json',
      purpose: ['format'],
      kind: 'data_model',
      sourceFile: 'cart/effect_fills/cart.json',
      description: 'Manifest declaring window 1120x860 + a description that doubles as the board map; also carries the multi-AI authorship attribution.',
      status: 'lab',
    },
  ],
  patterns: [
    {
      name: 'Mega-shader-with-selector',
      purpose: ['shader', 'rendering'],
      description:
        'One WGSL / one pipeline for the whole material library, selection by uniform data (D[]) instead of shader swaps. Same family as ShaderPixelIcon palette-lookup, scaled to 58 materials.',
      examples: ['effect_fills', 'cart/hmsc-int/render3d/fillShader.ts'],
      status: 'recurring',
    },
    {
      name: 'Eval cart + catalog doc + game-side spec registration',
      purpose: ['asset_pipeline', 'shader'],
      description:
        'A complete authoring loop: author swatches -> human eval against named game targets in CATALOG.md -> registry specs with the same seeds. Kept honest by the shared data contract + duplicated seed coefficients.',
      examples: ['effect_fills'],
      promoteTo: 'shared board/material/seed table module',
      status: 'promote',
    },
    {
      name: 'Quality as a runtime artistic grade',
      purpose: ['shader', 'rendering'],
      description:
        'One detail slider with artistic meaning: retro quantize/dither at the low end, additive detail at the high end, per-board tone finishing — not just LOD. Reusable across the whole game.',
      examples: ['effect_fills'],
      status: 'recurring',
    },
    {
      name: 'Stable positional swatch IDs decoupled from runtime knobs',
      purpose: ['format', 'asset_pipeline'],
      description:
        'Swatch ID = <Board><NN> positional scheme; quality is a runtime grade on top, never baked into the ID, so eval verdicts survive grade changes and three AI authoring sessions without collision.',
      examples: ['effect_fills'],
      status: 'recurring',
    },
    {
      name: 'Multi-AI board authorship',
      purpose: ['asset_pipeline'],
      description:
        'Boards A-D codex, E-F Claude, G-H Kimi — parallel art generation worked because the contract (data layout, helper library, ID scheme, board allocation) was fixed first.',
      examples: ['effect_fills'],
      status: 'recurring',
    },
    {
      name: 'Eight near-identical *Column components',
      purpose: ['ui', 'maintenance'],
      description:
        'MaterialColumn/GrungeColumn/PropColumn/ViceColumn/SurfaceColumn/ContraColumn/LiminalColumn/AltColumn differ only in board id, key prefix, and ID letter — a textbook collapse-to-one-parameterized-component candidate.',
      examples: ['effect_fills'],
      promoteTo: 'one parameterized BoardColumn',
      status: 'avoid',
    },
    {
      name: 'Two integration paths (bake-once vs live StaticSurface)',
      purpose: ['texture_bake', 'rendering'],
      description:
        'Static majority: bake once -> RGBA buffer -> Scene3D.Mesh textureKey content-hash cache. Live fills only (buzz/roll/ember): StaticSurface staticKey -> Mesh textureKey, since StaticSurface caches paint. Mirrors the twod_on_3d_faces memory.',
      examples: ['effect_fills', 'CATALOG.md'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'Duplicated seed coefficients must stay in sync by hand',
      purpose: ['shader', 'maintenance'],
      description:
        "The per-board seed-spread prime formulas live in both fillData (index.tsx:104) and textureShaders.ts FILL_BOARDS[].seedCoef. Any drift silently invalidates the eval — the game specs would reproduce different swatches than the gallery.",
      evidence: ['cart/effect_fills/index.tsx:104', 'effect_fills.md: "a two-copy invariant that must stay in sync"'],
      fix: 'Export the board/material/seed tables from one module (the shader file) that both sides import.',
      severity: 'high',
    },
    {
      name: 'Three copies of the material/variant naming',
      purpose: ['format', 'maintenance'],
      description:
        'The eight material-name tables in index.tsx duplicate the names in textureShaders.ts FILL_BOARDS and the tables in CATALOG.md — three copies that can drift.',
      evidence: ['effect_fills.md: "three copies of the material/variant naming"'],
      fix: 'Single source the naming tables.',
      severity: 'medium',
    },
    {
      name: 'Live fills must take the StaticSurface path, not bake',
      purpose: ['texture_bake', 'rendering'],
      description:
        'Materials reading U.time (water, grass, neon-tube buzz, CRT roll/static, embers) require the live StaticSurface->textureKey path; baking them once freezes the animation. CATALOG marks exactly these as Live?.',
      evidence: ['effect_fills.md Glossary: Live fill', 'cart/hmsc-int/render3d/fillShader.ts'],
      severity: 'medium',
    },
    {
      name: 'PSX/PS2 grades are the intended register, not a downgrade',
      purpose: ['shader'],
      description:
        'The low-end quality grades apply UV snap + dither + quantization; CATALOG framing is that PSX/PS2 is the game\'s intended retro register, not a quality downgrade — easy to misread as broken/low-fidelity.',
      evidence: ['effect_fills.md: "PSX/PS2 is the game\'s intended retro register, not a downgrade"'],
      severity: 'low',
    },
    {
      name: 'Catalog targets thingymajiggers that do not exist',
      purpose: ['asset_pipeline'],
      description:
        'CATALOG open question: some textures point at scape3d thingymajiggers (car, corkboard) that do not exist yet — game-planning verdict docs living in a cart directory.',
      evidence: ['effect_fills.md: "textures pointing at thingymajiggers that don\'t exist — car, corkboard"'],
      severity: 'low',
    },
    {
      name: 'Shader ownership: canonical copy is game-side, not the cart',
      purpose: ['shader', 'maintenance'],
      description:
        'FILL_SHADER is authored in effect_fills but its canonical home is cart/hmsc-int/render3d/fillShader.ts because the game texture catalog registers these looks; the header insists on exactly one copy. Editing a stray copy would diverge the eval from the game.',
      evidence: ['effect_fills.md: "authored in effect_fills, canonical copy lives game-side ... exactly one copy of the WGSL"'],
      severity: 'medium',
    },
  ],
};
