// inspector/FocusEmpty.tsx — the ONE designed empty state every focus/inspector
// surface renders when nothing is selected (req_4435).
//
// THE LAW: a panel with no selection names WHAT IT SHOWS and THE ACTION THAT
// FILLS IT, in one line. It never renders an entity's values — not a
// default-initialized store pointer, not the first row of a catalog, not a
// synthetic placeholder object. Before this existed the boot frame described a
// "Concrete Floor" nobody had armed and focused an "Abalone Shell" nobody had
// clicked, because both were literal constants in initialState() and every
// panel treated its subject as non-nullable. A boot frame is a designed state
// or it is initialization residue; there is no third option.
//
// `shows` is the panel's own subject ("Piece focus", "Material"), `fill` is the
// concrete gesture that selects one ("click a placed piece"). The rendered line
// reads: Nothing selected — <fill>.
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';

export default function FocusEmpty(props: {
  /** What this panel shows once something IS selected. */
  shows: string;
  /** The gesture that fills it — a verb the user can perform right now. */
  fill: string;
  /** Lucide icon name; defaults to the neutral pointer. */
  icon?: string;
}) {
  return (
    <C.HW_FocusEmpty>
      <Icon name={props.icon ?? 'MousePointerClick'} size={18} color={accentFor('textFaint')} />
      <C.HW_FocusEmptyTitle>{props.shows}</C.HW_FocusEmptyTitle>
      <C.HW_FocusEmptyLine>{`Nothing selected — ${props.fill}`}</C.HW_FocusEmptyLine>
    </C.HW_FocusEmpty>
  );
}
