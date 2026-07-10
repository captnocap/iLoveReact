// CLONED from cart/hmsc-int/floraData.ts kind tables — req_2178 (no cross-cart
// imports; clone-and-repurpose). The editor cart owns this copy.
//
// Flora is what GROWS on a cell — grass blades, palms, bushes — a channel
// SEPARATE from the ground tiles so a population layers over any surface
// (beach grass = sand GROUND + grass FLORA). Three lanes (grass/tree/bush) can
// occupy the same 1m cell; a kind paints only its lane. Index order IS the
// wire format the host map engine stores (MAPPAINT req_2473) and the palette
// order the ground-formula overlay tints by.

export type FloraKind =
  | 'grassSparse'
  | 'grassMed'
  | 'grassLush'
  | 'grassDry'
  | 'palmSparse'
  | 'palmMed'
  | 'palmDense'
  | 'bush'
  | 'grassFlowers'
  | 'pine'
  | 'maple'
  | 'oak'
  | 'cedar'
  | 'spruce'
  | 'grassTall'
  | 'grassReeds'
  | 'bushLow'
  | 'bushDense'
  | 'hydrangeaMophead'
  | 'hydrangeaPanicle'
  | 'leafyThicket'
  | 'wildWeedBush';

export type FloraLane = 'grass' | 'tree' | 'bush';
/** Lane indices the host engine stores lanes by (chunks.zig flora[lane]). */
export const FLORA_LANE_INDEX: Readonly<Record<FloraLane, number>> = { grass: 0, tree: 1, bush: 2 };

export type FloraKindDefinition = {
  kind: FloraKind;
  label: string;
  /** authoring swatch / overlay tint (distinct from ground tile colours) */
  color: string;
  lane: FloraLane;
  /** append-only host recipe id + authored density tuning */
  population: Readonly<{ spec: number; count: number; chance: number }>;
};

// The numeric ids mirror framework/world/foliage.zig Spec. Existing 0...3 are
// permanent; new recipes append. Keeping the ids named here makes the cart's
// content contract readable while the Zig boundary rejects unknown values.
export const FLORA_SPEC = {
  grass: 0,
  bush: 1,
  flowers: 2,
  palm: 3,
  pine: 4,
  maple: 5,
  oak: 6,
  cedar: 7,
  spruce: 8,
  tallGrass: 9,
  reeds: 10,
  lowBush: 11,
  denseBush: 12,
  hydrangeaMophead: 13,
  hydrangeaPanicle: 14,
  leafyThicket: 15,
  wildWeedBush: 16,
} as const;

