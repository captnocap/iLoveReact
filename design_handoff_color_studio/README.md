# Handoff: Color Studio — a material/shader-aware color tool

## Overview

This replaces a conventional color picker (hue wheel + hex entry) inside a "Photoshop-for-live-game-building" desktop tool. The core thesis is two-fold:

1. **Color selection should be metaphor-appropriate, not one-size-fits-all.** Different jobs (building a scheme, mixing an organic color, matching a scene, generating a shading ramp) deserve different tools — unified under one persistent *current color* + *palette*.
2. **Color in this app is not a flat RGB value — it is a parameter that drives procedural materials/shaders.** The picker's real job is to **author the named color slots a material shader consumes**, replacing the hardcoded `vec3f(...)` constants currently baked into each material function in `fillShader.ts`.

The end goal: kill the "magic color system" (palettes baked into shader code) and give the user direct, harmonious, reusable control over every color a material uses — per variant, with seed and quality control.

## About the Design Files

The file in this bundle — `Color Pickers.dc.html` — is a **design reference created in HTML**, a working prototype demonstrating the intended look, interaction model, and information architecture. It is **not production code to copy**. The task is to **recreate these designs in the target codebase's existing environment** (the app's React runtime), wiring the controls to the real material/shader system (`fillShader.ts`, the `D[]` storage buffer contract, and the Zig fetch suite). Use the codebase's existing component patterns and state conventions.

The prototype approximates shader output with CSS gradients. **In the real app, every preview should render the actual WGSL material** so the user sees ground truth.

## Fidelity

**High-fidelity for layout, interaction model, and concept; reference-grade for exact pixels.** Colors, type, spacing, and the control set are intentional and should be matched closely. The *interaction architecture* (the unified spine, the lenses, the slot binding) is the part to implement faithfully — exact px can adapt to the host panel's docking constraints.

The prototype is organized as four "turns" of exploration stacked vertically (newest at top). Read them in this order for the narrative, but **the destination design is turn 4 (`4a`) layered on top of turn 3 (`3a`)** — see "Recommended build" below.

---

## The four picker metaphors (turn 1 — the vocabulary)

These are four *different tools for four different jobs*, deliberately not redundant. Each can exist as a "lens" inside the unified tool.

- **1a · Harmony Rig** — pick a *relationship*, not a swatch. A rigid linked rig of nodes sits on a perceptual field; dragging it moves the whole scheme together. A segmented control switches harmony type (Complement / Analogous / Triad / Split). Output: a row of swatches forming the scheme. Solves "see colors that fit" and "no wheel."
- **1b · Pigment Lab** — tactile subtractive mixing. Drag dabs of pigment onto a pad; they blend like wet paint; sample anywhere in the smear. Rinse/water axis lightens. Solves "no hex," "intuitive metaphor."
- **1c · World Sampler** — scene-aware. Reads colors already present in the current scene/reference and offers them back; "lock to scene palette" keeps new assets cohesive. An eyedropper reimagined as a cohesion tool.
- **1d · Ramp Forge** — shading/gradient generator. Define a shadow end and a light end; produces a perceptually even ramp in OKLCH with automatic hue-shift (cool shadows → warm highlights). Step count 5/7/9. This is the gradient tool, and it feeds shader gradient stops directly.

## The unification (turns 2–3)

The insight: **one current color + one palette form a permanent spine; the four metaphors are lenses (or live "views") on that same color.**

- **Workbench view** — spine pinned (current color at top, palette tray at bottom); the middle swaps between lenses (Field / Mix / Scene / Ramp / Library). An always-visible "Fits well right now" strip derives harmonious suggestions from the current color live.
- **No-Modes view** — the radical alternative: the current color sits center; its Harmony, Ramp, and In-Scene derivations orbit it and re-derive instantly when it changes. No mode switching — they are consequences, not tools.
- These two are a **tab switch** over the same shared color + palette (so switching never loses state). Implemented in turn 3 as `3a` "Color Studio."
- **Library lens** — a curated set of palette prefabs. Its smart behavior: given the current color, it surfaces the saved sets that **contain a color like it** ("N sets use a color like bright citron"), with the matching swatch ringed. Filter: "Matches current" vs "Whole library."

### Store vs. fetch (the user asked)
Recommendation, reflected in the UI: **ship a curated local library + let users save into it**, and treat "discover online" as an *import-into-library* action (powered by the Zig fetch suite), **not** a live per-pick dependency. Rationale: offline, instant, no latency/ToS risk, curated quality. The online source seeds/extends the local library; it is never in the hot path of picking.

## The destination (turn 4 — `4a` Material Palette) ⭐

This is the feature that makes the tool specific to this app and kills the magic-color system.

