import { box, cylinder16, hx, panel, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const mailboxResidentialDef: PropKindDefinition = {
  kind: 'mailboxResidential',
  label: 'Residential Mailbox',
  solid: true,
  footprintRadiusMeters: 0.18,
  heightMeters: 1.1,
  tileKind: 'wall',
  trafficControl: 'none',
};

const BLACK = hx('#1a1c1e');
const FLAG = hx('#c2362f');
const SILVER = hx('#9aa1ab');

export function mailboxResidentialParts(): PropPartSpec[] {
  return [
    // wooden post
    box([0, 0.45, 0], [0.08, 0.9, 0.08], hx('#6b4a2e')),
    // mailbox body (rounded rectangular)
    box([0, 0.9, 0], [0.36, 0.22, 0.2], BLACK),
    // curved top approximated by smaller cylinder
    cylinder16([0, 1.01, 0], 0.1, 0.2, BLACK, [0, 0, 90]),
    // door (front face)
    panel('door', [0.0, 0.9, 0.11], [0.3, 0.16, 0.01], SILVER),
    // red flag on the side
    box([0.19, 0.92, 0.02], [0.02, 0.12, 0.02], FLAG, [0, 0, 15]),
  ];
}
