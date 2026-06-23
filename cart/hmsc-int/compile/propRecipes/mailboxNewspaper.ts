import { box, hx, panel, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const mailboxNewspaperDef: PropKindDefinition = {
  kind: 'mailboxNewspaper',
  label: 'Newspaper Box',
  solid: true,
  footprintRadiusMeters: 0.12,
  heightMeters: 0.55,
  tileKind: 'wall',
  trafficControl: 'none',
};

const GREEN = hx('#3f7d33');
const DARK = hx('#1a1c1e');
const PAPER = hx('#eef0f2');

export function mailboxNewspaperParts(): PropPartSpec[] {
  return [
    // short post
    box([0, 0.18, 0], [0.06, 0.36, 0.06], DARK),
    // box body
    box([0, 0.45, 0], [0.24, 0.26, 0.16], GREEN),
    // top lid (sloped look via stacked boxes)
    box([0, 0.59, 0], [0.26, 0.04, 0.18], DARK),
    // clear window showing papers
    panel('window', [0, 0.48, 0.085], [0.18, 0.12, 0.01], PAPER),
    // coin slot
    box([0.05, 0.55, 0.09], [0.04, 0.01, 0.01], DARK),
  ];
}
