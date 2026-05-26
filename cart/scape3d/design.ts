// scape/design.ts — the core data contract for the game.
//
// Design-only: no runtime, no rendering. Just the strict shapes the whole loop
// is built on, so every system downstream agrees on one model.
//
// Conventions:
//   • `XType`  = static registry/catalog definition (data you author once).
//   • `X`      = a live runtime entity (instances during play).
//   • Economic fields bind to framework/sim's roster — a game NPC and a sim
//     trader are the SAME identity, projected onto different surfaces.
//
// The two spine shapes everything references: `Suspicion` (how you get caught)
// and `VisualSignature` (how you get recognized).

// ── shared primitives ────────────────────────────────────────────────────────
export type Id = number;          // a runtime entity instance
export type Key = string;         // a stable registry key ('poison', 'ig', …)
export type Tile = { x: number; y: number };

/** The five ways the player can be traced. Notoriety = magnitude of this vector. */
export type EvidenceAxis = 'visual' | 'fund' | 'pattern' | 'digital' | 'location';
export type Suspicion = Record<EvidenceAxis, number>;   // each 0..100

/** What a person LOOKS like — the unit of recognition. Witnesses store this;
 *  interrogation matches it against the player's current signature → visual heat. */
export type VisualSignature = {
  silhouette: 'slim' | 'avg' | 'bulky';
  color: string;                  // dominant garment color (theme token)
  accessory: 'none' | 'hat' | 'hood' | 'mask' | 'glasses' | 'bag';
};

/** Agent level-of-detail: dormant = pure sim, active = behavior-tree, focal = live LLM. */
export type ActivationTier = 'dormant' | 'active' | 'focal';

// ── zone types ───────────────────────────────────────────────────────────────
// A higher-level region overlaid on the tile world. Zones set the detection
// pressure of a place: how readily kills are seen, camera coverage, law response.
export type ZoneKind =
  | 'plaza' | 'market' | 'residential' | 'wilderness'
  | 'darknet_cafe' | 'docks' | 'industrial';

export type ZoneType = {
  key: Key;
  kind: ZoneKind;
  label: string;
  population: number;             // 0..1 ambient NPC density
  surveillance: number;          // 0..1 camera coverage
  lawResponse: number;           // 0..1 speed/strength of a police response
  witnessBias: number;           // multiplier on how readily a kill is witnessed
  amplifies: EvidenceAxis[];     // axes this zone makes worse (plaza→visual, cafe→digital)
};
export type Zone = { typeKey: Key; min: Tile; max: Tile };

// ── item types ───────────────────────────────────────────────────────────────
// Things the player carries/uses. Costumes present a VisualSignature; weapons
// drive murder verbs; tools/consumables unlock interactions.
export type ItemCategory = 'weapon' | 'tool' | 'consumable' | 'costume' | 'key';

export type ItemType = {
  key: Key;
  category: ItemCategory;
  label: string;
  cost: number;
  ranged?: boolean;              // weapon: gun (line-of-fire) vs melee (adjacent)
  range?: RangeProfile;          // weapon: ballistics → drives the hit chance
  presents?: VisualSignature;    // costume: the identity it projects
  burnable?: boolean;            // costume/tool: becomes a liability once tied to a crime
  enables?: Key[];               // interaction keys this item unlocks
  charges?: number;              // consumable uses (poison vials, lockpicks)
};
export type ItemInstance = {
  id: Id;
  typeKey: Key;
  charges?: number;
  burned?: boolean;              // e.g. a costume seen at a crime scene
  quality?: number;             // 0..1 — product grade from the cook minigame; sets price
};

// ── asset types ──────────────────────────────────────────────────────────────
// Bigger owned things: the recurring money sink that keeps notoriety down, and
// the income that pays for it. This is where cash ⇄ freedom lives.
export type AssetKind =
  | 'safehouse' | 'vehicle' | 'business' | 'wallet'
  | 'launderer' | 'mixer' | 'fake_id';

export type AssetType = {
  key: Key;
  kind: AssetKind;
  label: string;
  cost: number;                  // up-front purchase
  upkeep: number;                // recurring drain per cycle (the burn rate)
  suppresses?: Partial<Suspicion>;  // per-cycle reduction of specific evidence axes
  income?: number;               // businesses/wallets generate cash per cycle
  speedMult?: number;            // vehicles: movement multiplier while occupied (the whole "driving" system)
};
export type AssetInstance = { id: Id; typeKey: Key; tile?: Tile; level: number };

