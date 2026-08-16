---
name: scale-check
description: Routine scale audit of the model library against real-world anchors — survey every saved package's measured bounds in one call, flag off-scale props, and rescale them live through the Agent Seat. Use when the user says "check scale", "scale audit", "is this to scale", "my models are the wrong size", or after a modeling session lands new props.
---

# Scale Check

The world is 1 u = 1 m (scale ruling R4) and a model's MEASURED size IS its size
(req_4562 — never quantize, never treat a spoken example as a spec). The user models
"really small and scales after, or big" — so routine sweeps are how the library stays
honest. Measuring is painful in-app and trivial from here; that asymmetry is this
skill's whole job.

## 1. Survey — one call measures everything saved

```bash
tools/seat action package '{"operation":"list","measure":true}' > /tmp/scale-survey.json
```

Every saved model answers with `sizeU: [w, h, d]` meters and `boundsU` straight off its
saved doc (`meshDocBounds`, decode-cache reads). Needs the live editor. Sort by height,
scan both ends — the disease shows at the extremes. Models with `saved:false` are
unmeasurable until first save.

## 2. Judge — against real-world anchors, in meters

Judge by CLASS, not vibes. Common anchors (w × h × d unless noted):

| Class | Real size | Class | Real size |
|---|---|---|---|
| door leaf | 0.91 × 2.03 × 0.045 | traffic cone | base 0.36, h 0.45–0.71 |
| king bed | 1.93 × ~0.6 × 2.03+ | street/road sign face | 0.75; post top ~2.1–3.0 |
| couch (3-seat) | 2.2 × 0.85 × 0.95 | street lamp | h 4.5–6 (residential) |
| dining chair | 0.45 × 0.9 × 0.5 | parking meter | h 1.5 |
| toilet | 0.5 × 0.75 × 0.7 | fire hydrant | h 0.75 |
| plunger | cup 0.15, h 0.5–0.6 | keyboard | 0.45 × 0.03 × 0.15 |
| skateboard | 0.81 × 0.1 × 0.2 | VCR/DVD deck | 0.43 × 0.09 × 0.25 |
| refrigerator | 0.9 × 1.8 × 0.8 | vending machine | 0.99 × 1.83 × 0.97 |
| car wheel | dia 0.63–0.7 | sedan | 4.8 × 1.45 × 1.85 |
| human (player) | 1.65 collider (R4) | storey | 3.0 floor-to-floor |

Two sanity cross-checks that need no table: the player is 1.65 m — would they fit
through it / sit on it / hold it? And the door leaf is 0.91 × 2.03 — every furnishing
must pass through one.

## 3. Fix — uniform scale about the floor plane, live

For each off-scale model (its tab must be open once so it's resident; the active model
is simplest — background transforms work on resident parked sessions):

```bash
tools/seat claim <password> <agent>            # export RJIT_SEAT_TOKEN too
tools/seat look                                # confirm the right model + generation
# select EVERYTHING (triangle count from look's percept faces field):
tools/seat action select-elements '{"kind":"triangle","indices":[0,1,...,N-1]}'
# uniform factor = target_real_size / measured_size, applied per axis about the
# FLOOR-CENTER pivot so the model stays grounded and centered:
tools/seat scale 1 0 0 <cx> <floorY> <cz> <factor>
tools/seat scale 0 0 1 <cx> <floorY> <cz> <factor>
tools/seat scale 0 1 0 <cx> <floorY> <cz> <factor>
tools/seat measure bbox model                  # VERIFY the numbers before believing
tools/seat dismiss
```

- `<floorY>` = the model's bounds min-Y, `<cx>/<cz>` = bounds center; all from `measure
  bbox model` BEFORE scaling. Never scale about the selection pivot for a grounding fix.
- ONE uniform factor per model — pick the axis with the clearest real-world anchor
  (bed width, sign face, cone height) and let the others follow. Non-uniform scaling
  is a remodel, not a scale fix; flag it instead.
- Leave the save to the user unless told otherwise (seat save also refuses naming
  debt); the rescale is visible instantly in their viewport.
- Cite before/after sizes in the report. A fix without a re-measure is a guess.

## 4. Report

Table of: model · measured size · anchor · factor applied (or "flag: needs remodel /
ambiguous class"). Models whose class you cannot anchor (art pieces, `shit_rock2`,
deliberate oversizes) get FLAGGED, never auto-scaled — intent beats the table, and
only the user knows intent.

## Known traps

- `package info` wants the model ID (e.g. `primitive:cube:13`), not the name — ids come
  from `package list` (or the package dir's `manifest.json`).
- The percept after claiming shows whatever model is ACTIVE — `look` first, always;
  the user switches tabs while you work.
- A rescale bumps the generation; the seat's generation guard refuses stale plans.
  Re-`look`, never re-send.
- Survey reads the SAVED doc: an unsaved live rescale won't show until saved. That is
  correct — the survey audits what the library would ship.
