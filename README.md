# iLoveReact

Write it in React, render it anywhere there's a surface.

```
React JSX
   │
   ▼
Reconciler ──► mutation commands
   │
   ▼
Transport (QuickJS FFI / WebSocket / stdio / direct)
   │
   ▼
Layout engine ──► computed {x, y, w, h}
   │
   ▼
Painter (target-specific) ──► pixels / characters / widgets
```

A reconciler, a layout engine, and a small painter per target. That's it.

## Targets

| Target | Transport | Renderer | Status |
|--------|-----------|----------|--------|
| **Love2D** | QuickJS FFI (in-process) | `love.graphics.*` | Full flexbox, images, scroll, events, animation |
| **Web** | DOM (direct) | CSS flexbox | Shared components via dual-mode primitives |
| **Terminal** | Direct (ANSI) | 24-bit truecolor | Cell buffer with diff-based updates |
| **ComputerCraft** | WebSocket | `term`/`paintutils` | 16-color palette, 51x19 character grid |
| **Neovim** | stdio | Floating windows + extmarks | 24-bit highlights, buffer rendering |
| **Hammerspoon** | WebSocket | `hs.canvas` | Pixel-based desktop overlays (macOS) |
| **AwesomeWM** | stdio | Cairo/Pango | Pixel-based widgets via `wibox` (Linux) |

## Quick Start

### Terminal (pure JS, zero dependencies)

```tsx
import { createTerminalApp } from '@ilovereact/terminal';

const app = createTerminalApp();
app.render(<App />);
```

Run `node dist/main.js` and your React app renders in the terminal.

### Love2D (native game UI)

```tsx
import { NativeBridge, createRoot } from '@ilovereact/native';
import { BridgeProvider, RendererProvider } from '@ilovereact/core';

const bridge = new NativeBridge();
const root = createRoot();
root.render(
  <BridgeProvider bridge={bridge}>
    <RendererProvider mode="native">
      <App />
    </RendererProvider>
  </BridgeProvider>
);
```

### ComputerCraft (Minecraft)

```tsx
import { createCCServer } from '@ilovereact/cc';

const server = createCCServer({ port: 8080 });
server.render(<App />);
```

Run the server, drop `startup.lua` on a CC computer, and your React app renders in Minecraft.

### Neovim

```tsx
import { createNvimServer } from '@ilovereact/nvim';

const server = createNvimServer({ cols: 60, rows: 20 });
server.render(<App />);
```

In Neovim: `:lua require("ilovereact").setup({ entry = "dist/main.js" })` — a floating window appears with your React UI.

### Hammerspoon (macOS desktop)

```tsx
import { createHammerspoonServer } from '@ilovereact/hs';

const server = createHammerspoonServer({ port: 8081, width: 400, height: 300 });
server.render(<App />);
```

### AwesomeWM (Linux desktop)

```tsx
import { createAwesomeServer } from '@ilovereact/awesome';

const server = createAwesomeServer({ width: 400, height: 30 });
server.render(<App />);
```

## Packages

```
@ilovereact/core          Shared components, hooks, animation, types
@ilovereact/native        Love2D renderer (QuickJS FFI bridge, react-reconciler)
@ilovereact/web           Web renderer (DOM overlays on Love2D WASM canvas)
@ilovereact/grid          Shared layout engine + render server for grid targets
@ilovereact/terminal      Pure-JS terminal renderer (ANSI truecolor)
@ilovereact/cc            ComputerCraft target (WebSocket + 16-color palette)
@ilovereact/nvim          Neovim target (stdio + floating windows)
@ilovereact/hs            Hammerspoon target (WebSocket + hs.canvas)
@ilovereact/awesome       AwesomeWM target (stdio + Cairo)
```

## Features

- **Flexbox layout engine** — `flexDirection`, `justifyContent`, `alignItems`, `flexGrow`/`flexShrink`, `flexWrap`, `gap`, `padding`, `margin`, `%`/`vw`/`vh` units, absolute positioning
- **Hot module reload** — edit components, see changes without restarting the game/app
- **Error reporting** — source-mapped errors with visual overlay
- **Binary distribution** — ship as a single executable
- **Prop diffing** — only changed properties cross the bridge. Style objects are deep-diffed. Multiple updates per node coalesce into one command
- **Event bubbling** — mouse, touch, drag events bubble through the component tree with `stopPropagation()`
- **Animation** — timing, spring physics, easing, composite animations (`parallel`, `sequence`, `stagger`, `loop`), interpolation

## Components

All components work across every target that supports them.

### Primitives

