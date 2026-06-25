// placementStats.ts — "most placed" census for the / dashboard (req_1879). Part
// of the growing portrait-of-your-world stat family alongside reportAssetGeometry
// (geometry) and reportMapFootprint (size/space). This one ranks what you've
// placed the most of.
//
// Pure + parameterized (placement labels are map-scoped, like the footprint), so
// it honors the freeze law and unit-tests headless. Counting string occurrences
// is trivially cheap — no store reads, no decode.

export type PlacementRank = { label: string; count: number };

export type PlacementCensus = {
  /** total placed things counted. */
  total: number;
  /** how many distinct labels appeared. */
  unique: number;
  /** the most-placed labels, descending by count then alphabetical (stable). */
  top: PlacementRank[];
};

/**
 * Tally placed-asset labels and return the most common. Feed it the display
 * labels of everything placed (props, buildings, …); the caller decides what
 * counts as an "asset".
 */
export function reportPlacementCensus(labels: ReadonlyArray<string>, topN = 6): PlacementCensus {
  const counts = new Map<string, number>();
  for (const raw of labels) {
    const label = raw && raw.trim() ? raw.trim() : 'unnamed';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const top = [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label))
    .slice(0, topN);
  return { total: labels.length, unique: counts.size, top };
}
