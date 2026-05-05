// scripts/devshell entry point. Wires the tui host + Shell + cart arg.

import '../v8-preamble.js';
import { createElement } from 'react';
import { enter, leave, render, startInput } from '../host';
import { Shell } from './Shell';

declare const __runEventLoop: (done?: () => void) => void;

const cart = (process.argv[1] || '<no cart>');

enter();
startInput();
render(createElement(Shell, { cart }));
__runEventLoop(() => { leave(); process.exit(0); });
