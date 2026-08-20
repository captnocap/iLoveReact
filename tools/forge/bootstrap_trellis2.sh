#!/usr/bin/env bash
# TRELLIS.2 lane bootstrap — idempotent; everything persistent lives on the network
# volume (/workspace). Coexists with the Hunyuan3D-2 lane (separate venv, in/out dirs).
#
# Why this diverges from upstream setup.sh: TRELLIS.2 ships a conda + torch 2.6/cu124
# recipe, and cu124 cannot drive an RTX 5090 (Blackwell, sm_120). We build against the
# pod image's torch 2.9.1+cu128 instead, and skip flash-attn (no wheel for that torch;
# a source build costs ~an hour of pod time) — the lane runs ATTN_BACKEND=sdpa, which
# trellis2/modules/attention/config.py supports natively.
set -euo pipefail

M=/workspace/.t2-marks
mkdir -p "$M" /workspace/in-t2 /workspace/out-t2
step()      { [ -f "$M/$1.ok" ]; }
done_step() { touch "$M/$1.ok"; echo "[t2-bootstrap] $1 OK"; }

export HF_HOME=/workspace/hf
export DEBIAN_FRONTEND=noninteractive
# the image has CUDA 12.8 at /usr/local/cuda but non-interactive SSH doesn't PATH it
export CUDA_HOME=/usr/local/cuda
export PATH="$CUDA_HOME/bin:$PATH"

if ! step apt; then
  apt-get update -qq
  apt-get install -y -qq libjpeg-dev libopengl0 libegl1 >/dev/null
  done_step apt
fi

if ! step venv; then
  python3 -m venv --system-site-packages /workspace/venv-t2
  /workspace/venv-t2/bin/pip install -q --upgrade pip
  done_step venv
fi
PIP=/workspace/venv-t2/bin/pip
PY=/workspace/venv-t2/bin/python

if ! step clone; then
  rm -rf /workspace/TRELLIS.2
  git clone -b main --recursive https://github.com/microsoft/TRELLIS.2.git /workspace/TRELLIS.2
  done_step clone
fi

if ! step basics; then
  # upstream --basic minus gradio/tensorboard (batch lane needs neither) and minus
  # pillow-simd (SSE source build fails on py3.12; stock Pillow works). torchvision
  # must stay --no-deps or pip drags in a second torch (the image ships none).
  $PIP install -q torchvision==0.24.1 --no-deps
  $PIP install -q imageio imageio-ffmpeg tqdm easydict opencv-python-headless ninja \
    trimesh transformers pandas lpips zstandard kornia timm einops "huggingface_hub[cli]"
  $PIP install -q git+https://github.com/EasternJournalist/utils3d.git@9a4eb15e4021b67b12c460c7057d642626897ec8
  done_step basics
fi

# CUDA extensions, source-built for Blackwell against the image torch.
export TORCH_CUDA_ARCH_LIST="12.0"
MAX_JOBS=$(nproc); export MAX_JOBS
ext() { # ext <name> <giturl> [branch] [--recursive]
  local name=$1 url=$2 branch=${3:-} rec=${4:-}
  step "ext-$name" && return 0
  rm -rf "/tmp/ext/$name"; mkdir -p /tmp/ext
  # shellcheck disable=SC2086
  git clone ${branch:+-b "$branch"} $rec "$url" "/tmp/ext/$name"
  $PIP install "/tmp/ext/$name" --no-build-isolation
  done_step "ext-$name"
}
ext nvdiffrast https://github.com/NVlabs/nvdiffrast.git v0.4.0
ext nvdiffrec  https://github.com/JeffreyXiang/nvdiffrec.git renderutils
ext cumesh     https://github.com/JeffreyXiang/CuMesh.git "" --recursive
ext flexgemm   https://github.com/JeffreyXiang/FlexGEMM.git "" --recursive
if ! step ext-o-voxel; then
  $PIP install /workspace/TRELLIS.2/o-voxel --no-build-isolation
  done_step ext-o-voxel
fi

if ! step weights; then
  $PY - <<'EOF'
from huggingface_hub import snapshot_download
snapshot_download("microsoft/TRELLIS.2-4B")
EOF
  done_step weights
fi

echo BOOTSTRAP_T2_OK
