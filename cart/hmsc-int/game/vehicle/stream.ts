// game/vehicle/stream — the V20 per-concern stream for authored vehicles,
// defined in ONE registration (log name + materializer; a stream without
// snapshot support cannot be expressed — the data layer's incompleteness
// guard).
//
// The materialized snapshot is the GARAGE: every VehicleDoc the user has
// authored in editors/vehicles/, keyed by id, in authoring order. The game/
// compile loads THIS view and hands each doc to buildVehicle — never the
// history (V20). Events carry the RESULTING doc, not the edit verb: the edit
// logic (style clamps, role coercion, damage nudges) is editor-side
// (editors/vehicles/edits.ts); the materializer stays a dumb upsert, so the
// round-trip author → stream → snapshot → buildVehicle is exact by
// construction, and every edit is still its own undo position. The
// materializer tolerates unknown event kinds by contract — new vehicle
// features arrive as event ADDITIONS, old logs stay valid forever (V20).

import type { StreamDef } from '../../data';
import type { VehicleDoc } from './index';

export type VehiclesStreamState = {
  /** the garage — every authored vehicle, by id */
  vehicles: Record<string, VehicleDoc>;
  /** first-authored order — the editor rail's stable listing */
  order: string[];
};

export type VehiclesEvent =
  | { kind: 'authored'; id: string; doc: VehicleDoc }
  | { kind: 'removed'; id: string };

export const vehiclesStream: StreamDef<VehiclesStreamState, VehiclesEvent> = Object.freeze({
  name: 'vehicles',
  initial: (): VehiclesStreamState => ({ vehicles: {}, order: [] }),
  apply: (state: VehiclesStreamState, event: VehiclesEvent): VehiclesStreamState => {
    switch (event?.kind) {
      case 'authored': {
        const known = event.id in state.vehicles;
        return {
          vehicles: { ...state.vehicles, [event.id]: event.doc },
          order: known ? state.order : [...state.order, event.id],
        };
      }
      case 'removed': {
        if (!(event.id in state.vehicles)) return state;
        const vehicles = { ...state.vehicles };
        delete vehicles[event.id];
        return { vehicles, order: state.order.filter((id) => id !== event.id) };
      }
      default:
        // Unknown kinds are future additions — old materializers skip them.
        return state;
    }
  },
});
