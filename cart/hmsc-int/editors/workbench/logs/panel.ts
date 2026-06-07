// editors/workbench/logs/panel.ts — the LOGS source's headless half
// (WBSET9-0606): roster, lenses, actions, and the PanelSpec per feed. No
// React (the characters.test.ts bundling law) — LogStream.tsx renders the
// stage; the P4 suite drives THIS module + store.ts on fake deps.
//
// The wireframe's panel law (W3): the panel carries the feed's PROPERTIES
// (what it IS — source, file, store), never its activity numbers — stats are
// display and live in column 4's dashboard band.

import type { PanelSpec } from '../../../shell/fields';
import type { LensSpec } from '../../../shell/stage';
import type { ActionSpec, RosterRow } from '../../../shell/Workbench';
import { BUS_ID, BUS_PREFIX, CHURN_ID, type LogsStore } from './store';

export function logsRoster(store: LogsStore): RosterRow[] {
  return store.channelIds().map((id) => ({ id, label: store.labelOf(id) }));
}

/** LAW 2's own example, made real: churn = KEY ⇄ ALL (the /log key-only
 *  toggle as a lens); a bus channel = CHANNEL ⇄ ALL; the bus overview IS
 *  all — a single lens shows no segment. */
export function logsLenses(id: string): LensSpec[] {
  if (id === CHURN_ID) return [{ id: 'key', label: 'KEY' }, { id: 'all', label: 'ALL' }];
  if (id === BUS_ID) return [{ id: 'all', label: 'ALL' }];
  const channel = id.startsWith(BUS_PREFIX) ? id.slice(BUS_PREFIX.length) : id;
  return [{ id: 'channel', label: channel.toUpperCase() }, { id: 'all', label: 'ALL' }];
}

/** hero verbs (census/log.md C4 pause/resume + C5 clear — the churn feed's) */
export function logsActions(store: LogsStore, id: string): ActionSpec[] {
  if (id !== CHURN_ID) return [];
  const on = store.deps.ring.enabled();
  return [
    {
      id: 'toggle-logging',
      label: on ? 'pause' : 'resume',
      icon: on ? 'Pause' : 'Play',
      run: () => { store.deps.ring.setEnabled(!store.deps.ring.enabled()); },
    },
    {
      id: 'clear',
      label: 'clear',
      icon: 'Trash2',
      run: () => { store.deps.ring.clear(); },
    },
  ];
}

export function logsPanel(store: LogsStore, id: string): PanelSpec {
  if (id === CHURN_ID) {
    return {
      groups: [{
        title: 'FEED',
        fields: [
          { k: 'source', t: 'val', get: () => 'perfLog ring (in-memory)' },
          { k: 'file', t: 'val', get: () => store.deps.ring.path() },
          { k: 'state', t: 'val', get: () => (store.deps.ring.enabled() ? 'logging' : 'paused') },
        ],
      }],
    };
  }
  const storeStatus = () => (store.busError() ? `unavailable: ${store.busError()}` : 'open');
  if (id === BUS_ID) {
    return {
      groups: [{
        title: 'FEED',
        fields: [
          { k: 'source', t: 'val', get: () => 'V20 sessions stream (every channel)' },
          { k: 'store', t: 'val', get: storeStatus },
        ],
      }],
    };
  }
  const channel = id.startsWith(BUS_PREFIX) ? id.slice(BUS_PREFIX.length) : id;
  return {
    groups: [{
      title: 'FEED',
      fields: [
        { k: 'source', t: 'val', get: () => `V20 sessions stream · '${channel}' channel` },
        {
          k: 'routes', t: 'val',
          get: () => {
            const state = store.busState();
            if (!state) return '—';
            const routes: string[] = [];
            for (const sid of state.order) {
              const s = state.sessions[sid];
              if (s && s.channel === channel && !routes.includes(s.route)) routes.push(s.route);
            }
            return routes.join(' · ') || '—';
          },
        },
        { k: 'store', t: 'val', get: storeStatus },
      ],
    }],
  };
}
