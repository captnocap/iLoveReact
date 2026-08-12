#!/usr/bin/env bash
# W2 gate. Quiet: one line per check.
set -uo pipefail
Z=/home/siah/creative/reactjit/tools/zig/zig
bad=0
ok() { echo "ok  $1"; }
no() { echo "FAIL $1: $2"; bad=1; }

for f in work/*.zig; do
  "$Z" ast-check "$f" >/dev/null 2>&1 && ok "ast $f" || no "ast $f" "syntax broken"
done

# R1: segDist2 definitions gone everywhere; geo gained exactly the one pub fn.
d=$(grep -c 'fn segDist2' work/3d.zig work/mesh_edit.zig | awk -F: '{s+=$2} END{print s}')
if [ "$d" = "0" ]; then ok "segDist2 gone"; else
  grep -q "SKIPPED" REPORT.md && ok "segDist2 partial (skip recorded)" || no "segDist2" "$d definitions remain"; fi
grep -qc 'pub fn distancePointToSegmentSq' work/geo.zig >/dev/null && ok "geo helper added" || no "geo helper" "missing"
g=$(grep -c 'pub fn distancePointToSegmentSq' work/geo.zig); [ "$g" = "1" ] || no "geo helper" "defined $g times"

# R2/R3: makeInstance untouched; direct node-pattern sites reduced; helpers exist.
grep -q 'fn makeInstance(' work/3d.zig && ok "makeInstance kept" || no "makeInstance" "deleted/renamed"
mi=$(grep -c 'makeInstance(' work/3d.zig)
[ "$mi" -le 5 ] && ok "makeInstance sites now $mi (was 11 incl def)" || no "makeInstance sites" "$mi remain — conversion too shallow (or REPORT must justify each KEPT)"
grep -qE 'fn instanceFrom' work/3d.zig && ok "instance helpers exist" || no "instance helpers" "none defined"

# pub surface frozen for 3d.zig and mesh_edit.zig.
diff <(grep -E '^pub fn ' work/3d.zig | sort) ref/pub_surface.txt >/dev/null 2>&1 \
  && ok "pub surface 3d.zig frozen" || no "pub surface 3d" "drifted"
diff <(grep -E '^pub fn ' work/mesh_edit.zig | sort) ref/pub_surface_mesh_edit.txt >/dev/null 2>&1 \
  && ok "pub surface mesh_edit frozen" || no "pub surface mesh_edit" "drifted"

b=$(grep -cE '^// ?═{5,}' work/3d.zig); [ "$b" = "18" ] && ok "banners 18" || no "banners" "$b"
grep -q 'usingnamespace\|ArenaAllocator' work/3d.zig work/mesh_edit.zig work/geo.zig && no "banned" "usingnamespace/Arena introduced" || ok "no banned constructs"
grep -q $'\r' work/*.zig && no "LF" "CRLF found" || ok "LF endings"
[ -f REPORT.md ] && ok "REPORT.md" || no "REPORT.md" "missing"

[ $bad -eq 0 ] && echo "VERIFY PASS" || { echo "VERIFY FAIL"; exit 1; }
