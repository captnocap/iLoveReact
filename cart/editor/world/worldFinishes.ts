// world/worldFinishes.ts — the editor-owned finish layer over derived
// architecture (req_4739). Floors are DERIVED and own no source records
// (RULED req_4482), and an opening's painting choice is instance wardrobe
// (the req_3443 law) — both persist as editor state draped over the engine's
// geometry at bake time. Wall SIDE finishes are NOT here: they live in the
// engine source (sideA/sideB.materialId via setSideFinish) and arrive on the
// render bands.
//
// A leaf module on purpose: the world store and EditorState types read this
// shape without pulling the live-bake/import chain into their bundles.

export type WorldFinishes = {
  /** derived-floor face signature → Skins-tab material asset id. */
  floors: Readonly<Record<string, string>>;
  /** opening id → the kit's stored paint-skin id the mounted model wears. */
  openings: Readonly<Record<string, string>>;
};

export const EMPTY_WORLD_FINISHES: WorldFinishes = Object.freeze({
  floors: Object.freeze({}),
  openings: Object.freeze({}),
});

function validStringMap(value: unknown, path: string): Record<string, string> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} is not a record`);
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'string' || entry.length === 0) throw new Error(`${path}['${key}'] is not a non-empty string`);
    out[key] = entry;
  }
  return out;
}

/** Strict parse of a persisted finishes block. Absent = the empty layer, so
 * every existing v5 save loads unchanged. */
export function validWorldFinishes(value: unknown): WorldFinishes {
  if (value === undefined || value === null) return EMPTY_WORLD_FINISHES;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('finishes is not a record');
  const raw = value as { floors?: unknown; openings?: unknown };
  return {
    floors: validStringMap(raw.floors, 'finishes.floors'),
    openings: validStringMap(raw.openings, 'finishes.openings'),
  };
}
