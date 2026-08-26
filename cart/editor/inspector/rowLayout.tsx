// inspector/rowLayout.tsx — HOW A PANEL ROW BEHAVES WHEN THE PANEL IS NARROW
// (req_4774).
//
// The focus panel has ONE width and the user drags it. That makes "what does a
// row do when there is not enough room" a question the panel must answer, and
// the old answer was: nothing. Every row kept its fixed 82px label column and
// its reserved 18px reset column and let the controls in between shrink until
// two select boxes shared 60px and a clip called "speaker squawk" painted over
// its neighbour. Jammed, not narrow.
//
// The answer now is that the row STACKS: the label takes its own line and
// wraps, and the controls take the row's full span underneath it. That is what
// every narrow inspector does, and it is why a 300px panel is still usable
// rather than merely small.
//
// ONE breakpoint decides it for the WHOLE panel, not per row. A panel where
// some rows are inline and their neighbours are stacked reads as broken; a
// panel that switches wholesale at one width reads as a mode. Everything in
// the panel is on the same wavelength or the unification did not happen.
import { createContext, useContext } from 'react';
import { REGIONS } from '../shell/regions';

const { grid, focusPanel } = REGIONS;

/** What a row spends before its controls get anything: the inspector body's
 *  gutters, the row's own padding, the label column, the reserved reset
 *  column, and a gap on either side of the content. */
const ROW_FIXED_WIDTH =
  focusPanel.gutter * 2
  + grid.rowPaddingX * 2
  + grid.labelWidth
  + grid.columnGap
  + grid.endBtn
  + grid.columnGap;

/** The densest row shape the panel contains: label + TWO select controls +
 *  reset. Anything that fits this fits everything. */
const DENSEST_ROW_CONTENT_WIDTH = grid.controlMinWidth * 2 + grid.columnGap;

/**
 * Below this PANEL width, every row in the focus panel stacks. Derived, not
 * chosen: it is exactly the width at which the densest row stops fitting on
 * one line. `REGIONS.focusPanel.width` sits at or above it by construction,
 * so the default panel is inline and dragging narrower is what enters the
 * stacked mode.
 */
export const ROW_STACK_BELOW_WIDTH =
  focusPanel.railWidth + 1 + ROW_FIXED_WIDTH + DENSEST_ROW_CONTENT_WIDTH;

/** True when `panelWidth` cannot hold the densest row inline. */
export function rowsStackAt(panelWidth: number): boolean {
  return panelWidth < ROW_STACK_BELOW_WIDTH;
}

/**
 * The live focus-panel width, published once by the panel shell so no row has
 * to be told its geometry through six levels of props. Rows read the MODE, not
 * the number — a row that does its own arithmetic on the width is a second
 * breakpoint waiting to disagree with this one.
 */
const StackedRowsContext = createContext(false);

export const StackedRowsProvider = StackedRowsContext.Provider;

/** True when this row should put its label on its own line. */
export function useStackedRows(): boolean {
  return useContext(StackedRowsContext);
}