**Concept:** select a material → the tool exposes **every baked `vec3f` color constant in that material's shader function as an editable "slot."** Editing a slot overrides what the function hardcodes. Slots are per-**variant**. Seed reshuffles procedural noise; Quality is the `D[3]` grade.

**Why it matters:** today, e.g. `rot_siding()` hardcodes its paint color per variant (`vec3f(0.58,0.62,0.54)`, `vec3f(0.28,0.47,0.58)`, `vec3f(0.70,0.56,0.35)`). The user wants to *own* those values, choose harmonious ones, and reuse them — not edit shader source.

**Layout (top → bottom):**
1. **Material selector** — horizontal cards: mini swatch + material name + board tag (e.g. `B / Condemned`, `D / NeonRot`). Selecting sets material, resets variant to 0, activates the material's "hero" slot.
2. **Live preview** — the material rendered at the current palette + variant + seed + quality. Overlay labels: material name + board (top-left), the `D[]` descriptor (bottom-right). *In production this is the real WGSL render.*
3. **Controls row** — `VARIANT` segmented (0/1/2) · `SEED` dice button (reshuffles) · `QUALITY · D[3]` segmented (PSX / PS2 / Prev / Std / Max).
4. **Palette slots** — one chip per baked color the material uses (name + swatch). Click to make active. "Reset to baked" restores shader defaults for the current material+variant.
5. **Active slot + fill assist** — shows the active slot's swatch, name, and **`was baked: vec3f(...)`** (the original constant, to make the de-magic explicit). Two fill paths:
   - *"Colors that fit \<material\>"* — tints/shades/mute/analogous/complement derived from the material's base color. (Note the complement of Rot Siding's brown wood lands on blue — matching the actual v1 paint constant.)
   - *"Pull a slot from a Library set"* — rows of curated sets; click any swatch to fill the active slot.

**Materials demonstrated (with their real `fillShader.ts` constants as defaults):**

| Material | Board | Slots | Variant palettes (RGB 0–1) |
|---|---|---|---|
| Rot Siding | B / Condemned | Wood low, Wood high, Paint, Rot, Seam | Paint v0 `(.58,.62,.54)`, v1 `(.28,.47,.58)`, v2 `(.70,.56,.35)`; Wood low `(.28,.17,.09)`, Wood high `(.58,.39,.20)`, Rot `(.035,.04,.026)`, Seam `(.018,.016,.014)` |
| Neon Stucco | D / NeonRot | Base low, Base high, Drip | low/high v0 `(.50,.10,.24)`/`(.98,.45,.66)`, v1 `(.07,.37,.42)`/`(.36,.92,.88)`, v2 `(.26,.19,.46)`/`(.84,.68,.96)`; Drip `(.98,.78,.18)` |
| Pool Tile | D / NeonRot | Tile A, Tile B, Caustic, Mildew | A/B v0 `(.05,.50,.62)`/`(.48,.96,.92)`, v1 `(.12,.10,.42)`/`(.96,.20,.56)`, v2 `(.16,.44,.34)`/`(.86,.74,.34)`; Caustic `(.90,1,.85)`, Mildew `(.015,.05,.035)` |

> These three are samples. The production tool should generalize: **parse the `vec3f(...)` literals out of each material fn** (or, better, refactor each material fn to read its palette from named entries in the `D[]` buffer) so *every* board/material gets slots automatically rather than being hand-listed.

---

## How this maps to your shader contract

`fillShader.ts` selects a look via the storage buffer `D = [materialId, variant, seed, quality, board]`. The tool is a front-end for authoring that tuple **plus a palette**:

