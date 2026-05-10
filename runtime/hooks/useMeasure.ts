/**
 * useMeasure — read the laid-out rect of a primitive.
 *
 * The Zig layout pass fires an `onLayout` event whenever a node's computed
 * rect actually changes; the runtime's `__dispatchLayout` routes those into
 * the React handlerRegistry. This hook plugs into that path: spread the
 * returned `onLayout` onto a primitive, read `rect` for the result.
 *
 * `version` increments once per rect change. It's a useful "did I just get
 * remeasured?" signal — render counter / cache invalidation key / debug
 * counter — without forcing callers to deep-compare rects themselves.
 *
 * Example:
 *   const { rect, version, onLayout } = useMeasure();
 *   return (
 *     <Box onLayout={onLayout}>
 *       {rect && <Text>{`${rect.width}×${rect.height} (v${version})`}</Text>}
 *     </Box>
 *   );
 */
import { useCallback, useState } from 'react';

export interface MeasuredRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UseMeasureResult {
  rect: MeasuredRect | null;
  /** Bumps every time `rect` changes. 0 until first measure lands. */
  version: number;
  onLayout: (r: MeasuredRect) => void;
}

interface MeasureState {
  rect: MeasuredRect | null;
  version: number;
}

const INITIAL: MeasureState = { rect: null, version: 0 };

export function useMeasure(): UseMeasureResult {
  const [state, setState] = useState<MeasureState>(INITIAL);
  const onLayout = useCallback((r: MeasuredRect) => {
    setState((prev) => {
      if (
        prev.rect !== null &&
        prev.rect.x === r.x &&
        prev.rect.y === r.y &&
        prev.rect.width === r.width &&
        prev.rect.height === r.height
      ) {
        return prev;
      }
      return { rect: r, version: prev.version + 1 };
    });
  }, []);
  return { rect: state.rect, version: state.version, onLayout };
}
