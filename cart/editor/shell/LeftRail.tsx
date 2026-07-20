// SECTION B — Left Rail (see shell/regions.ts SECTIONS): contextual input panes.
// Paint joins the relevant source libraries while the stage is painting, so
// either surface can reopen in the same slot. Selecting the active button again
// folds Section C away.
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { leftPanelsFor, resolvedPanelId, type LeftPanelId } from '../data/panelSystem';
import type { WorkspaceDocumentKind } from '../data/types';

export default function LeftRail(props: {
  documentKind: WorkspaceDocumentKind;
  paintActive: boolean;
  activePane: string;
  collapsed: boolean;
  onPane: (pane: LeftPanelId) => void;
}) {
  const panes = leftPanelsFor(props.documentKind, props.paintActive);
  const activePane = resolvedPanelId(panes, props.activePane);
  return (
    <C.HW_LeftRail>
      {panes.map((pane) => {
        const active = activePane === pane.id;
        const Btn = active ? C.HW_RailButtonOn : C.HW_RailButton;
        return (
          <Btn
            key={pane.id}
            tooltip={active ? `${pane.label} — ${props.collapsed ? 'open panel' : 'collapse panel'}` : `Open ${pane.label}`}
            onPress={() => props.onPane(pane.id)}
          >
            <Icon name={pane.icon} size={15} color={accentFor(active ? 'primary' : 'textDim')} />
          </Btn>
        );
      })}
    </C.HW_LeftRail>
  );
}
