# engAIge → Shitty Games: Port Context

Status: **project context** (consolidated 2026-07-16). This is the durable home
for knowledge that previously lived only in the engAIge project's session memory
(`~/.claude/projects/-home-siah-creative-engaige/memory/`) — which does NOT load
in reactjit sessions. Copied here so any session in this repo has it.

Companion docs: [CRIMINAL_CAREERS.md](CRIMINAL_CAREERS.md) (the game's systems
built on top of this port), [mission_ideas.md](mission_ideas.md).

---

## The relationship

**engAIge** (`~/creative/engaige/`) is a finished React+Bun relationship/social
sim with autonomous NPCs, a fake internet (~60 sites), and a phone UI. It is now
the **content quarry** — not a build site. Its fake internet + phone are being
carried into the reactjit game (**"Shitty Games"**, a GTA×Hitman crime sim;
active surface `~/creative/reactjit/cart/editor/`) as that game's **UI layer**:
phone overlay + in-world computers rendered over the native compiled world.

Lore reskins from engAIge's `.corn` universe to the **crime registry** (Swimming
with the Fishes, WHY-C, FlockBook, Warrant Buffet, Prophet Margin, …). The full
carry-forward — every portable site, character, and the crime registry — is in
engAIge at `docs/export/LORE_CARRYFORWARD.md` (note: that dir is **gitignored**
in the engaige repo, so it lives on disk only, not in git).

---

## Why this works (architecture proven empirically, not assumed)

Validated in the reactjit editor via the GC STRESS rig
(`cart/editor/inspector/GcStressSection.tsx`, in the playtest tab under the
physics globals):

- **GC never stutters the game.** V8's concurrent collector absorbed ~300 MB/s
  allocation churn + repeated 120 MB mark-sweep cycles with zero felt hitch in
  the playable world. GC was never the enemy.
- **The market sim runs over the live world.** 25,000 trades through
  `framework/sim` while driving — no lag.
- **The one real cost is per-frame node churn** (rebuilding swarms of text nodes
  every frame). Solved two ways: **latches** for frame-cadence readouts (health,
  detection meter, price ticker — host-owned f64s, zero JS/GC per frame), and
  **compiled layout + texturized text** (the `~/layout/approaches/compiled-layout`
  tape + `~/creative/tailwhip` doctrine: *compile, don't interpret*). Known text
  (>99% of a game's UI) bakes to glyph runs/textures → back to 240fps.
- **Memory is not a bound.** One resident market sim = **1.77 MB** (measured);
  seed-derived, so nesting cost ≈ one live sim + a stack of seeds. See
  CRIMINAL_CAREERS.md § recursive-game for the full number.

Net: React mounts fine over the world at **event cadence**; the world (native,
JS-free per frame) never knows the UI exists. The two-thread isolation idea is
shelved as insurance, not needed.

---

## How to apply (for whoever mines engAIge for content)

- **Content is portable data; components and the server are NOT.** Carry the
  `SiteContentItem` schema, site formats/taglines/themes, phone-app UX, and lore.
  Do **not** port the DOM site components (per-frame tailwind parsing + WS
  content fetch is the exact churn pattern to avoid) or the Bun server (reactjit
  has no Bun/Node).
- **Sims live in Zig** (`framework/sim`), cold systems in TS. engAIge's Bun
  server NPC/AI/event-bus concepts port as **design**, not code.
- **Mount points:** phone = corner overlay (glance) or engaged (cursor); computers
  = full browser surface via the screen-material path (see CRIMINAL_CAREERS.md
  § Screens). Time never stops — opening any UI never pauses the world.

---

## Appendix: engAIge codebase reference (only relevant when working IN engAIge)

Kept for completeness — these are engAIge-internal notes, not reactjit guidance.

**Service naming (keep the distinction as it grows):**
- `services/relationships.ts` — data-access layer: CRUD, stat calc, stage
  determination.
- `services/npc-relationships.ts` — event-driven/reactive layer: listens to
  events, triggers relationship changes, milestones.

**Network decoupling:** agents must NOT import `ws-server` directly — use
`services/broadcast.ts`, which emits `SYSTEM_BROADCAST_REQUESTED`; `ws-server`
listens on the event bus and does the actual broadcast.

**Known tech debt (not urgent, watch for compounding):** `server/src/index.ts`
has 20+ direct imports (implicit init order); `drama-engine` has 4 distinct
paths to the database (could use a facade).

**Tools:** dependency analysis via `./tools/deps.sh` (wraps
`dep-analyzer-fullstack.ts`).

**Image pipeline:** `image-compression.ts` → `image-generation-proxy.ts`;
reference images auto-compressed to base64 before API calls; provider-specific
size limits (DALL-E 4MB, SDXL 10MB, etc.).
