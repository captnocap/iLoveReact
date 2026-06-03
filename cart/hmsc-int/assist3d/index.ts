// assist3d — assistant-authored hot 3D surface, baked into hmsc-int as a route.
//
// The assistant writes assist3d/scene.json; the /assist3d route renders + inspects
// it; the Objects explorer's ASSISTANT category reads the same file. scene.json is
// the single source of truth (disk = truth).

export { Assist3DRoute } from './Assist3DRoute';
export { AssistMeshViewer } from './AssistMeshViewer';
export { SceneSurface } from './SceneSurface';
export { BackendBar } from './BackendBar';
export { useAssistScene, type AssistSceneState } from './useAssistScene';
export { useSceneAssistant, type SceneAssistant } from './useSceneAssistant';
export {
  type Backend, type BackendConfig, BACKEND_LABELS, DEFAULT_CONFIG,
  LOCAL_DEFAULT_N_CTX, LOCAL_DEFAULT_MAX_TOKENS,
  writesOwnFile, configReady, buildAssistantOpts, SET_SCENE_TOOL,
} from './backends';
export { loadModelHistory, rememberModelPath, forgetModelPath, modelLabel } from './modelHistory';
export {
  type MeshSpec, type SceneSpec, EMPTY_SCENE, ALLOWED_GEOMETRY,
  parseScene, sceneFilePath, processCwd, boundingRadius, buildPreamble, round,
} from './scene';
