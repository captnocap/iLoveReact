# cart/boxxx_demo.tsx

> Single-file cart. No `cart.json` manifest. Built with `./tools/rjit ship boxxx_demo`.

## What it is

A visual regression / performance demo for the `<Boxxx>` batching primitive. It renders the same flex-layout card twice side-by-side: on the left wrapped in `<Boxxx>` (batched instanced-rect paint), on the right as normal scattered `<Box>` nodes. The two should be pixel-identical. The card contains only boxes (no text or images) because `<Boxxx>` v1 only handles box children.

---

## File inventory

| File | Role |
|------|------|
| `cart/boxxx_demo.tsx` | The entire cart — a `Card` component, a `Panel` wrapper, and the `BoxxxDemo` root that renders two columns. |
| `runtime/primitives.tsx` | Exports `Box`, `Text`, and `Boxxx`. Defines `Boxxx` as a wrapper around reconciler type `"RectBatch"`. |
| `renderer/hostConfig.ts` | Reconciler. `createInstance` passes `"RectBatch"` straight through as `resolvedType` (no HTML remapping). Emits a `CREATE` op to the host. |
| `v8_app.zig` | Host V8 bridge. Recognizes `"RectBatch"` type name and sets `node.rect_batch = true`. |
| `framework/layout.zig` | Node layout struct. `rect_batch: bool` flag on `Node`. Also holds `effect_data: ?[]f32` for the flat-spec buffer. |
| `framework/engine.zig` | Paint engine. `paintRectBatch()` emits rects into the instanced-rect pipeline. `emitNodeRect()` recursively walks laid-out children. |
| `framework/gpu/rects.zig` (or gpu batching) | Low-level instanced-rect GPU pipeline that actually draws the accumulated rect instances. |

---

## Dependencies and imports

```tsx
import { Box, Text, Boxxx } from '@reactjit/primitives';
```

- **React** — none explicitly imported. The component uses JSX only (no hooks, no state).
- **Primitives** — `Box` (layout container), `Text` (labels), `Boxxx` (batch wrapper).

No host functions. No `@reactjit/geometries`. No `@reactjit/hooks`. No animation loop.

---

## Component structure

### `Card()` (lines 21–43)

A pure functional component with no props. Returns a nested flex layout made entirely of `<Box>` elements:

```
<Box>  (root card: 280×340, column, gap 12, padding 16, bg #161922, radius 16)
  <Box>  (header row: row, center, gap 10)
    <Box>  (avatar: 36×36, radius 18, bg #5a8bd6)
    <Box>  (title stack: column, gap 6, flexGrow 1)
      <Box>  (title bar: 70% width, 10px high, radius 5, bg #cdd5e6)
      <Box>  (subtitle bar: 45% width, 7px high, radius 4, bg #69718a)
    </Box>
    <Box>  (status dot: 10×10, radius 5, bg #6aa37f)
  </Box>
  <Box>  (body: column, gap 8, padding 12, flexGrow 1, bg #1d2130, radius 12, border 1px #333a4d)
    <Box>  (line 1: 80% width, 9px, radius 4, bg #8c93a6)
    <Box>  (line 2: 92% width, 9px, radius 4, bg #5b6276)
    <Box>  (line 3: 60% width, 9px, radius 4, bg #5b6276)
  </Box>
  <Box>  (button: 40px high, radius 10, bg #d26a2a)
</Box>
```

The colored bars are placeholder stand-ins for text. This is intentional: `<Boxxx>` v1 cannot yet batch text or image children, so using real `<Text>` inside the batched side would cause divergence.

### `Panel()` (lines 45–52)

A wrapper that adds a label above its children:

```tsx
<Box style={{ flexDirection: 'column', gap: 10, alignItems: 'center' }}>
  <Text style={{ fontSize: 11, color: '#8a92a6', letterSpacing: '0.12em' }}>{label}</Text>
  <Box style={{ width: W, height: H }}>{children}</Box>
</Box>
```

