#!/usr/bin/env bash
# setup.sh — build the isolated venv genmesh.py runs in.
#
# Why isolated: the box's conda env has conflicting/broken ML packages
# (huggingface_hub 1.x vs transformers, a broken torchvision). Rather than mutate
# the user's env, genmesh gets its own clean venv — the same per-tool-venv pattern
# modly uses for each extension. Weights still land in the shared
# ~/.cache/huggingface, so they're downloaded once.
#
# Run once (genprop calls this automatically on first use):
#   bash cart/hmsc-int/tools/genmesh/setup.sh
#
# CUDA: uses the cu124 PyTorch wheel index — it's the one with cp313 wheels for
# both torch and torchvision. Driver 570 / CUDA 12.x supports it.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$DIR/.venv"
PYBASE="${GENMESH_PYTHON:-/usr/bin/python3.13}"   # non-conda base python

if [[ ! -x "$PYBASE" ]]; then
  echo "[setup] base python not found: $PYBASE (set GENMESH_PYTHON to override)" >&2
  exit 1
fi

if [[ ! -x "$VENV/bin/python" ]]; then
  echo "[setup] creating venv at $VENV (base: $PYBASE)" >&2
  "$PYBASE" -m venv "$VENV"
fi
PY="$VENV/bin/python"

"$PY" -m pip install --upgrade pip
echo "[setup] installing torch + torchvision (cu124)…" >&2
"$PY" -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
echo "[setup] installing model stack…" >&2
"$PY" -m pip install -r "$DIR/requirements.txt"

echo "[setup] verifying…" >&2
"$PY" - <<'PY'
import torch
from diffusers import ShapEImg2ImgPipeline, AutoPipelineForText2Image  # noqa: F401
import trimesh  # noqa: F401
print(f"[setup] OK — torch {torch.__version__}, cuda={torch.cuda.is_available()}")
PY
echo "[setup] done." >&2
