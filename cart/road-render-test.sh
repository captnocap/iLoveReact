#!/usr/bin/env bash
# road-render-test.sh — the REAL-GPU regression test for the painted-road render
# bug (req_0833 / req_0835). NOT a JS reproduction of the shader (those kept lying
# that the road resolves fine). It boots the road-render-test cart HEADLESS, renders
# the actual WGSL on the GPU, captures the swapchain, and reads the rendered colour
# back at six named road cells. It FAILS while the bug is live, PASSES when the road
# renders as asphalt on the 3D mesh.
#
# Two routes (one cart, one shared chunk(1,0) tile field from coastal-town):
#   /mesh  — the iso-3D ground path: <Landform> groundFormula mesh evaluated per
#            fragment by framework/gpu/3d.zig (what the editor's iso pane shows).
#            THE PATH UNDER TEST. The bug makes these cells render concrete.
#   /quad  — the SAME formula as a 2D <Effect> quad. The formula renders the road
#            correctly here — the control that proves the DATA is road and the
#            classifier detects asphalt when it is actually drawn. If /quad ever
#            stops showing asphalt, the test harness itself is broken, not the mesh.
#
# Addressing: /mesh draws four pure-colour ground fiducials; the checker finds them
# and solves the ground-plane->pixel homography, then samples each cell. /quad uv is
# linear so cell(cx,cy) -> ((cx+.5)/120*W,(cy+.5)/120*H) directly.
#
# asphalt(fill_road) is dark (rgb ~0.03-0.13); concrete(fill_concrete) is light tan
# (~0.40-0.72). A road cell that reads light rendered as concrete = the bug.
#
# Usage:  ./cart/road-render-test.sh        # 0 = PASS (road is asphalt on the mesh)
set -euo pipefail
cd "$(dirname "$0")/.."
MESH=/tmp/road-mesh.png
QUAD=/tmp/road-quad.png

echo "[road-test] shooting /mesh (iso-3D mesh path — under test)..."
tools/rjit shot road-render-test --route /mesh --out "$MESH" --frames 90 --timeout 120 >/dev/null
echo "[road-test] shooting /quad (2D formula control)..."
tools/rjit shot road-render-test --route /quad --out "$QUAD" --frames 90 --timeout 120 >/dev/null

python3 - "$MESH" "$QUAD" <<'PY'
import sys, numpy as np
from PIL import Image

# Fiducials: world (x,z) -> the marker colour the cart draws (KEEP IN SYNC with the
# MARKERS array in cart/road-render-test.tsx).
FIDUCIALS = [((125,105),'R'), ((160,105),'G'), ((160,122),'B'), ((125,122),'C')]
# The six cells under test: world cell (gx,gz) and the kind the tile data holds.
CELLS = {'EK111':(140,111,'median'), 'EI111':(138,111,'laneSouth'),
         'EI112':(138,112,'laneSouth'), 'EI113':(138,113,'laneSouth'),
         'EI114':(138,114,'laneSouth'), 'EJ111':(139,111,'laneSouth')}
COLS = ROWS = 120  # chunk(1,0) tile grid; chunk min-corner world cell = (120,0)

def load(p):
    return np.asarray(Image.open(p).convert('RGB')).astype(np.float64)

def fiducial_px(im):
    R,G,B = im[:,:,0],im[:,:,1],im[:,:,2]
    score = {'R':R-np.maximum(G,B),'G':G-np.maximum(R,B),
             'B':B-np.maximum(R,G),'C':np.minimum(G,B)-R}
    out={}
    for s,m in score.items():
        y,x=np.unravel_index(np.argmax(m),m.shape); out[s]=(float(x),float(y))
    return out

def homography(im):
    px=fiducial_px(im); A=[];b=[]
    for (wx,wz),tag in FIDUCIALS:
        x,y=px[tag]
        A.append([wx,wz,1,0,0,0,-x*wx,-x*wz]); b.append(x)
        A.append([0,0,0,wx,wz,1,-y*wx,-y*wz]); b.append(y)
    h=np.linalg.solve(np.array(A),np.array(b))
    H=np.array([[h[0],h[1],h[2]],[h[3],h[4],h[5]],[h[6],h[7],1]])
    return lambda wx,wz:(lambda v:(v[0]/v[2],v[1]/v[2]))(H@np.array([wx,wz,1.0]))

def sample(im,px,py,r=3):
    x0,y0=int(round(px)),int(round(py))
    return im[max(0,y0-r):y0+r+1, max(0,x0-r):x0+r+1].reshape(-1,3).mean(0)

def classify(rgb):
    r,g,b=rgb; lum=(r+g+b)/3
    if r>120 and g>110 and b<90 and r-b>60: return 'YELLOW'  # median centreline
    if r-b>35 and lum>70: return 'SAND'
    return 'ROAD' if lum<70 else 'CONCRETE'

mesh=load(sys.argv[1]); quad=load(sys.argv[2])
mH,mW=mesh.shape[:2]; w2p=homography(mesh)

print(f"\naddr   data        | /quad (2D control)        | /mesh (iso-3D mesh — under test)")
print( "-------------------+---------------------------+----------------------------------")
fails=[]; control_fail=[]
for a,(gx,gz,kind) in CELLS.items():
    cx,cy=gx-120,gz
    qrgb=sample(quad,(cx+0.5)/COLS*quad.shape[1],(cy+0.5)/ROWS*quad.shape[0])
    qcl=classify(qrgb)
    mpx,mpy=w2p(gx+0.5,gz+0.5); mrgb=sample(mesh,mpx,mpy); mcl=classify(mrgb)
    qok = qcl in ('ROAD','YELLOW'); mok = mcl in ('ROAD','YELLOW')
    if not qok: control_fail.append(a)
    if not mok: fails.append((a,mcl,mrgb))
    print(f"{a:6} {kind:11}| [{qrgb[0]:5.1f},{qrgb[1]:5.1f},{qrgb[2]:5.1f}] {qcl:8} | "
          f"[{mrgb[0]:5.1f},{mrgb[1]:5.1f},{mrgb[2]:5.1f}] {mcl:8} {'OK' if mok else 'FAIL'}")

print()
if control_fail:
    print(f"[road-test] HARNESS BROKEN: /quad (control) did not render asphalt at {control_fail} —")
    print( "            the data or the classifier is wrong; the /mesh result cannot be trusted.")
    sys.exit(2)
if fails:
    print(f"[road-test] FAIL — {len(fails)} road cell(s) render as CONCRETE on the iso-3D mesh,")
    print( "            though the tile data is road AND the same formula draws asphalt on /quad.")
    print( "            The bug is in the 3D mesh ground path (framework/gpu/3d.zig), not the data/formula.")
    for a,cl,rgb in fails:
        print(f"              {a}: rendered {cl} rgb=[{rgb[0]:.0f},{rgb[1]:.0f},{rgb[2]:.0f}] (expected dark asphalt)")
    sys.exit(1)
print("[road-test] PASS — all road cells render as asphalt on the iso-3D mesh.")
PY
