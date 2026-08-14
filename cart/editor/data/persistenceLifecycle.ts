import type { EditorState, ModelPackage } from './types';

/** Keep the session catalog projection on the exact package revision that was
 * just committed. Effective package lookup prefers this list over the boot
 * catalog, so retaining an older draft here would undo a successful save on the
 * next close/reopen within the same editor process. */
export function upsertModelPackageProjection(
  packages: readonly ModelPackage[],
  committed: ModelPackage,
): ModelPackage[] {
  return packages.some((item) => item.id === committed.id)
    ? packages.map((item) => item.id === committed.id ? committed : item)
    : [...packages, committed];
}

/** Remove one model's ephemeral authoring copy. The caller separately clears
 * the native resident-session claim; this pure state transition is kept here so
 * Discard can be proven without mounting the editor shell. */
export function discardModelWorkingCopyState(
  state: EditorState,
  modelId: string,
  materialized: boolean,
): EditorState {
  const modelParts = { ...state.modelParts };
  const modelRigs = { ...state.modelRigs };
  const modelTextureSlots = { ...state.modelTextureSlots };
  const modelLights = { ...state.modelLights };
  const modelDirty = { ...state.modelDirty };
  const modelOverrides = { ...state.modelOverrides };
  delete modelParts[modelId];
  delete modelRigs[modelId];
  delete modelTextureSlots[modelId];
  delete modelLights[modelId];
  delete modelDirty[modelId];
  if (!materialized) delete modelOverrides[modelId];
  return {
    ...state,
    modelParts,
    modelRigs,
    modelTextureSlots,
    modelLights,
    modelDirty,
    modelOverrides,
    modelDupes: materialized ? state.modelDupes : state.modelDupes.filter((item) => item.id !== modelId),
    recentLibraryKeys: materialized
      ? state.recentLibraryKeys
      : state.recentLibraryKeys.filter((key) => key !== `model:${modelId}`),
    modelActivePartId: null,
  };
}
