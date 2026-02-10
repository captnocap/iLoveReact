import React from 'react';
import { NativeBridge } from '../ilovereact/native/src/NativeBridge';
import { createRoot } from '../ilovereact/native/src/NativeRenderer';
import { BridgeProvider, RendererProvider } from '../ilovereact/shared/src/context';
import { App } from './App';

const bridge = new NativeBridge();
const root = createRoot();

(globalThis as any).__mount = () => {
  root.render(
    <BridgeProvider bridge={bridge}>
      <RendererProvider mode="native">
        <App />
      </RendererProvider>
    </BridgeProvider>
  );
  console.log('[ilovereact] App mounted');
};

if (!(globalThis as any).__deferMount) {
  (globalThis as any).__mount();
}
