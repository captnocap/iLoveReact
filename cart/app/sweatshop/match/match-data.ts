// Synthetic worker roster for the V0 match window.
//
// Once CompositionRun.workers is populated by the lock-in flow,
// MatchWindow reads real Worker rows; until then this list gives the
// champ-select / grid screens something to render.

import type { ArchetypeKey } from '../../gallery/components/block-faces/BlockFaces';

export interface ChampionWorker {
  id: string;
  name: string;
  role: string;
  archetype: ArchetypeKey;
  seed: string;
  model: string;
  connection: string;
  /** Synthetic "stat panel" flavor — total runs / win rate / favorite
   *  tools. Wires to real worker history (worker-session aggregates)
   *  later. */
  stats: {
    runs: number;
    winRate: string;
    avgMs: string;
    topTools: string[];
  };
}

export const SAMPLE_CHAMPIONS: ChampionWorker[] = [
  {
    id: 'w_doc',
    name: 'Documentarian',
    role: 'docs / refactor',
    archetype: 'human',
    seed: 'w_doc',
    model: 'claude-opus-4-7',
    connection: 'anthropic',
    stats: { runs: 47, winRate: '72%', avgMs: '4.2s', topTools: ['Read', 'Edit', 'Grep'] },
  },
  {
    id: 'w_implement',
    name: 'Implementer',
    role: 'feature / fix',
    archetype: 'robot',
    seed: 'w_implement',
    model: 'claude-sonnet-4-6',
    connection: 'anthropic',
    stats: { runs: 91, winRate: '64%', avgMs: '6.8s', topTools: ['Edit', 'Bash', 'Write'] },
  },
  {
    id: 'w_verify',
    name: 'Verifier',
    role: 'test / review',
    archetype: 'visor',
    seed: 'w_verify',
    model: 'gpt-5.4-mini',
    connection: 'openai-compat',
    stats: { runs: 33, winRate: '88%', avgMs: '2.1s', topTools: ['Read', 'Bash', 'Grep'] },
  },
  {
    id: 'w_explore',
    name: 'Explorer',
    role: 'research / map',
    archetype: 'cat',
    seed: 'w_explore',
    model: 'kimi-k2',
    connection: 'moonshot',
    stats: { runs: 18, winRate: '55%', avgMs: '8.1s', topTools: ['Glob', 'Grep', 'Read'] },
  },
];
