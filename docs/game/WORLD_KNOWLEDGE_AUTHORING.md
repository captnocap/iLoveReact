# World Knowledge Authoring

Status: **architecture proposal** for USER ASK `req_3258`, not a ruling.
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

> Build a wiki-shaped **World Bible** over a typed **World Knowledge graph**;
> compile that graph into compact entity, schedule, route, text, and mission
> indexes; let runtime events project new internet records without ever changing
> authored truth.

The distinction matters. A wiki is the right way for a human to browse and edit
lore. A pile of wiki pages is the wrong source of truth for a game that must
answer questions such as "who works here Tuesday night?", "which account is
secretly controlled by this person?", "can this position be targeted by a gig?",
and "what evidence caused this headline?" quickly and deterministically.

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
3. Authored edits are append-only concern events with one global sequence;
   compile consumes materialized snapshots, not edit history.
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

The editor must include a weekly grid and an **At Time** preview. Selecting
Tuesday 22:30 should answer:

- which businesses are open;
- which positions are on duty;
- which authored people or seeded occupants fill them;
- which sites/services are usable;
- which gigs are eligible;
- which map markers those answers bind to.

That preview is also the mission validator's queryable future.

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

The surface belongs inside the active editor. It should reuse the existing
workspace-document tabs, content tree, command authority, inspector, and world
selection rather than create a second editor shell.

### Default layout

```text
Content tree / queries       Wiki-shaped record             Inspector
----------------------       ------------------             ---------
People                       title + typed fields           validation
Organizations                prose + inline refs            relationships
Positions                    backlinks                      map bindings
Places                       site previews                  at-time state
Sites                        gig templates                  where-used
Documents                                                   compile output
Gigs
```

Recommended behavior:

- `Characters`, `Locations`, and `Missions` in the existing content tree become
  views over World Knowledge rather than parallel registries.
- Opening a person, business, site, document, position, or place creates a normal
  workspace document keyed by its stable source ID.
- `[[` opens typed entity autocomplete. Selecting an entity writes its ID token,
  while the editor displays its current label.
- Backlinks and **Where Used** are first-class. A renamed business shows every
  document, account, position, place, and gig that references it.
- The right inspector exposes strict fields and relation editors. The central
  page carries readable prose; users should not have to edit raw JSON.
- A business page displays workers and shifts as projections and offers
  **New Position**, **Assign Occupant**, **Create Account**, **Create Location**,
  **Create Site**, and **Create Gig Template** commands.
- A Place page can select or create V24 semantic markers on the same world map.
- A Site/Document page has **Preview as Site**, using the exact site template
  and compiled document blocks the `/play` browser will consume.
- An **At Time** control globally previews derived age, shifts, occupancy,
  openings, routes, and mission availability.
- Compile diagnostics are navigable: an unresolved route opens the bad block;
  an impossible shift opens the pattern; a missing station opens the position.

The World Bible is a non-diegetic authoring tool. A WikiKnow-style site inside
the game is a separate InternetSite projection over selected public data. This
prevents the in-world wiki from becoming a backdoor to secret authored truth.

---

## 11. Persistence and the deep interface

The active editor needs the V20 semantics, not a direct import from the retired
surface.

The proposed ground-floor module is deliberately small:

```ts
WORLD_KNOWLEDGE.open(projectRoot) -> WorldKnowledgeStore

WorldKnowledgeStore.apply(command) -> KnowledgeEvent[]
WorldKnowledgeStore.snapshot() -> WorldKnowledgeSnapshot
WorldKnowledgeStore.stateAt(globalSeq) -> WorldKnowledgeSnapshot
WorldKnowledgeStore.query(query) -> QueryResult
WorldKnowledgeStore.validate(context) -> Diagnostic[]
WorldKnowledgeStore.compile(context) -> { pack, report }
```

The implementation hides:

- append-only SQLite concern streams;
- one global sequence across concerns;
- snapshot plus tail boot;
- corruption quarantine;
- batched commits;
- schema-version decoding;
- indexes/backlinks;
- compile caching.

Suggested concerns are broad and stable, not one stream per UI widget:

1. `knowledge` — entities, facts, and structural relations;
2. `internet` — sites, accounts, documents, claims, and routes;
3. `missions` — gig templates and hook bindings;
4. `tuning` — calendar, schedules, cadence, rewards, refill, and media policy.

