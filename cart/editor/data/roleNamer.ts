// editor/data/roleNamer.ts — the guided role-naming pass (req_3263).
//
// "Formal lazy" naming: part name → bone id IS the rigging contract
// (runtime/skeleton rigs, req_2777), but remembering every name the compiler
// binds and renaming rows one by one is busywork. A namer session walks a
// contract's role list and the user just clicks the outliner row that should
// take each name. Roles a part already claims (by normalized name) are
// satisfied up front — the session only asks for what's missing.
import { bodyRigBones, carRigBones, normalizeBoneName } from '../../../runtime/skeleton';

export type RoleContractId = 'head' | 'body' | 'car';

export type RoleContract = { id: RoleContractId; label: string; roles: string[] };

// head = the head subtree of the body formation — a bust like heroin_bob_head
// never gets asked for toes. body/car = the full formations, authored order.
function headRoles(): string[] {
  const bones = bodyRigBones();
  const parentOf = new Map(bones.map((bone) => [bone.id, bone.parent]));
  const underHead = (id: string): boolean => {
    for (let at: string | undefined = id; at; at = parentOf.get(at)) {
      if (at === 'head') return true;
    }
    return false;
  };
  return bones.map((bone) => bone.id).filter(underHead);
}

export function roleContract(id: RoleContractId): RoleContract {
  if (id === 'head') return { id, label: 'head', roles: headRoles() };
  if (id === 'body') return { id, label: 'body', roles: bodyRigBones().map((bone) => bone.id) };
  return { id, label: 'car', roles: carRigBones().map((bone) => bone.id) };
}

export type RoleNamerPlan = {
  contract: RoleContract;
  /** roles no part claims yet, contract order — the session's ask queue */
  open: string[];
  /** role → claiming part name (first claimant wins, same as the compiler) */
  claimed: Map<string, string>;
};

export function roleNamerPlan(contractId: RoleContractId, partNames: readonly string[]): RoleNamerPlan {
  const contract = roleContract(contractId);
  const roles = new Set(contract.roles);
  const claimed = new Map<string, string>();
  for (const name of partNames) {
    const bone = normalizeBoneName(name);
    if (roles.has(bone) && !claimed.has(bone)) claimed.set(bone, name);
  }
  return { contract, open: contract.roles.filter((role) => !claimed.has(role)), claimed };
}
