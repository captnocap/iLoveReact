#!/usr/bin/env bash
# road-render-test.sh — the REAL-GPU regression test for the painted-road render
# bug (req_0833 / req_0835 / req_0837). NOT a JS reproduction of the shader (those
# kept lying that the road resolves fine). It boots the road-render-test cart
# HEADLESS, renders the actual WGSL on the GPU, captures the swapchain, and reads the
# rendered colour back at named road cells. FAIL while the bug is live, PASS when the
# road renders as asphalt on the 3D mesh.
#
# Two routes (one cart, one shared chunk(1,0) tile field from coastal-town):
#   /mesh[/cx/cz] — the iso-3D ground path under test: <Landform> groundFormula mesh
#                   evaluated per fragment by framework/gpu/3d.zig, real IsoStage
#                   camera, recentred on (cx,cz) so distant cells sample at resolution.
#   /quad         — the SAME formula as a 2D <Effect> quad: the control that proves
#                   the DATA is road and the classifier detects asphalt when drawn.
#
# Addressing on /mesh: four ground fiducials at ±FID_DX/±FID_DZ around the view
# centre → ground-plane->pixel homography. /quad uv is linear: cell(cx,cy) ->
# ((cx+.5)/120*W,(cy+.5)/120*H). asphalt(fill_road) is dark; concrete(fill_concrete)
# is light tan — a road cell reading light rendered as concrete = the bug.
#
# Usage:
#   ./cart/road-render-test.sh                                 # default region (z~112), expect FAIL
#   ./cart/road-render-test.sh 139 11 EI10 EI11 EI12 EJ12 EK12 # a chosen region + cells
#       arg1 arg2 = view centre world (x,z); rest = cell addresses (must be road cells)
set -euo pipefail
cd "$(dirname "$0")/.."

# Defaults: the z~112 region the bug shows at.
CX=142.5; CZ=113.5
ADDRS=(EK111 EI111 EI112 EI113 EI114 EJ111)
if [ "$#" -ge 3 ]; then CX="$1"; CZ="$2"; shift 2; ADDRS=("$@"); fi

MESH=/tmp/road-mesh.png
QUAD=/tmp/road-quad.png
echo "[road-test] centre=($CX,$CZ) cells: ${ADDRS[*]}"
echo "[road-test] shooting /mesh (iso-3D mesh path — under test)..."
tools/rjit shot road-render-test --route "/mesh/$CX/$CZ" --out "$MESH" --frames 90 --timeout 120 >/dev/null
echo "[road-test] shooting /quad (2D formula control)..."
tools/rjit shot road-render-test --route /quad --out "$QUAD" --frames 90 --timeout 120 >/dev/null

python3 - "$MESH" "$QUAD" "$CX" "$CZ" "${ADDRS[@]}" <<'PY'
import sys, numpy as np
from PIL import Image

mesh_p, quad_p, CX, CZ = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
ADDRS = sys.argv[5:]
FID_DX, FID_DZ = 17.5, 8.5          # MUST match cart/road-render-test.tsx
COLS = ROWS = 120                    # chunk(1,0) tile grid; min-corner world cell (120,0)

def col_index(letters):              # bijective base-26 (A=0,...,Z=25,AA=26): inverse of address.ts
    n = 0
    for ch in letters.upper(): n = n*26 + (ord(ch)-ord('A')+1)
    return n-1

def parse_addr(a):                   # "EI112" -> (gx,gz)
    i = 0
    while i < len(a) and a[i].isalpha(): i += 1
    return col_index(a[:i]), int(a[i:])

# Fiducials: world (x,z) -> marker colour, by the SAME rule the cart uses.
FIDUCIALS = [((CX-FID_DX, CZ-FID_DZ),'R'), ((CX+FID_DX, CZ-FID_DZ),'G'),
             ((CX+FID_DX, CZ+FID_DZ),'B'), ((CX-FID_DX, CZ+FID_DZ),'C')]

def load(p): return np.asarray(Image.open(p).convert('RGB')).astype(np.float64)

def fiducial_px(im):
    # CENTROID of each colour blob, not argmax: a marker is ~80px wide, so the single
    # brightest pixel can sit anywhere in it and skew the homography by a whole cell
    # (which false-flagged road cells next to the concrete sidewalk). The centroid of
    # the strongly-coloured pixels is the marker's true centre.
    R,G,B = im[:,:,0],im[:,:,1],im[:,:,2]
    score = {'R':R-np.maximum(G,B),'G':G-np.maximum(R,B),
             'B':B-np.maximum(R,G),'C':np.minimum(G,B)-R}
    out={}
    for s,m in score.items():
        mask = m >= max(m.max()*0.6, 80.0)
        ys,xs = np.where(mask)
        out[s] = (float(xs.mean()), float(ys.mean()))
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
    if r>120 and g>110 and b<90 and r-b>60: return 'YELLOW'   # median centreline
    if r-b>35 and lum>70: return 'SAND'
    return 'ROAD' if lum<70 else 'CONCRETE'

mesh=load(mesh_p); quad=load(quad_p); w2p=homography(mesh)
print(f"\naddr   worldXZ      | /quad (2D control)        | /mesh (iso-3D mesh — under test)")
print( "--------------------+---------------------------+----------------------------------")
fails=[]; control_fail=[]
for a in ADDRS:
    gx,gz=parse_addr(a); cx,cy=gx-120,gz
    qrgb=sample(quad,(cx+0.5)/COLS*quad.shape[1],(cy+0.5)/ROWS*quad.shape[0]); qcl=classify(qrgb)
    mpx,mpy=w2p(gx+0.5,gz+0.5); mrgb=sample(mesh,mpx,mpy); mcl=classify(mrgb)
    qok=qcl in ('ROAD','YELLOW'); mok=mcl in ('ROAD','YELLOW')
    if not qok: control_fail.append(a)
    if not mok: fails.append((a,mcl,mrgb))
    print(f"{a:6} ({gx},{gz})  | [{qrgb[0]:5.1f},{qrgb[1]:5.1f},{qrgb[2]:5.1f}] {qcl:8} | "
          f"[{mrgb[0]:5.1f},{mrgb[1]:5.1f},{mrgb[2]:5.1f}] {mcl:8} {'OK' if mok else 'FAIL'}")
print()
if control_fail:
    print(f"[road-test] HARNESS BROKEN: /quad (control) did not render asphalt at {control_fail} —")
    print( "            the data or classifier is wrong; the /mesh result cannot be trusted.")
    sys.exit(2)
if fails:
    print(f"[road-test] FAIL — {len(fails)} road cell(s) render as CONCRETE on the iso-3D mesh,")
    print( "            though the data is road AND the same formula draws asphalt on /quad.")
    print( "            Bug is in the 3D mesh ground path (framework/gpu/3d.zig), not data/formula.")
    for a,cl,rgb in fails:
        print(f"              {a}: rendered {cl} rgb=[{rgb[0]:.0f},{rgb[1]:.0f},{rgb[2]:.0f}] (expected dark asphalt)")
    sys.exit(1)
print("[road-test] PASS — all road cells render as asphalt on the iso-3D mesh.")
PY
