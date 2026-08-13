// Pure Agent Seat contract for character-rig authoring. This file deliberately
// owns no host calls: the shell routes a validated action to the resident rig
// session, while automation can reason from the structured status projection.

import type {
  BoneId,
  CharacterRigReadinessCheck,
  CharacterRigReadinessCheckId,
  CharacterRigSnapshot,
  Quat,
  Vec3,
} from '../../../runtime/skeleton';

export type HumanoidSemanticRoleKey =
  | 'pelvis' | 'abdomen' | 'chest' | 'head' | 'neck'
  | 'clavicle:left' | 'clavicle:right'
  | 'upper_arm:left' | 'upper_arm:right'
  | 'lower_arm:left' | 'lower_arm:right'
  | 'hand:left' | 'hand:right'
  | 'fingers:left' | 'fingers:right'
  | 'upper_leg:left' | 'upper_leg:right'
  | 'lower_leg:left' | 'lower_leg:right'
  | 'foot:left' | 'foot:right'
  | 'toes:left' | 'toes:right';

export type CharacterRigSeatAction =
  | { operation: 'attach-humanoid' }
  | {
      operation: 'object-mode';
      id: string;
      mode: 'body' | 'deformable';
    }
  | {
      operation: 'object-mode';
      id: string;
      mode: 'rigid';
      bone: BoneId;
    }
  | { operation: 'select-detached' }
  | { operation: 'role'; role: HumanoidSemanticRoleKey }
  | { operation: 'bone-role'; bone: BoneId; role: HumanoidSemanticRoleKey }
  | { operation: 'coverage' }
  | { operation: 'select-uncovered' }
  | { operation: 'boundary-audit' }
  | { operation: 'fit' }
  | { operation: 'joint'; bone: BoneId; origin: Vec3; frame?: Quat }
  | { operation: 'joint'; bone: BoneId; lock: boolean }
  | { operation: 'mirror-joints'; source: 'left' | 'right' }
  | { operation: 'scale-skeleton'; factor: number }
  | { operation: 'skeleton' }
  | { operation: 'bind' }
  | { operation: 'prune-weights' }
  | { operation: 'save' }
  | { operation: 'probe'; vertex: number }
  | { operation: 'weights-summary'; bone: BoneId }
  | { operation: 'weights-symmetry'; tolerance?: number }
  | {
      operation: 'bend-test';
      test: 'shoulder' | 'elbow' | 'wrist' | 'hip' | 'knee';
      side: 'left' | 'right' | 'both';
    }
  | { operation: 'undo' }
  | { operation: 'redo' };

export type LegacyPropRigSeatOperation = 'read' | 'replace' | 'lights-replace';

/** The legacy branch retains the caller's exact object. Character parsing must
 * not normalize, strip, or reinterpret prop-rig and light payloads. */
export type ParsedCharacterRigSeatAction =
  | { kind: 'character-rig'; action: CharacterRigSeatAction }
  | {
      kind: 'legacy-prop';
      operation: LegacyPropRigSeatOperation;
      args: Record<string, unknown>;
    };

export type CharacterRigSeatActionParse =
  | { ok: true; value: ParsedCharacterRigSeatAction }
  | { ok: false; error: string };

const LEGACY_PROP_OPERATIONS = new Set<LegacyPropRigSeatOperation>([
  'read',
  'replace',
  'lights-replace',
]);

const HUMANOID_ROLE_KEYS = new Set<HumanoidSemanticRoleKey>([
  'pelvis', 'abdomen', 'chest', 'head', 'neck',
  'clavicle:left', 'clavicle:right',
  'upper_arm:left', 'upper_arm:right',
  'lower_arm:left', 'lower_arm:right',
  'hand:left', 'hand:right',
  'fingers:left', 'fingers:right',
  'upper_leg:left', 'upper_leg:right',
  'lower_leg:left', 'lower_leg:right',
  'foot:left', 'foot:right',
  'toes:left', 'toes:right',
]);