// Ordered definitions. ORDER IS THE RMAP WIRE LEGEND: append, never reorder.
// The first nine are the original editor flora contract.
export const FLORA_KIND_DEFINITIONS: readonly FloraKindDefinition[] = [
  { kind: 'grassSparse', label: 'Grass (Sparse)', color: '#6f9a52', lane: 'grass', population: { spec: FLORA_SPEC.grass, count: 3, chance: 1 } },
  { kind: 'grassMed', label: 'Grass', color: '#4f8a34', lane: 'grass', population: { spec: FLORA_SPEC.grass, count: 7, chance: 1 } },
  { kind: 'grassLush', label: 'Grass (Lush)', color: '#2f6b28', lane: 'grass', population: { spec: FLORA_SPEC.grass, count: 16, chance: 1 } },
  { kind: 'grassDry', label: 'Dry Grass', color: '#9a8f4a', lane: 'grass', population: { spec: FLORA_SPEC.grass, count: 7, chance: 1 } },
  { kind: 'palmSparse', label: 'Palm Tree (Sparse)', color: '#3f7a4a', lane: 'tree', population: { spec: FLORA_SPEC.palm, count: 0, chance: 0.08 } },
  { kind: 'palmMed', label: 'Palm Trees', color: '#2f6b3a', lane: 'tree', population: { spec: FLORA_SPEC.palm, count: 0, chance: 0.22 } },
  { kind: 'palmDense', label: 'Palm Tree (Dense)', color: '#1f5230', lane: 'tree', population: { spec: FLORA_SPEC.palm, count: 0, chance: 0.7 } },
  { kind: 'bush', label: 'Bush', color: '#356326', lane: 'bush', population: { spec: FLORA_SPEC.bush, count: 14, chance: 1 } },
  { kind: 'grassFlowers', label: 'Flower Grass', color: '#d77ab6', lane: 'grass', population: { spec: FLORA_SPEC.flowers, count: 6, chance: 1 } },
  { kind: 'pine', label: 'NW Pine', color: '#245d35', lane: 'tree', population: { spec: FLORA_SPEC.pine, count: 0, chance: 0.22 } },
  { kind: 'maple', label: 'Maple Tree', color: '#4f7f32', lane: 'tree', population: { spec: FLORA_SPEC.maple, count: 0, chance: 0.18 } },
  { kind: 'oak', label: 'Oak Tree', color: '#3f6c2b', lane: 'tree', population: { spec: FLORA_SPEC.oak, count: 0, chance: 0.14 } },
  { kind: 'cedar', label: 'Western Red Cedar', color: '#1f5b4a', lane: 'tree', population: { spec: FLORA_SPEC.cedar, count: 0, chance: 0.2 } },
  { kind: 'spruce', label: 'Spruce Tree', color: '#1c5144', lane: 'tree', population: { spec: FLORA_SPEC.spruce, count: 0, chance: 0.22 } },
  { kind: 'grassTall', label: 'Tall Grass', color: '#5c8738', lane: 'grass', population: { spec: FLORA_SPEC.tallGrass, count: 8, chance: 1 } },
  { kind: 'grassReeds', label: 'Reeds', color: '#8b8a42', lane: 'grass', population: { spec: FLORA_SPEC.reeds, count: 6, chance: 1 } },
  { kind: 'bushLow', label: 'Low Bush', color: '#2f5e2a', lane: 'bush', population: { spec: FLORA_SPEC.lowBush, count: 10, chance: 1 } },
  { kind: 'bushDense', label: 'Dense Bush', color: '#214b23', lane: 'bush', population: { spec: FLORA_SPEC.denseBush, count: 22, chance: 1 } },
  { kind: 'hydrangeaMophead', label: 'Hydrangea (Mophead)', color: '#b94fa9', lane: 'bush', population: { spec: FLORA_SPEC.hydrangeaMophead, count: 0, chance: 1 } },
  { kind: 'hydrangeaPanicle', label: 'Hydrangea (Panicle)', color: '#e8b5b1', lane: 'bush', population: { spec: FLORA_SPEC.hydrangeaPanicle, count: 0, chance: 1 } },
  { kind: 'leafyThicket', label: 'Leafy Thicket', color: '#245b2e', lane: 'bush', population: { spec: FLORA_SPEC.leafyThicket, count: 0, chance: 1 } },
  { kind: 'wildWeedBush', label: 'Wild Weed Bush', color: '#39723b', lane: 'bush', population: { spec: FLORA_SPEC.wildWeedBush, count: 0, chance: 1 } },
];

/** The zone authoring swatch palette (zoneData.ts ZONE_COLORS clone). */
export const ZONE_COLORS = ['#a78bfa', '#f472b6', '#fb923c', '#34d399', '#60a5fa', '#facc15', '#f87171', '#22d3ee'];

// Flat host-door payload, derived from the ONE catalog so palette order and
// population order cannot drift. Wrapped trees/shrubs count as one shared-mesh
// instance when their chance gate wins; ground grass/bush counts are rows per cell.
export const FLORA_SPECS: Float32Array = new Float32Array(
  FLORA_KIND_DEFINITIONS.flatMap(({ population }) => [population.spec, population.count, population.chance]),
);
