#!/usr/bin/env bash
# Verify gate for req_3114: extrude-edge must leave the NEW extruded edge selected.
# Quiet by design: one line per check. Exit 0 = all pass.
set -u
cd /home/siah/creative/reactjit

LOG=$(mktemp /tmp/extrude-verify-XXXX.log)
BLOG=$(mktemp /tmp/extrude-build-XXXX.log)
fail() { echo "FAIL: $1"; echo "  build log: $BLOG"; echo "  run log: $LOG"; exit 1; }

# [1] Build the raw editor binary (no packaging). Serialized by the ship flock.
SHIP_RUN_PACKAGE=0 ./tools/rjit ship editor >"$BLOG" 2>&1 || fail "build (tail: $(tail -3 "$BLOG" | tr '\n' ' '))"
echo "PASS: build"

# [2] Headless gesture harness: fresh cube, select welded edge 0, extrude, then
# delete the selection. All assertions read the [meshops] stderr lines.
timeout 120 env ZIGOS_HEADLESS=1 ZIGOS_SCREENSHOT=1 \
  ZIGOS_SCREENSHOT_OUTPUT=/tmp/extrude-verify.png ZIGOS_SCREENSHOT_FRAMES=300 \
  RJIT_MODELDOC=cube \
  RJIT_MESHOPS="mode:2;edge:0;report;extrudeedge:0.5;report;del;report" \
  zig-out/bin/editor >"$LOG" 2>&1 || fail "harness run (exit != 0)"

REPORTS=$(grep -o 'report → {[^}]*}' "$LOG")
R1=$(echo "$REPORTS" | sed -n 1p)
R2=$(echo "$REPORTS" | sed -n 2p)
R3=$(echo "$REPORTS" | sed -n 3p)

# [2a] Sanity: edge 0 selected before the op.
echo "$R1" | grep -q '"sel":1' || fail "pre-op edge select broke: $R1"
echo "PASS: pre-op select (sel:1)"

# [2b] Extrude succeeded and appended one quad (36 → 42 soup verts).
grep -q 'extrudeedge:0.5 → {"ok":1,.*"count":42}' "$LOG" || fail "extrude op: $(grep 'extrudeedge' "$LOG")"
echo "PASS: extrude ok, count 42"

# [2c] THE FIX: after extrude, exactly one edge is selected, still edge mode.
echo "$R2" | grep -q '"mode":2' || fail "post-extrude mode: $R2"
echo "$R2" | grep -q '"sel":1'  || fail "post-extrude selection empty (the req_3114 bug): $R2"
echo "PASS: post-extrude selection (sel:1)"

# [2d] The selected edge is the NEW one: del removes the single triangle that
# CONTAINS the selected edge. The new edge c–d lies on one of the quad's two
# fan triangles; deleting it orphans c (verts 10→9) and exposes the quad
# diagonal (edges 15→14). If the OLD edge were selected, c's triangle would
# survive (verts stay 10) — this line discriminates.
echo "$R3" | grep -q '"verts":9,"edges":14' || fail "del signature wrong — selected edge is not the new extruded edge: $R3"
echo "PASS: selected edge IS the new extruded edge (del left verts:9/edges:14)"

echo "ALL PASS"
exit 0
