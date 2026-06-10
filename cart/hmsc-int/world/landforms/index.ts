// Landform barrel — the registry machinery plus the registered kinds. Importing
// any of these runs `./kinds` for its side effect (registerLandformKind for every
// kind), so the registry is always populated. Consumers import landform helpers
// (and the kind geometry helpers a decoration needs) ONLY from here.
export * from './registry';
export * from './kinds';
