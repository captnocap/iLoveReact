// inspector/FocusPanelShell.tsx — THE ONE FOCUS PANEL MOUNT (req_4774).
//
// Section G used to be mounted seven separate times inside Inspector.tsx: the
// Material Lab, the animation panel, playtest globals, the world outliner, the
// world piece focus, the model focus, and the generic fallback. Six of them
// wrote `<C.HW_RightPanel>` bare and inherited a fixed width; one wrote a
// five-branch width expression and was the only one that could be dragged.
// That is the whole reason a tab could have a resizable surface and its
// neighbour could not, and the reason switching tabs made the panel jump.
//
// So the mount is a component. It owns the width, the grip, the head, the
// collapse button and the rail; a pane supplies only its BODY. A pane cannot
// opt out of being resizable, because it never touches the panel element — and
// a pane cannot invent a width, because it is never asked for one.
//
// Panes whose whole surface is its own component (the Lab inspector, the
// animation panel) pass `ownsHead` and render their own head inside the body
// slot. They still get the width, the grip and the rail from here.
import type { ReactNode } from 'react';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import type { FocusPanelGrip } from './focusPanelResize';
import { StackedRowsProvider, rowsStackAt } from './rowLayout';

export default function FocusPanelShell(props: {
  /** The one live panel width — the same number for every pane. */
  width: number;
  /** Left-edge drag handlers from `useFocusPanelResize`. */
  grip: FocusPanelGrip;
  /** True while the drag is in flight, so the grip can light up. */
  resizing: boolean;
  /** The pane-switch rail; always the panel's right-hand column. */
  rail: ReactNode;
  /** Kicker text for the shared head. Omit only when `ownsHead` is set. */
  title?: string;
  /** Buttons that sit left of the collapse button in the shared head. */
  headExtras?: ReactNode;
  onCollapse: () => void;
  /** The pane renders its own head and body (Lab inspector, animation panel). */
  ownsHead?: boolean;
  children: ReactNode;
}) {
  const body = (
    <StackedRowsProvider value={rowsStackAt(props.width)}>
      {props.ownsHead ? props.children : (
        <C.HW_Inspector>
          <C.HW_PanelHead>
            <C.HW_Kicker>{props.title}</C.HW_Kicker>
            <C.HW_Spacer />
            {props.headExtras}
            <C.HW_PanelHeadButton tooltip="Collapse focus panel" onPress={props.onCollapse}>
              <Icon name="PanelRightClose" size={12} color={accentFor('textFaint')} />
            </C.HW_PanelHeadButton>
          </C.HW_PanelHead>
          {props.children}
        </C.HW_Inspector>
      )}
    </StackedRowsProvider>
  );
  return (
    <C.HW_RightPanel style={{ width: props.width }}>
      <C.HW_RightResizeGrip
        tooltip="Drag to resize the focus panel"
        {...props.grip}
        style={props.resizing ? { backgroundColor: accentFor('segActiveBg') } : undefined}
      >
        <C.HW_RightResizeLine />
      </C.HW_RightResizeGrip>
      {body}
      {props.rail}
    </C.HW_RightPanel>
  );
}
