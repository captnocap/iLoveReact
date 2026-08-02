---
name: agent-skin
description: Generate AI image textures for a modeled, semantically named mesh in the live ReactJIT studio editor and map them back onto its UV atlas. Use when an agent must skin a 3D model from a prompt — export the UV guide, drive the user's image-generation console headlessly, import the result as the live atlas, verify alignment with self-shots, and bank multiple skins as named paint variants.
---

# Agent Skin

Texture a model the editor already owns; never hand-paint a texture pixel by pixel and
never bypass the resident atlas/variant machinery. The loop is: **export the UV guide →
generate candidates → resize to exact atlas dims → import → verify with shots → save as a
paint variant**. Alignment is the deliverable — a texture that looks good as a flat PNG but
lands off-island is a failure, and only a viewport shot can prove it landed.

This skill layers on `agent-seat` (the modeling loop). The model should arrive blocked out,
package-saved, with named regions. Source of truth: `cart/editor/stage/ModelView.tsx`
(uv-atlas/paint-variant handlers), `cart/editor/model/uvWireframe.ts` (guide rasterizer),
`cart/editor/img.cjs` (the generation console — untracked + gitignored, NEVER stage it).

---

## 0 · Gates, in order (each one is a real refusal you will hit)

1. **Model open + package saved.** `tools/seat look`, then `tools/seat save` if needed.
   Every uv-atlas operation refuses without a package dir on disk.
2. **Atlas built.** `tools/seat atlas solid 200 200 200 1024` (or `template`/`blank`; fit
   512/1024/2048/4096). The reply's `{w,h}` are the atlas pixel dimensions — record them,
   the whole pipeline is keyed to them.
3. **Paint mode entered once:** `tools/seat command mesh-paint`. The UV panel model
   (`uvPanel`) only builds when paint mode engages; until then `uv-state` fails with
   "UV focus bridge unavailable" and export-guide refuses with "no authored UV geometry
   to draw" **even though the atlas exists**. This gate is invisible and looks like a
   missing-UV bug; it is not. Re-shot after entering to confirm the Paint panel is up.

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

## 2 · Generate — drive img.cjs headlessly

`cart/editor/img.cjs` is the user's generation console (nano-gpt API through the local
SOCKS proxy on 127.0.0.1:9050). Agent lane is `--headless` + a queue file; everything is
env-overridable, so keep the whole run in a scratch workdir:

```bash
W=<scratch>/skin-<model>; mkdir -p $W/prompts $W/out
cat > $W/prompts/<name>.txt <<'EOF'
<the texture prompt — see Prompting below>
EOF
echo '[<name>] [2k] [1] [3] [nano-banana-2-lite] [<ABS-PATH-TO-GUIDE-WITHOUT-EXTENSION>] [none] [aspect_ratio=2:3]' > $W/queue.txt
cd $W && NANO_PROMPTS_DIR=$W/prompts NANO_IMG2IMG_DIR=$W NANO_OUTPUT_DIR=$W/out \
  NANO_QUEUE_FILE=$W/queue.txt NANO_QUEUE_LOG_FILE=$W/queue.log \
  NANO_IMAGE_RESULTS_LOG=$W/results.csv \
  node /home/siah/creative/reactjit/cart/editor/img.cjs --headless
```

Queue line grammar: `[prompt] [resolution] [imgs/batch] [batches] [model] [refs] [style] [k=v,...]`.

- **Always set batches explicitly** — the default is 25.
- Reference paths are absolute **without the file extension** (the loader appends
  .png/.jpg/... itself).
