# CLAUDE.md

This is React stripped of browser magic and rendered as raw geometry.

If you didn't say how wide it is, it's zero.
If you said grow, it grows exactly.
If you nested flex containers, you own the consequences.
If text wraps, it's because you gave it nowhere to go.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

iLoveReact is a multi-target React rendering framework. Write React components once, render them on Love2D, terminals, Neovim, ComputerCraft, Hammerspoon, AwesomeWM, or web browsers.

**Rendering pipeline:** React reconciler → mutation commands → transport layer → layout engine → target-specific painter.

## CLI-First Workflow (IMPORTANT)

**Always use the `ilovereact` CLI tool instead of manual esbuild commands.** The CLI
encodes correct esbuild flags, enforces lint gates before builds, handles runtime file
placement, and produces correct distribution packages. Running raw esbuild commands
directly will use wrong flags, skip linting, and produce broken builds.

```bash
ilovereact init <name>            # Scaffold new Love2D project (do NOT mkdir + copy manually)
ilovereact dev                    # Watch mode with HMR (do NOT run esbuild --watch manually)
ilovereact build                  # Lint gate + bundle (do NOT run esbuild manually)
ilovereact build dist:love        # Self-extracting Linux binary
ilovereact build dist:terminal    # Single-file Node.js executable
ilovereact lint                   # Static layout linter — run after ANY component change
ilovereact screenshot [--output]  # Headless capture — verify layouts visually
```

**After writing or modifying any component:** run `ilovereact lint`, then
`ilovereact screenshot --output /tmp/preview.png` and inspect the result.

The CLI currently covers Love2D scaffolding/builds and terminal distribution. For grid
target dev builds (terminal, CC, Neovim, Hammerspoon, AwesomeWM), use the npm scripts
in root package.json — these are the only cases where direct esbuild is appropriate.

## Source-of-Truth Architecture (CRITICAL)

There are two categories of files: **globally distributed** (framework internals) and **project-specific** (user application code). Editing the wrong copy is the #1 source of "it builds but doesn't work" bugs.

### Globally distributed files (framework)

These live at the **monorepo root** and get copied into projects via the CLI:

| Source of truth | Copied to by `make cli-setup` | Copied to projects by `ilovereact init/update` |
|---|---|---|
| `lua/*.lua` | `cli/runtime/lua/` | `<project>/lua/` |
| `packages/shared/` | `cli/runtime/ilovereact/shared/` | `<project>/ilovereact/shared/` |
| `packages/native/` | `cli/runtime/ilovereact/native/` | `<project>/ilovereact/native/` |
| `quickjs/libquickjs.so` | `cli/runtime/lib/` | `<project>/lib/` |

**Rules:**
- **ALWAYS edit the source-of-truth files** (`lua/`, `packages/shared/`, `packages/native/`). NEVER edit `cli/runtime/` or `<project>/lua/` or `<project>/ilovereact/` directly — those are disposable copies.
- After editing any source-of-truth file, run the full sync pipeline:
  ```bash
  make cli-setup              # source → cli/runtime/
  cd examples/<project>
  ilovereact update           # cli/runtime/ → project's local copies
  ilovereact build dist:love  # rebuild
  ```
- `ilovereact update` syncs `lua/`, `lib/`, and `ilovereact/` from the CLI runtime into the current project without touching `src/`. Use it to hydrate existing projects after framework changes.
- `ilovereact build dist:love` has a fallback: if no local `lua/` exists, it reads from `cli/runtime/lua/`. But `ilovereact dev` and `love .` require local copies, so always run `ilovereact update` for dev workflows.

### Project-specific files (application code)

These are unique to each project and are NOT managed by the CLI:

- `src/` — user application code (App.tsx, stories, etc.)
- `main.lua`, `conf.lua` — Love2D entry points
- `package.json` — project dependencies
- `packaging/` — build customizations

**Rules:**
- These files are safe to edit directly in any project.
- `ilovereact init` creates starter versions; `ilovereact update` never touches them.
- To copy app code between projects, copy only `src/` and any custom `main.lua`/`conf.lua`.

### Adding a new Lua-side feature (checklist)

1. Edit/create files in `lua/` (the source of truth)
2. Edit/create files in `packages/shared/src/` and `packages/native/src/` as needed
3. `make cli-setup` — propagates to `cli/runtime/`
4. For each example project that needs the feature:
   - `cd examples/<project> && ilovereact update` — syncs runtime files
   - `ilovereact build dist:love` — rebuilds
5. For new projects: `ilovereact init <name>` — gets everything automatically