// ── website types ────────────────────────────────────────────────────────────
// The dead-internet surfaces, each a renderable app fed by a content source:
//   'sim'    → framework/sim market           (dex)
//   'agents' → NPC posts/DMs/listings          (social / media / forum / darknet)
//   'ledger' → the investigation / evidence     (news, forum theories)
//   'static' → templated filler
export type WebsiteKind =
  | 'social' | 'media' | 'marketplace' | 'forum'
  | 'dex' | 'darknet' | 'news';
export type DeviceClass = 'phone' | 'computer' | 'both';

export type WebsiteType = {
  key: Key;
  kind: WebsiteKind;
  label: string;
  device: DeviceClass;
  source: 'sim' | 'agents' | 'ledger' | 'static';
};

// The artifacts the dead internet ACCUMULATES — without these, agents generate text
// that evaporates and leave no durable footprint. A rumor can move the Case; a
// listing is an Order's shopfront; a news_item is the investigation rendered. These
// persist in World.internet and the WebsiteType surfaces render slices of them.
export type InternetArtifactKind =
  | 'post' | 'dm' | 'listing' | 'comment' | 'rumor' | 'news_item' | 'market_screed';

export type InternetArtifact = {
  id: Id;
  siteKey: Key;
  kind: InternetArtifactKind;
  authorNpcId?: Id;
  relatedEventId?: Id;            // ties a post/rumor to a MurderEvent
  relatedOrderId?: Id;            // ties a listing/DM to an Order
  atMs: number;
  text: string;
  suspicionDelta?: Partial<Suspicion>;  // rumors/news can nudge the Case
  visibleToPlayer: boolean;
};

// ── interactions ─────────────────────────────────────────────────────────────
// The generic "do a thing" verb. Some interactions ARE murders (point at a
// MurderType); others are mundane (loot, talk, hack, buy). The method decides
// the input: instant, a timed cast bar, or a guitar-hero QTE. Interruptible
// casts seen mid-action become witnessed events.
export type InteractionMethod = 'instant' | 'cast' | 'qte';
export type InteractionTarget = 'npc' | 'object' | 'door' | 'item' | 'self' | 'tile';

export type InteractionType = {
  key: Key;
  label: string;                 // the menu row: 'Place poison', 'Pet dog', 'Use computer'
  target: InteractionTarget;
  proximity: 'adjacent' | 'ranged' | 'any';
  method: InteractionMethod;
  durationMs?: number;           // cast length
  interruptible: boolean;        // if witnessed mid-cast → fires an attempt / alert
  requires?: Key[];              // item / tool / skill keys
  effect: InteractionEffect;     // what it DOES — kill is just one variant
};

// Every verb resolves to one of these. The menu is universal because the menu
// is just "all interactions applicable to this target"; murder is the subset
// whose effect is `kill` or `arm`.
export type TriggerKind = 'consume' | 'proximity' | 'use' | 'timer';
export type InteractionEffect =
  | { kind: 'kill'; murderKey: Key }                       // immediate (shoot, melee, strangle)
  | { kind: 'arm'; murderKey: Key; trigger: TriggerKind }  // place poison / rig railing → fires later
  | { kind: 'lure'; draw: 'here' | 'sound' | 'tile' }      // distract / move the target's path
  | { kind: 'disable'; what: 'camera' | 'light' | 'alarm' | 'phone' }
  | { kind: 'access'; opens: WebsiteKind | 'container' }   // use computer / search a body
  | { kind: 'social'; topic?: string }                     // talk / pet dog / pure flavor
  | { kind: 'loot' };                                      // take cash / items

// ── murder types ─────────────────────────────────────────────────────────────
// NOT how a kill is performed (that's the interaction) — purely its CONSEQUENCE
// profile: the evidence it leaves, how the body is found, and its style. An
// interaction with effect `kill`/`arm` points here by `murderKey`.
export type BodyDiscovery = 'instant' | 'delayed' | 'hidden';  // poison=delayed, dumped=hidden

