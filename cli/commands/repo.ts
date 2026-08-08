// cli/commands/repo.ts — audit and correct what this repo publishes to GitHub.
//
//   rjit repo                    survey only. Announces every tracked path that is not
//                                declared source. Changes NOTHING.
//   rjit repo --candidates       also list untracked-and-unignored paths — the files that
//                                are one `git add -A` away from being published.
//   rjit repo archive <tree>...  zip the tree into archive/<name>.zip, verify the zip,
//                                untrack the tree, add an ignore rule. Keeps the files.
//   rjit repo unpublish <tree>... untrack + ignore, no zip (for assets and artifacts that
//                                are regenerable or already backed up elsewhere).
//
// THE ONE SAFETY PROPERTY, stated plainly: nothing in this file deletes anything from disk.
// The only git command it runs against a tree is `git rm --cached`, which drops a path from
// the index and leaves the bytes exactly where they are. Untracking is reversible with
// `git checkout -- <path>`; a wrong call here costs a re-add, never a file.
//
// That property is not incidental. On 2026-08-08 a freestyle `rm -rf` over a listing that
// read like build output destroyed an authored world map, and the ruling was that deletion
// belongs in a script that announces what it is doing (req_4083/req_4084). A publish audit
// is exactly the sort of sweeping, whole-tree operation that invites the same mistake, so
// it is built to not be able to make it.
//
// Refusals are as important as the actions. This command will not touch a path classified
// `source`, will not touch a path no rule covers, and will not touch a path whose rule
// carries `blockedBy` — because banning an escape hatch without providing the replacement
// produces a worse workaround than the one it removed.

import { err, out } from '../host/log.ts';
import { spawnSync } from '../host/process.ts';
import { fsExists, fsRead, fsWrite, tryFsStat } from '../host/fs.ts';
import {
  announce,
  classifyTracked,
  humanBytes,
  surveyTracked,
  trackedEntries,
  unpublishedCandidates,
} from '../dev/publishable.ts';

export async function run(argv: string[]): Promise<number> {
  const verb = argv[0];

  if (verb === 'archive' || verb === 'unpublish') {
    const trees = argv.slice(1).filter((arg) => !arg.startsWith('-'));
    if (trees.length === 0) {
      err(`[repo] ${verb}: name at least one tree`);
      err(`Usage: rjit repo ${verb} <tree>...`);
      return 1;
    }
    return applyVerb(verb, trees);
  }

  if (verb !== undefined && verb !== '--candidates') {
    err(`[repo] unknown verb: ${verb}`);
    err('Usage: rjit repo [--candidates] | rjit repo archive <tree>... | rjit repo unpublish <tree>...');
    return 1;
  }

  const entries = trackedEntries();
  if (entries.length === 0) {
    err('[repo] git ls-tree returned nothing — not a git repo, or HEAD is unborn');
    return 1;
  }

  const { findings, sourceFiles, sourceBytes } = surveyTracked(entries);
  announce(findings, sourceFiles, sourceBytes, out);

  if (argv.includes('--candidates')) reportCandidates();

  out('');
  out('[repo] this survey changed nothing. To act on a finding:');
  out('[repo]   rjit repo archive <tree>     zip to archive/, untrack, ignore, keep on disk');
  out('[repo]   rjit repo unpublish <tree>   untrack, ignore, keep on disk');
  out('[repo] to PUBLISH something reported undeclared, add it to cli/dev/publishable.ts');
  return 0;
}

/** Untracked and unignored, grouped so a long list stays readable. These are the next
 *  incident: a blanket `git add -A` publishes every one of them. */
function reportCandidates(): void {
  const candidates = unpublishedCandidates();
  out('');
  if (candidates.length === 0) {
    out('[repo] no untracked-and-unignored paths — nothing is one `git add -A` from publication');
    return;
  }
  out(`  ONE \`git add -A\` FROM PUBLICATION  —  ${candidates.length} untracked, unignored paths`);
  for (const path of candidates) {
    const verdict = classifyTracked(path.replace(/\/$/, ''));
    out(`    ${path}  →  would be ${verdict.kind}: ${verdict.what}`);
  }
}

