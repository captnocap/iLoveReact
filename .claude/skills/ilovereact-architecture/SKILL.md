---
name: ilovereact-architecture
description: >
  Complete architecture reference for the iLoveReact framework. Use when the user
  asks about how iLoveReact works, its architecture, package structure, available
  targets, style system, components, build system, or any general question about
  the framework. Also use when you need context before modifying any code in this
  monorepo.
---

# iLoveReact Architecture Reference

iLoveReact lets you write React JSX once and render it on any surface: Love2D, terminal, Neovim, ComputerCraft (Minecraft), Hammerspoon (macOS), AwesomeWM (Linux), or web browsers.

Built on `react-reconciler` with a custom flexbox layout engine, React Native-inspired style system, animation primitives, and a pluggable transport+painter architecture.

## Monorepo Structure

```
packages/
  shared/    @ilovereact/core      Primitives (Box, Text, Image), style types, animation, hooks, bridge interface
  native/    @ilovereact/native    react-reconciler host config, createRoot, Instance tree, event dispatcher
  web/       @ilovereact/web       DOM overlay renderer for Love2D web builds (Emscripten bridge)
  grid/      @ilovereact/grid      Grid layout engine, flatten, transports (WebSocket, stdio), RenderServer
  cc/        @ilovereact/cc        ComputerCraft target (WebSocket, 51x19 char grid, 16-color palette)
  nvim/      @ilovereact/nvim      Neovim target (stdio, floating windows, 24-bit highlights)
  hs/        @ilovereact/hs        Hammerspoon target (WebSocket, pixel canvas)
  awesome/   @ilovereact/awesome   AwesomeWM target (stdio, Cairo/Pango pixel rendering)
  terminal/  @ilovereact/terminal  Terminal target (direct ANSI truecolor, no external client)

targets/           Client-side scripts (Lua) for each target
examples/          Demo apps for each target
cli/               `ilovereact init/dev/build` CLI (Love2D target only)
lua/               Love2D Lua modules (tree, layout, painter, bridge, events)
native/            QuickJS FFI shim (C code)
quickjs/           QuickJS source (compiled via Makefile)
packaging/         Fused Love2D executable packaging
```

## Data Flow

```
JSX Components
  -> react-reconciler (packages/native hostConfig)
    -> Instance tree (id, type, props, handlers, children)
      -> Transport layer (varies by target)
        -> Layout + Flatten (packages/grid or lua/)
          -> Draw commands -> Native painter
```

## Target Types

There are two fundamentally different rendering paths:

### Full-featured targets (Love2D, Web)
- Love2D: QuickJS FFI bridge, Lua-side layout+painter with full graphics (gradients, shadows, transforms, images, clipping, scroll)
- Web: DOM elements via `<div>`, `<span>`, `<img>` with CSS flexbox

### Grid targets (CC, Neovim, Hammerspoon, AwesomeWM, Terminal)
All use `@ilovereact/grid` which provides:
- `computeLayout(root, width, height, options)` -> LayoutNode tree with {x,y,w,h}
- `flatten(layoutTree, options)` -> DrawCommand[] with {x,y,w,h,bg?,text?,fg?}
- `createRenderServer(options)` -> hooks into reconciler commit, broadcasts frames via transport
- Transports: `createWebSocketTransport(port)` or `createStdioTransport()`

Grid target servers are tiny (~15 lines). They wrap `createRenderServer` with target defaults:
- Transport choice (WebSocket vs stdio)
- Grid dimensions (chars or pixels)
- coordBase (0 for pixel, 1 for 1-based char grids like CC)
- Optional color mapping function (e.g., CC 16-color quantization)

## Key Interfaces

### Instance (reconciler node) — packages/native/src/hostConfig.ts
```typescript
interface Instance {
  id: number;
  type: string;       // 'View', 'Text', 'Image'
  props: Record<string, any>;
  handlers: Record<string, Function>;
  children: Instance[];
}
```

### Transport — packages/grid/src/transports/types.ts
```typescript
interface Transport {
  broadcast(data: string): void;
  onConnect?(callback: (send: (data: string) => void) => void): void;
  stop(): void;
}
```

### DrawCommand — packages/grid/src/flatten.ts
```typescript
interface DrawCommand {
  x: number; y: number; w: number; h: number;
  bg?: any; text?: string; fg?: any;
}
```

