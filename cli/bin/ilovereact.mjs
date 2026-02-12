#!/usr/bin/env node

import { argv, exit } from 'node:process';
import { initCommand } from '../commands/init.mjs';
import { devCommand } from '../commands/dev.mjs';
import { buildCommand } from '../commands/build.mjs';
import { lintCommand } from '../commands/lint.mjs';
import { screenshotCommand } from '../commands/screenshot.mjs';
import { updateCommand } from '../commands/update.mjs';

const [,, command, ...args] = argv;

const HELP = `
  ilovereact (ilr) - CLI for iLoveReact

  Usage:
    ilr init <name>              Create a new project (interactive)
    ilr init <name> --all        Include all optional packages
    ilr init <name> --minimal    Core only, no optional packages
    ilr dev [target]             Watch mode (default: love)
    ilr build [target]           Dev build (default: love)
    ilr build dist:<target>      Production build
    ilr update                   Sync runtime files (lua/, lib/, ilovereact/)
    ilr lint                     Check src/ for layout mistakes
    ilr screenshot [--output]    Lint + build + headless screenshot
    ilr help                     Show this help message

  Targets:
    love        Love2D (IIFE, QuickJS)      → bundle.js
    terminal    Terminal (ESM, Node.js)      → dist/main.js
    cc          ComputerCraft (ESM, WS)      → dist/main.js
    nvim        Neovim (ESM, stdio)          → dist/main.js
    hs          Hammerspoon (ESM, WS)        → dist/main.js
    awesome     AwesomeWM (ESM, stdio)       → dist/main.js
    web         Browser (ESM)                → dist/app.js

  Dist formats:
    dist:love       Self-extracting Linux binary (Love2D + glibc)
    dist:terminal   Single-file Node.js executable (shebang + CJS)
    dist:cc         Single-file Node.js executable (shebang + CJS)
    dist:nvim       Single-file Node.js executable (shebang + CJS)
    dist:hs         Single-file Node.js executable (shebang + CJS)
    dist:awesome    Single-file Node.js executable (shebang + CJS)
    dist:web        Production ESM bundle

  Flags:
    --no-update     Skip auto-updating runtime files
    --debug         Enable inspector in dist:love builds
`;

switch (command) {
  case 'init':
    await initCommand(args);
    break;
  case 'dev':
    await devCommand(args);
    break;
  case 'build':
    await buildCommand(args);
    break;
  case 'update':
    await updateCommand(args);
    break;
  case 'lint':
    await lintCommand(args);
    break;
  case 'screenshot':
    await screenshotCommand(args);
    break;
  case 'help':
  case '--help':
  case '-h':
  case undefined:
    console.log(HELP);
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.log(HELP);
    exit(1);
}