const REQUIRED_HUMANOID_ROLE_KEYS: readonly HumanoidSemanticRoleKey[] = [
  'pelvis', 'abdomen', 'chest', 'head',
  'upper_arm:left', 'upper_arm:right',
  'lower_arm:left', 'lower_arm:right',
  'hand:left', 'hand:right',
  'upper_leg:left', 'upper_leg:right',
  'lower_leg:left', 'lower_leg:right',
  'foot:left', 'foot:right',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function exactFields(
  value: Record<string, unknown>,
  operation: string,
  allowed: readonly string[],
): string | null {
  const field = Object.keys(value).find((key) => !allowed.includes(key));
  return field ? `${operation} does not accept field "${field}"` : null;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) return null;
  return value;
}

function finiteTuple(value: unknown, length: 3 | 4): number[] | null {
  if (!Array.isArray(value) || value.length !== length) return null;
  const numbers = value.map((component) => typeof component === 'number' ? component : Number.NaN);
  return numbers.every(Number.isFinite) ? numbers : null;
}

function character(action: CharacterRigSeatAction): CharacterRigSeatActionParse {
  return { ok: true, value: { kind: 'character-rig', action } };
}

function invalid(error: string): CharacterRigSeatActionParse {
  return { ok: false, error };
}

/** Strictly parse the `tools/seat action rig` argument object. Character actions
 * reject every unknown field instead of silently accepting misspellings. The
 * three established prop-rig operations are identified and handed back byte-for-
 * byte at the object level so their existing shell contract remains untouched. */
