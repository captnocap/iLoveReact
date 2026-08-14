// editor/data/roleNamer.ts — the vehicle guided role-naming pass (req_3263).
//
// Vehicle rigs still use per-part bone names, so a namer session walks the car
// formation and lets the user click each corresponding outliner row. Character
// anatomy is independent semantic data and never enters this name-based tool.
import { carRigBones } from '../../../runtime/skeleton';

export type RoleContractId = 'car';

export type RoleContract = { id: RoleContractId; label: string; roles: string[] };

export function roleContract(id: RoleContractId): RoleContract {
  if (id !== 'car') throw new Error(`unknown role-naming contract: ${String(id)}`);
  return { id, label: 'car', roles: carRigBones().map((bone) => bone.id) };
}

function canonicalVehicleRoleName(name: string): string {
  let canonical = name.trim().toLowerCase().replace(/[\s\-.]+/g, '_');
  canonical = canonical.replace(/_l$/, '_left').replace(/_r$/, '_right');
  return canonical;
}

export type RoleNamerPlan = {
  contract: RoleContract;
  /** roles no part claims yet, contract order — the session's ask queue */
  open: string[];
  /** role → claiming part name (first claimant wins) */
  claimed: Map<string, string>;
};

export function roleNamerPlan(contractId: RoleContractId, partNames: readonly string[]): RoleNamerPlan {
  const contract = roleContract(contractId);
  const roles = new Set(contract.roles);
  const claimed = new Map<string, string>();
  for (const name of partNames) {
    const bone = canonicalVehicleRoleName(name);
    if (roles.has(bone) && !claimed.has(bone)) claimed.set(bone, name);
  }
  return { contract, open: contract.roles.filter((role) => !claimed.has(role)), claimed };
}
