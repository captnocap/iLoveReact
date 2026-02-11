---
name: ilovereact-new-app
description: >
  Scaffold a new iLoveReact application for any target. Use when the user asks to
  "create a new app", "scaffold a project", "make a new example", "start a new
  iLoveReact project", or wants to build a new UI for a specific target like
  terminal, Love2D, ComputerCraft, Neovim, Hammerspoon, or AwesomeWM.
---

# Create a New iLoveReact App

## CLI-First Rule

**ALWAYS use the `ilovereact` CLI tool when it covers your use case.** Do NOT manually
run raw esbuild commands, manually scaffold directory structures, or add npm scripts
to package.json for things the CLI already handles. The CLI encodes the correct esbuild
flags, lint gates, runtime file placement, and distribution packaging — manual commands
will get these wrong.

The CLI handles: **Love2D scaffolding, Love2D builds, Love2D distribution packaging,
terminal distribution packaging, linting, and screenshots.**

Grid targets (terminal dev builds, CC, Neovim, Hammerspoon, AwesomeWM) are not yet
covered by the CLI — use npm scripts for those.

## Instructions

### Step 1: Determine Target and Location

Ask the user:
- **Which target?** (terminal, love2d, cc, nvim, hs, awesome, web)
- **App name?** (kebab-case, e.g., `my-dashboard`)
- **Where?** Under `examples/` in the monorepo, or standalone?

### Step 2: Scaffold Based on Target

#### Love2D App (native) — USE THE CLI

```bash
cd /path/to/where/project/goes
ilovereact init <app-name>
```

This creates the full project structure: `src/`, `lua/`, `lib/`, `ilovereact/`,
`main.lua`, `conf.lua`, `package.json`, and installs dependencies. Do NOT manually
create these files.

After scaffolding, the workflow is:
```bash
cd <app-name>
ilovereact dev          # Watch mode with HMR (esbuild --watch)
# love . is already running in a separate terminal (user manages this)
```

To build:
```bash
ilovereact build                  # Lint gate + bundle (for love . workflow)
ilovereact build dist:love        # Self-extracting Linux binary
```

The only file you need to edit is `src/App.tsx` (and add more components under `src/`).

#### Terminal App

```
<app-name>/
  src/
    main.tsx
    App.tsx
```

**src/main.tsx:**
```tsx
import React from 'react';
import { createTerminalApp } from '@ilovereact/terminal';
import App from './App';

const app = createTerminalApp({
  fps: 30,
  fullscreen: true,
});

app.render(<App />);
```

**Build** (add to root package.json scripts if in monorepo examples/):
```json
"build:<app-name>": "esbuild --bundle --platform=node --format=esm --target=es2020 --jsx=automatic --outfile=examples/<app-name>/dist/main.js examples/<app-name>/src/main.tsx"
```

**Distribution** (single-file executable): If the app has a `src/main-terminal.tsx`
entry point, use the CLI from the app directory:
```bash
ilovereact build dist:terminal
```

Run: `node examples/<app-name>/dist/main.js`

#### ComputerCraft App
```tsx
// src/main.tsx
import React from 'react';
import { createCCServer } from '@ilovereact/cc';
import App from './App';

const server = createCCServer({ port: 8080, width: 51, height: 19 });
console.log('CC server running on ws://localhost:8080');
server.render(<App />);

process.on('SIGINT', () => { server.stop(); process.exit(0); });
```

Build: `--external:ws` flag required.

#### Neovim App
```tsx
// src/main.tsx
import React from 'react';
import { createNvimServer } from '@ilovereact/nvim';
import App from './App';

const server = createNvimServer({ cols: 60, rows: 20 });
server.render(<App />);
```

Run via Neovim: `vim.fn.jobstart('node dist/main.js', ...)`

#### Hammerspoon App
```tsx
// src/main.tsx
import React from 'react';
import { createHammerspoonServer } from '@ilovereact/hs';
import App from './App';

const server = createHammerspoonServer({ port: 8080, width: 400, height: 300 });
server.render(<App />);

process.on('SIGINT', () => { server.stop(); process.exit(0); });
```

Build: `--external:ws` flag required.

#### AwesomeWM App
```tsx
// src/main.tsx
import React from 'react';
import { createAwesomeServer } from '@ilovereact/awesome';
import App from './App';

const server = createAwesomeServer({ width: 400, height: 30 });
server.render(<App />);
```

### Step 3: Write the App Component

For **grid targets** (terminal, cc, nvim, hs, awesome), use lowercase JSX intrinsics:

```tsx
import React from 'react';

// Convenience wrappers (optional but cleaner)
function Box({ style, children }: { style?: any; children?: React.ReactNode }) {
  return <view style={style}>{children}</view>;
}

function Text({ style, children }: { style?: any; children?: React.ReactNode }) {
  return <text style={style}>{children}</text>;
}

export default function App() {
  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0a0a0a', flexDirection: 'column' }}>
      <Box style={{ backgroundColor: '#16213e', padding: 1 }}>
        <Text style={{ color: '#e94560' }}>My App</Text>
      </Box>
      <Box style={{ flexGrow: 1, padding: 1 }}>
        <Text style={{ color: '#ffffff' }}>Content goes here</Text>
      </Box>
    </Box>
  );
}
```

For **Love2D/Web targets**, use the uppercase components from `@ilovereact/core`:

```tsx
import React from 'react';
import { Box, Text, Image, Pressable } from '@ilovereact/core';

export default function App() {
  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0a0a0a' }}>
      <Text style={{ color: '#ffffff', fontSize: 24 }}>My App</Text>
    </Box>
  );
}
```

### Step 4: Validate and Verify

**After writing or modifying any component, you MUST run:**

```bash
# For Love2D apps — lint is mandatory (blocks builds on errors)
ilovereact lint

# For visual verification (Love2D apps only)
ilovereact screenshot --output /tmp/preview.png
```

Then read `/tmp/preview.png` to confirm the layout is correct before moving on.

For grid target apps that live in the monorepo, run the build command to verify
the bundle compiles: `npm run build:<app-name>`

### Grid Target Style Constraints

The grid layout engine (`@ilovereact/grid`) supports a subset of the full style system:
- **Layout:** width, height (absolute or %), flexDirection, flexGrow, padding, gap
- **Visual (pass-through):** backgroundColor, color

Properties like fontSize, borderRadius, shadows, transforms, and gradients are NOT supported in the grid layout. They only work in the Love2D/Web full-featured targets.

### Available Components by Target

| Component | Love2D/Web | Grid Targets |
|-----------|-----------|--------------|
| Box/view | Yes | Yes |
| Text/text | Yes | Yes |
| Image | Yes | No |
| Pressable | Yes | No |
| TextInput | Yes | No |
| ScrollView | Yes | No |
| Modal | Yes | No |
| Slider | Yes | No |
| Switch | Yes | No |
| Checkbox | Yes | No |
| Radio | Yes | No |
| Select | Yes | No |
| FlatList | Yes | No |
| Animation | Yes | No |
