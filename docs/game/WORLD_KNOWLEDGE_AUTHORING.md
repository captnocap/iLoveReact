# World Knowledge Authoring

Status: **architecture plus implemented first authoring slice** through USER ASK
`req_3288`, not a game-design ruling.
Going-forward implementation belongs in `cart/editor/` and its `/play` route.
`cart/hmsc-int/` is referenced only where it already proves a useful contract.

This plan connects five things that should be authored together but should not
become one giant runtime object:

- the world bible used by the developer;
- people, businesses, positions, places, and schedules;
- the fake internet and social identities;
- gig and mission affordances;
- the event-derived media that remembers what the player did.

The recommendation in one sentence:

> Keep project-owned Markdown files containing declarative `<block>` records as
> the source of truth; make the wiki-shaped **World Bible** an explicitly
> divergent draft/editor over those files; compile the confirmed on-disk form
> into compact entity, schedule, route, text, and mission indexes.

The distinction matters. A wiki is the right way for a human to browse and edit
lore. A pile of wiki pages is the wrong source of truth for a game that must
answer questions such as "who works here Tuesday night?", "which account is
secretly controlled by this person?", "can this position be targeted by a gig?",
and "what evidence caused this headline?" quickly and deterministically. The
typed graph is a derived view of block identities and `@[ref]` links, not a
separate authoring database.

The first in-app GUI should nevertheless feel like an ordinary wiki, not like a
graph database, fake-internet CMS, or collection of bespoke entity editors. The
typed machinery belongs beneath familiar pages, links, search, and editing.

---

## 0. Source ownership: disk wins

Clarified by USER ASK `req_3264` and `req_3265`: the canonical authoring form is
the human-readable Markdown-with-block file described in `req_2742` and
`project_mission_block_authoring.md`.

The editor is **not** an automatic writer. It loads the last confirmed on-disk
file into a draft, lets that draft diverge, and makes the divergence visible.
Changing a field, binding a logo, selecting a world space, or accepting generated
content changes only the editor draft. Updating the canonical file requires a
formal, explicit **Write to Disk** confirmation after reviewing the proposed
patch.

```text
on-disk Markdown + <blocks>  ──parse──>  editor base
          │                                │
          │                         draft-only edits
          │                                │
          │                         review exact diff
          │                                │
          └──── explicit confirmation <────┘
                         │
                  atomic disk write
                         │
            re-parse + validate canonical form
```

The visible ownership states are:

| State | Meaning | Permitted next actions |
|---|---|---|
| `DISK` | Draft, loaded base, and current disk file agree | Edit draft |
| `DRAFT CHANGED` | Editor draft differs; disk still equals the loaded base | Review, Write to Disk, or Revert Draft |
| `DISK CHANGED` | An external text editor changed disk; local draft is clean | Review and Reload from Disk |
| `CONFLICT` | Both editor draft and disk changed from the loaded base | Three-way review; never overwrite automatically |

The editor may autosave its **draft recovery history** so a crash does not erase
work. Recovery data is not canonical content and must remain labeled as a draft.
Compile, ship, other tools, and a fresh editor open read the confirmed on-disk
files. An optional preview may run a draft only if it is unmistakably labeled
`DRAFT PREVIEW`; it can never masquerade as a normal compile.

The write door re-reads the file and checks the expected content hash immediately
before replacement. If the file changed after the diff was prepared, the write
stops in `CONFLICT`. The writer preserves all untouched prose, comments,
formatting, block ordering, and incomplete ideas byte-for-byte; it patches only
the spans the user confirmed.

The native write door serializes every expected-existing and expected-absent
writer through one stable per-target advisory-lock inode, claims an existing
pathname with no-overwrite renames, keeps the displaced inode as a versioned
`.previous` file, and synchronizes each directory transition. This prevents two
writers from winning the same reviewed snapshot, prevents the claim interval
from masquerading as genuine file absence, and preserves writes made through a
pre-open external file descriptor.
Before an existing pathname is vacated, the writer also fsyncs a fixed-name
`.write-pending` marker whose payload identifies that transaction's exact
versioned prepared path. The OS lock disappears if its owner crashes; the
marker does not. A waiting writer that reviewed absence must therefore stop
until the validated startup recovery path proves that same owner, reinstalls
durable bytes, and retires the marker.
If the process dies during the brief claim/install interval, startup restores a
missing canonical pathname only when the matching prepared-temp and prior-version
pair both exist. The restored prior bytes are made durable before the prepared
temp is durably retired, so the claim cannot replay after a later intentional
deletion. Replay-temp cleanup, optional predecessor cleanup, and pending-marker
retirement happen through one native finalizer: it holds the target advisory
lock, rechecks exact target bytes and prepared-path ownership, then removes the
pending marker last. A lone or differently-owned history backup never
resurrects a page; the World Bible instead surfaces its path as excluded
prior-version history so writes made through a pre-open external descriptor
remain discoverable.

Draft recovery uses the same expected-content claim but a different retention
policy because it is app-owned and written frequently. A normal recovery write
durably retires its displaced envelope instead of accumulating an unbounded full
copy every edit burst. After an interrupted write, startup validates both sides,
prefers the newer fsynced temp envelope, falls back to the prior valid envelope,
and durably retires the replay pair. Malformed or conflicting artifacts are
preserved byte-for-byte and block automatic recovery rewrites. Creating the
first recovery directory also synchronizes every newly created ancestor.

---

## 1. Sources and constraints

This proposal was made after surveying the following rather than inventing a
parallel system:

- `docs/game/DECISIONS.md`: V8, V12, V16, V20, V21, V22, V24, V28, V30, V32,
  P1, P2, and R6;
- `docs/game/CRIMINAL_CAREERS.md`: missions operate real systems, the internet
  is the world's memory, static floor/dynamic ceiling, and dirty screen channels;
- the previous-era mission and story contracts under
  `cart/hmsc-int/game/missions/` and `cart/hmsc-int/game/story/`;
- the previous-era append-only store at `cart/hmsc-int/data/index.ts`;
- the recovered `<block>` design in
  `/home/siah/.claude/projects/-home-siah-creative-reactjit/memory/project_mission_block_authoring.md`
  and its original USER ASK `req_2742`;
- the active editor's document, command, world-marker, and game-file surfaces;
- `/home/siah/creative/engaige`, including its live databases, lore corpus,
  site registry, NPC context builder, social autopilot, news recursion, event
  bus, schedules, and content services;
- `/home/siah/layout/approaches/compiled-layout/REROLL.md` and the Tailwhip
  text experiments under `/home/siah/creative/tailwhip/`.

