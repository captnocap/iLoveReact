// Minimal editor-owned tile-kind vocabulary shared by world and shader modules.

export type TileKind =
  | 'water'
  | 'road'
  | 'asphalt'
  | 'sidewalk'
  // Directional lane tiles — the CENTER tile of a 3-tile lane trio
  // ([shoulder, lane, shoulder]); the painted line cars actually drive.
  // The kind name carries the lane's legal flow (compass; -Z = north, the
  // editor facing convention). Direction is ENFORCED by host pathing's flow
  // table (runtime/pathing.ts setPathFlows): with-flow rides cheap,
  // against-flow pays the profile's penalty — right-hand traffic falls out
  // of the paint itself. 'junction' is the intersection resolver: flow-
  // neutral road where routes may legally change heading; right-of-way
  // (signals, yields) gates the box at runtime, not in the path graph.
  | 'laneNorth'
  | 'laneSouth'
  | 'laneEast'
  | 'laneWest'
  | 'junction'
  // The zebra: a band across the road just outside each junction edge. Two
  // jobs, one tile: it is the ONLY place pedestrian cost shaping makes
  // crossing a road sane (walk profiles make it cheaper than sidewalk, the
  // road itself near-blocked), AND it is the car stop line — signal yields
  // halt BEFORE the crosswalk band, and a walker on the zebra owns the road
  // regardless of the light.
  | 'crosswalk'
  // The double-yellow centerline strip between opposing lane groups. Walkable
  // (jaywalking) but expensive for vehicles ALONG it — crossing one cell to
  // turn is cheap in absolute terms, driving lengthwise down the middle is
  // not (the flow-less-drivable wrong-way loophole, priced out per cell).
  | 'median'
  | 'mud'
  | 'sand'
  | 'wall'
  | 'door'
  | 'bush'
  | 'marker'
  // Gameplay markers — single placed cells with identity, not bulk-painted ground.
  // 'spawn' is where the player (re)appears; 'save' is a checkpoint that, when
  // stepped on, persists the game and points the respawn at a CHOSEN spawn cell
  // (PlacedCell.spawnKey). A world can hold many of each; a save never sits on its
  // own spawn (you save here, you reappear THERE). Lowered to placedCells on compile.
  | 'spawn'
  | 'save'
  // Living ground: plain lawn/meadow surface only. Grass blades, palms, and
  // painted bushes live in the separate flora channel so they can grow over any
  // ground surface (sand + grass flora = beach grass).
  | 'grass'
  // Parking (PARKSPAWN-0612, req_0694): painted parking-lot ground — asphalt
  // wearing white stall lines (3m bays drawn by the tile surface shaders).
  // Drivable but never a thoroughfare; where parked traffic lives.
  | 'parking'
  // Vehicle spawn marker (req_0694): a single placed cell where the traffic
  // system may materialize a vehicle. WHICH vehicle is the garage's per-style
  // spawnRate weighting (editors/vehicles), not the cell's business.
  | 'vehicleSpawn'
  // Parking rotated 90° (req_0710): same lot ground as 'parking', but its bay
  // lines run across Z instead of X — the perpendicular stall orientation, so
  // a lot is not stuck to one direction. Appended LAST (indices stay stable).
  | 'parkingCross';