- The script auto-appends a UV safety instruction to any img2img run ("fill in the uv,
  remove the wireframe, no trademarks") — do not duplicate it in the prompt.
- `aspect_ratio` should approximate the atlas w:h (valid: 21:9 16:9 9:16 5:4 4:3 3:4 2:3
  3:2 square auto). Exact dims come later from the resize step, not from the API.
- Models (both proven): `nano-banana-2-lite` — dirt-cheap, ~12 s, halfway-decent; the
  drafting default. `gpt-image-2` — clearly better fidelity; use `[1024x1536]`-style
  resolution (max 2560x1440) + `quality=high`, and the **pink guide, never transparent**.
  Cost is not a constraint; generate 2–4 candidates per look and pick with your eyes.
- **gpt-image-2 WxH must be multiples of 16** (`816x1248`, not `810x1245`) or the API
  400s with INVALID_RESOLUTION. Round up to the nearest 16 and fix it in the resize step.

### Prompting

State what the object is, then walk the islands: anchor each description to a visible
island silhouette or its number (numbered + gpt-image-2 only), say what material fills it,
and demand full edge-to-edge coverage with island boundaries respected. Muted palettes
read best in-engine. End with "no text, no logos" unless signage is wanted — and know that
`atlas alpha is glass` in the world renderer: paint RGB, don't leave meaningful alpha.

**Declare the featureless islands, not just the featured ones.** Image models decorate:
any island you *name after* a functional part gets that part's graphics painted onto it —
calling the strip islands "edges of the card slot" painted a literal slot slit onto the
TOP face of a housing box (req_3690, the user caught it in the viewport). The fix that
worked verbatim: "every small island is a plain exterior face … absolutely NO slots, NO
slits, NO openings, NO buttons … the only openings on this machine are <the intended
ones>." Enumerate where detail IS allowed; declare everything else featureless.

## 3 · Map back — the part that actually matters

1. **Resize to the exact atlas dims** from the `atlas` reply (models return arbitrary
   sizes; 810×1245 came back 848×1264):
   ```bash
   node -e "require('sharp')('$W/out/<pick>.png').resize(<w>,<h>,{fit:'fill'}).png().toFile('$W/skin_1.png')"
   ```
2. **Import onto the live model:**
   ```bash
   tools/seat action uv-atlas '{"operation":"import","path":"<abs>/skin_1.png"}'
   ```
   Replies `pending:true` — it is async; wait ~2 s before judging. Import replaces the
   **live** atlas only (saved variants keep theirs) and refuses when an editable image
   workspace exists — use `uv-atlas add-layer {path,x,y}` + `compile-layers` in that case.
3. **Verify with your own eyes.** Shot at least two poses and READ the PNGs:
   ```bash
   tools/seat action viewport '{"operation":"pose","pose":[2.6,0.44,2.2,<cx>,<cy>,<cz>]}'
   tools/seat shot /tmp/skin_front.png
   ```
   `orbit {yawDegrees,pitchDegrees}` is **relative** — for a known angle use `pose`
   (radians, `[yaw,pitch,distance,targetX,targetY,targetZ]`, target ≈ bounds center).
   Judge: does each feature land on its face? Screen on the screen region, slots on the
   slot boxes, no island bleed at seams, no ghost label digits. Do not claim success from
   the flat PNG or the import receipt — only from shots.
4. **When it does not line up, do not give up and do not hand-nudge pixels.** In order:
   regenerate (candidates are cheap and misalignment is usually the model drifting off an
   island, not a systematic offset); tighten the prompt on the offending island; switch to
   gpt-image-2 + numbered guide for surgical control. A systematic shift/scale means the
   resize dims were wrong — re-check against the live `atlas` reply, never memory. UV
   geometry itself (`uv-geometry`, island moves) is a last resort and belongs to deliberate
   remapping, not to fixing a lazy generation.

## 4 · Multiple skins — paint variants are the wardrobe

One mesh, many looks. Each accepted skin becomes a named variant; variants do not multiply
palette entries (skins are instance wardrobe, ruled):

```bash
tools/seat action paint-variant '{"operation":"save-new","name":"graphite dark"}'
tools/seat action uv-atlas '{"operation":"import","path":".../skin_2.png"}'   # next look
tools/seat action paint-variant '{"operation":"save-new","name":"steel light"}'
tools/seat action paint-variant '{"operation":"read"}'                        # list
tools/seat action paint-variant '{"operation":"load","id":"1"}'               # switch
tools/seat save
```

`save-new` writes `paints/paint_N.png` + `paint_N.json` (cornerUv + raster base, zero
strokes — a full LOOK) and runs UV coverage cleanup: off-island pixels are cleared, so the
banked skin is tighter than the raw import. Finish with `tools/seat save` and, when
durability is material, `tools/seat semantic-status` — the semantic table must survive
skinning untouched (it is rigging data; dropping it is a bug, not a cost).

## Hazards

- **The paint-mode gate** (step 0.3) — "no authored UV geometry" almost never means what
  it says; it means nobody entered paint mode yet.
- **DEFAULT_BATCHES=25** — an unbounded queue line fires 25 batches.
- **Numbered-label leak** on cheap models; numbered guides pair with gpt-image-2 only.
- **gpt-image-2 + transparent wireframe = garbage.** Pink guide, always.
- **img.cjs is gitignored on purpose** (embedded API key). Never stage it, never copy it
  into tracked paths.
- **Do not run `atlas` after importing a skin** — it rebuilds the base and the live look
  with it. Topology edits mark paint stale; retexture after retopo, not around it.
- The dims in every resize/import come from the **live** `atlas`/`uv-state` reply, not
  from a remembered number.