The binding constraints are:

1. A shipped game is data consumed by the stateless Zig engine. Lore cannot
   become a per-game JavaScript runtime.
2. Runtime state has two clocks: frames and the V8 state tick. Opening the
   World Bible, phone, or an in-world website must not pause either clock.
3. Project-owned Markdown-with-block files are the canonical authoring source.
   Editor changes remain a visibly divergent draft until a reviewed, explicitly
   confirmed disk write. V20 history may preserve/recover drafts, but compile
   consumes only the confirmed disk-derived snapshot.
4. Ambient population is distributional. A named persistent person exists only
   when authored or promoted; a business roster must not accidentally tenure
   every cashier in the city.
5. Missions bind to a PERSON or a POSITION and are generated over a closed,
   validated schema. Generated prose cannot write tuning numbers or world truth.
6. Runtime internet content may present, distort, deny, or speculate about
   reality, but it may not create authoritative reality.
7. Meaningful constants live in tuning data. Neither a site component nor a
   mission generator gets to hide balance or cadence numbers in code.

---

## 2. What Engaige actually proved

Engaige is a very good content quarry. Its best contribution is not any one
React component; it is the way the same small set of people, corporations,
rumors, sites, and recurring jokes appears through many different lenses.

At the time of this audit its data included roughly:

- 300 site-content records across dozens of site identities;
- 180 social posts and real comment/reaction trees;
- 156 news articles;
- 18 deeply authored NPCs;
- 1,441 buildings across 9 districts;
- 5,519 recorded NPC activities.

The same database had zero materialized `npc_locations` and zero
`npc_schedules`: its large activity count came from runtime scheduling machinery,
not an authored business/position roster. That gap is exactly where the proposed
Position, Occupancy, Place, and Shift records belong.

That density produces the feeling we want. A WikiKnow article, anonymous blog,
local-news item, forum thread, odds market, and social post can all touch the
same incident without reading like copies of one another.

### Carry forward

| Engaige strength | ReactJIT form |
|---|---|
| "If we reference it, build it" and no dead clickable surfaces | Every typed link and route resolves at compile time; unresolved links are errors |
| A new item touches at least two existing lore elements | Backlink/crosslink coverage warning in the authoring diagnostics |
| One story appears through many site voices | Site templates render documents and claims through different editorial lenses |
| Unified authored/news/social content retrieval | One document/query contract with explicit source and provenance |
| NPC context combines time, location, memory, relationship, and headlines | A compact context capsule assembled from authoritative indexes and promoted-NPC memory |
| Exposure causes reactions, which may become news, which causes more reactions | Deterministic event projectors with a bounded optional prose layer |
| Corporate umbrellas, countervoices, secret blogs, recurring motifs | First-class organizations, accounts, controller relationships, claims, and tags |
| Claimed quantities should have underlying content | Count/metric tokens derive from real query results rather than hardcoded display numbers |

### Adapt, do not port literally

| Engaige implementation | Why it cannot be the new authority | Replacement |
|---|---|---|
| Entity references stored as free-text names | Produced aliases such as multiple spellings of the same person or corporation | Stable typed IDs with display names as presentation only |
| NPC `job`, `location`, and schedule as strings/JSON | Cannot prove who occupies which role or where a mission can reach them | Position, occupancy, place, and shift records |
| Generic schedule templates choosing a random building by type | Looks alive but breaks authored causality and queryable futures | Authored position schedule plus deterministic occupant policy |
| Giant NPC system prompts containing repeated lore | Duplicates facts, drifts, and is expensive to rebuild | Structured context capsule compiled from canonical relations and selected prose |
| A single generic site-content table plus a separate site registry | Site manifests and actual pages could disagree | One site/route/document snapshot compiled into every consumer index |
| A global event firehose | Scheduler and AI plumbing overwhelmed the narrative signal | Separate authoring events, story events, and telemetry |
| Optional `parent_event_id` | The database had 21,179 events and no populated parent links | Dynamic media requires explicit non-empty cause IDs at its boundary |
| LLM news treated as factual by NPCs | Fun recursion, but it can invent new facts and feed them back as authority | LLM may phrase a validated claim set; it cannot add facts, IDs, numbers, or deltas |
| Random wall-clock social timers | Not replayable and not tied to the game clock | Seeded schedules evaluated on world time/state ticks |
| RSS/external news in the core feed | Nondeterministic and not shippable as part of the game | Optional dev import only; authored and world-event content are the shipped floor |

The lesson is not "port the Engaige server." It is "preserve its depth rules,
then give those rules stable identities, causality, and a compiler."

---

## 3. Four layers, four kinds of truth

These must remain separate even if the editor makes them feel seamless.

```text
AUTHORING LEDGER                    RUNTIME LEDGER
knowledge events                   story/world events
      |                                  |
      v                                  v
materialized WorldKnowledge         deterministic projectors
      |                                  |
      +-------- compile --------+---------+
                               v
                    queryable runtime records
                               |
                    site / phone / mission views
```

### 3.1 Authored truth

Typed facts and relationships the game is allowed to rely on: this organization
owns that business; this place contains that position; this person controls that
account; this shift recurs on these days; this position can perform these verbs.

### 3.2 Public claims

What an internet document says. A claim may assert, deny, speculate, parody, or
misattribute an authored fact. Claims can influence NPC knowledge and public
sentiment, but mission predicates and world simulation never mistake them for
truth.

### 3.3 Runtime events

What happened in this run: a witness saw a person, a register was robbed, a
payment cleared, a clip was uploaded, a target died. Events are append-only and
totally ordered. They are the only authority for consequences that happen after
the compiled starting state.

### 3.4 Projections

Posts, articles, notifications, search results, dossiers, and mission listings
derived from authored data plus runtime events. A projection can be rebuilt. It
never becomes a second source of world truth.

This split is what lets the fake internet lie convincingly without making the
simulation incoherent.

### 3.5 Authoring text is not public knowledge

Clarified by USER ASK `req_3283`: the player-facing knowledge boundary is an
explicit source-format boundary, not a page-title or heading convention. A
heading named `Designer notes` is useful presentation, but it has no security
meaning and the compiler must never infer visibility from it.

The source grammar is allowlisted:

```text
<business>
  <ref>biz.cropduster_labs</ref>

  <fact key="location" visibility="public">@[place.east_mercer_depot]</fact>
  <fact key="disposal_practice" visibility="secret">storm-drain dumping</fact>

  <public>
  CropDuster Labs provides pest-control services throughout East Mercer.
  </public>
</business>

<notes>
The disposal-practice fact is a reveal. Do not hint at it in public copy.
</notes>
```

