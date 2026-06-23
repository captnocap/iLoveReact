import { box, cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const guitarDef: PropKindDefinition = {
  kind: 'guitar',
  label: 'Guitar',
  solid: true,
  footprintRadiusMeters: 0.45,
  footprintDepthMeters: 0.18,
  heightMeters: 0.15,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

export function guitarParts(): PropPartSpec[] {
  const wood = hx('#8a6240');
  const woodDark = hx('#6b4a2e');
  const fretboard = hx('#4a3525');
  const steel = hx('#9aa1ab');
  const black = hx('#22262b');
  return [
    // body: lower bout + upper bout
    box([-0.14, 0.035, 0], [0.38, 0.06, 0.3], wood),
    box([0.1, 0.035, 0], [0.24, 0.05, 0.2], wood),
    // waist pinches visually by overlap color strip
    box([0.02, 0.04, 0], [0.08, 0.055, 0.22], woodDark),
    // soundhole
    cylinder8([-0.1, 0.055, 0.02], 0.05, 0.02, black),
    // bridge
    box([-0.18, 0.055, 0.12], [0.14, 0.03, 0.03], woodDark),
    // neck
    box([0.38, 0.035, 0.01], [0.52, 0.04, 0.08], fretboard),
    // fret markers
    box([0.35, 0.058, 0.01], [0.04, 0.01, 0.04], steel),
    box([0.48, 0.058, 0.01], [0.04, 0.01, 0.04], steel),
    box([0.6, 0.058, 0.01], [0.04, 0.01, 0.04], steel),
    // headstock
    box([0.72, 0.035, 0.01], [0.16, 0.07, 0.11], wood),
    // tuning pegs
    box([0.66, 0.05, 0.07], [0.04, 0.02, 0.02], steel),
    box([0.72, 0.05, 0.07], [0.04, 0.02, 0.02], steel),
    box([0.78, 0.05, 0.07], [0.04, 0.02, 0.02], steel),
  ];
}
