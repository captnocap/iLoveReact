// pickFile — the framework's native OS file-open picker. A `zenity
// --file-selection` dialog spawned via execAsync (no host dialog door exists yet, so
// the shell picker is the honest path). This is the shared implementation behind every
// "Choose file…" button; the Studio's pickModelFile (cart/hmsc-int) and the model
// viewer (cart/modelview) both go through here, so the picker behaves identically and
// there's one place to swap in a real host dialog door later.
//
// Resolves to the chosen absolute path, or null on cancel / when no picker is present.
import { execAsync } from './process';

/** One filter group in the dialog's type dropdown — e.g.
 *  `{ name: '3D models', patterns: ['*.glb', '*.obj'] }`. */
export interface FileFilter {
  name: string;
  patterns: string[];
}

export interface PickFileOptions {
  title?: string;
  /** Seed the dialog's initial folder (a trailing slash is added if missing). */
  startDir?: string;
  /** Type filters; the first is selected by default. Omit for "All files". */
  filters?: FileFilter[];
}

// zenity arguments are single-quoted; a stray quote in a title/path would break the
// shell word. Escape ' as the usual '\'' so arbitrary text passes through intact.
function shq(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export async function pickFile(opts: PickFileOptions = {}): Promise<string | null> {
  const title = opts.title ?? 'Pick a file';
  const start = opts.startDir ? `--filename=${shq(opts.startDir.replace(/\/?$/, '/'))} ` : '';
  const filters = (opts.filters && opts.filters.length ? opts.filters : [{ name: 'All files', patterns: ['*'] }])
    .map((f) => `--file-filter=${shq(`${f.name} | ${f.patterns.join(' ')}`)} `)
    .join('');
  const r = await execAsync(`zenity --file-selection --title=${shq(title)} ${start}${filters}`);
  const path = (r.stdout || '').trim();
  return path || null;
}

/** Open the same native picker with multi-selection enabled. The empty array
 * means the user cancelled (or no picker is installed). Newlines are Zenity's
 * separator here because ordinary Linux paths cannot contain a NUL and image
 * authoring paths containing newlines are not useful picker input. */
export async function pickFiles(opts: PickFileOptions = {}): Promise<string[]> {
  const title = opts.title ?? 'Pick files';
  const start = opts.startDir ? `--filename=${shq(opts.startDir.replace(/\/?$/, '/'))} ` : '';
  const filters = (opts.filters && opts.filters.length ? opts.filters : [{ name: 'All files', patterns: ['*'] }])
    .map((f) => `--file-filter=${shq(`${f.name} | ${f.patterns.join(' ')}`)} `)
    .join('');
  const r = await execAsync(`zenity --file-selection --multiple --separator=${shq('\n')} --title=${shq(title)} ${start}${filters}`);
  return parsePickedFiles(r.stdout || '');
}

/** Parse Zenity's newline-separated output without trimming legal spaces from
 * either end of a filename. */
export function parsePickedFiles(stdout: string): string[] {
  return stdout.split(/\r?\n/).filter((path) => path.length > 0);
}