export type MurderType = {
  key: Key;
  label: string;
  witnessRadius: number;         // tiles within which a sighted NPC witnesses it
  loudness: number;              // audio radius — draws NPCs to come look
  discovery: BodyDiscovery;
  axisDeltas: Partial<Suspicion>;  // base evidence this method generates
  style: number;                 // style points awarded for the method
};

// An armed environmental kill, lying in wait. Carries your look when you planted
// it, so a camera that saw you rig it can still tie it back to you later.
export type Hazard = {
  id: Id;
  murderKey: Key;
  tile: Tile;
  trigger: TriggerKind;
  armedBySignature: VisualSignature;
};

// ── npc (the agent) ──────────────────────────────────────────────────────────
// One identity, four projections: a body in the world, an economic actor in
// framework/sim, an online persona, and a face in the UI. The .md files are its
// source of truth; these fields are the runtime view.
export type NpcProfile =        // mirrors framework/sim/npc.zig
  | 'retail' | 'swing' | 'whale' | 'alpha' | 'dev_insider'
  | 'mev_bot' | 'rug_runner' | 'paper_hands' | 'cartel';
export type NpcRole = 'civilian' | 'vendor' | 'dev' | 'influencer' | 'hitman' | 'cop' | 'informant';
export type NpcState = 'idle' | 'routine' | 'alert' | 'fleeing' | 'witness' | 'dead';

/** A persistent thing an NPC saw — the slice of MEMORY.md that drives the case. */
export type WitnessMemory = {
  eventId: Id;
  sawSignature: VisualSignature; // what the perpetrator looked like to them
  tile: Tile;
  atMs: number;
  certainty: number;             // 0..1 from distance / fov / lighting
  reported: boolean;             // has it reached the Case (interrogation / post)?
};

export type Npc = {
  id: Id;
  name: string;
  soul: Key;                     // SOUL.md / INSTRUCTIONS.md persona ref
  // world body
  tile: Tile; facing: number; homeZone: Key;
  appearance: VisualSignature;
  tier: ActivationTier;
  state: NpcState;
  alive: boolean;
  // perception
  sightRange: number; fovDeg: number;
  // economic body (bound to framework/sim)
  simWalletId: Id; profile: NpcProfile; usd: number; repScore: number;
  // social body (dead internet)
  roles: NpcRole[];
  accounts: Partial<Record<WebsiteKind, string>>;   // handle per platform
  relationships: { otherId: Id; sentiment: number }[];  // INTERACTIONS.md
  // detective relevance
  witnessed: WitnessMemory[];    // MEMORY.md (event slice)
  bountyUsd?: number;            // set if contractable as a target
  // daily life
  schedule?: ScheduleEntry[];    // routine followed while 'active' (drives the day)
};

// ── player ───────────────────────────────────────────────────────────────────
export type Skill = 'combat' | 'stealth' | 'hacking' | 'trading' | 'social';

// The drug-psychosis signal. Was a single 0..1 scalar; split so peak and comedown
// are mechanically distinct, and so GROUND TRUTH (`intensity`) is separated from
// the perception it drives. Subscribers: the shader (warp/grade), the action menu
// (perceived hit-% lies — systems/perception.ts), the market read, the phone, and
// the agents. The flat-gray comedown is its own game (slower casts, worse rolls,
// bored agents) — not just "less peak".
export type HighPhase = 'sober' | 'comeup' | 'peak' | 'overamped' | 'crashing';

export type HighState = {
  intensity: number;             // 0..1 — the magnitude everything scales from
  phase: HighPhase;              // peak ≠ crash; the phase changes which systems lie how
  substanceKey?: Key;            // what you're on (sets the curve/colour later)
  sinceMs: number;               // ms since the last dose — drives the curve
  rising: boolean;               // came up this tick vs decaying → comeup ↔ crashing
  // derived pressures the high pushes onto OTHER systems (each 0..1):
  phonePressure: number;         // notification spam / perceived urgency
  marketReadNoise: number;       // how far displayed market data drifts from truth
  agentAgitation: number;        // how weird/aggressive the NPC agents become
};