- `<public>` prose is eligible for a player-facing wiki/site projection.
- when an entity is deliberately included in a public projection, its `<ref>`,
  entity kind, and `<name>` are explicit public routing identity metadata;
- facts require stable keys and explicit knowledge visibility; only `public`
  facts are eligible for a public projection;
- `secret` facts remain authoritative world/mission truth but are excluded from
  the public projection;
- `<notes>` and ordinary Markdown outside an explicitly public block are
  author-only by default and never enter a shipped player-facing knowledge view.
- block-looking text inside HTML comments or Markdown fenced code is inert;
  these remain byte-preserved author prose and cannot mint public semantics;
- `<fact>` attributes are an allowlist of fully quoted `key`, `label`, and
  `visibility` pairs. Unknown, duplicate, unquoted, or partially parsed syntax
  is a hard error rather than a best-effort interpretation.

This is deliberately fail-closed. The public compiler selects explicit public
blocks and facts; it does not compile the whole page and attempt to subtract
private material afterward. A later runtime revelation creates an appropriate
event-derived Claim/Document projection—it does not silently change the source
fact's visibility.

Parsing alone does not grant publishing authority. The implemented public
projection accepts only immutable pages minted by the canonical
`world/knowledge/*.md` disk loader, and checks that provenance again at runtime.
Serialized proposals, recovery drafts, arbitrary parsed strings, and forced
TypeScript assertions therefore cannot label themselves `CANONICAL DISK`.

---

## 4. Stable identity first

Every durable record gets a namespaced ID. Names are editable labels; IDs are
references.

```text
person:patriot-pat
org:patriot-growth
place:patriot-growth-hq
position:patriot-growth-night-moderator
account:flockbook-patriot-pat
site:flockbook
doc:flockbook-patriot-pat-0042
gig:seed-grievance
shift:night-moderation
```

IDs are never inferred from the current display name after creation. Renaming
"Patriot Pat" must not break a mission, URL, backlink, or save.

Entity `kind` is authoritative. A prefix such as `biz.`, `npc.`, or `place.` is
an author-friendly naming convention and ID allocator hint, never a second type
system. Parsers, page indexes, colors, validators, and compilers read the `kind`
field. A prefix/kind mismatch may produce an editorial warning, but it cannot
change the record's type or override `kind`; typed references validate against
the target record's field.

In the text syntax, an entity block tag is the serialization of that same field,
not another copy: `<business>` parses to `kind: 'business'`, and changing the GUI
kind makes the writer propose changing that tag. The source must not also contain
`<kind>business</kind>` inside the specialized block. There is one discriminator
represented once per layer.

Facts and editable fields are also keyed, never positional:

```ts
type AuthoredFactField = {
  key: FactKey       // stable identity within the owning entity
  label: string      // editable presentation
  value: FactValue
  visibilityKey: KnowledgeScopeKey
}
```

`key`, not array index or display order, owns diff/merge identity and the source
span patched by the writer. Inserting or moving `location` before `manager`
therefore does not report every following field as changed. Display labels may
change without changing the key. Duplicate or missing keys are invalid.

References are typed at the boundary. A field expecting a `PlaceId` cannot
silently accept a `PersonId`, even though both serialize as compact integer IDs
in the compiled pack.

---

## 5. The core authored records

The following is a shape, not final TypeScript syntax. The important part is
ownership and normalization.

### 5.1 Person

```ts
type Person = {
  id: PersonId
  legalName: string
  displayName: string
  dateOfBirth: GameDate
  identity: { genderKey?: string; pronounKey?: string }
  homePlaceId?: PlaceId
  accountIds: AccountId[]
  authoredTier: 'tenured'
  profile: {
    summary: RichText
    traits: TraitKey[]
    interests: TopicId[]
    communicationStyle?: StyleKey
  }
  tags: TagId[]
}
```

There is deliberately no stored `age`. The editor displays age by deriving it
from `dateOfBirth` and the selected world date. Storing both creates an
eventually-wrong contradiction.

`job` is also not an editable string on Person. The person's current jobs are a
projection of Occupancy records. `home` points to a Place, not prose.

### 5.2 Organization and business

```ts
type Organization = {
  id: OrganizationId
  name: string
  kind: OrganizationKindKey
  parentOrganizationId?: OrganizationId
  locationIds: PlaceId[]
  websiteSiteId?: SiteId
  accountIds: AccountId[]
  logoAssetId?: AssetId
  offeredGigTemplateIds: GigTemplateId[]
  profile: { summary: RichText; publicDescription?: RichText }
  tags: TagId[]
}
```

"Business" is an organization kind, not a special disconnected database.
Umbrella corporations, departments, gangs, agencies, nonprofits, and shell
companies can use the same relation vocabulary.

The `workers` list is not stored here. It is queried as:

```text
organization -> positions -> current occupancies -> people
```

This is essential for V22. A grievance can bind to the person; a protection
racket can bind to the position and re-arm when its occupant changes.

### 5.3 Position and occupancy

```ts
type Position = {
  id: PositionId
  organizationId: OrganizationId
  title: string
  roleKey: RoleKey
  workplacePlaceId: PlaceId
  stationMarkerId?: WorldMarkerId
  shiftPatternId: ShiftPatternId
  capabilities: CapabilityKey[]
  factionId?: FactionId
  occupantPolicy: {
    kind: 'authored-person' | 'seeded-occupant' | 'vacant'
    personId?: PersonId
    populationRecipeId?: PopulationRecipeId
    refillPolicyKey?: TuningKey
  }
  tags: TagId[]
}

type Occupancy = {
  id: OccupancyId
  positionId: PositionId
  personId: RuntimeOrAuthoredPersonId
  validFrom: WorldInstant
  validUntil?: WorldInstant
  causeEventId?: StoryEventId
}
```

Position is authored and stable. Occupancy is time-varying. A named lore NPC can
fill a position, but a common job can request a deterministic seeded occupant.
Vacancy is explicit and queryable.

### 5.4 Place

```ts
type Place = {
  id: PlaceId
  name: string
  kind: PlaceKindKey
  parentPlaceId?: PlaceId
  mapId: MapId
  markerIds: WorldMarkerId[]
  address?: AddressRecord
  owningOrganizationId?: OrganizationId
  publicHoursId?: ShiftPatternId
  serviceKeys: ServiceKey[]
  tags: TagId[]
}
```

A Place relates lore to V24's semantic world. Its marker IDs point to rooms,
portals, work stations, entrances, beds, counters, smoking spots, or other
authored semantic points. The Place does not duplicate geometry or coordinates.

