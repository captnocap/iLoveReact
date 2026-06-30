// runtime/attribution — the shared, uniform asset-attribution system. Imports record
// here, the Studio's hand-made models will too; one ledger, one panel, one credits
// export. Keep all attribution concerns behind this barrel.
export {
  loadLedger,
  saveLedger,
  putEntry,
  recordImport,
  recordStudioModel,
  detectFromPath,
  deriveStatus,
  LICENSES,
  DEFAULT_LEDGER_PATH,
  type Attribution,
  type AttributionKind,
  type AttributionStatus,
  type Ledger,
} from './ledger';
export { renderCredits, exportCredits, pendingCount, entries, DEFAULT_CREDITS_PATH } from './credits';
export { AttributionPanel, AttributionStatusBadge, type AttributionPanelProps } from './AttributionPanel';
