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

## The Justice Loop (Arrest → Court → Jury) — where the slow loop RESOLVES

This is the payoff of "the game's memory is the internet the player polluted."
The detection meter (fast loop) and the news/social cycle (slow loop) finally
land somewhere: **the criminal justice system, run entirely on the records the
player already generated.** Near-zero authored content — the evidence *is* the
cold TS layer, read aloud in a courtroom.

### The chain

1. **Investigation.** Witness events (from the perception sim) + social posts +
   news accumulate against an open **case file** (heat that didn't decay). KYC.org
   notoriety is its public face.
2. **Arrest.** Enough builds up (or a botched job in front of cops) → arrest.
   **Booking** records your **current appearance** (the outfit/face you were
   caught in) — this becomes a tracked identity fact, and itself generates
   records (mugshot, arrest report, a news blip).
3. **Court date or discharge.** Minor → discharged. Severe → a court date is set,
   and you're released until then. The world keeps running (time never stops).
4. **The defendant is an NPC — pattern-matched from the witness reports.** The
   accused is whoever the witness descriptions best match. If you worked in a
   disguise resembling a specific NPC, *that innocent NPC* is charged. **Framing
   is emergent** from the perception sim's appearance memory, not scripted.
5. **Show up to court — but only in a disguise that is NOT your booking
   appearance.** Booking recorded what you looked like; matching it in the
   courtroom blows you. Identity management is the price of attending your own
   trial.
6. **Sit in the jury box. Steer deliberation.** (The Hung Jury crossover — you
   networked/farmed your way onto the panel via "Dating and networking for
   indecisive legal professionals.") Dialogue is pure **event-cadence** over the
   generated records. Three outcomes:
   - **Convict the innocent NPC** → case file **closes permanently** (heat
     purge). But an innocent is imprisoned — the sim registers it (their social
     graph reacts: family posts, a Public Defunder appeal, a wrongful-conviction
     thread; small standing risk a witness later **recants** and reopens it).
   - **Hang the jury** → case stays **open** (kicked down the road; re-arms).
   - **Acquit** → the investigation **continues** (the defendant walks; heat
     persists on you).

### The lore sites ARE the trial verbs (coherence win)

The crime registry already names the manipulation toolkit — these stop being
jokes and become the pre-trial mechanics:

- **WRJ (Witness Rejection Program)** — suppress/discredit witnesses *before* they
  testify = deleting or degrading witness-event records feeding the case.
- **Beyond a Reasonable Drought** ("attorneys specializing in making evidence
  disappear") — literally delete cold-TS records (posts, threads, footage) from
  the evidence pool.
- **The Fine Print / Probable Claws / CanISueThisIndividual** — representation,
  agentic-swarm lawyering, countersuit pressure.
- **Public Defunder** — petition/social pressure on the case.

So "tampering with the trial" is not a new content system — it's **operating the
existing lore sites against the existing record rings.** The wanted system, the
social sim, and the lore registry converge in one courtroom.

### Build status

| Piece | Exists | New work |
|---|---|---|
| Record rings (witness/social/news) | 🟡 designed (rings pattern proven) | case-file accumulation |
| Appearance-at-time-of-witness tracking | 🟡 **dependency** | perception sim must record *what you looked like*, not just "seen" |
| Arrest/booking flow | 🟡 | states + record emission |
| Defendant pattern-match | 🟡 | match witness descriptions → NPC |
| Jury/deliberation UI | 🟡 | event-cadence dialogue over records |
| Trial-tamper verbs (WRJ, Reasonable Drought, …) | 🟡 | wire lore sites → record mutations |

**Load-bearing dependency to flag early:** the perception sim must store
**appearance at the moment of witnessing** (disguise/face/outfit), not just a
"player was seen" bit. Framing an innocent, the booking-vs-courtroom disguise
rule, and the pattern-matched defendant ALL depend on it. Design the witness
event to carry an appearance fingerprint from day one.

---

## The Media Engine + Diegetic Intel (the game makes its own content, live)

**The game generates its own media as events happen, and that media is BOTH the
prosecution's evidence AND the player's early-warning system.** Crime → the world
reports on it → the player consumes those reports to decide the next move. The
content pipeline, the tension engine, and the tutorial are the same loop.

### The media is REPLAY, not recording (no footage is ever stored)

The game is deterministic **data in a streaming loader** — frozen/seed-derived
world (V29/V30), seed-derived sim (1.77MB reconstructs from a `run_id`), RLE
reference map. So the full game state at any past moment = **f(seed, checkpoint,
input log)**. You never record pixels — you **replay the game and point a new
camera at it.** This is the Doom-`.lmp` / Quake-demo / rollback-netcode model:
store *inputs*, not frames. An input log is bytes.

**It is the SAME primitive as the recursive-game easter egg** — render a game
instance to a screen texture. Media surfaces differ only by camera transform +
input source, played on the **screen-channel** system (any in-world TV) and the
**phone**:

- **Major-network news** — replay from a news-chopper / establishing cam.
- **Police bodycam** — replay with the camera bolted to the cop NPC's head.
- **FlockCamera** — replay from a fixed surveillance-cam transform (Flock/FlockBook
  crossover; the surveillance grid is diegetic).
- **Courtroom playback** — replay the crime from any angle, projected on a TV, in
  a courtroom that is itself being played. Turtles again.

Strictly better than recording: **bytes not gigabytes**, and **any angle after the
fact** (you're re-running the sim, not replaying fixed pixels — you point a camera
where no camera was). `framework/gpu/capture.zig` (H.264/VP9 ffmpeg pipe) stays
useful for *exporting/sharing* a clip out of the game, but is NOT how in-world
media works.

**The real constraint is determinism, not storage.** The sim/physics must replay
bit-identically from inputs (the classic rollback problem — float drift the usual
culprit). Mitigation the architecture already implies: **checkpoints.** The
compile-cache manifest (CACHE-0630) already snapshots content-addressed state;
replay needs determinism only over the **short window from the nearest checkpoint
to the event**, never the whole playthrough — tractable where full-game
determinism isn't. Store: seed + periodic state checkpoints + the input log.

### The core mechanic: the "dirty outfit" state is NEVER exposed

Each distinct **look** (outfit + face/mask) carries its own hidden accumulated
exposure (built from the appearance fingerprints on witness/camera events). **The
player is never shown a burn number or a "compromised" flag.** They find out the
way a real criminal would — **by watching the news and reading how specifically it
describes them:**

- "Police seek a *male suspect*" → vague, probably still safe.
- "…wore a *red jacket and backwards cap*" → your fit is now a description; review
  it, decide whether to change threads.
- "…and this **FlockCamera photo**" → burned; that look is done.

This is **diegetic intel as a design law:** the tension is *uncertainty*. You're
never told you got away with it — you infer your exposure from the media the game
generated, and you can guess wrong. Change threads too early = paranoid waste;
too late = you wore a burned fit into a cop's line of sight.

### What this turns wardrobe into

A real **identity/appearance system**: the player maintains multiple looks, each
with an **independent, hidden burn level**; rotating threads is active play, not
cosmetics. Booking (Justice Loop) hard-locks one look as *known to police*. Framing
(commit crimes resembling an NPC) pushes exposure onto *their* description instead
of yours. All of it reads from the one appearance-fingerprint dependency above —
which is now load-bearing for a THIRD system, reinforcing: **design it first.**

### Build status

| Piece | Exists | New work |
|---|---|---|
| Deterministic streaming loader + seed/RLE world | ✅ (V29/V30) | input log + checkpoint replay; determinism audit (float drift) |
| Render game instance → screen texture | ✅ `world_window.zig` / material_tex | retarget camera + input source per media surface |
| Clip export (out of game) | ✅ `capture.zig` | optional share path only |
| Screen channels / phone playback | 🟡 (screens designed) | news/bodycam/court channels |
| Appearance fingerprint on events | 🟡 **shared dependency** | (same one the Justice Loop needs) |
| Per-look hidden burn state | 🟡 | accumulate exposure per outfit+face |
| News description generation | 🟡 | fingerprint → specificity-scaled text/media |
| Wardrobe / look rotation | 🟡 | identity inventory |

---

## Conformity as Camouflage (behavioral stealth — the inverse tell)

A third suspicion axis, alongside the fast loop (vision/hearing/light → detection
meter) and the slow loop (records → justice). This one is **social-surveillance
cadence**, and it *inverts* stealth: everywhere else you evade by minimizing your
footprint — here **being too clean is the tell.**

### The idea

The culture is engineered to waste time (Drown = "Sink Your Life Away"; FlockBook;
the doomscroll). Everyone participates for hours. So **not** participating is
anomalous: you have a Drown account but never sink; everyone else does — *bit odd,
don't you think?* Your **behavioral signature** (time-on-apps, post cadence, the
rituals) is compared against the **population baseline**, and deviation reads as:
burner account, bot, or an operator with somewhere better to be. **The healthy
person is the suspect.** Satire that bites — and true.

### How it works

- Each citizen (the social cold systems already model Drown/FlockBook activity)
  contributes to a **population baseline distribution** of participation.
- The player's alias has an **activity signature**; low participation = a rising
  **conformity anomaly** on that identity.
- **Who notices is not a cop — it's the platform / the algorithm** (WHY-C, the
  FlockBook "Human Tracking" grid). Slow-loop, ambient. Enforcement is diegetic
  and darkly funny: a **Hot Fixed** (WHY-C psychiatric telemedicine) "we noticed
  you've been quiet — mandatory wellness check-in," a KYC review flag, ad-targeting
  that singles you out. Non-engagement triggers the dystopia's immune response.
- **Diegetic intel (same law as the burn state):** the conformity score is NOT
  shown as a number. You infer you're becoming an anomaly from in-world signals —
  the Hot Fixed prompt, an NPC remarking you're "never on," the ads changing.
- **NPC awareness** (via M3A): "you never sink" becomes a social fact an NPC holds
  (L5 co-occurrence, L2 "this person is odd"), referenced in dialogue.

### The tension + counterplay (and the tuning warning)

- **Time is the resource; the culture taxes it.** Performing normalcy (actually
  opening Drown, sinking, posting) costs the same game-time you'd rather spend on
  jobs. Opting out is efficient but suspicious. Pure no-pause-world tension: cover
  maintenance competes with crime.
- **Counterplay = laundering behavior:** bot/idle your presence (leave Drown
  farming engagement hours while you work) — but inauthentic patterns are
  detectable too, exactly like wash-trading is detectable. Or genuinely spend the
  time (safe, slow). Same risk/reward shape as everything else.
- **⚠ Tuning law:** this must be a **soft, optional-depth pressure**, NOT a
  mandatory doomscroll chore. Low conformity should *slightly* raise baseline
  suspicion / make you more memorable / unlock the enforcement gags — never
  instant-bust. Keep it thematic first, mechanical second; a grind here would
  punish the player for the game's own satirical point.

### Build status

| Piece | Exists | New work |
|---|---|---|
| Social activity sim (Drown/FlockBook) | 🟡 (engAIge cold systems, port as design) | population baseline distribution |
| Player alias activity signature | 🟡 | per-identity participation tracking |
| Conformity-anomaly score (hidden) | 🟡 | deviation vs baseline; diegetic-only surfacing |
| Enforcement gags (Hot Fixed / KYC / ads) | 🟡 | wire lore apps → anomaly response |

---

## Static Floor / Dynamic Ceiling (the AI content toggle)

The game has **two presentation tiers over one shared substrate** (the event bus
+ record rings). This is the "prebaked OR dynamic gameplay" toggle, and its
discipline is what makes AI safe to use here: **the AI is never load-bearing.**

### The baked floor (always on, offline, deterministic, free)

Every event/record has a **template representation** that always works: event →
canned/templated text → a local **MS-Sam-tier TTS** voice over the radio (KCHAT)
or TV. The news reports crimes in a robotic voice; the radio reads headlines and
schizo-posts; the courtroom (Justice Loop) is event-cadence dialogue over records
with button choices. Ships with the game, works with no network, no keys, forever.
Deterministic → **replay-safe.**

### The dynamic ceiling (toggle ON → the AI integrations light up)

The **same events/records** are intercepted by models that produce richer output:

- **AI writes the scripts** — news copy, radio-host banter, NPC dialogue, court
  arguments — all generated *from the real event/record data* (the cold TS layer).
- **Models EMBODY roles.** The courtroom stops being buttons and becomes real 3D
  models in a room where the **judge IS Claude** (or whatever model the user
  wires), the prosecutor/anchor/radio-host each a driven role, *reasoning over the
  actual evidence rings.* The mechanics are unchanged (convict/hang/acquit, heat
  purge) — the **fidelity** changes, not the game.
- **TTS tiers, user-plugged:** local synth (the floor) → premium endpoints
  (ElevenLabs-class) → the user's own **self-hosted** TTS. Same provider-abstraction
  pattern the AI providers already use (`useAssistant`/`worker_bindings`/
  `local_ai_runtime.zig`; the IDE cart already runs a `claude_code` chat).

### The boundary that keeps replay intact (design law)

**AI output is PRESENTATION, never authoritative state.** The deterministic
record — *crime happened, outfit was X, witness fingerprint was Y, verdict was
convict* — is what replays and what the game logic reads. The **script Claude
wrote about it is ephemeral flavor** layered on top and MUST NOT feed back into
the replayable sim/state, or determinism (and the whole replay-media engine)
breaks. AI *reads* the deterministic record and voices it; it never *writes* the
record. Non-determinism stays quarantined in the presentation layer.

### The dial: content density as a budget (local model = free ceiling)

Dynamic mode isn't a binary switch — it's a **budget dial**. Instead of a fixed
cadence of canned social posts, the user sets *how many tokens to spend over a
time horizon* (e.g. a 30-day game period ≈ 30 real minutes at GAME_DAY_MS=60s).
Crank it up → the in-world internet **booms** with generated content: news,
FlockBook/DeadDrop posts, radio banter, NPC chatter all become model-written.

This is **not new** — engAIge already ships the exact mechanism: an **AI queue
with per-priority budget reserves** (CRITICAL user DMs / court, HIGH NPC
reactions, MEDIUM scheduled posts, LOW background NPC↔NPC, IDLE pre-generation)
+ cost logging per call. It ports as **design** (concept + tuning; not code — no
Bun in reactjit). The dial just raises the budget floor: low budget → only
CRITICAL generates, everything else falls to the baked templates; high budget →
even background gossip is model-written. **Graceful degradation as a continuous
knob.**

**Local model = the ceiling is free.** reactjit **already embeds llama.cpp** —
`framework/assistant/local_ai_runtime.zig` runs a subprocess inference service
against bundled libllama, deliberately on a **separate compute path so the
renderer's wgpu/Vulkan never fights llama's compute** (the engine was built for
this). Consequences:

- Anyone with a gaming PC runs dynamic mode **locally** — "tokens" become GPU
  time, not a bill. The dial's ceiling for a local user is "how much GPU do you
  want to spend," bounded by throughput, not dollars.
- **The engine's lightness IS the AI budget.** Because the game is frugal
  everywhere (1.77MB sim, native JS-free world, no per-frame churn, baked
  content), the compute headroom to run a local model *alongside* the game
  exists — a normal AAA title couldn't spare it. Frugality upstream buys
  intelligence downstream.
- Background generation runs at **IDLE priority on spare inference throughput**,
  so it never starves the interactive roles (the judge answering, a DM reply);
  pre-generation front-loads content during idle so it's ready when the player
  arrives at it. Cloud users pay per token; local users pay in watts; either way
  it's the same queue and the same dial.

### Why this is the right shape for AI-in-a-game

- **Graceful degradation by construction:** endpoint down / model slow / no key /
  toggle off → fall back to the baked floor. The game never breaks because the AI
  is optional, always.
- **Two-clock safe:** generation is event-cadence or slower (a news script fires
  when the news event fires, not per frame), runs on worker threads, latency never
  touches the game loop. A judge taking 3s to "think" is fine — it's the UI/social
  loop; the world keeps running (time never stops).
- **One substrate, two fidelities:** baked and dynamic read the same rings, so
  content authored for one is never wasted on the other.

### Radio formats (KCHAT et al.) — content sinks for the record rings

Radio (heard while driving) is the ambient audio surface for generated content.
Formats are **content sinks**: each is a lens that turns the record rings into a
stream. Flagship bit —

**The Confessional (a priest's booth, mic'd up).** A station that is just an
open confessional booth on air — a slew of confessions. Systemically it's rich,
not just flavor:
- **Confessions = the crime records read aloud, first-person.** Every crime in
  the sim (NPC-committed, or player-adjacent) can surface as someone unburdening
  it. Infinite self-generating content from the rings; the schizo/unhinged register
  fits (mundane "I skim the tip jar" → 847-tier).
- **It's a diegetic INTEL LEAK** (same law as the burn state): a witness confessing
  guilt tells you a witness *exists* — "I saw a man in a red jacket do it and said
  nothing, forgive me." Now you know to find and silence them (→ WRJ). You learn
  about the case against you by hearing someone else's guilt.
- **Lore-owned:** of course **Prophet Margin / Indie Jesus** (feargod.org / Terms
  of Worship) mic'd the confessional and sells the ad slots — monetized absolution,
  same energy as Holy Shit.
- **Baked vs dynamic:** floor = MS-Sam reads templated confessions assembled from
  records; ceiling = the model writes genuine, specific, unhinged ones, TTS-voiced.

Other format seeds (same sink pattern): news/headlines, a shitcoin-market call-in,
schizo-post AM ranting, a wallet-whale gossip show (feeds the treasure hunt).

---

## NPC Memory & the "Dumb Fine-Tune" (persistent character without training)

**Reference architecture to port: M3A** — the 5-layer Multi-Modal Memory
Architecture in `~/creative/ai/app/src/bun/lib/memory/` (TS/Bun; ports as design
+ math, hot path Zig-able like the market sim). It models *human* memory, which
is exactly what a witnessing, remembering, gossiping NPC needs.

### The five layers (M3A), mapped to NPC needs

| Layer | Codename | What it is | NPC use |
|---|---|---|---|
| **L1** | RIVER | sliding-window buffer, evicts on overflow → triggers consolidation | what the NPC just saw/heard |
| **L2** | FEELING | affect index — 6 categories on arousal/valence + intensity | how an event felt (a witnessed murder = high-arousal/negative) → colors tone |
| **L3** | ECHO | redundant encode: vector + lexical + entity-graph; "resonance" = how many match | factual recall (who/what/where) |
| **L4** | WOUND | salience store: score, **prediction-error** (surprise), pinned, retention priority | the thing that STUCK — the NPC never forgets they saw you kill someone |
| **L5** | COMPANION | co-occurrence graph, weighted edges, temporal decay | social knowledge — who they associate you with (feeds the wallet hunt / social graph) |

Retrieval is an **ensemble** across all five (tunable weights, temporal bias
recent/salient/balanced, affect boost). Consolidation is the **Shadow Curator**:
on overflow/schedule it summarizes evicted L1, **detects stance conflicts** (the
NPC used to like you, now doesn't), and reconciles them — the memory curates and
*changes its mind* over time.

### The "dumb fine-tune" (the key idea)

**You never touch model weights.** Every time an NPC acts, wrap the base model's
context in that NPC's **identity core** (static: name, disposition, faction,
voice) + the **ensemble-retrieved slice** of their memory relevant to *this*
moment. The base model, so wrapped, *behaves as if fine-tuned on that character* —
but the "fine-tune" is just context assembly ("their entry into the context").
Strictly better than real fine-tuning here:

- **Zero training cost, any base model** — embedded llama.cpp or a cloud endpoint,
  identical. Swap models → every NPC gets smarter but keeps their exact identity.
- **Per-NPC identity is DATA, not weights** — no 300 model copies; each NPC's
  "fine-tune" is their memory rows retrieved + injected. The *a-game-is-data*
  doctrine applied to personality.
- **It evolves** — the Shadow Curator updates the fine-tune as the NPC lives
  (including changing its mind), with no retraining.
- **Small but characterful context** — the ensemble retrieves the *relevant* slice,
  not the whole history: L4 guarantees the pinned trauma always surfaces (they
  never forget the murder), L2 sets tone, L5 supplies who-they-know, L3 the facts.
  Context stays cheap; character stays deep.

### Boundaries & scale (keep it honest)

- **Replay-safe:** the memory (what was witnessed) is deterministic *record*; the
  generated dialogue is ephemeral *presentation* — same membrane as the media
  engine. AI reads the record and voices the NPC; it never writes the record.
- **Scales via promotion (V21):** only **promoted/individual** NPCs carry a full
  M3A store; ambient trash NPCs are distributions with no memory. Only NPCs
  actually speaking/acting generate — so 300+ NPCs is fine, because the rich path
  is the few who matter this moment.
- **Budget-aware:** retrieval + injection is cheap; generation is the cost, and it
  rides the same IDLE-priority queue + dial as all dynamic content. Baked floor:
  an unpromoted or budget-starved NPC falls back to templated lines.

**Dependency it shares:** the same appearance-fingerprint + witness-event record
the stealth/justice/media systems need is what *populates* L1→L4 here. One
witness event feeds four systems — design it first (said a fourth time, on
purpose).

---

## Blueprints, 3D Printing & Crafting (Studio as the crafting system)

> **This is a flagship system — execute flawlessly.** It is the deepest reuse of
> the "we ship the editor" thesis: crafting is not a separate minigame, it is
> **the Studio mesh editor with a rubric**. The player fabricates real geometry;
> the game grades the geometry. Nothing here is a stat roll behind a progress
> bar — the item's quality *is* the fidelity of the thing you actually built.

### The fiction: fabrication, not "crafting"

The player is a **3D printer / machinist**. You don't "unlock" a gun — you
**fabricate** it from a blueprint, and how well you fabricate it is how good it
is. This makes the crime economy's supply chain diegetic: contraband is printed,
not bought from a menu. (Ties to the world: SilkRoad/ShopLifter sell base stock;
the printer turns stock into stat-bearing objects.)

### A blueprint is a TARGET + a DIAGRAM (deliberately under-specified)

1. Take a base asset (found, bought, or achievement-granted — e.g. a gun),
   **decompose it into parts** (barrel, receiver, stock, …). Each part becomes a
   blueprint entry: a **target mesh** (ground truth, never shown directly) + a
   **diagram** the player reads to reconstruct it.
2. The diagram is **intentionally under-specified** — e.g. a 3-view orthographic
   set (front/side/top) or 3 reference photos, NOT a step-by-step. The player
   models what they *think* they see in the Studio. Ambiguity is the difficulty
   knob: a cheap blueprint gives clean orthographic views; a rare one gives three
   bad polaroids. (Difficulty = information withheld, authored per-blueprint.)

### The grade IS the geometry (SDF fidelity scoring)

3. **Score = shape fidelity of the submitted mesh vs. the hidden target.** Use
   the SDF path (`sdf_roundtrip_lab`): voxel-sample both meshes to signed-distance
   fields on a shared grid, score a **symmetric (chamfer-style) distance**.
   Properties that make this the RIGHT metric (and why it must be SDF, not
   vertex/triangle compare):
   - **Topology-agnostic:** the player's mesh can have any vertex count / edge
     flow and still score well if the *shape* matches — rewards the silhouette
     and volume, not modeling technique.
   - **Pose-normalized before scoring:** align by centroid + principal axes (or a
     small ICP pass) so the player isn't punished for orientation/position — only
     shape counts. (DECIDE: also normalize scale, or is matching real-world size
     part of the grade? Recommend: normalize scale for the fabrication grade,
     keep dimensional accuracy as a *separate* optional bonus.)
   - **Continuous, not pass/fail:** the raw distance is a smooth 0..1 fidelity,
     which is what makes step 5 (replay-to-improve) meaningful.
4. **Grade thresholds → quality tiers** on the resulting stat item (e.g.
   ≥0.95 = Pristine, ≥0.85 = Fine, … → maps to the item's stat block). Tuning
   table owns the thresholds (P2 — never hardcode the cutoffs).

### Replayable forever + the customization layer

5. **The fabrication is never "done."** The item stores its best fidelity score;
   the player can re-open the blueprint anytime, refine the mesh, and *raise the
   grade* — an evergreen skill-expression loop, not a one-shot craft.
6. **Customization is the same Studio, layered on top** of the graded base:
   fabricate the stock, then **paint it** (face paint), **add charms / stickers /
   attachments** — all existing Studio operations. Cosmetics ride on top of the
   stat-bearing base without touching its grade.

### One pipeline, two reward classes

7. Achievement/loot rewards resolve into *either*:
   - a **blueprint** (target mesh + diagram) → the **stat** path (fabricate to
     grade), or
   - a finished **cosmetic attachment** (a ready mesh asset) → the **paint** path
     (pure looks, no fabrication).

   Same content store, **one flag** decides stats-vs-paint. This means every gun
   part, attachment, charm, and skin flows through one authoring + storage path —
   and all of it is just Studio output, so it also rides the V29 baked-asset
   pipeline like every other mesh in the game.

### Build status (do not start from scratch)

| Piece | Exists | New work |
|---|---|---|
| Studio mesh editor (model, parts, paint, stickers) | ✅ editor | — |
| SDF sampling / roundtrip | ✅ `sdf_roundtrip_lab` | chamfer grade + pose-normalize |
| Asset store + baked-asset pipeline | ✅ (V29) | blueprint = target-mesh + diagram record |
| Blueprint authoring (decompose asset → parts → diagram) | 🟡 | tooling: pick views, set ambiguity |
| Grade→tier tuning table | 🟡 | P2 table |
| Reward pipeline (blueprint vs cosmetic flag) | 🟡 | one enum on the reward record |

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
