#!/usr/bin/env bash
# W5 gate. Quiet: one line per check.
set -uo pipefail
Z=/home/siah/creative/reactjit/tools/zig/zig
bad=0
ok() { echo "ok  $1"; }
no() { echo "FAIL $1: $2"; bad=1; }

"$Z" ast-check work/3d.zig >/dev/null 2>&1 && ok "ast 3d.zig" || no "ast" "syntax broken"

# Helpers exist, private, exactly once.
for h in requireEditableMesh requireScopedSelectionMask; do
  c=$(grep -c "fn $h(" work/3d.zig)
  [ "$c" = "1" ] && ok "helper $h" || no "helper $h" "defined $c times"
  grep -q "pub fn $h" work/3d.zig && no "helper $h" "must be private" || true
done

# R2 signatures changed; zero implicit-allocator callers left.
grep -q 'fn collectCurrentFaceColors(a: std.mem.Allocator)' work/3d.zig && ok "colors sig" || no "colors sig" "not changed"
grep -q 'fn capturePartOfFaces(a: std.mem.Allocator)' work/3d.zig && ok "parts sig" || no "parts sig" "not changed"
c=$(grep -c 'collectCurrentFaceColors()' work/3d.zig); [ "$c" = "0" ] && ok "no argless colors calls" || no "colors callers" "$c argless remain"
c=$(grep -c 'capturePartOfFaces()' work/3d.zig); [ "$c" = "0" ] && ok "no argless parts calls" || no "parts callers" "$c argless remain"

# Refusal strings: multiset must be preserved (moves allowed, edits/drops not).
grep -o 'topoRefuse("[^"]*"' work/3d.zig | sort > /tmp/w5_refusals.txt
diff ref/refusals_pre.txt /tmp/w5_refusals.txt >/dev/null \
  && ok "refusal strings preserved" \
  || no "refusals" "$(diff ref/refusals_pre.txt /tmp/w5_refusals.txt | head -4)"

# pub surface frozen.
diff <(grep -E '^pub fn ' work/3d.zig | sort) ref/pub_surface.txt >/dev/null 2>&1 \
  && ok "pub surface frozen" || no "pub surface" "drifted"

# Journal call sites untouched in count.
while read -r j was; do
  now=$(grep -c "$j(" work/3d.zig)
  [ "$now" = "$was" ] && ok "journal $j count $now" || no "journal $j" "$was -> $now"
done < ref/journal_counts.txt

b=$(grep -cE '^// ?═{5,}' work/3d.zig); [ "$b" = "18" ] && ok "banners" || no "banners" "$b"
grep -qE 'usingnamespace|ArenaAllocator' work/3d.zig && no "banned" "introduced" || ok "no banned constructs"
grep -q 'const jalloc = std.heap.c_allocator;' work/3d.zig && ok "jalloc def intact" || no "jalloc" "definition touched"
grep -q $'\r' work/3d.zig && no "LF" "CRLF" || ok "LF endings"
[ -f REPORT.md ] && ok "REPORT.md" || no "REPORT.md" "missing"

[ $bad -eq 0 ] && echo "VERIFY PASS" || { echo "VERIFY FAIL"; exit 1; }
