import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { DOMAINS } from '../data/content';
import type { MockState } from '../data/types';

export default function LeftRail({ state, onDomain }: { state: MockState; onDomain: (domain: string) => void }) {
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
      <C.HW_Spacer />
      <C.HW_RailButton onPress={() => onDomain('playtest')}><Icon name="PlayCircle" size={15} color={accentFor('textDim')} /></C.HW_RailButton>
      <C.HW_RailButton onPress={() => onDomain('lighting')}><Icon name="Sun" size={15} color={accentFor('textDim')} /></C.HW_RailButton>
    </C.HW_LeftRail>
  );
}
