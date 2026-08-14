// editor/panelText.ts — THE OVERFLOW POLICY for every string the panels render
// (req_4435).
//
// A panel string either WRAPS or ELLIPSIZES. It never clips at its container
// and it never runs off the app edge, and the full value stays reachable
// through the row's tooltip.
//
// Why this is a module and not a habit: the VIEWS row printed
// "none — Store View pins this spot" and the tail fell off the right edge of
// the application. That was not one bad string. It was two structural facts,
// both of which every single-line label in the sheet shared:
//
//   1. PAINT. A `noWrap` text node measured clamped to its box but PAINTED its
//      natural width (framework/engine.zig drawNodeTextCommon passed draw
//      width 0). Paint now elides at the box — see drawLineElidedRGBA in
//      framework/primitive/text.zig.
//   2. LAYOUT. CSS `white-space: nowrap` opts a flex item out of the wrap
//      clamp, so its min-content floor is the whole string and flex-shrink
//      cannot pull it in. The browser's fix is the same one as ours:
//      `min-width: 0` (framework/layout_refactor.zig honours min_width when
//      distributing shrink).
//
// So a single-line label needs BOTH halves, always, and forgetting either one
// puts a string back off the edge. `oneLine()` stamps both. Declaring a
// single-line panel label any other way is the bug re-entering: the sheet's
// review check is that `noWrap: true` appears in editor classifier sheets ONLY
// inside this module's output.

/** Props half of the policy: one line, elided by the text engine at the box. */
export const ONE_LINE_PROPS = { noWrap: true, numberOfLines: 1 } as const;

/** Style half: the flex item may be pulled below its min-content width, which
 *  is the only thing that lets a nowrap string shrink instead of bleeding. */
export const ONE_LINE_STYLE = { flexShrink: 1, minWidth: 0 } as const;

type TextStyle = Record<string, unknown>;

/**
 * A single-line panel string classifier definition.
 *
 * Caller style merges OVER the policy's style, so a class that needs its own
 * `minWidth` (a fixed label column, say) still states it — but it must state it
 * deliberately, and it inherits `flexShrink` unless it overrides that too.
 */
export function oneLine(fontSize: number, color: string, style: TextStyle = {}): {
  type: 'Text';
  fontSize: number;
  color: string;
  noWrap: true;
  numberOfLines: 1;
  style: TextStyle;
} {
  return {
    type: 'Text',
    fontSize,
    color,
    ...ONE_LINE_PROPS,
    style: { ...ONE_LINE_STYLE, ...style },
  };
}

/**
 * A label COLUMN (the shared `HW_FormLabel` geometry): one line that holds its
 * column instead of shrinking, so every value in the panel starts on the same
 * x. The neighbouring value is what gives way when a row runs out of room —
 * shrinking the label instead would break the alignment the column exists for.
 */
export function oneLineColumn(fontSize: number, color: string, minWidth: number, style: TextStyle = {}) {
  return oneLine(fontSize, color, { flexShrink: 0, minWidth, ...style });
}
