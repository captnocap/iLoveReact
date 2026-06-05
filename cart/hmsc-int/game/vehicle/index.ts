// game/vehicle/ — GAME_VEHICLE: VehicleDoc + buildVehicle + the semantic part
// vocabulary (V10). CAPTURE PENDING.
//
// vehicle_lab is the source the way head_lab is for people — rewritten in by
// its capture lane (scale is NOT yet verified against the 1-tile=1m contract;
// CarMeshes and hmsc's structure cars retire into it). Door only, nothing fake.

export const GAME_VEHICLE = Object.freeze({
  status: 'capture-pending' as const,
});
