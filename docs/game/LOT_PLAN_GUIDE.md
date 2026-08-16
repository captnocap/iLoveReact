# Lot Plan Guide — realistic floor-plan scale for grid templates

Steering numbers for anyone (human or LLM) authoring lot plans (req_4514/4518/4519).
Everything is in **tiles**: 1 tile = 1 m (scale ruling R4, `tools/oracle "scale contract"`).
The lot-plan data layer lives at `cart/editor/world/lotPlan.ts`; this guide is what to
*put in it* so buildings read as real. Sources at the bottom; numbers are rounded to
whole tiles outward, the same way placeable footprints round.

Standing rulings this guide obeys:

- **V24** — Plan Build (Sims-style) and Creative Build edit the SAME semantic piece
  data; the 1 m grid is the snap substrate, never the object model.
- **V30** — interiors are separate maps; **only trivial storefront-class walk-ins may
  live inside the city map**. This is why the mixed-use section splits at the lobby door.
- **V29** — reference-not-embed: a building is a few unit templates stamped many times,
  never per-unit authored copies.
- **req_4501** — collinear same-spec wall strokes ARE one wall: a party wall between two
  units is a single run, not two back-to-back walls.
- **req_4482** — floors derive from enclosure; a plan authors walls and never floors.
- **req_4491** — an opening kit fits any wall at least as thick as its measured housing.

---

## 1. Rooms — minimum and comfortable sizes

| Room | Minimum (tiles) | Comfortable | Notes |
|---|---|---|---|
| Bedroom | 3×3 | 3×4 – 4×4 | Real code min ~2.4×3.4 m; 3×4 fits a 2×3 king bed + walkway |
| Living room | 4×3 | 4×5 – 5×6 | Couch (3×1) + TV wall + walkway |
| Kitchen | 2×3 | 3×4 | Counter run 1 deep, passage ≥1 clear (code: ≥0.9 m) |
| Bathroom | 2×2 | 2×3 | Real min ~1.6×2.4 m; 2×3 fits tub + sink + toilet |
| In-unit hall | 1 wide | 1 | 1 tile ≈ 0.9–1.2 m code hallway |
| Shared corridor | 2 wide | 2 | Double-loaded standard is ~2.4 m — always 2 tiles |
| Closet | 1×1 | 1×2 | |

Doors occupy one edge cell (≈0.9 m leaf). Keep both flanking tiles clear — the audit
refuses `placement-blocks-door`.

## 2. Unit archetypes — the templates a building stamps

Frontage = the party-wall-to-party-wall width facing the corridor/street.
Depth = corridor face to exterior window wall.

| Archetype | Frontage × depth | Area | Real-world anchor |
|---|---|---|---|
| Studio | 5×7 | 35 u² | ~370–440 ft² US studio / EU 35 m² minimum |
| 1-bedroom | 7×8 | 56 u² | ~600–750 ft² US average |
| 2-bedroom | 10×8 | 80 u² | ~850–1100 ft²; two bedrooms never share a wall with the living TV wall |
| Corner 2BR | 9×9 | 81 u² | Ends of the corridor; windows on two sides |

Rules of thumb that make a unit read as real:

- **Wet wall discipline**: kitchen and bathroom share one wall (or back onto the
  corridor wall) — real plumbing stacks; also lets stacked floors align (see §4).
- The entry door opens into living/hall, never straight into a bedroom.
- Every habitable room (bed/living) touches the exterior wall for a window; bathrooms
  and closets take the interior.
- Bedroom doors come off a hall or living room, and bedrooms cluster away from the entry.

Example 1BR at 7×8 (corridor above, exterior below; `D` door, `W` window):

```
┼──┼──┼DD┼──┼──┼──┼──┼   corridor side
│Bath │K  K │Hall    │
│2×3  │Kitch│        │
┼──┼──┼──┼──┼D ┼──┼──┼
│Bedroom 3×4│Living  │
│           │4×4     │
┼WW┼──┼WW┼──┼WW┼──┼WW┼   exterior side
```

## 3. Assembling a floor — the double-loaded corridor

The workhorse inner-city floor plate:

- **Building depth 16–20 tiles**: unit depth 7–9 + corridor 2 + unit depth 7–9.
  (Real guidance: 20–30 ft per side over a ~2.4 m corridor.)
- Units stamp side by side along the corridor, **party wall to party wall** — one wall
  run per boundary (req_4501), alternating mirrored so wet walls pair up.
- **Core** every floor, same position every floor: stair 3×6, elevator 3×3, trash/util
  1×2. Two stairs (opposite ends) once a corridor exceeds ~30 tiles of travel.
