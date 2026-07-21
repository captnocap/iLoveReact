import { REGIONS } from '../shell/regions';

export type UvWorkspaceLayout = Readonly<{
  focused: boolean;
  panelWidth: number;
  panelTitle: 'MODEL · PAINT' | 'UV WORKSPACE';
  toggleLabel: 'FOCUS' | 'RETURN';
  toggleTooltip: string;
  showIdentity: boolean;
  showPaintVariants: boolean;
  showScope: boolean;
}>;

/** One strict policy for the paint panel's two shapes. Focus mode spends its
 * entire body budget on UV authoring; leaving it restores every paint-panel
 * section without remounting the active model, atlas, or variant state. */
export function uvWorkspaceLayout(focused: boolean): UvWorkspaceLayout {
  return focused
    ? {
      focused: true,
      panelWidth: REGIONS.focusPanel.atlasFocusWidth,
      panelTitle: 'UV WORKSPACE',
      toggleLabel: 'RETURN',
      toggleTooltip: 'Return to the complete model paint panel',
      showIdentity: false,
      showPaintVariants: false,
      showScope: false,
    }
    : {
      focused: false,
      panelWidth: REGIONS.focusPanel.atlasWidth,
      panelTitle: 'MODEL · PAINT',
      toggleLabel: 'FOCUS',
      toggleTooltip: 'Open a large UV workspace for dense meshes',
      showIdentity: true,
      showPaintVariants: true,
      showScope: true,
    };
}
