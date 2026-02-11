// NativeBridge
export { NativeBridge } from './NativeBridge';

// Event dispatcher
export { initEventDispatching } from './eventDispatcher';

// Host config and helpers
export {
  hostConfig,
  handlerRegistry,
  extractHandlers,
  flushToHost,
  setTransportFlush,
  getRootInstances,
  shallowEqual,
  type Instance,
  type TextInstance,
} from './hostConfig';

// NativeRenderer
export { createRoot, render, unmountAll } from './NativeRenderer';

// Love2D app factory
export { createLove2DApp, type Love2DAppHandle } from './Love2DApp';

// Text measurement
export {
  measureText,
  type TextMeasurement,
  type MeasureTextOptions,
} from './measureText';

// Re-export shared types, hooks, and context
export {
  type IBridge,
  type BridgeEvent,
  type Listener,
  type Unsubscribe,
  type Style,
  type Color,
  type LoveEvent,
  type BoxProps,
  type TextProps,
  type ImageProps,
  type RendererMode,
  BridgeProvider,
  useBridge,
  RendererProvider,
  useRendererMode,
  useLove,
  useLoveEvent,
  useLoveRPC,
  useLoveState,
  useLoveReady,
  useLoveSend,
  useLoveOverlays,
  type Overlay,
  Box,
  Text,
  Image,
  styleToCSS,
  colorToCSS,
} from '../../shared/src';
