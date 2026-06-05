// cli/commands/lab.ts - `rjit lab new <name>` (V17: a new lab is a scaffold
// from a script, so every lab carries the same shape).
//
// Copies the template pair (labs/_scaffold.tsx + labs/_scaffold.notes.md) to
// labs/<name>.tsx + labs/<name>.notes.md with the tokens filled, and inserts
// the lab into the labs/index.ts registry at its markers — so the new lab is
// immediately listed on the labs route after the watcher re-bundles. The lab
// file is GAME_* imports + an exported scene, nothing else; the notes are the
// lab's P6 contract.

import { fsExists, fsRead, fsWrite } from '../host/fs.ts';
import { err, out } from '../host/log.ts';

const LABS_DIR = 'cart/hmsc-int/labs';
const SCAFFOLD_SCENE = `${LABS_DIR}/_scaffold.tsx`;
const SCAFFOLD_NOTES = `${LABS_DIR}/_scaffold.notes.md`;
const REGISTRY = `${LABS_DIR}/index.ts`;
const IMPORTS_MARKER = '// rjit:lab-imports';
const ENTRIES_MARKER = '// rjit:lab-entries';

export async function run(argv: string[]): Promise<number> {
  if (argv[0] !== 'new') {
    err('Usage: rjit lab new <name>');
    err('  scaffolds labs/<name>.tsx + labs/<name>.notes.md and registers the lab');
    return 2;
  }
  const name = argv[1];
  if (!name || !/^[a-z][a-z0-9-]*[a-z0-9]$/.test(name)) {
    err(`[lab] name must be kebab-case (got ${JSON.stringify(name ?? '')}) — e.g. projectile-shapes`);
    return 2;
  }

  const root = __cwd();
  const scenePath = `${LABS_DIR}/${name}.tsx`;
  const notesPath = `${LABS_DIR}/${name}.notes.md`;
  if (fsExists(`${root}/${scenePath}`) || fsExists(`${root}/${notesPath}`)) {
    err(`[lab] ${name} already exists (${scenePath})`);
    return 1;
  }

  const componentName = pascalCase(name);
  const today = new Date(__nowMs()).toISOString().slice(0, 10);

  const scene = fsRead(`${root}/${SCAFFOLD_SCENE}`)
    .replaceAll('__LAB_NAME__', name)
    .replaceAll('ScaffoldLab', componentName);
  const notes = fsRead(`${root}/${SCAFFOLD_NOTES}`)
    .replaceAll('__LAB_NAME__', name)
    .replaceAll('__CREATED_DATE__', today);

  const registry = fsRead(`${root}/${REGISTRY}`);
  if (!registry.includes(IMPORTS_MARKER) || !registry.includes(ENTRIES_MARKER)) {
    err(`[lab] ${REGISTRY} is missing its rjit markers — restore them before scaffolding`);
    return 1;
  }
  const registered = registry
    .replace(IMPORTS_MARKER, `import ${componentName} from './${name}';\n${IMPORTS_MARKER}`)
    .replace(
      `  ${ENTRIES_MARKER}`,
      `  { name: '${name}', Component: ${componentName}, notesPath: '${notesPath}' },\n  ${ENTRIES_MARKER}`,
    );

  fsWrite(`${root}/${scenePath}`, scene);
  fsWrite(`${root}/${notesPath}`, notes);
  fsWrite(`${root}/${REGISTRY}`, registered);

  out(`[lab] scaffolded ${scenePath}`);
  out(`[lab] paired notes ${notesPath}`);
  out(`[lab] registered "${name}" in ${REGISTRY} — it lists on the labs route`);
  return 0;
}

function pascalCase(kebab: string): string {
  return kebab
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}
