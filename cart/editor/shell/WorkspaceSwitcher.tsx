// editor/shell/WorkspaceSwitcher.tsx — the front door to every studio (req_4464).
//
// One labelled strip in the chrome, immediately after the menus, because "where
// am I working" belongs beside "what can I do here" and NOT mixed in with the
// map pill and the Editor/Play route toggle at the far right. Those answer
// different questions and now live in different groups.
//
// Every destination is always reachable and always goes somewhere: one that
// needs a subject it does not have lands on Home filtered to that subject,
// where the recents and favorites are. See shell/destinations.ts.
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { DESTINATIONS, type DestinationId } from './destinations';

export default function WorkspaceSwitcher(props: {
  active: DestinationId | null;
  onGo: (id: DestinationId) => void;
}) {
  return (
    <C.HW_Switcher>
      {DESTINATIONS.map((destination) => {
        const here = props.active === destination.id;
        const Slot = here ? C.HW_SwitcherSlotOn : C.HW_SwitcherSlot;
        const Label = here ? C.HW_SwitcherLabelOn : C.HW_SwitcherLabel;
        return (
          <Slot
            key={destination.id}
            onPress={() => props.onGo(destination.id)}
            // The tooltip carries what you DO there plus the key that gets you
            // there — a strip of nouns is only discoverable if each one says
            // what it is for.
            tooltip={`${destination.label} — ${destination.does} (${destination.key})`}
          >
            <Icon name={destination.icon} size={13} color={accentFor(here ? 'segActiveText' : 'textDim')} />
            <Label>{destination.label}</Label>
          </Slot>
        );
      })}
    </C.HW_Switcher>
  );
}
