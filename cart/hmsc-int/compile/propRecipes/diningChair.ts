import { box, hx, type Color, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

// diningChair owns ALL of its data — its registry def AND its geometry live here
// (the file with the most data owns it). game/kinds/props.ts imports diningChairDef.
export const diningChairDef: PropKindDefinition = {
  kind: 'diningChair',
  label: 'Dining Chair',
  solid: true,
  footprintRadiusMeters: 0.3,
  heightMeters: 0.95,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'sit', seatHeightMeters: 0.45, capacity: 1 },
  coverClass: 'soft',
};

// The shared chair frame — four legs + seat + a tilted backrest. Each chair TYPE
// is its own file (diningChair, armchair, officeChair, foldingChair); they share
// this one frame builder and differ by their default body/leg colours (a skin
// overrides those anyway). Geometry matches the original Furniture <Chair>.
export function chairFrame(body: Color, legs: Color): PropPartSpec[] {
  const seatY = diningChairDef.seat!.seatHeightMeters;
  return [
    box([0.2, seatY / 2, 0.2], [0.05, seatY, 0.05], legs),
    box([-0.2, seatY / 2, 0.2], [0.05, seatY, 0.05], legs),
    box([0.2, seatY / 2, -0.2], [0.05, seatY, 0.05], legs),
    box([-0.2, seatY / 2, -0.2], [0.05, seatY, 0.05], legs),
    box([0, seatY, 0], [0.5, 0.06, 0.5], body),                       // seat
    box([0, seatY + 0.27, 0.23], [0.5, 0.5, 0.05], body, [-6, 0, 0]), // backrest (tilted)
  ];
}

export function diningChairParts(): PropPartSpec[] {
  return chairFrame(hx('#8a6240'), hx('#6b4a2e')); // wood body, dark-wood legs
}
