// domain.ts — canonical cross-cutting types for the cutout cart.
//
// Every other module imports its shared shapes from here so the in-memory
// and on-disk representations stay in sync. If you find yourself
// declaring a near-duplicate of something exported below, add it here
// instead — the parallel declarations we used to have between state.ts /
// session.ts / sqi.ts (LayerConfig vs SessionLayerConfig vs the layer
// fields inside SqiLayer; ClickPoint vs SessionClick; CompositionLayer
// vs SessionCompositionLayer) drifted in real time and this module
// exists to stop that.

import type { MaskSurface, SurfaceId, CustomSurface } from './components/MaskQuad';
import { isBuiltinSurface } from './components/MaskQuad';

// Re-export the supporting primitives so any file with a `from
// './domain'` import can stop double-importing './components/MaskQuad'
// and './backends/types'.
export type { ClickLabel, ClickPoint } from './backends/types';
export type {
  MaskSurface,
  SurfaceId,
  CustomSurface,
} from './components/MaskQuad';
export {
  NUM_COLOR_SLOTS,
  SLOT_DEFAULTS,
  SLOT_LABELS,
  MASK_SURFACES,
  isBuiltinSurface,
  maskSurfaceLabel,
} from './components/MaskQuad';

// ── Layer-level state ─────────────────────────────────────────────────
// `LayerConfig` is the EVERY-LAYER shape: smart-select layers (one per
// keep-click), the brush/paint layer, and the global preview all use it.
// Lives here instead of state.ts so session.ts can persist the same
// declaration without re-declaring its fields (drift hazard).

export interface LayerConfig {
  /** SurfaceId points at either a built-in name OR a CustomSurface.id in
   *  the cart's gallery. Use `inflateSurface` to get the self-contained
   *  Surface form at export boundaries. */
  mode: SurfaceId;
  blend: BlendMode;
  hueOffset: number;
  phaseOffset: number;
  muted: boolean;
  /** Per-slot tint colors (#RRGGBB). Length should equal NUM_COLOR_SLOTS.
   *  Default `SLOT_DEFAULTS.slice()` (all white) renders identical to a
   *  pre-color-slot layer, so old payloads round-trip cleanly. */
  colors: string[];
  /** Alpha multiplier (0..1). Same semantics as the MaskQuad `dim`
   *  prop. */
  dim: number;
}

export type BlendMode = 'normal' | 'add' | 'multiply' | 'screen';
export const BLEND_MODES: BlendMode[] = ['normal', 'add', 'multiply', 'screen'];

// ── Composition stack ─────────────────────────────────────────────────

export type CompositionLayerKind = 'paint' | 'smart';

export interface CompositionLayer {
  id: string;
  kind: CompositionLayerKind;
  name: string;
  groupId: string | null;
  groupName: string | null;
  /** Back-pointer into either the paint mask (-1) or the smart `layers`
   *  array. -1 = the single brush/paint layer; otherwise an index into
   *  `state.layers[]`. */
  sourceIndex: number;
  visible: boolean;
}

// ── Layer target ──────────────────────────────────────────────────────
// Replaces the magic-number convention used in setLayerColor / setLayer
// HueOffset / etc., where `i = -1` meant "brush layer" and `i = null`
// meant "global preview". The setters still accept the legacy numeric
// signatures (state.ts:setLayerColor etc.); this is the typed form for
// new call sites + future API surface.

export type LayerTarget =
  | { kind: 'global' }
  | { kind: 'paint' }
  | { kind: 'smart'; index: number };

export function layerTargetToIndex(t: LayerTarget): number {
  switch (t.kind) {
    case 'global': return -1;
    case 'paint':  return -1;
    case 'smart':  return t.index;
  }
}

// ── Surface (self-contained, export-only) ─────────────────────────────
// Two representations of the same concept:
//   - `SurfaceId` (string) — what every in-memory LayerConfig.mode
//     carries. Built-in names point straight at MASK_SURFACES; custom
//     entries are looked up by id in the cart's `customSurfaces`
//     gallery. The indirection lets multiple layers share one WGSL.
//   - `Surface`     (tagged union) — self-contained, WGSL inlined.
//     Used inside the .sqi.json export so downstream consumers don't
//     need the gallery side-table to render.
// `inflateSurface` is the canonical conversion. SqiLayer.surface uses
// `Surface`; SessionDocument keeps the SurfaceId + customSurfaces
// side-table because the editor needs to re-edit the gallery.

export type Surface =
  | { kind: 'builtin'; name: MaskSurface }
  | { kind: 'custom'; id: string; label: string; wgsl: string };

export function inflateSurface(id: SurfaceId, customs: CustomSurface[]): Surface {
  if (isBuiltinSurface(id)) return { kind: 'builtin', name: id as MaskSurface };
  const cs = customs.find((c) => c.id === id);
  if (!cs) return { kind: 'builtin', name: 'rainbow' };
  return { kind: 'custom', id: cs.id, label: cs.label, wgsl: cs.shader };
}

/** Inverse of inflateSurface — given a self-contained Surface from an
 *  imported SQI document, register it (if custom) into the gallery and
 *  return the SurfaceId that the in-memory model should reference. */
export function adoptSurface(
  s: Surface,
  customs: CustomSurface[],
): { id: SurfaceId; addedCustom: CustomSurface | null } {
  if (s.kind === 'builtin') return { id: s.name, addedCustom: null };
  const existing = customs.find((c) => c.id === s.id);
  if (existing) return { id: existing.id, addedCustom: null };
  const next: CustomSurface = { id: s.id, label: s.label, shader: s.wgsl };
  return { id: next.id, addedCustom: next };
}
