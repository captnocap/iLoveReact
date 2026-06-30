// tunables/ — the defaults/tunables registry (editor foundation workstream G).
//
// Most editable values edit as a select of NAMED PRESETS (factors over a fixed
// base) with an optional custom override; a globals command-palette searches them
// ranked; shader-slot overrides key by (material, variant, slot); values that feed
// Zig read out through a host door. Edits travel through the authoring eventbus.

export {
  type TunableDef, type Selection, type CustomOverride,
  DEFAULT_PRESET, isOverride,
  defineTunable, tunableDef, registeredTunables,
  resolve, resolveCurrent,
  overrideKey, parseOverrideKey,
  searchTunables,
  setSelection, getSelection, clearSelection,
} from './tunable';

export {
  tunableOverrideSet, tunableOverrideClear,
  materialSlotFill, materialSlotReset, materialSeedRoll, materialVariantSelect,
  setTunableOverride, clearTunableOverride,
  fillMaterialSlot, resetMaterialSlot, rollMaterialSeed, selectMaterialVariant,
} from './events';

export { tunableGet } from './host';
