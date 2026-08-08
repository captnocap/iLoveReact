---
name: agent-skin
description: Generate AI image textures for a modeled, semantically named mesh in the live ReactJIT studio editor and map them back onto its UV atlas. Use when an agent must skin a 3D model from a prompt — the agent-seat oracle routes the skinning phases and gates each one.
---

# Agent Skin

Texture a model the editor already owns. Never hand-paint pixel by pixel, never bypass the
resident atlas/variant machinery. **Alignment is the deliverable** — a texture that looks
good as a flat PNG but lands off-island is a failure, and only a viewport shot proves it
landed.

This skill is the skinning half of `agent-seat`, and it runs through the same gate machine.
Its working knowledge now lives in the oracle corpus as four phases — `uv-skin` (save,
atlas, prestack, guide export), `generate` (img.cjs + prompting), `map-back` (resize,
import, verify with shots), `variants` (the wardrobe).

## Start here

```bash
tools/seat oracle start "skin the <model> as <the look you want>"
```

That classifies to the **skin** plan — `setup → uv-skin → generate → map-back → variants →
finish` — and hands you the first phase's doc, checklist, and exit criteria. Then
`oracle status` / `oracle advance` as usual; `oracle ask "prompting"` or
`oracle ask "paint variants"` pulls a slice without moving the plan.

The model should arrive blocked out, package-saved, and with named regions. If it does not,
the `uv-skin` gate says so — every uv-atlas operation refuses without a package on disk.

## What never changes

- **The dims come from the LIVE reply, never from memory.** Resize to the `atlas`
  reply's exact `{w,h}`; a systematic shift means you used a remembered number.
- **Judge from shots, not from the flat PNG or the import receipt.**
- **`atlas alpha is glass`** in the world renderer — paint RGB, do not leave meaningful alpha.
- **Do not run `atlas` after importing a skin** — it rebuilds the base and the live look
  with it. Retexture after retopo, not around it.
- **`cart/editor/img.cjs` is gitignored on purpose** (embedded API key). Never stage it,
  never copy it into a tracked path.
- The semantic table must survive skinning untouched. It is rigging data; dropping it is a
  bug, not a cost of doing business.

Source of truth: `cart/editor/stage/ModelView.tsx` (uv-atlas/paint-variant handlers),
`cart/editor/model/uvWireframe.ts` (guide rasterizer), `cart/editor/img.cjs` (the
generation console). Phase docs: `.agents/skills/agent-seat/corpus/`.
