import type { DocIndex } from '../types';

export const world_knowledge_authoring: DocIndex = {
  name: 'world_knowledge_authoring',
  file: 'WORLD_KNOWLEDGE_AUTHORING.md',
  purpose: ['npc', 'world_gen', 'scripting', 'persistence', 'ui', 'agent_llm'],
  summary:
    'Candidate architecture for a wiki-shaped World Bible over typed World Knowledge: stable people/organization/position/place/account/site/document/fact/claim/gig records compile into dense schedule, route, search, text, and mission-affordance indexes; runtime story events project causally linked internet artifacts without changing authored truth. Engaige contributes content-density and recursion disciplines, while its free-text identities, random schedules, event firehose, and fact-inventing AI are explicitly retired from the port shape.',
  interfaces: [
    {
      name: 'WORLD_KNOWLEDGE',
      purpose: ['npc', 'world_gen', 'scripting', 'persistence'],
      kind: 'module',
      sourceFile: 'docs/game/WORLD_KNOWLEDGE_AUTHORING.md',
      description:
        'Candidate deep boundary for the active editor: apply typed authoring commands into append-only concern events, materialize/query/validate a WorldKnowledgeSnapshot, and compile a WorldKnowledgePack. The module hides global sequencing, snapshot+tail boot, schema decoding, backlinks, typed reference validation, batching, quarantine, and compile caches; React renders queries and dispatches commands only.',
      dependsOn: ['V20 persistence semantics', 'WorldMarker', 'GAME_MISSIONS', 'GAME_STORY'],
      consumers: ['cart/editor', 'cart/editor/play', 'framework game loader'],
      status: 'candidate',
    },
    {
      name: 'WorldKnowledgeSnapshot',
      purpose: ['npc', 'world_gen', 'scripting', 'persistence'],
      kind: 'data_model',
      sourceFile: 'docs/game/WORLD_KNOWLEDGE_AUTHORING.md',
      description:
        'Materialized authored truth split into stable typed entities and relations: Person; Organization; Position plus time-varying Occupancy; Place bound to semantic WorldMarker ids; Account and InternetSite; Fact versus public Claim; InternetDocument blocks/routes; ShiftPattern; and tuning-keyed GigTemplate. Display labels and prose never replace ids, age is derived from DOB, and jobs/business workers are projections over position occupancy.',
      dependsOn: ['WorldMarker'],
      status: 'candidate',
    },
    {
      name: 'WorldKnowledgePack',
      purpose: ['format', 'npc', 'world_gen', 'scripting', 'game_loop'],
      kind: 'data_model',
      sourceFile: 'docs/game/WORLD_KNOWLEDGE_AUTHORING.md',
      description:
        'Proposed shipped game-logic section: interned strings and dense typed ids, kind-grouped rows, flat relationship adjacency spans, marker bindings, RLE schedule runs, site/domain/route and search indexes, account/feed seeds, document/claim rows, mission affordances, deterministic media templates, and asset refs. It is data for the stateless Zig engine, not SQLite, per-page map lumps, a Bun server, or per-game JavaScript.',
      dependsOn: ['gamefile logic stream'],
      consumers: ['framework game loader', 'cart/editor/play'],
      status: 'candidate',
    },
    {
      name: 'WorldBibleSurface',
      purpose: ['ui', 'npc', 'world_gen', 'scripting'],
      kind: 'component',
      sourceFile: 'docs/game/WORLD_KNOWLEDGE_AUTHORING.md',
      description:
        'Proposed active-editor workspace view: existing content tree and document tabs browse wiki-shaped entity pages; the inspector edits strict relations and map bindings; backlinks/where-used, typed [[id]] autocomplete, weekly and At Time projections, site preview, gig-template creation, and navigable compile diagnostics all operate on WORLD_KNOWLEDGE rather than a second shell or raw JSON editor.',
      dependsOn: ['WORLD_KNOWLEDGE', 'WorldMarker'],
      consumers: ['cart/editor'],
      status: 'candidate',
    },
    {
      name: 'FactClaimBoundary',
      purpose: ['scripting', 'npc', 'agent_llm'],
      kind: 'data_model',
      sourceFile: 'docs/game/WORLD_KNOWLEDGE_AUTHORING.md',
      description:
        'Authority split that lets the fake internet lie safely: Fact is authored/runtime world truth with knowledge scope; Claim is what a document asserts, denies, speculates, or satirizes. Internet/NPC sentiment consumes claims, while mission predicates and simulation consume facts. Optional AI can phrase a supplied claim set but cannot mint facts, ids, numbers, predicates, objectives, or deltas.',
      status: 'candidate',
    },
    {
      name: 'KnowledgeMissionAffordances',
      purpose: ['scripting', 'agent_llm', 'npc', 'game_loop'],
      kind: 'data_model',
      sourceFile: 'docs/game/WORLD_KNOWLEDGE_AUTHORING.md',
      description:
        'Compiler product joining lore to V22 missions: queryable people, stable positions, occupancies, organizations, places/markers, service/site capabilities, shift windows, items/methods, predicates, tuning profiles, and hook/world-delta keys. Generated rows select only those ids; structural validation and the headless player run before a listing publishes.',
      dependsOn: ['WorldKnowledgeSnapshot', 'GAME_MISSIONS'],
      status: 'candidate',
    },
  ],
  patterns: [
    {
      name: 'Wiki is a lens over typed world knowledge',
      purpose: ['ui', 'npc', 'world_gen', 'scripting'],
      description:
        'Human authoring stays readable and backlink-driven, but canonical machine relationships are typed records. Person job/home, business workers/locations/sites, social handles, shifts, and gigs are projections and relations rather than duplicated page fields or free-text tuples.',
      examples: ['world_knowledge_authoring'],
      promoteTo: 'WORLD_KNOWLEDGE',
      status: 'promote',
    },
    {
      name: 'Authored floor plus causally bounded media ceiling',
      purpose: ['scripting', 'agent_llm', 'npc'],
      description:
        'The game ships a complete linked internet with AI disabled. Meaningful story events feed deterministic media templates; optional AI changes presentation only. Every dynamic post/article/alert carries source event ids, while telemetry and scheduler plumbing never enter story canon.',
      examples: ['world_knowledge_authoring', 'CRIMINAL_CAREERS'],
      status: 'recurring',
    },
    {
      name: 'Template dictionaries over dense content instances',
      purpose: ['rendering', 'ui', 'format'],
      description:
        'REROLL/Tailwhip applied to the fake internet: a small site/layout/text template vocabulary is compiled once over flat SoA document/post instances; frequent text is prepared/atlased, visible rows are virtualized, dynamic text uses an escape lane, and dirty updates remain document/channel-local.',
      examples: ['world_knowledge_authoring', 'compiled-layout REROLL', 'tailwhip textgl'],
      status: 'promote',
      promoteTo: 'WorldKnowledgePack',
    },
    {
      name: 'Position is stable; occupancy changes',
      purpose: ['npc', 'scripting', 'world_gen'],
      description:
        'Organizations author stable jobs as Positions with workplace, shift, capabilities, markers, and occupant policy. Occupancy binds an authored/promoted person or seeded generation handle over an interval. Person-bound grievances and position-bound rackets therefore coexist without duplicating business rosters.',
      examples: ['world_knowledge_authoring', 'game_missions'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'wiki page mistaken for canonical game state',
      purpose: ['ui', 'npc', 'scripting', 'persistence'],
      description:
        'Storing NPC job/home, business workers, schedules, accounts, and gigs as independent prose/page fields creates contradictions and makes future mission queries unprovable. The wiki must edit typed records and show their projections, never become a second unstructured truth store.',
      evidence: ['docs/game/WORLD_KNOWLEDGE_AUTHORING.md §3–§6', '/home/siah/creative/engaige/server/data/*.db'],
      fix: 'Put stable ids and typed relationships under WORLD_KNOWLEDGE; derive page fields and rosters through queries.',
      severity: 'high',
    },
    {
      name: 'Engaige free-text entity aliases are not portable identity',
      purpose: ['npc', 'scripting', 'world_gen'],
      description:
        'Engaige content references entities by display strings, producing aliases for the same person or corporation. Blindly importing those arrays would sever backlinks, schedules, accounts, and mission bindings while appearing to work in prose search.',
      evidence: ['/home/siah/creative/engaige/server/src/services/site-content.ts', '/home/siah/creative/engaige/server/data/game.db'],
      fix: 'Run an offline canonicalization/alias report, assign stable typed ids, and fail unresolved links; never copy the tables directly into the game.',
      severity: 'high',
    },
    {
      name: 'media recursion can launder fiction into fact',
      purpose: ['agent_llm', 'npc', 'scripting'],
      description:
        'Engaige injects generated articles into NPC context as indistinguishable truth, so a model can invent a fact and later posts amplify it. That is entertaining presentation but unsafe authority for witnesses, missions, money, schedules, or world deltas.',
      evidence: ['/home/siah/creative/engaige/server/src/services/story-generator.ts', '/home/siah/creative/engaige/server/src/services/context-builder.ts'],
      fix: 'Enforce FactClaimBoundary; generated prose may express only supplied claims and must retain cause/source ids.',
      severity: 'high',
    },
    {
      name: 'authoring every worker defeats distributional population',
      purpose: ['npc', 'world_gen', 'game_loop'],
      description:
        'A wiki makes it tempting to create a persistent Person for every employee. That contradicts V21 and would turn fixed seeded pools into unbounded per-identity memory, schedule, prompt, and event costs.',
      evidence: ['DECISIONS.md V21', 'docs/game/WORLD_KNOWLEDGE_AUTHORING.md §7'],
      fix: 'Author stable Positions; fill common roles with deterministic seeded occupants and promote identity only on witness/mission/story/cascade triggers.',
      severity: 'high',
    },
    {
      name: 'causal field that is optional in practice is no provenance',
      purpose: ['persistence', 'scripting', 'agent_llm'],
      description:
        'Engaige defines parent_event_id but its audited event rows do not populate it. A nullable convention cannot support replayable internet memory or evidence tracing when producers routinely omit it.',
      evidence: ['/home/siah/creative/engaige/server/src/events/event-bus.ts', '/home/siah/creative/engaige/server/data/game.db'],
      fix: 'Require non-empty sourceEventIds at the dynamic media/projector boundary and keep diagnostics events out of the story log.',
      severity: 'medium',
    },
  ],
};
