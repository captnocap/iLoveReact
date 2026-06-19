export const HMSC_SCALE = {
  tileMeters: 1,
  // Fixed thickness of a floor tile. 1 tile = 1 meter on the ground plane; the
  // thickness is just enough to read as a solid floor. NOTE: GameWorld3D must
  // inline this number as a literal in the mesh `params` so the geometry bakes
  // — keep that literal in sync with this value.
  floorTileThicknessMeters: 0.2,
  playerCapsuleHeightMeters: 1.65,
  playerCapsuleRadiusMeters: 0.34,
  // Step-up tolerance. Must exceed the radius-induced LIP at a stair/ramp crest:
  // climbing a slope of grade g, the player's circle reaches the crest wall while
  // its centre is one radius back, where the surface sits radius*g lower — a lip
  // of R*g. At 45° stairs that is 0.34m and at the steepest walkable ramp (53°,
  // walkCos 0.6) it is ~0.45m, so 0.35 sat right at the limit and walled the
  // climber out at the top (worse at low/variable framerate, where the per-frame
  // advance overshoots the thin grace window). 0.5 clears every walkable
  // stair/ramp crest with margin at any framerate (req_1453). Still knee-height
  // on a ~1.7m human — a curb/low-ledge step, not a wall climb.
  playerStepHeightMeters: 0.5,
  visualHumanMinMeters: 1.7,
  visualHumanMaxMeters: 2.0,
  doorWidthMeters: 1,
  doorHeightMeters: 2.4,
  storyHeightMeters: 3,
  car: { widthMeters: 2, lengthMeters: 4, heightMeters: 1.5 },
  bus: { widthMeters: 2.5, lengthMeters: 11, heightMeters: 3.2 },
  smallRoom: { widthMeters: 4, depthMeters: 4 },
  bedroom: { widthMeters: 3, depthMeters: 4 },
  shopInterior: { widthMeters: 8, depthMeters: 10 },
  smallHouse: { widthMeters: 8, depthMeters: 10 },
  cityBlock: { minMeters: 40, maxMeters: 80 },
};
