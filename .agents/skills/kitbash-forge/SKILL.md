---
name: kitbash-forge
description: Run the cloud kitbash pipeline end to end — generate style sheets, crop pieces, batch image→3D drafts on a rented RunPod RTX 5090, pull results to disk, and post-process them into editable topology for the studio. Use when an agent must produce modular build-piece drafts (doors, windows, columns, arches, kit pieces) from prompts, spin the forge pod up or down, or run the flatten/panelize reduction passes.
---

# Kitbash Forge

Images in, editable 3D drafts out, for ~$1/hr of pod time. Proven end to end 2026-08-16
(req_4547–4559): 6 styles → 12 sheets → 80 crops → 80 meshes in ~45 min for ~$1.15.
The pod is DISPOSABLE; the network volume is the persistence. ALWAYS terminate the pod
when the batch is down — the volume keeps everything.

## Standing infrastructure (exists, do not recreate)

- **Network volume `mkowi3x31g`** — 80 GB, datacenter **EU-RO-1**, named `kitbash-models`
  (~$5.60/mo). Holds `/workspace/venv` (python 3.12 over the image's torch),
  `/workspace/hf` (Hunyuan3D-2 weights ~9 GB), `/workspace/Hunyuan3D-2`,
  `/workspace/bin/instant-meshes`, `/workspace/in/`, `/workspace/out/`.
- **SSH key** `~/.runpod/ssh/runpodctl-ssh-key`, registered on the account.
- **runpodctl** at `~/.local/bin/runpodctl`, API key configured. The RunPod Claude Code
  plugin is installed (runpod:* skills) for anything this file doesn't cover.
- **Scripts — repo `tools/forge/` is the SOURCE OF TRUTH**; scp them to `/workspace/`
  each session (volume copies can lag):
  - `bootstrap.sh` — idempotent env setup (near-instant once the venv exists)
  - `batch3d.py` — images in `/workspace/in/` → per image a reduced `.glb` (MAX_FACES,
    default 30000) + `_quads.obj` field-aligned quads (QUAD_FACES coarse target, default
    1200; pure-quad subdivision lands ~4×)
  - `flatten.py` — LOCAL post-pass (CPU): coplanar-region collapse; `--panelize`
    straightens boundary runs and WELDS neighbour verts onto the lines (see Reduction)
  - `corpus` — retopo-corpus bundler (training-data capture; see the Retopo Field Manual
    artifact)

## Pod session (the whole loop)

```bash
TERM_AT=$(date -u -d '+4 hours' +%Y-%m-%dT%H:%M:%SZ)
runpodctl pod create --name kitbash-forge --gpu-id "NVIDIA GeForce RTX 5090" \
  --cloud-type SECURE --data-center-ids EU-RO-1 --network-volume-id mkowi3x31g \
  --image runpod/pytorch:1.0.3-cu1281-torch291-ubuntu2404 --container-disk-in-gb 40 \
  --ports "8188/http,22/tcp" --terminate-after "$TERM_AT" --wait
# read ssh ip/port from the reply; then:
SSH="ssh -i $HOME/.runpod/ssh/runpodctl-ssh-key -p <port> root@<ip>"
scp -i ~/.runpod/ssh/runpodctl-ssh-key -P <port> tools/forge/bootstrap.sh tools/forge/batch3d.py root@<ip>:/workspace/
$SSH "bash /workspace/bootstrap.sh"                       # prints BOOTSTRAP_OK
scp -i ~/.runpod/ssh/runpodctl-ssh-key -P <port> <crops>/*.png root@<ip>:/workspace/in/
$SSH "nohup /workspace/venv/bin/python /workspace/batch3d.py > /workspace/batch.log 2>&1 &"
# poll: grep -c 'raw ->' /workspace/batch.log ; done marker: BATCH_DONE  (~30 s/piece)
rsync -az -e "ssh -i $HOME/.runpod/ssh/runpodctl-ssh-key -p <port>" root@<ip>:/workspace/out/ ~/incoming/kitbash/<batch>/
runpodctl pod delete <pod-id>                             # ALWAYS — volume persists
```

Costs: 5090 secure ~$0.99/hr (community ~$0.69 but no volume attach). `--terminate-after`
is the backstop; `--stop-after` keeps billing disk. Balance check: `runpodctl user`.
When the 5090 is out of stock in EU-RO-1 (common), **RTX PRO 4500 Blackwell** (32GB,
$0.72/hr, stock usually High) is a drop-in — same sm_120 arch. Survey availability:
`runpodctl gpu list` filtered to EU-RO-1 + secureCloud + memoryInGb ≥ 24.

## TRELLIS.2 lane (PBR drafts — req_4710)

Alternative Stage B model: `microsoft/TRELLIS.2-4B` instead of Hunyuan3D-2 — emits a
PBR GLB (base color / roughness / metallic / opacity, WebP textures; glass comes out
as real opacity). Same pod recipe as above; scripts are
`tools/forge/bootstrap_trellis2.sh` + `tools/forge/batch_trellis2.py` (scp both to
`/workspace/` each session, repo is source of truth). Bootstrap is idempotent via
`/workspace/.t2-marks/` — first run ~48 min (extension compiles + 16GB weights), all
later runs seconds. Persistent on the volume: `/workspace/venv-t2`,
`/workspace/TRELLIS.2`, weights under `/workspace/hf`. Batch reads `/workspace/in-t2/`,
writes `/workspace/out-t2/<name>.glb`, prints `t2 -> name.glb` per piece and
`BATCH_DONE`. Knobs: `T2_DECIMATE` (300000), `T2_TEX` (2048), `T2_SEED` (42),
`T2_PIPELINE` (`512|1024|1024_cascade|1536_cascade`, default = model config).

- **Blackwell facts:** upstream's own recipe (torch 2.6/cu124 + flash-attn 2.7.3)
  cannot drive sm_120. The bootstrap builds nvdiffrast/nvdiffrec/CuMesh/FlexGEMM/
  o-voxel from source against the image's torch 2.9.1+cu128
  (`TORCH_CUDA_ARCH_LIST=12.0`, `CUDA_HOME=/usr/local/cuda` — nvcc exists in the
  image but is not on non-interactive-SSH PATH). No flash-attn: no wheel matches
  that torch and a source build costs ~an hour — the lane runs `ATTN_BACKEND=sdpa`,
  which trellis2's attention config supports natively.
- **DINOv3 gate:** the image conditioner is `facebook/dinov3-vitl16-pretrain-lvd1689m`,
  a MANUALLY GATED Meta repo — pipeline load 401s until the HF account has accepted
  the license (form on the repo page: name, DOB, country, affiliation — user-only,
  never fill it for them). The account token persists at `/workspace/hf/token`
  (= `$HF_HOME/token`, picked up automatically once access is granted).

## Stage A — sheets and crops (no pod needed)

Sheets run on the img.cjs headless lane (see `agent-seat/corpus/generate.md` for the
queue grammar). **gpt-image-2 only for text→image** — nano-banana-2-lite 400s without a
reference image (it is an edit-family model). Proven sheet recipe: one prompt per style,
`[1536x1536] [1] [2] [gpt-image-2] [none] [none] [quality=high]`, prompt = "kitbash
reference sheet, grid layout of isolated architectural pieces, plain light gray studio
background, straight-on front view, consistent scale, no text/labels/logos, no full
building, individual modular parts only" + the style's element list. **Whole isolated
pieces only — detail-closeup vignettes reconstruct as mush.** Crop by background
segmentation (see the crop script pattern in req_4559's session; scipy label over
diff-from-border-median). Generate parts SEPARATELY when they will mount separately
(door leaf vs surround vs hardware — matches the wall-opening-kit leaf contract).
Knob-scale hardware is primitive-modeling work; image→3D drops it.

## Reduction — from draft to editable

Raw isosurface is soup; the pod already reduces and quad-remeshes. For hard-surface
pieces go further, locally and free:

```bash
python tools/forge/flatten.py in.obj out.obj --angle 2.5 --dist 0.0008 --panelize
```

- **QEM decimation is BANNED for this** — it wobbles feature edges (user verdict).
- Uniform coarse quads mush ornament; dense quads + panelize is the lane.
- `--dist` must sit BELOW the shallowest relief to keep (door panels are ~mm-deep;
  too loose = a flat face bridges straight over the relief).
- Panelize's weld step is load-bearing: without it the audit reports hundreds of
  penetrating slivers at region seams. The editor's geometry audit (intersecting /
  unreachable in the panel, BVH-backed since req_4557) is the objective referee —
  read it after every import.
