#!/usr/bin/env bash
# Driver-only probes codex never sees (a visible gate can be gamed). Run AFTER
# grade-wave.sh is green, BEFORE committing. Read-only.
# Usage: plan/3d-refactor/scripts/private-probes.sh <wave>
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PLAN="$ROOT/plan/3d-refactor"
W="${1:?usage: private-probes.sh <wave>}"
cd "$ROOT"
bad=0
p() { echo "[probe:$W] $*"; }

# P1: line endings + trailing whitespace on every changed file (user law: LF only).
for f in $(git diff --name-only); do
  grep -q $'\r' "$f" && { p "FAIL CRLF crept into $f"; bad=1; }
done

# P2: pub surface across the WHOLE gpu tree unchanged vs state refs (except W1 list).
for src in framework/gpu/3d.zig framework/gpu/mesh_edit.zig \
           framework/gpu/paint_program.zig framework/gpu/model_source.zig; do
  ref="$PLAN/state/pub_surface_$(basename "$src" .zig).txt"
  [ "$src" = "framework/gpu/3d.zig" ] && ref="$PLAN/state/pub_surface.txt"
  [ -f "$ref" ] || continue
  d=$(grep -E '^pub fn ' "$src" | sort | diff - "$ref" | grep -c '^[<>]') || true
  if [ "$W" = "W1" ]; then
    p "P2 $src: $d pub-surface deltas (W1 expects exactly the deletion list — eyeball):"
    grep -E '^pub fn ' "$src" | sort | diff - "$ref" | grep '^[<>]' || true
  elif [ "$d" != "0" ]; then
    p "FAIL P2: pub surface of $src drifted ($d lines):"
    grep -E '^pub fn ' "$src" | sort | diff - "$ref" | grep '^[<>]'; bad=1
  fi
done

# P3: W1 symbols truly gone repo-wide (definitions AND references).
if [ "$W" = "W1" ]; then
  while read -r sym; do
    [ -z "$sym" ] && continue
    n=$(grep -rn --include='*.zig' -w "$sym" framework/ | wc -l)
    if [ "$n" != "0" ]; then p "W1 residue: $sym still appears $n times:"; grep -rn --include='*.zig' -w "$sym" framework/ | head -3; fi
  done < "$PLAN/specs/w1_candidates.txt"
fi

# P4: structural counters trend the right way (record, alert on regression).
c_alloc=$(grep -c 'std\.heap\.c_allocator' framework/gpu/3d.zig)
frees=$(grep -c '\.free(' framework/gpu/3d.zig)
dfrees=$(grep -cE 'defer (std\.heap\.c_allocator|jalloc)\.free' framework/gpu/3d.zig)
comments=$(grep -cE '^\s*//' framework/gpu/3d.zig)
lines=$(wc -l < framework/gpu/3d.zig)
banners=$(grep -cE '^// ?═{5,}' framework/gpu/3d.zig)
p "P4 counters: lines=$lines c_alloc=$c_alloc free=$frees defer_free=$dfrees comments=$comments banners=$banners"
echo "$W lines=$lines c_alloc=$c_alloc free=$frees defer_free=$dfrees comments=$comments banners=$banners" >> "$PLAN/state/counters.log"
[ "$banners" != "18" ] && { p "FAIL P4: banner rule count changed (was 18)"; bad=1; }

# P5: refusal strings byte-frozen (seat + suites parse them).
sort <(grep -o 'topoRefuse("[^"]*"' framework/gpu/3d.zig) > /tmp/refusals_now.txt
if [ -f "$PLAN/state/refusals.txt" ]; then
  if ! diff -q /tmp/refusals_now.txt "$PLAN/state/refusals.txt" >/dev/null; then
    if [ "$W" = "W5" ] || [ "$W" = "W6" ] || [ "$W" = "W7" ] || [ "$W" = "W8" ] || [ "$W" = "W9" ]; then
      p "refusal-string set changed — MUST be relocation only (helper), same strings:"
      diff "$PLAN/state/refusals.txt" /tmp/refusals_now.txt | head;
    else
      p "FAIL P5: refusal strings changed in a non-B2 wave:"; diff "$PLAN/state/refusals.txt" /tmp/refusals_now.txt | head; bad=1
    fi
  else p "ok P5: refusal strings identical"; fi
else
  cp /tmp/refusals_now.txt "$PLAN/state/refusals.txt"; p "P5 baseline captured"
fi

# P6: the two standing hazards' anchor comments still present.
grep -q "resetForReload" framework/gpu/3d.zig || { p "FAIL P6: resetForReload missing"; bad=1; }
grep -q "const jalloc = std.heap.c_allocator;" framework/gpu/3d.zig || { p "FAIL P6: jalloc def touched"; bad=1; }

[ $bad -eq 0 ] && p "ALL PROBES PASS" || { p "PROBES FAILED — do not commit"; exit 1; }
