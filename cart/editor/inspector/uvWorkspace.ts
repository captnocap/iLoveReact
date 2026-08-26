import { REGIONS } from '../shell/regions';

/** Every UV authoring layer must yield its minimum and claim the remaining
 * panel height. Sharing this pair prevents one wrapper from quietly turning
 * Focus back into a fixed-height preview. */
export const UV_WORKSPACE_FLEX_STYLE = Object.freeze({
  flexGrow: 1 as const,
  minHeight: 0 as const,
});

export type UvWorkspaceLayout = Readonly<{
  focused: boolean;
  panelWidth: number;
  panelTitle: 'MODEL · PAINT' | 'UV WORKSPACE';
  emptyState: 'row' | 'workspace';
  toggleLabel: 'FOCUS' | 'RETURN';
  toggleTooltip: string;
  showIdentity: boolean;
  showPaintVariants: boolean;
  showScope: boolean;
}>;

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

/** One strict policy for the paint panel's two shapes. Focus mode spends its
 * entire body budget on UV authoring; leaving it restores every paint-panel
 * section without remounting the active model, atlas, or variant state. */
export function uvWorkspaceLayout(focused: boolean, authoredWidth?: number): UvWorkspaceLayout {
  const fallbackWidth = focused ? REGIONS.focusPanel.atlasFocusWidth : REGIONS.focusPanel.atlasWidth;
  const panelWidth = clamp(
    Number.isFinite(authoredWidth) ? Math.round(authoredWidth!) : fallbackWidth,
    REGIONS.focusPanel.resizeMinWidth,
    REGIONS.focusPanel.resizeMaxWidth,
  );
  return focused
    ? {
      focused: true,
      panelWidth,
      panelTitle: 'UV WORKSPACE',
      emptyState: 'workspace',
      toggleLabel: 'RETURN',
      toggleTooltip: 'Return to the complete model paint panel',
      showIdentity: false,
      showPaintVariants: false,
      showScope: false,
    }
    : {
      focused: false,
      panelWidth,
      panelTitle: 'MODEL · PAINT',
      emptyState: 'row',
      toggleLabel: 'FOCUS',
      toggleTooltip: 'Open a large UV workspace for dense meshes',
      showIdentity: true,
      showPaintVariants: true,
      showScope: true,
    };
}
