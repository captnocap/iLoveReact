// Character creator — local state provider.
//
// Mirrors `cart/app/onboarding/state.jsx`: one useCRUD per collection
// in the same `app` namespace, in-memory optimistic cache, write-through
// on every setter. Exposes `useCharacter()` to the form page.

import { createContext, useContext, useEffect, useState } from 'react';
import { useCRUD } from '../db';
import type { ReactNode } from 'react';
import {
  ARCHETYPES,
  DIALS,
  KNOWLEDGE_SPECIALIZATIONS,
  defaultDialValues,
  type ArchetypeId,
  type CorrectionStyle,
  type InitiativeProfile,
  type RelationshipStance,
} from './catalog';

const NS = 'app';
const CHARACTER_ID = 'char_default';
const ASSISTANT_ID = 'assistant_default';
const SETTINGS_ID = 'settings_default';
const USER_ID = 'user_local';

// useCRUD's Schema<T> contract calls .parse(value); we lean on the
// writer side to keep the shape correct.
const passthrough = { parse: (v: any) => v };

function nowIso() {
  return new Date().toISOString();
}

type CharacterInstructionBuckets = {
  do: string[];
  prefer: string[];
  avoid: string[];
  never: string[];
};

type CharacterNegativeMode = {
  enabled: boolean;
  style?: string;
  allowed: string[];
  notAllowed: string[];
};

type CharacterMaskContract = {
  kind: 'assistant-mask';
  assistantAuthority: 'inherits';
  mayInfluence: string[];
  cannotOverride: string[];
  conflictPolicy: string;
};

type CharacterIdentityContinuity = {
  userIdentityToCharacter?: string;
  relationshipType?: string;
  relationshipContext?: string;
  continuitySeed?: string;
  ghostHistorySeed?: string;
};

type CharacterIntegrity = {
  guardrails?: string;
  recoveryStyle?: string;
  fallbackDeflections?: string;
};

type CharacterDelivery = {
  deliberationProfile?: string;
  availabilityProfile?: string;
  deliveryPattern?: string;
};

type CharacterRoleplayIdentity = {
  age?: string;
  race?: string;
  gender?: string;
  location?: string;
  motive?: string;
  likes?: string;
  dislikes?: string;
};

export type CharacterKnowledgeSourceKind =
  | 'file'
  | 'url'
  | 'inline'
  | 'asset'
  | 'style-reference';

export type CharacterKnowledgeSourceInfluence =
  | 'voice'
  | 'backstory'
  | 'knowledge-weight'
  | 'style'
  | 'boundary'
  | 'avatar'
  | 'custom';

export type CharacterKnowledgeSource = {
  id: string;
  label: string;
  kind: CharacterKnowledgeSourceKind;
  locator: string;
  influence?: CharacterKnowledgeSourceInfluence;
  weight?: number;
  description?: string;
};

export type CharacterRow = {
  id: string;
  assistantId: string;
  settingsId: string;
  userId: string;
  status: 'draft' | 'active' | 'archived';
  visibility: 'private' | 'profile' | 'shared';
  name: string;
  displayName?: string;
  bio?: string;
  /** Avatar asset — image URL, file path, or asset id. The pipeline is TBD. */
  avatarRef?: string;
  /** Short audio sample reference — same shape as avatarRef. */
  voiceThumbnailRef?: string;
  /** Gallery theme id (`theme:NAME`) whose tokens drive UI accent / chrome
   *  when this character is selected. Never a hex literal — always a theme
   *  reference per the no-color-drift rule. */
  themeId?: string;
  maskContract: CharacterMaskContract;
  archetypeId?: ArchetypeId;
  dialValues: Record<string, number>;
  quirkIds: string[];
  relationshipStance: RelationshipStance;
  initiativeProfile: InitiativeProfile;
  correctionStyle: CorrectionStyle;
  boundaryRuleIds: string[];
  taskDomainIds: string[];
  relationshipRegisterIds: string[];
  userStateIds: string[];
  stakeProfileIds: string[];
  knowledgeSpecializationIds: string[];
  knowledgeWeights: Record<string, number>;
  instructionBuckets: CharacterInstructionBuckets;
  negativeMode: CharacterNegativeMode;
  fictionalBackstory: string;
  profileImagePrompt: string;
  identityContinuity: CharacterIdentityContinuity;
  integrity: CharacterIntegrity;
  delivery: CharacterDelivery;
  roleplay: CharacterRoleplayIdentity;
  userIdentityToCharacter: string;
  relationshipType: string;
  relationshipContext: string;
  continuitySeed: string;
  ghostHistorySeed: string;
  identityGuardrails: string;
  identityRecoveryStyle: string;
  fallbackDeflections: string;
  deliberationProfile: string;
  availabilityProfile: string;
  deliveryPattern: string;
  roleplayAge: string;
  roleplayRace: string;
  roleplayGender: string;
  roleplayLocation: string;
  roleplayMotive: string;
  likes: string;
  dislikes: string;
  customProperties: Record<string, string>;
  /** File / url / inline / asset / style-reference items the character
   *  treats as canon. Composer slots them via src_character-snapshot. */
  knowledgeSources: CharacterKnowledgeSource[];
  /** Opt-in: when set, the assembler builds the character's prompt via
   *  this Composition instead of the default `comp_character_who`.
   *  Net-additive — null means default path. */
  compositionId?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

function defaultKnowledgeWeights(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of KNOWLEDGE_SPECIALIZATIONS) out[k.id] = 0.5;
  return out;
}