export function parseCharacterRigSeatAction(args: unknown): CharacterRigSeatActionParse {
  if (!isRecord(args)) return invalid('rig arguments must be an object');
  const operation = args.operation;
  if (typeof operation !== 'string' || operation.length === 0) {
    return invalid('rig operation must be a non-empty string');
  }
  if (LEGACY_PROP_OPERATIONS.has(operation as LegacyPropRigSeatOperation)) {
    return {
      ok: true,
      value: {
        kind: 'legacy-prop',
        operation: operation as LegacyPropRigSeatOperation,
        args,
      },
    };
  }

  const noFields = (): CharacterRigSeatActionParse => {
    const error = exactFields(args, operation, ['operation']);
    return error ? invalid(error) : character({ operation } as CharacterRigSeatAction);
  };

  switch (operation) {
    case 'attach-humanoid':
    case 'select-detached':
    case 'coverage':
    case 'select-uncovered':
    case 'boundary-audit':
    case 'fit':
    case 'skeleton':
    case 'bind':
    case 'prune-weights':
    case 'save':
    case 'undo':
    case 'redo':
      return noFields();

    case 'object-mode': {
      const error = exactFields(args, operation, ['operation', 'id', 'mode', 'bone']);
      if (error) return invalid(error);
      const id = nonEmptyString(args.id);
      if (!id) return invalid('object-mode id must be a non-empty stable object id');
      const mode = args.mode;
      if (mode !== 'body' && mode !== 'deformable' && mode !== 'rigid') {
        return invalid('object-mode mode must be body, deformable, or rigid');
      }
      if (mode === 'rigid') {
        const bone = nonEmptyString(args.bone);
        if (!bone) return invalid('object-mode rigid requires a non-empty bone');
        if (bone === 'root') return invalid('root is unweighted and cannot own a rigid object');
        return character({ operation, id, mode, bone });
      }
      if (hasOwn(args, 'bone')) return invalid(`object-mode ${mode} does not accept a bone`);
      return character({ operation, id, mode });
    }

    case 'role': {
      const error = exactFields(args, operation, ['operation', 'role']);
      if (error) return invalid(error);
      const role = nonEmptyString(args.role);
      if (!role || !HUMANOID_ROLE_KEYS.has(role as HumanoidSemanticRoleKey)) {
        return invalid('role must be a stable humanoid semantic key');
      }
      return character({ operation, role: role as HumanoidSemanticRoleKey });
    }

    case 'bone-role': {
      const error = exactFields(args, operation, ['operation', 'bone', 'role']);
      if (error) return invalid(error);
      const bone = nonEmptyString(args.bone);
      if (!bone) return invalid('bone-role bone must be a non-empty stable bone id');
      const role = nonEmptyString(args.role);
      if (!role || !HUMANOID_ROLE_KEYS.has(role as HumanoidSemanticRoleKey)) {
        return invalid('bone-role role must be a stable humanoid semantic key');
      }
      return character({ operation, bone, role: role as HumanoidSemanticRoleKey });
    }

    case 'joint': {
      const error = exactFields(args, operation, ['operation', 'bone', 'origin', 'frame', 'lock']);
      if (error) return invalid(error);
      const bone = nonEmptyString(args.bone);
      if (!bone) return invalid('joint bone must be a non-empty stable bone id');
      const hasOrigin = hasOwn(args, 'origin');
      const hasLock = hasOwn(args, 'lock');
      if (hasOrigin === hasLock) return invalid('joint requires exactly one of origin or lock');
      if (hasLock) {
        if (hasOwn(args, 'frame')) return invalid('joint frame is valid only with origin');
        if (typeof args.lock !== 'boolean') return invalid('joint lock must be boolean');
        return character({ operation, bone, lock: args.lock });
      }
      const origin = finiteTuple(args.origin, 3);
      if (!origin) return invalid('joint origin must be three finite numbers');
      if (!hasOwn(args, 'frame')) {
        return character({ operation, bone, origin: origin as Vec3 });
      }
      const frame = finiteTuple(args.frame, 4);
      if (!frame) return invalid('joint frame must be four finite xyzw numbers');
      return character({ operation, bone, origin: origin as Vec3, frame: frame as Quat });
    }

    case 'mirror-joints': {
      const error = exactFields(args, operation, ['operation', 'source']);
      if (error) return invalid(error);
      if (args.source !== 'left' && args.source !== 'right') {
        return invalid('mirror-joints source must be left or right');
      }
      return character({ operation, source: args.source });
    }

    case 'scale-skeleton': {
      const error = exactFields(args, operation, ['operation', 'factor']);
      if (error) return invalid(error);
      if (typeof args.factor !== 'number' || !Number.isFinite(args.factor) || args.factor <= 0) {
        return invalid('scale-skeleton factor must be finite and positive');
      }
      return character({ operation, factor: args.factor });
    }

    case 'probe': {
      const error = exactFields(args, operation, ['operation', 'vertex']);
      if (error) return invalid(error);
      if (!Number.isSafeInteger(args.vertex) || (args.vertex as number) < 0) {
        return invalid('probe vertex must be a nonnegative integer');
      }
      return character({ operation, vertex: args.vertex as number });
    }

    case 'weights-summary': {
      const error = exactFields(args, operation, ['operation', 'bone']);
      if (error) return invalid(error);
      const bone = nonEmptyString(args.bone);
      if (!bone) return invalid('weights-summary bone must be a non-empty stable bone id');
      return character({ operation, bone });
    }

    case 'weights-symmetry': {
      const error = exactFields(args, operation, ['operation', 'tolerance']);
      if (error) return invalid(error);
      if (!hasOwn(args, 'tolerance')) return character({ operation });
      if (typeof args.tolerance !== 'number' || !Number.isFinite(args.tolerance) || args.tolerance < 0) {
        return invalid('weights-symmetry tolerance must be finite and nonnegative');
      }
      return character({ operation, tolerance: args.tolerance });
    }

    case 'bend-test': {
      const error = exactFields(args, operation, ['operation', 'test', 'side']);
      if (error) return invalid(error);
      if (args.test !== 'shoulder' && args.test !== 'elbow' && args.test !== 'wrist' &&
          args.test !== 'hip' && args.test !== 'knee') {
        return invalid('bend-test test must be shoulder, elbow, wrist, hip, or knee');
      }
      if (args.side !== 'left' && args.side !== 'right' && args.side !== 'both') {
        return invalid('bend-test side must be left, right, or both');
      }
      return character({ operation, test: args.test, side: args.side });
    }

    default:
      return invalid(`unknown rig operation "${operation}"`);
  }
}

