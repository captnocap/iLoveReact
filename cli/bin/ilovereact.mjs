#!/usr/bin/env node

import { argv, exit } from 'node:process';
import { initCommand } from '../commands/init.mjs';
import { devCommand } from '../commands/dev.mjs';
import { buildCommand } from '../commands/build.mjs';

const [,, command, ...args] = argv;

const HELP = `
  ilovereact - CLI for iLoveReact

  Usage:
    ilovereact init <name>    Create a new iLoveReact project
    ilovereact dev             Run esbuild in watch mode (HMR)
    ilovereact build           Build a distributable fused binary
    ilovereact help            Show this help message
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
