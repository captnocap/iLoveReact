import type { DocIndex } from '../types';

export const boxxx_demo: DocIndex = {
  name: 'boxxx_demo',
  file: 'boxxx_demo.md',
  cart: 'cart/boxxx_demo.tsx',
  purpose: ['rendering', 'ui', 'debug', 'telemetry'],
  loc: 76,
  summary:
    'A visual-regression / performance demo for the <Boxxx> batching primitive: renders the same flex-layout card twice side-by-side, left wrapped in <Boxxx> (batched instanced-rect paint) and right as normal scattered <Box> nodes, which should be pixel-identical.',
  interfaces: [
    {
      name: 'BoxxxDemo',
      purpose: ['ui', 'debug'],
      kind: 'component',
      sourceFile: 'cart/boxxx_demo.tsx',
      codeRef: 'cart/boxxx_demo.tsx:54-76',
      description:
        'Root component. Static comparison: title block plus a comparison row with two Panels — left a Card inside <Boxxx>, right a plain Card. No state, hooks, or events.',
      dependsOn: ['Card', 'Panel', 'Boxxx'],
      status: 'lab',
    },
    {
      name: 'Card',
      purpose: ['ui'],
      kind: 'component',
      sourceFile: 'cart/boxxx_demo.tsx',
      codeRef: 'cart/boxxx_demo.tsx:21-43',
      description:
        'Pure functional component, no props. A nested flex layout (280x340 card) made entirely of <Box> elements with colored bars standing in for text, since Boxxx v1 cannot batch text/image children.',
      status: 'lab',
    },
    {
      name: 'Panel',
      purpose: ['ui'],
      kind: 'component',
      sourceFile: 'cart/boxxx_demo.tsx',
      codeRef: 'cart/boxxx_demo.tsx:45-52',
      description: 'Wrapper that adds a centered label above fixed-size children.',
      status: 'lab',
    },
    {
      name: 'Boxxx',
      purpose: ['rendering', 'ui'],
      kind: 'component',
      sourceFile: 'runtime/primitives.tsx',
      codeRef: 'runtime/primitives.tsx:889-931',
      description:
        'Primitive that batches the paint of a box-only subtree into the instanced-rect pipeline. Two modes: flat-spec (boxes array, __packBoxxx serializes a number[] buffer onto effectData) or children mode (normal JSX laid out by flex but painted as one batched emit). Emits reconciler type "RectBatch".',
      dependsOn: ['__packBoxxx', 'RectBatch'],
      consumers: ['cart/boxxx_demo'],
      status: 'lab',
    },
    {
      name: '__packBoxxx',
      purpose: ['rendering'],
      kind: 'utility',
      sourceFile: 'runtime/primitives.tsx',
      codeRef: 'runtime/primitives.tsx:889-931',
      description: 'Serializes a flat array of BoxxxRect objects into a number[] buffer attached as effectData for RectBatch flat-spec mode.',
      status: 'lab',
    },
    {
      name: 'BoxxxRect',
      purpose: ['rendering'],
      kind: 'data_model',
      sourceFile: 'runtime/primitives.tsx',
      codeRef: 'runtime/primitives.tsx:889-931',
      description: 'Flat-spec rect type: x, y, w, h, optional radius, borderW, bg, border.',
      status: 'lab',
    },
    {
      name: 'RectBatch',
      purpose: ['rendering', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'v8_app.zig',
      codeRef: 'v8_app.zig:1472',
      description:
        'Reconciler type name that <Boxxx> emits. createInstance passes it through unmapped (no HTML_TYPE_MAP entry) as resolvedType; the host recognizes "RectBatch" and sets node.rect_batch = true, deserializing effectData into node.effect_data as f32.',
      consumes: ['effectData'],
      status: 'lab',
    },
    {
      name: 'paintRectBatch',
      purpose: ['rendering'],
      kind: 'utility',
      sourceFile: 'framework/engine.zig',
      codeRef: 'framework/engine.zig:2277-2345',
      description:
        'Paint engine entry for rect_batch nodes. Flat-spec path (2278-2297) reads the packed 14-float-per-box buffer and calls gpu.drawRectCorners offset by the node rect; children path (2298-2302) calls emitNodeRect per child. Invoked from paintNode (1845-1852), skipping paintNodeVisuals scatter.',
      dependsOn: ['emitNodeRect', 'drawRectCorners'],
      status: 'lab',
    },
    {
      name: 'emitNodeRect',
      purpose: ['rendering'],
      kind: 'utility',
      sourceFile: 'framework/engine.zig',
      codeRef: 'framework/engine.zig:2308-2345',
      description:
        'Recursive paint function for Boxxx children mode. Skips display:none; for each node with w/h > 0 emits bg (and/or border) via gpu.drawRectCorners; recurses into children. Does not paint shadows, gradients, text, or images.',
      dependsOn: ['drawRectCorners'],
      status: 'lab',
    },
    {
      name: 'drawRectCorners (instanced-rect pipeline)',
      purpose: ['rendering'],
      kind: 'module',
      sourceFile: 'framework/gpu/rects.zig',
      description:
        'Low-level instanced-rect GPU pipeline: accumulates each rect into the global instanced-rect buffer and draws all accumulated rects in a single instanced draw call (or scissor-batched when clipping) at end of frame.',
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'Batched subtree paint vs scatter paint',
      purpose: ['rendering'],
      description:
        'A box-only subtree is laid out by flex as real reconciler nodes but painted as one contiguous instanced-rect batch (paintRectBatch/emitNodeRect) instead of per-node paintNodeVisuals scatter. Layout is unchanged; only painting is batched.',
      examples: ['boxxx_demo'],
      status: 'recurring',
    },
    {
      name: 'effectData as a serialized float buffer riding a node',
      purpose: ['rendering', 'host_bridge'],
      description:
        'A flat number[]/f32 array (count + per-box x,y,w,h,rgba,radius,borderW,borderRGBA) attached to a node and deserialized host-side; shared mechanism between Boxxx flat-spec and Effect data.',
      examples: ['boxxx_demo'],
      status: 'recurring',
    },
    {
      name: 'Pixel-identical visual-regression pair',
      purpose: ['debug', 'rendering'],
      description: 'Render the same subtree two ways side-by-side (batched vs normal) so any divergence is a visible regression.',
      examples: ['boxxx_demo'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'Boxxx v1 silently drops text/image/shadow/gradient/hover',
      purpose: ['rendering'],
      description:
        'emitNodeRect emits only bg+border; it skips Text, Image, shadows, gradients, and hover states. Putting a <Text> or <Image> inside <Boxxx> diverges from the scatter path with no error — the cart uses colored bars as text placeholders to stay within the limit.',
      evidence: ['boxxx_demo.md — emitNodeRect skips text nodes; "Boxxx v1 only handles box children"; framework/engine.zig:2308-2345'],
      fix: 'Keep Text/Image/shadow/gradient nodes outside <Boxxx>; use the full scatter path for them.',
      severity: 'high',
    },
    {
      name: 'RectBatch is not in HTML_TYPE_MAP',
      purpose: ['host_bridge', 'rendering'],
      description:
        'createInstance passes "RectBatch" straight through as resolvedType because HTML_TYPE_MAP has no entry; the behavior depends on the host recognizing the literal type name and setting node.rect_batch.',
      evidence: ['boxxx_demo.md — renderer/hostConfig.ts createInstance; v8_app.zig:1472'],
      severity: 'low',
    },
    {
      name: 'Flat-spec packing is a fixed 14-float stride',
      purpose: ['rendering'],
      description:
        'Each flat-spec box entry is exactly 14 floats (x,y,w,h,fillR,fillG,fillB,fillA,radius,borderW,borderR,borderG,borderB,borderA); a mismatched packer corrupts every following box.',
      evidence: ['framework/engine.zig:2278-2297 — 14 floats per entry'],
      severity: 'medium',
    },
  ],
};