A business with multiple locations has multiple Place relations. A home is a
residential Place. A website is not a Place.

### 5.5 Account and site

```ts
type Account = {
  id: AccountId
  siteId: SiteId
  handle: string
  displayName: string
  publicOwnerId?: PersonId | OrganizationId
  controllerId: PersonId | OrganizationId | PositionId | SystemPersonaId
  personaKey?: PersonaKey
  createdAt: WorldInstant
  tags: TagId[]
}

type InternetSite = {
  id: SiteId
  name: string
  domain: string
  templateKey: SiteTemplateKey
  owningOrganizationId?: OrganizationId
  homeRoute: RouteKey
  capabilities: SiteCapabilityKey[]
  searchPolicyKey: SearchPolicyKey
  tags: TagId[]
}
```

Social handles are first-class accounts, not `{ platform: handle }` strings.
That allows an organization account, bot, position persona, secret blog, burner,
impersonator, or anonymous controller without lying to the simulation.

`controllerId` is authored truth. `publicOwnerId` is what the site presents.
Only appropriate knowledge scopes can reveal the controller.

### 5.6 Facts and claims

```ts
type Fact = {
  id: FactId
  key: FactKey
  label: string
  subjectId: EntityId
  predicateKey: PredicateKey
  value: EntityId | ScalarKey | string | boolean
  visibilityKey: KnowledgeScopeKey
  validFrom?: WorldInstant
  validUntil?: WorldInstant
}

type Claim = {
  id: ClaimId
  subjectId: EntityId
  predicateKey: PredicateKey
  value: EntityId | ScalarKey | string | boolean
  stance: 'asserts' | 'denies' | 'speculates' | 'satirizes'
  sourceDocumentId: DocumentId
  sourceEventIds: StoryEventId[]
}
```

Not every sentence needs a triple. Only gameplay-bearing statements, searchable
allegations, relationships, quantities, and facts which other systems consume
need structure. Prose remains prose with typed inline entity references.

### 5.7 Internet document

```ts
type InternetDocument = {
  id: DocumentId
  siteId: SiteId
  route: RouteKey
  kind: DocumentKindKey
  authorAccountId?: AccountId
  publishedAt: WorldInstant
  title: RichText
  blocks: DocumentBlock[]
  claimIds: ClaimId[]
  referencedEntityIds: EntityId[]
  sourceDocumentIds: DocumentId[]
  sourceEventIds: StoryEventId[]
  visibilityKey: VisibilityKey
  lifecycleKey: DocumentLifecycleKey
}
```

Document blocks are a closed vocabulary: paragraph, heading, entity card,
image/asset, quote, list, metric, link, poll, product, comment thread, media
record, and site-defined slot. They are content data, not arbitrary component
code.

Typed inline references can use an author-friendly `[[entity-id|label]]` syntax,
but the snapshot stores parsed reference tokens. Every link must resolve to a
route or an explicit non-navigation command.

Metrics use a query key:

```text
{{count:account.unread-notifications account:flockbook-player}}
```

The UI never says "37 notifications" unless the query produces 37 records.

### 5.8 Gig template

```ts
type GigTemplate = {
  id: GigTemplateId
  providerOrganizationId: OrganizationId
  listingSiteId: SiteId
  activityVerb: ActivityVerb
  clientSlot: EntitySelector
  binding: { kind: 'person' | 'position'; selector: EntitySelector }
  objectiveSlots: ObjectiveSlot[]
  methodKeys: MethodKey[]
  scheduleWindowKey?: ScheduleWindowKey
  tuningProfileKey: TuningKey
  narrativeHooks: Array<{ textTemplateId: TextTemplateId; worldDeltaKey: WorldDeltaKey }>
  eligibilityPredicateKeys: PredicateKey[]
  tags: TagId[]
}
```

Businesses own or advertise gig templates; they do not store live mission
instances in an embedded array. The compiler turns these templates and the
world graph into the closed row/affordance catalog V22 already requires.

No reward, expiry duration, rating penalty, refill duration, or spawn rate is
written by an LLM or hidden in this record. `tuningProfileKey` selects authored
numbers.

---

## 6. Time, weeks, days, hours, and shifts

Store one absolute world instant. Derive calendar views.

```ts
type GameCalendar = {
  epoch: GameDateTime
  dayNames: string[]
  hoursPerDay: number
  daysPerWeek: number
  displayFormatKey: TimeFormatKey
}

type ShiftPattern = {
  id: ShiftPatternId
  slots: Array<{
    dayMask: DayMask
    startMinuteOfDay: number
    endMinuteOfDay: number
  }>
  exceptionCalendarId?: ExceptionCalendarId
}
```

The defaults can be a seven-day, twenty-four-hour calendar, but they still live
in a named calendar/tuning record. Overnight shifts are represented by an end
before the start and normalized by the compiler. Holidays, closures, one-off
appointments, and story changes are exceptions, not rewritten weekly templates.

Runtime should retain one integer `worldMinute` (or an equivalent fixed integer
instant chosen by the clock implementation). Week, day, hour, age, "open now",
and "currently on shift" are pure projections. The V8 state tick observes and
advances world time according to named tuning; the render frame never owns it.

This gives frozen NPC rows a cheap closed-form answer:

```text
schedule(position, worldInstant) -> current activity/location token
```

No per-frame pathfinding and no timer per employee are required. A state change
invalidates the relevant deterministic plan, matching V5, V21, V30, and R6.

The query layer must be able to answer an **At Time** request such as Tuesday
22:30:

- which businesses are open;
- which positions are on duty;
- which authored people or seeded occupants fill them;
- which sites/services are usable;
- which gigs are eligible;
- which map markers those answers bind to.

That answer is also the mission validator's queryable future. A weekly grid or
interactive At Time preview can be added later as a normal wiki page tool; it is
not a prerequisite for the first World Bible GUI.

---

## 7. Named NPCs versus the ambient city

The World Bible is allowed to create named, authored people. It must not turn
the ambient city into a million biography objects.

There are three identity paths:

1. **Authored tenured person** — a deliberate lore character with stable ID,
   relationships, accounts, and optional position occupancy.
2. **Seeded occupant** — a deterministic generation handle filling a Position;
   it has enough body/behavior/schedule data to work but no permanent biography.
3. **Promoted person** — a seeded ambient identity becomes tenured because a
   witness, mission, story, or cascade requires memory. Promotion records the
   generation handle and preserves continuity.

The business page can still display a useful roster. It is a projection with a
visible distinction between authored person, seeded occupant, and vacancy.

