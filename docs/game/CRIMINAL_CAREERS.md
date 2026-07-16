# Criminal Careers & The Crypto Economy

Status: **design corpus** (2026-07-16). Cross-session concept doc. Nothing here
is "from scratch" — most systems named below already exist in `framework/sim`,
the editor Studio, the stealth/perception design, and the screen-material path.
This doc's job is to hold the concept **end to end** so it survives across
sessions and the pieces get built into one coherent whole instead of drifting.

Companion docs: [mission_ideas.md](mission_ideas.md) (individual mission plots),
[GUIDING_LIGHT.md](GUIDING_LIGHT.md), DECISIONS.md (rulings — this doc proposes,
those rule).

---

## The Thesis (the one idea everything serves)

**The job is operating the real system.** A mission is not a minigame that
*represents* a crime — it is the player driving the actual underlying sim/UI.
Selling drugs = working the real order queue on a real (deliberately awful)
darknet UI. Running a rugpull = draining the real AMM in `framework/sim`.
Getting paid = a real AMM swap with real slippage. The satire lands because
nothing is exaggerated; the systems are just *shown honestly*.

Consequence that ties the whole game together: **every job generates witnesses
and records.** A botched kill spikes the detection meter (fast loop); tomorrow
it's a news cycle and 847 FlockBook witnesses (slow loop). A rug leaves a
Telegram full of victims. A wallet hunt leaves saved contacts. All of it feeds
the same event rings the stealth sim and market sim already feed. **The game's
memory is not a save file — it's the internet the player has been polluting.**

---

## Two clocks, restated for missions

Established across prior sessions and proven in the GC/market stress rig
(`cart/editor/inspector/GcStressSection.tsx`, 25k market trades over the live
world, no lag):

- **Game loop** never stops, never pauses, never waits on UI. Time never stops —
  so no menu protects the player. Engaging with a screen/table/NPC is a
  *vulnerability*, which is the core tension, not a limitation.
- **UI loop** (React) runs at event cadence; frame-cadence readouts (detection
  meter, price ticker, health) go through **latches** (host-owned f64s, zero JS
  per frame, zero GC). This is the validated safe pattern; missions must respect
  it — never drive a mission HUD off per-frame `setState`.

---

## The Career Paths (job options on the criminal ladder)

Each is a repeatable "gig genre," not a one-off scripted mission. Each already
has most of its machinery.

### 1. Vendor Work — narcotics order intake

**The fantasy:** the boring, grinding back-office of dealing. You run orders on
a darknet market that is *deliberately* unreliable.

**The mechanic IS the friction:** 8-second page loads, captcha theater, absurd
customer DMs, flaky escrow. You accept orders, arrange postage, tolerate the
chaos. The difficulty is patience + triage under load.

**Already built / cheap:**
- It's a **screen channel** (see Screens below) — a web UI on an in-world
  monitor. The awful latency is *injected at the document layer on purpose*
  (the inverse of the "you can delay a webpage and nobody notices" finding —
  here the delay is the antagonist).
- Deranged customer messages = the **schizo-post generator** finding its true
  purpose. This is order intake as psychological endurance.
- Postage/inventory = simple cold-system state.

### 2. White-Collar — cooking books & running rugpulls

**The fantasy:** financial crime as spreadsheet labor. Cook a quarterly-earnings
spreadsheet before a call, or take a client's large sum and shove it into
"risky investments" (rugpulls) and skim the portfolio.

**Already built — near 1:1 with `framework/sim` mutators:**
- `apply_lp_add(token_id, usd)` — pick launchpad, seed liquidity.
- `set_token_pattern(token_id, pattern)` — the scripted pump. The code comment
  literally reads *"Favors / scripted pattern flips."*
- `buy` / `sell` against your own token — **wash trading**. And because the sim
  has a **reactive queue** (`onTradeExecuted` → arb bots + copy-traders), your
  wash trades *attract real copy-traders* — the con working as designed.
- pool rug flag (`is_rugged`, reserve_quote *= 0.02) — the pull.
- `recomputeHeat()` already scales difficulty off wallet value + trade count —
  **finance already has a detection meter.** Wire heat → KYC.org notoriety and
  white-collar gets the same fast/slow loop as stealth: heat is the meter, the
  news cycle is the wanted level.

### 3. Pimping, modernized — OnlyFans/creator wrangling

