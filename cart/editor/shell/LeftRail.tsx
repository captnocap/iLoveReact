// SECTION B — Left Rail (see shell/regions.ts SECTIONS): the vertical domain
// icon stack on the window's left edge (Eye, Grid, Box, Actor, Data, Pipeline).
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { DOMAINS } from '../data/content';
import type { EditorState } from '../data/types';

export default function LeftRail({ state, onDomain }: { state: EditorState; onDomain: (domain: string) => void }) {
  return (
    <C.HW_LeftRail>
      {DOMAINS.map(([domain, icon]) => {
        const Btn = state.activeDomain === domain ? C.HW_RailButtonOn : C.HW_RailButton;
        return (
          <Btn key={domain} onPress={() => onDomain(domain)}>
            <Icon name={icon} size={15} color={accentFor(state.activeDomain === domain ? 'primary' : 'textDim')} />
          </Btn>
        );
      })}
    </C.HW_LeftRail>
  );
}