export type Player = {
  tile: Tile; facing: number;
  health: number; maxHealth: number;     // fail meter #1
  armor: number; maxArmor: number;       // soaks damage before health (GTA armor)
  money: number;
  simWalletId: Id;               // trades the same market as the NPCs
  /** The TRUE evidence you've generated (ground truth, some not yet discovered). */
  suspicion: Suspicion;
  // notoriety = f(suspicion): the exact reducer lives in state/player.ts, but the
  // contract guarantees it's a PURE function of Suspicion, range 0..100. The choice
  // is strategic: a weighted blend → players spread heat evenly; the max axis →
  // players dump into one axis they plan to launder. Current impl: weighted blend
  // (visual×1.5, fund×0.8, others ×1.0), normalised to 0..100.
  notoriety: number;             // derived 0..100 — fail meter #2
  costume: VisualSignature;      // current presented identity
  // GTA inventory: ONE item in hand, pockets are a flat quick-select wheel.
  // No grid, no slots, no weight — everything fits.
  inHand?: Id;                   // the item you're currently holding (any item, not just weapons)
  pockets: Id[];                 // everything carried — instant swap to hand
  assets: Id[];                  // AssetInstance ids (owned property, not carried)
  inVehicle?: Id;                // AssetInstance of a vehicle → applies its speedMult
  skills: Record<Skill, number>;
  lifeState: LifeState;          // free / hospital / jail (GTA setback, not reset)
  rapSheet: RapSheet;            // permanent record — what jail leaves behind
  career: { kills: number; style: number; earned: number };  // lifetime, persists
  // CROSS-SYSTEM SIGNAL, not just a screen filter. Ramps when you use, decays
  // over time. Subscribers: the shader (warp/grade), the market read (volatility
  // + your trades go impulsive), the phone (notification pressure), and the
  // agents (they get weirder/more aggressive). Perception always distorts;
  // erratic high-state behaviour also has real causal effects in thin pools.
  high: HighState;               // drug-psychosis signal (see HighState above)
};

// ── runtime glue (referenced by the above; the heartbeat of the loop) ─────────
export type MurderEvent = {
  id: Id;
  victimId: Id;
  murderKey: Key;
  tile: Tile; atMs: number; zone: Key;
  perpetratorSignature: VisualSignature;  // what the player looked like at the time
  witnesses: Id[];                         // npc ids with line-of-sight
  discovered: boolean;
};

/** The investigation. What the WORLD has assembled about the killer — converges
 *  toward Player.suspicion as witnesses report. The "AI playing Clue" reads &
 *  writes this; the news/forum sites render it. */
export type Case = {
  events: Id[];
  suspicion: Suspicion;          // the world's belief (lags ground truth)
  topSignature?: VisualSignature; // the description currently circulating in the news
  leads: { npcId: Id; axis: EvidenceAxis; weight: number }[];
};

// ── action menu (right-click target) ─────────────────────────────────────────
// Right-clicking a target queries the registry for every action the player could
// attempt given context (LoS, range, inventory, skill), each scored with a
// legible hit chance. RuneScape menu × X-COM percent-to-hit. Pure function of
// state — no LLM. A window counts as 'glass' LoS (you can see & shoot, penalised).
export type LosQuality = 'clear' | 'glass' | 'partial' | 'none';

/** A weapon's ballistic profile — lives on the weapon ItemType, drives chance. */
export type RangeProfile = {
  baseAccuracy: number;          // 0..1 at optimal range, clear LoS, unaware target
  optimalRange: number;          // tiles
  falloffPerTile: number;        // accuracy lost per tile away from optimal
  maxRange: number;              // beyond this the option is unavailable
  needsLos: boolean;             // ranged true; melee false (adjacency instead)
  glassPenalty: number;          // 0..1 multiplier when firing through a window
};

/** The legible breakdown behind one %, so the menu can show WHY it's 30%. Each
 *  field is a multiplier on `base`; `final` is their clamped product. This is
 *  GROUND TRUTH — what the menu DISPLAYS may be warped by high (see ActionOption). */
export type ChanceBreakdown = {
  base: number;                  // weapon's base accuracy at optimal range
  range: number;                 // × distance vs optimalRange (falloff)
  los: number;                   // × clear / glass / partial line of sight
  cover: number;                 // × target behind cover (props, corners)
  awareness: number;             // × unaware (bonus) vs alert/fleeing (penalty)
  health: number;                // × shooter's condition — low HP = shaky aim
  time: number;                  // × time of day — night penalises ranged sight
  skill: number;                 // × player combat/throwing skill
  final: number;                 // clamped product, 0..1
};

