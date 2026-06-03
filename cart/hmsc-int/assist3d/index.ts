// assist3d — assistant-authored hot 3D surface, baked into hmsc-int as a route.
//
// The assistant writes assist3d/scene.json; the /assist3d route renders + inspects
// it; the Objects explorer's ASSISTANT category reads the same file. scene.json is
// the single source of truth (disk = truth).

export { Assist3DRoute } from './Assist3DRoute';
export { AssistMeshViewer } from './AssistMeshViewer';
export { SceneSurface } from './SceneSurface';
export { useAssistScene, type AssistSceneState } from './useAssistScene';
export {
  type MeshSpec, type SceneSpec, EMPTY_SCENE, ALLOWED_GEOMETRY,
  parseScene, sceneFilePath, processCwd, boundingRadius, buildPreamble, round,
} from './scene';