- v4 direction (req_4588, not yet built): T-junction verts on panel edges are LOOP
  DEMAND — pair across opposite edges and cut; dumbest surface first.

## Import and verify

`tools/seat action model-import '{"path":"<abs path .glb/.obj>"}'` against the running
dev host, then `tools/seat look --brief` (audit line included) and an offscreen shot:
`tools/seat action shot '{"offscreen":true,"path":"<png>","pose":[yaw,pitch,dist]}'`
(radians, does not move the user's camera). The importer keeps OBJ polygons as authored
faces on smaller meshes but SOUPS quads to triangles above some size (gate unfound,
req_4579 open); `tris-to-quads` currently refuses fan-triangulated quads.

## Traps (each cost a debugging session once)

- Image ships torch 2.9.1+cu128 (Blackwell-correct) but NO torchvision — bootstrap pins
  `torchvision==0.24.1 --no-deps`; never let requirements.txt touch torch.
- Ubuntu 24.04 image is PEP-668 externally managed — everything installs into the venv.
- pymeshlab needs `apt-get update && apt-get install libopengl0` or its io plugins fail
  with "Unknown format for load: ply" — bootstrap does it.
- First-ever pip install onto the network volume is SLOW (~15 min). One-time; done.
- NEVER `pkill -f` on the pod — it matches the SSH session's own command line and kills
  the connection. Exact PIDs from `ps aux | awk`.
- instant-meshes `--help` exits non-zero; probe health with `ldd | grep "not found"`.
