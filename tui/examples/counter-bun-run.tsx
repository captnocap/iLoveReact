import { createElement } from 'react';
import { enter, render, startInput } from '../host';
import App from './counter-bun';

enter();
startInput();
render(createElement(App));