/** One row in the right-click menu. */
export type ActionOption = {
  interactionKey: Key;
  label: string;                 // 'Shoot with sniper'
  chance?: number;               // 0..1 (omitted for non-attacks like 'move here')
  breakdown?: ChanceBreakdown;
  style?: number;                // style points if it lands
  blocked?: boolean;             // shown greyed
  reason?: string;               // why blocked ('out of reach', 'no line of sight')
  // Perception, not truth: under high the menu may show a different victim than the
  // real one (the cop that's actually a civilian) and a different %. `chance` stays
  // ground truth; the SHOWN value is warped at render time (systems/perception.ts).
  perceivedTarget?: { npcId: Id; perceivedRole?: NpcRole; perceivedSignature?: VisualSignature };
};

// What happens after the dice roll. A MISS is not nothing: the target goes
// alert/fleeing, the botched attempt is witnessed and loud, and heat spikes —
// so the % is a risk-of-exposure gamble, not just a damage roll.
export type AttemptOutcome = {
  hit: boolean;
  event: 'murder' | 'attempt';   // 'attempt' still spawns evidence + alerts the target
};

// The canonical query that builds the menu (contract; implemented later):
//   availableActions(player: Player, target: Npc, world): ActionOption[]
//   resolveAction(player, target, option): AttemptOutcome

// ── lifecycle: persistence, setback (GTA) ────────────────────────────────────
// Not a roguelike reset — the world is durable. Death/capture is a setback.
export type LifeState = 'free' | 'hospital' | 'jail';

// What a setback costs. Death → hospital (lose loadout + a cash cut, time passes).
// Capture → jail (serve time, contraband confiscated, heat partly clears) — but
// the rap sheet grows, so it's never a clean slate.
export type SetbackRule = {
  state: LifeState;
  cashLossPct: number;
  loseInventory: boolean;        // hospital drops weapons; jail confiscates contraband
  timeSkipHours: number;         // hospital stay / sentence length
  notorietyAfter: number;        // residual heat on release
};

// The permanent record. Each bust burns the disguise you wore — those signatures
// are now "known," so wearing them again spikes visual heat instantly, and
// every bust ramps how fast the law comes for you next time.
export type RapSheet = {
  busts: number;
  burnedSignatures: VisualSignature[];
  heatRamp: number;              // multiplier on future suspicion accrual
};

// ── time: the daily system ───────────────────────────────────────────────────
// The clock drives everything: NPC routines, market ticks, the investigation
// advancing (witnesses get interrogated over hours, so news lags reality).
export type WorldClock = { day: number; hourOfDay: number; ms: number; speed: number };
export type ScheduleEntry = {
  fromHour: number; toHour: number;
  zone: Key;
  activity: 'home' | 'work' | 'social' | 'trade' | 'idle';
};

// ── story: the authored spine threaded through the sandbox ───────────────────
// Objectives reference live world entities (an agent, a zone, the market, a
// website) — the story is a curated path through systems that run anyway.
export type ObjectiveKind =
  | 'kill' | 'reach' | 'earn' | 'acquire' | 'talk' | 'evade' | 'use_site';
// Explicit target so npc-by-Id and zone/site-by-Key can't be silently confused
// (the old single `targetId?: Id` was ambiguous and would quietly break for zones).
export type ObjectiveTarget =
  | { kind: 'npc'; id: Id }
  | { kind: 'zone'; key: Key }
  | { kind: 'site'; key: Key }
  | { kind: 'tile'; tile: Tile };
export type Objective = {
  kind: ObjectiveKind;
  target?: ObjectiveTarget;      // who/where (subsumes the old targetId + siteKey)
  amount?: number;               // $ goal, or notoriety ceiling for 'evade'
  itemKey?: Key;
  marker?: Tile;                 // the world blip you path to in order to engage
  done: boolean;
};
export type QuestStage = { id: Id; brief: string; objectives: Objective[] };
export type Quest = {
  key: Key;
  title: string;
  isMain: boolean;               // main storyline vs side gig
  giverId?: Id;                  // the AI npc who hands it out (Eldrin-style)
  stages: QuestStage[];
  stageIndex: number;
  reward: { cash?: number; itemKey?: Key; repDelta?: number };
  requires?: QuestRequirement;   // gate — see below. Absent = always offered.
};

