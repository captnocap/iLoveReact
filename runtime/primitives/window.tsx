// runtime/primitives/window.tsx — Window + Notification primitives.
//
// Split out of runtime/primitives.tsx so the esbuild metafile can detect
// when a cart actually imports <Window>. The ship-tui flow uses this
// signal (-Dhas-window=true) to link SDL3 + the window-rendering engine
// subset into the otherwise-ANSI-only TUI binary. Carts that never
// reference Window or Notification pay nothing: tree-shaking drops this
// file from outputs[].inputs, ship-metafile-gate sees no trigger, and
// the TUI binary stays slim.
//
// Lazy React require matches primitives.tsx — same reason (the runtime
// init order causes a captured-at-init-time React.createElement to
// resolve to undefined).

function h(type: any, props: any, children: any): any {
  return require('react').createElement(type, props, children);
}

export const Window: any = (props: any) => {
  if ((globalThis as any).__TRACE_WINDOWS) {
    try {
      const childCount = Array.isArray(props.children) ? props.children.length : (props.children ? 1 : 0);
      console.log('[Window] render', JSON.stringify({
        title: props.title, width: props.width, height: props.height, childCount,
      }));
    } catch {}
  }
  return h('Window', props, props.children);
};

export const window: any = Window;
export const Notification: any = (props: any) => h('Notification', props, props.children);
export const notification: any = Notification;