**The fantasy:** you're the manager keeping creators "keeping up with demand" —
juggling buyer DMs, sending predefined prompts, coercing gooners to buy more.
Presence-management under load, same skeleton as vendor work but the resource is
attention/parasocial pressure instead of postage.

### 4. The Full Rug Run (the flagship white-collar mission flow)

A complete vertical the systems already support end to end:
1. Create a shitcoin name (see **Day-Seeded Naming Meta** — the name choice
   actually matters).
2. Pick a launchpad, add liquidity (`apply_lp_add`).
3. Open **Telegram**, play dev — hype, answer, sustain belief (the archived
   shitcoin cart had a 32-channel Telegram cold system).
4. **Balance presence vs. volume** — be active enough in the TG that people
   don't flake, while watching trading volume build.
5. **Wash-trading buttons** to pump — but it's just more of your own money at
   risk, and it draws copy-traders.
6. **Find the right moment to pull** before believers flake.
7. **Exit through a tumbler** ("Tornado service") — the extraction mission: a fee
   + a timer + a "don't touch the wallet while it tumbles" discipline check.

Tension model = the stealth model transplanted to finance: heat is the meter,
the resulting news/FlockBook cycle is the wanted level.

---

## The Crypto Economy (the spine under all of it)

### The sim, as it stands (`framework/sim/root.zig`)

- 256 tokens, each an AMM pool + price-pattern state machine (crab/pump/dump/
  organic/volatile/rug). Market mood biases every tick. 512 NPC wallets with
  profiles (retail/swing/whale/alpha/dev_insider/mev_bot/rug_runner/paper_hands/
  cartel). Reactive MEV/copy-trade queue. Heat/difficulty. Poisson tape
  scheduler + live tape ring. All fixed-pool, zero-alloc, zero-GC hot path.
- `quote_buy`/`quote_sell` return output, **price impact, and fee** against real
  reserves. Pool depth varies by chain — thin chains = worse exits.
- Mints a **fresh ETH-style wallet per run** (`freshRunId` → per-run seed).

### Two versions of the sim

1. **Always-on economy (the game-world market).** Boots with the save. The
   player's wallet exists from the start. Every price is live. This is the
   "what if we actually used crypto IRL" layer.
2. **Hyper-scaled roguelite (mission trading).** A sped-up, self-contained run
   of the same sim as a *mission type* — fast rounds, fresh wallet each run,
   roguelite structure. Same code, different time-scale + lifecycle.

### Crypto-as-wages — the settlement-friction economy (strongest idea)

**Every gig pays in a random dick coin** ($CHAD, $ELONCUM, whatever the name
meta produced that day). To spend it you must convert.

- Get paid in $CHAD → walk to the shop → shop wants USD (or *its own* preferred
  coin) → you eat the conversion: slippage, fee, and the fact that **$CHAD
  dumped 12% during your walk over.**
- This needs **no new event system** — GAME_DAY_MS is 60s, so a 90-second walk
  is ~1.5 market days. The dump isn't scripted; it's *the sim continuing to
  exist while you walk.*
- Settlement friction becomes gameplay — the truest possible depiction of
  crypto-as-money. The promise was "frictionless payments"; the reality is
  you're doing an AMM swap to buy a sandwich and the pool was thin.
- Player choice: convert immediately on payout (lock value, eat fee now) or
  hold and hope (carry price risk to the register). That's the whole trade-off
  and it's real, not simulated.
- **Only new system needed:** a shop's payment preference (USD / own coin /
  accepts-anything-at-a-haircut) — one keyvalue on the shop entity.

### Day-Seeded Naming Meta

Token names are components (the sim's generator already uses SYL_A × SYL_B
syllable pools). Make naming *matter* via a pure deterministic hash:

```
score_bias = f(hash(currentDay, sortedComponents))
```

- Zero storage, infinite scale. Some days `elon+cum+doge` prints 5–10% better
  than `safe+elon+cum` — and it rotates daily.
- Produces **Wordle economics**: players discover the day's hot pairing, post
  it, and the meta is *real* because the scoring function is shared/deterministic.
- Slots into `seedOne` as a pattern-probability bias; nothing else changes.

---

## Wallets-to-Faces (where stealth + market + social fuse)

The sim mints 512 NPC wallets with profiles. The world has ~300 mapped NPCs
(scaling the ~30 from the old game). **The join is a hash:**

```
wallet_id = hash(run_id, npc_id)
```

