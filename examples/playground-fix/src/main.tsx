import React from 'react';
import { createLove2DApp } from '../ilovereact/native/src/Love2DApp';
import { App } from './App';

const app = createLove2DApp();
app.render(<App />);
