// inspector/focusPanelResize.ts — the focus panel's LEFT-EDGE DRAG, and its ONE
// WIDTH (req_4772, unified by req_4774).
//
// The gesture started life inside Inspector.tsx with `uv` in every identifier,
// because the UV workspace was the first pane that could not live inside the
// prop-inspector default. Then MODEL · STATS needed the same thing, and the
// keyed-per-pane version this file first shipped was still wrong: a width that
// belongs to a PANE makes the panel jump every time you switch tabs, and makes
// "which tabs can be dragged" a list somebody has to maintain.
//
// So there is one width. Every pane wears it, every pane can drag it, and the
// only thing that changes it is the user. It is seeded from the caller (the
// restored session width, or REGIONS.focusPanel.width on a cold start) and
// reported back on every settled drag so the session can persist it.
//
// The rAF queue is not decoration: a raw setState per mouse-move relayouts the
// whole panel on every pointer sample, and the panel is the surface being
// dragged. Coalescing to one width per frame is what keeps the drag readable.
import { useEffect, useRef, useState } from 'react';
import { REGIONS } from '../shell/regions';

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

/** Resolve the right-panel width from a left-edge drag. Moving left grows the
 * panel; moving right shrinks it. The live viewport bound always preserves a
 * useful amount of stage and rail space beside the panel. */
export function focusPanelWidthFromDrag(
  startWidth: number,
  startPointerX: number,
  pointerX: number,
  viewportWidth: number,
): number {
  const policy = REGIONS.focusPanel;
  const liveMaximum = Math.max(
    policy.resizeMinWidth,
    Math.min(policy.resizeMaxWidth, Math.floor(viewportWidth) - policy.minimumOutsideWidth),
  );
  const requested = startWidth + startPointerX - pointerX;
  const stepped = Math.round(requested / policy.resizeStep) * policy.resizeStep;
  return clamp(stepped, policy.resizeMinWidth, liveMaximum);
}

/** The three handlers a resize grip binds, already bound to one width key. */
export type FocusPanelGrip = Readonly<{
  onMouseDown: (event: any) => void;
  onMouseMove: (event: any) => void;
  onMouseUp: (event: any) => void;
}>;

export type FocusPanelResize = Readonly<{
  /** The one live panel width. */
  width: number;
  /** True for the duration of a drag, so the grip can light up. */
  resizing: boolean;
  /** Handlers for the panel's left-edge grip. */
  grip: FocusPanelGrip;
}>;

/**
 * Own the focus panel's width and its left-edge drag.
 *
 * `initialWidth` is the width to open at — a restored session width, or the
 * shared default. `onSettled` fires once per completed drag with the final
 * width, which is the only moment worth persisting (every intermediate frame
 * of a drag is not a decision).
 */
export function useFocusPanelResize(
  initialWidth: number,
  onSettled?: (width: number) => void,
): FocusPanelResize {
  const [width, setWidth] = useState(() => clamp(
    Math.round(initialWidth),
    REGIONS.focusPanel.resizeMinWidth,
    REGIONS.focusPanel.resizeMaxWidth,
  ));
  const [resizing, setResizing] = useState(false);
  const gestureRef = useRef<null | { startX: number; startWidth: number; viewportWidth: number }>(null);
  const pendingRef = useRef<number | null>(null);
  const framePendingRef = useRef(false);
  const generationRef = useRef(0);
  const widthRef = useRef(width);
  widthRef.current = width;
  const host = globalThis as any;

  const pointerX = (event: any): number => {
    const eventX = Number(event?.x);
    if (Number.isFinite(eventX)) return eventX;
    const hostX = Number(host.getMouseX?.());
    return Number.isFinite(hostX) ? hostX : 0;
  };
  const queue = (next: number) => {
    pendingRef.current = next;
    if (framePendingRef.current) return;
    framePendingRef.current = true;
    const generation = generationRef.current;
    const schedule: (callback: () => void) => unknown = typeof host.requestAnimationFrame === 'function'
      ? host.requestAnimationFrame.bind(host)
      : (callback) => setTimeout(callback, REGIONS.focusPanel.resizePreviewIntervalMs);
    schedule(() => {
      if (generation !== generationRef.current) return;
      framePendingRef.current = false;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending !== null) setWidth(pending);
    });
  };
  const widthAt = (event: any, gesture: { startX: number; startWidth: number; viewportWidth: number }) =>
    focusPanelWidthFromDrag(gesture.startWidth, gesture.startX, pointerX(event), gesture.viewportWidth);

  useEffect(() => () => {
    generationRef.current += 1;
    framePendingRef.current = false;
    pendingRef.current = null;
  }, []);

  const grip: FocusPanelGrip = {
    onMouseDown: (event: any) => {
      const reported = Number(host.__viewport_width?.());
      gestureRef.current = {
        startX: pointerX(event),
        startWidth: widthRef.current,
        viewportWidth: Number.isFinite(reported) && reported > 0
          ? reported
          : REGIONS.focusPanel.resizeMaxWidth + REGIONS.focusPanel.minimumOutsideWidth,
      };
      setResizing(true);
    },
    onMouseMove: (event: any) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      queue(widthAt(event, gesture));
    },
    onMouseUp: (event: any) => {
      const gesture = gestureRef.current;
      gestureRef.current = null;
      generationRef.current += 1;
      framePendingRef.current = false;
      pendingRef.current = null;
      setResizing(false);
      if (!gesture) return;
      const settled = widthAt(event, gesture);
      setWidth(settled);
      onSettled?.(settled);
    },
  };

  return { width, resizing, grip };
}
