import type { DocIndex } from '../types';

export const world_knowledge_authoring: DocIndex = {
  name: 'world_knowledge_authoring',
  file: 'WORLD_KNOWLEDGE_AUTHORING.md',
  purpose: ['npc', 'world_gen', 'scripting', 'persistence', 'ui', 'agent_llm'],
  summary:
    'Candidate format-first architecture: project-owned Markdown files with declarative <block> records, stable <ref> identities, @[ref] links, and surrounding human prose are canonical. The first in-app World Bible is deliberately an ordinary wiki—pages, search, links, backlinks, simple facts/assets, and read/edit/review—with a visibly divergent draft and formal Write to Disk confirmation. It establishes entities before any gameplay-needed website, account, listing, document, or mission is designed as a separate linked projection.',
  interfaces: [
    {
      name: 'WORLD_KNOWLEDGE',
      purpose: ['npc', 'world_gen', 'scripting', 'persistence'],
      kind: 'module',
      sourceFile: 'docs/game/WORLD_KNOWLEDGE_AUTHORING.md',
      description:
        'Candidate deep boundary for the active editor: parse canonical Markdown-with-block files into a disk snapshot; apply commands only to a separately journaled draft; query/validate either source; prepare semantic+textual write proposals; and mutate disk only through formal confirmation guarded by the expected disk hash. The module hides concrete syntax spans, byte-preserving patches, disk/base/draft state, conflict detection, draft recovery/global sequencing, backlinks, typed reference validation, atomic writes, and compile caches; normal compile always reads disk.',
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
        'Derived parse of the confirmed on-disk block source, split into stable typed entities and relations: Person; Organization; Position plus time-varying Occupancy; Place bound to semantic WorldMarker ids; Account and InternetSite; Fact versus public Claim; InternetDocument blocks/routes; ShiftPattern; and tuning-keyed GigTemplate. <ref> owns identity, @[ref] owns links, surrounding prose is preserved, age derives from DOB, and jobs/business workers project from position occupancy.',
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
        'Proposed deliberately simple active-editor wiki over canonical block files: index/search, ordinary readable entity pages, one editing view, small facts/assets/relations, typed-ref links, backlinks, and basic diagnostics. Every page shows DISK, DRAFT CHANGED, DISK CHANGED, or CONFLICT; Review Changes exposes semantic and exact-text diffs; Write to Disk names target paths and requires confirmation. Platform previews, graph canvases, schedule dashboards, bespoke inspectors, and gig wizards are deferred until proven necessary.',
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
        'Human-readable Markdown-with-block files are canonical. The wiki parses them into typed forms and backlinks, while Person job/home, business workers/locations/sites, social handles, shifts, and gigs remain linked records rather than duplicated free-text tuples. The editor can propose changes but cannot silently publish them.',
      examples: ['world_knowledge_authoring'],
      promoteTo: 'WORLD_KNOWLEDGE',
      status: 'promote',
    },
    {
      name: 'Explicit draft-to-disk write boundary',
      purpose: ['persistence', 'ui', 'maintenance'],
      description:
        'Editor actions mutate a visibly divergent recoverable draft only. Review Changes prepares a semantic and exact-text patch; formal Write to Disk confirmation is the sole publish door, guarded by the expected disk hash and stopped by external edits. Compile reads confirmed disk, while recovered drafts remain labeled noncanonical.',
      examples: ['world_knowledge_authoring', 'project_mission_block_authoring'],
      promoteTo: 'WORLD_KNOWLEDGE.confirmDiskWrite',
      status: 'promote',
    },
    {
      name: 'Entity first, platform projection later',
      purpose: ['ui', 'scripting', 'world_gen', 'maintenance'],
      description:
        'The ordinary wiki first establishes a stable business, NPC, place, organization, or mechanic with a ref, name, prose, and known links. Existence does not automatically create a website, social account, listing, document, or mission. When gameplay proves a platform need, its presence is authored as a separate linked entity with purpose-specific behavior and UI.',
      examples: ['world_knowledge_authoring'],
      promoteTo: 'WorldBibleSurface',
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
      name: 'premature platform CMS obscures entity authoring',
      purpose: ['ui', 'scripting', 'maintenance'],
      description:
        'Starting the World Bible with site previews, feed composers, schedule dashboards, graph canvases, and type-specific inspectors makes basic lore entry depend on platform decisions that have not been made. It also pressures every entity to acquire fake-internet presences whether gameplay needs them or not.',
      evidence: ['USER ASK req_3269', 'docs/game/WORLD_KNOWLEDGE_AUTHORING.md §10/§16'],
      fix: 'Ship familiar wiki primitives first; establish partial entities independently; add each platform as a later linked projection only after its gameplay purpose and required data are known.',
      severity: 'high',
    },
    {
      name: 'automatic editor writes erase the source-of-truth distinction',
      purpose: ['persistence', 'ui', 'maintenance'],
      description:
        'If a field edit, world binding, generated suggestion, or draft recovery immediately rewrites the Markdown file, the user cannot distinguish editor state from canonical disk state, review exact changes, or protect simultaneous hand edits. Autosaving a draft is acceptable; silently publishing it is not.',
      evidence: ['USER ASK req_3265', 'docs/game/WORLD_KNOWLEDGE_AUTHORING.md §0/§11'],
      fix: 'Expose DISK/DRAFT CHANGED/DISK CHANGED/CONFLICT, prepare a reviewable patch, require formal Write to Disk confirmation, re-check the disk hash, and compile disk only.',
      severity: 'high',
    },
    {
      name: 'wiki page mistaken for canonical game state',
      purpose: ['ui', 'npc', 'scripting', 'persistence'],
      description:
        'Treating the World Bible draft or an internal database as canonical splits authority from the human-readable block files; separately duplicating NPC job/home, business workers, schedules, accounts, and gigs also makes future queries contradictory. The wiki must remain a projection and deliberate patch producer over disk.',
      evidence: ['docs/game/WORLD_KNOWLEDGE_AUTHORING.md §3–§6', '/home/siah/creative/engaige/server/data/*.db'],
      fix: 'Keep <ref>/@[ref] block files canonical; derive typed fields and rosters through queries; publish editor changes only through the confirmed write boundary.',
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
