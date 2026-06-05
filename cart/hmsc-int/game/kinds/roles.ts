// game/kinds/roles — what an NPC MEANS to the player: the role axis. This is
// the OPEN one. Unlike kind and faction (closed unions), a role is just an id
// string on the NPC's state, and THIS table gives it meaning. Adding "person
// of interest", "target", "informant", "witness", "contact" — or any future
// designation — is one entry here; the entity type never changes. That is the
// extensible-types pattern: the struct knows zero role names, exactly like the
// geometry/camera registries elsewhere in the stack. THE TABLE IS THE DATA (P2).
//
// Role is orthogonal to faction. A civilian-faction NPC (won't fight back) can
// wear the `target` role (your Hitman mark). `hostileOnSight` is the role's
// override on the faction regard matrix (./npcs.ts) — a role with it engages
// even if its faction would otherwise be neutral. `interactions` are
// action-menu ids the role surfaces; the menu layer resolves them later.
//
// Fresh capture of cart/hmsc/npc/roles.ts (behavior reference only — see the
// capture note). Consumers go through game/kinds/index.ts (P3).

export type NpcRoleDefinition = {
  id: string;
  label: string;
  // HUD pip color when the player has this NPC marked. theme: token, never hex.
  markerColor: string;
  // Does wearing this role make the NPC engage-on-sight, overriding faction?
  hostileOnSight: boolean;
  // Is this NPC an objective (a mark/escort the mission tracks)?
  objective: boolean;
  // Contextual interactions this role adds to the action menu (resolved later).
  interactions: string[];
};

export const NPC_ROLE_DEFINITIONS: Record<string, NpcRoleDefinition> = {
  none: {
    id: 'none',
    label: 'None',
    markerColor: 'theme:muted',
    hostileOnSight: false,
    objective: false,
    interactions: [],
  },
  personOfInterest: {
    id: 'personOfInterest',
    label: 'Person of Interest',
    markerColor: 'theme:info',
    hostileOnSight: false,
    objective: false,
    interactions: ['observe', 'tail'],
  },
  target: {
    id: 'target',
    label: 'Target',
    markerColor: 'theme:danger',
    hostileOnSight: false,
    objective: true,
    interactions: ['eliminate'],
  },
  informant: {
    id: 'informant',
    label: 'Informant',
    markerColor: 'theme:accent',
    hostileOnSight: false,
    objective: false,
    interactions: ['question', 'bribe'],
  },
  witness: {
    id: 'witness',
    label: 'Witness',
    markerColor: 'theme:warning',
    hostileOnSight: false,
    objective: false,
    interactions: ['intimidate', 'silence'],
  },
  contact: {
    id: 'contact',
    label: 'Contact',
    markerColor: 'theme:friendly',
    hostileOnSight: false,
    objective: false,
    interactions: ['talk', 'trade'],
  },
};

export const DEFAULT_NPC_ROLE = 'none';

export const NPC_ROLES = Object.keys(NPC_ROLE_DEFINITIONS);

// Resolve a role id to its definition. Unknown ids fall back to `none` so a
// save or command referencing a role this build doesn't know never crashes.
export function npcRole(id: string): NpcRoleDefinition {
  return NPC_ROLE_DEFINITIONS[id] ?? NPC_ROLE_DEFINITIONS[DEFAULT_NPC_ROLE];
}

export function isNpcRole(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(NPC_ROLE_DEFINITIONS, id);
}

export function npcRoleNamesForConsole(): string {
  return NPC_ROLES.join(', ');
}
