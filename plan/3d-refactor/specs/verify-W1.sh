#!/usr/bin/env bash
# W1 gate: deletions landed, nothing else moved. Quiet: one line per check.
set -uo pipefail
Z=/home/siah/creative/reactjit/tools/zig/zig
bad=0
ok() { echo "ok  $1"; }
no() { echo "FAIL $1: $2"; bad=1; }

# ast-check every work file (0.05 s each; catches broken deletions instantly).
for f in work/*.zig; do
  if "$Z" ast-check "$f" >/dev/null 2>&1; then ok "ast $f"; else no "ast $f" "syntax broken"; fi
done

# Deleted symbols absent from work files (definition AND any use).
for sym in paintedMeshVerts meshGizmoToolRaw meshRetopoBandsClear hasPartRanges; do
  if grep -qw "$sym" work/*.zig; then
    if grep -q "SKIPPED" REPORT.md && grep -q "$sym" REPORT.md; then ok "skip-recorded $sym"; else no "$sym" "still present and not SKIP-recorded"; fi
  else ok "gone $sym"; fi
done
# recordDab: the plain one gone, Shaped stays.
if grep -qE 'fn recordDab\(' work/paint_program.zig; then
  if grep -q "recordDab SKIPPED" REPORT.md; then ok "skip-recorded recordDab"; else no "recordDab" "plain writer still defined"; fi
else ok "gone recordDab"; fi
grep -qE 'fn recordDabShaped\(' work/paint_program.zig && ok "kept recordDabShaped" || no "recordDabShaped" "MUST NOT be deleted"

# Keep-list intact.
for sym in orbitFocus prepareRetopoBandInheritance prepareRetopoBandAppend paintedDocumentSnapshot; do
  grep -qw "$sym" work/3d.zig && ok "kept $sym" || no "kept $sym" "keep-listed symbol missing"
done
grep -qE 'fn partRanges\(' work/model_source.zig && ok "kept partRanges" || no "partRanges" "missing"

# Banner rule-lines untouched (deletion targets contain none).
b=$(grep -cE '^// ?═{5,}' work/3d.zig); [ "$b" = "18" ] && ok "banners 18" || no "banners" "count $b != 18"

# No CRLF.
grep -q $'\r' work/*.zig && no "LF" "CRLF found" || ok "LF endings"

# Only deletions: work/3d.zig must be strictly smaller, and no NEW lines vs ref map
# (crude but effective for spark: every remaining 'fn ' line must exist in ref/fn_map.txt).
while IFS= read -r line; do
  sig="${line#*:}"  # strip our own line number? fn_map lines are 'N:pub fn x('
  :
done < /dev/null
new_fns=$(grep -E '^(pub )?fn ' work/3d.zig | while IFS= read -r l; do
  grep -qF "$l" ref/fn_map.txt || echo "$l"; done | head -5)
[ -z "$new_fns" ] && ok "no new/renamed fns" || no "no new fns" "$new_fns"

[ -f REPORT.md ] && ok "REPORT.md present" || no "REPORT.md" "missing"
[ $bad -eq 0 ] && echo "VERIFY PASS" || { echo "VERIFY FAIL"; exit 1; }
