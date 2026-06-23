import { box, hx, panel, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const mailboxApartmentDef: PropKindDefinition = {
  kind: 'mailboxApartment',
  label: 'Apartment Mailboxes',
  solid: true,
  footprintRadiusMeters: 0.5,
  heightMeters: 1.4,
  tileKind: 'wall',
  trafficControl: 'none',
};

const METAL = hx('#4a4a4e');
const METAL_DARK = hx('#2c2c2e');
const DOOR = hx('#515155');

export function mailboxApartmentParts(): PropPartSpec[] {
  return [
    // legs / frame posts
    box([-0.4, 0.35, -0.2], [0.05, 0.7, 0.05], METAL_DARK),
    box([0.4, 0.35, -0.2], [0.05, 0.7, 0.05], METAL_DARK),
    box([-0.4, 0.35, 0.2], [0.05, 0.7, 0.05], METAL_DARK),
    box([0.4, 0.35, 0.2], [0.05, 0.7, 0.05], METAL_DARK),
    // main bank
    box([0, 0.95, 0], [0.9, 0.7, 0.5], METAL),
    // individual mailbox doors (2 rows x 3 cols)
    box([-0.25, 1.15, 0.26], [0.22, 0.22, 0.02], DOOR),
    box([0.0, 1.15, 0.26], [0.22, 0.22, 0.02], DOOR),
    box([0.25, 1.15, 0.26], [0.22, 0.22, 0.02], DOOR),
    box([-0.25, 0.82, 0.26], [0.22, 0.22, 0.02], DOOR),
    box([0.0, 0.82, 0.26], [0.22, 0.22, 0.02], DOOR),
    box([0.25, 0.82, 0.26], [0.22, 0.22, 0.02], DOOR),
    // small label / lock on each door
    box([-0.25, 1.05, 0.28], [0.04, 0.01, 0.01], METAL_DARK),
    box([0.0, 1.05, 0.28], [0.04, 0.01, 0.01], METAL_DARK),
    box([0.25, 1.05, 0.28], [0.04, 0.01, 0.01], METAL_DARK),
    box([-0.25, 0.72, 0.28], [0.04, 0.01, 0.01], METAL_DARK),
    box([0.0, 0.72, 0.28], [0.04, 0.01, 0.01], METAL_DARK),
    box([0.25, 0.72, 0.28], [0.04, 0.01, 0.01], METAL_DARK),
    // top slot panel
    panel('slots', [0, 1.32, 0.26], [0.8, 0.08, 0.01], METAL_DARK),
  ];
}