### `BoxxxDemo()` (lines 54–76)

Root component. Layout:

```
<Box>  (fullscreen, bg #0d0f15, padding 32, column, gap 24)
  <Box>  (title block: column, gap 4)
    <Text>  (heading)
    <Text>  (description)
  </Box>
  <Box>  (comparison row: row, gap 48)
    <Panel label="BOXXX (batched paint)">
      <Boxxx style={{ width: '100%', height: '100%' }}>
        <Card />
      </Boxxx>
    </Panel>
    <Panel label="NORMAL (scatter paint)">
      <Card />
    </Panel>
  </Box>
</Box>
```

---

## The `<Boxxx>` primitive

### Definition (`runtime/primitives.tsx`, lines 889–931)

```tsx
export type BoxxxRect = {
  x: number; y: number; w: number; h: number;
  radius?: number; borderW?: number; bg?: string; border?: string;
};

const __packBoxxx = (boxes: BoxxxRect[]): number[] => { … };

export const Boxxx: any = ({ boxes, children, ...rest }: any) =>
  boxes != null
    ? h('RectBatch', { ...rest, effectData: __packBoxxx(boxes) }, null)
    : h('RectBatch', rest, children);
```

Two modes:

1. **Flat-spec mode**: `<Boxxx boxes={[…]} />` — the caller provides a flat array of `BoxxxRect` objects. `__packBoxxx` serializes them into a `number[]` buffer and attaches it as `effectData`. No children, no flex layout.
2. **Children mode**: `<Boxxx><Card/></Boxxx>` — normal JSX children are laid out by flex as real reconciler nodes, but PAINTED as one batched emit.

This cart uses **children mode**.

### Reconciler path (`renderer/hostConfig.ts`)

`createInstance` receives `type = "RectBatch"`. `HTML_TYPE_MAP` has no entry for it, so `resolvedType = "RectBatch"`. The reconciler emits a `CREATE` op with `type: "RectBatch"` and the props (style, etc.).

### Host bridge (`v8_app.zig`, line 1472)

```zig
} else if (eq(u8, type_name, "RectBatch")) {
    node.rect_batch = true;
}
```

The host sets the `rect_batch` flag on the node. The `effectData` prop (if present) is deserialized into `node.effect_data` as an `f32` array.

### Layout

Because `<Boxxx>` has children (`<Card/>`), the reconciler creates real child nodes for the entire subtree. Flex layout runs normally on all of them — the `<Boxxx>` node gets a computed rect, and every child `<Box>` inside `<Card>` gets its own computed rect. Layout is unchanged; only **painting** is batched.

### Paint (`framework/engine.zig`, lines 1845–1852 and 2277–2345)

In `paintNode()`, when `node.rect_batch` is true:

```zig
if (node.rect_batch) {
    paintRectBatch(node);
    return;
}
```

This skips the normal per-node `paintNodeVisuals` scatter path entirely.

`paintRectBatch(node)` has two branches:

1. **Flat-spec path** (lines 2278–2297): if `node.effect_data` is present, reads the packed buffer directly. Each entry is 14 floats: `x, y, w, h, fillR, fillG, fillB, fillA, radius, borderW, borderR, borderG, borderB, borderA`. Calls `gpu.drawRectCorners()` for each box, offset by the node's computed `r.x, r.y`.

2. **Children path** (lines 2298–2302): calls `emitNodeRect(child)` for each child.

`emitNodeRect()` (lines 2308–2345) is a recursive function that:
- Skips `display: none` nodes.
- For every node with `r.w > 0 && r.h > 0`:
  - If the node has a `background_color`, calls `gpu.drawRectCorners()` with the computed rect position, background RGBA, corner radii, border width, and border RGBA.
  - If no background but has a border, draws a border-only rect.
- Recurses into `node.children`.

This walks the entire laid-out subtree and emits each box's bg+border as one instanced rect. It does **not** paint shadows, gradients, text, or images. Those require the full `paintNodeVisuals` scatter path.