function applyVerb(verb: 'archive' | 'unpublish', trees: string[]): number {
  const entries = trackedEntries();
  const { findings, sourceFiles, sourceBytes } = surveyTracked(entries);
  announce(findings, sourceFiles, sourceBytes, out);
  out('');

  const rjitHome = __env('RJIT_HOME') || __cwd();

  for (const raw of trees) {
    const tree = raw.replace(/\/+$/, '');
    const verdict = classifyTracked(tree);

    if (verdict.kind === 'source') {
      err(`[repo] REFUSED ${tree}: declared source (${verdict.what})`);
      err('[repo]   it belongs in a clone. Remove its rule from PUBLISH_RULES first if that is wrong.');
      return 1;
    }
    if (verdict.kind === 'unknown') {
      err(`[repo] REFUSED ${tree}: ${verdict.what}`);
      err('[repo]   declare it in cli/dev/publishable.ts first. An undeclared path never gets a default.');
      return 1;
    }
    if (verdict.blockedBy) {
      err(`[repo] REFUSED ${tree}: BLOCKED — ${verdict.blockedBy}`);
      err(`[repo]   provide first: ${verdict.insteadOf ?? 'the missing capability'}`);
      return 1;
    }

    const tracked = entries.filter((entry) => entry.path === tree || entry.path.startsWith(`${tree}/`));
    if (tracked.length === 0) {
      out(`[repo] ${tree}: already untracked — nothing to do`);
      continue;
    }
    const bytes = tracked.reduce((sum, entry) => sum + entry.bytes, 0);

    if (verb === 'archive') {
      const zipRel = `archive/${zipName(tree)}.zip`;
      const packed = packTree(rjitHome, tree, zipRel);
      if (packed !== 0) return packed;
      out(`[repo] ${tree}: packed → ${zipRel} (verified)`);
    }

    out(`[repo] ${tree}: untracking ${tracked.length} files (${humanBytes(bytes)}) — files stay on disk`);
    const removed = spawnSync('git', ['rm', '-r', '--cached', '--quiet', '--', tree]);
    if (removed.code !== 0) {
      err(`[repo] ${tree}: git rm --cached failed (exit ${removed.code})`);
      err(removed.stderr.trim());
      return removed.code || 1;
    }

    const ignoreLine = addIgnoreRule(rjitHome, tree, verdict.kind, verdict.what);
    out(`[repo] ${tree}: ${ignoreLine}`);
  }

  out('');
  out('[repo] staged. Nothing was deleted from disk; `git checkout -- <tree>` undoes any of it.');
  out('[repo] review with `git status`, then commit .gitignore together with the removals.');
  return 0;
}

/** archive/<name>.zip from a tree name, flattening any nesting. */
function zipName(tree: string): string {
  return tree.replace(/\//g, '-');
}

/** Zip the tree and VERIFY the result before the caller untracks anything. An unverified
 *  zip plus an untrack is how a "backup" becomes a loss. */
function packTree(rjitHome: string, tree: string, zipRel: string): number {
  const source = `${rjitHome}/${tree}`;
  if (!fsExists(source)) {
    err(`[repo] ${tree}: not on disk — refusing to archive a tree that is not there`);
    return 1;
  }
  const which = spawnSync('sh', ['-c', 'command -v zip']);
  if (which.code !== 0) {
    err('[repo] `zip` is not installed — cannot archive. Install zip, or use `unpublish` if the tree is already backed up.');
    return 1;
  }

  // The destination must not live inside the source. `archive/` is itself a declared frozen
  // tree, and `zip -r archive/archive.zip archive/` would walk the 2.6GB of untracked
  // material already sitting there — including the zip as it is being written.
  if (zipRel === tree || zipRel.startsWith(`${tree}/`)) {
    err(`[repo] ${tree}: the archive destination ${zipRel} is inside the tree being archived`);
    err(`[repo]   ${tree} is already an archive location — use \`rjit repo unpublish ${tree}\` instead.`);
    return 1;
  }

  const zipAbs = `${rjitHome}/${zipRel}`;
  if (fsExists(zipAbs)) {
    err(`[repo] ${zipRel} already exists — refusing to overwrite an existing archive`);
    return 1;
  }
  spawnSync('mkdir', ['-p', '--', `${rjitHome}/archive`]);

  out(`[repo] ${tree}: packing → ${zipRel} ...`);
  const packed = spawnSync('sh', ['-c', `cd ${shellQuote(rjitHome)} && zip -q -r -X ${shellQuote(zipRel)} ${shellQuote(tree)}`]);
  if (packed.code !== 0) {
    err(`[repo] ${tree}: zip failed (exit ${packed.code})`);
    err(packed.stderr.trim());
    return packed.code || 1;
  }

  const tested = spawnSync('zip', ['-T', zipAbs]);
  if (tested.code !== 0) {
    err(`[repo] ${zipRel}: zip -T verification FAILED — leaving the tree tracked`);
    err(tested.stdout.trim() || tested.stderr.trim());
    return 1;
  }
  return 0;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Append one ignore rule that says WHY, under a managed heading. The blocklist half of
 *  the decision still has to exist — git needs it — but every line this writes carries the
 *  class and the reason, so the next reader never has to reconstruct the incident. */
function addIgnoreRule(rjitHome: string, tree: string, kind: string, what: string): string {
  const path = `${rjitHome}/.gitignore`;
  const heading = '# ── Unpublished by `rjit repo` (see cli/dev/publishable.ts) ──────────────';
  // A trailing slash means "directory only" to git, so it silently fails to match a single
  // file. Ask the filesystem which one this is rather than guessing from the name.
  const isDir = tryFsStat(`${rjitHome}/${tree}`)?.isDir === true;
  const rule = isDir ? `/${tree}/` : `/${tree}`;
  const existing = fsExists(path) ? fsRead(path) : '';

  if (existing.split('\n').some((line) => line.trim() === rule || line.trim() === `/${tree}` || line.trim() === `/${tree}/`)) {
    return 'ignore rule already present';
  }

  const block = existing.includes(heading) ? '' : `\n${heading}\n`;
  const body = `# ${kind}: ${what}\n${rule}\n`;
  fsWrite(path, `${existing.replace(/\n*$/, '\n')}${block}${body}`);
  return `ignore rule added (${rule})`;
}
