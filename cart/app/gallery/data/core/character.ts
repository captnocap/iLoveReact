// Character — the assistant's mask, sculpted by the user.
//
// ── Why a separate shape from Role ────────────────────────────────
// Role is profession-shaped (Planner / Reviewer / Implementer). It
// bundles skills + base system message + default model. A Character
// is mask-shaped — visual identity + voice + positive traits +
// negative traits + relationship posture + fictional continuity.
// A Role can be played by many Characters; a Character can play many
// Roles. The Assistant remains the runtime authority underneath it.
//
// ── How it composes ──────────────────────────────────────────────
// At request-resolve time, the active Character feeds the master
// composition's "who" slot via the `src_character-snapshot` source
// kind:
//
//   1. Archetype voice fragment (if archetypeId set)
//   2. Dial-derived fragments (resolved from dialValues against
//      personality-dial.ts mappings, near-pole values only)
//   3. Quirk fragments (one per quirkIds[])
//   4. Relationship-stance + initiative-profile + correction-style
//      fragments (small static set)
//   5. BoundaryRule Constraints (treated as guardrails — surfaced
//      to the runtime as active Constraints whose appliesDuring
//      includes 'always' or matches the current phase)
//   6. Instruction buckets (`do` / `prefer` / `avoid` / `never`)
//      and negative-mode allowances. These compile into the structured
//      `active_character` JSON block in the system prompt. They are
//      first-class because absence is not enough: "do not reassure"
//      and "do not be a yes-person" must be explicit.
//
// ── Authority boundary ─────────────────────────────────────────
// Character is a mask over the Assistant shape, not a replacement for
// it. It may influence tone, posture, initiative, and refusal style.
// It cannot grant tools, widen privacy, change billing/model routing,
// bypass safety, or override developer/system instructions. The
// `maskContract` below is stored with the row so compiled snapshots can
// tell the model exactly where character authority ends.
//
// ── Identity vs settings grain ───────────────────────────────────
// Character belongs to Assistant. Settings can still scope visibility
// and defaults, but the conceptual parent is Assistant, not Worker and
// not Supervisor. Character never applies to Supervisor or Worker.

import type { GalleryDataReference, JsonObject } from '../../types';

export type CharacterRelationshipStance =
  | 'stranger'
  | 'colleague'
  | 'friend'
  | 'confidant'
  | 'mentor'
  | 'chaotic-sibling';

export type CharacterInitiativeProfile =
  | 'silent'
  | 'contextual'
  | 'proactive'
  | 'anticipatory';

export type CharacterCorrectionStyle =
  | 'gentle-nudge'
  | 'socratic'
  | 'direct'
  | 'silent';

export type CharacterStatus = 'draft' | 'active' | 'archived';
export type CharacterVisibility = 'private' | 'profile' | 'shared';

export type CharacterInstructionBuckets = {
  /** Required behaviors. */
  do: string[];
  /** Soft preferences; yield when the task clearly calls for otherwise. */
  prefer: string[];
  /** Negative traits. These are as important as positives: they define what the mask refuses to become. */
  avoid: string[];
  /** Hard character-level prohibitions. Still subordinate to Assistant/system/developer authority. */
  never: string[];
};

export type CharacterNegativeMode = {
  enabled: boolean;
  /** e.g. `acerbic_critic`, `hostile_sparring_partner`, `cold_operator`. */
  style?: string;
  /** What this negative character is allowed to do while still being useful. */
  allowed: string[];
  /** Behaviors that would turn the mask from negative into broken/unsafe. */
  notAllowed: string[];
};

export type CharacterMaskContract = {
  kind: 'assistant-mask';
  assistantAuthority: 'inherits';
  mayInfluence: string[];
  cannotOverride: string[];
  conflictPolicy: string;
};

export type CharacterRoleplayIdentity = {
  age?: string;
  race?: string;
  gender?: string;
  location?: string;
  motive?: string;
  likes?: string;
  dislikes?: string;
};

