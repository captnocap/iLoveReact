// tunables/tunable.ts — the defaults/tunables CONTRACT (foundation workstream G).
//
// Most editable values in the editor must NOT expose raw numbers. They edit as a
// select of NAMED PRESETS (`default | fast | slow | …`) that are FACTORS over a
// fixed base number underneath. The inspector picks a preset or marks a custom
// override; the numeric substrate lives here, owned once. This is the "authoring
// intent vs numeric value" split the DESIGN_INTAKE rules ("01 - Inspector Panel")
// describe: the inspector says `fast`, this registry knows `base * factor`.
//
// Like editorbus/event.ts and diag/channel.ts, the catalog is NOT hardcoded here.
// Each system registers its own tunables ONCE via defineTunable() — the registry
// is the anti-collision seam that lets parallel workers add tunables without
// editing a shared table. Resolution is pure (preset = factor × base; custom
// override = raw), so it unit-tests with zero host attached.
//
// Edits travel through the authoring eventbus (see ./events.ts: tunable.override.set,
// material.slot.fill, …) — nothing here mutates editor state behind the bus's back.
// Values that feed Zig systems read out through the host door (see ./host.ts).

/** A tunable definition: a fixed `base` number plus named presets expressed as
 *  FACTORS over that base. `resolve(id, 'fast')` returns `base * presets.fast`.
 *  Every definition must carry a `default` preset (the `default preset` tier of
 *  the `default → named preset → custom override` model). */
export interface TunableDef {
  /** Stable id (registry key + the term the globals palette matches), e.g. `gravity`. */
  id: string;
  /** Human label for the inspector select / palette row, e.g. "Gravity". */
  label: string;
  /** The fixed base number every preset factor multiplies. */
  base: number;
  /** Named presets as factors over `base`. MUST include `default` (usually 1). */
  presets: Record<string, number>;
  /** Grouping for the palette's "related values" tier, e.g. `physics`, `movement`. */
  group: string;
  /** True for top-level global values (`gravity`, `timeScale`) — they outrank
   *  same-name non-global matches in the palette ("global gravity first"). */
  global?: boolean;
  /** Extra search terms that should surface this tunable. */
  keywords?: string[];
  /** Terms this tunable RELATES to — a `walkSpeed` that depends on gravity lists
   *  `gravity` here so it appears under the `gravity` query as a related value. */
  related?: string[];
}

/** The `default preset` tier name. Every tunable must define it. */
export const DEFAULT_PRESET = 'default';

/** A custom override: a raw number that bypasses the preset factors entirely. */
export interface CustomOverride { custom: number }

/** What the inspector hands `resolve`: a named preset, or a raw custom override. */
export type Selection = string | CustomOverride;

/** Narrowing guard for the custom-override branch of a Selection. */
export function isOverride(s: Selection | undefined): s is CustomOverride {
  return typeof s === 'object' && s !== null && typeof (s as CustomOverride).custom === 'number';
}

const REGISTRY = new Map<string, TunableDef>();

/** Register a tunable ONCE (at module load of the owning system) and get the def
 *  back. Re-registering the same id is an error — it means two systems fight over
 *  one name, which the seam exists to prevent. Enforces a `default` preset. */
export function defineTunable(def: TunableDef): TunableDef {
  if (REGISTRY.has(def.id)) {
    throw new Error(`tunables: tunable '${def.id}' already registered`);
  }
  if (def.presets[DEFAULT_PRESET] === undefined) {
    throw new Error(`tunables: '${def.id}' must define a '${DEFAULT_PRESET}' preset (the default tier)`);
  }
  REGISTRY.set(def.id, def);
  return def;
}

/** Look up a registered tunable (the inspector/palette renders from this). */
export function tunableDef(id: string): TunableDef | undefined {
  return REGISTRY.get(id);
}

