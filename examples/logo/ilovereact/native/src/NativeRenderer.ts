/**
 * NativeRenderer: public API wrapping react-reconciler for Love2D native rendering.
 *
 * Creates a legacy sync root (tag 0) and exposes createRoot(), render(), and unmount().
 */

import Reconciler from 'react-reconciler';
import { hostConfig } from './hostConfig';
import { reportError } from './errorReporter';
import type { ReactNode } from 'react';

const reconciler = Reconciler(hostConfig);

interface Root {
  render(element: ReactNode): void;
  unmount(): void;
}

// Internal container type that the reconciler returns
type FiberRoot = ReturnType<typeof reconciler.createContainer>;

const rootMap = new Map<number, FiberRoot>();
let containerIdCounter = 0;

/**
 * Create a root for rendering React elements into the Love2D scene.
 *
 * @param container - Optional container descriptor. Defaults to an auto-generated one.
 * @returns An object with render() and unmount() methods.
 */
export function createRoot(container?: { id: number }): Root {
  const containerInfo = container ?? { id: ++containerIdCounter };

  // Tag 0 = LegacyRoot (sync)
  const fiberRoot = reconciler.createContainer(
    containerInfo,  // containerInfo
    0,              // tag: LegacyRoot
    null,           // hydrationCallbacks
    false,          // isStrictMode
    null,           // concurrentUpdatesByDefaultOverride
    '',             // identifierPrefix
    (err: Error) => reportError(err, 'React recoverable error'), // onRecoverableError
    null            // transitionCallbacks
  );

  rootMap.set(containerInfo.id, fiberRoot);

  return {
    render(element: ReactNode) {
      reconciler.updateContainer(element, fiberRoot, null, () => {});
    },
    unmount() {
      reconciler.updateContainer(null, fiberRoot, null, () => {});
      rootMap.delete(containerInfo.id);
    },
  };
}

/**
 * Convenience: render a React element into a new root.
 * Returns the root for later unmounting.
 */
export function render(element: ReactNode, container?: { id: number }): Root {
  const root = createRoot(container);
  root.render(element);
  return root;
}

/**
 * Convenience: unmount all roots created via render().
 */
export function unmountAll(): void {
  for (const [id, fiberRoot] of rootMap) {
    reconciler.updateContainer(null, fiberRoot, null, () => {});
  }
  rootMap.clear();
}