- `materialId` / `board` ← Material selector
- `variant` ← Variant segmented control
- `seed` ← Seed dice (any float; the shader's spread formulas consume it)
- `quality` ← Quality segmented control (0 PSX · 1 PS2 · 2 Preview · 3 Std · 4 Max)
- **Palette slots ← new.** The recommended refactor: extend the `D[]` contract (or add a parallel palette buffer) so each material fn reads its key colors as uniforms instead of inline `vec3f` literals. The tool writes those uniforms. Defaults = today's hardcoded constants, so nothing changes visually until a user overrides a slot.

**Migration path (incremental, low-risk):**
1. For one material fn, replace its inline `vec3f` constants with reads from a palette uniform array; default the uniform to the old literals. Verify pixel-identical output.
2. Wire the tool's slots to that uniform array; "reset to baked" writes the defaults back.
3. Repeat per material. A codegen/parse step can extract the literals to seed each material's default palette automatically.

---

## Interactions & behavior

- **Lens / view / variant / quality switches**: instant, no animation needed; selected state = filled light chip on dark.
- **Slot activation**: click a slot chip → it becomes active (blue ring + glow `0 0 0 3px rgba(110,168,254,.18)`); the active-slot readout and fill-assist retarget to it.
- **Fill a slot**: click any assist swatch (fits row or library row) → writes that color to the active slot's override; preview updates live.
- **Reset to baked**: clears overrides for the current material+variant → slots revert to shader constants.
- **Seed dice**: randomizes seed → procedural noise re-rolls (in prototype, shifts pattern offset; in app, re-runs the shader with new seed).
- **Harmony "fits well" strip** (Workbench): re-derives on every current-color change (analogous ±30°, split ±150°, complement 180°), each clickable to adopt.
- **No-Modes orbit**: any ring swatch click sets the center; all rings re-derive.
- **Library matching**: a palette "matches" if any of its colors is within ~26° hue of the current color; matched sets get a "has yours" tag and the matched swatch is ringed.

## State management

Single source of truth for the unified tool:

```
currentColor: { L, C, H }        // OKLCH; the spine. Drives harmony/ramp/orbit.
palette: Array<{L,C,H}>          // the tray ("jars"); scene-lock flag optional
view: 'bench' | 'orbit'          // tab
lens: 'field'|'mix'|'scene'|'ramp'|'library'   // workbench middle
libraryFilter: 'match' | 'all'
```

For the Material Palette feature:

```
material: string                 // materialId/key
variant: 0 | 1 | 2
seed: number
quality: 0..4                    // PSX..Max
activeSlot: number               // index into the material's slot list
slotOverride: Record<`${material}:${variant}:${slotIndex}`, ColorString>
```

Slot value resolution: `slotOverride[key] ?? bakedDefault(material, variant, slotIndex)`. Overrides are keyed by material+variant+index so each variant keeps its own edits.

## Color math used

- Harmony derivations rotate **hue in OKLCH** (`oklch(L C H)`), keeping L/C, rotating H by ±30/±150/180.
- Ramp Forge interpolates L, C, H linearly in OKLCH between shadow and light, with a chroma bump in the mids (`C *= 1 + 0.25·sin(π·t)`) and a hue drift for warm-highlight/cool-shadow.
- Fill-assist "tints/shades" convert the material's base RGB → HSL, adjust L/S, convert back. (HSL is fine for tint/shade; prefer OKLCH for harmony if you want perceptual evenness.)
- Library "match" uses circular hue distance with a ~26° threshold.

## Design tokens

Colors (dark pro-tool chrome):
- App background `#0d0e10`
- Panel background `#17181b`; panel border `#2a2c31`; inner divider `#232529`
- Card/inactive control background `#0f1012` / `#141518`
- Text primary `#e8e8ea`; muted `#9a9ea6`; mono labels `#7e828b`
- Accent (selection/active) `#6ea8fe`; on dark borders use `#2c3a52` / `#3a4a63`
- Positive / "locked" / "you own it" `#6ee7a8`
- Callout highlight `#f3d27a` (dark text)
- Panel shadow `0 24px 60px -28px rgba(0,0,0,.8)`

Typography:
- Display/headings: **Space Grotesk** (600/500) — panel titles, big values
- Body/UI: system-ui sans
- Labels, readouts, technical (`D[]`, `vec3f`, hex/LCH): **ui-monospace / Menlo**
- Sizes: panel title 16px; current-color name 18–19px; section labels 9–9.5px mono uppercase (letter-spacing .05–.08em); body 11–13px

Radii: panels 16px; previews/cards 12–14px; chips/swatches 7–9px; segmented buttons 6–9px.

Spacing: panel padding 18px; section gaps 14–18px; swatch row gaps 6–7px.

Active-control pattern: light fill `#e8e8ea` + dark text on a `#0f1012` segmented track; inactive = transparent + `#9a9ea6` text.

## Assets

None required — the prototype uses no external images. Material previews are CSS approximations standing in for real WGSL renders. Fonts: Space Grotesk (Google Fonts) + system stack. In production, swap CSS previews for live shader renders and use the app's existing icon set (the dice/eyedropper glyphs in the prototype are placeholders).

## Files

- `Color Pickers.dc.html` — the full interactive prototype (all four turns). It is a self-contained HTML file; open it in a browser to explore. Turn 1 = the four metaphors; turns 2–3 = unification + library; turn 4 (`4a`) = the Material Palette / shader-slot binding (the primary build target).

## Recommended build order

1. **Material Palette (`4a`)** first — it is the highest-value, app-specific piece. Start with the incremental shader migration (one material), wire slots + variant + seed + quality to `D[]`, render the real WGSL preview.
2. **Generalize slot extraction** so all materials/boards get slots without hand-listing.
3. **Unified spine + lenses (`3a`)** — current color + palette, Workbench/No-Modes tab, the live "fits well" harmony, Ramp Forge feeding shader gradient stops.
4. **Library** with local store + Zig-fetch "discover → import."
5. Add remaining lenses (Pigment Lab, World Sampler) as desired.