Because `run_id` seeds it, **whale distribution is genuinely per-save random.**
The NPC who lives in the alleyway can roll the whale wallet in one player's game
and be broke in another. This isn't authored — it's a *property that falls out of
the hash*. Nobody's collection is the same.

**The gameplay that grows on top:**
- Engagement interaction verbs on NPCs: "ask for their crypto address," "save to
  contacts?" (rides the **engagement system** — cursor-released, world-alive
  interaction menus).
- Saved contacts = a **phone app** (contact book). Tracking a saved wallet's
  assets = a `snapshot` filter over the sim.
- **Treasure-hunt mechanic:** "find the faces of these 5 whale wallets" = a
  *social* hidden-package hunt. You find them by watching spending behavior,
  overheard calls, the car the alleyway guy suddenly bought — not by map icons.
- FlockBook's tagline ("Human Tracking For The Modern Social Era") stops being a
  joke and becomes the tutorial.

---

## Blueprints & Crafting (Studio as the crafting system)

**"It's just the same Studio anyway"** — we ship the editor; crafting is the
editor with a rubric.

**The loop:**
1. Take a free/base asset (e.g. a gun), **decompose into parts**, turn each part
   into a **blueprint**.
2. A blueprint is deliberately *confusing* — e.g. a 3-picture diagram, not a
   step-by-step. The player builds what they *think* they see.
3. **Score = shape fidelity of the submitted mesh vs. the target.** Use the SDF
   path (`sdf_roundtrip_lab`): sample both meshes as SDFs on a grid, score
   symmetric (chamfer-style) distance — rotation/topology-forgiving, rewards
   *shape* not vertex-order luck. Grade thresholds → **quality tiers** on the
   resulting stat item.
4. **Replayable forever:** come back anytime, improve the mesh, raise the grade.

**Customization layer (same Studio again):**
- On top of a built gun: build the stock, then paint it, add charms — all just
  Studio operations (mesh + face paint + stickers/attachments).

**Two reward types, one pipeline:**
- Achievement rewards resolve into *either* a finished **cosmetic attachment**
  (a mesh asset — pure looks) *or* a **blueprint** (target mesh + diagram — the
  stat-based thing). Same content store; one flag decides stats-vs-paint.

---

## Screens (how mission UIs live in the world)

Recap of the screen-material capability (see `framework/gpu/material_tex.zig` —
"run a recipe once into a keyed texture any mesh samples via `scene3d_tex_key`",
already used by the no-V8 world_loader):

- Author flow: make a TV in Studio → select the screen **face** → tag its slot
  role `screen` → export as prop → place → assign a **channel**.
- The one new primitive: a **UI-subtree → keyed-texture paint pass** (like
  `effects.renderShaderToTexture` but painting the UI path), repainting **only
  when dirty** — a ticker at ~2Hz, a webpage once until navigation. Event cost,
  not per-frame cost.
- **Channels, not screens:** 50 TVs airing `channel:news` share ONE texture (one
  paint, many samplers) — the Vice City reference-not-embed doctrine applied to
  screens. A unique screen (safehouse PC) is a channel with one subscriber.
- Bonuses: ticker channel is latch-bound to `framework/sim` (the pawn-shop TV
  shows *real* prices; a rug updates every screen showing that token); CRT/VHS
  filter shaders post-process the screen texture; emissive screens are light
  sources that feed the stealth light model.
- Endgame: engagement pick-ray hits the screen face → UV → document coords →
  the same hit-testing that runs the editor runs the in-world monitor. The
  in-world computer *is* the browser. (The original cs_office-monitor goal,
  closed-form, in-engine.)

Vendor Work, the Rug Run's Telegram, the darknet market, the OnlyFans DMs — all
are screen channels. Mission UIs are content on monitors, not overlays.

### Easter Egg: the recursive game (turtles all the way down)

A café (or wherever) has a computer whose screen channel is not a website — it's
**this game**, booted from a fresh-seed gamefile. Engage it, and you descend into
a new instance of the same game. In *that* world is another café with another
computer, and it keeps nesting.

**It is literally free** — it's the same compiled game the player is already
running, loaded with a new seed. The rendering capability exists:
`framework/gpu/world_window.zig` already renders a second compiled world to its
own wgpu surface (WORLDWIN-0611); a screen texture is just a different render
target for it.

