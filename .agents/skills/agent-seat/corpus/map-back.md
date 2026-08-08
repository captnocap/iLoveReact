# Phase: map-back

**Forward obligation —** Alignment is the deliverable. Only a viewport shot proves it — never the flat PNG, never the import receipt.

---

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
