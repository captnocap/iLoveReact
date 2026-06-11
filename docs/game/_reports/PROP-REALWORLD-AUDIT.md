# Prop real-world size audit (req_0616, 2026-06-11)

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
