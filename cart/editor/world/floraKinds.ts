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
  | 'grassFlowers';

export type FloraLane = 'grass' | 'tree' | 'bush';
/** Lane indices the host engine stores lanes by (chunks.zig flora[lane]). */
export const FLORA_LANE_INDEX: Readonly<Record<FloraLane, number>> = { grass: 0, tree: 1, bush: 2 };

export type FloraKindDefinition = {
  kind: FloraKind;
  label: string;
  /** authoring swatch / overlay tint (distinct from ground tile colours) */
  color: string;
  lane: FloraLane;
};

// Ordered definitions — verbatim labels/colors/lanes from hmsc floraData.ts.
export const FLORA_KIND_DEFINITIONS: readonly FloraKindDefinition[] = [
  { kind: 'grassSparse', label: 'Grass (Sparse)', color: '#6f9a52', lane: 'grass' },
  { kind: 'grassMed', label: 'Grass', color: '#4f8a34', lane: 'grass' },
  { kind: 'grassLush', label: 'Grass (Lush)', color: '#2f6b28', lane: 'grass' },
  { kind: 'grassDry', label: 'Dry Grass', color: '#9a8f4a', lane: 'grass' },
  { kind: 'palmSparse', label: 'Palm Tree (Sparse)', color: '#3f7a4a', lane: 'tree' },
  { kind: 'palmMed', label: 'Palm Trees', color: '#2f6b3a', lane: 'tree' },
  { kind: 'palmDense', label: 'Palm Tree (Dense)', color: '#1f5230', lane: 'tree' },
  { kind: 'bush', label: 'Bush', color: '#356326', lane: 'bush' },
  { kind: 'grassFlowers', label: 'Flower Grass', color: '#d77ab6', lane: 'grass' },
];

/** The zone authoring swatch palette (zoneData.ts ZONE_COLORS clone). */
export const ZONE_COLORS = ['#a78bfa', '#f472b6', '#fb923c', '#34d399', '#60a5fa', '#facc15', '#f87171', '#22d3ee'];

// The flora POPULATION CONTRACT (req_2497) — per kind [spec, count, chance]
// triples in FLORA_KIND_DEFINITIONS order, pushed to the host so painting a
// kind grows LITERAL blades/bushes/flowers/palms live in the viewport.
// spec: 0 grass · 1 bush · 2 flowers · 3 palm. Values verbatim from the hmsc
// population configs: grass blades/cell sparse 3 / med 7 / lush 16
// (grassPopulation GRASS_CONFIG.density; dry rides med), bush clumps med 14
// (BUSH_CONFIG.density), palm per-cell spawn chance sparse 0.08 / med 0.22 /
// dense 0.7 (PALM_CONFIG.density — most palm cells stay bare, that's the
// grove look). grassFlowers previews as flower heads; its lush grass bed
// joins at Compile.
export const FLORA_SPECS: Float32Array = new Float32Array([
  0, 3, 1, //  grassSparse
  0, 7, 1, //  grassMed
  0, 16, 1, // grassLush
  0, 7, 1, //  grassDry
  3, 0, 0.08, // palmSparse
  3, 0, 0.22, // palmMed
  3, 0, 0.7, //  palmDense
  1, 14, 1, // bush
  2, 6, 1, //  grassFlowers
]);
