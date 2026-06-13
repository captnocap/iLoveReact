import { box, hx, type Color, type PropPartSpec } from '../../game/kinds/propModels';

// The shared chair frame — four legs + seat + a tilted backrest. Each chair TYPE
// is its own file (diningChair, armchair, officeChair, foldingChair); they share
// this one frame builder and differ by their default body/leg colours (a skin
// overrides those anyway). Geometry matches the original Furniture <Chair>.
export function chairFrame(body: Color, legs: Color): PropPartSpec[] {
  const seatY = 0.45;
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
