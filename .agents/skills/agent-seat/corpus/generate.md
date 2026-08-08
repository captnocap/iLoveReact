# Phase: generate

**Forward obligation —** Declare the featureless islands, not just the featured ones. Anything you name after a functional part gets that part painted onto it.

---

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
- If Generating a UV, append a UV safety instruction to any img2img run ("fill in the uv,
  remove the wireframe, no trademarks").
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