- A 40-tile-long floor at 18 deep holds roughly: 2 cores + 8–10 units mixed
  (2 studios, 5 1BR, 2 2BR corners) — a realistic unit mix is ~15% studio, 50% 1BR,
  35% 2BR, corners always the biggest.

## 4. The building — floors as stamped templates

A building plan is NOT floors authored one by one; it is (V29 in miniature):

- a **footprint** (the lot rectangle + street edges),
- a small set of **unit templates** (§2),
- per floor: a **stamp list** (template, offset, mirrored?) + the corridor/core spine,
- **stacking laws**: cores align exactly on every floor; unit party walls stack over
  party walls (structure), wet walls over wet walls (plumbing). Typical: floors 2..N
  are the SAME stamp list — one template floor, repeated.

Floor-to-floor: residential 3 m; ground floor 4.5–6 m when retail lives there (§5).

## 5. Mixed-use ground floor — retail below, living above (req_4519)

The inner-city default. The ground floor is a DIFFERENT plan from the residential
floors above, and it is the one passers-by judge — the footprint "says come in here."

- **Retail depth 9–12+ tiles** from the street face (tenants demand ~40 ft; 30 ft is
  the accepted minimum). Shallower than 9 reads as a kiosk, not a store.
- **Storefront bays 6–9 tiles wide**, a door every bay or two — entrance rhythm is what
  makes a street walkable. Glazing (windows) across most of each bay.
- **≥50% of the street frontage is active storefront** (a real zoning standard);
  service doors, garage entries, and blank wall go to the alley/side.
- **Ground floor height 4.5–6 m** (real minimum guidance ~20 ft) — taller than the
  3 m residential floors above; the facade shows it.
- The **residential lobby** takes a narrow 3–5 tile frontage between storefronts:
  street door → lobby → mail wall → core (stair + elevator). Retail wraps around it.
  Back-of-house (trash, util) shares the alley side with retail service.
- **Map split (V30)**: each storefront is a trivial walk-in that may live in the CITY
  map; the lobby door is the **changelevel marker** — the residential floors above are
  their own interior map. One building, two worlds, split exactly at the lobby.

Ground-floor plate at 24×16 (street below, alley above):

```
┼──────── alley: service, trash, loading ────────┼
│ BOH │ BOH │ core+ │ BOH  │ stock │             │
│     │     │ util  │      │       │             │
┼─ ─ ─┼─ ─ ─┼──┼────┼─ ─ ──┼── ─ ──┼─ ─ ─ ─ ─ ─ ─┼
│ Shop A    │Lobby│ Shop B │ Shop C (corner,     │
│ 8×10      │3×10 │ 7×10   │ wraps the corner)   │
┼WWDWW┼WWWW─┼D────┼WWW─DWW─┼WWWW─D─WWWW──────────┼
                street
```

## 6. Authoring order (what the feedback loop expects)

1. Lot rectangle + street orientation.
2. Rooms zoned per cell (§1 sizes) — or for a building, stamp unit templates (§2).
3. Walls on edges; party walls once; exterior shell closed.
4. Doors (circulation first: entry → hall → rooms; audit catches sealed rooms),
   then windows on exterior walls.
5. Placements, wall-mounted against real walls — every footprint is measured, never
   guessed (`LotPlaceableFacts`).
6. `auditLotPlan` → fix every refusal → re-audit until clean.

## Sources

- [RentCafe — US average apartment sizes](https://www.rentcafe.com/blog/rental-market/real-estate-news/us-average-apartment-size-trends-downward/) · [HireAHelper 2026 averages](https://www.hireahelper.com/advice/average-apartment-size/) (studio ~440 ft², 1BR ~800 ft², 2BR ~1090 ft²)
- [MDPI — multifamily massing study](https://www.mdpi.com/2075-5309/11/3/99) (7.6 m unit depth, 2.4 m double-loaded corridor; 20–30 ft depth per side)
- [UpCodes — minimum room widths](https://up.codes/s/minimum-room-widths) · [Teoalida — housing rules](https://www.teoalida.com/design/rules/) (7 ft habitable minimum; bedroom 2.4×3.4 m; bath 1.6×2.4 m; 1.2 m halls)
- [SPUR — Designing at Ground Level](https://www.spur.org/publications/urbanist-article/2014-06-03/designing-ground-level) (20 ft ground floors; entrance rhythm) · [SeaTac mixed-use standards](https://www.codepublishing.com/WA/SeaTac/html/SeaTac15/SeaTac15520.html) (30 ft retail depth, 50% active frontage) · [ULI — flexible retail/residential](https://urbanland.uli.org/planning-design/avoiding-retail-vacancies-flexible-retailresidential-design) (tenants demand 40 ft depth)
- [4D Planning — UK space standards](https://www.4dplanning.com/blog/minimum-space-standards) (37–41 m² studio/1-person minimums)
