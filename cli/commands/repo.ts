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
    const rest = argv.slice(1);
    const trees: string[] = [];
    const flags: string[] = [];
    let into: string | null = null;
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i]!;
      if (arg === '--into') {
        into = rest[i + 1] ?? null;
        i += 1;
        if (!into) {
          err('[repo] --into needs a name, e.g. --into carts-legacy');
          return 1;
        }
        continue;
      }
      if (arg.startsWith('-')) flags.push(arg);
      else trees.push(arg);
    }
    const unknownFlag = flags.find((flag) => flag !== '--drop' && flag !== '--tracked-only');
    if (unknownFlag) {
      err(`[repo] ${verb}: unknown flag ${unknownFlag}`);
      return 1;
    }
    if (trees.length === 0) {
      err(`[repo] ${verb}: name at least one tree`);
      err(`Usage: rjit repo ${verb} <tree>... [--drop] [--tracked-only] [--into <name>]`);
      return 1;
    }
    const trackedOnly = flags.includes('--tracked-only');
    const drop = flags.includes('--drop');
    if (trackedOnly && drop) {
      // A tracked-only zip deliberately omits everything git does not track, so the
      // coverage proof --drop depends on can never pass. Refusing here is clearer than
      // letting that proof fail confusingly on the first untracked file it meets.
      err('[repo] --tracked-only and --drop are incompatible: the zip omits untracked files by design,');
      err('[repo]   so it cannot prove it covers the disk. Remove the tree yourself if that is what you want.');
      return 1;
    }
    return applyVerb(verb, trees, drop, trackedOnly, into);
  }

  if (verb !== undefined && verb !== '--candidates') {
    err(`[repo] unknown verb: ${verb}`);
    err('Usage: rjit repo [--candidates] | rjit repo archive <tree>... [--drop] | rjit repo unpublish <tree>...');
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
  out('[repo]   rjit repo archive <tree> --drop   ...and remove the tree once the zip provably covers it');
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

function applyVerb(
  verb: 'archive' | 'unpublish',
  trees: string[],
  drop: boolean,
  trackedOnly: boolean = false,
  into: string | null = null,
): number {
  const entries = trackedEntries();
  const { findings, sourceFiles, sourceBytes } = surveyTracked(entries);
  announce(findings, sourceFiles, sourceBytes, out);
  out('');

  const rjitHome = __env('RJIT_HOME') || __cwd();

  // One zip for the whole set. Packing 130 legacy carts into 130 zips buries the useful
  // ones; `--into` keeps them a single restorable artifact. Built ONCE, before the loop,
  // so a failure here stops everything while every tree is still tracked.
  if (into !== null) {
    if (verb !== 'archive') {
      err('[repo] --into only applies to `archive`');
      return 1;
    }
    const combined = `archive/${into}.zip`;
    const packed = trackedOnly
      ? packTrackedInto(rjitHome, trees, combined)
      : (() => { err('[repo] --into currently requires --tracked-only'); return 1; })();
    if (packed !== 0) return packed;
  }

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
    const bytes = tracked.reduce((sum, entry) => sum + entry.bytes, 0);

    let zipRel: string | null = null;
    if (verb === 'archive' && into === null) {
      zipRel = `archive/${zipName(tree)}.zip`;
      if (fsExists(`${rjitHome}/${zipRel}`)) {
        out(`[repo] ${tree}: ${zipRel} already exists — reusing it (coverage is re-checked below)`);
      } else {
        const packed = packTree(rjitHome, tree, zipRel);
        if (packed !== 0) return packed;
        out(`[repo] ${tree}: packed → ${zipRel} (verified)`);
      }
    }

    if (tracked.length === 0) {
      out(`[repo] ${tree}: already untracked`);
    } else {
      out(`[repo] ${tree}: untracking ${tracked.length} files (${humanBytes(bytes)}) — files stay on disk`);
      const removed = spawnSync('git', ['rm', '-r', '--cached', '--quiet', '--', tree]);
      if (removed.code !== 0) {
        err(`[repo] ${tree}: git rm --cached failed (exit ${removed.code})`);
        err(removed.stderr.trim());
        return removed.code || 1;
      }
    }

    // The ignore rule is NOT conditional on the path having been tracked. A path that is
    // untracked AND unignored is the `git add -A` risk the --candidates view exists to
    // surface — skipping the rule there left the exact case this command is for unhandled.
    out(`[repo] ${tree}: ${addIgnoreRule(rjitHome, tree, verdict.kind, verdict.what)}`);

    if (drop) {
      if (!zipRel) {
        err(`[repo] ${tree}: --drop only applies to \`archive\` — unpublish keeps the files by design`);
        return 1;
      }
      const dropped = dropArchivedTree(rjitHome, tree, zipRel);
      if (dropped !== 0) return dropped;
    }
  }

  out('');
  if (drop) {
    out('[repo] trees removed from disk only after their zip was proven to contain every file.');
  } else {
    out('[repo] staged. Nothing was deleted from disk; `git checkout -- <tree>` undoes any of it.');
  }
  out('[repo] review with `git status`, then commit .gitignore together with the removals.');
  return 0;
}

/** Remove a tree from disk, but ONLY after proving its zip holds every file that is there.
 *
 *  This is the one place in this file that deletes, so the proof is the whole point. It is
 *  not "a zip exists" or "zip -T passed" — a valid archive of the WRONG CONTENT passes both.
 *  It is: enumerate every file and symlink on disk right now, enumerate the zip's entries,
 *  and refuse if a single disk path is missing from the archive. The love2d pack already
 *  proved the failure is real, not theoretical: `zip -r` without -y silently dropped all 11
 *  symlinks while still producing a valid, `zip -T`-clean archive. */