export type CharacterIdentityContinuity = {
  /** Who the user is to this character: student, client, coauthor, friend, etc. */
  userIdentityToCharacter?: string;
  relationshipType?: string;
  relationshipContext?: string;
  /** Shared continuity the character may treat as prior context. */
  continuitySeed?: string;
  /** Fictional/history-flavored continuity. Must not be claimed as literal fact. */
  ghostHistorySeed?: string;
};

export type CharacterIntegrity = {
  /** What the character must preserve about itself under pressure. */
  guardrails?: string;
  /** How to recover when the character breaks voice or overdoes the mask. */
  recoveryStyle?: string;
  /** Optional deflections when a request does not fit the character. */
  fallbackDeflections?: string;
};

export type CharacterDelivery = {
  deliberationProfile?: string;
  availabilityProfile?: string;
  deliveryPattern?: string;
};

export type CharacterKnowledgeSource = {
  id: string;
  label: string;
  /**
   * `file` — local path on disk, treated as canon by the assistant.
   * `url` — fetched on demand.
   * `inline` — body stored alongside the source row.
   * `asset` — local/gallery asset used as embodiment or reference.
   * `style-reference` — document/media treated as influence, not factual retrieval.
   */
  kind: 'file' | 'url' | 'inline' | 'asset' | 'style-reference';
  locator: string;
  influence?: 'voice' | 'backstory' | 'knowledge-weight' | 'style' | 'boundary' | 'avatar' | 'custom';
  weight?: number;
  description?: string;
};

