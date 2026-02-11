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
  ilovereact - CLI for iLoveReact

  Usage:
    ilovereact init <name>           Create a new iLoveReact project
    ilovereact dev                    Run esbuild in watch mode (HMR)
    ilovereact build                  Bundle JS for dev (love . workflow)
    ilovereact build dist:love        Single-file Love2D executable
    ilovereact build dist:terminal    Single-file terminal executable
    ilovereact update                 Sync runtime files (lua/, lib/, ilovereact/)
    ilovereact lint                   Check src/ for layout mistakes
    ilovereact screenshot [--output]  Lint + build + headless screenshot
    ilovereact help                   Show this help message
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