**The bound is EMBODIMENT, not triangles.** (Render cost is a non-issue —
unculled tri budget doesn't choke until ~155M, and an interior scene culls ~99%
of the parent's chunks anyway: the moment the player sits at a machine inside a
building, the parent world collapses to a room + a window.) What actually costs
per level is the **live sim** (perception for ~300 NPCs, market ticks, physics).
So the rule — do NOT try to make this literally infinite / all-levels-live:

> **Only ONE level is embodied at a time.** Descending makes the child the
> embodied world and drops the parent to a frozen/ambient snapshot (V21
> distributions, no active perception — the frozen-world ruling). Ascending
> (WASD, same as any engagement exit) re-embodies the parent and freezes the
> child. It's never "N live worlds" — it's one live world plus a stack of paused
> snapshots the player climbs. Inception's rule: one dream real at a time.

**Memory is not the bound either (measured 2026-07-16).** One full resident
market sim (256 tokens w/ 64-candle history, 512 NPC wallets, 16k trade ring,
all buffers) = **1.77 MB** — computed from `@sizeOf` over the `SimState` layout,
exact because it's fixed-pool (tokens 698KB, npcs 352KB, live ring 576KB, rest
~190KB). And the sim is **seed-derived**, so a *frozen* level costs ~kilobytes
(its `run_id` + player-caused deltas), not 1.77MB — an untouched level you left
is 8 bytes and a promise. So nesting cost ≈ one live sim + a stack of seeds,
regardless of depth. On the machine that shrugged at 155M tris you could hold
hundreds of live markets resident; the depth bound is CPU (one live perception+
market tick at a time, per the embodiment rule), never memory or triangles. NB:
1.77MB is the crypto sim only — the ~300-NPC perception sim is designed-not-built
but is the same fixed-pool shape, expected similarly tiny.

Free consequences: each level has a **new seed** → genuinely different world,
NPCs, café placement, and (via `hash(child_run_id, npc_id)`) its own whale-wallet
distribution — the broke alleyway guy up here may be the whale down there. Not a
hall of mirrors; turtles all the way down, each turtle its own city. Per the 847
doctrine, the deepest reachable machine should be running something slightly
wrong.

---

## Cross-System Fusion (why this is one game, not five features)

```
  STEALTH SIM ──witness events──┐
  MARKET SIM  ──trades/rugs─────┤
  MISSIONS    ──consequences────┼──► EVENT RINGS ──► COLD TS LAYER ──►
                                │                                     │
  wallet=hash(run_id,npc_id) ───┘        FlockBook posts, DeadDrop threads,
                                         police reports, news cycles, Telegram
                                         victim channels, market ticker
                                                    │
                                          the phone + in-world screens
                                          (the internet the player polluted)
```

- **Fast loop = latches:** detection meter, price ticker, health — this frame.
- **Slow loop = rings → cold TS:** who saw, who posted, who's hunting you —
  tomorrow.
- The **detection meter and the fake internet are the same information at two
  cadences.** The wanted system *is* social media.

---

## Build Status (so no session thinks it's from scratch)

| Concept | Exists today | New work |
|---|---|---|
| AMM market, 256 tokens, 512 NPC wallets | ✅ `framework/sim` | — |
| quote/buy/sell w/ slippage+fee | ✅ `sim/root.zig` | — |
| LP add, scripted pattern flip, rug, wash | ✅ sim mutators | mission wrappers |
| heat/difficulty meter | ✅ `recomputeHeat()` | wire → KYC notoriety |
| per-run fresh wallet | ✅ `freshRunId` | — |
| Telegram/social cold systems | ✅ archived shitcoin cart | re-home into game |
| schizo-post generator | ✅ skill | point at order intake |
| screen-material (mesh samples keyed tex) | ✅ `material_tex.zig` | UI→texture paint pass + channels |
| Studio mesh/paint/stickers | ✅ editor | blueprint rubric + SDF scoring |
| SDF sampling | ✅ `sdf_roundtrip_lab` | chamfer grade metric |
| engagement (cursor/camera context) | 🟡 designed | build |
| stealth perception (300 NPC vision/hearing/light) | 🟡 designed | build |
| crypto-as-wages settlement | 🟡 sim-ready | shop pay-preference keyvalue |
| day-seeded naming meta | 🟡 sim-ready | scoring hash in `seedOne` |
| wallet↔face join | 🟡 sim-ready | `hash(run_id,npc_id)` + contact app |

Legend: ✅ built · 🟡 designed/sim-ready, needs wrapper.
