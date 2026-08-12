#!/usr/bin/env bash
# Assemble the isolated codex workdir for one wave. Codex NEVER touches the live
# tree; it edits copies under /tmp/codex-3d/<wave>/work/ and the driver promotes.
# Usage: plan/3d-refactor/scripts/build-workdir.sh <W1..W9|OF1..OF4>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PLAN="$ROOT/plan/3d-refactor"
W="${1:?usage: build-workdir.sh <wave>}"
source "$PLAN/scripts/waves.env"
FILES="$(wave_files "$W")"
WD="/tmp/codex-3d/$W"

if [ -d "$WD" ]; then
  echo "[build-workdir] removing previous scratch workdir $WD (contents:)"
  ls -la "$WD" || true
  rm -rf "$WD"
fi
mkdir -p "$WD/work" "$WD/ref"

# Working copies from the LIVE tree (post last ratchet commit).
for f in $FILES; do
  cp "$ROOT/$f" "$WD/work/$(basename "$f")"
  echo "[build-workdir] work/$(basename "$f") <- $f ($(wc -l < "$ROOT/$f") lines)"
done

# Spec + verify gate.
cp "$PLAN/specs/SPEC-$W.md" "$WD/SPEC.md"
cp "$PLAN/specs/verify-$W.sh" "$WD/verify.sh" && chmod +x "$WD/verify.sh"

# Reference material (read-only for codex).
cp "$PLAN/state/fn_map.txt" "$WD/ref/" 2>/dev/null || true
for p in "$PLAN"/state/pub_surface*.txt; do [ -f "$p" ] && cp "$p" "$WD/ref/"; done

case "$W" in
  W1)
    # Reference report: repo-wide reference count per deletion candidate, computed
    # NOW against the live tree. Spark deletes ONLY symbols listed with refs=0.
    : > "$WD/ref/references_report.txt"
    while read -r sym; do
      [ -z "$sym" ] && continue
      n=$(grep -rn --include='*.zig' --include='*.ts' --include='*.tsx' -w "$sym" \
            "$ROOT/framework" "$ROOT/cart" "$ROOT/runtime" "$ROOT/renderer" 2>/dev/null \
          | grep -v -E '(fn |pub fn )'"$sym" | wc -l)
      echo "$sym refs=$n" >> "$WD/ref/references_report.txt"
    done < "$PLAN/specs/w1_candidates.txt"
    cp "$PLAN/specs/w1_candidates.txt" "$WD/ref/"
    echo "[build-workdir] reference report:"; cat "$WD/ref/references_report.txt"
    ;;
  W5)
    # Exemplar: the modern-idiom op codex must match.
    S=$(grep -n "pub fn meshSolidifySelection" "$ROOT/framework/gpu/3d.zig" | head -1 | cut -d: -f1)
    sed -n "${S},$((S+130))p" "$ROOT/framework/gpu/3d.zig" > "$WD/ref/exemplar_solidify.txt"
    echo "[build-workdir] exemplar_solidify.txt lines $S..$((S+130))"
    # OPS list: driver MUST hand-prune this before launch (runbook step).
    grep -nE '^pub fn mesh(Delete|Weld|TopoDelete|Hide|Show|PartHide|PartShow)' \
      "$ROOT/framework/gpu/3d.zig" > "$WD/ref/OPS.txt" || true
    echo "[build-workdir] OPS.txt candidates (PRUNE BY HAND before launch):"
    cat "$WD/ref/OPS.txt"
    # Frozen-state refs for the verify gate.
    grep -o 'topoRefuse("[^"]*"' "$ROOT/framework/gpu/3d.zig" | sort > "$WD/ref/refusals_pre.txt"
    : > "$WD/ref/journal_counts.txt"
    for j in journalSnapshotCurrent journalSnapshotForNewAction journalCommit journalDiscard; do
      echo "$j $(grep -c "$j(" "$ROOT/framework/gpu/3d.zig")" >> "$WD/ref/journal_counts.txt"
    done
    ;;
esac

echo "[build-workdir] $WD ready. Launch:"
M="$(wave_model "$W")"
if [ -n "$M" ]; then MFLAG="-m $M"; else MFLAG="(terra default, no -m)"; fi
echo "  cd $WD && codex exec $MFLAG --sandbox workspace-write --skip-git-repo-check \"\$(cat SPEC.md)\" > codex.log 2>&1"