```tsx
import { Box, Text, Image } from '@ilovereact/core';

<Box style={{ flexDirection: 'row', gap: 8, padding: 16 }}>
  <Image src="avatar.png" style={{ width: 48, height: 48, borderRadius: 24 }} />
  <Text style={{ color: '#fff', fontSize: 14 }}>Hello world</Text>
</Box>
```

### Interactive

- **`Pressable`** — touch/click with pressed/hovered/focused state, long press, hit slop
- **`TextInput`** — controlled/uncontrolled, secure entry, multiline, cursor management
- **`ScrollView`** — scrollable container with imperative `scrollTo`
- **`Modal`** — dialog with backdrop, fade/slide animation, escape dismissal
- **`Slider`** — draggable value selector, horizontal/vertical, step snapping
- **`Switch`** — boolean toggle with animated thumb
- **`Checkbox`** — toggleable with label, custom colors
- **`Radio` / `RadioGroup`** — exclusive selection via context
- **`Select`** — dropdown (native `<select>` on web, inline accordion on native)
- **`FlatList`** — virtualized list with windowed rendering, grid mode, inverted

### Animation

```tsx
import { useAnimation, useSpring, Easing, parallel } from '@ilovereact/core';

const opacity = useAnimation({ from: 0, to: 1, duration: 300, easing: Easing.easeOut });
const scale = useSpring({ from: 0.8, to: 1, stiffness: 200, damping: 15 });

parallel([
  opacity.timing({ to: 1, duration: 200 }),
  scale.spring({ to: 1.2 }),
]).start();
```

## Style System

| Category | Properties |
|----------|-----------|
| Sizing | `width`, `height`, `minWidth`, `minHeight`, `maxWidth`, `maxHeight`, `aspectRatio` |
| Flexbox | `display`, `flexDirection`, `flexWrap`, `justifyContent`, `alignItems`, `alignSelf`, `flexGrow`, `flexShrink`, `flexBasis`, `gap` |
| Spacing | `padding`, `paddingLeft/Right/Top/Bottom`, `margin`, `marginLeft/Right/Top/Bottom` |
| Visual | `backgroundColor`, `borderRadius`, `overflow`, `opacity`, `zIndex` |
| Border | `borderWidth`, `borderColor` (per-side variants) |
| Shadow | `shadowColor`, `shadowOffsetX/Y`, `shadowBlur` |
| Gradient | `backgroundGradient: { direction, colors }` |
| Transform | `transform: { translateX, translateY, rotate, scaleX, scaleY }` |
| Text | `color`, `fontSize`, `fontFamily`, `fontWeight`, `textAlign`, `textOverflow`, `lineHeight`, `letterSpacing` |
| Image | `objectFit` (`fill`, `contain`, `cover`, `none`) |
| Position | `position` (`relative`, `absolute`), `top`, `bottom`, `left`, `right` |

## Building

```bash
npm install

# Love2D native target
npm run build:native

# Terminal target
npm run build:terminal-demo

# ComputerCraft target
npm run build:cc-demo

# Neovim target
npm run build:nvim-demo

# Hammerspoon target
npm run build:hs-demo

# AwesomeWM target
npm run build:awesome-demo
```

## CLI Tool

The `ilovereact` CLI manages Love2D projects. Always use it instead of running esbuild directly.

```bash
ilovereact init <name>            # Create a new Love2D project
ilovereact dev                    # Watch mode with HMR
ilovereact build                  # Lint + bundle for dev (love . workflow)
ilovereact build dist:love        # Self-extracting Linux binary
ilovereact build dist:terminal    # Single-file Node.js executable
ilovereact update                 # Sync runtime files from CLI into current project
ilovereact lint                   # Static layout linter
ilovereact screenshot [--output]  # Headless screenshot capture
```

## Development Workflow

### Source of truth vs. distributed copies

The framework has two kinds of files, and editing the wrong one is the fastest way to lose work.

**Framework files** (globally distributed) live at the monorepo root and get copied into projects:

| Source of truth | Role |
|---|---|
| `lua/` | Lua runtime — layout, painter, events, bridges, text editor, focus |
| `packages/shared/` | React primitives, components, hooks, animation, types |
| `packages/native/` | Love2D reconciler, host config, event dispatcher |

**Project files** (application code) are unique to each project and owned by the developer:

| Location | Role |
|---|---|
| `<project>/src/` | Application code (App.tsx, components, stories) |
| `<project>/main.lua`, `conf.lua` | Love2D entry points |
| `<project>/package.json` | Project dependencies |

### How distribution works