export const CHARACTER_RIG_SEAT_READINESS_IDS = [
  'connected_body',
  'required_semantics',
  'canonical_skeleton',
  'current_topology_hash',
  'current_semantic_hash',
  'current_object_binding_hash',
  'saved_four_influence_weights',
] as const satisfies readonly CharacterRigReadinessCheckId[];

type ReadinessStatus = CharacterRigReadinessCheck['status'];

export type CharacterRigSeatStatus = {
  state: CharacterRigSnapshot['state'];
  external: null | {
    provider: string;
    modelClass: string | null;
    seconds: number | null;
    bones: number;
  };
  rows: {
    connected_body: {
      status: ReadinessStatus;
      components: number | null;
      main: number | null;
      detached: number | null;
    };
    required_semantics: {
      status: ReadinessStatus;
      missing: string[] | null;
      uncoveredBodyFaces: number | null;
    };
    canonical_skeleton: ReadinessStatus;
    current_topology_hash: ReadinessStatus;
    current_semantic_hash: ReadinessStatus;
    current_object_binding_hash: ReadinessStatus;
    saved_four_influence_weights: ReadinessStatus;
  };
  weightsStale: boolean;
  fitReview: boolean;
  bindReview: boolean;
};

/** Project the compact native snapshot into the Seat's persistent rig percept.
 * Counts come only from structured native fields. Readiness detail strings are
 * intentionally ignored: they are presentation, never an automation protocol. */
export function rigStatusFromSnapshot(snapshot: CharacterRigSnapshot): CharacterRigSeatStatus {
  const statuses = new Map<CharacterRigReadinessCheckId, ReadinessStatus>();
  for (const row of snapshot.readiness) statuses.set(row.id, row.status);
  const status = (id: CharacterRigReadinessCheckId): ReadinessStatus => statuses.get(id) ?? 'blocked';
  const topology = snapshot.bodyTopology;
  const coverage = snapshot.semanticCoverage;
  const boundRoleKeys = new Set((snapshot.semanticBindings ?? []).map((binding) =>
    `${binding.role}${binding.side ? `:${binding.side}` : ''}`));
  const missingExternalRoles = REQUIRED_HUMANOID_ROLE_KEYS.filter((key) => !boundRoleKeys.has(key));
  return {
    state: snapshot.state,
    external: snapshot.externalProvenance ? {
      provider: snapshot.externalProvenance.provider,
      modelClass: snapshot.externalProvenance.modelClass ?? null,
      seconds: snapshot.externalProvenance.seconds ?? null,
      bones: snapshot.bones.length,
    } : null,
    rows: {
      connected_body: {
        status: status('connected_body'),
        components: topology?.componentCount ?? null,
        main: topology?.mainTriangleCount ?? null,
        detached: topology?.detachedTriangleCount ?? null,
      },
      required_semantics: {
        status: status('required_semantics'),
        missing: snapshot.externalProvenance ? missingExternalRoles : coverage ? [...coverage.missingRequiredRoles] : null,
        uncoveredBodyFaces: snapshot.externalProvenance ? null : coverage?.uncoveredBodyFaceCount ?? null,
      },
      canonical_skeleton: status('canonical_skeleton'),
      current_topology_hash: status('current_topology_hash'),
      current_semantic_hash: status('current_semantic_hash'),
      current_object_binding_hash: status('current_object_binding_hash'),
      saved_four_influence_weights: status('saved_four_influence_weights'),
    },
    weightsStale: snapshot.weightsStale,
    fitReview: snapshot.fitNeedsReview,
    bindReview: snapshot.bindNeedsReview,
  };
}
