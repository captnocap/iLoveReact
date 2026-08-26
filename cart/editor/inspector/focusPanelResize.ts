// inspector/focusPanelResize.ts — the focus panel's LEFT-EDGE DRAG, owned once
// (req_4772).
//
// The UV workspace was the first pane whose content could not live inside the
// 326px prop-inspector default, so the drag gesture was written inside
// Inspector.tsx with `uv` in every identifier. MODEL · STATS is the second: it
// renders a label column, two select controls and the reserved reset column on
// one row, which does not fit 326 at any font size. Nothing about the gesture
// was ever specific to UV authoring — the math reads REGIONS.focusPanel, and
// the pointer plumbing is the same three handlers — so it lives here and each
// pane names the width it is dragging.
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

export type FocusPanelResize<K extends string> = Readonly<{
  /** The live authored width per key; a key never dragged reads its initial. */
  widths: Record<K, number>;
  /** True for the duration of a drag, so the grip can light up. */
  resizing: boolean;
  /** Handlers for the grip that drags `key`'s width. */
  grip: (key: K) => FocusPanelGrip;
}>;

/**
 * Own the left-edge drag for one focus panel across every width it can wear.
 *
 * Widths are keyed because a pane may have more than one shape (the UV
 * workspace has a panel width and a focus width, and dragging one must not
 * move the other). Every key clamps to the same REGIONS.focusPanel policy, so
 * a pane cannot mint a private minimum by owning its own gesture.
 */
export function useFocusPanelResize<K extends string>(initialWidths: Record<K, number>): FocusPanelResize<K> {
  const [widths, setWidths] = useState(initialWidths);
  const [resizing, setResizing] = useState(false);
  const gestureRef = useRef<null | { key: K; startX: number; startWidth: number; viewportWidth: number }>(null);
  const pendingRef = useRef<null | { key: K; width: number }>(null);
  const framePendingRef = useRef(false);
  const generationRef = useRef(0);
  const widthsRef = useRef(widths);
  widthsRef.current = widths;
  const host = globalThis as any;

  const pointerX = (event: any): number => {
    const eventX = Number(event?.x);
    if (Number.isFinite(eventX)) return eventX;
    const hostX = Number(host.getMouseX?.());
    return Number.isFinite(hostX) ? hostX : 0;
  };
  const apply = (key: K, width: number) => {
    setWidths((current) => current[key] === width ? current : { ...current, [key]: width });
  };
  const queue = (key: K, width: number) => {
    pendingRef.current = { key, width };
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
      if (pending) apply(pending.key, pending.width);
    });
  };
  const widthAt = (event: any, gesture: { startX: number; startWidth: number; viewportWidth: number }) =>
    focusPanelWidthFromDrag(gesture.startWidth, gesture.startX, pointerX(event), gesture.viewportWidth);

  useEffect(() => () => {
    generationRef.current += 1;
    framePendingRef.current = false;
    pendingRef.current = null;
  }, []);

  const grip = (key: K): FocusPanelGrip => ({
    onMouseDown: (event: any) => {
      const reported = Number(host.__viewport_width?.());
      gestureRef.current = {
        key,
        startX: pointerX(event),
        startWidth: widthsRef.current[key],
        viewportWidth: Number.isFinite(reported) && reported > 0
          ? reported
          : REGIONS.focusPanel.resizeMaxWidth + REGIONS.focusPanel.minimumOutsideWidth,
      };
      setResizing(true);
    },
    onMouseMove: (event: any) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      queue(gesture.key, widthAt(event, gesture));
    },
    onMouseUp: (event: any) => {
      const gesture = gestureRef.current;
      gestureRef.current = null;
      generationRef.current += 1;
      framePendingRef.current = false;
      pendingRef.current = null;
      if (gesture) apply(gesture.key, widthAt(event, gesture));
      setResizing(false);
    },
  });

  return { widths, resizing, grip };
}