```
lua/  ──────────────────┐
packages/shared/  ──────┤  make cli-setup     ilovereact init
packages/native/  ──────┼────────────────►  cli/runtime/  ──────────────►  <project>/
quickjs/libquickjs.so ─┘                                  ilovereact update
```

1. `make cli-setup` copies source-of-truth files into `cli/runtime/`
2. `ilovereact init <name>` creates a new project from `cli/runtime/` (one-time)
3. `ilovereact update` re-syncs `cli/runtime/` into an existing project (repeatable)

### Making framework changes

When you modify any framework file (`lua/`, `packages/shared/`, `packages/native/`), every existing project needs to be updated:

```bash
# 1. Edit the source of truth
vim lua/painter.lua                  # example: add a feature to the Lua painter

# 2. Propagate to CLI runtime
make cli-setup

# 3. Update each project that needs the change
cd examples/storybook
ilovereact update                    # syncs lua/, lib/, ilovereact/
ilovereact build dist:love           # rebuild

cd ../playground
ilovereact update
ilovereact build dist:love
```

`ilovereact update` replaces `lua/`, `lib/`, and `ilovereact/` wholesale. It never touches `src/`, `main.lua`, `conf.lua`, or `package.json`.

**Do not edit files inside `cli/runtime/`, `<project>/lua/`, or `<project>/ilovereact/` directly.** These are disposable copies. `make cli-setup` and `ilovereact update` will overwrite them.

## Architecture

### How targets work

Every target follows the same pattern:

1. **React reconciler** diffs component trees and emits mutation commands
2. **Transport** delivers commands to the target (FFI, WebSocket, stdio, or direct)
3. **Layout engine** computes `{x, y, w, h}` for every node
4. **Painter** draws using the target's native API

Adding a target means writing a painter (~50-100 lines) and choosing a transport. The reconciler, layout engine, and component library are shared.

### Grid targets (CC, Neovim, Terminal, Hammerspoon, AwesomeWM)

These use `@ilovereact/grid` — a simplified JS flexbox engine that outputs flat `DrawCommand[]` arrays. Each target provides a thin client that receives commands and draws.

### Love2D target

The full-featured target. React runs inside Love2D via QuickJS. The Lua side has a 930-line flexbox engine, a full painter with gradients/shadows/transforms/clipping, and bidirectional event handling — all communicating via zero-copy FFI.

### Bridge protocol

Values cross the Lua/JS bridge via direct QuickJS C API traversal — no JSON serialization. The bridge validates JSValue tag layout at init and falls back to JSON if needed.

- **Commands** (JS → Lua): Mutation commands coalesced and flushed once per frame
- **Events** (Lua → JS): Input events collected in a Lua queue, returned as raw array when polled
- **Handlers stay in JS** — only `hasHandlers` boolean crosses the bridge; dispatch happens in JS

## Project Structure

```
ilovereact/
  packages/
    shared/          @ilovereact/core — components, hooks, animation, types
    native/          @ilovereact/native — Love2D renderer (QuickJS FFI)
    web/             @ilovereact/web — DOM overlay renderer
    grid/            @ilovereact/grid — shared layout + render server
    terminal/        @ilovereact/terminal — ANSI terminal renderer
    cc/              @ilovereact/cc — ComputerCraft target
    nvim/            @ilovereact/nvim — Neovim target
    hs/              @ilovereact/hs — Hammerspoon target
    awesome/         @ilovereact/awesome — AwesomeWM target
  targets/
    computercraft/   CC client (startup.lua)
    neovim/          Neovim plugin (Lua)
    hammerspoon/     Hammerspoon Spoon (Lua)
    awesome/         AwesomeWM widget (Lua + Cairo)
  lua/               Lua modules (tree, layout, painter, events, bridges)
  examples/
    native-hud/      Love2D + QuickJS demo
    storybook/       Component catalog (web + native)
    terminal-demo/   Terminal dashboard
    cc-demo/         ComputerCraft dashboard
    nvim-demo/       Neovim floating window
    hs-demo/         Hammerspoon desktop widget
    awesome-demo/    AwesomeWM status bar
  cli/               ilovereact CLI and runtime
```

## Adding a Target

A target needs two things:

1. **Transport** — how draw commands reach the target (WebSocket, stdio, direct write)
2. **Client** — target-specific code that receives commands and draws

For grid-based targets, use `@ilovereact/grid`:

```typescript
import { createRenderServer, createWebSocketTransport } from '@ilovereact/grid';

const transport = createWebSocketTransport(8080);
const server = createRenderServer({
  width: 80,
  height: 24,
  transport,
});
server.render(<App />);
```

Then write a client in whatever language your target uses (~25-80 lines) that connects to the transport and draws.