This avoids the Engaige mistake of giving every simulated worker a giant prompt,
and it preserves V21's fixed-pool/distributional performance model.

---

## 8. From lore to missions

The mission pipeline should not ask an LLM to read prose and guess what exists.
The World Knowledge compiler emits the exact affordances a mission may use.

### 8.1 Compiler products for mission authoring

- people that can be person-bound clients or targets;
- stable positions that can be position-bound clients or targets;
- organization memberships and rivalries;
- places, zones, rooms, entrances, stations, and service markers;
- business hours and position duty windows;
- usable sites and site capabilities;
- items, services, methods, and activity verbs guaranteed by the engine;
- authoritative predicates visible to the mission;
- hook templates paired with validated world deltas;
- tuning profiles supplying every number.

### 8.2 Authoring flow

From a business or position page, **Create Gig Template** opens a constrained
editor:

1. choose a closed activity verb;
2. choose person or position binding;
3. select entity-query slots from compiler-provided options;
4. select only guaranteed methods;
5. select a tuning profile;
6. pair each narrative hook with a real world-delta key;
7. preview candidate rows at selected future times;
8. run validation and the V19 headless player before publish.

The result is a data row, not a bespoke script.

### 8.3 Runtime flow

```text
WorldKnowledgePack + current world facts + world time
                         |
                  mission affordances
                         |
             seeded row selection / optional LLM labels
                         |
            structural validator + headless verifier
                         |
                   published listing
```

The optional prose layer receives selected IDs and permitted claim/fact text. It
may write a title or briefing in a site voice. It cannot add an entity, objective,
method, number, predicate, reward, or world delta.

---

## 9. From runtime events to the fake internet

Engaige's recursion is worth keeping, with a stricter door.

### 9.1 Static floor

The compiled game always ships with authored pages, profiles, comments, ads,
business listings, seeded posts, and enough crosslinks to make the internet
useful with AI disabled. This is the deterministic floor.

### 9.2 Dynamic ceiling

Meaningful story events feed pure projectors:

```text
witness/case/payment/market/mission event
                |
      deterministic record templates
                |
 post / article / alert / search-result candidate
                |
 optional bounded prose presentation
```

Every dynamic document must have one or more `sourceEventIds`. A derivative post
may cite a prior document and the event that caused the reaction. Empty causality
is a boundary error, not an optional quality improvement.

AI output is parsed into a presentation-only shape and validated against the
provided claim set. If validation fails or AI is unavailable, the deterministic
template remains. The template and AI versions carry the same claims and deltas.

### 9.3 Knowledge and exposure

NPCs do not automatically know every public document. Exposure is an explicit
event based on their account subscriptions, position, location, interests, and
schedule. A promoted NPC may retain an exposure/memory record; ambient
distributions retain aggregate sentiment/topic counts until promotion requires
identity.

Trending is computed over canonical topic/entity IDs, not keyword substring
counts. A trend can cause a media projection, but it cannot promote a rumor into
Fact.

### 9.4 Separate the logs

- **Authoring events**: edits to entities, relations, documents, templates, and
  tuning; materialize the project snapshot.
- **Story events**: authoritative run events and consequences; materialize game
  state and media projections.
- **Telemetry**: scheduler starts, AI latency, cache misses, frame time, memory,
  and failures; useful diagnostics, never story canon.

Engaige persisted scheduler and AI plumbing beside narrative events. The new
system should not make a task retry part of the protagonist's history.

---

## 10. The World Bible editor surface

Clarified by USER ASK `req_3269`: this begins as a conventional wiki inside the
active editor. It should reuse the existing workspace-document tabs, navigation,
search, and command authority rather than create a second editor shell or a
specialized UI for every entity kind.

The standalone interaction/layout checkpoint is
[WORLD_BIBLE_WIKI_MOCK.html](WORLD_BIBLE_WIKI_MOCK.html). It is a browser mock,
not a second implementation surface.

### Default layout

```text
Wiki index / search          Ordinary entity page
-------------------          ----------------------------------------
All pages                    title · kind · ref · source state
People                       image/logo + small facts table
Businesses                   readable prose with entity links
Places                       related pages
Mechanics                    backlinks
Missions                     Read | Edit | Review Changes | Write to Disk
```

The first surface needs only familiar wiki behavior:

- list, search, create, open, rename, and link pages;
- render prose, images/logos, and a small facts table from the page's blocks;
- switch between a readable page and one straightforward editing view;
- autocomplete `@[ref]` links by entity title while storing the stable ref;
- show related pages and backlinks;
- represent a world/building space as an ordinary linked field that can open the
  existing map surface, rather than embedding a map editor in every page;
- allow partial pages. An entity can begin as only a stable ref, kind, name, and
  a paragraph, then gain facts and relations as the world becomes clearer;
- keep validation local and plain: missing required identity, unresolved link,
  duplicate ref, or invalid field. Advanced simulation diagnostics do not need
  to occupy the first editing surface.

The disk boundary remains visible without turning the page into source-control
software:

- `Characters`, `Locations`, and `Missions` in the existing navigation become
  filtered wiki indexes over parsed on-disk block files, not parallel registries.
- Every open document visibly reports `DISK`, `DRAFT CHANGED`, `DISK CHANGED`,
  or `CONFLICT`; a dirty dot alone is too ambiguous for a two-authority surface.
- Editing a field, prose, relation, asset, or world binding changes the draft
  only. It never silently mutates the corresponding source file.
- **Review Changes** shows both a semantic block diff and the exact textual patch.
  **Write to Disk** names every target path and requires formal confirmation.
- **Reload from Disk** is explicit when it would discard draft changes. External
  file changes are detected and surfaced, not automatically merged.

There is no required graph canvas, three-column inspector, schedule dashboard,
site preview, social feed composer, or gig wizard in this first GUI. Those may
become useful later, but the wiki page remains the common floor beneath them.

### 10.1 Establish the entity, then design its platforms

The World Bible authors the world entity before authoring how a fictional
platform presents it. A minimally established entity has:

1. a stable `<ref>`;
2. a kind and display name;
3. a readable page, even if it is only a short paragraph;
4. any already-known asset, place, job, home, or relationship links.

That is enough to establish a business, NPC, place, organization, or mechanic.
It does **not** imply that the entity owns a website, social account, storefront,
market listing, news entry, or mission. The wiki must not manufacture those
presences merely because the corresponding buttons are easy to add.

