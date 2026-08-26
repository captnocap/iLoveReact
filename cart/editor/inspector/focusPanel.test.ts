// cart/editor/inspector/focusPanel.test.ts — THE PANEL IS ON ONE WAVELENGTH
// (req_4774).
//
// The user's report: "there is no reason why one tab should have a extendable
// surface and another cant. also, the width churn between one tab to another is
// nausiating, it should carry the same width the user sets for every tab […]
// but when narrow the panel should also properly provide a usable surface to
// its best ability".
//
// Three invariants come out of that, and each one is a way the old panel was
// wrong:
//   1. ONE width. No pane owns a width, so switching panes cannot move the edge.
//   2. EVERY pane drags. The grip belongs to the shell, not to a list of panes.
//   3. Narrow is USABLE, not jammed. Below the derived breakpoint every row
//      stacks rather than squeezing its controls past legibility.
//
// Run with:
//   tools/esbuild cart/editor/inspector/focusPanel.test.ts --bundle \
//     --outfile=/tmp/editor-focus-panel.test.js --format=iife --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-focus-panel.test.js
import { REGIONS } from '../shell/regions';
import { ROW_STACK_BELOW_WIDTH, rowsStackAt } from './rowLayout';
import { focusPanelWidthFromDrag } from './focusPanelResize';
import { uvWorkspaceLayout } from './uvWorkspace';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const panel = REGIONS.focusPanel as Record<string, unknown>;

// ── 1. ONE width ───────────────────────────────────────────────────────────
const RETIRED_PER_PANE_WIDTHS = [
  'statsWidth', 'atlasWidth', 'atlasFocusWidth', 'characterRigWidth',
  'blobCompactWidth', 'blobWideWidth',
  'statsBodyWidth', 'atlasBodyWidth', 'atlasFocusBodyWidth', 'characterRigBodyWidth',
  'statsInnerWidth', 'atlasInnerWidth', 'atlasFocusInnerWidth', 'characterRigInnerWidth',
];
for (const key of RETIRED_PER_PANE_WIDTHS) {
  assert(panel[key] === undefined,
    `REGIONS.focusPanel.${key} is back — a per-pane width IS the tab-to-tab churn req_4774 removed`);
}
assert(typeof panel.width === 'number', 'the focus panel lost its one shared width');

// UV FOCUS is the last pane that used to change the width on its own. It
// decides CONTENT now; the edge only moves when the user drags it.
for (const width of [REGIONS.focusPanel.width, 520, 900]) {
  const normal = uvWorkspaceLayout(false, width);
  const focused = uvWorkspaceLayout(true, width);
  assert(normal.panelWidth === width && focused.panelWidth === width,
    `UV workspace overrode the panel width at ${width} — entering FOCUS must not move the edge`);
  assert(!focused.showIdentity && normal.showIdentity,
    'UV FOCUS stopped changing content, which is the only thing it is still allowed to change');
}

// ── 2. every width the drag can reach is a width the panel can render ──────
assert(REGIONS.focusPanel.resizeMinWidth < REGIONS.focusPanel.width,
  'the drag floor is not below the default, so the panel cannot be narrowed at all');
assert(REGIONS.focusPanel.resizeMaxWidth > REGIONS.focusPanel.width,
  'the drag ceiling is not above the default, so the panel cannot be widened at all');
assert(focusPanelWidthFromDrag(REGIONS.focusPanel.width, 1000, 4000, 1920) === REGIONS.focusPanel.resizeMinWidth,
  'dragging far right escaped the panel floor');
assert(focusPanelWidthFromDrag(REGIONS.focusPanel.width, 1000, 0, 1280) === 1280 - REGIONS.focusPanel.minimumOutsideWidth,
  'dragging far left stopped preserving the stage beside the panel');

// ── 3. narrow is usable, not jammed ────────────────────────────────────────
// The breakpoint is DERIVED from the densest row shape the panel contains. If
// someone hardcodes it, this arithmetic stops agreeing with it.
const { grid, focusPanel: region } = REGIONS;
const derived = region.railWidth + 1
  + region.gutter * 2 + grid.rowPaddingX * 2
  + grid.labelWidth + grid.columnGap + grid.endBtn + grid.columnGap
  + grid.controlMinWidth * 2 + grid.columnGap;
assert(ROW_STACK_BELOW_WIDTH === derived,
  `the stack breakpoint (${ROW_STACK_BELOW_WIDTH}) no longer equals the width the densest row needs (${derived})`);

assert(!rowsStackAt(REGIONS.focusPanel.width),
  'the DEFAULT panel width already stacks — the default must clear its own densest row');
assert(rowsStackAt(REGIONS.focusPanel.resizeMinWidth),
  'the narrowest panel does not stack, so its rows are squeezing instead of reflowing');
assert(rowsStackAt(ROW_STACK_BELOW_WIDTH - 1) && !rowsStackAt(ROW_STACK_BELOW_WIDTH),
  'the breakpoint is not the exact width it claims to be');

// A stacked row hands its controls the row's whole span minus the reserved
// reset column. At the floor that has to stay wide enough for two of them.
const stackedContentAtFloor = region.bodyWidthAt(region.resizeMinWidth)
  - region.gutter * 2 - grid.rowPaddingX * 2 - grid.endBtn - grid.columnGap;
assert(stackedContentAtFloor >= grid.controlMinWidth * 2 + grid.columnGap,
  `at the ${region.resizeMinWidth}px floor a stacked row gives two controls only ${stackedContentAtFloor}px — still jammed`);

console.log(`PASS focus panel — one width (${REGIONS.focusPanel.width}), drag ${REGIONS.focusPanel.resizeMinWidth}…${REGIONS.focusPanel.resizeMaxWidth}, rows stack below ${ROW_STACK_BELOW_WIDTH}`);