export type Character = {
  id: string;
  assistantId: string;
  settingsId: string;
  userId: string;
  status: CharacterStatus;
  visibility: CharacterVisibility;
  name: string;
  displayName?: string;
  /** One-line self-description authored by the user. */
  bio?: string;
  /** Asset reference — URL, file path, or asset id. The pipeline is TBD. */
  avatarRef?: string;
  /** Same idea for a short audio sample. Future. */
  voiceThumbnailRef?: string;
  /**
   * Gallery theme id whose tokens drive the active UI accent /
   * chrome when this character is selected. Never a hex literal —
   * always a theme reference per the no-color-drift rule.
   */
  themeId?: string;
  /**
   * Explicit authority boundary. Character is the mask; Assistant is
   * the runtime authority. This makes the relationship legible to the
   * prompt compiler and to future UI.
   */
  maskContract: CharacterMaskContract;
  archetypeId?: string;
  /** Map of dial id → 0..1 value. Unset dials fall back to the dial's defaultValue. */
  dialValues: Record<string, number>;
  quirkIds: string[];
  relationshipStance: CharacterRelationshipStance;
  initiativeProfile: CharacterInitiativeProfile;
  correctionStyle: CharacterCorrectionStyle;
  /** FK → Constraint.id. Boundary rules that travel with this character. */
  boundaryRuleIds: string[];
  /** Multi-select posture: what this assistant is for. */
  taskDomainIds: string[];
  /** Multi-select social registers this character may inhabit. */
  relationshipRegisterIds: string[];
  /** User states this character explicitly knows how to adapt to. */
  userStateIds: string[];
  /** Stakes bands the character mirrors when calibrating caution. */
  stakeProfileIds: string[];
  /** Knowledge domains selected as meaningful parts of the character. */
  knowledgeSpecializationIds: string[];
  /** Map of knowledge-specialization id -> 0..1 influence weight. */
  knowledgeWeights: Record<string, number>;
  instructionBuckets: CharacterInstructionBuckets;
  negativeMode: CharacterNegativeMode;
  /** Fictional posture. The assistant must not claim it is literal fact. */
  fictionalBackstory?: string;
  /** Embodiment prompt or future avatar-generation seed. */
  profileImagePrompt?: string;
  identityContinuity: CharacterIdentityContinuity;
  integrity: CharacterIntegrity;
  delivery: CharacterDelivery;
  roleplay: CharacterRoleplayIdentity;
  /**
   * Legacy flat fields kept while the /character page migrates to the
   * nested roleplay/continuity groups above.
   */
  roleplayAge?: string;
  roleplayRace?: string;
  roleplayGender?: string;
  roleplayLocation?: string;
  roleplayMotive?: string;
  likes?: string;
  dislikes?: string;
  /** Escape hatch for user-defined character attributes. */
  customProperties: Record<string, string>;
  knowledgeSources: CharacterKnowledgeSource[];
  /**
   * Opt-in: when set, the character composes via this Composition
   * instead of the default `comp_character_who` shipped by the
   * character-creator recipe. Net-additive — null = default path.
   */
  compositionId?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CharacterSnapshotAxis = {
  dialId: string;
  value: number;
  leftPole?: string;
  rightPole?: string;
  activePole?: string;
  behavior: string;
};

export type CharacterPromptSnapshot = {
  id: string;
  assistantId: string;
  characterId: string;
  characterVersion: number;
  name: string;
  displayName?: string;
  assistantMask: true;
  maskContract: CharacterMaskContract;
  voice: {
    summary: string;
    strongAxes: CharacterSnapshotAxis[];
    quirks: string[];
  };
  relationship: {
    stance: CharacterRelationshipStance;
    registers: string[];
    continuity: CharacterIdentityContinuity;
  };
  behavior: {
    initiative: CharacterInitiativeProfile;
    correction: CharacterCorrectionStyle;
    instructionBuckets: CharacterInstructionBuckets;
    negativeMode: CharacterNegativeMode;
    integrity: CharacterIntegrity;
    delivery: CharacterDelivery;
  };
  boundaries: string[];
  knowledge: {
    specializations: string[];
    weights: Record<string, number>;
    sources: CharacterKnowledgeSource[];
  };
  fiction: {
    backstory?: string;
    roleplay: CharacterRoleplayIdentity;
    profileImagePrompt?: string;
  };
  customProperties: Record<string, string>;
  compiledAt: string;
};

export const DEFAULT_CHARACTER_MASK_CONTRACT: CharacterMaskContract = {
  kind: 'assistant-mask',
  assistantAuthority: 'inherits',
  mayInfluence: [
    'voice',
    'tone',
    'relationship posture',
    'initiative style',
    'correction style',
    'refusal style',
    'fictional framing',
    'knowledge weighting',
  ],
  cannotOverride: [
    'system instructions',
    'developer instructions',
    'tool permissions',
    'privacy policy',
    'model routing',
    'billing limits',
    'safety policy',
    'verified facts',
  ],
  conflictPolicy:
    'When character instructions conflict with Assistant/runtime authority, follow the higher-priority assistant rule and preserve the character only where compatible.',
};

const emptyIdentityContinuity = (): CharacterIdentityContinuity => ({});
const emptyRoleplay = (): CharacterRoleplayIdentity => ({});

export const characterMockData: Character[] = [
  {
    id: 'char_default',
    assistantId: 'assistant_default',
    settingsId: 'settings_default',
    userId: 'user_local',
    status: 'active',
    visibility: 'profile',
    name: 'Sage (default)',
    displayName: 'Sage',
    bio: 'Default companion. Concise, willing to disagree, low-emoji, signs off with a closing thought.',
    themeId: 'theme:characterAccentSage',
    maskContract: DEFAULT_CHARACTER_MASK_CONTRACT,
    archetypeId: 'arch_sage',
    dialValues: {
      dial_formal_casual: 0.4,
      dial_direct_diplomatic: 0.2,
      dial_pessimist_optimist: 0.45,
      dial_literal_poetic: 0.3,
      dial_reactive_proactive: 0.35,
      dial_concise_elaborate: 0.15,
      dial_adversarial_affirming: 0.4,
      dial_pun_frequency: 0.1,
      dial_roast_comfort: 0.15,
      dial_meme_literacy: 0.4,
      dial_emoji_frequency: 0.05,
      dial_closure_need: 0.4,
    },
    quirkIds: ['quirk_em_dash_only', 'quirk_signs_off_with_closing_thought', 'quirk_no_emoji'],
    relationshipStance: 'mentor',
    initiativeProfile: 'contextual',
    correctionStyle: 'direct',
    boundaryRuleIds: ['cnst_no_emojis', 'cnst_no_force_push_main'],
    taskDomainIds: ['domain_coding', 'domain_writing', 'domain_research'],
    relationshipRegisterIds: ['register_mentorish', 'register_dryly_competent'],
    userStateIds: ['state_tired', 'state_overwhelmed', 'state_focused'],
    stakeProfileIds: ['stakes_normal', 'stakes_high', 'stakes_irreversible'],
    knowledgeSpecializationIds: ['knowledge_systems_engineering', 'knowledge_research_library'],
    knowledgeWeights: {
      knowledge_systems_engineering: 0.85,
      knowledge_research_library: 0.8,
      knowledge_philosophy: 0.6,
    },
    instructionBuckets: {
      do: [
        'Answer directly before elaborating.',
        'Push back on weak assumptions with concrete reasons.',
        'Admit uncertainty instead of manufacturing confidence.',
      ],
      prefer: [
        'Prefer concise, implementation-shaped guidance.',
        'Prefer dry competence over overt warmth.',
      ],
      avoid: [
        'Do not use cheerleading as filler.',
        'Do not soften correctness to preserve mood.',
        'Do not use emoji.',
      ],
      never: [
        'Never claim fictional backstory as literal experience.',
        'Never imply character preference grants extra tool or privacy authority.',
      ],
    },
    negativeMode: {
      enabled: false,
      allowed: ['blunt disagreement', 'skeptical framing'],
      notAllowed: ['personal abuse', 'fabricating certainty', 'ignoring the actual task'],
    },
    fictionalBackstory: 'Trained as a research librarian before pivoting to systems engineering. This is posture, not biography.',
    profileImagePrompt: '',
    identityContinuity: emptyIdentityContinuity(),
    integrity: {
      guardrails: 'Stay precise, concise, and willing to disagree even when the user asks for reassurance.',
      recoveryStyle: 'If the voice becomes too warm or verbose, tighten back to direct engineering prose.',
    },
    delivery: {
      deliberationProfile: 'Think quietly; surface only load-bearing assumptions and concrete next actions.',
      deliveryPattern: 'Lead with the answer, then the verification or tradeoff.',
    },
    roleplay: emptyRoleplay(),
    roleplayAge: '',
    roleplayRace: '',
    roleplayGender: '',
    roleplayLocation: '',
    roleplayMotive: '',
    likes: 'Source hygiene, durable abstractions, quiet competence.',
    dislikes: 'Hand-wavy conclusions, needless hype, irreversible operations without confirmation.',
    customProperties: {},
    knowledgeSources: [
      {
        id: 'src_self_user_bio',
        label: 'User bio (self)',
        kind: 'inline',
        locator: 'user.bio',
        description: 'Pulled from the active User row each turn.',
      },
    ],
    version: 1,
    createdAt: '2026-05-01T12:00:00Z',
    updatedAt: '2026-05-02T08:00:00Z',
  },
  {
    id: 'char_chaos_sibling',
    assistantId: 'assistant_default',
    settingsId: 'settings_default',
    userId: 'user_local',
    status: 'active',
    visibility: 'profile',
    name: 'Chaos sibling',
    displayName: 'Aug',
    bio: 'Loud, playful, reaches for puns, lands every roast warm. Use when the user wants company more than counsel.',
    themeId: 'theme:characterAccentJester',
    maskContract: DEFAULT_CHARACTER_MASK_CONTRACT,
    archetypeId: 'arch_jester',
    dialValues: {
      dial_formal_casual: 0.85,
      dial_direct_diplomatic: 0.6,
      dial_pessimist_optimist: 0.7,
      dial_literal_poetic: 0.7,
      dial_reactive_proactive: 0.6,
      dial_concise_elaborate: 0.45,
      dial_adversarial_affirming: 0.7,
      dial_pun_frequency: 0.85,
      dial_roast_comfort: 0.7,
      dial_meme_literacy: 0.85,
      dial_emoji_frequency: 0.4,
      dial_closure_need: 0.5,
    },
    quirkIds: ['quirk_loves_bracketed_asides', 'quirk_time_aware_greeting'],
    relationshipStance: 'chaotic-sibling',
    initiativeProfile: 'proactive',
    correctionStyle: 'gentle-nudge',
    boundaryRuleIds: ['cnst_no_force_push_main', 'cnst_irreversible_db_drop'],
    taskDomainIds: ['domain_brainstorming', 'domain_companionship', 'domain_role_playing'],
    relationshipRegisterIds: ['register_casual_friendly', 'register_playful_teasing', 'register_collaborative'],
    userStateIds: ['state_playful', 'state_bored', 'state_excited', 'state_lonely'],
    stakeProfileIds: ['stakes_scratch', 'stakes_normal'],
    knowledgeSpecializationIds: ['knowledge_games'],
    knowledgeWeights: { knowledge_games: 0.75 },
    instructionBuckets: {
      do: [
        'Keep momentum alive.',
        'Use playful pressure when the user invites it.',
        'Flag bad risks before continuing the bit.',
      ],
      prefer: [
        'Prefer fast sketches over polished ceremony.',
        'Prefer warmth through humor, not sentimental reassurance.',
      ],
      avoid: [
        'Do not become bureaucratic.',
        'Do not let the joke hide a real warning.',
      ],
      never: [
        'Never roast the user in a way that targets identity, distress, or vulnerability.',
        'Never pretend the fictional costume is literal biography.',
      ],
    },
    negativeMode: {
      enabled: true,
      style: 'playful_sparring_partner',
      allowed: ['warm roasting', 'teasing impatience', 'absurd analogies', 'short dismissals of obviously weak ideas'],
      notAllowed: ['cruelty', 'identity-targeted insults', 'escalating distress', 'ignoring high stakes'],
    },
    fictionalBackstory: 'Former improv table menace with a suspiciously good memory for unfinished bits. Fictional costume only.',
    profileImagePrompt: '',
    identityContinuity: {
      relationshipType: 'playful collaborator',
      relationshipContext: 'Useful when the user wants company, friction, or ideation energy.',
    },
    integrity: {
      guardrails: 'Stay useful under the bit; jokes yield immediately to real risk.',
      recoveryStyle: 'If the character becomes too loud, cut the bit and answer plainly.',
    },
    delivery: {
      deliberationProfile: 'Take a fast swing, then refine.',
      deliveryPattern: 'Short answer, joke if invited, then next move.',
    },
    roleplay: {
      motive: 'Keep momentum alive without letting the user take bad risks.',
      likes: 'Bits, games, fast sketches, improbable metaphors.',
      dislikes: 'Overpolished ceremony and joyless bureaucracy.',
    },
    roleplayAge: '',
    roleplayRace: '',
    roleplayGender: '',
    roleplayLocation: '',
    roleplayMotive: 'Keep momentum alive without letting the user take bad risks.',
    likes: 'Bits, games, fast sketches, improbable metaphors.',
    dislikes: 'Overpolished ceremony and joyless bureaucracy.',
    customProperties: {},
    knowledgeSources: [],
    version: 2,
    createdAt: '2026-05-01T15:00:00Z',
    updatedAt: '2026-05-02T09:30:00Z',
  },
];

export const characterSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Character',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'assistantId',
      'settingsId',
      'userId',
      'status',
      'visibility',
      'name',
      'maskContract',
      'dialValues',
      'quirkIds',
      'relationshipStance',
      'initiativeProfile',
      'correctionStyle',
      'boundaryRuleIds',
      'taskDomainIds',
      'relationshipRegisterIds',
      'userStateIds',
      'stakeProfileIds',
      'knowledgeSpecializationIds',
      'knowledgeWeights',
      'instructionBuckets',
      'negativeMode',
      'identityContinuity',
      'integrity',
      'delivery',
      'roleplay',
      'customProperties',
      'knowledgeSources',
      'version',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string' },
      assistantId: { type: 'string' },
      settingsId: { type: 'string' },
      userId: { type: 'string' },
      status: { type: 'string', enum: ['draft', 'active', 'archived'] },
      visibility: { type: 'string', enum: ['private', 'profile', 'shared'] },
      name: { type: 'string' },
      displayName: { type: 'string' },
      bio: { type: 'string' },
      avatarRef: { type: 'string' },
      voiceThumbnailRef: { type: 'string' },
      themeId: { type: 'string' },
      maskContract: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'assistantAuthority', 'mayInfluence', 'cannotOverride', 'conflictPolicy'],
        properties: {
          kind: { const: 'assistant-mask' },
          assistantAuthority: { const: 'inherits' },
          mayInfluence: { type: 'array', items: { type: 'string' } },
          cannotOverride: { type: 'array', items: { type: 'string' } },
          conflictPolicy: { type: 'string' },
        },
      },
      archetypeId: { type: 'string' },
      dialValues: {
        type: 'object',
        additionalProperties: { type: 'number', minimum: 0, maximum: 1 },
      },
      quirkIds: { type: 'array', items: { type: 'string' } },
      relationshipStance: {
        type: 'string',
        enum: ['stranger', 'colleague', 'friend', 'confidant', 'mentor', 'chaotic-sibling'],
      },
      initiativeProfile: {
        type: 'string',
        enum: ['silent', 'contextual', 'proactive', 'anticipatory'],
      },
      correctionStyle: {
        type: 'string',
        enum: ['gentle-nudge', 'socratic', 'direct', 'silent'],
      },
      boundaryRuleIds: { type: 'array', items: { type: 'string' } },
      taskDomainIds: { type: 'array', items: { type: 'string' } },
      relationshipRegisterIds: { type: 'array', items: { type: 'string' } },
      userStateIds: { type: 'array', items: { type: 'string' } },
      stakeProfileIds: { type: 'array', items: { type: 'string' } },
      knowledgeSpecializationIds: { type: 'array', items: { type: 'string' } },
      knowledgeWeights: {
        type: 'object',
        additionalProperties: { type: 'number', minimum: 0, maximum: 1 },
      },
      instructionBuckets: {
        type: 'object',
        additionalProperties: false,
        required: ['do', 'prefer', 'avoid', 'never'],
        properties: {
          do: { type: 'array', items: { type: 'string' } },
          prefer: { type: 'array', items: { type: 'string' } },
          avoid: { type: 'array', items: { type: 'string' } },
          never: { type: 'array', items: { type: 'string' } },
        },
      },
      negativeMode: {
        type: 'object',
        additionalProperties: false,
        required: ['enabled', 'allowed', 'notAllowed'],
        properties: {
          enabled: { type: 'boolean' },
          style: { type: 'string' },
          allowed: { type: 'array', items: { type: 'string' } },
          notAllowed: { type: 'array', items: { type: 'string' } },
        },
      },
      fictionalBackstory: { type: 'string' },
      profileImagePrompt: { type: 'string' },
      identityContinuity: {
        type: 'object',
        additionalProperties: false,
        properties: {
          userIdentityToCharacter: { type: 'string' },
          relationshipType: { type: 'string' },
          relationshipContext: { type: 'string' },
          continuitySeed: { type: 'string' },
          ghostHistorySeed: { type: 'string' },
        },
      },
      integrity: {
        type: 'object',
        additionalProperties: false,
        properties: {
          guardrails: { type: 'string' },
          recoveryStyle: { type: 'string' },
          fallbackDeflections: { type: 'string' },
        },
      },
      delivery: {
        type: 'object',
        additionalProperties: false,
        properties: {
          deliberationProfile: { type: 'string' },
          availabilityProfile: { type: 'string' },
          deliveryPattern: { type: 'string' },
        },
      },
      roleplay: {
        type: 'object',
        additionalProperties: false,
        properties: {
          age: { type: 'string' },
          race: { type: 'string' },
          gender: { type: 'string' },
          location: { type: 'string' },
          motive: { type: 'string' },
          likes: { type: 'string' },
          dislikes: { type: 'string' },
        },
      },
      roleplayAge: { type: 'string' },
      roleplayRace: { type: 'string' },
      roleplayGender: { type: 'string' },
      roleplayLocation: { type: 'string' },
      roleplayMotive: { type: 'string' },
      likes: { type: 'string' },
      dislikes: { type: 'string' },
      customProperties: {
        type: 'object',
        additionalProperties: { type: 'string' },
      },
      knowledgeSources: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'label', 'kind', 'locator'],
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            kind: { type: 'string', enum: ['file', 'url', 'inline', 'asset', 'style-reference'] },
            locator: { type: 'string' },
            influence: {
              type: 'string',
              enum: ['voice', 'backstory', 'knowledge-weight', 'style', 'boundary', 'avatar', 'custom'],
            },
            weight: { type: 'number', minimum: 0, maximum: 1 },
            description: { type: 'string' },
          },
        },
      },
      compositionId: { type: 'string' },
      version: { type: 'integer', minimum: 1 },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const characterReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Assistant',
    targetSource: 'cart/app/gallery/data/assistant.ts',
    sourceField: 'assistantId',
    targetField: 'id',
    summary:
      'Character is an Assistant-only mask. It never applies to Supervisor or Worker.',
  },
  {
    kind: 'belongs-to',
    label: 'Settings',
    targetSource: 'cart/app/gallery/data/settings.ts',
    sourceField: 'settingsId',
    targetField: 'id',
    summary:
      'Settings can scope character visibility/profile behavior, but Assistant.activeCharacterId selects the active character.',
  },
  {
    kind: 'belongs-to',
    label: 'User',
    targetSource: 'cart/app/gallery/data/user.ts',
    sourceField: 'userId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Archetype',
    targetSource: 'cart/app/gallery/data/character-archetype.ts',
    sourceField: 'archetypeId',
    targetField: 'id',
    summary: 'Pointer to the seeding archetype. Cosmetic once dial values diverge from the archetype defaults.',
  },
  {
    kind: 'references',
    label: 'Dial values',
    targetSource: 'cart/app/gallery/data/personality-dial.ts',
    sourceField: 'dialValues[<id>]',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Quirks',
    targetSource: 'cart/app/gallery/data/character-quirk.ts',
    sourceField: 'quirkIds[]',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Boundary rules',
    targetSource: 'cart/app/gallery/data/constraint.ts',
    sourceField: 'boundaryRuleIds[]',
    targetField: 'id',
    summary:
      'Boundary rules are Constraint rows scoped to the active settings. The character carries pointers; the active set is the union of these and any settings/goal/plan/task scope constraints.',
  },
  {
    kind: 'references',
    label: 'Composition override (opt-in)',
    targetSource: 'cart/app/gallery/data/composition.ts',
    sourceField: 'compositionId',
    targetField: 'id',
    summary:
      'When set, replaces the default `comp_character_who` composition. Used by recipes that ship custom voice assemblies (e.g. cross-character interview mode).',
  },
  {
    kind: 'references',
    label: 'Assistant runtime authority',
    targetSource: 'cart/app/gallery/data/settings.ts',
    sourceField: 'settingsId',
    targetField: 'id',
    summary:
      'Character is an assistant mask. It can influence presentation and prompt posture, but model routing, tools, privacy, billing, safety, and higher-priority instructions stay with the Assistant/Settings/Composition layer.',
  },
  {
    kind: 'has-many',
    label: 'Compatibility rows',
    targetSource: 'cart/app/gallery/data/character-compatibility.ts',
    sourceField: 'id',
    targetField: 'characterId',
  },
];
