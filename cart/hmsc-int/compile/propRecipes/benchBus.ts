import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const benchBusDef: PropKindDefinition = {
  kind: 'benchBus',
  label: 'Bus Bench',
  solid: true,
  footprintRadiusMeters: 0.5,
  heightMeters: 0.55,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'sit', seatHeightMeters: 0.45, capacity: 2 },
};

const WOOD = hx('#6b4a2e');
const METAL = hx('#3a3f46');

export function benchBusParts(): PropPartSpec[] {
  return [
    // seat slats
    box([0, 0.45, 0.1], [0.9, 0.04, 0.18], WOOD),
    box([0, 0.45, 0.3], [0.9, 0.04, 0.18], WOOD),
    box([0, 0.45, 0.5], [0.9, 0.04, 0.18], WOOD),
    // backrest slats
    box([0, 0.78, -0.28], [0.9, 0.18, 0.04], WOOD),
    box([0, 0.95, -0.28], [0.9, 0.18, 0.04], WOOD),
    // backrest supports
    box([-0.35, 0.6, -0.28], [0.04, 0.6, 0.04], METAL),
    box([0.35, 0.6, -0.28], [0.04, 0.6, 0.04], METAL),
    // front legs
    box([-0.35, 0.22, 0.4], [0.04, 0.44, 0.04], METAL),
    box([0.35, 0.22, 0.4], [0.04, 0.44, 0.04], METAL),
    // back legs
    box([-0.35, 0.22, -0.28], [0.04, 0.44, 0.04], METAL),
    box([0.35, 0.22, -0.28], [0.04, 0.44, 0.04], METAL),
    // armrests
    box([-0.42, 0.65, 0.1], [0.04, 0.04, 0.6], METAL),
    box([0.42, 0.65, 0.1], [0.04, 0.04, 0.6], METAL),
  ];
}
