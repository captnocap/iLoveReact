// Read-side selectors over the persisted onboarding graph.
//
// The cart/app onboarding flow writes into namespace 'app':
//   user_local           — User row (displayName, configPath, preferences, ...)
//   settings_default     — Settings (defaultConnectionId, defaultModelId)
//   ws_local             — Workspace (root path)
//   connection:<id>      — Connection rows (one per provider the user added)
//   goal:<id>            — Goal rows
//
// Sweatshop is a different cartridge but reads the *same* graph — the
// user is one identity across cartridges. We do not own the schema here;
// we own the reads.

import { useCRUD } from '../db';
import type { User } from '../gallery/data/core/user';
import type { Settings } from '../gallery/data/core/settings';
import type { Connection } from '../gallery/data/core/connection';
import type { Goal } from '../gallery/data/core/goal';
import type { Workspace } from '../gallery/data/overstock/workspace';

const NS = 'app';
const passthrough = { parse: (v: unknown) => v as any };

export function useUser() {
  const store = useCRUD<User>('user', passthrough, { namespace: NS });
  return store.useQuery('user_local');
}

export function useSettings() {
  const store = useCRUD<Settings>('settings', passthrough, { namespace: NS });
  return store.useQuery('settings_default');
}

export function useWorkspace() {
  const store = useCRUD<Workspace>('workspace', passthrough, { namespace: NS });
  return store.useQuery('ws_local');
}

export function useActiveConnection(connectionId: string | null | undefined) {
  const store = useCRUD<Connection>('connection', passthrough, { namespace: NS });
  return store.useQuery(connectionId ?? '__missing__');
}

// Most recent open user-originated goal — the one onboarding wrote.
export function useLatestGoal() {
  const store = useCRUD<Goal>('goal', passthrough, { namespace: NS });
  return store.useListQuery({
    where: { originActor: 'user' },
    orderBy: 'createdAt',
    order: 'desc',
    limit: 1,
  });
}

// Recent workspaces — newest first. Sweatshop's start menu uses these as
// the "Recent projects" list. Sweatshop has no Project collection of its
// own yet; a workspace IS the project for now.
export function useRecentWorkspaces(limit = 8) {
  const store = useCRUD<Workspace>('workspace', passthrough, { namespace: NS });
  return store.useListQuery({
    orderBy: 'updatedAt',
    order: 'desc',
    limit,
  });
}
