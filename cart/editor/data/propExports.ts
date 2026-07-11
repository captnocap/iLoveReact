// data/propExports.ts — semantic meanings offered by File → Export → Prop.
//
// Geometry stays a normal authored prop. `role` is the small gameplay/catalog
// contract that lets road intersections and transit paths ask for a stop sign,
// signal, street sign, bus stop, or train stop without guessing from model names.
// The model manifest owns the declaration; generated placements reference it.

export const PROP_EXPORT_ROLES = [
  'scenery',
  'stopSign',
  'trafficLight',
  'streetSign',
  'busStop',
  'trainStop',
] as const;

export type PropExportRole = typeof PROP_EXPORT_ROLES[number];

export type PropExportTarget = {
  id: string;
  label: string;
  role: PropExportRole;
  icon: string;
};

export const PROP_EXPORT_TARGETS: readonly PropExportTarget[] = [
  { id: 'scenery', label: 'Scenery Prop', role: 'scenery', icon: 'Armchair' },
  { id: 'stop-sign', label: 'Stop Sign', role: 'stopSign', icon: 'CircleStop' },
  { id: 'traffic-light', label: 'Traffic Light', role: 'trafficLight', icon: 'TrafficCone' },
  { id: 'street-sign', label: 'Street Sign', role: 'streetSign', icon: 'Signpost' },
  { id: 'bus-stop', label: 'Bus Stop', role: 'busStop', icon: 'BusFront' },
  { id: 'train-stop', label: 'Train Stop', role: 'trainStop', icon: 'TrainFront' },
] as const;

/** Keep the original `export-prop` command id as the backwards-compatible
 * scenery leaf; semantic roles extend it beneath the same Prop submenu. */
export function propExportCommandId(target: PropExportTarget): string {
  return target.role === 'scenery' ? 'export-prop' : `export-prop-${target.id}`;
}

export function propExportTargetForCommand(commandId: string): PropExportTarget | null {
  return PROP_EXPORT_TARGETS.find((target) => propExportCommandId(target) === commandId) ?? null;
}
