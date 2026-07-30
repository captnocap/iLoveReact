# Context menus

Context menus are rendered entirely in TSX. The framework provides the right-click trigger and a paint mechanism that lets a high-z-index sibling escape parent clipping; everything visual is yours.

## Quick start

```tsx
import { useContextMenu } from '@/runtime/hooks/useContextMenu';

function MyTile() {
  const { triggerProps, ContextMenu, close } = useContextMenu();

  return (
    <>
      <div {...triggerProps} style={{ /* ... */ }}>
        right-click me
      </div>
      <ContextMenu style={{
        backgroundColor: '#1f2937',
        borderRadius: 8,
        padding: 4,
        minWidth: 160,
        flexDirection: 'column',
      }}>
        <div onClick={() => { open(); close(); }}>Open</div>
        <div onClick={() => { del();  close(); }}>Delete</div>
      </ContextMenu>
    </>
  );
}
```

That's the whole API surface. Spread `triggerProps` on whatever you want right-clickable. Render `<ContextMenu>` anywhere in the same component — its children appear at the click coords, on top of everything, and dismiss on any outside click.

## What `useContextMenu` returns

```ts
{
  triggerProps: { onRightClick: (e: {x: number; y: number}) => void };
  ContextMenu: (props: { children, style?, onDismiss? }) => ReactNode;
  close: () => void;
  isOpen: boolean;
  x: number;
  y: number;
}
```

- `triggerProps` — spread onto the trigger element.
- `ContextMenu` — renders `null` when closed; otherwise renders an invisible full-viewport backdrop (zIndex 998) plus your children at the click coords (zIndex 999). The backdrop closes the menu on any click outside the menu container.
- `close` — call from item handlers after committing the action.
- `isOpen`, `x`, `y` — current state, if you need to read it.

## Styling, hover, submenus

The hook intentionally doesn't ship opinionated styles. You bring your own item components, hover state, separators, icons, submenus, animations. A reasonable item with hover highlight:

```tsx
function Item({ label, onClick }: { label: string; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onHoverEnter={() => setHover(true)}
      onHoverExit={() => setHover(false)}
      onClick={onClick}
      style={{
        height: 32,
        paddingLeft: 12,
        paddingRight: 12,
        borderRadius: 4,
        color: '#e5e7eb',
        fontSize: 14,
        backgroundColor: hover ? '#374151' : 'transparent',
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      {label}
    </div>
  );
}
```

For a submenu, render another absolutely-positioned `<div>` with `zIndex: 1000` (one above the parent menu) anchored to the parent item's right edge. See `cart/context_menu_demo.tsx` for a working hover + nested example, including the gotcha that submenu state must be **separate** from hovered-item state — otherwise the submenu closes the moment your cursor enters it.

Fixed-height action rows must also make their text single-line
(`noWrap` + `numberOfLines={1}`). Allowing a label or right-side key hint to
wrap makes the visual row taller than the popup's edge-placement calculation
and can push later actions beyond the window. If a popup clamps itself to a
panel or viewport, treat row-count arithmetic as a first-frame estimate only:
read the rendered container's `onLayout` height and reposition from that
measurement. The editor's `HW_ContextText` and UV action menu follow this
contract.

## Why z-index alone makes this work

This is the load-bearing piece — and it is **not** how CSS z-index normally works. In this engine:

> **Any node with non-zero `zIndex` is wrapped in a fresh full-viewport scissor before paint.**

Two things fall out of that:

1. **Escape clipping.** A menu placed inside a scrolled or `overflow: hidden` parent still paints across the entire window. The fresh scissor overrides the ancestor clip rect. (CSS z-index does NOT do this; we deliberately diverge.)

2. **Z-stack over text.** The GPU pipeline batches primitives by type per scissor segment — all rects, then all text, then curves, etc. Without a scissor break, a later sibling's rect is drawn on top of earlier siblings' rects, but ALL text (including earlier siblings' text) is drawn afterward, painting *over* the later rect. Forcing a new scissor segment at the z-indexed boundary makes the menu's rects + text + glyphs flush together, *after* everything below — so menu text actually sits on top of underlying text.

This is the same mechanism `overflow: hidden` and scrollviews use. We just trigger it on z-index too.

The implementation is in `framework/engine.zig:paintChildrenInZOrder`:

```zig
if (child.style.z_index != 0) {
    gpu.pushScissor(0, 0, win_w, win_h);
    paintNode(child);
    gpu.popScissor();
} else {
    paintNode(child);
}
```

Children are painted in z-index ascending order (stable on ties), so multiple z-indexed siblings stack correctly relative to each other.

## Click-outside dismissal

`<ContextMenu>` renders an invisible backdrop sized 100000×100000 at `zIndex: 998` whenever the menu is open. The backdrop has an `onClick` that calls `close()`. The menu itself sits at zIndex 999, so the backdrop is below it — any click that doesn't land on the menu lands on the backdrop instead. No global event listeners, no portal magic.

If you want to dismiss on Esc, focus loss, or scroll, layer that on top of the hook in your own component using `useEffect`. We didn't bake that in to keep the hook minimal.

## What this replaces

There used to be two host-painted overlays:

- `framework/context_menu.zig` — a fully Zig-painted menu with hardcoded fonts/colors.
- `contextMenuItems` prop — the JS-side opt-in.

Both still exist for backward compatibility with carts that adopted them, but they can't be themed or composed in TSX. Avoid them in new code. See [`rightclick.md`](./rightclick.md) for the precedence rules when both paths are set on the same node.

## See also

- [`docs/v8/rightclick.md`](./rightclick.md) — the underlying event mechanism.
- `runtime/hooks/useContextMenu.tsx` — the hook implementation.
- `cart/context_menu_demo.tsx` — full demo: hover highlight, nested submenu, click-outside dismissal.
- `framework/engine.zig:paintChildrenInZOrder` — the z-index → scissor break implementation.
