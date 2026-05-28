import type { GameState } from '../design';
import { placeCell } from './grid';
import { cellsFromMasterLayout, HMSC_MASTER_LAYOUT, surfaceRegionsFromMasterLayout } from './masterLayout';

export function addDemoMapToState(state: GameState): GameState {
  const stateWithLayout: GameState = {
    ...state,
    world: {
      ...state.world,
      layout: {
        key: HMSC_MASTER_LAYOUT.key,
        label: HMSC_MASTER_LAYOUT.label,
        widthCells: HMSC_MASTER_LAYOUT.widthCells,
        depthCells: HMSC_MASTER_LAYOUT.depthCells,
      },
      surfaceRegions: surfaceRegionsFromMasterLayout(HMSC_MASTER_LAYOUT),
    },
  };

  return cellsFromMasterLayout(HMSC_MASTER_LAYOUT).reduce(
    (currentState, layoutCell) => placeCell(currentState, layoutCell.kind, layoutCell.cell, 'masterLayout', {
      triggerCommand: layoutCell.triggerCommand,
      triggerLabel: layoutCell.triggerLabel,
    }),
    stateWithLayout,
  );
}
