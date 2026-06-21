// editors/model/pickModelFile.ts — native OS file picker for 3D models, the
// model sibling of editors/cutout/sources.ts pickImageFile (req_1617). Same
// proven idiom the image upload uses: a zenity --file-selection dialog spawned
// via execAsync (no host dialog door exists yet, so the shell picker is the
// honest path). Resolves to the chosen absolute path, or null on cancel.
import { execAsync } from '@reactjit/runtime/hooks/process';

/** Open the system file picker filtered to .glb / .obj. `startDir` (optional)
 *  seeds the dialog's initial folder — pass the generated-models dir so it opens
 *  where freshly-generated meshes land. */
export async function pickModelFile(title = 'Pick a 3D model', startDir?: string): Promise<string | null> {
  const start = startDir ? `--filename='${startDir.replace(/\/?$/, '/')}' ` : '';
  const r = await execAsync(
    `zenity --file-selection --title='${title}' ${start}` +
    "--file-filter='3D models | *.glb *.obj' " +
    "--file-filter='All files | *'",
  );
  const path = (r.stdout || '').trim();
  return path || null;
}
