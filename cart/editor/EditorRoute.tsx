// editor/EditorRoute.tsx — the /editor route.
//
// Scaffold for now: the authoring shell (command menus, the in-app diagnostics
// console, inspector, stage, build dock) mounts here as the foundation systems
// get wired into the cart. Kept intentionally clean so it grows into components,
// never a god-file.
import { C } from './editor.cls';

export default function EditorRoute() {
  return (
    <C.ED_Scaffold>
      <C.ED_ScaffoldTitle>Editor</C.ED_ScaffoldTitle>
      <C.ED_ScaffoldHint>authoring shell mounts here — commands · console · inspector · stage</C.ED_ScaffoldHint>
    </C.ED_Scaffold>
  );
}