// The "no story state machine" model: availability is a PURE predicate over world
// state, never a graph of transitions. `availableQuests(world)` is just
// `quests.filter(q => meets(q.requires, world))` — a quest unlocks the instant its
// criteria are met, in any order. e.g. OneLastRodeo.requires =
// { questsDone:['SunsetTilDawn'], relationship:{ withId:'big_tony', min:0.43 } }:
// you can finish SunsetTilDawn but still be locked out until rep is high enough,
// which you grind via big_tony's side-mission rotation (MissionTemplate, below).
export type QuestRequirement = {
  relationship?: { withId: Id; min: number };  // player↔giver sentiment ≥ min (0..1)
  questsDone?: Key[];                           // these quests must be complete
  skills?: Partial<Record<Skill, number>>;      // min skill levels
  items?: Key[];                                // must currently hold these keys
  maxNotoriety?: number;                        // too hot → the giver won't deal
  minDay?: number;                              // not offered before this in-game day
};

// ── perception overlay: the layer that lets the UI lie without the sim lying ─────
// High-state hallucination must NOT mutate ground truth. Instead it writes here:
// the renderer reads `World.perception` on top of reality, so the cop the player
// "sees" can be a civilian, a phantom tile can appear, a price can drift — while the
// simulation stays honest underneath. Entries expire so the world snaps back.
export type PerceivedNpcOverride = {
  npcId: Id;
  perceivedRole?: NpcRole;       // the civilian that reads as a cop
  perceivedSignature?: VisualSignature;
  threatLevel?: number;          // 0..1 — how dangerous they FEEL
  expiresAtMs: number;
};
export type PerceptionOverlay = {
  npcOverrides: PerceivedNpcOverride[];
  phantomTiles: { tile: Tile; kind: string; expiresAtMs: number }[];
  marketPriceNoise: { assetKey: Key; displayedMult: number; expiresAtMs: number }[];
};

// ── world root: the durable game state ───────────────────────────────────────
export type World = {
  clock: WorldClock;
  player: Player;
  npcs: Npc[];                   // the roster (binds to framework/sim)
  zones: Zone[];
  hazards: Hazard[];             // armed traps lying in wait
  events: MurderEvent[];         // everything that's happened
  case: Case;                    // the active investigation
  quests: Quest[];               // story + side, with live progress
  // live instance collections the Player ids resolve INTO (pockets/assets/inHand
  // reference these; without them the player references entities that live nowhere):
  items: ItemInstance[];         // carried + world-floor item instances
  assets: AssetInstance[];       // owned property instances
  orders: Order[];               // the dealing queue (buyers are agents)
  internet: InternetArtifact[];  // the dead internet's durable footprint
  perception: PerceptionOverlay; // what the player is shown vs what's true (high)
};

// ── authoring layer (compiles INTO the runtime data above — NOT live nodes) ──
// Buildings/items are AUTHORED declaratively, then flattened at load into the
// data the shader + registries already consume. A building "renders itself" by
// EMITTING footprint tiles/heights + interactions — it never mounts world nodes
// (that's the regression we fixed). Same spirit as Scene3D's <Mesh>: JSX
// describes, the host draws. The runtime contract above does not change.

// One stamped cell, relative to a placement origin.
export type FootprintCell = { dx: number; dy: number; tile: number; height?: number };
export type BuildingDef = {
  key: Key;
  label: string;
  footprint: FootprintCell[];    // walls/floor/door stamped onto the tilemap+height layer
  interactions: Key[];           // verbs the building exposes (enter, shop, rob, …)
  enterTo?: Key;                 // interior map / shop UI opened on entry
};
export type Placement = { defKey: Key; origin: Tile; rotation: 0 | 90 | 180 | 270; zone?: Key };
export type MapDef = { placements: Placement[]; zones: Zone[] };

// An item has two faces. World = an SDF descriptor on the existing sprite path.
// UI = a real React component (card / shop row / use-screen) — screen-space,
// where React is correct — resolved by `uiKey` from a UI registry at runtime.
export type ItemRender = { spriteKind: number; tint?: number };
export type ItemModule = {
  type: ItemType;
  world: ItemRender;
  uiKey?: Key;
};