### RenderServerOptions — packages/grid/src/RenderServer.ts
```typescript
interface RenderServerOptions {
  width: number;
  height: number;
  transport: Transport;
  coordBase?: number;       // 0 = pixel, 1 = 1-based char grid
  flattenOptions?: {
    mapColor?: (css: string) => any;
    defaultFg?: any;
    defaultBg?: any;
  };
}
```

### IBridge (Love2D/Web only) — packages/shared/src/bridge.ts
```typescript
interface IBridge {
  send(type: string, payload?: any): void;
  flush(): void;
  subscribe(type: string, fn: Listener): Unsubscribe;
  rpc<T>(method: string, args?: any, timeoutMs?: number): Promise<T>;
  setState(key: string, value: any): void;
  isReady(): boolean;
  onReady(callback: () => void): void;
  destroy(): void;
}
```

## Primitives and Components

### Universal primitives (from @ilovereact/core)
- `Box` — flexbox container. In web mode: `<div>`. In native mode: `'View'` host element.
- `Text` — text content. In web mode: `<span>`. In native mode: `'Text'` host element.
- `Image` — image display. In web mode: `<img>`. In native mode: `'Image'` host element.

### For grid targets, use lowercase JSX intrinsics directly:
```tsx
<view style={...}>{children}</view>
<text style={...}>{text}</text>
```
These go through the reconciler -> Instance tree -> grid layout pipeline.

### Interactive components (from @ilovereact/core)
Pressable, TextInput, ScrollView, Modal, Slider, Switch, Checkbox, Radio, RadioGroup, Select, FlatList, Portal, PortalHost

### Animation (from @ilovereact/core)
AnimatedValue, useAnimation, useSpring, useTransition, Easing, parallel, sequence, stagger, loop

## Style System

The `Style` interface (packages/shared/src/types.ts) supports:

| Category | Properties |
|----------|-----------|
| Sizing | width, height, minWidth, minHeight, maxWidth, maxHeight, aspectRatio |
| Flexbox | display, flexDirection, flexWrap, justifyContent, alignItems, alignSelf, flexGrow, flexShrink, flexBasis, gap |
| Spacing | padding(Top/Right/Bottom/Left), margin(Top/Right/Bottom/Left) |
| Visual | backgroundColor, borderRadius, borderWidth, borderColor, overflow, opacity, zIndex |
| Shadow | shadowColor, shadowOffsetX, shadowOffsetY, shadowBlur |
| Gradient | backgroundGradient: { direction, colors } |
| Transform | transform: { translateX/Y, rotate, scaleX/Y, originX/Y } |
| Text | color, fontSize, fontFamily, fontWeight, textAlign, textOverflow, lineHeight, letterSpacing |
| Image | objectFit |
| Position | position (relative/absolute), top, bottom, left, right |

Colors: CSS strings (`'#ff0000'`, `'rgba(...)'`) or Love2D arrays `[r, g, b, a?]` (0-1 range).

**Grid target note:** Grid layout only supports: width, height (abs or %), flexDirection, flexGrow, padding, gap. Visual props (backgroundColor, color) pass through to draw commands.

## Build System — Use the CLI

**Always use the `ilovereact` CLI tool for Love2D scaffolding, building, linting, and
screenshots. Do NOT manually invoke esbuild — the CLI encodes correct flags, runs lint
gates, and handles runtime file placement.**

```bash
ilovereact init <name>            # Scaffold Love2D project
ilovereact dev                    # Watch mode with HMR
ilovereact build                  # Lint gate + bundle
ilovereact build dist:love        # Self-extracting Linux binary
ilovereact build dist:terminal    # Single-file Node.js executable
ilovereact lint                   # Static layout linter
ilovereact screenshot [--output]  # Headless capture + verify
```

For grid target dev builds (not yet covered by the CLI), use npm scripts:
`npm run build:<target>-demo` / `npm run watch:<target>`

esbuild format reference (for understanding, not for manual invocation):
- Love2D: `--format=iife --global-name=ReactLove` (runs in QuickJS)
- Grid targets (Node.js): `--platform=node --format=esm`
- WebSocket targets: `--external:ws`
- Web: `--format=esm`

## Workspace Config

- npm workspaces monorepo
- Packages reference each other via `"*"` version
- TypeScript path aliases in tsconfig.base.json map `@ilovereact/*` to `packages/*/src`
- Target ES2020, JSX react-jsx, bundler module resolution

## Layout Principles (Love2D / Native)

The Love2D layout engine (Lua-side flexbox) walks the tree bottom-up to compute sizes. This means every node must be deterministically sizeable without circular parent-child dependencies.

