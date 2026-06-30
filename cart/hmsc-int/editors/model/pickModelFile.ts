// editors/model/pickModelFile.ts — native OS file picker for 3D models, the
// model sibling of editors/cutout/sources.ts pickImageFile (req_1617). Delegates to
// the shared runtime/hooks/pickFile (req_2110) so the Studio and the standalone model
// viewer (cart/modelview) drive the exact same picker — the .glb/.obj filter is the
// only thing this layer adds.
import { pickFile } from '@reactjit/runtime/hooks/pickFile';

/** Open the system file picker filtered to .glb / .obj. `startDir` (optional)
 *  seeds the dialog's initial folder — pass the generated-models dir so it opens
 *  where freshly-generated meshes land. Resolves to the chosen path, or null on cancel. */
export async function pickModelFile(title = 'Pick a 3D model', startDir?: string): Promise<string | null> {
  return pickFile({
    title,
    startDir,
    filters: [
      { name: '3D models', patterns: ['*.glb', '*.obj'] },
      { name: 'All files', patterns: ['*'] },
    ],
  });
}
