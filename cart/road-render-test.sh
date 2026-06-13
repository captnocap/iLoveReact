#!/usr/bin/env bash
# road-render-test.sh — the REAL-GPU regression test + fix gate for the painted-road
# render bug (req_0833/0835/0837/0838). NOT a JS reproduction of the shader (those
# kept lying that the road resolves fine). It boots the road-render-test cart
# HEADLESS, renders the actual WGSL on the GPU, captures the swapchain, and reads the
# rendered colour back at named road cells across any chunk. FAIL while the bug is
# live; PASS when every named cell renders as asphalt on the 3D mesh.
#
# Routes (over ALL painted chunks of coastal-town):
#   /mesh/<wx>/<wz> — the iso-3D ground path under test: every painted <Landform>
#                     groundFormula mesh per fragment in framework/gpu/3d.zig, real
#                     IsoStage camera centred on (wx,wz) at a tight zoom.
#   /quad/<wx>/<wz> — the SAME formula as a 2D <Effect> quad for the chunk containing
#                     (wx,wz): the control that proves the DATA is road and the
#                     classifier detects asphalt when the formula actually draws it.
#
# The checker parses the cell addresses, groups them by chunk (one /quad shot each)
# and into tight z-clusters (one /mesh shot each, so adjacent cells like EK52/EK53
# resolve), finds the four ground fiducials per /mesh shot, solves the y=0-plane ->
# pixel homography, and samples each cell. asphalt is dark; concrete is light tan.
#
# Usage:
#   ./cart/road-render-test.sh                                 # default z~112 region (FAIL)
#   ./cart/road-render-test.sh EK52 EK53 EK100 EK121 EK170 EK173
#       — bare addresses; the TARGET is that ALL render as road (exit 0 when fixed).
#   ./cart/road-render-test.sh EK52=pass EK53=fail ...
#       — optional =pass/=fail tags = the CURRENT on-screen state you observe; the
#         checker reports whether its verdict MATCHES your eyes (test self-validation).
set -euo pipefail
cd "$(dirname "$0")/.."

python3 - "$@" <<'PY'
import sys, subprocess, numpy as np
from PIL import Image

CHUNK=120; FID_DX,FID_DZ=8.0,5.0; CLUSTER_GAP=8   # MUST match cart/road-render-test.tsx
ARGS=sys.argv[1:]
if not ARGS:  # default: the z~112 bug region
    ARGS=['EK111','EI111','EI112','EI113','EI114','EJ111']

def col_index(L):
    n=0
    for ch in L.upper(): n=n*26+(ord(ch)-ord('A')+1)
    return n-1
