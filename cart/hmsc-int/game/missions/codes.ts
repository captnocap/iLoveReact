// game/missions/codes.ts — the bridge that mints a UNIQUE in-world code from each
// real mission (req_1620/1621). The codec + decal generator live in
// game/textures/missionCode.ts (key → DecalDoc, pure); this is where the codes
// meet the actual mission table, so a code is always bound to a mission that
// exists. The editor's decal picker reads missionCodePresets() to offer them as
// importable decals; the bound key round-trips through decodeMissionModules so a
// future in-game scan resolves straight back to getMissionDefinition(key).

import type { DecalDoc } from '../textures/decal';
import { missionCodeDoc, missionCodeDecalId, type MissionCodeOpts } from '../textures/missionCode';
import { MISSION_DEFINITIONS } from './defs';

export type MissionCodePreset = {
  /** stable decal/material id (`mission-code:<key>`) */
  id: string;
  /** the mission this code resolves to */
  key: string;
  /** human label for the picker */
  label: string;
  /** the importable decal */
  doc: DecalDoc;
};

/** One importable code decal per shipped mission. */
export function missionCodePresets(opts: MissionCodeOpts = {}): MissionCodePreset[] {
  return Object.values(MISSION_DEFINITIONS).map((def) => ({
    id: missionCodeDecalId(def.key),
    key: def.key,
    label: `Mission · ${def.title}`,
    doc: missionCodeDoc(def.key, opts),
  }));
}

/** The code decal for a single mission key (throws if the mission is unknown). */
export function missionCodePresetFor(key: string, opts: MissionCodeOpts = {}): MissionCodePreset {
  const def = MISSION_DEFINITIONS[key];
  if (!def) throw new Error(`mission code: unknown mission "${key}" — shipped: ${Object.keys(MISSION_DEFINITIONS).join(', ')}`);
  return { id: missionCodeDecalId(def.key), key: def.key, label: `Mission · ${def.title}`, doc: missionCodeDoc(def.key, opts) };
}