/** Every registered tunable — for the globals overlay's full listing. */
export function registeredTunables(): TunableDef[] {
  return Array.from(REGISTRY.values()).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Resolve a tunable to its numeric value.
 *   - a named preset  → `base * presets[name]`
 *   - a custom override → the raw `custom` number (bypasses factors)
 *   - omitted          → the `default` preset
 * Throws on an unknown id or an unknown preset name — both are authoring bugs
 * the registry is meant to catch, not silently paper over.
 */
export function resolve(id: string, selection?: Selection): number {
  const def = REGISTRY.get(id);
  if (!def) throw new Error(`tunables: unknown tunable '${id}'`);
  if (isOverride(selection)) return selection.custom;
  const presetName = typeof selection === 'string' && selection ? selection : DEFAULT_PRESET;
  const factor = def.presets[presetName];
  if (factor === undefined) {
    throw new Error(`tunables: '${id}' has no preset '${presetName}'`);
  }
  return def.base * factor;
}

// ── Per-(material, variant, slot) override keying ────────────────────────────
// Shader-slot color overrides (Color Studio) key by material + variant + slot, so
// the same physical slot in two variants overrides independently. Used as a
// TargetRef id on material.slot.* events and as the override-map key.

/** Stable key for a shader-slot override `(material, variant, slot)`. */
export function overrideKey(material: string, variant: string, slot: string | number): string {
  return `${material}::${variant}::${slot}`;
}

/** Inverse of overrideKey — splits a key back into its parts. */
export function parseOverrideKey(key: string): { material: string; variant: string; slot: string } {
  const [material = '', variant = '', slot = ''] = key.split('::');
  return { material, variant, slot };
}

// ── Ranked search (the globals command palette) ──────────────────────────────
// "type `gravity` → global gravity first, then related values (movement, physics,
// pathing) that depend on it." Exact/global id matches rank above group/related.

function scoreTunable(def: TunableDef, q: string): number {
  const id = def.id.toLowerCase();
  const label = def.label.toLowerCase();
  const group = def.group.toLowerCase();
  const kws = (def.keywords ?? []).map((s) => s.toLowerCase());
  const rel = (def.related ?? []).map((s) => s.toLowerCase());
  let s = 0;
  const bump = (v: number) => { if (v > s) s = v; };

  if (id === q) bump(1000 + (def.global ? 500 : 0));        // exact id (global wins ties)
  else if (id.startsWith(q)) bump(600 + (def.global ? 200 : 0));
  else if (id.includes(q)) bump(400);
  if (kws.includes(q)) bump(350 + (def.global ? 100 : 0));  // exact keyword
  if (label.includes(q)) bump(300);
  if (group === q) bump(250);                                // the whole group
  if (rel.includes(q)) bump(150);                            // related value
  if (group.includes(q)) bump(120);
  if (rel.some((r) => r.includes(q))) bump(80);
  if (kws.some((k) => k.includes(q))) bump(70);
  return s;
}

/** Rank tunables for a palette query. Exact/global id matches first, then group
 *  and related values. Returns only positive matches, best-first. */
export function searchTunables(query: string): TunableDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { def: TunableDef; score: number }[] = [];
  for (const def of REGISTRY.values()) {
    const score = scoreTunable(def, q);
    if (score > 0) scored.push({ def, score });
  }
  scored.sort((a, b) => b.score - a.score || a.def.id.localeCompare(b.def.id));
  return scored.map((m) => m.def);
}

// ── Current selection state ──────────────────────────────────────────────────
// What preset/override is ACTIVE for each tunable right now. The event helpers in
// ./events.ts set this (and dispatch onto the bus); the host door in ./host.ts
// reads resolveCurrent() as its graceful fallback when the Zig door is absent.

const _selections = new Map<string, Selection>();

/** Set the active selection for a tunable (pure state; ./events.ts wraps this
 *  with a bus dispatch — prefer that path so the edit is logged). */
export function setSelection(id: string, selection: Selection): void {
  if (!REGISTRY.has(id)) throw new Error(`tunables: unknown tunable '${id}'`);
  _selections.set(id, selection);
}

/** The active selection for a tunable (the `default` preset until overridden). */
export function getSelection(id: string): Selection {
  return _selections.get(id) ?? DEFAULT_PRESET;
}

/** Drop a custom/preset selection, reverting the tunable to its `default`. */
export function clearSelection(id: string): void {
  _selections.delete(id);
}

/** Resolve a tunable under its currently-active selection. */
export function resolveCurrent(id: string): number {
  return resolve(id, getSelection(id));
}
