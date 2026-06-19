#!/usr/bin/env bash
# setup-instantmesh.sh — install InstantMesh (TencentARC) as a high-quality
# image->3D backend for the genmesh pipeline. RUN THIS YOURSELF (it clones an
# external repo + builds a CUDA extension, which the agent sandbox blocks):
#
#   bash cart/hmsc-int/tools/genmesh/setup-instantmesh.sh
#
# What it does, and why each choice:
#  - Clones TencentARC/InstantMesh into deps/InstantMesh (Apache-2.0, ungated).
#  - Makes a CLEAN conda env `instantmesh` on python 3.10 — the repo targets 3.10,
#    and this dodges the py3.13 wheel problems (old tokenizers/transformers) AND
#    stays independent of the broken base conda env.
#  - torch from the cu124 wheel index (matches the 570 driver).
#  - nvdiffrast: InstantMesh uses RasterizeCudaContext (NOT GL), so it runs
#    HEADLESS — no display/EGL. nvdiffrast still compiles a CUDA ext on first use
#    (needs nvcc; you have 12.2).
#  - Skips gradio/tensorboard/webdataset/bitsandbytes — only the web demo needs them.
#  - Weights (~7GB: InstantMesh LRM + Zero123++ multiview) auto-download from HF on
#    the first `run.py`, not here.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
DEST="$REPO_ROOT/deps/InstantMesh"
ENV_NAME=instantmesh

command -v conda >/dev/null || { echo "conda not found on PATH" >&2; exit 1; }

# 1. clone (skip if present)
if [ ! -d "$DEST" ]; then
  echo "== cloning InstantMesh -> $DEST =="
  git clone https://github.com/TencentARC/InstantMesh "$DEST"
fi

# 2. clean py3.10 env (independent of the broken base env)
echo "== creating conda env '$ENV_NAME' (python 3.10) =="
source "$(conda info --base)/etc/profile.d/conda.sh"
conda create -y -n "$ENV_NAME" python=3.10
conda activate "$ENV_NAME"

python -m pip install --upgrade pip

# 3. torch (cu124 — matches driver 570 / CUDA 12.x)
echo "== installing torch (cu124) =="
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124

# 4. InstantMesh runtime deps (trimmed to what run.py needs)
echo "== installing InstantMesh deps =="
pip install \
  "numpy<2" \
  pytorch-lightning==2.1.2 \
  einops omegaconf torchmetrics accelerate \
  transformers==4.34.1 diffusers==0.20.2 huggingface-hub \
  "imageio[ffmpeg]" rembg onnxruntime \
  trimesh PyMCubes xatlas plyfile opencv-python-headless ninja

# 5. nvdiffrast (CUDA rasterizer; compiles on first import)
echo "== installing nvdiffrast =="
pip install git+https://github.com/NVlabs/nvdiffrast

echo ""
echo "== done. Smoke-test (downloads ~7GB of weights on first run): =="
echo "   conda activate $ENV_NAME"
echo "   cd $DEST"
echo "   python run.py configs/instant-mesh-large.yaml <some_image.png> --output_path outputs --export_texmap"
echo ""
echo "Output mesh lands in: $DEST/outputs/instant-mesh-large/meshes/<name>.obj"
echo "Paste me the result (or any error) and I'll wire 'genmodel --backend instantmesh'."
