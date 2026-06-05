# Capture note — game/chance.ts (V9, capture wave 2026-06-04)

The ONE odds engine, rewritten fresh per V9: **scape's ChanceBreakdown surface
+ hmsc/combat_lab's coverFraction input, ground-truth-vs-display law intact.**
Old files untouched behavior references (V15-TRANSITION / V17-TRIAGE).

## Sources (read, never moved/copied/imported)

| piece | old file | what it contained |
|---|---|---|
| the surface | `cart/scape/systems/chance.ts` (`attackChance`) | multiplicative ChanceBreakdown {base, range, los, cover, awareness, health, time, skill, final}; weapon RangeProfile triangle; melee adjacency 1.8; clamp [0.02, 0.98] with true-0 preserved; tile-grid `lineOfSight` classifier |
| the input + dice | `cart/hmsc/npc/systems/chance.ts` | continuous coverFraction law (cut up to 80%), crouched ×0.7, skill-base 0.35+0.6s, range plateau 4m→0@40m, injectable-rng `rollHit`/`rollZone` zone table |
| the producer contract | `cart/combat_lab/index.tsx` (`coverFractionOf`) | 9 samples riding the target's own bones (head ×2), blocked/total fold |

## Verification

- `game/chance.test.ts`: 18/18 behavior tests green under v8cli (breakdown
  explains the outcome; cover monotone, ≤80% cut, continuous; partial-LoS
  legacy pricing; glass/range/melee laws; condition factors; seeded-rng
  determinism; zone distribution; door shape).
- Scape-path numeric fidelity: over **1,728 cases** spanning every input scape
  defines (profiled ranged + melee × LoS × awareness × hour × skill × health),
  `final` is identical to the old engine to 1e-12.
- `rjit game verify`: **VERDICT GREEN — 15/15 suites, 1/1 scripts.**

## The hybrid seams (where the two references meet)

- **Cover**: scape's binary "partial → ×0.65" is expressed through the hmsc
  law: `partialLosCoverFraction = 0.4375` (1 − f·0.8 = 0.65). A tile-only LoS
  producer prices props exactly as scape did; a bone-sampling producer's real
  fraction wins via `max()` (never summed — no double-count).
- **Range**: profiled weapons keep scape's triangle; the bare-ranged case —
  a HOLE in scape (`ranged && !profile` fell into the melee branch → 0 beyond
  1.8m) — is filled with the hmsc plateau-bleed curve (full <4m, 0 at 40m).
  This is the one deliberate behavior change vs scape (432/3,456 grid cases,
  all in the hole), and it is what makes profile-less NPC shots possible.
- **Stance**: hmsc's crouched ×0.7 joins the breakdown as the named `stance`
  factor (the surface grows one honest column).
- **Dice**: hmsc's rollHit/rollZone carried verbatim, rng injected
  (deterministic under a seed — `seededRng` added for tests/replays/the lab).
- **Units**: `falloffPerTile` → `falloffPerMeter` (same number; 1 tile = 1 m,
  R4).

## Deliberately NOT carried

- **scape `lineOfSight`** (citymap-coupled tile classifier) and **combat_lab's
  segment caster** — both are PRODUCERS (world / figure territory). The engine
  consumes their outputs (`LosQuality`, sample results); `COVER_SAMPLE_SPEC` +
  `coverFractionFromSamples` carry the contract's pure half.
- **hmsc `hitChance`/`ShotFactors` as a separate API** — superseded; one
  engine, one entry (`attackChance`). NPC shots route through it with
  `profile: null`.
- **`RangeProfile.needsLos`** — unread in both references' chance paths
  (scape's engine branches on the `ranged` argument); menu gating belongs to
  the items/actions capture.
- **hmsc's skill-base curve (0.35 + 0.6·skill)** — see conflict 1 below; not
  parked in the tuning table (no dead data), recorded here for the lab.

## Conflicts / ambiguities surfaced (NOT silently picked)

1. **The skill law genuinely disagrees and V9 doesn't settle it.** hmsc:
   skill sets the base, 0.35..0.95. scape: base from the weapon (0.6 bare) ×
   skill multiplier 0.6+0.8s — a bare-attack marksman lands ~0.84·(other
   factors), below hmsc's 0.95 ceiling. CARRIED: the scape law (V9 names
   scape's *surface*, and base/skill are surface factors). NET EFFECT: NPC
   shots are somewhat weaker at high skill than old hmsc. The V9-mandated
   tuning lab owns the final curve.
2. **Crouch may compound with sampled cover**: a crouched skeleton's bone
   samples drop behind cover (higher fraction) AND stance multiplies ×0.7.
   This matches hmsc/combat_lab's own behavior (both inputs existed there),
   carried as precedent — but the tuning lab should decide whether stance
   should apply only when no sample-based producer ran.
3. **Awareness is the TARGET's** ('unaware' mark = bonus, scape semantics).
   How NPC→player shots feed this (is the player ever 'unaware'?) is
   perception-capture wiring, not settled here.
4. **`game/index.test.ts` edited by one token**: `'GAME_CHANCE'` added to its
   `live` list (the inventory test pins capture-pending doors; going live
   requires registration — same move the kinds capture got). `game/index.ts`
   itself untouched.
