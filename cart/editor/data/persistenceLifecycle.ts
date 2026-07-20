import type { EditorState } from './types';

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
    modelActivePartId: null,
  };
}
