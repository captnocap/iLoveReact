// Window — OS chrome around a child app. State (position, size,
// maximized rect, focus) lives in Desktop; this component is pure
// render + event-bridge.
//
// Drag uses the framework's pointer-capture mechanism: a node that
// declares onMouseMove or onMouseUp automatically captures pointer
// events until release, even when the cursor leaves the node. We put
// all three (down/move/up) on the title bar so the engine wires up
// capture and dispatch goes back to the title bar regardless of where
// the cursor wanders. (Earlier attempt used a separate overlay node
// for move/up — without capture, mouseUp on the overlay never fired
// and the window appeared "frozen" because the overlay stayed mounted
// and blocked every subsequent click.)

import { classifiers as C } from '../../../../runtime/classifier';
import './Window.cls';

export interface WindowProps {
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z?: number;
  focused?: boolean;
  maximized?: boolean;
  onClose?: () => void;
  onMin?: () => void;
  onMax?: () => void;
  onFocus?: () => void;
  /** Title-bar drag callbacks. All three are forwarded to Desktop,
   *  which owns the per-window (x, y) state and a transient drag
   *  session that tracks the cursor→window offset. */
  onTitleMouseDown?: (payload: { x: number; y: number }) => void;
  onTitleMouseMove?: (payload: { x: number; y: number }) => void;
  onTitleMouseUp?: (payload: { x: number; y: number }) => void;
  children: any;
}

export function Window({
  title, x, y, w, h, z = 1, focused = false, maximized = false,
  onClose, onMin, onMax, onFocus,
  onTitleMouseDown, onTitleMouseMove, onTitleMouseUp,
  children,
}: WindowProps) {
  return (
    <C.WindowRoot
      onPress={onFocus}
      style={maximized ? {
        position: 'absolute',
        left: 0,
        top: 0,
        right: 0,
        // Reserve the bottom 40px for the taskbar. If the taskbar moves
        // (macOS top), Desktop can swap variants and we'd inset the
        // opposite edge — first cut assumes bottom taskbar.
        bottom: 40,
        zIndex: z,
      } : {
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        zIndex: z,
        opacity: focused ? 1 : 0.96,
      }}
    >
      <C.WindowTitleBar
        onMouseDown={(payload: any) => {
          // Don't begin a drag if the window is currently maximized — that
          // matches OS convention where the title bar of a snapped window
          // is non-draggable until restored.
          if (maximized) return;
          if (onFocus) onFocus();
          if (onTitleMouseDown) onTitleMouseDown({ x: payload?.x ?? 0, y: payload?.y ?? 0 });
        }}
        onMouseMove={(payload: any) => {
          if (maximized) return;
          if (onTitleMouseMove) onTitleMouseMove({ x: payload?.x ?? 0, y: payload?.y ?? 0 });
        }}
        onMouseUp={(payload: any) => {
          if (onTitleMouseUp) onTitleMouseUp({ x: payload?.x ?? 0, y: payload?.y ?? 0 });
        }}
      >
        <C.WindowTitleText>{title}</C.WindowTitleText>
        <C.WindowControls>
          {onMin ? (
            <C.WindowControlMin onPress={onMin}>
              <C.WindowControlBtnText>–</C.WindowControlBtnText>
            </C.WindowControlMin>
          ) : null}
          {onMax ? (
            <C.WindowControlMax onPress={onMax}>
              <C.WindowControlBtnText>{maximized ? '❐' : '☐'}</C.WindowControlBtnText>
            </C.WindowControlMax>
          ) : null}
          {onClose ? (
            <C.WindowControlClose onPress={onClose}>
              <C.WindowControlBtnText>×</C.WindowControlBtnText>
            </C.WindowControlClose>
          ) : null}
        </C.WindowControls>
      </C.WindowTitleBar>
      <C.WindowBody>
        {children}
      </C.WindowBody>
    </C.WindowRoot>
  );
}