// ── dealing (the hands-on 'earn' — Schedule-1-style content over the systems
// above, NOT new architecture). Loop: order → cook(QTE) → deliver(risk) → cash.
// Buyers are AI agents, so the order queue is the dead-internet marketplace.
export type Order = {
  id: Id;
  customerId: Id;                // an NPC agent on the marketplace/darknet
  productKey: Key;               // the ItemType wanted
  minQuality: number;            // 0..1 — fussy buyers pay more, demand better
  qty: number;
  payout: number;
  deliverTo?: Tile;              // in-person delivery marker (random events en route)
  sting?: boolean;               // a honeypot from the investigation — hidden from the UI
};

// ── reusable daily side-missions (the rep grind that feeds QuestRequirement) ──
// A giver owns a ROTATION of reusable mission shapes — big_tony's is
// [PackageDelivery, QuacksLikeADuck, AllEyesNoEars, …]. Each is a parametric
// TEMPLATE, not a hand-authored quest: at the top of the day it's instantiated
// with concrete coords/deadline/payout (→ a MissionInstance), and its framing
// text is generated. Completing them accrues `baseRep` toward the giver, which is
// how a locked core Quest (relationship-gated) eventually opens.
export type MissionTemplate = {
  key: Key;
  giverId: Id;                   // whose rotation this belongs to
  objective: ObjectiveKind;      // the verb the day's instance fills (acquire/kill/reach/…)
  baseRep: number;               // sentiment delta toward the giver on success
  constraints?: MissionConstraint[];
  staticBrief: string;           // fallback framing when no LLM is configured
};

// Constraints SILENTLY decide the deal. An unmet constraint sinks the mission with
// no UI objective ever shown — the only tell is how the giver framed it ("get a
// new set of threads before you show up"). So failing one feels like the world
// reacting, not a checklist you missed.
export type MissionConstraint =
  | { kind: 'wearNewCostume' }                  // arrive in a face NOT on your rap sheet
  | { kind: 'arriveBy'; hour: number }          // hard deadline (in-game hour)
  | { kind: 'maxNotoriety'; ceiling: number }   // show up too hot → it's off
  | { kind: 'holdItem'; key: Key };             // must be carrying X on arrival

// A template stamped for one day. `brief` is the resolved framing (LLM or static);
// it compiles INTO a normal Quest, so the runtime quest machinery is unchanged.
export type MissionInstance = {
  templateKey: Key;
  day: number;                   // the in-game day this was rolled for
  origin: Tile; destination?: Tile;
  deadlineHour?: number;
  payout: number;
  brief: string;                 // the giver's resolved message to the player
};

// ── LLM framing (OPTIONAL — static fallback always works) ─────────────────────
// worldStateFactorization() collapses live world state into the few facts a giver
// would plausibly KNOW, then (SOUL.md persona + INTERACTIONS.md history + these
// facts) becomes the prompt that frames a MissionInstance. With no LLM configured
// the template's staticBrief is used verbatim — the game is fully playable either
// way; the LLM only buys richer, reactive immersion ("saw your dumb ass on the
// news last night — get a costume before you come around").
export type MissionGenContext = {
  templateKey: Key;
  soul: Key;                     // the giver's SOUL.md / persona ref
  recentInteractions: string;    // INTERACTIONS.md slice (flaky? owes money? reliable?)
  worldFacts: {                  // the worldStateFactorization() output
    daysAwake: number;           // from HighState.sinceMs accumulation
    notoriety: number;           // player heat (0..100)
    recentHeadlines: Id[];       // InternetArtifact ids ABOUT the player (the chase video)
    playerCashFlow: number;      // recent earn rate — drives how desperate the giver is
  };
};

// ── persistence: autosave snapshot (the world is durable; you resume in place) ─
// The world is a STATELESS-shape over a serialisable root: bake() rebuilds ALL
// static geometry (tiles/heights/meshes) from the entity tree at load, so a save
// stores only MUTABLE state — player position/progress, cache.opened flags, quest
// progress, npc positions, the clock. Written ~once/minute and on key events;
// loaded on restart so a 400-tile walk isn't repeated. `World` is already the
// durable root, so the snapshot just wraps it + a version for migration.
export type SaveSnapshot = {
  version: number;
  savedAtMs: number;             // real wall-clock time the snapshot was taken
  world: World;                  // the whole durable root (no meshes — bake() re-derives them)
};