def parse(tok):                       # "EK52" | "EK52=pass" | "EK52=fail"
    obs=None
    if '=' in tok: tok,tag=tok.split('=',1); obs=('road' if tag.strip().lower()=='pass' else 'concrete')
    i=0
    while i<len(tok) and tok[i].isalpha(): i+=1
    gx,gz=col_index(tok[:i]),int(tok[i:])
    return {'addr':tok,'gx':gx,'gz':gz,'cx':gx//CHUNK,'cz':gz//CHUNK,'obs':obs}

cells=[parse(t) for t in ARGS]

def shot(route,out):
    subprocess.run(['tools/rjit','shot','road-render-test','--route',route,'--out',out,
                    '--frames','200','--timeout','120'],check=True,
                   stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
def load(p): return np.asarray(Image.open(p).convert('RGB')).astype(np.float64)
def classify(rgb):
    r,g,b=rgb; lum=(r+g+b)/3
    if r>120 and g>110 and b<90 and r-b>60: return 'YELLOW'   # median centreline
    if r-b>35 and lum>70: return 'SAND'
    return 'ROAD' if lum<70 else 'CONCRETE'
def sample(im,px,py,r=3):
    x0,y0=int(round(px)),int(round(py))
    return im[max(0,y0-r):y0+r+1,max(0,x0-r):x0+r+1].reshape(-1,3).mean(0)
def centroids(im):
    R,G,B=im[:,:,0],im[:,:,1],im[:,:,2]
    sc={'R':R-np.maximum(G,B),'G':G-np.maximum(R,B),'B':B-np.maximum(R,G),'C':np.minimum(G,B)-R}
    out={}
    for s,m in sc.items():
        mask=m>=max(m.max()*0.6,80.0); ys,xs=np.where(mask); out[s]=(float(xs.mean()),float(ys.mean()))
    return out
def homography(im,cx,cz):
    fid=[((cx-FID_DX,cz-FID_DZ),'R'),((cx+FID_DX,cz-FID_DZ),'G'),
         ((cx+FID_DX,cz+FID_DZ),'B'),((cx-FID_DX,cz+FID_DZ),'C')]
    px=centroids(im); A=[];b=[]
    for (wx,wz),t in fid:
        x,y=px[t]; A.append([wx,wz,1,0,0,0,-x*wx,-x*wz]); b.append(x); A.append([0,0,0,wx,wz,1,-y*wx,-y*wz]); b.append(y)
    h=np.linalg.solve(np.array(A),np.array(b)); H=np.array([[h[0],h[1],h[2]],[h[3],h[4],h[5]],[h[6],h[7],1]])
    return lambda wx,wz:(lambda v:(v[0]/v[2],v[1]/v[2]))(H@np.array([wx,wz,1.0]))

# ── control: one /quad per distinct chunk ──
chunks=sorted({(c['cx'],c['cz']) for c in cells})
for (cx,cz) in chunks:
    wx,wz=cx*CHUNK+CHUNK/2, cz*CHUNK+CHUNK/2
    print(f"[road-test] /quad control for chunk ({cx},{cz})..."); shot(f"/quad/{wx}/{wz}", f"/tmp/road-quad-{cx}-{cz}.png")
for c in cells:
    im=load(f"/tmp/road-quad-{c['cx']}-{c['cz']}.png"); H,W=im.shape[:2]
    lx,lz=c['gx']-c['cx']*CHUNK, c['gz']-c['cz']*CHUNK
    c['quad']=classify(sample(im,(lx+0.5)/CHUNK*W,(lz+0.5)/CHUNK*H))

# ── test: one /mesh per tight z-cluster (per chunk) ──
def clusters_of(chunk_cells):
    cc=sorted(chunk_cells,key=lambda c:c['gz']); groups=[[cc[0]]]
    for c in cc[1:]:
        if c['gz']-groups[-1][-1]['gz']<=CLUSTER_GAP: groups[-1].append(c)
        else: groups.append([c])
    return groups
clusters=[]
for (cx,cz) in chunks:
    clusters += clusters_of([c for c in cells if (c['cx'],c['cz'])==(cx,cz)])
for i,grp in enumerate(clusters):
    cwx=sum(c['gx'] for c in grp)/len(grp)+0.5
    cwz=sum(c['gz'] for c in grp)/len(grp)+0.5
    print(f"[road-test] /mesh shot for {[c['addr'] for c in grp]} centred ({cwx},{cwz})...")
    shot(f"/mesh/{cwx}/{cwz}", f"/tmp/road-mesh-{i}.png")
    im=load(f"/tmp/road-mesh-{i}.png"); w2p=homography(im,cwx,cwz)
    for c in grp:
        px,py=w2p(c['gx']+0.5,c['gz']+0.5); c['mesh']=classify(sample(im,px,py)); c['rgb']=sample(im,px,py)

# ── report ──
print(f"\naddr   chunk worldXZ   | /quad control | /mesh (under test)         | your eyes  match")
print(  "--------------------------+---------------+----------------------------+-----------------")
control_fail=[]; fails=[]; mismatches=[]
for c in cells:
    mok = c['mesh'] in ('ROAD','YELLOW'); qok = c['quad'] in ('ROAD','YELLOW')
    if not qok: control_fail.append(c['addr'])
    if not mok: fails.append(c)
    obs=c['obs']; matchtxt=''
    if obs is not None:
        observed_road = (obs=='road'); match = (mok==observed_road)
        matchtxt = ('match' if match else 'MISMATCH')
        if not match: mismatches.append(c['addr'])
        obs=('PASS' if observed_road else 'FAIL')
    else: obs='-'
    r=c['rgb']
    print(f"{c['addr']:6} ({c['cx']},{c['cz']}) ({c['gx']},{c['gz']}) | {c['quad']:8}      | "
          f"[{r[0]:5.1f},{r[1]:5.1f},{r[2]:5.1f}] {c['mesh']:8} {'OK' if mok else 'FAIL'} | {obs:6}    {matchtxt}")

print()
if control_fail:
    print(f"[road-test] HARNESS BROKEN: /quad control did not render asphalt at {control_fail}.")
    sys.exit(2)
if mismatches:
    print(f"[road-test] WARNING: test verdict disagrees with your observed state at {mismatches} —")
    print( "            the harness sampling may be off there; investigate before trusting it.")
if fails:
    print(f"[road-test] FAIL — {len(fails)} cell(s) render as CONCRETE on the iso-3D mesh though the")
    print( "            data is road and /quad draws asphalt. Bug is in framework/gpu/3d.zig (mesh path).")
    for c in fails:
        r=c['rgb']; print(f"              {c['addr']}: {c['mesh']} rgb=[{r[0]:.0f},{r[1]:.0f},{r[2]:.0f}] (expected dark asphalt)")
    sys.exit(1)
print("[road-test] PASS — every cell renders as asphalt on the iso-3D mesh.")
PY
