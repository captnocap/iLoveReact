import { createElement } from 'react';
import { enter, render, startInput } from './host';
import App from './cart';

enter();
startInput();
render(createElement(App));