## Other Build Commands

```bash
npm install                       # Install dependencies

# Grid target builds (not yet covered by CLI)
npm run build:terminal-demo       # Terminal demo → examples/terminal-demo/dist/main.js
npm run build:storybook-native    # Love2D storybook → examples/storybook/love/bundle.js
npm run watch:storybook-native    # Watch mode for storybook

# QuickJS setup (needed for Love2D target)
make setup                        # Clones quickjs-ng, builds libquickjs.so
make build                        # Builds all targets
make dist-storybook               # Self-extracting Linux binary with bundled glibc
```

## Monorepo Structure

npm workspaces monorepo. Path aliases (`@ilovereact/*`) defined in `tsconfig.base.json`.

| Package | Import | Role |
|---------|--------|------|
| `packages/shared` | `@ilovereact/core` | Primitives (Box, Text, Image), components, hooks, animation, types |
| `packages/native` | `@ilovereact/native` | react-reconciler host config, instance tree, event dispatch |
| `packages/web` | `@ilovereact/web` | DOM overlay renderer |
| `packages/grid` | `@ilovereact/grid` | Shared layout engine for character-grid targets |
| `packages/terminal` | `@ilovereact/terminal` | Pure JS terminal renderer (ANSI truecolor) |
| `packages/cc` | `@ilovereact/cc` | ComputerCraft target (WebSocket, 16-color) |
| `packages/nvim` | `@ilovereact/nvim` | Neovim target (stdio, floating windows) |
| `packages/hs` | `@ilovereact/hs` | Hammerspoon target (WebSocket, pixel canvas) |
| `packages/awesome` | `@ilovereact/awesome` | AwesomeWM target (stdio, Cairo) |
| `packages/components` | `@ilovereact/components` | Re-exports layout helpers (Card, Badge, FlexRow, etc.) |

**Lua runtime** (`lua/`): Layout engine (`layout.lua`), painter (`painter.lua`), QuickJS FFI bridge (`bridge_quickjs.lua`), instance tree, event handling, text measurement, error overlay, visual inspector (F12).

**Examples** (`examples/`): `storybook/`, `native-hud/`, `terminal-demo/`, `cc-demo/`, `nvim-demo/`, `hs-demo/`, `awesome-demo/`, `neofetch/`, `playground/`, `web-overlay/`.

## esbuild Formats by Target

- **Love2D**: `--format=iife --global-name=ReactLove` (runs inside QuickJS)
- **Grid targets** (terminal, nvim, cc, hs, awesome): `--platform=node --format=esm`
- **Web**: `--format=esm`
- WebSocket targets additionally need `--external:ws`

## Critical Layout Rules

These cause the most bugs:

1. **Root containers** need `width: '100%', height: '100%'` — NOT `flexGrow: 1`
2. **Every `<Text>` MUST have explicit `fontSize`** — the linter enforces this
3. **No `flexGrow` without sibling sizing context** — needs a parent with known dimensions
4. **Pre-compute grid dimensions** — don't rely on child content to infer container size
5. **Keep flex trees shallow** — prefer `<Box flexDirection='row'>` over deep wrapper hierarchies
6. **Fill the viewport** — Love2D is a fixed canvas, not a scrolling page
7. **Row Boxes NEED explicit width for `justifyContent` to work** — Box nodes have no intrinsic width (only Text nodes do via measurement). A `flexDirection: 'row'` Box without an explicit width won't respond to `justifyContent: 'center'` or other justify values. Always add `width: '100%'` (or a fixed width) to row Boxes that need horizontal content distribution.
8. **Use `█` (U+2588) as a grid blueprint, never in `<Text>`** — the block character renders as a font glyph in Text, not a filled pixel. Convert it to a boolean grid and render colored `<Box>` elements with `backgroundColor` instead (see NeofetchDemo pattern). The linter enforces this via `no-block-char-in-text`.

The static linter (`cli/commands/lint.mjs`) catches these as build-blocking errors. Escape hatch: `// ilr-ignore-next-line`.

## Primitives by Target

**Love2D / Web:** Import from `@ilovereact/core` — `Box`, `Text`, `Image`, `Pressable`, `ScrollView`, `TextInput`, `Modal`, etc.

**Grid targets:** Use lowercase JSX intrinsics (`<view>`, `<text>`) and define local `Box`/`Text` wrappers.

## TypeScript

- Target: ES2020, JSX: react-jsx (automatic), Module resolution: bundler
- React 18.3+, react-reconciler 0.29
- No test framework configured
