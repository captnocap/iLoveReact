# Phase: uv-skin

**Forward obligation —** Record the atlas reply's exact {w,h}; the whole downstream pipeline is keyed to them. Never re-derive them from memory.

---

## Remaining boundary

General set algebra is still absent; the supported compound is `region:<name> & facing:<axis>`.
The current selector grammar cannot express **faces in this area AND facing this way** — only
an already named `region:<name> & facing:<axis>` — and there is no per-face read. On a dense
mesh, the intentional naming pass may therefore not be fully reachable yet. That is a gap in
the tool, not a failure by the agent doing the pass; report it plainly instead of inventing a
selector or pretending the generator labels are meaningful.
Viewport-coordinate actions (`paint-tool` strokes and `path`) are intentionally
camera-dependent; frame or set `viewport` first and checkpoint before using them. OS-picker
commands can be opened through `command`, but prefer path-bearing actions when available.

Part structure and face semantics are both visible to a cold `look`: `parts[]` comes from
the saved Outliner metadata and exact host ranges, while RJMD v4 carries semantic membership
and its name table with the geometry.

Structural topology marks the current paint layout stale. Run `atlas` before `paint`, then
`save`; this is the same explicit “Remake Atlas” decision as the visible editor and prevents
old UVs from being silently endorsed against new geometry.

**Resolution is a budget, never a density you pick.** `atlas` takes `fit` — 512/1024/2048/4096 —
and the host derives texels/meter from the model's own size, so a small prop gets writing-grade
texels and a car divides the same sheet. Omit it and you get the painter's 1024². Do not reach
for the raw `detail` (texels/meter) door to "set the resolution": on a 0.3 m prop a plausible-
looking density packs the whole model into a ~25×26 px sheet where small islands filter away.
`paint` now measures live island texels first and rejects with `atlas fit=<budget>` when that
would happen. Rebuild at the recommended budget, then paint again.

## 0 · Gates, in order (each one is a real refusal you will hit)

1. **Model open + package saved.** `tools/seat look`, then `tools/seat save` if needed.
   Every uv-atlas operation refuses without a package dir on disk.
2. **Atlas built.** `tools/seat atlas solid 200 200 200 1024` (or `template`/`blank`; fit
   512/1024/2048/4096). This uses the same transaction as the visible Create Paint Atlas
   dialog: it clears the stale-layout gate, persists `atlases/base.png`, and enters Paint.
   The reply's `{w,h}` are the atlas pixel dimensions — record them, the whole pipeline is
   keyed to them. If `uv-state` is unavailable after an accepted atlas receipt, stop: the
   shared atlas transaction regressed.

3. **Prestack reviewed and applied.** Before every guide export, dry-run repeat stacking:
   `tools/seat action uv-prestack '{"operation":"plan","mode":"normalize"}'`. Review
   `sourceFootprints → uniqueFootprints`, then pass its exact `token` to
   `tools/seat action uv-prestack '{"operation":"apply","token":"…"}'`. A token expires
   after any intervening UV edit. Logical island count may stay constant because disconnected
   mesh shells remain independently selectable; the texture-footprint reduction is the paint
   cost that stacking removes.

For a two-zone skin, replace the ordinary guide export with a reviewed
`uv-two-sheet` plan/apply. Pass semantic substrings such as `heroSemantics:["body","seat","decal"]`
and `uniformSemantics:["fastener","cap","trim"]` when names carry the distinction; explicit
island lists override automation. Uniform/support rows retain natural proportional size;
only rows below `minimumReadableAreaTexels` are enlarged, bounded by
`maximumReadabilityBoost`. The receipt must say `densityLaw:"proportional-with-floor"` and
reports both the requested and actually packable floor. After apply, call
`uv-two-sheet {"operation":"export-guides","token":"…"}`; it writes cropped
`uv-ai-guide-hero.png` and `uv-ai-guide-uniform.png`, ready to generate separately and add
back at the receipt's zone offsets before `compile-layers`.

## 1 · Export the guide — pick the export for the target model

Two exports exist because image models differ on alpha:

| Export | File | Use for |
|---|---|---|
| `tools/seat action uv-atlas '{"operation":"export-guide","numbered":false}'` | `atlases/uv-ai-guide.png` — islands on a **6% pink** opaque substrate (the pink level is user-A/B-proven visible to gpt-image) | **gpt-image-2 — required.** It is blind to transparent alpha and returns garbage from the transparent wireframe. Safe default for every model. |
| `tools/seat action uv-atlas '{"operation":"export-wireframe"}'` | `atlases/uv-wireframe.png` — transparent, alpha-zero away from lines | Models that read alpha correctly; overlay/compositing work. |

`numbered:true` adds per-island color-by-number labels. Use it **only** when the prompt
references islands by number (gpt-image-2 fidelity runs). Cheap models leak the digits
into the output as faint ghost text in small islands — verified with nano-banana-2-lite.
For unnumbered runs, describe islands by their silhouette ("the tall island with the
trapezoid recess is the front fascia") and by the model's semantic region names.

## Hazards

- **Atlas receipt without Paint/UV state** — the Seat and visible dialog now share one
  transaction. Treat a missing UV bridge after success as a regression, not a second manual gate.
- **DEFAULT_BATCHES=25** — an unbounded queue line fires 25 batches.
- **Numbered-label leak** on cheap models; numbered guides pair with gpt-image-2 only.
- **gpt-image-2 + transparent wireframe = garbage.** Pink guide, always.
- **img.cjs is gitignored on purpose** (embedded API key). Never stage it, never copy it
  into tracked paths.
- **Do not run `atlas` after importing a skin** — it rebuilds the base and the live look
  with it. Topology edits mark paint stale; retexture after retopo, not around it.
- The dims in every resize/import come from the **live** `atlas`/`uv-state` reply, not
  from a remembered number.
