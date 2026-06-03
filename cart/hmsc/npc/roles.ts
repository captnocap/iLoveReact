// What an NPC MEANS to the player — the role axis. This is the open one. Unlike
// kind and faction (closed enums), a role is just an id string on NpcState, and
// THIS registry gives it meaning. Adding "person of interest", "target",
// "informant", "witness", "contact" — or any future designation — is one entry
// here; the entity type never changes. That is the extensible types system: the
// struct knows zero role names, exactly like the geometry/camera/thingymajigger
// registries elsewhere in the stack.
//
// Role is orthogonal to faction. A civilian-faction NPC (won't fight back) can
// wear the `target` role (your Hitman mark). `hostileOnSight` is the role's
// override on the faction matrix — a `target` engages even if its faction would
// otherwise be neutral. `interactions` are action-menu ids the role surfaces;
// the menu layer resolves them later.

export type NpcRoleDef = {
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

const ROLES: Record<string, NpcRoleDef> = {
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

// Resolve a role id to its definition. Unknown ids fall back to `none` so a save
// or command referencing a role this build doesn't know never crashes.
export function npcRole(id: string): NpcRoleDef {
  return ROLES[id] ?? ROLES.none;
}

export function isNpcRole(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(ROLES, id);
}

export function npcRoleNamesForConsole(): string {
  return Object.keys(ROLES).join(', ');
}
