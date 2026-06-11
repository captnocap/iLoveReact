import type { DocIndex } from '../types';

export const pixel_icon_gallery: DocIndex = {
  name: 'pixel_icon_gallery',
  file: 'pixel_icon_gallery.md',
  cart: 'cart/pixel_icon_gallery.tsx',
  purpose: ['ui', 'shader', 'persistence', 'item', 'format'],
  summary:
    'A read-only viewer cart that scans cart/pixel_icons/, loads every saved 64×64 pixel-art icon (static and animated), and renders each as a single GPU quad driven by a WGSL fragment shader; the consumer end of the pixel_icon_demo producer pair.',
  interfaces: [
    {
      name: 'PixelIconGallery',
      purpose: ['ui'],
      kind: 'component',
      sourceFile: 'cart/pixel_icon_gallery.tsx',
      codeRef: 'cart/pixel_icon_gallery.tsx:103',
      description:
        'The gallery component: scale picker (1/2/3/4/6×), reload button, wrapping icon grid; three useState slots (scale, loaded, reloadKey) and one useEffect.',
      status: 'live',
    },
    {
      name: 'ShaderPixelIcon',
      purpose: ['shader', 'ui', 'item'],
      kind: 'component',
      sourceFile: 'cart/pixel_icons/ShaderPixelIcon.tsx',
      codeRef: 'cart/pixel_icons/ShaderPixelIcon.tsx:84',
      description:
        'Static icon renderer: packs the matrix into one flat number[] (packMatrix, line 70, memoized) and draws an <Effect> quad whose WGSL does per-fragment cell lookup + palette fetch.',
      dependsOn: ['PixelMatrix', 'Effect'],
      consumers: ['pixel_icon_gallery'],
      status: 'live',
    },
    {
      name: 'ShaderAnimIcon',
      purpose: ['shader', 'ui', 'animation'],
      kind: 'component',
      sourceFile: 'cart/pixel_icons/ShaderPixelIcon.tsx',
      codeRef: 'cart/pixel_icons/ShaderPixelIcon.tsx:102',
      description:
        'Animated icon renderer: header (size+palette floats) packed once via useMemo, each setInterval tick re-packs header + current frame pixels and bumps state; period max(33, floor(1000/fps)), depends on frame 0\'s canonical palette ordering.',
      dependsOn: ['PixelMatrix', 'Effect'],
      consumers: ['pixel_icon_gallery'],
      status: 'live',
    },
    {
      name: 'SHADER (pixel-icon WGSL)',
      purpose: ['shader'],
      kind: 'shader',
      sourceFile: 'cart/pixel_icons/ShaderPixelIcon.tsx',
      codeRef: 'cart/pixel_icons/ShaderPixelIcon.tsx:25',
      description:
        'Per-fragment WGSL: uv → floor(uv*size) cell coords → clamp into range (guards the fullscreen-triangle overdraw) → pixel index → palette lookup → opaque color or transparent vec4f(0) for -1. uv is top-down so no y-inversion.',
      status: 'live',
    },
    {
      name: 'packMatrix',
      purpose: ['shader', 'format'],
      kind: 'utility',
      sourceFile: 'cart/pixel_icons/ShaderPixelIcon.tsx',
      codeRef: 'cart/pixel_icons/ShaderPixelIcon.tsx:70',
      description:
        'Packs a PixelMatrix into one flat number[]: [0] size, [1] palette count, palette RGB triples, then size² per-cell palette indices (-1 for transparent); memoized on data identity.',
      status: 'live',
    },
    {
      name: 'paletteToFloats',
      purpose: ['color', 'shader'],
      kind: 'utility',
      sourceFile: 'cart/pixel_icons/ShaderPixelIcon.tsx',
      codeRef: 'cart/pixel_icons/ShaderPixelIcon.tsx:59',
      description: 'Parses hex palette to normalized RGB float triples in JS via parseInt for the storage buffer.',
      status: 'live',
    },
    {
      name: 'PixelMatrix',
      purpose: ['format', 'item'],
      kind: 'data_model',
      sourceFile: 'cart/pixel_icons/PixelIcon.tsx',
      codeRef: 'cart/pixel_icons/PixelIcon.tsx:25',
      description:
        'Canonical flat in-memory icon form {size, palette, pixels} (length size², row-major, null=transparent); imported type-only here, the stable hub four producers and two renderers adapt to.',
      consumers: ['pixel_icon_gallery', 'pixel_icon_demo', 'carve_lab'],
      status: 'live',
    },
    {
      name: 'EncodedMatrix',
      purpose: ['format'],
      kind: 'data_model',
      sourceFile: 'cart/pixel_icon_gallery.tsx',
      codeRef: 'cart/pixel_icon_gallery.tsx:24',
      description:
        'Static on-disk format {size:64, palette:[#RRGGBB], rows: EncodedRunEntry[][]} — rows is a run-length encoding, one array per row, each entry a bare value or [count, value] run.',
      status: 'live',
    },
    {
      name: 'EncodedAnim',
      purpose: ['format', 'animation'],
      kind: 'data_model',
      sourceFile: 'cart/pixel_icon_gallery.tsx',
      codeRef: 'cart/pixel_icon_gallery.tsx:25',
      description:
        'Anim on-disk format: shared size/palette hoisted top-level plus fps and frames:[{rows}]; static-vs-anim discriminator at load is Array.isArray(obj.frames).',
      status: 'live',
    },
    {
      name: 'decodeMatrix',
      purpose: ['format'],
      kind: 'utility',
      sourceFile: 'cart/pixel_icon_gallery.tsx',
      codeRef: 'cart/pixel_icon_gallery.tsx:27',
      description:
        'Expands RLE rows back to the flat PixelMatrix pixels array; a near-verbatim copy of pixel_icon_demo\'s decodeMatrix at line 337.',
      status: 'live',
    },
    {
      name: 'loadIcons',
      purpose: ['persistence', 'format'],
      kind: 'utility',
      sourceFile: 'cart/pixel_icon_gallery.tsx',
      codeRef: 'cart/pixel_icon_gallery.tsx:57',
      description:
        'Plain synchronous scan: listDir → sort → for each name matching the 64-res regex readFile + JSON.parse → decode static or every frame; read/parse failures accumulate into errors[] instead of throwing. Runs in a useEffect keyed on reloadKey.',
      dependsOn: ['listDir', 'readFile', 'decodeMatrix'],
      status: 'live',
    },
    {
      name: 'stemOf',
      purpose: ['format', 'ui'],
      kind: 'utility',
      sourceFile: 'cart/pixel_icon_gallery.tsx',
      codeRef: 'cart/pixel_icon_gallery.tsx:53',
      description: 'Strips the .64(.anim).json suffix to get the icon display name.',
      status: 'live',
    },
    {
      name: 'readFile',
      purpose: ['persistence', 'host_bridge'],
      kind: 'utility',
      sourceFile: 'runtime/hooks/fs.ts',
      codeRef: 'runtime/hooks/fs.ts:26',
      description:
        'Synchronous host file read via __fs_read → callHost; returns the file body as UTF-8 string or fallback null if missing, so the gallery renders empty rather than crashing.',
      dependsOn: ['__fs_read', 'callHost'],
      consumers: ['pixel_icon_gallery'],
      status: 'live',
    },
    {
      name: 'listDir',
      purpose: ['persistence', 'host_bridge'],
      kind: 'utility',
      sourceFile: 'runtime/hooks/fs.ts',
      codeRef: 'runtime/hooks/fs.ts:41',
      description:
        'Synchronous host directory list via __fs_list_json → callHostJson; the host returns child names as ONE JSON string (one bridge crossing vs N FFI calls), JS.parse\'d to string[]; fallback [].',
      dependsOn: ['__fs_list_json', 'callHostJson'],
      consumers: ['pixel_icon_gallery'],
      status: 'live',
    },
    {
      name: '__fs_read',
      purpose: ['persistence', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_fs.zig',
      codeRef: 'framework/v8_bindings_fs.zig:634',
      description: 'Host filesystem read registered on globalThis; returns file body string.',
      consumers: ['readFile'],
      status: 'live',
    },
    {
      name: '__fs_list_json',
      purpose: ['persistence', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_fs.zig',
      codeRef: 'framework/v8_bindings_fs.zig:641',
      description: 'Host directory list returning child names as one JSON string.',
      consumers: ['listDir'],
      status: 'live',
    },
    {
      name: 'callHost',
      purpose: ['host_bridge'],
      kind: 'utility',
      sourceFile: 'runtime/ffi.ts',
      description:
        'Generic bridge looking up globalThis.__fs_* with a fallback if the host fn is missing or throws — the standing degrade-to-fallback idiom.',
      status: 'live',
    },
    {
      name: 'callHostJson',
      purpose: ['host_bridge'],
      kind: 'utility',
      sourceFile: 'runtime/ffi.ts',
      codeRef: 'runtime/ffi.ts:88',
      description: 'callHost variant that JSON.parses the host string return; used by listDir.',
      status: 'live',
    },
    {
      name: 'Effect',
      purpose: ['shader', 'rendering'],
      kind: 'component',
      sourceFile: 'runtime/primitives.tsx',
      codeRef: 'runtime/primitives.tsx:886',
      description:
        'The shader-quad primitive; renames the cart-facing data prop to the host prop effectData, which v8_app.zig:2141 copies into node.effect_data, bound as a read-only WGSL storage buffer at @group(0) @binding(1).',
      status: 'live',
    },
    {
      name: 'pixelMatrixFromSeed',
      purpose: ['item', 'character'],
      kind: 'utility',
      sourceFile: 'cart/pixel_icons/pixelMatrixFromSeed.ts',
      description:
        'Deterministic procedural PixelMatrix from a u32 seed (identicon-style NPC/avatar faces); a fourth PixelMatrix producer, not used by this cart.',
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'PixelMatrix as lingua franca',
      purpose: ['format', 'item'],
      description:
        'Four producers (magick parse, seed-procedural, editor edits, disk decode) and two renderers (box-per-cell, shader-quad) all hub on PixelMatrix; the type is the stable hub and everything else is an adapter.',
      examples: ['pixel_icon_gallery', 'pixel_icon_demo', 'carve_lab'],
      status: 'recurring',
    },
    {
      name: 'decodeMatrix/encodeMatrix duplicated file-format module',
      purpose: ['format', 'maintenance'],
      description:
        'decodeMatrix is duplicated (gallery line 27 vs demo 337) and encodeMatrix lives only in the demo; the pair plus filename convention is an undocumented file-format module that should be extracted once and imported by both.',
      examples: ['pixel_icon_gallery', 'pixel_icon_demo'],
      promoteTo: 'decodeMatrix',
      status: 'promote',
    },
    {
      name: 'Struct packed into flat f32 array → Effect data → storage buffer',
      purpose: ['shader', 'rendering'],
      description:
        'The standard way carts feed dynamic data to WGSL (palette+indices here, same idiom as chart/fill shaders); header-once/payload-per-frame packing is the animation refinement.',
      examples: ['pixel_icon_gallery'],
      promoteTo: 'Effect',
      status: 'resolved',
    },
    {
      name: 'Two-renderer pattern (shader-quad display vs box-per-cell editing)',
      purpose: ['rendering', 'ui'],
      description:
        'Same PixelMatrix data, shader-quad for cheap display, box-per-cell for per-cell interaction; choosing per use-site rather than forking the data.',
      examples: ['pixel_icon_gallery', 'pixel_icon_demo'],
      status: 'recurring',
    },
    {
      name: 'Sync host fs + degrade-to-fallback',
      purpose: ['host_bridge', 'persistence'],
      description:
        'callHost with fallback is the standing idiom for optional host capability; the gallery works (empty) even on a host without fs bindings.',
      examples: ['pixel_icon_gallery'],
      promoteTo: 'callHost',
      status: 'resolved',
    },
    {
      name: 'Producer/consumer cart pairs over disk',
      purpose: ['persistence', 'asset_pipeline'],
      description:
        'The editor writes files, the gallery reads files; disk is the channel — same disk=truth philosophy as the cutout session pattern.',
      examples: ['pixel_icon_demo', 'pixel_icon_gallery', 'cutout'],
      status: 'recurring',
    },
    {
      name: 'Per-icon independent setInterval ticker',
      purpose: ['animation', 'game_loop'],
      description:
        'N animated icons mount N independent setInterval timers each driving its own state update and quad rewrite; a shared ticker would be the consolidation if it spreads.',
      examples: ['pixel_icon_gallery'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'Stale shader header comment claims y-inversion',
      purpose: ['shader', 'maintenance'],
      description:
        'The in-shader comment (lines 33-36) explicitly supersedes the stale header comment (lines 18-19) that claims uv inversion per v8_app.zig:2251; uv actually arrives top-down so no y-inversion is needed.',
      evidence: [
        'cart/pixel_icons/ShaderPixelIcon.tsx:18-19 (stale header)',
        'cart/pixel_icons/ShaderPixelIcon.tsx:33-36 (correcting comment)',
      ],
      severity: 'medium',
    },
    {
      name: 'SCALES drift between code and header comment',
      purpose: ['maintenance', 'ui'],
      description:
        'SCALES = [1, 2, 3, 4, 6] at line 101 but the file header comment says "1/2/3/4" — drifted from the code.',
      evidence: ['cart/pixel_icon_gallery.tsx:101'],
      severity: 'low',
    },
    {
      name: 'ICON_DIR relative path ties cart to repo-root launch',
      purpose: ['persistence', 'asset_pipeline'],
      description:
        'ICON_DIR = \'cart/pixel_icons\' (line 15) is relative, resolved against the binary cwd; a shipped binary run from elsewhere scans an empty dir and shows "No icons yet".',
      evidence: ['cart/pixel_icon_gallery.tsx:15'],
      fix: 'Any real game-asset version needs an asset-path convention instead of a repo-relative dir.',
      severity: 'medium',
    },
    {
      name: 'idxRef dead and aspirational visibility-pause comment',
      purpose: ['maintenance'],
      description:
        'ShaderAnimIcon\'s idxRef (line 105) is written every render and never read; the "pause when document not visible" comment is aspirational — there is no document in this runtime and no pause logic exists.',
      evidence: ['cart/pixel_icons/ShaderPixelIcon.tsx:105'],
      severity: 'low',
    },
    {
      name: '"no React reconciliation" comment is per-cell-only',
      purpose: ['rendering', 'maintenance'],
      description:
        'Each anim tick does re-render React (setIdx); the source "no React reconciliation" claim is accurate only at the per-cell level — the diff is one Effect node\'s effectData prop (memcpy size² f32s), not 4096 Box children.',
      evidence: ['cart/pixel_icons/ShaderPixelIcon.tsx ShaderAnimIcon comment'],
      severity: 'low',
    },
    {
      name: 'Card sizing hardcodes 64*scale assuming size=64',
      purpose: ['ui'],
      description:
        'The grid wrapper hardcodes 64*scale while the shader components size themselves data.size×pixelSize; consistent only because the filename filter guarantees size=64. A non-64 file named *.64.json would overflow its card.',
      evidence: ['cart/pixel_icon_gallery.tsx:133 region'],
      severity: 'low',
    },
    {
      name: 'uv clamp guards fullscreen-triangle overdraw',
      purpose: ['shader'],
      description:
        'The host\'s 3-vertex fullscreen-triangle overdraw can push uv slightly past [0,1]; without clamp(cell,0,size-1) edge fragments read garbage palette indices at the right/bottom.',
      evidence: ['cart/pixel_icons/ShaderPixelIcon.tsx WGSL clamp'],
      severity: 'low',
    },
    {
      name: 'No fs watcher — reload is manual',
      purpose: ['persistence', 'file_watch'],
      description:
        'Reload is a manual button bumping reloadKey; if editor and gallery are open simultaneously the gallery does not auto-refresh.',
      evidence: ['cart/pixel_icon_gallery.md "No fs watcher — reload is manual"'],
      fix: 'A useConnection-style live binding to the directory would be the upgrade.',
      severity: 'low',
    },
  ],
};
