import { box, hx, panel, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const mailboxWallDef: PropKindDefinition = {
  kind: 'mailboxWall',
  label: 'Wall Mailbox',
  solid: true,
  footprintRadiusMeters: 0.12,
  heightMeters: 0.35,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
};

const WHITE = hx('#eef0f2');
const DARK = hx('#3a3f46');

export function mailboxWallParts(): PropPartSpec[] {
  return [
    // wall mounting plate
    box([0, 0.18, -0.05], [0.22, 0.3, 0.04], DARK),
    // mailbox body
    box([0, 0.18, 0.04], [0.24, 0.22, 0.14], WHITE),
    // curved top
    box([0, 0.31, 0.04], [0.24, 0.04, 0.14], WHITE),
    // front door
    panel('door', [0, 0.18, 0.12], [0.2, 0.16, 0.01], WHITE),
    // handle
    box([0.06, 0.18, 0.14], [0.03, 0.02, 0.02], DARK),
  ];
}
