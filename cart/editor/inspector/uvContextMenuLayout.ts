// Pure sizing contract for the UV right-click menu.
//
// Row counts are only a first-frame estimate. The rendered menu's onLayout
// measurement becomes authoritative, so text metrics, dividers, or a newly
// added action cannot leave the popup hanging beyond the viewport.

export type UvMenuGroup = 'transform' | 'arrange' | 'snap' | 'edit' | 'texture';

export type UvContextMenuMeasure = Readonly<{
  group: UvMenuGroup | null;
  height: number;
}>;

export const UV_CONTEXT_MENU_TUNING = {
  // Long action + status pairs stay readable on one line. Shared context labels
  // are no-wrap; this width avoids turning that safety into routine truncation.
  widthPx: 300,
  edgePx: 4,
  baseHeightPx: 330,
  rowHeightPx: 26,
  expandedRows: { transform: 8, arrange: 6, snap: 6, edit: 2, texture: 10 } as Record<UvMenuGroup, number>,
} as const;

export function uvContextMenuHeight(
  group: UvMenuGroup | null,
  measure: UvContextMenuMeasure,
): number {
  if (measure.group === group && Number.isFinite(measure.height) && measure.height > 0) {
    return Math.ceil(measure.height);
  }
  return UV_CONTEXT_MENU_TUNING.baseHeightPx
    + (group ? UV_CONTEXT_MENU_TUNING.expandedRows[group] * UV_CONTEXT_MENU_TUNING.rowHeightPx : 0);
}
