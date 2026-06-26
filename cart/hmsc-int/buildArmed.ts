// buildArmed — what's armed to place in the iso build map, and the toggle-off
// equality test. Its OWN module (req_1967): this type + helper are shared by the
// map (LoaderIsoView), the rail (CatalogRail), and the properties panel, so they
// must not hide inside any one component's file (that's exactly how the duplicated
// drag-paint gate slipped past — a grab-bag component file exporting shared bits).

// A single catalog PIECE, a PREFAB (a named composition that stamps into many
// pieces), or the TOWER tool (req_0478: drag a footprint → a hollow multi-storey
// shell). null = nothing armed (pan/select mode).
export type Armed =
  | { kind: 'piece' | 'prefab'; id: string }
  | { kind: 'tower' }
  | { kind: 'water'; id: string }
  | null;

/** the same tool armed twice = a toggle-off (rail chips re-click to disarm) */
export function sameArmed(cur: Armed, next: NonNullable<Armed>): boolean {
  if (!cur || cur.kind !== next.kind) return false;
  if (cur.kind === 'tower' || next.kind === 'tower') return true;
  return cur.id === next.id;
}
