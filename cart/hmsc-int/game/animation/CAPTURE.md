# Capture note - game/animation/ (V6, 2026-06-05)

Fresh capture of the V6 animation action layer into
`cart/hmsc-int/game/animation/`. The ruled source is the behavior of
`cart/animationDsl.ts`; `cart/head_lab/animDsl.ts` is only a re-export shim. Both
were read as behavior references only, not moved, edited, copied as modules, or
imported by the new game code.

## V6 ruling

Oracle query: `tools/oracle "animation"` / `"animation DSL"` / `"easing"`.

- V6: Animation DSL semantics win; the format becomes RLE/relational.
- The action vocabulary and alias semantics of `cart/animationDsl.ts` are the
  one animation path.
- Per-cart pose tables retire.
- Gait stays a pose generator under the action layer.
- The bracket-string format was a quick pass-off; it survives here only as an
  import/parser compatibility surface while the parsed data shape is the runtime
  contract.
- Easing has no separate ruling; the indexed behavior says the only built-in
  weight is `sin(phase * pi)`.

## Construct-list comparison

| reference construct / verb rule | captured in `game/animation/` |
|---|---|
| Empty source returns `{ steps: [], total: 0 }` with no error | yes |
| Bracket groups `[...]` are sequential steps | yes |
| No brackets falls back to pipe `|` sequential chunks | yes |
| Semicolon `;` composes parallel actions inside a step | yes |
| Action fields are comma-separated: duration, target, action, args... | yes |
| Duration must be finite and `> 0`; invalid action segments are skipped | yes |
| A step duration is the maximum duration of its parallel actions | yes |
| Timeline total is the sum of step durations | yes |
| No valid steps returns `error: "no timeline actions parsed"` | yes |
| Tokens normalize with trim, lowercase, whitespace/hyphen to underscore | yes |
| Target aliases cover body, face, and vehicle aliases | yes, table-carried as `ANIMATION_TARGET_ALIASES` |
| Unknown targets pass through after normalization | yes |
| Action verbs are open vocabulary, not an enum | yes |
| Args are open vocabulary tokens normalized like actions | yes |
| Sampling returns only the current step; no cross-step interpolation | yes |
| At an exact step boundary, the previous step still samples at phase 1 | yes |
| Non-looping samples clamp to `[0, total - 0.000001]` | yes, value is `ANIMATION_DSL_TUNING.nonLoopEndClampOffsetSeconds` |
| Looping samples use modulo time; negative time wraps forward | yes |
| Any action ending `_loop` loops the whole timeline | yes |
| Exact action `shake_in_air` loops the whole timeline | yes |
| Per-action phase is `clamp01(stepTime / action.duration)` | yes |
| Weight is always `sin(phase * pi)` | yes, exposed as `sinusoidalAnimationWeight` |

Reference aliases carried exactly: `arm`, `arms`, `both_arm`, `l_arm`, `r_arm`,
`hand`, `hands`, `both_hand`, `l_hand`, `r_hand`, `wrist`, `wrists`,
`both_wrist`, `l_wrist`, `r_wrist`, `fist`, `fists`, `both_fist`, `l_fist`,
`r_fist`, `finger`, `fingers`, `both_finger`, `l_finger`, `r_finger`, `leg`,
`legs`, `both_leg`, `l_leg`, `r_leg`, `foot`, `feet`, `both_foot`, `l_foot`,
`r_foot`, `head_face`, `face_target`, `grab_face`, `car`, `auto`,
`body_shell`, `front_wheel`, `rear_wheel`, `tire`, `tires`, `wheel`,
`steering`, `shocks`, `shock`.

## Fidelity evidence

Representative programs were evaluated against the reference behavior and the
rewrite:

| case | reference result | rewrite result |
|---|---|---|
| `[0.5,right arm,lift-and-bend,Fast;1.25,l_fist,clench],[2,head_face,talk]` | two steps; total 3.25; first step duration 1.25; aliases/actions/args normalized | match |
| `1, arm, raise; 2, leg, step | 3, wheel, spin_loop` | pipe fallback; two steps; total 5; parallel first step; `wheel -> wheels`; loops due `_loop` | match |
| `[0, arm, raise; nope; 1, unknown target, Wave]` | invalid segments skipped; unknown target becomes `unknown_target`; no error | match |
| sampling `[1, arm, raise], [1, head, nod]` at `1` | previous step active at phase 1, weight 0 | match |
| sampling the same at `1.000001` | second step active, no blended first step | match |
| sampling `[1, arm, raise;2, leg, step]` at `0.5` | phases `0.5` and `0.25`; weights from same sine envelope | match |
| sampling non-loop `2, arm, raise` at `99` | clamped to phase `(2 - 0.000001) / 2` | match |
| sampling loop `2, wheel, spin_loop` at `5` and `-0.5` | phases `0.5` and `0.75` | match |
| `1, body, shake_in_air` | exact action name loops the whole timeline | match |

The P4 suite in `animation.test.ts` encodes this sweep as behavior tests. There
were no semantic divergences justified against rulings; the rewrite intentionally
keeps the reference's boundary and clamp behavior.

One-off evidence run (temporary harness deleted after use, no product import from
`cart/`):

```sh
tools/esbuild zig-out/game/tests/animation_fidelity_compare.ts --bundle --outfile=zig-out/game/tests/animation_fidelity_compare.js --format=iife --platform=neutral --target=es2022 --alias:@reactjit=runtime
tools/v8cli zig-out/game/tests/animation_fidelity_compare.js
# FIDELITY OK 7 programs, 41 parse/loop/sample comparisons
```

## Deliberately not carried

- `cart/head_lab/animDsl.ts` as a shim: it is only `export * from
  '../animationDsl';`, not a distinct behavior source.
- Geometry, figure hooks, face animation, vehicle transforms, and gait
  generation: V6 rules animation as an action layer. Consumers translate
  `SampledAction[]` into figure/face/vehicle effects. The figure lane owns any
  figure hook surface.
- A new RLE/relational storage encoder: V6 says that is the real future format,
  but today's order is the DSL semantics capture. The parsed timeline is the
  stable semantic contract that the later storage can target.
- Extra easing curves: no ruling and no reference behavior. The single sine
  envelope is carried as data.

## Ambiguities surfaced

1. The exact RLE/relational serialized representation is still unruled. This
   capture keeps the parsed timeline as the semantic target and marks the
   bracket string as an import/parser surface only.
2. Action verbs are open vocabulary in the reference. The capture does not
   invent a fixed verb enum; consumers remain responsible for interpreting
   actions such as body, mouth, gait, wheel, or suspension verbs.
3. Figure integration is intentionally absent. If animation needs bone-space
   hooks, the figure lane should expose them; this lane should not reach into
   `game/figure/**`.