function defaultMaskContract(): CharacterMaskContract {
  return {
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
}

function defaultCharacterRow(): CharacterRow {
  const now = nowIso();
  return {
    id: CHARACTER_ID,
    assistantId: ASSISTANT_ID,
    settingsId: SETTINGS_ID,
    userId: USER_ID,
    status: 'active',
    visibility: 'profile',
    name: 'Sage',
    displayName: 'Sage',
    bio: '',
    maskContract: defaultMaskContract(),
    archetypeId: 'arch_sage',
    dialValues: defaultDialValues(),
    quirkIds: [],
    relationshipStance: 'mentor',
    initiativeProfile: 'contextual',
    correctionStyle: 'direct',
    boundaryRuleIds: [],
    taskDomainIds: ['domain_coding', 'domain_writing', 'domain_research'],
    relationshipRegisterIds: ['register_mentorish', 'register_dryly_competent'],
    userStateIds: ['state_tired', 'state_overwhelmed', 'state_focused'],
    stakeProfileIds: ['stakes_normal', 'stakes_high', 'stakes_irreversible'],
    knowledgeSpecializationIds: ['knowledge_systems_engineering', 'knowledge_research_library'],
    knowledgeWeights: defaultKnowledgeWeights(),
    instructionBuckets: {
      do: ['Answer directly before elaborating.'],
      prefer: ['Prefer concise, implementation-shaped guidance.'],
      avoid: ['Do not use cheerleading as filler.', 'Do not use emoji.'],
      never: ['Never claim fictional backstory as literal experience.'],
    },
    negativeMode: {
      enabled: false,
      allowed: ['blunt disagreement', 'skeptical framing'],
      notAllowed: ['personal abuse', 'fabricating certainty', 'ignoring the actual task'],
    },
    fictionalBackstory: 'Trained as a research librarian before pivoting to systems engineering. This is posture, not biography.',
    profileImagePrompt: '',
    identityContinuity: {},
    integrity: {},
    delivery: {},
    roleplay: {},
    userIdentityToCharacter: '',
    relationshipType: '',
    relationshipContext: '',
    continuitySeed: '',
    ghostHistorySeed: '',
    identityGuardrails: '',
    identityRecoveryStyle: '',
    fallbackDeflections: '',
    deliberationProfile: '',
    availabilityProfile: '',
    deliveryPattern: '',
    roleplayAge: '',
    roleplayRace: '',
    roleplayGender: '',
    roleplayLocation: '',
    roleplayMotive: '',
    likes: '',
    dislikes: '',
    customProperties: {},
    knowledgeSources: [],
    avatarRef: undefined,
    voiceThumbnailRef: undefined,
    themeId: undefined,
    compositionId: undefined,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function freshSourceId(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 6);
  return `src_${t}_${r}`;
}

function normalizeCharacterRow(existing: any): CharacterRow {
  const def = defaultCharacterRow();
  const merged: CharacterRow = {
    ...def,
    ...(existing || {}),
    maskContract: { ...def.maskContract, ...((existing && existing.maskContract) || {}) },
    instructionBuckets: { ...def.instructionBuckets, ...((existing && existing.instructionBuckets) || {}) },
    negativeMode: { ...def.negativeMode, ...((existing && existing.negativeMode) || {}) },
    identityContinuity: { ...def.identityContinuity, ...((existing && existing.identityContinuity) || {}) },
    integrity: { ...def.integrity, ...((existing && existing.integrity) || {}) },
    delivery: { ...def.delivery, ...((existing && existing.delivery) || {}) },
    roleplay: { ...def.roleplay, ...((existing && existing.roleplay) || {}) },
    knowledgeSources: Array.isArray(existing?.knowledgeSources) ? existing.knowledgeSources : [],
  };
  return {
    ...merged,
    identityContinuity: {
      ...merged.identityContinuity,
      userIdentityToCharacter: merged.userIdentityToCharacter || merged.identityContinuity.userIdentityToCharacter,
      relationshipType: merged.relationshipType || merged.identityContinuity.relationshipType,
      relationshipContext: merged.relationshipContext || merged.identityContinuity.relationshipContext,
      continuitySeed: merged.continuitySeed || merged.identityContinuity.continuitySeed,
      ghostHistorySeed: merged.ghostHistorySeed || merged.identityContinuity.ghostHistorySeed,
    },
    integrity: {
      ...merged.integrity,
      guardrails: merged.identityGuardrails || merged.integrity.guardrails,
      recoveryStyle: merged.identityRecoveryStyle || merged.integrity.recoveryStyle,
      fallbackDeflections: merged.fallbackDeflections || merged.integrity.fallbackDeflections,
    },
    delivery: {
      ...merged.delivery,
      deliberationProfile: merged.deliberationProfile || merged.delivery.deliberationProfile,
      availabilityProfile: merged.availabilityProfile || merged.delivery.availabilityProfile,
      deliveryPattern: merged.deliveryPattern || merged.delivery.deliveryPattern,
    },
    roleplay: {
      ...merged.roleplay,
      age: merged.roleplayAge || merged.roleplay.age,
      race: merged.roleplayRace || merged.roleplay.race,
      gender: merged.roleplayGender || merged.roleplay.gender,
      location: merged.roleplayLocation || merged.roleplay.location,
      motive: merged.roleplayMotive || merged.roleplay.motive,
      likes: merged.likes || merged.roleplay.likes,
      dislikes: merged.dislikes || merged.roleplay.dislikes,
    },
  };
}

export type CharacterContextValue = {
  loading: boolean;
  character: CharacterRow;
  setName: (next: string) => Promise<void>;
  setDisplayName: (next: string) => Promise<void>;
  setBio: (next: string) => Promise<void>;
  setArchetype: (id: ArchetypeId) => Promise<void>;
  setDialValue: (dialId: string, value: number) => Promise<void>;
  toggleQuirk: (quirkId: string) => Promise<void>;
  setRelationshipStance: (s: RelationshipStance) => Promise<void>;
  setInitiativeProfile: (p: InitiativeProfile) => Promise<void>;
  setCorrectionStyle: (c: CorrectionStyle) => Promise<void>;
  toggleBoundaryRule: (ruleId: string) => Promise<void>;
  toggleTaskDomain: (id: string) => Promise<void>;
  toggleRelationshipRegister: (id: string) => Promise<void>;
  toggleUserState: (id: string) => Promise<void>;
  toggleStakeProfile: (id: string) => Promise<void>;
  toggleKnowledgeSpecialization: (id: string) => Promise<void>;
  setKnowledgeWeight: (id: string, value: number) => Promise<void>;
  setFictionalBackstory: (next: string) => Promise<void>;
  setProfileImagePrompt: (next: string) => Promise<void>;
  setUserIdentityToCharacter: (next: string) => Promise<void>;
  setRelationshipType: (next: string) => Promise<void>;
  setRelationshipContext: (next: string) => Promise<void>;
  setContinuitySeed: (next: string) => Promise<void>;
  setGhostHistorySeed: (next: string) => Promise<void>;
  setIdentityGuardrails: (next: string) => Promise<void>;
  setIdentityRecoveryStyle: (next: string) => Promise<void>;
  setFallbackDeflections: (next: string) => Promise<void>;
  setDeliberationProfile: (next: string) => Promise<void>;
  setAvailabilityProfile: (next: string) => Promise<void>;
  setDeliveryPattern: (next: string) => Promise<void>;
  setRoleplayAge: (next: string) => Promise<void>;
  setRoleplayRace: (next: string) => Promise<void>;
  setRoleplayGender: (next: string) => Promise<void>;
  setRoleplayLocation: (next: string) => Promise<void>;
  setRoleplayMotive: (next: string) => Promise<void>;
  setLikes: (next: string) => Promise<void>;
  setDislikes: (next: string) => Promise<void>;
  setCustomProperty: (key: string, value: string) => Promise<void>;
  removeCustomProperty: (key: string) => Promise<void>;
  setAvatarRef: (next: string) => Promise<void>;
  setVoiceThumbnailRef: (next: string) => Promise<void>;
  setThemeId: (next: string) => Promise<void>;
  setCompositionId: (next: string) => Promise<void>;
  addKnowledgeSource: (src?: Partial<CharacterKnowledgeSource>) => Promise<string>;
  updateKnowledgeSource: (id: string, partial: Partial<CharacterKnowledgeSource>) => Promise<void>;
  removeKnowledgeSource: (id: string) => Promise<void>;
  save: () => Promise<void>;
};

const Ctx = createContext<CharacterContextValue>({
  loading: true,
  character: defaultCharacterRow(),
  setName: async () => {},
  setDisplayName: async () => {},
  setBio: async () => {},
  setArchetype: async () => {},
  setDialValue: async () => {},
  toggleQuirk: async () => {},
  setRelationshipStance: async () => {},
  setInitiativeProfile: async () => {},
  setCorrectionStyle: async () => {},
  toggleBoundaryRule: async () => {},
  toggleTaskDomain: async () => {},
  toggleRelationshipRegister: async () => {},
  toggleUserState: async () => {},
  toggleStakeProfile: async () => {},
  toggleKnowledgeSpecialization: async () => {},
  setKnowledgeWeight: async () => {},
  setFictionalBackstory: async () => {},
  setProfileImagePrompt: async () => {},
  setUserIdentityToCharacter: async () => {},
  setRelationshipType: async () => {},
  setRelationshipContext: async () => {},
  setContinuitySeed: async () => {},
  setGhostHistorySeed: async () => {},
  setIdentityGuardrails: async () => {},
  setIdentityRecoveryStyle: async () => {},
  setFallbackDeflections: async () => {},
  setDeliberationProfile: async () => {},
  setAvailabilityProfile: async () => {},
  setDeliveryPattern: async () => {},
  setRoleplayAge: async () => {},
  setRoleplayRace: async () => {},
  setRoleplayGender: async () => {},
  setRoleplayLocation: async () => {},
  setRoleplayMotive: async () => {},
  setLikes: async () => {},
  setDislikes: async () => {},
  setCustomProperty: async () => {},
  removeCustomProperty: async () => {},
  setAvatarRef: async () => {},
  setVoiceThumbnailRef: async () => {},
  setThemeId: async () => {},
  setCompositionId: async () => {},
  addKnowledgeSource: async () => '',
  updateKnowledgeSource: async () => {},
  removeKnowledgeSource: async () => {},
  save: async () => {},
});

export function CharacterProvider({ children }: { children: ReactNode }) {
  const characterStore = useCRUD('character', passthrough, { namespace: NS });

  const [loading, setLoading] = useState(true);
  const [character, setCharacter] = useState<CharacterRow>(defaultCharacterRow);

  // ── Bootstrap ───────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const existing = await characterStore.get(CHARACTER_ID);
        if (cancelled) return;
        if (existing) {
          // Backfill any missing dial values from the catalog defaults so
          // a row written before a new dial was added still works.
          const dv = { ...defaultDialValues(), ...(existing.dialValues || {}) };
          const kw = { ...defaultKnowledgeWeights(), ...(existing.knowledgeWeights || {}) };
          setCharacter(normalizeCharacterRow({ ...existing, dialValues: dv, knowledgeWeights: kw }));
        }
      } catch (e: any) {
        console.log('[character] bootstrap failed: ' + (e?.message ?? String(e)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Helpers ─────────────────────────────────────────────────────────
  const persist = async (next: CharacterRow) => {
    try {
      const existing = await characterStore.get(CHARACTER_ID);
      if (existing) await characterStore.update(CHARACTER_ID, next);
      else await characterStore.create(next);
    } catch (e: any) {
      console.log('[character] persist failed: ' + (e?.message ?? String(e)));
    }
  };

  const patch = async (partial: Partial<CharacterRow>) => {
    const next: CharacterRow = { ...character, ...partial, updatedAt: nowIso() };
    setCharacter(next);
    await persist(next);
  };

  const setName = (next: string) => patch({ name: next });
  const setDisplayName = (next: string) => patch({ displayName: next });
  const setBio = (next: string) => patch({ bio: next });

  const setArchetype = async (id: ArchetypeId) => {
    const arch = ARCHETYPES.find((a) => a.id === id);
    if (!arch) return;
    // Seed dials + quirks + stances from the archetype defaults. Once the
    // user touches anything afterwards the archetypeId pointer is purely
    // cosmetic.
    await patch({
      archetypeId: id,
      dialValues: { ...defaultDialValues(), ...arch.defaultDialValues },
      quirkIds: [...arch.defaultQuirkIds],
      relationshipStance: arch.defaultStance,
      initiativeProfile: arch.defaultInitiative,
      correctionStyle: arch.defaultCorrection,
    });
  };

  const setDialValue = (dialId: string, value: number) => {
    const clamped = Math.max(0, Math.min(1, value));
    const next: Record<string, number> = { ...character.dialValues, [dialId]: clamped };
    return patch({ dialValues: next });
  };

  const toggleQuirk = (quirkId: string) => {
    const has = character.quirkIds.includes(quirkId);
    const next = has ? character.quirkIds.filter((id) => id !== quirkId) : [...character.quirkIds, quirkId];
    return patch({ quirkIds: next });
  };

  const setRelationshipStance = (s: RelationshipStance) => patch({ relationshipStance: s });
  const setInitiativeProfile = (p: InitiativeProfile) => patch({ initiativeProfile: p });
  const setCorrectionStyle = (c: CorrectionStyle) => patch({ correctionStyle: c });

  const toggleBoundaryRule = (ruleId: string) => {
    const has = character.boundaryRuleIds.includes(ruleId);
    const next = has
      ? character.boundaryRuleIds.filter((id) => id !== ruleId)
      : [...character.boundaryRuleIds, ruleId];
    return patch({ boundaryRuleIds: next });
  };

  const toggleId = (field: keyof CharacterRow, id: string) => {
    const cur = Array.isArray(character[field]) ? (character[field] as string[]) : [];
    const next = cur.includes(id) ? cur.filter((v) => v !== id) : [...cur, id];
    return patch({ [field]: next } as Partial<CharacterRow>);
  };

  const toggleTaskDomain = (id: string) => toggleId('taskDomainIds', id);
  const toggleRelationshipRegister = (id: string) => toggleId('relationshipRegisterIds', id);
  const toggleUserState = (id: string) => toggleId('userStateIds', id);
  const toggleStakeProfile = (id: string) => toggleId('stakeProfileIds', id);
  const toggleKnowledgeSpecialization = (id: string) => toggleId('knowledgeSpecializationIds', id);

  const setKnowledgeWeight = (id: string, value: number) => {
    const clamped = Math.max(0, Math.min(1, value));
    return patch({ knowledgeWeights: { ...character.knowledgeWeights, [id]: clamped } });
  };

  const setFictionalBackstory = (next: string) => patch({ fictionalBackstory: next });
  const setProfileImagePrompt = (next: string) => patch({ profileImagePrompt: next });
  const setUserIdentityToCharacter = (next: string) => patch({
    userIdentityToCharacter: next,
    identityContinuity: { ...character.identityContinuity, userIdentityToCharacter: next },
  });
  const setRelationshipType = (next: string) => patch({
    relationshipType: next,
    identityContinuity: { ...character.identityContinuity, relationshipType: next },
  });
  const setRelationshipContext = (next: string) => patch({
    relationshipContext: next,
    identityContinuity: { ...character.identityContinuity, relationshipContext: next },
  });
  const setContinuitySeed = (next: string) => patch({
    continuitySeed: next,
    identityContinuity: { ...character.identityContinuity, continuitySeed: next },
  });
  const setGhostHistorySeed = (next: string) => patch({
    ghostHistorySeed: next,
    identityContinuity: { ...character.identityContinuity, ghostHistorySeed: next },
  });
  const setIdentityGuardrails = (next: string) => patch({
    identityGuardrails: next,
    integrity: { ...character.integrity, guardrails: next },
  });
  const setIdentityRecoveryStyle = (next: string) => patch({
    identityRecoveryStyle: next,
    integrity: { ...character.integrity, recoveryStyle: next },
  });
  const setFallbackDeflections = (next: string) => patch({
    fallbackDeflections: next,
    integrity: { ...character.integrity, fallbackDeflections: next },
  });
  const setDeliberationProfile = (next: string) => patch({
    deliberationProfile: next,
    delivery: { ...character.delivery, deliberationProfile: next },
  });
  const setAvailabilityProfile = (next: string) => patch({
    availabilityProfile: next,
    delivery: { ...character.delivery, availabilityProfile: next },
  });
  const setDeliveryPattern = (next: string) => patch({
    deliveryPattern: next,
    delivery: { ...character.delivery, deliveryPattern: next },
  });
  const setRoleplayAge = (next: string) => patch({ roleplayAge: next, roleplay: { ...character.roleplay, age: next } });
  const setRoleplayRace = (next: string) => patch({ roleplayRace: next, roleplay: { ...character.roleplay, race: next } });
  const setRoleplayGender = (next: string) => patch({ roleplayGender: next, roleplay: { ...character.roleplay, gender: next } });
  const setRoleplayLocation = (next: string) => patch({ roleplayLocation: next, roleplay: { ...character.roleplay, location: next } });
  const setRoleplayMotive = (next: string) => patch({ roleplayMotive: next, roleplay: { ...character.roleplay, motive: next } });
  const setLikes = (next: string) => patch({ likes: next, roleplay: { ...character.roleplay, likes: next } });
  const setDislikes = (next: string) => patch({ dislikes: next, roleplay: { ...character.roleplay, dislikes: next } });

  const setCustomProperty = (key: string, value: string) => {
    const k = key.trim();
    if (!k) return Promise.resolve();
    return patch({ customProperties: { ...character.customProperties, [k]: value } });
  };

  const removeCustomProperty = (key: string) => {
    const next = { ...character.customProperties };
    delete next[key];
    return patch({ customProperties: next });
  };

  const setAvatarRef = (next: string) => patch({ avatarRef: next || undefined });
  const setVoiceThumbnailRef = (next: string) => patch({ voiceThumbnailRef: next || undefined });
  const setThemeId = (next: string) => patch({ themeId: next || undefined });
  const setCompositionId = (next: string) => patch({ compositionId: next || undefined });

  const addKnowledgeSource = async (src?: Partial<CharacterKnowledgeSource>): Promise<string> => {
    const id = src?.id ?? freshSourceId();
    const fresh: CharacterKnowledgeSource = {
      id,
      label: src?.label ?? '',
      kind: src?.kind ?? 'inline',
      locator: src?.locator ?? '',
      influence: src?.influence,
      weight: src?.weight,
      description: src?.description,
    };
    await patch({ knowledgeSources: [...character.knowledgeSources, fresh] });
    return id;
  };

  const updateKnowledgeSource = (id: string, partial: Partial<CharacterKnowledgeSource>) => {
    const next = character.knowledgeSources.map((s) =>
      s.id === id ? { ...s, ...partial, id: s.id } : s,
    );
    return patch({ knowledgeSources: next });
  };

  const removeKnowledgeSource = (id: string) => {
    const next = character.knowledgeSources.filter((s) => s.id !== id);
    return patch({ knowledgeSources: next });
  };

  const save = async () => {
    const next: CharacterRow = { ...character, version: character.version + 1, updatedAt: nowIso() };
    setCharacter(next);
    await persist(next);
    // Suppress dial drift
    void DIALS;
  };

  const value: CharacterContextValue = {
    loading,
    character,
    setName,
    setDisplayName,
    setBio,
    setArchetype,
    setDialValue,
    toggleQuirk,
    setRelationshipStance,
    setInitiativeProfile,
    setCorrectionStyle,
    toggleBoundaryRule,
    toggleTaskDomain,
    toggleRelationshipRegister,
    toggleUserState,
    toggleStakeProfile,
    toggleKnowledgeSpecialization,
    setKnowledgeWeight,
    setFictionalBackstory,
    setProfileImagePrompt,
    setUserIdentityToCharacter,
    setRelationshipType,
    setRelationshipContext,
    setContinuitySeed,
    setGhostHistorySeed,
    setIdentityGuardrails,
    setIdentityRecoveryStyle,
    setFallbackDeflections,
    setDeliberationProfile,
    setAvailabilityProfile,
    setDeliveryPattern,
    setRoleplayAge,
    setRoleplayRace,
    setRoleplayGender,
    setRoleplayLocation,
    setRoleplayMotive,
    setLikes,
    setDislikes,
    setCustomProperty,
    removeCustomProperty,
    setAvatarRef,
    setVoiceThumbnailRef,
    setThemeId,
    setCompositionId,
    addKnowledgeSource,
    updateKnowledgeSource,
    removeKnowledgeSource,
    save,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCharacter(): CharacterContextValue {
  return useContext(Ctx);
}