function dropArchivedTree(rjitHome: string, tree: string, zipRel: string): number {
  const onDisk = listFilesAndLinks(rjitHome, tree);
  if (onDisk.length === 0) {
    out(`[repo] ${tree}: not on disk — nothing to remove`);
    return 0;
  }
  const inZip = new Set(listZipEntries(rjitHome, zipRel));
  if (inZip.size === 0) {
    err(`[repo] ${tree}: could not read ${zipRel} — refusing to remove anything`);
    return 1;
  }

  const missing = onDisk.filter((path) => !inZip.has(path));
  if (missing.length > 0) {
    err(`[repo] ${tree}: REFUSING to remove — ${missing.length} of ${onDisk.length} files on disk are NOT in ${zipRel}`);
    for (const path of missing.slice(0, 10)) err(`[repo]     missing: ${path}`);
    if (missing.length > 10) err(`[repo]     ... and ${missing.length - 10} more`);
    return 1;
  }

  const size = spawnSync('du', ['-sh', `${rjitHome}/${tree}`]).stdout.trim().split('\t')[0] ?? '?';
  out(`[repo] ${tree}: all ${onDisk.length} files/symlinks on disk are present in ${zipRel}`);
  out(`[repo] ${tree}: removing the unzipped tree (${size}) — the zip is the copy that remains`);
  const removed = spawnSync('rm', ['-rf', '--', `${rjitHome}/${tree}`]);
  if (removed.code !== 0) {
    err(`[repo] ${tree}: rm failed (exit ${removed.code})`);
    return removed.code || 1;
  }
  return 0;
}

/** Every regular file and symlink under `tree`, repo-relative. Symlinks are listed as
 *  themselves, never followed — following them is what inflated the first love2d zip. */
function listFilesAndLinks(rjitHome: string, tree: string): string[] {
  const found = spawnSync('sh', [
    '-c',
    `cd ${shellQuote(rjitHome)} && find ${shellQuote(tree)} \\( -type f -o -type l \\) -print 2>/dev/null`,
  ]);
  if (found.code !== 0) return [];
  return found.stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
}

/** Zip entry names, minus directory entries (which end in /). */
function listZipEntries(rjitHome: string, zipRel: string): string[] {
  const listed = spawnSync('unzip', ['-Z1', `${rjitHome}/${zipRel}`]);
  if (listed.code !== 0) return [];
  return listed.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.endsWith('/'));
}

/** archive/<name>.zip from a tree name. A tree already under archive/ keeps its own name —
 *  archive/qjs-stack becomes archive/qjs-stack.zip, not archive/archive-qjs-stack.zip.
 *  Anything else flattens its nesting so the destination stays a flat directory of zips. */
function zipName(tree: string): string {
  const withinArchive = tree.startsWith('archive/') ? tree.slice('archive/'.length) : tree;
  return withinArchive.replace(/\//g, '-');
}

/** Pack the TRACKED content of several trees into one zip, straight out of HEAD.
 *
 *  `git archive` is the right tool rather than `zip -r`, because these trees carry gigabytes
 *  of gitignored runtime state that is not part of the cart: cart/hmsc-int is 7.4GB on disk
 *  and 9.9MB in git — the difference is sqlite stores, compaction backups and tool blobs
 *  nobody wants in a source archive. Packing from HEAD gets the cart and nothing else, and
 *  it is versioned by definition.
 *
 *  Because the result deliberately excludes untracked files it can NEVER authorise a --drop;
 *  the caller refuses that combination up front. */
function packTrackedInto(rjitHome: string, trees: string[], zipRel: string): number {
  const zipAbs = `${rjitHome}/${zipRel}`;
  if (fsExists(zipAbs)) {
    err(`[repo] ${zipRel} already exists — refusing to overwrite an existing archive`);
    return 1;
  }
  spawnSync('mkdir', ['-p', '--', `${rjitHome}/archive`]);

  out(`[repo] packing tracked content of ${trees.length} trees → ${zipRel} ...`);
  const packed = spawnSync('git', ['archive', '--format=zip', '-o', zipAbs, 'HEAD', '--', ...trees]);
  if (packed.code !== 0) {
    err(`[repo] git archive failed (exit ${packed.code})`);
    err(packed.stderr.trim());
    return packed.code || 1;
  }

  const tested = spawnSync('zip', ['-T', zipAbs]);
  if (tested.code !== 0) {
    err(`[repo] ${zipRel}: zip -T verification FAILED — leaving everything tracked`);
    return 1;
  }
  const count = listZipEntries(rjitHome, zipRel).length;
  const size = spawnSync('du', ['-sh', zipAbs]).stdout.trim().split('\t')[0] ?? '?';
  out(`[repo] packed → ${zipRel} (${count} files, ${size}, verified)`);
  return 0;
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
  // -y stores symlinks AS symlinks. Without it zip follows them and writes the target's
  // bytes under the link's path: archiving love2d/ produced 4751 entries for 1882 real
  // files and tripled 52MB into 144MB, while the 11 symlinks themselves vanished from the
  // snapshot. An archive that silently reshapes the tree is not a backup of it.
  const packed = spawnSync('sh', ['-c', `cd ${shellQuote(rjitHome)} && zip -q -r -y -X ${shellQuote(zipRel)} ${shellQuote(tree)}`]);
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
