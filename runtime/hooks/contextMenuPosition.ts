export type ContextMenuPoint = Readonly<{ x: number; y: number }>;
export type ContextMenuSize = Readonly<{ width: number; height: number }>;

/** Cursor menus keep a small breathing edge against the application window. */
export const CONTEXT_MENU_POSITION_TUNING = Object.freeze({
  viewportEdgePx: 4,
});

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/** Maximum menu box that can remain wholly inside the padded viewport. */
export function contextMenuViewportSize(
  viewport: ContextMenuSize,
  edgePx = CONTEXT_MENU_POSITION_TUNING.viewportEdgePx,
): ContextMenuSize {
  const edge = Math.max(0, finiteOr(edgePx, CONTEXT_MENU_POSITION_TUNING.viewportEdgePx));
  return {
    width: Math.max(0, finiteOr(viewport.width, 0) - edge * 2),
    height: Math.max(0, finiteOr(viewport.height, 0) - edge * 2),
  };
}

/**
 * Place a cursor menu in window coordinates. The cursor remains its top-left
 * anchor while the menu fits; an overflowing axis opens across the cursor,
 * then clamps to the viewport edge as the final guarantee.
 */
export function contextMenuPosition(
  cursor: ContextMenuPoint,
  menu: ContextMenuSize,
  viewport: ContextMenuSize,
  edgePx = CONTEXT_MENU_POSITION_TUNING.viewportEdgePx,
): ContextMenuPoint {
  const edge = Math.max(0, finiteOr(edgePx, CONTEXT_MENU_POSITION_TUNING.viewportEdgePx));
  const viewportWidth = Math.max(0, finiteOr(viewport.width, 0));
  const viewportHeight = Math.max(0, finiteOr(viewport.height, 0));
  const menuWidth = Math.max(0, finiteOr(menu.width, 0));
  const menuHeight = Math.max(0, finiteOr(menu.height, 0));
  const cursorX = finiteOr(cursor.x, edge);
  const cursorY = finiteOr(cursor.y, edge);

  // With no trustworthy host bounds yet, preserve the historical cursor
  // placement. The mounted menu will report its size and retry next render.
  if (viewportWidth <= 0 || viewportHeight <= 0 || menuWidth <= 0 || menuHeight <= 0) {
    return { x: cursorX, y: cursorY };
  }

  let x = cursorX;
  let y = cursorY;
  if (x + menuWidth > viewportWidth - edge) x = cursorX - menuWidth;
  if (y + menuHeight > viewportHeight - edge) y = cursorY - menuHeight;

  return {
    x: clamp(x, edge, Math.max(edge, viewportWidth - menuWidth - edge)),
    y: clamp(y, edge, Math.max(edge, viewportHeight - menuHeight - edge)),
  };
}
