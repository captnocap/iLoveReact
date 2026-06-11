import type { DocIndex } from '../types';

export const pixel_icon_demo: DocIndex = {
  name: 'pixel_icon_demo',
  file: 'pixel_icon_demo.md',
  cart: 'cart/pixel_icon_demo.tsx',
  purpose: ['asset_pipeline', 'texture_bake', 'item', 'host_bridge', 'ui'],
  loc: 1693,
  summary:
    'The producer/editor half of the pixel-icon pair: ingests any image/video/GIF via ImageMagick+ffmpeg host subprocesses, quantizes to palette-indexed pixel matrices at 64/128/512, gives an interactive 64-grid editor, and exports pixel-icon JSON plus a full-resolution PNG cutout.',
  interfaces: [
    {
      name: 'PixelIcon',
      purpose: ['ui', 'item'],
      kind: 'component',
      sourceFile: 'cart/pixel_icons/PixelIcon.tsx',
      description:
        'Box-per-cell pixel renderer used here because cells need hit-targets and per-cell overlays; data prop pinned to the raw matrix and React.memo\'d to avoid reconciling 4096 cells per mousemove.',
      consumers: ['pixel_icon_demo'],
      status: 'live',
    },
    {
      name: 'MaskOverlay',
      purpose: ['ui'],
      kind: 'component',
      sourceFile: 'cart/pixel_icons/PixelIcon.tsx',
      description:
        'Sparse absolute layer rendering live erase edits over the memo\'d base, cost O(edit size) instead of rebuilding the matrix.',
      consumers: ['pixel_icon_demo'],
      status: 'live',
    },
    {
      name: 'PaintOverlay',
      purpose: ['ui'],
      kind: 'component',
      sourceFile: 'cart/pixel_icons/PixelIcon.tsx',
      description:
        'Sparse absolute layer rendering live paint edits over the memo\'d base; pairs with MaskOverlay for the overlay-don\'t-rebuild recipe.',
      consumers: ['pixel_icon_demo'],
      status: 'live',
    },
    {
      name: 'PixelMatrix',
      purpose: ['format', 'item'],
      kind: 'data_model',
      sourceFile: 'cart/pixel_icons/PixelIcon.tsx',
      description:
        'Canonical flat in-memory icon form {size, palette, pixels} (length size², row-major, null=transparent); the lingua franca produced by four sources and consumed by two renderers.',
      consumers: ['pixel_icon_demo', 'pixel_icon_gallery', 'carve_lab'],
      status: 'live',
    },
    {
      name: 'parseTxt',
      purpose: ['asset_pipeline', 'format'],
      kind: 'utility',
      sourceFile: 'cart/pixel_icons/matrix.ts',
      description:
        'Parses ImageMagick txt: enumeration output into a PixelMatrix; one parser shared with carve_lab (magick invocations stay per-cart because flags differ).',
      consumers: ['pixel_icon_demo', 'carve_lab'],
      status: 'live',
    },
    {
      name: 'run',
      purpose: ['host_bridge', 'asset_pipeline'],
      kind: 'utility',
      sourceFile: 'runtime/hooks/process.ts',
      codeRef: 'runtime/hooks/process.ts:115',
      description:
        'Spawn a subprocess, collect stdout/stderr via proc event channels, resolve on exit; every magick/ffmpeg/sh call goes through it.',
      dependsOn: ['__proc_spawn', '__proc_kill', '__proc_wait'],
      consumes: ['proc:stdout:<pid>', 'proc:stderr:<pid>', 'proc:exit:<pid>'],
      consumers: ['pixel_icon_demo'],
      status: 'live',
    },
    {
      name: 'execAsync',
      purpose: ['host_bridge'],
      kind: 'utility',
      sourceFile: 'runtime/hooks/process.ts',
      codeRef: 'runtime/hooks/process.ts:142',
      description:
        'Host popen on a detached thread, resolves over the exec:<rid> ffi bus channel; used for the two zenity file pickers because sync __exec would block the click frame.',
      dependsOn: ['__exec_async'],
      consumes: ['exec:<rid>'],
      consumers: ['pixel_icon_demo'],
      status: 'live',
    },
    {
      name: '__proc_spawn',
      purpose: ['host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/process.zig',
      description:
        'Host subprocess spawn; backed by framework/process.zig / v8_bindings_process.zig, emits proc events via __ffiEmit(\'proc:stdout/stderr/exit:<pid>\').',
      emits: ['proc:stdout:<pid>', 'proc:stderr:<pid>', 'proc:exit:<pid>'],
      consumers: ['run'],
      status: 'live',
    },
    {
      name: '__exec_async',
      purpose: ['host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_process.zig',
      description: 'Host popen on a detached thread, replying over the exec:<rid> bus channel.',
      emits: ['exec:<rid>'],
      consumers: ['execAsync'],
      status: 'live',
    },
    {
      name: 'readFile',
      purpose: ['persistence', 'host_bridge'],
      kind: 'utility',
      sourceFile: 'runtime/hooks/fs.ts',
      description: 'Synchronous host file read of magick txt output, via __fs_read.',
      dependsOn: ['__fs_read'],
      consumers: ['pixel_icon_demo'],
      status: 'live',
    },
    {
      name: 'writeFile',
      purpose: ['persistence', 'host_bridge'],
      kind: 'utility',
      sourceFile: 'runtime/hooks/fs.ts',
      description:
        'Synchronous, UTF-8-only host file write of JSON saves and PGM/PPM masks, via __fs_write; the UTF-8-only constraint shapes the whole PNM encoding strategy.',
      dependsOn: ['__fs_write'],
      consumers: ['pixel_icon_demo'],
      status: 'live',
    },
    {
      name: 'mkdir',
      purpose: ['persistence', 'host_bridge'],
      kind: 'utility',
      sourceFile: 'runtime/hooks/fs.ts',
      description: 'Synchronous host directory create (scratch + cart/pixel_icons), via __fs_mkdir.',
      dependsOn: ['__fs_mkdir'],
      consumers: ['pixel_icon_demo'],
      status: 'live',
    },
    {
      name: 'useFileDrop',
      purpose: ['input', 'host_bridge'],
      kind: 'hook',
      sourceFile: 'runtime/hooks/useFileDrop.ts',
      codeRef: 'runtime/hooks/useFileDrop.ts:30',
      description:
        'Window file-drop bridge; not event-push — filedrop.zig bumps a monotonic seq + markDirty() and the hook re-reads __filedropSeq during every render, firing the handler when it advances (read-on-render polling).',
      consumes: ['__filedropSeq', '__filedropLastPath'],
      consumers: ['pixel_icon_demo'],
      status: 'live',
    },
    {
      name: 'callHost',
      purpose: ['host_bridge'],
      kind: 'utility',
      sourceFile: 'runtime/ffi.ts',
      description: 'Generic host bridge, used directly here for the one raw __canvas_screen_to_graph binding.',
      consumers: ['pixel_icon_demo'],
      status: 'live',
    },
    {
      name: '__canvas_screen_to_graph',
      purpose: ['math', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_telemetry.zig',
      codeRef: 'framework/v8_bindings_telemetry.zig:1242',
      description:
        'Screen px → pan/zoom-aware Canvas world coords; imported and wrapped (cart line 27) but only reachable from dead Canvas-editor code here.',
      consumers: ['pixel_icon_demo'],
      status: 'dormant',
    },
    {
      name: 'imageToMatrix',
      purpose: ['asset_pipeline', 'texture_bake'],
      kind: 'utility',
      codeRef: 'cart/pixel_icon_demo.tsx:56',
      description:
        'Static image ingest pipeline: per size, magick -resize NxN! +dither -colors K -depth 8 txt: then readFile + parseTxt; +dither deliberately off to preserve long flat RLE runs.',
      dependsOn: ['run', 'parseTxt', 'readFile'],
      status: 'live',
    },
    {
      name: 'videoToAnim',
      purpose: ['asset_pipeline', 'texture_bake', 'animation'],
      kind: 'utility',
      codeRef: 'cart/pixel_icon_demo.tsx:96',
      description:
        'Video/GIF ingest: ffmpeg frame dump at target fps, shared-palette quantize from a ≤60-frame montage sample, per-frame -remap, then reindex onto frame 0\'s canonical palette so all frames share index meaning.',
      dependsOn: ['run', 'parseTxt'],
      status: 'live',
    },
    {
      name: 'floodFillColor',
      purpose: ['item', 'ui'],
      kind: 'utility',
      codeRef: 'cart/pixel_icon_demo.tsx:384',
      description:
        'Magic-wand BFS over the 64-matrix with a two-tolerance rule (seed tol + stricter step tol max(6,tol/3)) to stop bleed across anti-aliased edges; palette pre-filtered so the body is Set.has.',
      status: 'live',
    },
    {
      name: 'floodFillMask',
      purpose: ['item', 'ui'],
      kind: 'utility',
      description: 'Plain mask-connectivity BFS over the erased set for wand × restore.',
      status: 'live',
    },
    {
      name: 'encodeMatrix',
      purpose: ['format'],
      kind: 'utility',
      codeRef: 'cart/pixel_icon_demo.tsx:316',
      description:
        'RLE encoder producing rows of bare values / [count, value] runs; the on-disk format\'s sole encoder, lives only in the demo.',
      consumers: ['pixel_icon_demo'],
      status: 'live',
    },
    {
      name: 'decodeMatrix',
      purpose: ['format'],
      kind: 'utility',
      codeRef: 'cart/pixel_icon_demo.tsx:337',
      description:
        'RLE decoder kept compiled-in (void decodeMatrix) for future round-trip tooling but unused here; a near-verbatim duplicate of the gallery\'s copy.',
      status: 'dormant',
    },
    {
      name: 'applyMaskToMatrix',
      purpose: ['format', 'item'],
      kind: 'utility',
      description:
        'Scales 64-cell mask up to a matrix size (2×2 at 128, 8×8 at 512), returning a new matrix; resolution-independent.',
      status: 'live',
    },
    {
      name: 'applyPaintToMatrix',
      purpose: ['format', 'item'],
      kind: 'utility',
      description:
        'Scales 64-cell paint up to a matrix size and extends the palette with new paint colors, returning a new matrix.',
      status: 'live',
    },
    {
      name: 'FrameSlot',
      purpose: ['format', 'ui'],
      kind: 'data_model',
      description:
        '{mask, paint, history[≤50], histIdx} — one manual-animation frame\'s committed state plus its undo stack of atomic {mask,paint} snapshots; a reusable shape for any stroke-based editor.',
      status: 'live',
    },
    {
      name: 'onSave',
      purpose: ['persistence', 'format', 'asset_pipeline'],
      kind: 'utility',
      codeRef: 'cart/pixel_icon_demo.tsx:888',
      description:
        'JSON save path with three flavors (static, video anim, manual anim) writing <stem>.<size>.json / .anim.json in the run-length rows format.',
      dependsOn: ['encodeMatrix', 'applyMaskToMatrix', 'applyPaintToMatrix', 'writeFile'],
      status: 'live',
    },
    {
      name: 'onSavePNG',
      purpose: ['asset_pipeline', 'texture_bake', 'persistence'],
      kind: 'utility',
      codeRef: 'cart/pixel_icon_demo.tsx:964',
      description:
        'Full-resolution PNG cutout export: writes 64-grid mask as ASCII P2 PGM, hi-res mask as binary P5 PGM maxval=1, paint as P3 PPM + P2 PGM, then one magick call with argv parentheses to composite → <stem>.cutout.png.',
      dependsOn: ['writeFile', 'run'],
      status: 'live',
    },
    {
      name: 'paintHiResCircle',
      purpose: ['item', 'ui'],
      kind: 'utility',
      description:
        'Fine-brush stamp of brushPx (2-512 source px) circles into the source-resolution hi-res mask held in hiResMaskRef; hiResVersion bumps only on stroke commit.',
      status: 'live',
    },
    {
      name: 'Canvas',
      purpose: ['ui'],
      kind: 'component',
      sourceFile: 'runtime/primitives.tsx',
      description:
        'Canvas primitive imported (cart line 14) for an abandoned hi-res editing surface; no <Canvas> element exists in JSX — vestigial.',
      consumers: ['pixel_icon_demo'],
      status: 'deprecated',
    },
  ],
  patterns: [
    {
      name: '64-grid editing resolution',
      purpose: ['item', 'ui', 'format'],
      description:
        'All masks/paints index cells y*64+x at a fixed 64×64 editing resolution regardless of preview size; saves scale cells up to each matrix size.',
      examples: ['pixel_icon_demo'],
      status: 'recurring',
    },
    {
      name: 'Committed vs live edit state + atomic per-frame snapshot history',
      purpose: ['ui', 'persistence'],
      description:
        'Live mask/paint mutate per mousemove; the per-frame FrameSlot holds the committed snapshot + ≤50-entry undo stack; one undo reverses a whole stroke. The in-memory miniature of the cutout disk-undo philosophy.',
      examples: ['pixel_icon_demo', 'cutout'],
      status: 'recurring',
    },
    {
      name: 'Two-tolerance flood fill',
      purpose: ['item', 'ui'],
      description:
        'Wand BFS with a seed tolerance plus a stricter neighbor-to-neighbor step tolerance to stop leaking across anti-aliased boundaries; worth canonizing for carve_lab and any mask tool.',
      examples: ['pixel_icon_demo', 'carve_lab'],
      promoteTo: 'floodFillColor',
      status: 'promote',
    },
    {
      name: 'Overlay-don\'t-rebuild',
      purpose: ['ui'],
      description:
        'Memo\'d base matrix + sparse absolute overlays for live edits (MaskOverlay/PaintOverlay) instead of rebuilding the matrix per mousemove; MAX_CHILDREN-aware run-coalescing in the overlays.',
      examples: ['pixel_icon_demo'],
      status: 'recurring',
    },
    {
      name: 'External-tool orchestration via run()',
      purpose: ['asset_pipeline', 'host_bridge'],
      description:
        'ffmpeg + montage-pipe + per-frame remap loops with progress callbacks and a stale-token cancellation guard; the established shape any future asset-bake step can copy.',
      examples: ['pixel_icon_demo'],
      promoteTo: 'run',
      status: 'resolved',
    },
    {
      name: 'markDirty + read-on-render host event',
      purpose: ['input', 'host_bridge'],
      description:
        'useFileDrop\'s seq-poll-on-render — a third host-event idiom alongside ffi bus push and isKeyDown polling; the host bumps a seq + markDirty(), the hook reads it during render.',
      examples: ['pixel_icon_demo'],
      status: 'recurring',
    },
    {
      name: 'Ingest-token stale-async cancellation',
      purpose: ['asset_pipeline'],
      description:
        'A tokenRef counter incremented per ingest and checked after every await, so a newer file drop silently cancels the older pipeline.',
      examples: ['pixel_icon_demo'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'encodeMatrix/decodeMatrix duplicated across carts',
      purpose: ['format', 'maintenance'],
      description:
        'decodeMatrix is a near-verbatim duplicate of the gallery\'s copy; the encode/decode pair + filename convention is an undocumented file-format module that wants extracting into cart/pixel_icons/.',
      evidence: [
        'cart/pixel_icon_demo.tsx:316 (encodeMatrix)',
        'cart/pixel_icon_demo.tsx:337 (decodeMatrix duplicate of gallery copy)',
      ],
      fix: 'Promote encode/decode + PixelMatrix into a shared module in cart/pixel_icons/ alongside matrix.ts.',
      severity: 'medium',
    },
    {
      name: 'Vestigial Canvas editor dead code',
      purpose: ['maintenance'],
      description:
        'An abandoned Canvas hi-res editing surface: Canvas import (line 14), canvasScreenToGraph wrapper (27), canvasRect state whose setter is never called, screenToWorld (1090), paintAtWorld (1106), and hiResOverlayCells memo (1243) computed per commit but rendered nowhere — one wasted O(srcW×srcH) scan per stroke commit.',
      evidence: [
        'cart/pixel_icon_demo.tsx:14',
        'cart/pixel_icon_demo.tsx:27',
        'cart/pixel_icon_demo.tsx:1090',
        'cart/pixel_icon_demo.tsx:1106',
        'cart/pixel_icon_demo.tsx:1243',
      ],
      fix: 'Cleanup or complete the Canvas path; the live fine-brush goes through the preview rect (screenToCellF).',
      severity: 'low',
    },
    {
      name: 'UTF-8-only writeFile forces PNM text encoding gymnastics',
      purpose: ['persistence', 'asset_pipeline'],
      description:
        'No binary file writes exist; every magick input is text-encoded. The P5-maxval-1 trick (bytes all 0/1 = valid single-byte UTF-8) is the workaround, with String.fromCharCode in 32KB chunks to avoid blowing the call stack.',
      evidence: ['cart/pixel_icon_demo.tsx:458 (P5-maxval-1 trick)'],
      fix: 'A binary __fs_write_bytes host fn would delete ~60 lines of encoding gymnastics and unblock other binary producers.',
      severity: 'medium',
    },
    {
      name: 'P2 PGM trailing-newline requirement',
      purpose: ['asset_pipeline'],
      description:
        'The 64-grid mask ASCII P2 PGM requires a trailing newline or magick 7 rejects the file.',
      evidence: ['cart/pixel_icon_demo.md "trailing newline required — magick 7 rejects the file without it"'],
      severity: 'medium',
    },
    {
      name: 'Save-time mask scaling re-implements applyMaskToMatrix inline',
      purpose: ['maintenance', 'format'],
      description:
        'The onSave anim branch re-implements applyMaskToMatrix\'s scaling loop inline instead of calling it; loadSrcDims and onSavePNG also each run magick identify separately.',
      evidence: ['cart/pixel_icon_demo.tsx:899-911 (onSave anim branch)'],
      fix: 'Reuse applyMaskToMatrix and share a single magick-identify dims call.',
      severity: 'low',
    },
    {
      name: 'Shared-palette montage width policy',
      purpose: ['asset_pipeline'],
      description:
        'A flat +append of all video frames can blow ImageMagick\'s 16KP width policy; the pipeline samples ≤60 evenly-strided frames and montages into a near-square tile instead.',
      evidence: ['cart/pixel_icon_demo.md videoToAnim shared-palette step'],
      severity: 'low',
    },
  ],
};