When play actually needs a platform presence, design that platform according to
its gameplay purpose and create a separate linked entity such as `<site>`,
`<account>`, `<listing>`, or `<document>` whose owner/subject points back to the
established entity. The platform can then have its own later preview or editor.
This keeps the base business/NPC schema small and lets different in-game
platforms consume the same identity without forcing them through one premature
universal CMS.

The World Bible is a non-diegetic authoring tool. A WikiKnow-style site inside
the game is a separate InternetSite projection over selected public data. This
prevents the in-world wiki from becoming a backdoor to secret authored truth.

---

## 11. On-disk source, editor draft, and the deep interface

The content source is a project directory of Markdown files with declarative
blocks such as `<business>`, `<npc>`, `<space>`, `<mechanic>`, `<mission>`, and
`<objective>`. Ordinary Markdown around the blocks and explicit `<notes>` blocks
are retained author-only prose; player-facing prose must opt in through
`<public>`. `<ref>` supplies stable identity; the entity block tag serializes the
single parsed `kind` field; keyed facts supply merge identity/visibility; and
`@[ref]` links files and blocks. JSON, indexes, snapshots, and the gamefile are
derived products.

The active editor still needs V20 history semantics for draft recovery and undo,
but that history is not allowed to replace the files or silently publish into
them. The deep boundary separates draft mutation from disk mutation:

```ts
WORLD_KNOWLEDGE.open(projectRoot) -> WorldKnowledgeSession

WorldKnowledgeSession.diskSnapshot() -> WorldKnowledgeSnapshot
WorldKnowledgeSession.draftSnapshot() -> WorldKnowledgeSnapshot
WorldKnowledgeSession.applyDraft(command) -> KnowledgeEvent[]
WorldKnowledgeSession.stateAt(globalSeq) -> WorldKnowledgeSnapshot
WorldKnowledgeSession.query(query, source: 'disk' | 'draft') -> QueryResult
WorldKnowledgeSession.validate(source: 'disk' | 'draft') -> Diagnostic[]
WorldKnowledgeSession.prepareDiskWrite() -> WriteProposal
WorldKnowledgeSession.confirmDiskWrite(proposalId, expectedDiskHash) -> WriteResult
WorldKnowledgeSession.reloadFromDisk() -> ReloadResult
WorldKnowledgeSession.compileDisk(context) -> { pack, report }
```

There is deliberately no `apply()` method whose meaning might include a disk
write. `applyDraft` can only touch the draft/history store. `confirmDiskWrite` is
the single canonical-write door and requires a proposal created from a reviewed
diff plus the expected disk hash.

The implementation hides:

- concrete-syntax parsing with source spans;
- keyed field/fact identity independent of presentation order;
- kind-field authority independent of optional ref prefixes;
- fail-closed public/secret/author-only block projection;
- stable-ref resolution and backlinks;
- semantic and exact-text diff construction;
- optimistic disk-hash conflict detection;
- atomic file replacement;
- byte-preserving patch application outside confirmed spans;
- append-only draft/history concern streams with one global sequence;
- draft snapshot plus tail boot and crash recovery;
- corruption quarantine and schema-version decoding;
- compiled query indexes and caches.

Suggested draft/history concerns remain broad and stable:

1. `knowledge-draft` — proposed entity, fact, and structural-relation edits;
2. `internet-draft` — proposed site, account, document, claim, and route edits;
3. `missions-draft` — proposed gig, mission, and hook edits;
4. `tuning-draft` — proposed calendar, schedule, cadence, and balance edits.

Every draft concern includes its recovery materializer. Unknown future events
are tolerated by old readers. On open, the editor parses disk first, then offers
to recover a divergent draft explicitly; it never applies recovered work to disk
without confirmation.

Human text editing, the World Bible, and generation are three producers of the
same block format, but only the human text editor writes directly by definition.
The World Bible and generators produce drafts/patch proposals. React components
dispatch draft commands and render queries; they do not write files, allocate
canonical IDs, resolve conflicts, validate refs, or compile mission affordances.

---

## 12. Compile products and shipped representation

The confirmed on-disk block files parse into an authoring snapshot, which
compiles into a `WorldKnowledgePack` inside the game-logic stream. It should not
add one map lump per page, ship a SQLite database, or compile an unconfirmed
editor draft by accident.

The logical sections are:

1. version/header and content hash;
2. interned string and typed-ID tables;
3. entity rows grouped by kind;
4. relationship adjacency arrays and reverse backlinks;
5. place-to-world-marker bindings;
6. shift/calendar runs and exception tables;
7. position/occupancy seed rows;
8. site/domain/route manifest;
9. document block rows, references, and claim rows;
10. search tokens/posting lists;
11. account/feed seed rows;
12. mission-affordance and gig-template rows;
13. deterministic media-template rows;
14. asset references;
15. diagnostics/provenance manifest for the editor build report.

The compiler interns strings and remaps authored IDs to dense typed integers.
Records are sorted deterministically. Relationship lists are flat contiguous
spans. Recurring schedules are runs, not expanded per-hour rows. Site templates
and document blocks are formula/template IDs plus dense instances.

The Zig loader validates version, bounds, section hashes, typed references, and
sorted/index invariants once. Runtime query APIs expose narrow operations such
as:

```text
person(id)
positionsForOrganization(id)
occupantAt(positionId, instant)
placesOpenAt(instant)
resolveRoute(siteId, routeKey)
documentsForEntity(entityId, visibility)
missionAffordances(instant, worldFacts)
projectStoryEvent(event)
```

The dynamic layer can use `StringHashMap(Value)` or tagged unions for runtime
patches and promoted identities. It does not require Lua or per-game scripts.

---

## 13. Why REROLL and Tailwhip fit this unusually well

REROLL's key result was structural: a huge unrolled layout tape reduced to about
18–19 distinct formulas applied to thousands of instances. The safe conclusion
is not "all UI is automatically fast." It is that known repeated interfaces
should compile as:

```text
small template/formula dictionary
          +
flat dense instance tables
          +
small runtime input/dirty set
```

The fake internet is almost a perfect workload for that representation:

- thousands of posts share a few post/card/list/comment formulas;
- sites share shells while changing colors, slots, and editorial voice;
- business/NPC/wiki records share field layouts;
- feed rows differ mainly by text, asset, author, counts, and timestamps;
- only visible channels and changed records need re-evaluation.

The compiler should therefore emit site-template/formula IDs and SoA instance
rows, not a recursively interpreted React tree for every page. React declares
which surface is active and sends changed parameters. The host retains compiled
layout/text buffers.

Tailwhip adds the text half:

- prepare/shape distinct text once;
- cache advances and line-break inputs;
- atlas the frequent vocabulary or prepared glyph/word runs;
- virtualize by paragraph/feed row;
- keep an escape lane for rare or newly generated text;
- rebuild only a dirty document or width guard, never the entire internet.

This is especially valuable because authored lore is known at compile time and
internet vocabulary is Zipf-shaped. The static floor can be heavily prepared;
dynamic posts use the escape lane, then join caches if reused.

Honest limits from the experiments remain binding:

- REROLL's original structural proof omitted text, so text formula variety must
  be measured rather than assumed;
- a layout trace is valid only while its branch/width guards hold;
- CPU batching can become bandwidth-bound if instance data is scattered;
- dense repacking and retained buffers are part of the design, not optional
  cleanup;
- generated text can invalidate line layout locally, so the dirty unit is a
  document/paragraph, not one global tape.

This architecture uses the experiments' strongest result—the representation—
without pretending every benchmark transfers unchanged.

---

## 14. Compiler validation and quality gates

Compilation should collect all diagnostics in one pass and make every one
navigable in the editor.

### Errors

- duplicate or malformed stable ID;
- a specialized entity block that also carries a redundant/contradictory kind
  element;
- duplicate or missing fact/field key within one owning entity;
- typed reference targets the wrong kind;
- missing entity, asset, map marker, route, site, or tuning key;
- duplicate site domain or duplicate route within a site;
- an interactive block without a resolvable action;
- a dynamic document/template with no cause-event contract;
- an account handle collision under one site policy;
- a position without a valid organization, workplace, shift, or occupant policy;
- overlapping occupancy intervals for a single position unless policy allows it;
- invalid or non-normalizable shift interval;
- a gig selector that can never resolve in the queryable future;
- a hinted mission method not guaranteed by the compiled world;
- a narrative hook without a world delta;
- a generated mission row containing a number;
- an authoritative predicate sourced only from a public Claim;
- a secret fact leaked into a public document projection;
- a player-facing projection containing `<notes>`, unwrapped author prose, or a
  non-public fact;
- a public prose block referencing a fact not visible to that projection;
- a page-displayed count without a backing query or explicit flavor-text mark.

### Warnings

- a conventional ref prefix disagrees with the authoritative `kind` field;
- new lore record has fewer than two meaningful existing crosslinks;
- document has no inbound route/backlink;
- organization has locations but no site/account presence, or vice versa;
- authored person has no home, position, relationship, or account;
- business position has no station/entrance marker where its verbs need one;
- site template or document block falls onto an uncompiled slow path;
- alias-like display names suggest two IDs may represent the same entity;
- a recurring motif, faction, or corporation has no countervoice;
- a number appears in prose where a derived metric token may be intended.

Warnings are editorial guidance. Errors protect determinism, causality, route
integrity, and mission solvability.

---

## 15. Tests and performance proof

### Pure authoring/compiler tests

- editor mutations leave canonical files byte-identical until confirmation;
- Write to Disk names its paths and applies only the reviewed proposal;
- untouched prose/comments/formatting remain byte-identical after a block edit;
- an external disk change between proposal and confirmation produces conflict
  and never overwrites either version;
- reload/revert require confirmation before discarding a divergent draft;
- compile reads disk even while a different draft is open;
- recovered V20 draft history remains visibly noncanonical;
- ID/type/reference validation;
- rename stability;
- inserting/reordering keyed facts changes only the inserted/moved key, never
  every following row;
- field-label changes preserve fact identity and source-span ownership;
- kind-field authority with a mismatched conventional ref prefix;
- entity block tag round-trips exactly once as the parsed kind field;
- fact versus claim isolation;
- backlinks and route resolution;
- weekly/overnight/exception schedule resolution;
- DOB-to-age projection at boundary dates;
- position occupancy and vacancy/refill projections;
- public/secret knowledge filtering;
- public projection contains byte-for-byte none of `<notes>`, unwrapped author
  prose, or secret fact values, regardless of Markdown heading names;
- metric-token counts equal underlying rows;
- deterministic snapshot compile produces byte-identical packs;
- Engaige-import fixtures report aliases and unresolved references rather than
  silently minting duplicates;
- mission-affordance output matches the validator's vocabulary;
- no-numbers law and hook/world-delta law;
- static template fallback works with AI absent.

### Zig pack/query tests

Once the pack reaches `framework/`, add same-layer Zig unit coverage for:

- malformed headers, section bounds, hashes, and typed references;
- dense ID lookup and adjacency spans;
- schedule lookup including overnight shifts;
- route lookup and visibility filtering;
- mission-affordance query parity with compiler fixtures;
- deterministic event-to-media template projection.

TS tests prove the editor/compiler contract; Zig tests prove the shipped loader
and runtime internals.

### Performance gate

Measure, do not assign wishful budgets. Establish baselines for:

- compile time and pack size versus entity/document counts;
- cold load and hot query latency;
- route/search/backlink lookup;
- weekly schedule query over the full city;
- static and dynamic feed rendering at realistic counts;
- dirty one-document update versus full rebuild;
- retained layout/text buffer allocations and uploads.

Any phase touching the runtime/HUD path must pass the standing 60-second-plus
representative-play spikewatch gate with no new rhythmic spike class.

---

## 16. First vertical slice: establish entities in the wiki

Do not start by importing all 300 Engaige records, building sixty site skins, or
proving the whole internet. First prove that an ordinary wiki can establish and
relate the few entities from which those later systems will grow.

Recommended fixture:

- one business with a name, short description, and logo;
- one physical location linked to an existing world/building space;
- one authored NPC with a short biography, home, and job relation;
- one position and simple shift linking the NPC to the business;
- one mechanic page written primarily as literal design prose;
- backlinks among those pages, with no website or social platform required.

The slice is complete only when:

1. every fixture entity can be found, opened, read, and edited like a wiki page;
2. changing the business leaves its source file untouched while in draft;
3. Review Changes shows the exact proposed block/text patch;
4. explicit Write to Disk updates the named file and re-parses it cleanly;
5. an external text edit creates `DISK CHANGED` or `CONFLICT`, never data loss;
6. entity links and backlinks survive a display-name change because refs remain
   stable;
7. the logo and world-space relation are visible without bespoke business or map
   editors inside the page;
8. literal mechanic prose round-trips byte-for-byte outside confirmed edits;
9. inserting a fact between existing facts produces one keyed addition rather
   than positional changes to every following fact;
10. page kind, navigation grouping, colors, and validation all derive from the
    `kind` field rather than the ref prefix;
11. a minimal public projection contains the benign CropDuster description but
    contains neither designer notes nor the secret disposal-practice fact;