**Critical rules:**
1. **Explicit dimensions** — If a container's size can be pre-computed (e.g., a 13×10 grid of 12px cells = 156×120px), always provide `width` and `height` explicitly. Never rely on deeply nested children to infer container size.
2. **Shallow flex trees** — Avoid nesting rows inside columns inside rows. Each wrapper layer adds ambiguity. A label/value pair should be `Box flexDirection:'row'` with two `Text` children, not a wrapper component inside a column inside a row.
3. **Direct Box usage** — Use `<Box style={{ flexDirection: 'row' }}>` instead of abstraction wrappers when building layouts. Wrapper components (FlexRow, FlexColumn) are fine for simple cases but hide structure from the layout engine.
4. **Every Text needs fontSize** — Text without `fontSize` cannot be measured. Always specify it on Love2D/Web targets.

See the component skill (`ilovereact-component/SKILL.md` §Layout Rules) for the full rule set with examples.

## Event System

Handlers (onClick, onKeyDown, etc.) NEVER cross the bridge. They stay in JS in a `handlerRegistry` keyed by node ID. Only a `hasHandlers` boolean crosses to Lua. Lua dispatches events referencing `targetId`, and JS does handler invocation with event bubbling.

Event types on BoxProps: onClick, onRelease, onPointerEnter/Leave, onKeyDown/Up, onTextInput, onWheel, onTouchStart/End/Move, onGamepadPress/Release/Axis, onDragStart/Drag/DragEnd.

## Developer Tooling

### Static Linter (`ilovereact lint`)

AST-based linter that catches layout mistakes before they reach the renderer. Uses
TypeScript's `ts.createSourceFile()` for fast parsing — only analyzes inline `style={{ ... }}`
object literals. Integrated as a build gate (blocks `ilovereact build` on errors).

**CLI**: `ilovereact lint` — checks all `.tsx` files under `src/`

**Rules:**
| Rule | Severity | What it catches |
|------|----------|----------------|
| `no-text-without-fontsize` | error | `<Text>` without `fontSize` — can't be measured |
| `no-flexgrow-root` | error | Root container using `flexGrow` without `width/height` |
| `no-invalid-style-props` | error | CSS-only properties like `background`, `boxShadow` |
| `no-uncontexted-flexgrow` | warning | `flexGrow` where siblings lack explicit sizing |
| `no-deep-flex-nesting` | warning | 4+ flex levels without sizing anchor |
| `no-flexrow-flexcolumn` | warning | `<FlexRow>`/`<FlexColumn>` — prefer `<Box>` with `flexDirection` |
| `no-implicit-container-sizing` | warning | 5+ children without explicit container dimensions |

**Escape hatch**: `// ilr-ignore-next-line` comment suppresses all rules for the next JSX element.

**Source**: `cli/commands/lint.mjs`

### Visual Inspector (F12)

Self-contained Lua overlay module (`lua/inspector.lua`) using raw Love2D drawing calls.
Zero impact when disabled — one boolean check per frame per hook.

**Controls:**
- **F12** — Toggle inspector on/off
- **Tab** — Toggle tree panel sidebar

**Features:**
- **Node hover overlay** — Mouse over any node shows colored boxes: orange (margin), green (padding), blue (content area), orange outline (border box)
- **Tooltip** — Floating panel showing node type, id, computed x/y/w/h, and non-default style properties
- **Tree panel** — Left sidebar showing full node hierarchy with dimensions. Hovered node highlighted.
- **Performance bar** — Top-right corner: FPS, layout time (ms), paint time (ms), total node count

**Source**: `lua/inspector.lua`, hooked into `lua/init.lua`

### Headless Screenshot Pipeline (`ilovereact screenshot`)

Chains lint + build + headless Love2D capture into a single command. Uses `xvfb-run`
on Linux for true headless operation.

**CLI**: `ilovereact screenshot [--output path.png]`

**Steps:**
1. Lint check (exit 1 on errors)
2. Bundle JS (same esbuild config as `ilovereact build`)
3. Launch Love2D with `ILOVEREACT_SCREENSHOT=1` env var
4. Wait 3 frames for layout to settle
5. Capture framebuffer via `love.graphics.captureScreenshot()`
6. Save PNG to output path and quit

**Env vars** (for manual use):
- `ILOVEREACT_SCREENSHOT=1` — enable screenshot mode
- `ILOVEREACT_SCREENSHOT_OUTPUT=path.png` — output file path

**Source**: `lua/screenshot.lua`, `cli/commands/screenshot.mjs`
