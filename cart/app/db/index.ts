// cart/app/db — Postgres-backed multi-DB persistence for cart/app.
//
// Buckets are partitioned by role × cartridge (see buckets.ts). Each
// entity from cart/app/gallery/data/ is registered to exactly one
// bucket in registry.ts. Bootstrap is idempotent and runs lazily on
// the first useCRUD call.

export { BUCKETS, BUCKET_IDS, type Bucket, type BucketId } from './buckets';
export { ENTITY_TO_BUCKET, bucketFor, entitiesByBucket } from './registry';
export { useCRUD } from './useCRUD';
export { ensureBootstrapped, resetBucket, resetAll } from './bootstrap';
export { getHandle, query, exec, changes } from './connections';
export { bindRules, rebindRules, unbindAllRules, listBoundRules } from './rule-binder';
export { installMechanicalWires, uninstallMechanicalWires, refreshMechanicalCaches } from './mechanical-wires';
export { installVmBridges, uninstallVmBridges, listVmBridgeRefs, listAttachedVms } from './vm-bridges';