12. no platform presence is generated simply because the business or NPC exists.

Only after this slice works should one established entity be used to choose and
prove the first in-game platform projection end to end.

---

## 17. Delivery sequence

### Phase 0 — contract and fixture

- finalize the Markdown `<block>` grammar, `<ref>`/`@[ref]` rules, record unions,
  keyed facts, authoritative `kind`, `<public>`/`<notes>` boundaries,
  command/event vocabulary, and diagnostics;
- make the small vertical-slice fixture as real hand-editable source files;
- build parser/writer golden fixtures proving byte preservation outside edited
  spans, before any visual editor work;
- port the existing mission row validator vocabulary into an active-surface
  contract without importing the old route;
- write schedule, fact/claim, link, and affordance tests before UI work.

Exit: disk files parse, validate, round-trip, and answer all first-slice queries
headlessly without a writer touching unconfirmed content.

### Phase 1 — canonical files and durable draft boundary

- implement disk/base/draft snapshots plus explicit state reporting;
- implement active-editor append-only **draft** concerns and one global sequence;
- add snapshot-plus-tail draft recovery, batch, quarantine, time travel, and
  backup without treating recovery as canonical;
- add semantic/raw diff, write proposal, formal confirmation, expected-hash
  conflict detection, atomic patch, re-parse, and revert/reload boundaries;
- typed query/backlink indexes.

Exit: cold reopen and time travel preserve both canonical files and a divergent
draft; only confirmed proposals can change disk.

### Phase 2 — World Bible workspace

- ordinary wiki index/search, readable entity pages, one editing view, simple
  facts/assets/relations, typed reference autocomplete, and backlinks;
- keyed fact editing and explicit public/secret/author-only visibility badges;
- persistent `DISK`/`DRAFT CHANGED`/`DISK CHANGED`/`CONFLICT` indicators,
  Review Changes, Write to Disk confirmation, Reload, and Revert Draft;
- a plain world-space reference that can open the existing map surface;
- navigable basic identity/reference diagnostics.

Exit: the small entity fixture can be authored like a normal wiki, without raw
JSON or platform-specific editors, while the user always knows whether they are
looking at disk or a divergent draft.

### Phase 3 — fake-internet floor

- choose one gameplay-needed platform for an already established entity;
- add only the site/domain/route/document/account model that platform proves it
  needs, keeping each presence linked back to its owner/subject entity;
- compiled site templates, document blocks, route/search indexes;
- shared preview for editor, phone, and in-world screen;
- metric tokens, link completeness, comments, and seeded feeds;
- migrate a hand-selected Engaige content slice through a canonicalization
  report, never a blind database copy.

Exit: AI-off internet is deep, linked, searchable, and deterministic.

### Phase 4 — mission compiler

- position/person selectors, schedule windows, world-marker affordances;
- gig template editor and candidate preview;
- validation against queryable future, tuning-only numbers, hook deltas, dedup,
  and headless verification.

Exit: both fixture gigs publish and complete using real world systems.

### Phase 5 — Zig pack and runtime queries

- encode `WorldKnowledgePack` in the game-logic stream;
- Zig loader/index/query API and same-layer tests;
- frozen-world schedule/occupancy queries;
- runtime phone/screen channel consumption;
- formula/instance layout and prepared-text integration where measurement proves
  it belongs.

Exit: shipped `/play` needs no per-game JS logic for knowledge, schedules,
missions, or static internet retrieval.

### Phase 6 — event-derived media and bounded AI ceiling

- story-event projectors, exposure, trends, claims, promoted-NPC memory;
- deterministic post/news/notification fallbacks;
- optional prose generation constrained to supplied IDs/claims;
- provenance explorer showing each artifact's causal chain.

Exit: one player incident visibly propagates through the internet and can be
replayed/rebuilt without factual drift.

### Phase 7 — quarry migration and scale proof

- canonical alias report over Engaige people, corporations, sites, and entities;
- curate/migrate reusable lore and site voices;
- add countervoices and crosslink coverage reports;
- scale fixtures to expected city/document counts;
- run compile, query, memory, text/layout, and standing frame-time gates.

Exit: content scale grows data and instance rows, not formula/component count or
per-frame work.

---

## 18. Recommended decisions to pin after the slice

The proposal proceeds with these recommendations unless a later ruling changes
them:

1. **On-disk Markdown-with-block files are the source of truth.** Editor and
   generated changes remain drafts until an exact diff receives formal Write to
   Disk confirmation; compile reads disk.
2. **World Bible is a projection and deliberate writer, not an authority.** Its
   parsed model, backlinks, and structured forms come from `<ref>`/`@[ref]`
   blocks, and its writer preserves untouched human prose byte-for-byte.
3. **The first GUI is an ordinary wiki.** Pages, search, links, backlinks, small
   facts/assets, and read/edit/review are the floor; specialized inspectors,
   dashboards, graph canvases, and platform CMS tools must prove a later need.
4. **Facts are keyed, not positional.** Stable semantic keys own diff, merge, and
   writer spans; labels and order are presentation only.
5. **The `kind` field is authoritative.** Ref prefixes are helpful conventions,
   never a parallel type system.
6. **Player-facing knowledge is an explicit allowlist.** An included entity's
   ref, kind, and name are explicitly public routing identity; only `<public>`
   prose and public facts compile as page body. Notes, unwrapped prose, and
   secret facts are excluded by construction.
7. **Entity first, platform later.** Establish a business, NPC, place, or mechanic
   independently; add a website, account, listing, document, or mission only when
   its gameplay purpose is known, as a separate linked entity.
8. **Authored named people are tenured.** Common workers remain seeded occupants
   until promotion.
9. **Job means Position plus Occupancy.** It is not a string on an NPC or an
   embedded worker tuple on a business.
10. **DOB is stored; age is derived.** Week/day/hour are views of one world
   instant.
11. **Accounts are entities.** Handles are not loose strings, and controller
   truth is separate from public ownership.
12. **Facts and Claims never share authority.** The internet is allowed to lie;
   mission/world predicates are not allowed to believe it by accident.
13. **No dead links and no fake counts.** Both become compiler contracts.
14. **Static authored floor first.** Event templates second; bounded AI prose
   last.
15. **Engaige is a quarry, not a dependency.** Import through ID canonicalization
   and validation only.
16. **Compile repeated presentation.** Site/layout/text templates are small
    dictionaries over dense instances; only dirty visible records update.

If these hold, the wiki begins as a good lore notebook and identity registry. It
establishes a business, NPC, place, or mechanic once; later game platforms and
missions can then reference that entity and add only the behavior they actually
need.