Every registration includes its snapshot materializer. Unknown future event
kinds are tolerated by old readers. The editor writes events; compile and ship
read snapshots.

React components call commands and render query results. They do not mutate the
graph, allocate IDs, fold history, validate routes, or build mission affordances.

---

## 12. Compile products and shipped representation

The authoring snapshot compiles into a `WorldKnowledgePack` inside the game-logic
stream. It should not add one map lump per page or ship a SQLite database.

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
- a page-displayed count without a backing query or explicit flavor-text mark.

### Warnings

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

- ID/type/reference validation;
- rename stability;
- fact versus claim isolation;
- backlinks and route resolution;
- weekly/overnight/exception schedule resolution;
- DOB-to-age projection at boundary dates;
- position occupancy and vacancy/refill projections;
- public/secret knowledge filtering;
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

## 16. First vertical slice

Do not start by importing all 300 Engaige records or building sixty site skins.
Prove the complete chain with one small but deep neighborhood.

Recommended fixture:

- one organization/business with a parent shell company;
- two physical locations and their world markers;
- four stable positions covering a day and overnight shift;
- one authored manager, one authored target/client, one seeded worker, and one
  vacancy;
- a website plus FlockBook accounts for the business and people;
- one public fact, one secret fact, and three contradictory claims;
- one WikiKnow-style reference page, one FlockBook thread, one local-news story,
  and one anonymous countervoice post;
- real comments/reactions and a metric-derived notification count;
- one person-bound grievance gig and one position-bound recurring racket;
- one runtime incident producing a witness record, post, headline, and mission
  consequence through explicit cause IDs;
- site preview on the phone and an in-world screen using the same compiled rows.

The slice is complete only when:

1. every referenced entity and route opens;
2. Tuesday-at-time preview resolves workers, openings, and markers;
3. both gig bindings validate and the headless verifier can complete them;
4. renaming the business changes labels without changing any IDs or links;
5. the false public claim never becomes mission/world truth;
6. the incident's media chain can be rebuilt from its source events;
7. AI-off still produces a coherent internet;
8. the phone and in-world screen consume the same content channel;
9. the runtime performance gate remains silent.

---

## 17. Delivery sequence

### Phase 0 — contract and fixture

- finalize IDs, record unions, command/event vocabulary, and diagnostics;
- make the small vertical-slice fixture as plain data;
- port the existing mission row validator vocabulary into an active-surface
  contract without importing the old route;
- write schedule, fact/claim, link, and affordance tests before UI work.

Exit: the snapshot/compiler contract answers all first-slice queries headlessly.

### Phase 1 — durable World Knowledge store

- implement active-editor append-only concerns and one global sequence;
- snapshot-plus-tail boot, batch, quarantine, time travel, and backup;
- command boundary and pure materializers;
- typed query/backlink indexes.

Exit: cold reopen and time travel preserve the fixture byte-for-byte.

### Phase 2 — World Bible workspace

- content-tree views, record documents, inspector relations, typed reference
  autocomplete, backlinks, diagnostics, schedule grid, and At Time preview;
- world-marker binding through the existing map surface;
- business roster as a position/occupancy projection.

Exit: the entire fixture can be authored without raw JSON.

### Phase 3 — fake-internet floor

- site/domain/route/document/account model;
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

1. **World Bible is the editor; World Knowledge is the model.** Never store a
   disconnected page when a typed entity/relation owns the information.
2. **Authored named people are tenured.** Common workers remain seeded occupants
   until promotion.
3. **Job means Position plus Occupancy.** It is not a string on an NPC or an
   embedded worker tuple on a business.
4. **DOB is stored; age is derived.** Week/day/hour are views of one world
   instant.
5. **Accounts are entities.** Handles are not loose strings, and controller
   truth is separate from public ownership.
6. **Facts and Claims never share authority.** The internet is allowed to lie;
   mission/world predicates are not allowed to believe it by accident.
7. **No dead links and no fake counts.** Both become compiler contracts.
8. **Static authored floor first.** Event templates second; bounded AI prose
   last.
9. **Engaige is a quarry, not a dependency.** Import through ID canonicalization
   and validation only.
10. **Compile repeated presentation.** Site/layout/text templates are small
    dictionaries over dense instances; only dirty visible records update.

If these hold, the wiki is much more than a lore notebook. It becomes the place
where a business, its staff, building, hours, accounts, rumors, websites, and
gigs are authored once and then compiled into every system that needs them.
