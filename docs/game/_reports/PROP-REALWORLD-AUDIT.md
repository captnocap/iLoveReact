# Prop real-world size audit (req_0616, 2026-06-11)

> **CONTESTED & CORRECTED (req_0617, same day).** The user contested every
> verdict below with reference photos (a 4-yd dumpster reaching a 6ft man's
> chest vs the game's waist-high render). They were right; the verdicts below
> used the WRONG YARDSTICK. §CORRECTED below is the operative table; the
> original sections are kept for the raw real-world research numbers only.

## CORRECTED — presence ratio, not absolute meters (req_0617)

What the eye judges is **prop height ÷ body height in frame**, not meters.
Real presence = real avg ÷ 1.75m person. Game presence = rendered height ÷
the 2.01m player. Two compounding shrinks were found:

1. **The anchor gap (every prop):** props carry real-world meters but the
   player is 2.01m, so every "exact" prop renders at ~87% of its real
   presence. This alone makes the whole catalog feel uniformly small —
   exactly the user's complaint.
2. **Model honesty (per prop):** some models render BELOW their registry
   height. The dumpster's parts top out at ~1.05 of its `AUTHORED_HEIGHT`
   (1.2) normalization, so it renders ~1.18m, not the registry's 1.35m
   (~12% short). Its depth (`footprintRadius × 0.9` → 0.96m) is also far
   under the real 1.37m — interior volume ~1.2m³ vs the real 3.1m³, which
   is why 2–3 people fit in a real one and barely 1 in the game's.
   FireHydrant and Fence verified honest; the other ~15 models are
   UNAUDITED for this defect. (Dumpster part tables are also hand-duplicated
   between render3d/props/Dumpster.tsx and compile/worldGeometry.ts —
   rule-of-two violation, req_0612.)

| kind | game presence | real presence | % of real feel |
|---|---|---|---|
| treeBirch / treePine / treeOak / treePalm / treeCypress | 3.0–4.5× | 7.4–11.4× | **37–44%** |
| streetLight | 2.59× | 4.0× | **65%** |
| dumpster (rendered ~1.18m) | 0.59× | 0.78× | **75%** + half the volume |
| telephonePole | 4.23× | 5.03× | 84% |
| basketballHoop | 1.89× | 2.26× | 84% |
| barrier | 0.52× | 0.61× | 85% |
| trafficCone | 0.35× | 0.41× | 86% |
| bench / couch / cupboard / soccer/basketball | — | — | 87% |
| trafficLight | 2.79× | 3.14× | 89% |
| payphone / fence / table | — | — | 90% |
| chair / mailbox / stopSign | — | — | 92–93% |
| fridge | 0.95× | 0.97× | 97% |
| streetSign | 1.64× | 1.54× | 106% (over) |
| fireHydrant | 0.49× | 0.43× | 114% (over) |
| ballBeach | 0.40× | 0.29× | 139% (over) |

**The law that fixes it:** target `heightMeters` = real avg × (2.01/1.75 =
**×1.15**) — i.e. preserve the real-world presence ratio against the
stylized-tall player. EXCEPTION: interaction-anchored dimensions (seat
heights, counter/table tops, bed tops) stay locked to the FIGURE's landmarks
(seat 0.45 = the figure's knee 0.44; counters ≈ its 0.90 waist) — the figure
is not a uniformly scaled human (proportionally shorter legs), so sit/use
heights must track its skeleton, not the ×1.15.

Proposed registry targets: dumpster 1.57 (+footprint→~2.1m wide, deeper
aspect), trashCan 1.15, cone 0.82, mailbox 1.46, payphone 1.61, bench 0.98
(seat stays 0.45), stopSign 3.33, trafficLight 6.3, streetLight 8.0,
telephonePole 10.1, hoop 4.5 (rim 3.5), fence 1.4, barrier 1.23, hydrant
DOWN to 0.86, soccer 0.25, basketball 0.28; trees oak 17 / pine 23 / birch
16 / cypress 17 / palm 15 (or a tamer 12–16 urban band — needs a ruling,
trees affect sightlines/streaming). Plus: audit all ~15 unchecked models for
rendered-vs-registry honesty, and fix the dumpster model (parts must reach
AUTHORED_HEIGHT; depth aspect 0.9 → ~1.2).

Every hmsc-int prop kind (`cart/hmsc-int/world/propKinds.ts`) compared to its
real-world average size. Game numbers from `tools/prop-scale`; real-world
numbers researched 2026-06-11 (MUTCD/industry specs for street infrastructure,
regulation sizes for sport balls, standard furniture dimensions).

**The anchor problem:** the game player measures **2.01m** (live stand-pose
skeleton head-top) vs a real-world adult average of **~1.75m** — the figure is
stylized-tall (R4: scale verticals UP), factor **×1.15**. Props authored at
real-world size therefore read **~13% small** next to the player even when the
meters are perfect. "Stylized target" below = real average × 1.15.

## Verdict summary

- **~80% of the catalog is real-world accurate** — several are exact to the
  centimeter (traffic cone, dumpster, soccer ball, basketball, bench, the
  whole furniture suite). Whoever authored these used real specs.
- **Trees are the big outlier: ~half real size.** Urban mature trees run
  12–18m; the game's run 5–9m. This is the one family pointing the *opposite*
  direction from the R4 stylized-tall contract.
- **Street lights are ~35% short** of even residential poles.
- **Fire hydrant is ~30% tall** (the only oversized infrastructure item).
- **Beach ball is 'giant novelty' size** (0.8m vs 0.5m typical) — likely fine.

## Street infrastructure

| kind | game | real avg (range) | game/real | verdict |
|---|---|---|---|---|
| fireHydrant | 0.98m | 0.75m (0.61–0.91) | 1.31× | **tall** — above even the real max; stylized target 0.86m |
| streetSign | 3.30m | ~2.70m (7ft blade bottom) | 1.22× | OK — intentionally clears head height; ≈ stylized target 3.1m |
| streetLight | 5.20m | 7.00m (6–8 residential, 8–10 urban) | 0.74× | **short** — reads as a garden lamppost; stylized target 8m+ |
| stopSign | 3.10m | 2.90m (7ft mount + 30in octagon) | 1.07× | match |
| trafficLight | 5.60m | 5.50m (head top; 4.6m min clearance) | 1.02× | match (real); stylized target 6.3m |
| telephonePole | 8.50m | 8.80m (35ft pole − 6ft buried) | 0.97× | match (real); stylized target 10m |
| payphone | 1.45m | 1.40m (pedestal type) | 1.04× | match |
| dumpster | 1.35m | 1.37m (4-yd front-load, 4.5ft) | 0.99× | **exact** |
| mailbox | 1.35m | 1.27m (USPS collection box ~50in) | 1.06× | match |
| fence | 1.25m | 1.20m (chain-link/picket) | 1.04× | match (privacy fence would be 1.8m) |
| trafficCone | 0.70m | 0.71m (28in highway cone) | 0.99× | **exact** |
| barrier | 1.05m | 1.07m (42in tall Jersey; std is 0.81m) | 0.98× | matches the tall variant |
| trashCan | 1.00m | 1.00m (public can 0.9–1.1) | 1.00× | **exact** |
| bench | 0.85m (seat 0.45) | 0.85m back / 0.45m seat | 1.00× | **exact** |
| planter | 0.60m | 0.5–0.9m | — | fine |
| basketballHoop | 3.80m | 3.95m (3.05m rim + backboard top) | 0.96× | close — rim height is what matters |

## Trees (the outlier family)

| kind | game | real avg (urban / mature) | game/real | verdict |
|---|---|---|---|---|
| treeOak | 7.0m | 15m urban (18–25 mature) | ~0.47× | **half size** |
| treePine | 9.0m | 20m (15–30) | ~0.45× | **half size** |
| treeBirch | 6.0m | 14m (10–21) | ~0.43× | **half size** |
| treeCypress | 7.5m | 15m (Italian cypress 12–18) | ~0.50× | **half size** |
| treePalm | 6.5m | 13m (urban 10–20) | ~0.50× | **half size** |
| treeDead | 5.0m | n/a | — | fine |

Half-size trees are common game practice (sightlines, density), but they
contradict R4 ("scale verticals UP, stylised-tall not realistic") — the same
ruling that took buildings ×1.44 and palms to 4.2m→6.5m. Decision needed:
keep gamey trees or push toward ~10–14m.

## Furniture & household (real-world accurate as a suite)

| kind | game | real avg | game/real | verdict |
|---|---|---|---|---|
| chair (+3 colors) | 0.95m (seat 0.45) | 0.90m back / 0.45m seat | 1.06× | match (seat = player knee 0.44m, perfect ergonomics) |
| couch | 0.85m (seat 0.40) | 0.85m / 0.43m | 1.00× | **exact** |
| table | 0.78m | 0.75m | 1.04× | match |
| floorLamp | 1.70m | 1.50–1.80m | 1.00× | match |
| bedSingle / bedDouble | 0.90 / 0.95m | ~0.6m mattress, ~1.2m headboard | — | plausible (between mattress and headboard) |
| cupboard | 1.90m | 1.80–2.00m (wardrobe) | 1.00× | match |
| mirror | 1.90m (top) | ~1.9m hung full-length | 1.00× | match |
| sink | 0.90m | 0.85–0.91m counter | 1.00× | **exact** |
| oven | 0.95m | 0.91–0.97m range | 1.00× | **exact** |
| fridge | 1.90m | 1.70m (1.62–1.78 std) | 1.12× | slightly tall — coincidentally ≈ the stylized target 1.95m |
| computer | 0.55m | ~0.50m desktop setup | 1.10× | fine |
| wallPainting | 2.10m (top) | ~2.0m (hung at eye 1.5m center) | 1.05× | fine |
| ledLight | 2.40m | n/a (decor strip) | — | fine |

## Sport balls (regulation-exact)

| kind | game | real | verdict |
|---|---|---|---|
| ballSoccer | 0.22m | 0.22m (size 5) | **regulation-exact** |
| ballBasketball | 0.24m | 0.24m (size 7) | **regulation-exact** |
| ballBeach | 0.80m | 0.50m typical (giants 1.0m+) | oversized — "giant beach ball", probably intentional |

## Rocks & bushes — no real-world standard

rock/rockSmall/rockLarge/boulder/rockFlat/rockSpire/rockMossy/rockPile and
bush/bushLow/bushSparse/bushLarge have no canonical real size; any value is
an art choice. (bushLarge at 13m is explicitly authored as absurd-massive.)

## Sources

- Fire hydrant: ofstandard.com, thebuildingcodeforum.com (24–42in range)
- Street lights: leappole.com, inluxsolar.com, lightmart.com (residential 6–8m, urban 8–10m)
- Telephone pole: Wikipedia/utilitypoleuniverse.com (35ft std, 6ft buried)
- Traffic signal: MUTCD 4D.09 / cedengineering.com (15ft min clearance, ≤25.6ft top)
- Stop sign: MUTCD / mutcd.info (7ft urban mount + 30in face)
- Dumpster: dumpsters.com, budgetdumpster.com (4-yd = 4.5ft high)
- Trees: engineeringtoolbox.com urban tree heights, lehigh tree fact sheets
- Balls/furniture: regulation sport specs + standard furniture dimensions
