# Phase: map-back

**Forward obligation —** Alignment is the deliverable. Only a viewport shot proves it — never the flat PNG, never the import receipt.

---

## 3 · Map back — the part that actually matters

1. **Resize to the exact atlas dims** from the `atlas` reply (models return arbitrary
   sizes; 810×1245 came back 848×1264):
   ```bash
   bun -e "…"   # see the NAMED GAP below — there is no shell verb for this yet
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

---

## NAMED GAP: resizing to the atlas dims has no verb yet

The resize step above is the one place this pipeline still leaves the tool. That is a
**missing capability, not a licence to script** (`CLAUDE.md` → THE ESCAPE HATCH IS THE
SPEC). The engine already owns the whole pipeline — `framework/image/codec.zig` behind
`__imageops_*`, wrapped by `runtime/image.ts` with a resize that takes the same
`(width, height, { fit: 'fill' })` shape the old `sharp` call used:

```ts
image(bytes).resize(w, h, { fit: 'fill' }).png().toFile(path);
```

What is missing is a SHELL entry point, so an agent at a terminal cannot reach it. The
right verb is not a generic resizer either — it is one that never asks the agent for the
dimensions at all, because "resize to the LIVE atlas dims" is the intent every single
time, and a remembered number is the documented failure mode of this whole phase:

```bash
tools/seat atlas-fit <src.png> <dst.png>    # NOT BUILT YET — resize to the live atlas
```

Until that exists, do the resize through `runtime/image.ts` rather than `sharp`, read the
dims from the LIVE `atlas`/`uv-state` reply, and say in your report that you had to leave
the tool. That report is what turns this gap into the next verb.
