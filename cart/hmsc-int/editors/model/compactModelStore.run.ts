// v8cli entry for `rjit game compact-store` — bundled + spawned by the rjit
// command (which backs up store.db + the snapshot first and refuses while the
// editor holds the store). Runs from the repo root, so the model-domain path is
// fixed and relative.

import { compactModelStore } from './compactModelStore';

const root = 'cart/hmsc-int/data/domains/model';
try {
  const r = compactModelStore(root);
  console.log(JSON.stringify(r));
  console.log(r.guardOk && r.snapshotPaintedOk ? 'COMPACT OK' : 'COMPACT FAILED');
} catch (e) {
  console.log(`COMPACT ERROR: ${String(e)}`);
}