### GPU (`framework/gpu/rects.zig` / batching)

`gpu.drawRectCorners()` accumulates the rect into the global instanced-rect buffer. At the end of the frame, all accumulated rects are drawn in a single instanced draw call (or batched by scissor rect if clipping is involved). The exact implementation lives in the GPU rect batching code; the engine side just pushes instances.

---

## Comparison: batched vs. scatter paint

| Aspect | Left (`<Boxxx>`) | Right (normal `<Box>`) |
|--------|------------------|------------------------|
| **Reconciler nodes** | Same — full `<Card>` subtree is created. | Same. |
| **Flex layout** | Same — Yoga computes every box. | Same. |
| **Paint path** | `paintRectBatch` → `emitNodeRect` walks the subtree and pushes instanced rects in one contiguous batch. | Each `<Box>` is painted individually via `paintNodeVisuals` in the recursive tree walk. |
| **Result** | Pixel-identical for bg+border boxes. | Pixel-identical for bg+border boxes. |
| **Limits** | No text, no images, no shadows, no gradients, no hover states. | Full feature set. |

The cart's comment notes this explicitly: "They should be pixel-identical."

---

## Styling details

The cart exercises a range of flex and box styles:

- **Dimensions**: fixed (`width: 280, height: 340`), percentage (`width: '70%'`), and flex-derived (`flexGrow: 1`).
- **Layout direction**: `flexDirection: 'column'` and `flexDirection: 'row'`.
- **Gap**: `gap: 12`, `gap: 10`, `gap: 8`, `gap: 6`.
- **Padding**: `padding: 16`, `padding: 12`.
- **Border radius**: `borderRadius: 16`, `12`, `10`, `18`, `5`, `4`.
- **Border**: `borderWidth: 1`, `borderColor: '#333a4d'`.
- **Colors**: solid hex backgrounds (`#161922`, `#5a8bd6`, `#cdd5e6`, etc.). No gradients, no textures.
- **Text styling**: `fontSize: 18`, `fontWeight: 'bold'`, `letterSpacing: '0.12em'`. These `<Text>` nodes live outside `<Boxxx>` so they render normally.

---

## Glossary of concepts present in this cart

| Term | Meaning in this cart |
|------|----------------------|
| **Boxxx** | A primitive that batches the paint of a box-only subtree into the instanced-rect pipeline. Two modes: flat-spec (`boxes` array) or children mode (normal JSX). |
| **RectBatch** | The reconciler type name that `<Boxxx>` emits. The host recognizes it and sets `node.rect_batch = true`. |
| **effectData** | A serialized float array that rides on a node. For `RectBatch` flat-spec mode, it holds `[count, x,y,w,h, rgba, radius, borderW, borderRGBA, …]`. |
| **Instanced-rect pipeline** | The GPU path that draws many rounded rects in a single instanced draw call, rather than one draw per rect. |
| **Scatter paint** | The normal engine path: recursively walking the node tree and calling `paintNodeVisuals` per node. Slower for many simple boxes. |
| **emitNodeRect** | The recursive paint function used by `<Boxxx>` children mode. Walks laid-out child nodes and emits only their bg+border as instanced rects. |
| **Box-only limitation** | `<Boxxx>` v1 skips Text, Image, shadow, gradient, and hover. The cart uses colored bars as text placeholders to stay within the limit. |
| **Yoga layout** | The flex layout engine (via `layout.zig`) that computes `node.computed` rects for every node before paint, regardless of batching. |

---

## What this cart does NOT do

- **No interactivity** — no state, no hooks, no event handlers. It is a static comparison.
- **No text inside `<Boxxx>`** — the card uses colored bars instead of `<Text>` because `emitNodeRect` skips text nodes.
- **No images, shadows, gradients, or hover states** — these require the full scatter paint path.
- **No animation** — completely static render.
- **No host functions** — no file I/O, network, clipboard, store, or shell.
- **No 3D** — purely 2D UI primitives.
